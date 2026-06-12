import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const API_ROOT = path.join(ROOT, "dashboard", "api");
const DOCS_ROOT = path.join(ROOT, "docs");
const STORAGE_REPORT_PATH = path.join(API_ROOT, "storage-efficiency-report.json");
const MARKDOWN_REPORT_PATH = path.join(DOCS_ROOT, "DB_CLEANUP_AUDIT.md");
const SQL_RECOMMENDATIONS_PATH = path.join(DOCS_ROOT, "DB_CLEANUP_SQL_RECOMMENDATIONS.sql");

const SUPABASE_URL = String(process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const PRODUCTION_MODE = String(process.env.VALIDATION_MODE || "").toLowerCase() === "production";
const REST_URL = SUPABASE_URL ? `${SUPABASE_URL}/rest/v1` : "";
const MAX_SAMPLE_ROWS = Number(process.env.DB_CLEANUP_AUDIT_MAX_ROWS || 3000);
const MAX_RUN_CANDIDATES = Number(process.env.DB_CLEANUP_AUDIT_MAX_RUN_CANDIDATES || 25);

const TABLE_GROUPS = {
  core_run_pointer: ["data_collection_runs", "active_dataset_pointer"],
  current_serving: ["sales_candidates_current", "immediate_targets_current", "port_summary_current"],
  core_vessel_data: ["vessel_master", "vessel_entities", "vessel_snapshots", "port_call_master", "opportunity_master"],
  history_scoring: ["vessel_events", "risk_history", "explainability_snapshots", "rule_evaluations", "feature_store", "feature_snapshots", "model_training_rows"],
  daily_aggregate: ["vessel_snapshot_daily", "port_snapshot_daily", "commercial_opportunity_daily", "route_snapshot_daily", "operator_snapshot_daily", "vessel_universe_audit"],
  port_congestion: ["port_congestion_snapshots", "port_daily_summary", "port_weekly_summary", "port_monthly_summary"],
  commercial_sales: ["commercial_leads", "operator_contact_history", "sales_pipeline", "quote_opportunities", "customer_memory"],
  enrichment_source_cache: ["enrichment_match_candidates", "imo_recovery_queue", "vessel_identity_candidates", "vessel_aliases", "pilot_schedule_events", "source_collection_logs"]
};

const KNOWN_TABLES = [...new Set(Object.values(TABLE_GROUPS).flat())];
const RUN_LEVEL_TABLES = [
  "vessel_snapshots",
  "port_call_master",
  "opportunity_master",
  "risk_history",
  "feature_snapshots",
  "explainability_snapshots",
  "rule_evaluations",
  "port_congestion_snapshots",
  "source_collection_logs"
];

const CURRENT_TABLES = ["sales_candidates_current", "immediate_targets_current", "port_summary_current"];
const NEVER_DELETE_TABLES = new Set(["active_dataset_pointer"]);
const LONG_TERM_TABLES = new Set([
  "vessel_master",
  "vessel_entities",
  "vessel_aliases",
  "commercial_leads",
  "operator_contact_history",
  "sales_pipeline",
  "quote_opportunities",
  "customer_memory",
  "vessel_events",
  "vessel_snapshot_daily",
  "port_snapshot_daily",
  "commercial_opportunity_daily",
  "route_snapshot_daily",
  "operator_snapshot_daily",
  "port_daily_summary",
  "port_weekly_summary",
  "port_monthly_summary"
]);
const MEDIUM_TERM_TABLES = new Set(["risk_history", "feature_store", "feature_snapshots", "explainability_snapshots", "rule_evaluations", "model_training_rows", "pilot_schedule_events"]);
const SHORT_TERM_TABLES = new Set(["source_collection_logs", "port_congestion_snapshots", "enrichment_match_candidates", "imo_recovery_queue", "vessel_identity_candidates"]);

const DATE_COLUMNS = ["created_at", "updated_at", "started_at", "finished_at", "generated_at", "observed_at", "collected_at", "resolved_at"];
const RUN_ID_COLUMNS = ["run_id", "active_run_id", "latest_successful_run_id"];

function nowIso() {
  return new Date().toISOString();
}

function daysAgo(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function writeJson(filePath, payload) {
  ensureDir(filePath);
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));
}

function writeText(filePath, text) {
  ensureDir(filePath);
  fs.writeFileSync(filePath, text);
}

function readJson(relativePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), "utf8"));
  } catch {
    return fallback;
  }
}

function parseContentRange(value) {
  const text = String(value || "");
  const match = text.match(/\/(\d+)$/);
  return match ? Number(match[1]) : null;
}

function clean(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function numberOrNull(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeStatus(value) {
  return clean(value).toLowerCase();
}

function tableGroup(table) {
  for (const [group, tables] of Object.entries(TABLE_GROUPS)) {
    if (tables.includes(table)) return group;
  }
  return "unknown";
}

function cleanupRiskLevel(table) {
  if (NEVER_DELETE_TABLES.has(table)) return "NEVER_DELETE";
  if (LONG_TERM_TABLES.has(table)) return "RETAIN_LONG_TERM";
  if (MEDIUM_TERM_TABLES.has(table)) return "RETAIN_MEDIUM_TERM";
  if (SHORT_TERM_TABLES.has(table)) return "RETAIN_SHORT_TERM";
  if (RUN_LEVEL_TABLES.includes(table)) return "SAFE_CLEANUP_CANDIDATE";
  return "NEEDS_MANUAL_REVIEW";
}

function urlFor(table, params = {}) {
  const url = new URL(`${REST_URL}/${table}`);
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    if (Array.isArray(value)) {
      for (const item of value) url.searchParams.append(key, item);
    } else {
      url.searchParams.append(key, value);
    }
  }
  return url.toString();
}

function errorText(body, fallback) {
  if (body && typeof body === "object") {
    return body.message || body.details || body.hint || body.code || JSON.stringify(body);
  }
  return clean(fallback) || "unknown_error";
}

async function rest(table, params = {}, options = {}) {
  if (!REST_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return { ok: false, status: 0, body: null, rows: [], count: null, error: "missing_supabase_env" };
  }
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

async function countRows(table, filters = {}) {
  const result = await rest(table, { select: "*", ...filters }, {
    headers: { prefer: "count=exact", range: "0-0" }
  });
  return {
    table,
    exists: result.ok,
    row_count: result.ok ? (result.count ?? result.rows.length) : null,
    error: result.error,
    status: result.status
  };
}

async function fetchRows(table, selectColumns = ["*"], options = {}) {
  const select = Array.isArray(selectColumns) ? selectColumns.join(",") : selectColumns;
  const result = await rest(table, {
    select,
    ...(options.filters || {}),
    ...(options.order ? { order: options.order } : {}),
    ...(options.limit ? { limit: String(options.limit) } : {})
  }, {
    headers: {
      prefer: "count=exact",
      range: `0-${Math.max(0, Math.min(options.maxRows || MAX_SAMPLE_ROWS, MAX_SAMPLE_ROWS) - 1)}`
    }
  });
  return {
    ...result,
    sampled: result.ok && result.count !== null && result.rows.length < result.count
  };
}

async function columnExists(table, column) {
  const result = await rest(table, { select: column, limit: "1" }, { headers: { range: "0-0" } });
  return result.ok;
}

async function firstExistingColumn(table, columns) {
  for (const column of columns) {
    if (await columnExists(table, column)) return column;
  }
  return null;
}

async function orderedValue(table, column, direction) {
  if (!column) return null;
  const result = await fetchRows(table, [column, "run_id"].includes(column) ? [column] : [column], {
    order: `${column}.${direction}.nullslast`,
    limit: 1,
    maxRows: 1
  });
  if (!result.ok) return null;
  return result.rows[0]?.[column] || null;
}

async function distinctColumnValues(table, column, maxRows = MAX_SAMPLE_ROWS) {
  if (!column) return { values: [], sampled: false, ok: false, error: "missing_column" };
  const result = await fetchRows(table, [column], {
    filters: { [column]: "not.is.null" },
    maxRows
  });
  if (!result.ok) return { values: [], sampled: false, ok: false, error: result.error };
  return {
    values: [...new Set(result.rows.map(row => clean(row[column])).filter(Boolean))],
    sampled: result.sampled,
    ok: true
  };
}

function buildUnavailableReport(message) {
  const generatedAt = nowIso();
  const payload = {
    schema_version: "1.0",
    generated_at: generatedAt,
    db_health_score: PRODUCTION_MODE ? 0 : 75,
    status: "not_configured",
    summary: {
      total_tables_checked: KNOWN_TABLES.length,
      total_rows_estimated: 0,
      cleanup_candidate_tables: 0,
      protected_tables: 0,
      critical_issues: PRODUCTION_MODE ? 1 : 0,
      warnings: 1
    },
    table_inventory: KNOWN_TABLES.map(table => ({
      table_name: table,
      exists: null,
      row_count: null,
      estimated_size: null,
      cleanup_risk_level: cleanupRiskLevel(table),
      note: "Supabase credentials are unavailable in this environment."
    })),
    cleanup_candidates: [],
    duplicate_findings: [],
    orphan_findings: [],
    retention_recommendations: defaultRetentionRecommendations(),
    index_recommendations: defaultIndexRecommendations(),
    manual_review_required: [{
      severity: PRODUCTION_MODE ? "CRITICAL" : "WARNING",
      issue: "missing_supabase_env",
      message
    }]
  };
  return payload;
}

function defaultRetentionRecommendations() {
  return [
    { table_group: "active_dataset_pointer", recommendation: "keep always", reason: "Current live dataset pointer." },
    { table_group: "latest_successful_run", recommendation: "keep always", reason: "Required for rollback and serving continuity." },
    { table_group: "completed_detailed_runs", recommendation: "keep recent 20 detailed runs", reason: "Balance rollback depth with storage growth." },
    { table_group: "failed_syncing_runs", recommendation: "keep 7-14 days", reason: "Enough time for debugging without indefinite growth." },
    { table_group: "vessel_master", recommendation: "retain long term", reason: "Canonical identity and enrichment memory." },
    { table_group: "commercial_sales_history", recommendation: "retain long term", reason: "Private commercial memory and won/lost/quote/contact history." },
    { table_group: "source_collection_logs", recommendation: "keep detailed logs 30-60 days, aggregate older logs", reason: "Diagnostics can grow quickly." }
  ];
}

function defaultIndexRecommendations() {
  return [
    { table: "vessel_snapshots", columns: ["run_id", "master_vessel_id"], reason: "Prevent duplicate run-level vessel rows and speed active dataset reads." },
    { table: "sales_candidates_current", columns: ["run_id", "rank"], reason: "Current target ordering should be unique per run." },
    { table: "immediate_targets_current", columns: ["run_id", "rank"], reason: "Immediate target ordering should be unique per run." },
    { table: "port_summary_current", columns: ["run_id", "port_code"], reason: "One current summary per port per run." },
    { table: "imo_recovery_queue", columns: ["run_id", "call_sign", "vessel_name"], reason: "Reduce repeated pending recovery candidates." },
    { table: "vessel_master", columns: ["imo"], reason: "Canonical IMO lookup; use partial unique index where IMO is not null." },
    { table: "vessel_master", columns: ["mmsi"], reason: "Canonical MMSI lookup; use partial unique index where MMSI is not null." }
  ];
}

async function runContext() {
  const active = await fetchRows("active_dataset_pointer", ["*"], { limit: 10, maxRows: 10 });
  const activeRows = active.ok ? active.rows : [];
  const activeRow = activeRows.find(row => row.id === "current") || activeRows[0] || null;
  const activeRunId = activeRow?.active_run_id || activeRow?.run_id || null;
  const latestSuccessful = await fetchRows("data_collection_runs", ["run_id", "status", "started_at", "finished_at", "promoted_at", "total_rows", "all_vessels_count", "normalized_rows", "target_vessels_count"], {
    filters: { status: "in.(completed,promoted,success)" },
    order: "finished_at.desc.nullslast",
    limit: 1,
    maxRows: 1
  });
  const latestAny = await fetchRows("data_collection_runs", ["run_id", "status", "started_at", "finished_at", "promoted_at"], {
    order: "finished_at.desc.nullslast",
    limit: 1,
    maxRows: 1
  });
  const latestSuccessfulRunId = latestSuccessful.rows[0]?.run_id || null;
  const protectedRunIds = [...new Set([activeRunId, latestSuccessfulRunId].filter(Boolean))];
  return {
    active_pointer_rows: activeRows.length,
    active_pointer_error: active.error,
    active_run_id: activeRunId,
    active_pointer: activeRow,
    latest_successful_run_id: latestSuccessfulRunId,
    latest_successful_run: latestSuccessful.rows[0] || null,
    latest_run_id: latestAny.rows[0]?.run_id || null,
    protected_run_ids: protectedRunIds
  };
}

async function tableInventory(context) {
  const output = [];
  for (const table of KNOWN_TABLES) {
    const count = await countRows(table);
    const row = {
      table_name: table,
      group: tableGroup(table),
      exists: count.exists,
      row_count: count.row_count,
      estimated_size: null,
      oldest_created_at: null,
      newest_created_at: null,
      oldest_run_id: null,
      newest_run_id: null,
      run_id_count: null,
      latest_run_row_count: null,
      active_run_row_count: null,
      cleanup_risk_level: cleanupRiskLevel(table),
      protection_status: "not_protected",
      error: count.exists ? null : count.error
    };
    if (!count.exists) {
      output.push(row);
      continue;
    }
    const dateColumn = await firstExistingColumn(table, DATE_COLUMNS);
    const runColumn = await firstExistingColumn(table, ["run_id"]);
    row.date_column = dateColumn;
    row.run_id_column = runColumn;
    row.oldest_created_at = await orderedValue(table, dateColumn, "asc");
    row.newest_created_at = await orderedValue(table, dateColumn, "desc");
    if (runColumn) {
      const runValues = await distinctColumnValues(table, runColumn);
      row.run_id_count = runValues.values.length;
      row.run_id_count_sampled = runValues.sampled;
      row.oldest_run_id = runValues.values[0] || null;
      row.newest_run_id = runValues.values[runValues.values.length - 1] || null;
      row.latest_run_row_count = context.latest_successful_run_id ? (await countRows(table, { [runColumn]: `eq.${context.latest_successful_run_id}` })).row_count : null;
      row.active_run_row_count = context.active_run_id ? (await countRows(table, { [runColumn]: `eq.${context.active_run_id}` })).row_count : null;
    }
    if (NEVER_DELETE_TABLES.has(table)) row.protection_status = "BLOCKED_BY_PROTECTION_RULE";
    if (["vessel_master", "commercial_leads", "operator_contact_history", "sales_pipeline", "quote_opportunities", "customer_memory"].includes(table)) {
      row.protection_status = "BLOCKED_BY_PROTECTION_RULE";
    }
    output.push(row);
  }
  return output;
}

async function runLevelCleanup(context) {
  const runsResult = await fetchRows("data_collection_runs", ["run_id", "status", "started_at", "finished_at", "promoted_at", "total_rows", "all_vessels_count"], {
    order: "finished_at.desc.nullslast",
    maxRows: 500
  });
  if (!runsResult.ok) return { summary: {}, cleanup_candidates: [], error: runsResult.error };
  const runs = runsResult.rows;
  const protectedRunIds = new Set(context.protected_run_ids);
  const completed = runs.filter(row => ["completed", "promoted", "success"].includes(normalizeStatus(row.status)));
  const failed = runs.filter(row => ["failed", "error"].includes(normalizeStatus(row.status)));
  const syncing = runs.filter(row => ["syncing", "running", "pending"].includes(normalizeStatus(row.status)));
  const oneHourAgo = Date.now() - 60 * 60 * 1000;
  const fourteenDaysAgo = Date.now() - 14 * 24 * 60 * 60 * 1000;
  const recentCompletedKeep = new Set(completed.slice(0, 20).map(row => clean(row.run_id)));
  const candidates = [];
  for (const row of runs) {
    const runId = clean(row.run_id);
    const status = normalizeStatus(row.status);
    const time = Date.parse(row.finished_at || row.started_at || row.promoted_at || "");
    const ageDays = Number.isFinite(time) ? Math.round(((Date.now() - time) / (24 * 60 * 60 * 1000)) * 10) / 10 : null;
    let reason = "";
    if (["failed", "error"].includes(status) && Number.isFinite(time) && time < fourteenDaysAgo) reason = "failed run older than 14 days";
    if (["syncing", "running", "pending"].includes(status) && Number.isFinite(time) && time < oneHourAgo) reason = "syncing/running/pending run older than 1 hour";
    if (["completed", "promoted", "success"].includes(status) && !recentCompletedKeep.has(runId) && !protectedRunIds.has(runId)) reason = "completed run outside recent 20 detailed runs";
    if (!reason) continue;
    const protectedRun = protectedRunIds.has(runId);
    const rowCountsByTable = {};
    for (const table of RUN_LEVEL_TABLES) {
      rowCountsByTable[table] = (await countRows(table, { run_id: `eq.${runId}` })).row_count;
    }
    candidates.push({
      run_id: runId,
      status,
      age_days: ageDays,
      row_counts_by_table: rowCountsByTable,
      reason,
      protected: protectedRun,
      cleanup_safety: protectedRun ? "BLOCKED_BY_PROTECTION_RULE" : "SAFE_CLEANUP_CANDIDATE"
    });
    if (candidates.length >= MAX_RUN_CANDIDATES) break;
  }
  return {
    summary: {
      total_runs: runs.length,
      completed_runs: completed.length,
      failed_runs: failed.length,
      syncing_runs: syncing.length,
      syncing_runs_older_than_1h: syncing.filter(row => Date.parse(row.started_at || row.finished_at || "") < oneHourAgo).length,
      failed_runs_older_than_14d: failed.filter(row => Date.parse(row.started_at || row.finished_at || "") < fourteenDaysAgo).length,
      completed_runs_older_than_retention_window: candidates.filter(row => row.reason.includes("completed run")).length,
      latest_successful_run: context.latest_successful_run_id,
      active_run: context.active_run_id
    },
    cleanup_candidates: candidates,
    sampled: runsResult.sampled
  };
}

async function duplicateAudit() {
  const specs = [
    ["vessel_master", ["imo"], "duplicate IMO"],
    ["vessel_master", ["mmsi"], "duplicate MMSI"],
    ["vessel_master", ["call_sign", "normalized_vessel_name"], "duplicate call_sign + normalized_vessel_name"],
    ["vessel_master", ["normalized_vessel_name", "vessel_type", "gt"], "duplicate normalized_vessel_name + vessel_type + gt"],
    ["vessel_snapshots", ["run_id", "vessel_id"], "duplicate run_id + vessel_id"],
    ["vessel_snapshots", ["run_id", "call_sign", "vessel_name"], "duplicate run_id + call_sign + vessel_name"],
    ["vessel_snapshots", ["run_id", "normalized_vessel_name", "current_port"], "duplicate run_id + normalized_vessel_name + current_port"],
    ["port_call_master", ["run_id", "vessel_id", "port_code", "ata"], "duplicate run_id + vessel + port + ata"],
    ["port_call_master", ["call_sign", "port_code", "ata"], "duplicate call_sign + port + time"],
    ["opportunity_master", ["run_id", "vessel_id"], "duplicate run_id + vessel_id"],
    ["opportunity_master", ["run_id", "call_sign", "vessel_name"], "duplicate run_id + call_sign + vessel_name"],
    ["sales_candidates_current", ["vessel_id"], "duplicate vessel_id"],
    ["sales_candidates_current", ["call_sign", "vessel_name"], "duplicate call_sign + vessel_name"],
    ["sales_candidates_current", ["rank"], "duplicate rank"],
    ["immediate_targets_current", ["rank"], "duplicate rank"],
    ["port_summary_current", ["display_name"], "duplicate port display names"],
    ["vessel_identity_candidates", ["candidate_key"], "duplicate identity candidate keys"],
    ["imo_recovery_queue", ["call_sign", "vessel_name", "status"], "duplicate recovery queue rows"],
    ["vessel_aliases", ["alias", "vessel_id"], "duplicate vessel aliases"]
  ];
  const findings = [];
  for (const [table, columns, label] of specs) {
    const rowsResult = await fetchRows(table, columns, { maxRows: MAX_SAMPLE_ROWS });
    if (!rowsResult.ok) {
      findings.push({ table, check: label, duplicate_count: null, examples: [], error: rowsResult.error, cleanup_safety: "NEEDS_MANUAL_REVIEW" });
      continue;
    }
    const map = new Map();
    for (const row of rowsResult.rows) {
      const values = columns.map(column => clean(row[column]));
      if (values.some(value => !value || value === "-")) continue;
      const key = values.join("|");
      if (!map.has(key)) map.set(key, { key, values: Object.fromEntries(columns.map((column, index) => [column, values[index]])), count: 0 });
      map.get(key).count += 1;
    }
    const duplicates = [...map.values()].filter(item => item.count > 1).sort((a, b) => b.count - a.count);
    findings.push({
      table,
      check: label,
      columns,
      duplicate_count: duplicates.reduce((sum, item) => sum + item.count - 1, 0),
      duplicate_key_count: duplicates.length,
      examples: duplicates.slice(0, 20),
      sampled: rowsResult.sampled,
      recommended_unique_index: columns,
      cleanup_safety: duplicates.length ? "NEEDS_MANUAL_REVIEW" : "OK"
    });
  }
  return findings;
}

async function orphanAudit(context) {
  const findings = [];
  const runs = await fetchRows("data_collection_runs", ["run_id"], { maxRows: MAX_SAMPLE_ROWS });
  const knownRunIds = new Set(runs.rows.map(row => clean(row.run_id)).filter(Boolean));
  for (const table of [...RUN_LEVEL_TABLES, ...CURRENT_TABLES]) {
    if (!(await columnExists(table, "run_id"))) continue;
    const rowsResult = await fetchRows(table, ["run_id"], { filters: { run_id: "not.is.null" }, maxRows: MAX_SAMPLE_ROWS });
    if (!rowsResult.ok) {
      findings.push({ table, type: "run_id_missing_from_data_collection_runs", orphan_count: null, examples: [], error: rowsResult.error, severity: "MANUAL_REVIEW" });
      continue;
    }
    const missing = [...new Set(rowsResult.rows.map(row => clean(row.run_id)).filter(Boolean))].filter(runId => !knownRunIds.has(runId));
    findings.push({
      table,
      type: "run_id_missing_from_data_collection_runs",
      orphan_count: missing.length,
      examples: missing.slice(0, 20),
      sampled: rowsResult.sampled || runs.sampled,
      severity: missing.length ? "WARNING" : "OK",
      cleanup_recommendation: missing.length ? "Review orphan run rows before cleanup; do not delete protected active/latest runs." : "No orphan run ids detected in sample."
    });
  }

  const activeMissing = context.active_run_id && !knownRunIds.has(context.active_run_id);
  findings.push({
    table: "active_dataset_pointer",
    type: "active_run_id_missing_from_data_collection_runs",
    orphan_count: activeMissing ? 1 : 0,
    examples: activeMissing ? [context.active_run_id] : [],
    severity: activeMissing ? "CRITICAL" : "OK",
    cleanup_recommendation: activeMissing ? "Do not cleanup automatically. Repair active_dataset_pointer or restore matching run." : "Active pointer run is known."
  });

  const masterIdColumn = await firstExistingColumn("vessel_master", ["master_vessel_id", "vessel_id", "id"]);
  if (masterIdColumn) {
    const masterRows = await fetchRows("vessel_master", [masterIdColumn], { filters: { [masterIdColumn]: "not.is.null" }, maxRows: MAX_SAMPLE_ROWS });
    const masterIds = new Set(masterRows.rows.map(row => clean(row[masterIdColumn])).filter(Boolean));
    for (const table of ["opportunity_master", "risk_history", "sales_candidates_current"]) {
      const idColumn = await firstExistingColumn(table, ["master_vessel_id", "vessel_id"]);
      if (!idColumn) continue;
      const childRows = await fetchRows(table, [idColumn], { filters: { [idColumn]: "not.is.null" }, maxRows: MAX_SAMPLE_ROWS });
      if (!childRows.ok) continue;
      const missing = [...new Set(childRows.rows.map(row => clean(row[idColumn])).filter(Boolean))].filter(id => !masterIds.has(id));
      findings.push({
        table,
        type: `${idColumn}_missing_from_vessel_master`,
        orphan_count: missing.length,
        examples: missing.slice(0, 20),
        sampled: childRows.sampled || masterRows.sampled,
        severity: missing.length ? "WARNING" : "OK",
        cleanup_recommendation: missing.length ? "Review identity mapping before cleanup; child commercial/risk rows may need remap." : "No missing master vessel references detected in sample."
      });
    }
  }
  return findings;
}

async function currentTableConsistency(context) {
  const findings = [];
  const allowedRunIds = new Set([context.active_run_id, context.latest_successful_run_id].filter(Boolean));
  for (const table of CURRENT_TABLES) {
    const count = await countRows(table);
    if (!count.exists) {
      findings.push({ table, status: "MISSING", severity: "WARNING", message: count.error });
      continue;
    }
    const runColumn = await firstExistingColumn(table, ["run_id"]);
    const rankColumn = await firstExistingColumn(table, ["rank"]);
    const portColumn = table === "port_summary_current" ? await firstExistingColumn(table, ["display_name", "port_name", "port_code"]) : null;
    const identityColumns = table === "port_summary_current" ? [] : ["vessel_id", "call_sign", "vessel_name"];
    const issues = [];
    let runIds = [];
    if (runColumn) {
      const runValues = await distinctColumnValues(table, runColumn);
      runIds = runValues.values;
      const stale = runIds.filter(runId => allowedRunIds.size && !allowedRunIds.has(runId));
      if (runIds.length > 1) issues.push(`rows from multiple run_id values: ${runIds.slice(0, 5).join(",")}`);
      if (stale.length) issues.push(`run_id not active/latest: ${stale.slice(0, 5).join(",")}`);
    }
    if (rankColumn) {
      const dupRank = await duplicateForColumns(table, [rankColumn]);
      if (dupRank.duplicate_count > 0) issues.push(`duplicate rank count ${dupRank.duplicate_count}`);
    }
    if (portColumn) {
      const dupPort = await duplicateForColumns(table, [portColumn]);
      if (dupPort.duplicate_count > 0) issues.push(`duplicate port display count ${dupPort.duplicate_count}`);
    }
    const idColumns = [];
    for (const column of identityColumns) {
      if (await columnExists(table, column)) idColumns.push(column);
    }
    if (idColumns.length >= 2) {
      const dupIdentity = await duplicateForColumns(table, idColumns.slice(-2));
      if (dupIdentity.duplicate_count > 0) issues.push(`duplicate identity count ${dupIdentity.duplicate_count}`);
    }
    findings.push({
      table,
      row_count: count.row_count,
      run_ids: runIds,
      severity: issues.length ? (runIds.length > 1 ? "CRITICAL" : "WARNING") : "OK",
      issues
    });
  }
  return findings;
}

async function duplicateForColumns(table, columns) {
  const result = await fetchRows(table, columns, { maxRows: MAX_SAMPLE_ROWS });
  if (!result.ok) return { duplicate_count: 0, examples: [], error: result.error };
  const map = new Map();
  for (const row of result.rows) {
    const values = columns.map(column => clean(row[column]));
    if (values.some(value => !value)) continue;
    const key = values.join("|");
    map.set(key, (map.get(key) || 0) + 1);
  }
  const duplicates = [...map.entries()].filter(([, count]) => count > 1);
  return {
    duplicate_count: duplicates.reduce((sum, [, count]) => sum + count - 1, 0),
    examples: duplicates.slice(0, 20).map(([key, count]) => ({ key, count }))
  };
}

async function compactionOpportunities() {
  const aggregateTargets = {
    vessel_snapshots: "vessel_snapshot_daily",
    port_call_master: "port_daily_summary",
    opportunity_master: "commercial_opportunity_daily",
    risk_history: "commercial_opportunity_daily",
    feature_snapshots: "vessel_snapshot_daily",
    explainability_snapshots: "commercial_opportunity_daily",
    port_congestion_snapshots: "port_daily_summary"
  };
  const output = [];
  for (const [detailTable, aggregateTable] of Object.entries(aggregateTargets)) {
    const detailCount = await countRows(detailTable);
    const aggregateCount = await countRows(aggregateTable);
    const dateColumn = detailCount.exists ? await firstExistingColumn(detailTable, DATE_COLUMNS) : null;
    const older30 = dateColumn ? await countRows(detailTable, { [dateColumn]: `lt.${daysAgo(30)}` }) : { row_count: null };
    const older60 = dateColumn ? await countRows(detailTable, { [dateColumn]: `lt.${daysAgo(60)}` }) : { row_count: null };
    const older90 = dateColumn ? await countRows(detailTable, { [dateColumn]: `lt.${daysAgo(90)}` }) : { row_count: null };
    output.push({
      detail_table: detailTable,
      aggregate_target: aggregateTable,
      detail_exists: detailCount.exists,
      aggregate_exists: aggregateCount.exists,
      detailed_rows: detailCount.row_count,
      aggregate_rows: aggregateCount.row_count,
      detailed_rows_older_than_30d: older30.row_count,
      detailed_rows_older_than_60d: older60.row_count,
      detailed_rows_older_than_90d: older90.row_count,
      aggregate_coverage_exists: aggregateCount.exists && Number(aggregateCount.row_count || 0) > 0,
      safe_to_compact: detailCount.exists && aggregateCount.exists && Number(aggregateCount.row_count || 0) > 0 ? "MANUAL_REVIEW" : "NO",
      missing_aggregate_table: !aggregateCount.exists
    });
  }
  return output;
}

async function enrichmentQueueAudit() {
  const tables = ["imo_recovery_queue", "enrichment_match_candidates", "vessel_identity_candidates", "vessel_aliases"];
  const output = [];
  for (const table of tables) {
    const count = await countRows(table);
    if (!count.exists) {
      output.push({ table, exists: false, error: count.error });
      continue;
    }
    const statusColumn = await firstExistingColumn(table, ["status", "match_status", "review_status"]);
    const dateColumn = await firstExistingColumn(table, DATE_COLUMNS);
    const statusCounts = {};
    if (statusColumn) {
      const rows = await fetchRows(table, [statusColumn], { maxRows: MAX_SAMPLE_ROWS });
      for (const row of rows.rows) {
        const status = normalizeStatus(row[statusColumn]) || "unknown";
        statusCounts[status] = (statusCounts[status] || 0) + 1;
      }
    }
    const older30 = dateColumn ? await countRows(table, { [dateColumn]: `lt.${daysAgo(30)}` }) : { row_count: null };
    const duplicatePending = statusColumn
      ? await duplicateForColumns(table, [statusColumn, await firstExistingColumn(table, ["call_sign", "vessel_name", "candidate_key", "alias"])].filter(Boolean))
      : { duplicate_count: 0, examples: [] };
    output.push({
      table,
      exists: true,
      total_rows: count.row_count,
      pending_rows: statusCounts.pending || 0,
      resolved_rows: statusCounts.resolved || 0,
      applied_rows: statusCounts.applied || 0,
      failed_rows: statusCounts.failed || statusCounts.error || 0,
      needs_review_rows: statusCounts.needs_review || statusCounts.review || 0,
      duplicate_pending_candidates: duplicatePending.duplicate_count,
      pending_rows_older_than_30d: older30.row_count,
      rows_that_can_be_archived: (statusCounts.resolved || 0) + (statusCounts.applied || 0),
      recommendation: "Keep recent pending/needs_review rows; archive old resolved/applied rows; preserve manually reviewed records."
    });
  }
  return output;
}

async function sourceLogAudit() {
  const table = "source_collection_logs";
  const count = await countRows(table);
  if (!count.exists) return { exists: false, error: count.error };
  const sourceColumn = await firstExistingColumn(table, ["source_key", "source", "source_name"]);
  const dateColumn = await firstExistingColumn(table, DATE_COLUMNS);
  const sourceCounts = {};
  if (sourceColumn) {
    const rows = await fetchRows(table, [sourceColumn], { maxRows: MAX_SAMPLE_ROWS });
    for (const row of rows.rows) {
      const source = clean(row[sourceColumn]) || "unknown";
      sourceCounts[source] = (sourceCounts[source] || 0) + 1;
    }
  }
  const failedColumn = await firstExistingColumn(table, ["status", "result_status"]);
  const failedOld = failedColumn && dateColumn ? await countRows(table, { [failedColumn]: "in.(failed,error,FETCH_FAILED,PARSE_FAILED)", [dateColumn]: `lt.${daysAgo(30)}` }) : { row_count: null };
  const oldLogs = dateColumn ? await countRows(table, { [dateColumn]: `lt.${daysAgo(30)}` }) : { row_count: null };
  const duplicateLogs = sourceColumn ? await duplicateForColumns(table, ["run_id", sourceColumn].filter(Boolean)) : { duplicate_count: 0, examples: [] };
  return {
    exists: true,
    total_rows: count.row_count,
    rows_by_source_sample: sourceCounts,
    failed_source_logs_older_than_30d: failedOld.row_count,
    success_or_any_logs_older_than_30d: oldLogs.row_count,
    duplicate_logs_per_run_source_sample: duplicateLogs.duplicate_count,
    recommendation: "Keep recent 30-60 days of detailed logs; aggregate older logs into source_daily_health; never store secret URLs; truncate large response samples."
  };
}

async function staticJsonMismatchAudit(context) {
  const files = [
    "dashboard/api/bootstrap.json",
    "dashboard/api/status-summary.json",
    "dashboard/api/vessel-count-reconciliation.json",
    "dashboard/api/endpoint-manifest.json",
    "dashboard/api/vessels/index.json",
    "dashboard/api/sales/actions.json",
    "dashboard/api/targets/current.json"
  ];
  const dbCounts = {
    sales_candidates_current: (await countRows("sales_candidates_current")).row_count,
    immediate_targets_current: (await countRows("immediate_targets_current")).row_count,
    vessel_snapshots_active: context.active_run_id ? (await countRows("vessel_snapshots", { run_id: `eq.${context.active_run_id}` })).row_count : null,
    vessel_snapshots_latest_successful: context.latest_successful_run_id ? (await countRows("vessel_snapshots", { run_id: `eq.${context.latest_successful_run_id}` })).row_count : null
  };
  return files.map(file => {
    const payload = readJson(file, null);
    return {
      file,
      exists: Boolean(payload),
      db_active_run_id: context.active_run_id,
      db_latest_successful_run_id: context.latest_successful_run_id,
      json_run_id: payload?.run_id || payload?.snapshot_context?.run_id || null,
      json_generated_at: payload?.generated_at || null,
      json_record_count: numberOrNull(payload?.record_count ?? payload?.total_count ?? payload?.total_vessels),
      json_item_count: Array.isArray(payload?.items) ? payload.items.length : Array.isArray(payload?.endpoints) ? payload.endpoints.length : null,
      db_counts: dbCounts,
      stale_json_warning: payload?.snapshot_context?.run_id && context.active_run_id && payload.snapshot_context.run_id !== context.active_run_id
        ? "JSON run_id differs from active_run_id"
        : null
    };
  });
}

function protectedDataSummary(context) {
  return [
    { type: "active_dataset_pointer", identifier: context.active_run_id, protected: Boolean(context.active_run_id) },
    { type: "latest_successful_run", identifier: context.latest_successful_run_id, protected: Boolean(context.latest_successful_run_id) },
    { type: "vessel_master", identifier: "canonical identity rows", protected: true },
    { type: "commercial_sales_history", identifier: "commercial_leads/operator_contact_history/sales_pipeline/quote/customer_memory", protected: true },
    { type: "manual_reference_data", identifier: "verified source_csv/manual watchlist records", protected: true }
  ];
}

function criticalIssues(context, inventory, orphans, currentConsistency) {
  const issues = [];
  if (context.active_pointer_rows > 1) issues.push("More than one active_dataset_pointer row exists.");
  const activePointerMissing = orphans.find(item => item.table === "active_dataset_pointer" && item.type === "active_run_id_missing_from_data_collection_runs" && item.orphan_count > 0);
  if (activePointerMissing) issues.push("active_dataset_pointer references a missing run_id.");
  const latestVesselRows = inventory.find(item => item.table_name === "vessel_snapshots")?.latest_run_row_count;
  if (context.latest_successful_run_id && Number(latestVesselRows || 0) === 0) issues.push("Latest successful run has zero vessel_snapshots rows.");
  const currentCritical = currentConsistency.filter(item => item.severity === "CRITICAL");
  for (const item of currentCritical) issues.push(`${item.table}: ${item.issues.join("; ")}`);
  return issues;
}

function buildDbHealthScore({ criticalCount, warningCount }) {
  const score = 100 - criticalCount * 25 - warningCount * 2;
  return Math.max(criticalCount ? 0 : 40, Math.min(100, score));
}

function renderMarkdown(report) {
  const lines = [];
  lines.push("# Supabase DB Cleanup Audit");
  lines.push("");
  lines.push(`Generated at: ${report.generated_at}`);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(`- DB health score: ${report.db_health_score}`);
  lines.push(`- Tables checked: ${report.summary.total_tables_checked}`);
  lines.push(`- Estimated rows: ${report.summary.total_rows_estimated}`);
  lines.push(`- Cleanup candidate tables: ${report.summary.cleanup_candidate_tables}`);
  lines.push(`- Protected tables: ${report.summary.protected_tables}`);
  lines.push(`- Critical issues: ${report.summary.critical_issues}`);
  lines.push(`- Warnings: ${report.summary.warnings}`);
  lines.push("");
  lines.push("## Protected Data");
  lines.push("");
  for (const item of report.protected_data || []) lines.push(`- ${item.type}: ${item.identifier || "-"} (${item.protected ? "protected" : "missing"})`);
  lines.push("");
  lines.push("## Table Inventory");
  lines.push("");
  lines.push("| Table | Exists | Rows | Risk | Protection |");
  lines.push("| --- | --- | ---: | --- | --- |");
  for (const row of report.table_inventory) {
    lines.push(`| ${row.table_name} | ${row.exists === true ? "yes" : row.exists === false ? "no" : "unknown"} | ${row.row_count ?? "-"} | ${row.cleanup_risk_level} | ${row.protection_status || "-"} |`);
  }
  lines.push("");
  lines.push("## Cleanup Candidates");
  lines.push("");
  for (const item of report.cleanup_candidates) {
    if (item.run_id) lines.push(`- ${item.run_id}: ${item.reason} (${item.protected ? "protected" : "candidate"})`);
    else lines.push(`- ${item.table_name || item.table || "unknown"}: ${item.reason || item.cleanup_risk_level || "candidate"}`);
  }
  if (!report.cleanup_candidates.length) lines.push("- No cleanup candidates detected by read-only audit.");
  lines.push("");
  lines.push("## Duplicates");
  lines.push("");
  for (const item of report.duplicate_findings.filter(row => Number(row.duplicate_count || 0) > 0).slice(0, 30)) {
    lines.push(`- ${item.table}: ${item.check} -> ${item.duplicate_count} duplicates`);
  }
  if (!report.duplicate_findings.some(row => Number(row.duplicate_count || 0) > 0)) lines.push("- No duplicate findings in sampled rows.");
  lines.push("");
  lines.push("## Orphans");
  lines.push("");
  for (const item of report.orphan_findings.filter(row => Number(row.orphan_count || 0) > 0)) {
    lines.push(`- ${item.table}: ${item.type} -> ${item.orphan_count} (${item.severity})`);
  }
  if (!report.orphan_findings.some(row => Number(row.orphan_count || 0) > 0)) lines.push("- No orphan findings in sampled rows.");
  lines.push("");
  lines.push("## Retention Recommendations");
  lines.push("");
  for (const item of report.retention_recommendations) lines.push(`- ${item.table_group}: ${item.recommendation} - ${item.reason}`);
  lines.push("");
  lines.push("## Next Actions");
  lines.push("");
  for (const item of report.manual_review_required) lines.push(`- [${item.severity || "INFO"}] ${item.issue || item.message}`);
  if (!report.manual_review_required.length) lines.push("- Review SQL recommendations before applying any cleanup.");
  lines.push("");
  return lines.join("\n");
}

function renderSql(report) {
  const lines = [];
  lines.push("-- DB cleanup and storage optimization recommendations");
  lines.push("-- REVIEW BEFORE RUNNING. This file was generated by a read-only audit.");
  lines.push("-- No statements are executed automatically.");
  lines.push("");
  lines.push("-- Suggested indexes / unique constraints");
  for (const item of report.index_recommendations) {
    const columns = item.columns.join(", ");
    const indexName = `idx_${item.table}_${item.columns.join("_")}`.replace(/[^a-zA-Z0-9_]/g, "_").toLowerCase();
    lines.push(`-- ${item.reason}`);
    lines.push(`-- CREATE INDEX IF NOT EXISTS ${indexName} ON public.${item.table} (${columns});`);
  }
  lines.push("");
  lines.push("-- Suggested archival / cleanup queries");
  lines.push("-- Keep active/latest successful runs, current serving rows, vessel_master, and commercial history protected.");
  for (const item of report.cleanup_candidates.filter(candidate => candidate.run_id && !candidate.protected).slice(0, 30)) {
    for (const table of Object.keys(item.row_counts_by_table || {})) {
      lines.push(`-- REVIEW BEFORE RUNNING`);
      lines.push(`-- DELETE FROM public.${table}`);
      lines.push(`-- WHERE run_id = '${String(item.run_id).replace(/'/g, "''")}'; -- ${item.reason}`);
    }
  }
  lines.push("");
  lines.push("-- Source log retention example");
  lines.push("-- DELETE FROM public.source_collection_logs");
  lines.push("-- WHERE created_at < now() - interval '60 days'");
  lines.push("--   AND run_id NOT IN ('<active_run_id>', '<latest_successful_run_id>');");
  lines.push("");
  return lines.join("\n");
}

function printReport(report) {
  console.log("DB Cleanup Audit");
  console.log("================");
  console.log("");
  console.log("1. Summary");
  console.log(`OK db_health_score=${report.db_health_score}`);
  console.log(`INFO tables_checked=${report.summary.total_tables_checked}`);
  console.log(`INFO total_rows_estimated=${report.summary.total_rows_estimated}`);
  console.log(`INFO cleanup_candidate_tables=${report.summary.cleanup_candidate_tables}`);
  console.log(`INFO critical_issues=${report.summary.critical_issues}`);
  console.log(`INFO warnings=${report.summary.warnings}`);
  console.log("");
  console.log("2. Table inventory");
  for (const row of report.table_inventory) {
    const status = row.exists ? "OK" : "INFO";
    console.log(`${status} ${row.table_name} rows=${row.row_count ?? "-"} risk=${row.cleanup_risk_level}`);
  }
  console.log("");
  console.log("3. Protected data");
  for (const item of report.protected_data || []) console.log(`${item.protected ? "OK" : "WARNING"} ${item.type}: ${item.identifier || "-"}`);
  console.log("");
  console.log("4. Cleanup candidates");
  if (!report.cleanup_candidates.length) console.log("OK none");
  for (const item of report.cleanup_candidates.slice(0, 30)) console.log(`${item.protected ? "WARNING" : "INFO"} ${item.run_id || item.table_name || item.table}: ${item.reason || item.cleanup_risk_level}`);
  console.log("");
  console.log("5. Duplicates");
  for (const item of report.duplicate_findings.filter(row => Number(row.duplicate_count || 0) > 0).slice(0, 20)) console.log(`MANUAL_REVIEW ${item.table}: ${item.check} duplicates=${item.duplicate_count}`);
  if (!report.duplicate_findings.some(row => Number(row.duplicate_count || 0) > 0)) console.log("OK no sampled duplicates");
  console.log("");
  console.log("6. Orphans");
  for (const item of report.orphan_findings.filter(row => Number(row.orphan_count || 0) > 0)) console.log(`${item.severity} ${item.table}: ${item.type} count=${item.orphan_count}`);
  if (!report.orphan_findings.some(row => Number(row.orphan_count || 0) > 0)) console.log("OK no sampled orphans");
  console.log("");
  console.log("7. Current table consistency");
  for (const item of report.current_table_consistency || []) console.log(`${item.severity} ${item.table}: ${item.issues?.join("; ") || "ok"}`);
  console.log("");
  console.log("8. Retention recommendations");
  for (const item of report.retention_recommendations) console.log(`INFO ${item.table_group}: ${item.recommendation}`);
  console.log("");
  console.log("9. Index recommendations");
  for (const item of report.index_recommendations) console.log(`INFO ${item.table}(${item.columns.join(",")}): ${item.reason}`);
  console.log("");
  console.log("10. Next actions");
  if (!report.manual_review_required.length) console.log("OK Review docs/DB_CLEANUP_SQL_RECOMMENDATIONS.sql before any manual cleanup.");
  for (const item of report.manual_review_required) console.log(`${item.severity || "INFO"} ${item.issue || item.message}`);
}

async function main() {
  const generatedAt = nowIso();
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    const message = "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. DB cleanup audit skipped; no production data was changed.";
    const report = buildUnavailableReport(message);
    writeJson(STORAGE_REPORT_PATH, report);
    writeText(MARKDOWN_REPORT_PATH, renderMarkdown({ ...report, protected_data: [] }));
    writeText(SQL_RECOMMENDATIONS_PATH, renderSql(report));
    printReport({ ...report, protected_data: [], current_table_consistency: [] });
    console.log(`WARNING ${message}`);
    if (PRODUCTION_MODE) process.exitCode = 1;
    return;
  }

  const context = await runContext();
  const inventory = await tableInventory(context);
  const runCleanup = await runLevelCleanup(context);
  const duplicates = await duplicateAudit();
  const orphans = await orphanAudit(context);
  const currentConsistency = await currentTableConsistency(context);
  const compaction = await compactionOpportunities();
  const enrichment = await enrichmentQueueAudit();
  const sourceLogs = await sourceLogAudit();
  const jsonMismatch = await staticJsonMismatchAudit(context);
  const critical = criticalIssues(context, inventory, orphans, currentConsistency);

  const cleanupCandidateTables = inventory.filter(row => ["SAFE_CLEANUP_CANDIDATE", "RETAIN_SHORT_TERM"].includes(row.cleanup_risk_level)).length;
  const protectedTables = inventory.filter(row => row.protection_status === "BLOCKED_BY_PROTECTION_RULE" || row.cleanup_risk_level === "NEVER_DELETE").length;
  const duplicateWarnings = duplicates.filter(row => Number(row.duplicate_count || 0) > 0).length;
  const orphanWarnings = orphans.filter(row => Number(row.orphan_count || 0) > 0 && row.severity !== "CRITICAL").length;
  const currentWarnings = currentConsistency.filter(row => ["WARNING", "CRITICAL"].includes(row.severity)).length;
  const warnings = duplicateWarnings + orphanWarnings + currentWarnings + (runCleanup.cleanup_candidates?.length || 0);
  const totalRows = inventory.reduce((sum, row) => sum + Number(row.row_count || 0), 0);

  const cleanupCandidates = [
    ...(runCleanup.cleanup_candidates || []),
    ...inventory
      .filter(row => ["SAFE_CLEANUP_CANDIDATE", "RETAIN_SHORT_TERM"].includes(row.cleanup_risk_level) && Number(row.row_count || 0) > 0)
      .map(row => ({
        table_name: row.table_name,
        row_count: row.row_count,
        cleanup_risk_level: row.cleanup_risk_level,
        reason: row.cleanup_risk_level === "RETAIN_SHORT_TERM" ? "short-term operational/cache table" : "run-level detailed snapshot table",
        protected: row.protection_status === "BLOCKED_BY_PROTECTION_RULE"
      }))
  ];

  const manualReview = [
    ...critical.map(issue => ({ severity: "CRITICAL", issue })),
    ...duplicates.filter(row => Number(row.duplicate_count || 0) > 0).slice(0, 20).map(row => ({ severity: "MANUAL_REVIEW", issue: `${row.table}: ${row.check} duplicates=${row.duplicate_count}` })),
    ...orphans.filter(row => Number(row.orphan_count || 0) > 0).map(row => ({ severity: row.severity || "WARNING", issue: `${row.table}: ${row.type} count=${row.orphan_count}` })),
    ...currentConsistency.filter(row => ["WARNING", "CRITICAL"].includes(row.severity)).map(row => ({ severity: row.severity, issue: `${row.table}: ${row.issues.join("; ")}` }))
  ];

  const report = {
    schema_version: "1.0",
    generated_at: generatedAt,
    db_health_score: buildDbHealthScore({ criticalCount: critical.length, warningCount: warnings }),
    db_context: context,
    summary: {
      total_tables_checked: inventory.length,
      total_rows_estimated: totalRows,
      cleanup_candidate_tables: cleanupCandidateTables,
      protected_tables: protectedTables,
      critical_issues: critical.length,
      warnings
    },
    table_inventory: inventory,
    protected_data: protectedDataSummary(context),
    run_level_cleanup: runCleanup,
    cleanup_candidates: cleanupCandidates,
    duplicate_findings: duplicates,
    orphan_findings: orphans,
    current_table_consistency: currentConsistency,
    compaction_opportunities: compaction,
    enrichment_queue_cleanup: enrichment,
    source_log_cleanup: sourceLogs,
    static_json_db_mismatch: jsonMismatch,
    retention_recommendations: defaultRetentionRecommendations(),
    index_recommendations: defaultIndexRecommendations(),
    manual_review_required: manualReview
  };

  writeJson(STORAGE_REPORT_PATH, report);
  writeText(MARKDOWN_REPORT_PATH, renderMarkdown(report));
  writeText(SQL_RECOMMENDATIONS_PATH, renderSql(report));
  printReport(report);

  if (critical.length) process.exitCode = 1;
}

main().catch(error => {
  console.error(`CRITICAL DB cleanup audit failed: ${error?.message || String(error)}`);
  if (PRODUCTION_MODE) process.exitCode = 1;
});
