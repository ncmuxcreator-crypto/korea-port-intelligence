import fs from "fs";

const SUPABASE_URL = String(process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const REST_URL = SUPABASE_URL ? `${SUPABASE_URL}/rest/v1` : "";
const MAX_ROWS = positiveInt(process.env.AUDIT_DB_MAX_ROWS, 25000);
const PAGE_SIZE = Math.min(1000, positiveInt(process.env.AUDIT_DB_PAGE_SIZE, 1000));

const TABLE_GROUPS = {
  Core: [
    "data_collection_runs",
    "active_dataset_pointer",
    "vessel_snapshots",
    "vessel_master",
    "vessel_entities",
    "port_call_master",
    "opportunity_master",
    "dashboard_summary_snapshots"
  ],
  Commercial: [
    "sales_candidates_current",
    "immediate_targets_current",
    "commercial_leads",
    "operator_contact_history"
  ],
  "History / analytics": [
    "vessel_events",
    "risk_history",
    "explainability_snapshots",
    "feature_store",
    "feature_snapshots",
    "rule_evaluations",
    "model_training_rows",
    "vessel_snapshot_daily",
    "port_snapshot_daily",
    "commercial_opportunity_daily",
    "route_snapshot_daily",
    "operator_snapshot_daily",
    "vessel_universe_audit"
  ],
  "Port summary": [
    "port_summary_current",
    "port_congestion_snapshots",
    "port_daily_summary",
    "port_weekly_summary",
    "port_monthly_summary"
  ],
  Pilot: [
    "pilot_schedule_events"
  ]
};

const ALL_TABLES = [...new Set(Object.values(TABLE_GROUPS).flat())];

const STATIC_OUTPUTS = [
  "dashboard/api/dashboard-summary.json",
  "dashboard/api/status.json",
  "dashboard/api/candidates/top.json",
  "dashboard/api/staying-vessels.json",
  "dashboard/api/arrival-pipeline.json",
  "dashboard/api/congestion-watchlist.json",
  "dashboard/api/agent-followup-queue.json"
];

const REQUIRED_SCHEMA_CHECKS = [
  {
    key: "vessel_events_event_uid_unique",
    severity: "CRITICAL",
    description: "vessel_events has unique constraint matching ON CONFLICT (event_uid)",
    table: "vessel_events",
    test: schema => schema.hasUniqueIndex("vessel_events", ["event_uid"], { requireNonPartial: true }),
    sql: "create unique index if not exists ux_vessel_events_event_uid on vessel_events(event_uid);"
  },
  {
    key: "vessel_master_identity",
    severity: "WARNING",
    description: "vessel_master has primary identity key",
    table: "vessel_master",
    test: schema => schema.hasPrimaryKey("vessel_master", "master_vessel_id"),
    sql: "alter table vessel_master add primary key (master_vessel_id);"
  },
  {
    key: "vessel_snapshots_run_index",
    severity: "WARNING",
    description: "vessel_snapshots has index on run_id",
    table: "vessel_snapshots",
    test: schema => schema.hasIndexColumns("vessel_snapshots", ["run_id"]),
    sql: "create index if not exists idx_vessel_snapshots_run_id on vessel_snapshots(run_id);"
  },
  {
    key: "port_call_master_run_index",
    severity: "WARNING",
    description: "port_call_master has index on run_id",
    table: "port_call_master",
    test: schema => schema.hasIndexColumns("port_call_master", ["run_id"]),
    sql: "create index if not exists idx_port_call_master_run_id on port_call_master(run_id);"
  },
  {
    key: "opportunity_master_run_index",
    severity: "WARNING",
    description: "opportunity_master has index on run_id",
    table: "opportunity_master",
    test: schema => schema.hasIndexColumns("opportunity_master", ["run_id"]),
    sql: "create index if not exists idx_opportunity_master_run_id on opportunity_master(run_id);"
  },
  {
    key: "dashboard_summary_run_unique",
    severity: "WARNING",
    description: "dashboard_summary_snapshots has unique run_id",
    table: "dashboard_summary_snapshots",
    test: schema => schema.hasUniqueIndex("dashboard_summary_snapshots", ["run_id"], { requireNonPartial: false }),
    sql: "create unique index if not exists ux_dashboard_summary_snapshots_run_id on dashboard_summary_snapshots(run_id);"
  },
  {
    key: "active_dataset_pointer_key",
    severity: "CRITICAL",
    description: "active_dataset_pointer has one-row key constraint",
    table: "active_dataset_pointer",
    test: schema => schema.hasPrimaryKey("active_dataset_pointer", "id"),
    sql: "alter table active_dataset_pointer add primary key (id);"
  },
  {
    key: "port_summary_current_run_port_unique",
    severity: "WARNING",
    description: "port_summary_current has unique run_id + port_code",
    table: "port_summary_current",
    test: schema => schema.hasUniqueIndex("port_summary_current", ["run_id", "port_code"], { requireNonPartial: false }),
    sql: "create unique index if not exists ux_port_summary_current_run_port on port_summary_current(run_id, port_code);"
  },
  {
    key: "sales_candidates_current_run_vessel_unique",
    severity: "WARNING",
    description: "sales_candidates_current has unique run_id + vessel identity",
    table: "sales_candidates_current",
    test: schema =>
      schema.hasUniqueIndex("sales_candidates_current", ["run_id", "master_vessel_id"], { requireNonPartial: false }) ||
      schema.hasUniqueIndex("sales_candidates_current", ["run_id", "vessel_id"], { requireNonPartial: false }) ||
      schema.hasUniqueIndex("sales_candidates_current", ["master_vessel_id"], { requireNonPartial: false }) ||
      schema.hasUniqueIndex("sales_candidates_current", ["vessel_id"], { requireNonPartial: false }),
    sql: "create unique index if not exists ux_sales_candidates_current_run_vessel on sales_candidates_current(run_id, master_vessel_id) where master_vessel_id is not null;"
  }
];

const DUPLICATE_RULES = {
  vessel_master: [
    { label: "duplicate IMO", fields: ["imo"] },
    { label: "duplicate MMSI where IMO is null", fields: ["mmsi"], condition: row => !clean(row.imo) },
    { label: "duplicate normalized name + vessel type", fields: [["normalized_name", "normalized_vessel_name", "canonical_name"], "vessel_type"] }
  ],
  vessel_snapshots: [
    { label: "duplicate run_id + vessel_id", fields: ["run_id", ["vessel_id", "master_vessel_id"]] },
    { label: "duplicate run_id + imo", fields: ["run_id", "imo"] },
    { label: "duplicate run_id + mmsi", fields: ["run_id", "mmsi"] },
    { label: "duplicate run_id + normalized vessel name + port", fields: ["run_id", ["normalized_vessel_name", "vessel_name"], ["port", "port_code", "port_name"]] }
  ],
  port_call_master: [
    { label: "duplicate run_id + vessel identity + port_code", fields: ["run_id", ["vessel_id", "master_vessel_id"], "port_code"] },
    { label: "duplicate IMO + port_code + date window", fields: ["imo", "port_code", row => dateWindow(firstValue(row, ["arrival", "arrival_time", "ata", "eta", "created_at"]))] }
  ],
  opportunity_master: [
    { label: "duplicate run_id + vessel identity", fields: ["run_id", ["vessel_id", "master_vessel_id"]] },
    { label: "duplicate run_id + IMO", fields: ["run_id", "imo"] },
    { label: "duplicate opportunity_id", fields: ["opportunity_id"] }
  ],
  vessel_events: [
    { label: "duplicate event_key", fields: ["event_key"] },
    { label: "duplicate vessel_id + event_type + occurred_at", fields: [["vessel_id", "master_vessel_id"], "event_type", ["occurred_at", "event_time", "event_at"]] },
    { label: "duplicate IMO + event_type + occurred_at", fields: ["imo", "event_type", ["occurred_at", "event_time", "event_at"]] }
  ],
  dashboard_summary_snapshots: [
    { label: "duplicate run_id", fields: ["run_id"] }
  ],
  port_summary_current: [
    { label: "duplicate run_id + port_code", fields: ["run_id", "port_code"] },
    { label: "duplicate display name after normalization", fields: [["display_name", "port_name"]] }
  ],
  sales_candidates_current: [
    { label: "duplicate vessel identity", fields: [["vessel_id", "master_vessel_id"]] },
    { label: "duplicate IMO", fields: ["imo"] },
    { label: "duplicate rank", fields: ["rank"] }
  ]
};

const RUN_CHILD_TABLES = [
  "vessel_snapshots",
  "port_call_master",
  "opportunity_master",
  "dashboard_summary_snapshots",
  "port_summary_current"
];

function positiveInt(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback;
}

function readText(path, fallback = "") {
  try {
    return fs.existsSync(path) ? fs.readFileSync(path, "utf8") : fallback;
  } catch {
    return fallback;
  }
}

function readJson(path, fallback = null) {
  try {
    return fs.existsSync(path) ? JSON.parse(fs.readFileSync(path, "utf8")) : fallback;
  } catch {
    return fallback;
  }
}

function rowsFromPayload(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.vessels)) return payload.vessels;
  if (Array.isArray(payload?.candidates)) return payload.candidates;
  if (Array.isArray(payload?.rows)) return payload.rows;
  return [];
}

function clean(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function normalizeKey(value) {
  return clean(value).toUpperCase().replace(/\s+/g, " ");
}

function firstValue(row, names) {
  const list = Array.isArray(names) ? names : [names];
  for (const name of list) {
    if (typeof name === "function") {
      const value = name(row);
      if (clean(value)) return value;
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(row, name) && clean(row[name])) return row[name];
  }
  return "";
}

function dateWindow(value) {
  const text = clean(value);
  if (!text) return "";
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return text.slice(0, 10);
  return date.toISOString().slice(0, 10);
}

function parseContentRange(value) {
  const text = clean(value);
  const match = text.match(/\/(\d+|\*)$/);
  if (!match || match[1] === "*") return null;
  const count = Number(match[1]);
  return Number.isFinite(count) ? count : null;
}

function formatCount(value) {
  return Number.isFinite(Number(value)) ? Number(value).toLocaleString("en-US") : "unknown";
}

function label(status, text) {
  return status ? `${status}: ${text}` : text;
}

function parseLocalSchema(sql) {
  const tables = new Map();
  const indexes = [];

  function ensure(table) {
    if (!tables.has(table)) {
      tables.set(table, {
        columns: new Set(),
        primaryKeys: new Set(),
        uniqueSets: []
      });
    }
    return tables.get(table);
  }

  const createTable = /create table if not exists\s+([a-zA-Z0-9_]+)\s*\(([\s\S]*?)\);/gi;
  let tableMatch;
  while ((tableMatch = createTable.exec(sql))) {
    const table = tableMatch[1];
    const body = tableMatch[2];
    const meta = ensure(table);
    for (const rawLine of body.split(/\r?\n/)) {
      const line = rawLine.trim().replace(/,$/, "");
      if (!line || line.startsWith("--")) continue;
      const lower = line.toLowerCase();
      if (lower.startsWith("primary key")) {
        const columns = columnsInsideParens(line);
        columns.forEach(column => meta.primaryKeys.add(column));
        continue;
      }
      if (lower.startsWith("unique")) {
        const columns = columnsInsideParens(line);
        if (columns.length) meta.uniqueSets.push(columns);
        continue;
      }
      if (lower.startsWith("constraint") || lower.startsWith("foreign") || lower.startsWith("check")) continue;
      const column = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s+/)?.[1];
      if (!column) continue;
      meta.columns.add(column);
      if (lower.includes(" primary key")) meta.primaryKeys.add(column);
      if (lower.includes(" unique")) meta.uniqueSets.push([column]);
    }
  }

  const alterColumn = /alter table\s+(?:if exists\s+)?([a-zA-Z0-9_]+)\s+add column if not exists\s+([a-zA-Z0-9_]+)/gi;
  let alterMatch;
  while ((alterMatch = alterColumn.exec(sql))) {
    ensure(alterMatch[1]).columns.add(alterMatch[2]);
  }

  const createIndex = /create\s+(unique\s+)?index if not exists\s+([a-zA-Z0-9_]+)\s+on\s+([a-zA-Z0-9_]+)\s*\(([^;]+?)\)([^;]*);/gi;
  let indexMatch;
  while ((indexMatch = createIndex.exec(sql))) {
    const columns = indexMatch[4]
      .split(",")
      .map(part => part.trim().replace(/\s+(asc|desc|nullslast|nullsfirst).*$/i, ""))
      .map(part => part.replace(/["()]/g, "").trim())
      .filter(Boolean);
    indexes.push({
      unique: Boolean(indexMatch[1]),
      name: indexMatch[2],
      table: indexMatch[3],
      columns,
      partial: /\bwhere\b/i.test(indexMatch[5] || "")
    });
  }

  return {
    tables,
    indexes,
    hasTable(table) {
      return tables.has(table);
    },
    hasColumn(table, column) {
      return tables.get(table)?.columns.has(column) || false;
    },
    hasAnyColumn(table, columns) {
      return columns.some(column => this.hasColumn(table, column));
    },
    hasPrimaryKey(table, column) {
      return tables.get(table)?.primaryKeys.has(column) || false;
    },
    hasIndexColumns(table, columns) {
      const wanted = columns.join(",");
      return indexes.some(index => index.table === table && index.columns.join(",") === wanted);
    },
    hasUniqueIndex(table, columns, options = {}) {
      const wanted = columns.join(",");
      const tableMeta = tables.get(table);
      const tableUnique = tableMeta?.uniqueSets.some(set => set.join(",") === wanted) || false;
      if (tableUnique && !options.requireNonPartial) return true;
      return indexes.some(index =>
        index.table === table &&
        index.unique &&
        index.columns.join(",") === wanted &&
        (!options.requireNonPartial || !index.partial)
      );
    },
    columnsFor(table) {
      return [...(tables.get(table)?.columns || [])];
    }
  };
}

function columnsInsideParens(line) {
  const match = line.match(/\(([^)]+)\)/);
  if (!match) return [];
  return match[1].split(",").map(value => value.trim().replace(/"/g, "")).filter(Boolean);
}

function urlFor(table, params = {}) {
  const url = new URL(`${REST_URL}/${table}`);
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const item of value) url.searchParams.append(key, item);
    } else {
      url.searchParams.append(key, value);
    }
  }
  return url.toString();
}

async function rest(table, params = {}, options = {}) {
  const headers = Object.fromEntries(Object.entries({
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    accept: "application/json",
    ...options.headers
  }).filter(([, value]) => value !== undefined && value !== null));
  const response = await fetch(urlFor(table, params), { headers });
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return {
    ok: response.ok,
    status: response.status,
    body,
    rows: Array.isArray(body) ? body : [],
    count: parseContentRange(response.headers.get("content-range")),
    contentRange: response.headers.get("content-range") || "",
    error: response.ok ? null : errorText(body, text)
  };
}

function errorText(body, fallback) {
  if (body && typeof body === "object") {
    return body.message || body.details || body.hint || body.code || JSON.stringify(body);
  }
  return clean(fallback) || "unknown_error";
}

async function countRows(table, filters = {}) {
  const params = { select: "*" };
  Object.assign(params, filters);
  try {
    const result = await rest(table, params, {
      headers: {
        prefer: "count=exact",
        range: "0-0"
      }
    });
    return {
      table,
      exists: result.ok,
      row_count: result.ok ? (result.count ?? result.rows.length) : null,
      error: result.error,
      status: result.status
    };
  } catch (error) {
    return {
      table,
      exists: false,
      row_count: null,
      error: error?.message || String(error),
      status: 0
    };
  }
}

async function fetchRows(table, selectColumns, options = {}) {
  const rows = [];
  let count = null;
  let from = 0;
  const select = selectColumns?.length ? [...new Set(selectColumns)].join(",") : "*";
  while (rows.length < (options.maxRows || MAX_ROWS)) {
    const to = Math.min(from + PAGE_SIZE - 1, (options.maxRows || MAX_ROWS) - 1);
    const params = { select, ...(options.filters || {}) };
    if (options.order) params.order = options.order;
    if (options.limit) params.limit = String(options.limit);
    const result = await rest(table, params, {
      headers: {
        prefer: from === 0 ? "count=exact" : undefined,
        range: `${from}-${to}`
      }
    });
    if (!result.ok) {
      return { ok: false, rows, count, sampled: false, error: result.error, status: result.status };
    }
    if (from === 0) count = result.count;
    rows.push(...result.rows);
    if (options.limit || result.rows.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return {
    ok: true,
    rows,
    count: count ?? rows.length,
    sampled: Number.isFinite(count) ? rows.length < count : rows.length >= (options.maxRows || MAX_ROWS)
  };
}

async function latestRow(table, schema, countInfo) {
  if (!countInfo.exists || !countInfo.row_count) return { latest_created_at: null, latest_run_id: null };
  const columns = schema.columnsFor(table);
  const timeColumn = [
    "created_at",
    "updated_at",
    "collected_at",
    "generated_at",
    "finished_at",
    "promoted_at",
    "started_at",
    "last_seen_at",
    "last_seen",
    "summary_date",
    "week_start",
    "month_start",
    "snapshot_date"
  ].find(column => columns.includes(column));
  const selectColumns = [...new Set([schema.hasColumn(table, "run_id") ? "run_id" : null, timeColumn].filter(Boolean))];
  if (!selectColumns.length) return { latest_created_at: null, latest_run_id: null };
  const result = await fetchRows(table, selectColumns, {
    order: timeColumn ? `${timeColumn}.desc.nullslast` : undefined,
    limit: 1,
    maxRows: 1
  });
  const row = result.rows[0] || {};
  return {
    latest_created_at: timeColumn ? row[timeColumn] || null : null,
    latest_run_id: row.run_id || null
  };
}

async function linkedRunCount(table, schema, countInfo) {
  if (!countInfo.exists || !schema.hasColumn(table, "run_id") || !countInfo.row_count) {
    return { linked_run_id_count: null, linked_run_id_count_sampled: false };
  }
  const result = await fetchRows(table, ["run_id"], {
    filters: { run_id: "not.is.null" },
    maxRows: MAX_ROWS
  });
  if (!result.ok) return { linked_run_id_count: null, linked_run_id_count_sampled: false, error: result.error };
  return {
    linked_run_id_count: new Set(result.rows.map(row => clean(row.run_id)).filter(Boolean)).size,
    linked_run_id_count_sampled: result.sampled
  };
}

async function buildTableCounts(schema) {
  const output = {};
  for (const [group, tables] of Object.entries(TABLE_GROUPS)) {
    output[group] = [];
    for (const table of tables) {
      const count = await countRows(table);
      const latest = await latestRow(table, schema, count);
      const runCount = await linkedRunCount(table, schema, count);
      output[group].push({
        table,
        exists: count.exists,
        row_count: count.row_count,
        estimated_size: "not_available_via_rest",
        latest_created_at: latest.latest_created_at,
        latest_run_id: latest.latest_run_id,
        linked_run_id_count: runCount.linked_run_id_count,
        linked_run_id_count_sampled: runCount.linked_run_id_count_sampled,
        error: count.error
      });
    }
  }
  return output;
}

function requiredColumnsForRules(rules) {
  const columns = new Set();
  for (const rule of rules) {
    for (const field of rule.fields) {
      if (typeof field === "string") columns.add(field);
      if (Array.isArray(field)) field.forEach(name => columns.add(name));
    }
  }
  return [...columns];
}

async function detectDuplicates(schema) {
  const results = [];
  for (const [table, rules] of Object.entries(DUPLICATE_RULES)) {
    const availableColumns = schema.columnsFor(table);
    const neededColumns = requiredColumnsForRules(rules).filter(column => availableColumns.includes(column));
    const identityColumns = ["id", "snapshot_id", "master_vessel_id", "port_call_id", "opportunity_id", "event_uid", "current_id", "run_id"]
      .filter(column => availableColumns.includes(column));
    const result = await fetchRows(table, [...new Set([...neededColumns, ...identityColumns])], { maxRows: MAX_ROWS });
    if (!result.ok) {
      results.push({ table, ok: false, sampled: false, error: result.error, rules: [] });
      continue;
    }
    const tableRules = rules.map(rule => duplicateRuleResult(rule, result.rows));
    results.push({
      table,
      ok: true,
      scanned_rows: result.rows.length,
      total_rows: result.count,
      sampled: result.sampled,
      rules: tableRules
    });
  }
  return results;
}

function duplicateRuleResult(rule, rows) {
  const groups = new Map();
  for (const row of rows) {
    if (rule.condition && !rule.condition(row)) continue;
    const parts = rule.fields.map(field => firstValue(row, field));
    if (parts.some(part => !clean(part))) continue;
    const key = parts.map(normalizeKey).join(" | ");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  const duplicates = [...groups.entries()]
    .filter(([, values]) => values.length > 1)
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 5)
    .map(([key, values]) => ({
      key,
      count: values.length,
      examples: values.slice(0, 3).map(exampleIdentity)
    }));
  return {
    label: rule.label,
    duplicate_group_count: duplicates.length,
    duplicate_row_count: duplicates.reduce((sum, item) => sum + item.count, 0),
    examples: duplicates
  };
}

function exampleIdentity(row) {
  return {
    id: firstValue(row, ["id", "snapshot_id", "master_vessel_id", "port_call_id", "opportunity_id", "event_uid", "current_id"]),
    run_id: row.run_id || null,
    vessel: firstValue(row, ["vessel_name", "canonical_name", "normalized_name", "master_vessel_id", "vessel_id"]),
    port: firstValue(row, ["port_code", "port_name", "port"])
  };
}

function schemaIssues(schema, tableCounts) {
  const missingTables = ALL_TABLES
    .map(table => tableStatus(tableCounts, table))
    .filter(item => item && !item.exists)
    .map(item => ({ table: item.table, severity: "WARNING", error: item.error }));

  const issues = [];
  for (const check of REQUIRED_SCHEMA_CHECKS) {
    const liveTable = tableStatus(tableCounts, check.table);
    const ok = liveTable?.exists && check.test(schema);
    if (!ok) {
      issues.push({
        key: check.key,
        severity: check.severity,
        description: check.description,
        table: check.table,
        live_table_exists: Boolean(liveTable?.exists),
        sql: check.sql
      });
    }
  }

  return { missingTables, issues };
}

function tableStatus(tableCounts, table) {
  for (const rows of Object.values(tableCounts)) {
    const found = rows.find(item => item.table === table);
    if (found) return found;
  }
  return null;
}

async function latestSuccessfulRun(schema) {
  const dashboard = await fetchRows("dashboard_summary_snapshots", [
    "run_id",
    "record_count",
    "all_vessels_count",
    "total_vessels",
    "generated_at",
    "is_latest_successful"
  ], {
    filters: { is_latest_successful: "eq.true" },
    order: "generated_at.desc.nullslast",
    limit: 5,
    maxRows: 5
  });

  const run = await fetchRows("data_collection_runs", [
    "run_id",
    "status",
    "started_at",
    "finished_at",
    "promoted_at",
    "total_rows",
    "all_vessels_count",
    "normalized_rows"
  ], {
    filters: { status: "in.(completed,promoted,success)" },
    order: "finished_at.desc.nullslast",
    limit: 1,
    maxRows: 1
  });

  const active = await fetchRows("active_dataset_pointer", ["id", "active_run_id", "active_collected_at", "promoted_at"], { maxRows: 10 });
  const latestAnyRun = await fetchRows("data_collection_runs", ["run_id", "status", "started_at", "finished_at", "promoted_at"], {
    order: "finished_at.desc.nullslast",
    limit: 1,
    maxRows: 1
  });

  const latestDashboard = dashboard.rows[0] || null;
  const latestDataRun = run.rows[0] || null;
  const runId = latestDashboard?.run_id || latestDataRun?.run_id || null;
  const activeRunId = active.rows.find(row => row.id === "current")?.active_run_id || active.rows[0]?.active_run_id || null;

  const counts = {};
  for (const table of ["vessel_snapshots", "port_call_master", "opportunity_master", "port_summary_current", "sales_candidates_current"]) {
    counts[table] = runId ? await countRows(table, { run_id: `eq.${runId}` }) : { exists: false, row_count: 0, error: "missing_run_id" };
  }
  const dashboardForRun = runId
    ? await fetchRows("dashboard_summary_snapshots", [
      "run_id",
      "record_count",
      "all_vessels_count",
      "total_vessels",
      "generated_at",
      "is_latest_successful"
    ], {
      filters: { run_id: `eq.${runId}` },
      order: "generated_at.desc.nullslast",
      limit: 5,
      maxRows: 5
    })
    : { rows: [] };

  const warnings = [];
  const dashboardRecordCount = Number(dashboardForRun.rows[0]?.record_count ?? dashboardForRun.rows[0]?.total_vessels ?? dashboardForRun.rows[0]?.all_vessels_count ?? 0);
  const vesselCount = Number(counts.vessel_snapshots?.row_count || 0);
  if (runId && vesselCount === 0) warnings.push("CRITICAL latest successful run has zero vessel_snapshots records");
  if (runId && dashboardRecordCount && vesselCount && Math.abs(dashboardRecordCount - vesselCount) > Math.max(5, vesselCount * 0.05)) {
    warnings.push(`WARNING dashboard record_count (${dashboardRecordCount}) differs from vessel_snapshots count (${vesselCount})`);
  }
  if (activeRunId && runId && activeRunId !== runId) warnings.push(`WARNING active_run_id (${activeRunId}) differs from latest_successful_run_id (${runId})`);

  const portCheck = await comparePortSummary(runId, counts.port_summary_current?.row_count || 0, schema);
  warnings.push(...portCheck.warnings);

  return {
    latest_successful_run_id: runId,
    active_run_id: activeRunId,
    latest_run_id: latestAnyRun.rows[0]?.run_id || null,
    dashboard_latest_successful_rows: dashboard.rows.length,
    active_pointer_rows: active.rows.length,
    vessel_snapshots_count: counts.vessel_snapshots?.row_count || 0,
    port_call_master_count: counts.port_call_master?.row_count || 0,
    opportunity_master_count: counts.opportunity_master?.row_count || 0,
    port_summary_count: counts.port_summary_current?.row_count || 0,
    sales_candidates_count: counts.sales_candidates_current?.row_count || 0,
    dashboard_record_count: dashboardRecordCount,
    port_summary_compare: portCheck,
    warnings
  };
}

async function comparePortSummary(runId, portSummaryCount, schema) {
  if (!runId) return { grouped_vessel_ports: 0, port_summary_count: portSummaryCount, warnings: [] };
  if (!schema.hasColumn("vessel_snapshots", "port_code")) return { grouped_vessel_ports: null, port_summary_count: portSummaryCount, warnings: ["WARNING vessel_snapshots.port_code is unavailable for port summary comparison"] };
  const result = await fetchRows("vessel_snapshots", ["port_code", "port_name", "port"], {
    filters: { run_id: `eq.${runId}` },
    maxRows: MAX_ROWS
  });
  if (!result.ok) return { grouped_vessel_ports: null, port_summary_count: portSummaryCount, warnings: [`WARNING port summary comparison failed: ${result.error}`] };
  const grouped = new Set(result.rows.map(row => normalizeKey(firstValue(row, ["port_code", "port_name", "port"]) || "UNKNOWN")));
  const warnings = [];
  if (result.sampled) warnings.push("WARNING port summary comparison used a row sample due to audit cap");
  if (grouped.size && portSummaryCount && Math.abs(grouped.size - portSummaryCount) > Math.max(3, grouped.size * 0.5)) {
    warnings.push(`WARNING port_summary_current count (${portSummaryCount}) is far from grouped vessel ports (${grouped.size})`);
  }
  return { grouped_vessel_ports: grouped.size, port_summary_count: portSummaryCount, warnings };
}

async function orphanRecords(schema) {
  const runs = await fetchRows("data_collection_runs", ["run_id"], { maxRows: MAX_ROWS });
  const knownRunIds = new Set(runs.rows.map(row => clean(row.run_id)).filter(Boolean));
  const output = [];

  for (const table of RUN_CHILD_TABLES) {
    if (!schema.hasColumn(table, "run_id")) continue;
    const result = await fetchRows(table, ["run_id"], {
      filters: { run_id: "not.is.null" },
      maxRows: MAX_ROWS
    });
    if (!result.ok) {
      output.push({ table, type: "run_id_without_data_collection_runs", count: null, examples: [], error: result.error });
      continue;
    }
    const missing = [...new Set(result.rows.map(row => clean(row.run_id)).filter(Boolean))]
      .filter(runId => !knownRunIds.has(runId));
    output.push({
      table,
      type: "run_id_without_data_collection_runs",
      count: missing.length,
      examples: missing.slice(0, 5),
      sampled: result.sampled || runs.sampled
    });
  }

  const master = await fetchRows("vessel_master", ["master_vessel_id"], { maxRows: MAX_ROWS });
  const masterIds = new Set(master.rows.map(row => clean(row.master_vessel_id)).filter(Boolean));
  for (const table of ["risk_history", "opportunity_master", "sales_candidates_current"]) {
    const idColumn = schema.hasColumn(table, "master_vessel_id") ? "master_vessel_id" : schema.hasColumn(table, "vessel_id") ? "vessel_id" : null;
    if (!idColumn) continue;
    const result = await fetchRows(table, [idColumn], {
      filters: { [idColumn]: "not.is.null" },
      maxRows: MAX_ROWS
    });
    if (!result.ok) {
      output.push({ table, type: `${idColumn}_missing_from_vessel_master`, count: null, examples: [], error: result.error });
      continue;
    }
    const missing = [...new Set(result.rows.map(row => clean(row[idColumn])).filter(Boolean))]
      .filter(id => !masterIds.has(id));
    output.push({
      table,
      type: `${idColumn}_missing_from_vessel_master`,
      count: missing.length,
      examples: missing.slice(0, 5),
      sampled: result.sampled || master.sampled
    });
  }

  return output;
}

async function retentionStatus(tableCounts) {
  const now = Date.now();
  const oneHourAgo = new Date(now - 60 * 60 * 1000).toISOString();
  const fourteenDaysAgo = new Date(now - 14 * 24 * 60 * 60 * 1000).toISOString();
  const fortyEightHoursAgo = new Date(now - 48 * 60 * 60 * 1000).toISOString();
  const twoYearsAgo = new Date(now - 730 * 24 * 60 * 60 * 1000).toISOString();

  const runsCount = tableStatus(tableCounts, "data_collection_runs")?.row_count ?? null;
  const oldestRun = await fetchRows("data_collection_runs", ["run_id", "status", "started_at", "finished_at"], {
    order: "started_at.asc.nullslast",
    limit: 1,
    maxRows: 1
  });
  const newestRun = await fetchRows("data_collection_runs", ["run_id", "status", "started_at", "finished_at"], {
    order: "started_at.desc.nullslast",
    limit: 1,
    maxRows: 1
  });
  const failedRuns = await countRows("data_collection_runs", { status: "in.(failed,error)" });
  const staleSyncing = await countRows("data_collection_runs", { status: "in.(syncing,running,pending)", started_at: `lt.${oneHourAgo}` });
  const oldFailed = await countRows("data_collection_runs", { status: "in.(failed,error)", started_at: `lt.${fourteenDaysAgo}` });
  const oldPortSnapshots = await countRows("port_snapshot_daily", { created_at: `lt.${fortyEightHoursAgo}` });
  const oldVesselSnapshots = await countRows("vessel_snapshot_daily", { created_at: `lt.${twoYearsAgo}` });

  const largeTables = Object.values(tableCounts)
    .flat()
    .filter(item => Number(item.row_count || 0) >= 100000)
    .map(item => ({
      table: item.table,
      row_count: item.row_count,
      severity: Number(item.row_count || 0) >= 1000000 ? "CRITICAL" : "WARNING"
    }));

  return {
    runs_stored: runsCount,
    oldest_run: oldestRun.rows[0] || null,
    newest_run: newestRun.rows[0] || null,
    failed_run_count: failedRuns.row_count || 0,
    syncing_run_count_older_than_1h: staleSyncing.row_count || 0,
    failed_runs_older_than_14d: oldFailed.row_count || 0,
    port_snapshots_older_than_48h: oldPortSnapshots.row_count || 0,
    vessel_snapshots_older_than_24m: oldVesselSnapshots.row_count || 0,
    duplicate_static_snapshots: duplicateStaticSnapshots(),
    large_tables: largeTables,
    cleanup_candidates: [
      oldFailed.row_count ? `${oldFailed.row_count} failed/error runs older than 14 days` : null,
      oldPortSnapshots.row_count ? `${oldPortSnapshots.row_count} port_snapshot_daily rows older than 48 hours` : null,
      oldVesselSnapshots.row_count ? `${oldVesselSnapshots.row_count} vessel_snapshot_daily rows older than 24 months` : null
    ].filter(Boolean)
  };
}

function duplicateStaticSnapshots() {
  const payloads = STATIC_OUTPUTS.map(file => ({ file, data: readJson(file, null) })).filter(item => item.data);
  const runMap = new Map();
  for (const item of payloads) {
    const runId = extractRunId(item.data);
    if (!runId) continue;
    if (!runMap.has(runId)) runMap.set(runId, []);
    runMap.get(runId).push(item.file);
  }
  return [...runMap.entries()]
    .filter(([, files]) => files.length > 1)
    .map(([run_id, files]) => ({ run_id, files }));
}

async function dbVsJsonSync(latest) {
  const summary = readJson("dashboard/api/dashboard-summary.json", {});
  const status = readJson("dashboard/api/status.json", {});
  const top = readJson("dashboard/api/candidates/top.json", {});
  const outputs = STATIC_OUTPUTS.map(file => {
    const data = readJson(file, null);
    return {
      file,
      exists: Boolean(data),
      run_id: data ? extractRunId(data) : null,
      record_count: data ? extractRecordCount(data) : null
    };
  });
  const topRows = rowsFromPayload(top);
  const stale = outputs.filter(item =>
    item.exists &&
    latest.latest_successful_run_id &&
    item.run_id &&
    item.run_id !== latest.latest_successful_run_id
  );
  const jsonRecordCount = extractRecordCount(summary) || extractRecordCount(status);
  return {
    db_latest_run_id: latest.latest_successful_run_id,
    json_summary_run_id: extractRunId(summary) || extractRunId(status),
    db_record_count: latest.dashboard_record_count || latest.vessel_snapshots_count,
    json_record_count: jsonRecordCount,
    mismatch: Boolean(
      latest.latest_successful_run_id &&
      (extractRunId(summary) || extractRunId(status)) &&
      latest.latest_successful_run_id !== (extractRunId(summary) || extractRunId(status))
    ) || Boolean(jsonRecordCount && latest.dashboard_record_count && jsonRecordCount !== latest.dashboard_record_count),
    stale_json_warning: stale.length > 0,
    top_candidates_json_count: topRows.length,
    sales_candidates_current_count: latest.sales_candidates_count,
    outputs
  };
}

function extractRunId(data) {
  return clean(
    data?.run_id ||
    data?.active_run_id ||
    data?.status_run_id ||
    data?.latest_successful_run_id ||
    data?.metadata?.run_id ||
    data?.summary?.run_id
  ) || null;
}

function extractRecordCount(data) {
  const count = data?.record_count ?? data?.total_vessels ?? data?.all_vessels_count ?? data?.count;
  if (Number.isFinite(Number(count))) return Number(count);
  const rows = rowsFromPayload(data);
  return rows.length || null;
}

function healthScore({ schemaReport, duplicates, latest, orphans, retention, jsonSync }) {
  let schema = 25;
  let duplicate = 25;
  let run = 25;
  let retentionScore = 15;
  let json = 10;

  schema -= schemaReport.missingTables.length * 2;
  schema -= schemaReport.issues.filter(issue => issue.severity === "CRITICAL").length * 8;
  schema -= schemaReport.issues.filter(issue => issue.severity !== "CRITICAL").length * 3;

  const duplicateGroups = duplicates.flatMap(table => table.rules || []).reduce((sum, rule) => sum + rule.duplicate_group_count, 0);
  duplicate -= Math.min(25, duplicateGroups * 2);

  const orphanCount = orphans.reduce((sum, item) => sum + Number(item.count || 0), 0);
  if (orphanCount) run -= Math.min(10, orphanCount);
  if (latest.active_pointer_rows > 1) run -= 10;
  if (latest.latest_successful_run_id && latest.vessel_snapshots_count === 0) run -= 15;
  if (latest.warnings.some(item => item.startsWith("CRITICAL"))) run -= 10;
  if (latest.warnings.some(item => item.startsWith("WARNING"))) run -= 3;

  if (retention.syncing_run_count_older_than_1h) retentionScore -= 5;
  if (retention.port_snapshots_older_than_48h) retentionScore -= 4;
  if (retention.failed_runs_older_than_14d) retentionScore -= 3;
  if (retention.large_tables.length) retentionScore -= Math.min(5, retention.large_tables.length * 2);

  if (jsonSync.mismatch) json -= 5;
  if (jsonSync.stale_json_warning) json -= 3;

  const breakdown = {
    Schema: clamp(schema, 0, 25),
    Duplicates: clamp(duplicate, 0, 25),
    "Run consistency": clamp(run, 0, 25),
    Retention: clamp(retentionScore, 0, 15),
    "JSON sync": clamp(json, 0, 10)
  };
  const total = Object.values(breakdown).reduce((sum, value) => sum + value, 0);
  return { total, breakdown };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function printReport(report) {
  console.log("DB Optimization & Integrity Audit");
  console.log("=================================");
  console.log("");

  console.log("1. Summary");
  console.log(`DB Health Score: ${report.health.total}/100`);
  console.log("Breakdown:");
  for (const [name, value] of Object.entries(report.health.breakdown)) {
    const max = name === "Retention" ? 15 : name === "JSON sync" ? 10 : 25;
    console.log(`- ${name}: ${value}/${max}`);
  }
  console.log(`- latest_successful_run_id: ${report.latest.latest_successful_run_id || "unknown"}`);
  console.log(`- active_run_id: ${report.latest.active_run_id || "unknown"}`);
  console.log(`- audit row cap: ${MAX_ROWS.toLocaleString("en-US")} rows per table`);
  console.log("");

  console.log("2. Table counts");
  for (const [group, tables] of Object.entries(report.tableCounts)) {
    console.log(`\n${group}:`);
    for (const item of tables) {
      console.log(`- ${item.table}: exists=${item.exists ? "yes" : "no"}, row_count=${formatCount(item.row_count)}, estimated_size=${item.estimated_size}, latest_created_at=${item.latest_created_at || "unknown"}, latest_run_id=${item.latest_run_id || "unknown"}, linked_run_id_count=${item.linked_run_id_count ?? "n/a"}${item.linked_run_id_count_sampled ? " (sampled)" : ""}${item.error ? `, error=${item.error}` : ""}`);
    }
  }
  console.log("");

  console.log("3. Duplicate risks");
  for (const table of report.duplicates) {
    if (!table.ok) {
      console.log(`- WARNING ${table.table}: duplicate scan failed: ${table.error}`);
      continue;
    }
    console.log(`- ${table.table}: scanned=${formatCount(table.scanned_rows)}${table.sampled ? " (sampled)" : ""}`);
    for (const rule of table.rules) {
      const prefix = rule.duplicate_group_count ? "WARNING" : "OK";
      console.log(`  - ${prefix} ${rule.label}: groups=${rule.duplicate_group_count}, rows=${rule.duplicate_row_count}`);
      for (const example of rule.examples) {
        console.log(`    - key=${example.key}, count=${example.count}, examples=${JSON.stringify(example.examples)}`);
      }
    }
  }
  console.log("");

  console.log("4. Schema/index issues");
  if (!report.schemaReport.missingTables.length && !report.schemaReport.issues.length) {
    console.log("- OK no required schema/index issue found in repository schema and reachable tables.");
  }
  for (const item of report.schemaReport.missingTables) {
    console.log(`- WARNING missing table: ${item.table}${item.error ? ` (${item.error})` : ""}`);
  }
  for (const issue of report.schemaReport.issues) {
    console.log(`- ${issue.severity} ${issue.description}`);
    console.log(`  table=${issue.table}, live_table_exists=${issue.live_table_exists ? "yes" : "no"}`);
    console.log(`  suggested_sql=${issue.sql}`);
  }
  console.log("");

  console.log("5. Latest run consistency");
  console.log(`- run_id: ${report.latest.latest_successful_run_id || "unknown"}`);
  console.log(`- vessel_snapshots_count: ${formatCount(report.latest.vessel_snapshots_count)}`);
  console.log(`- port_call_master_count: ${formatCount(report.latest.port_call_master_count)}`);
  console.log(`- opportunity_master_count: ${formatCount(report.latest.opportunity_master_count)}`);
  console.log(`- port_summary_count: ${formatCount(report.latest.port_summary_count)}`);
  console.log(`- sales_candidates_count: ${formatCount(report.latest.sales_candidates_count)}`);
  console.log(`- dashboard_record_count: ${formatCount(report.latest.dashboard_record_count)}`);
  console.log(`- grouped_vessel_ports: ${report.latest.port_summary_compare.grouped_vessel_ports ?? "unknown"}`);
  for (const warning of report.latest.warnings) console.log(`- ${warning}`);
  if (!report.latest.warnings.length) console.log("- OK latest successful run consistency did not raise warnings.");
  console.log("");

  console.log("6. Orphan records");
  for (const orphan of report.orphans) {
    const severity = orphan.count ? "WARNING" : "OK";
    console.log(`- ${severity} ${orphan.table}.${orphan.type}: count=${orphan.count ?? "unknown"}${orphan.sampled ? " (sampled)" : ""}${orphan.error ? `, error=${orphan.error}` : ""}`);
    if (orphan.examples?.length) console.log(`  examples=${orphan.examples.join(", ")}`);
  }
  console.log("");

  console.log("7. Retention/storage efficiency");
  console.log(`- number of runs stored: ${formatCount(report.retention.runs_stored)}`);
  console.log(`- oldest run: ${JSON.stringify(report.retention.oldest_run || {})}`);
  console.log(`- newest run: ${JSON.stringify(report.retention.newest_run || {})}`);
  console.log(`- failed run count: ${formatCount(report.retention.failed_run_count)}`);
  console.log(`- syncing run count older than 1 hour: ${formatCount(report.retention.syncing_run_count_older_than_1h)}`);
  console.log(`- port snapshots older than 48 hours: ${formatCount(report.retention.port_snapshots_older_than_48h)}`);
  console.log(`- vessel snapshots older than 24 months: ${formatCount(report.retention.vessel_snapshots_older_than_24m)}`);
  console.log(`- duplicate static snapshots: ${JSON.stringify(report.retention.duplicate_static_snapshots)}`);
  for (const table of report.retention.large_tables) {
    console.log(`- ${table.severity} large table: ${table.table} rows=${formatCount(table.row_count)}`);
  }
  console.log("Recommended cleanup actions:");
  if (!report.retention.cleanup_candidates.length) console.log("- No immediate cleanup candidate found.");
  for (const action of report.retention.cleanup_candidates) console.log(`- ${action}`);
  console.log("");

  console.log("8. DB vs JSON sync");
  console.log(`- DB latest run_id: ${report.jsonSync.db_latest_run_id || "unknown"}`);
  console.log(`- JSON run_id: ${report.jsonSync.json_summary_run_id || "unknown"}`);
  console.log(`- DB record count: ${formatCount(report.jsonSync.db_record_count)}`);
  console.log(`- JSON record count: ${formatCount(report.jsonSync.json_record_count)}`);
  console.log(`- mismatch: ${report.jsonSync.mismatch ? "yes" : "no"}`);
  console.log(`- stale JSON warning: ${report.jsonSync.stale_json_warning ? "yes" : "no"}`);
  console.log(`- candidates/top JSON count: ${formatCount(report.jsonSync.top_candidates_json_count)}`);
  console.log(`- sales_candidates_current count: ${formatCount(report.jsonSync.sales_candidates_current_count)}`);
  for (const output of report.jsonSync.outputs) {
    console.log(`  - ${output.file}: exists=${output.exists ? "yes" : "no"}, run_id=${output.run_id || "unknown"}, record_count=${output.record_count ?? "unknown"}`);
  }
  console.log("");

  console.log("9. Recommended actions");
  const actions = [];
  for (const issue of report.schemaReport.issues) actions.push(`${issue.severity} apply/review SQL: ${issue.sql}`);
  if (report.retention.cleanup_candidates.length) actions.push(...report.retention.cleanup_candidates.map(item => `Review cleanup candidate: ${item}`));
  if (report.jsonSync.mismatch) actions.push("Regenerate static JSON from latest successful DB run or explain JSON-only mode.");
  if (report.latest.warnings.length) actions.push(...report.latest.warnings.map(item => `Investigate: ${item}`));
  if (!actions.length) actions.push("No critical action required. Continue routine monitoring.");
  for (const action of actions) console.log(`- ${action}`);
}

async function assertConnection() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }
  const result = await countRows("data_collection_runs");
  if ([0, 401, 403].includes(result.status)) {
    throw new Error(`Cannot connect to Supabase: ${result.error || `status_${result.status}`}`);
  }
  return result;
}

async function main() {
  const localSchema = parseLocalSchema(readText("supabase/schema.sql"));
  await assertConnection();

  const tableCounts = await buildTableCounts(localSchema);
  const duplicates = await detectDuplicates(localSchema);
  const schemaReport = schemaIssues(localSchema, tableCounts);
  const latest = await latestSuccessfulRun(localSchema);
  const orphans = await orphanRecords(localSchema);
  const retention = await retentionStatus(tableCounts);
  const jsonSync = await dbVsJsonSync(latest);
  const health = healthScore({ schemaReport, duplicates, latest, orphans, retention, jsonSync });

  const report = { tableCounts, duplicates, schemaReport, latest, orphans, retention, jsonSync, health };
  printReport(report);

  const fatal = [];
  if (latest.active_pointer_rows > 1) fatal.push("more than one active dataset pointer exists");
  if (latest.active_run_id) {
    const activeRun = await countRows("data_collection_runs", { run_id: `eq.${latest.active_run_id}` });
    if (!activeRun.row_count) fatal.push(`active pointer references missing run: ${latest.active_run_id}`);
  }
  if (latest.latest_successful_run_id && latest.vessel_snapshots_count === 0) {
    fatal.push("latest successful run has zero vessel records");
  }

  if (fatal.length) {
    console.error("");
    console.error("Audit failed due to CI-fatal condition(s):");
    for (const item of fatal) console.error(`- ${item}`);
    process.exit(1);
  }
}

main().catch(error => {
  console.error("DB Optimization & Integrity Audit");
  console.error("=================================");
  console.error(`CRITICAL: ${error?.message || String(error)}`);
  process.exit(1);
});
