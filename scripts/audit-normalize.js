import fs from "fs";
import { normalizeRecordPort as normalizeSharedRecordPort } from "./lib/port-statistics.js";

const SUPABASE_URL = String(process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const REST_URL = SUPABASE_URL ? `${SUPABASE_URL}/rest/v1` : "";
const MAX_ROWS = positiveInt(process.env.AUDIT_NORMALIZE_MAX_ROWS, 25000);
const PAGE_SIZE = Math.min(1000, positiveInt(process.env.AUDIT_NORMALIZE_PAGE_SIZE, 1000));

const PORT_FIELDS = [
  "port_code",
  "port_name",
  "port",
  "port_name_ko",
  "current_port",
  "arrival_port",
  "prtAgCd",
  "prtAgNm",
  "portName",
  "port_nm",
  "destination_port"
];

const PORT_ALIASES = [
  { code: "BUSAN", name: "Busan", aliases: ["020", "BUSAN", "PUSAN", "KRPUS", "KR PUS", "부산", "부산항"] },
  { code: "ULSAN", name: "Ulsan", aliases: ["820", "ULSAN", "KRUSN", "KR USN", "울산", "울산항"] },
  { code: "YEOSU_GWANGYANG", name: "Yeosu/Gwangyang", aliases: ["620", "YEOSU", "GWANGYANG", "KRYOS", "KRKAN", "KR YOS", "KR KAN", "여수", "광양", "여수광양"] },
  { code: "INCHEON", name: "Incheon", aliases: ["030", "INCHEON", "KRICN", "KR ICN", "인천", "인천항"] },
  { code: "PYEONGTAEK_DANGJIN", name: "Pyeongtaek/Dangjin", aliases: ["031", "PYEONGTAEK", "PYONGTAEK", "DANGJIN", "KRPTK", "KRDJN", "KR PTK", "KR DJN", "평택", "당진", "평택당진"] },
  { code: "POHANG", name: "Pohang", aliases: ["810", "POHANG", "KRKPO", "KR KPO", "포항", "포항항"] },
  { code: "MASAN_CHANGWON", name: "Masan/Changwon", aliases: ["622", "MASAN", "CHANGWON", "JINHAE", "KRMAS", "KRCHF", "KR MAS", "KR CHF", "마산", "창원", "진해"] },
  { code: "MOKPO", name: "Mokpo", aliases: ["070", "MOKPO", "KRMOK", "KR MOK", "목포"] },
  { code: "GUNSAN", name: "Gunsan", aliases: ["080", "GUNSAN", "KRKUV", "KR KUV", "군산"] },
  { code: "DAESAN", name: "Daesan", aliases: ["621", "DAESAN", "KRTSN", "KR TSN", "대산"] },
  { code: "DONGHAE_MUKHO", name: "Donghae/Mukho", aliases: ["120", "DONGHAE", "MUKHO", "KRTGH", "KR TGH", "동해", "묵호"] },
  { code: "JEJU", name: "Jeju", aliases: ["940", "JEJU", "KRCJU", "KR CJU", "제주"] }
];

const PORT_ALIAS_LOOKUP = new Map();
for (const port of PORT_ALIASES) {
  for (const alias of port.aliases) PORT_ALIAS_LOOKUP.set(canonicalPortAlias(alias), port);
}

function positiveInt(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback;
}

function clean(value) {
  if (value === null || value === undefined) return "";
  return String(value).normalize("NFKC").trim();
}

function cleanUpper(value) {
  return clean(value).toUpperCase().replace(/\s+/g, " ");
}

function canonicalPortAlias(value) {
  return clean(value).toUpperCase().replace(/[\s._-]+/g, "");
}

function normalizeVesselName(value) {
  return cleanUpper(value)
    .replace(/^(M\/V|M\.V\.|MV|M T|M\/T|MT|S\/S|SS)\s+/, "")
    .replace(/[^A-Z0-9가-힣]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function firstValue(record, fields) {
  for (const field of fields) {
    if (typeof field === "function") {
      const value = field(record);
      if (clean(value)) return value;
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(record, field) && clean(record[field])) return record[field];
  }
  return "";
}

function normalizePortValue(value) {
  const raw = clean(value);
  if (!raw) return { port_code: null, port_name: "", status: "missing", raw: "" };
  const canonical = canonicalPortAlias(raw);
  const numeric = /^\d{1,3}$/.test(canonical) ? canonical.padStart(3, "0") : canonical;
  const port = PORT_ALIAS_LOOKUP.get(canonical) || PORT_ALIAS_LOOKUP.get(numeric);
  if (port) return { port_code: port.code, port_name: port.name, status: "known", raw };
  if (["UNKNOWN", "UNK", "N/A", "NA", "NULL", "미확인", "미상"].includes(canonical)) {
    return { port_code: "UNKNOWN", port_name: "Unknown port", status: "unknown", raw };
  }
  if (/BUSAN|PUSAN|부산/.test(canonical)) return { port_code: "BUSAN", port_name: "Busan", status: "known", raw };
  if (/ULSAN|울산/.test(canonical)) return { port_code: "ULSAN", port_name: "Ulsan", status: "known", raw };
  if (/YEOSU|GWANGYANG|여수|광양/.test(canonical)) return { port_code: "YEOSU_GWANGYANG", port_name: "Yeosu/Gwangyang", status: "known", raw };
  if (/INCHEON|인천/.test(canonical)) return { port_code: "INCHEON", port_name: "Incheon", status: "known", raw };
  if (/PYEONGTAEK|PYONGTAEK|DANGJIN|평택|당진/.test(canonical)) return { port_code: "PYEONGTAEK_DANGJIN", port_name: "Pyeongtaek/Dangjin", status: "known", raw };
  if (/POHANG|포항/.test(canonical)) return { port_code: "POHANG", port_name: "Pohang", status: "known", raw };
  if (/MASAN|CHANGWON|JINHAE|마산|창원|진해/.test(canonical)) return { port_code: "MASAN_CHANGWON", port_name: "Masan/Changwon", status: "known", raw };
  return { port_code: "UNKNOWN", port_name: "Unknown port", status: "unknown", raw };
}

function normalizeRecordPort(record = {}) {
  for (const field of PORT_FIELDS) {
    const raw = record[field];
    if (!clean(raw)) continue;
    return { ...normalizePortValue(raw), field };
  }
  return { port_code: null, port_name: "", status: "missing", raw: "", field: null };
}

function score(record = {}) {
  return Number(record.commercial_value_score || record.total_sales_priority_score || record.cleaning_candidate_score || record.lead_priority_score || 0);
}

function isDepartedRecord(record = {}) {
  const status = String(record.status_bucket || record.operational_status || record.status || record.opportunity_status || "").toLowerCase();
  return status === "departed" || Boolean(record.atd);
}

function isHardCandidateExcluded(record = {}) {
  const text = [
    record.vessel_name,
    record.canonical_name,
    record.source,
    record.source_name,
    record.data_mode,
    record.commercial_relevance_status,
    record.exclusion_reason
  ].filter(Boolean).join(" ");
  return /sample|demo|fallback|synthetic/i.test(text) ||
    record.excluded_from_commercial_targets === true ||
    record.commercial_relevance_status === "excluded_non_commercial_type";
}

function withinCommercialPercentile(record = {}, limit) {
  const global = Number(record.global_percentile);
  const port = Number(record.port_percentile);
  return (Number.isFinite(global) && global <= limit) || (Number.isFinite(port) && port <= limit);
}

function hasCommercialRank(record = {}) {
  return Number.isFinite(Number(record.global_percentile)) || Number.isFinite(Number(record.port_percentile));
}

function hasCurrentOrNearTermWorkFeasibility(record = {}) {
  const status = String(record.status_bucket || record.operational_status || record.status || "").toLowerCase();
  return Number(record.work_feasibility_score || record.cleaning_window_score || 0) >= 35 ||
    Number(record.work_window_hours || record.predicted_work_window_hours || 0) > 0 ||
    ["arrived_staying", "berthed", "anchorage_waiting"].includes(status) ||
    Boolean(record.is_anchorage_waiting) ||
    (Number(record.stay_hours || record.cumulative_stay_hours || 0) > 0 && !record.atd);
}

function isImmediateTargetRecord(record = {}) {
  if (isHardCandidateExcluded(record) || isDepartedRecord(record)) return false;
  if (record.is_immediate_candidate === true || ["critical", "immediate_target"].includes(record.candidate_band)) return true;
  return score(record) >= 75 && withinCommercialPercentile(record, 10) && hasCurrentOrNearTermWorkFeasibility(record);
}

function isSalesTargetRecord(record = {}) {
  if (isHardCandidateExcluded(record) || isDepartedRecord(record)) return false;
  if (isImmediateTargetRecord(record)) return true;
  if (["sales_target"].includes(record.candidate_band)) return true;
  return score(record) >= 65 && withinCommercialPercentile(record, 20);
}

function candidateExclusionReason(record = {}) {
  if (isHardCandidateExcluded(record)) return record.exclusion_reason || record.commercial_relevance_status || "hard_excluded";
  if (isDepartedRecord(record)) return "departed_or_atd_present";
  if (score(record) < 65) return "commercial_value_score < 65";
  if (!hasCommercialRank(record)) return "missing_candidate_rank: requires global_percentile or port_percentile before percentile filter";
  if (!withinCommercialPercentile(record, 20)) return "missing_or_outside_percentile: requires global_percentile <= 20 OR port_percentile <= 20";
  if (score(record) >= 75 && !hasCurrentOrNearTermWorkFeasibility(record)) return "immediate_only_blocked: missing current/near-term work feasibility";
  return "not_removed_by_sales_filter";
}

function parseLocalSchema(sql) {
  const tables = new Map();
  const createTable = /create table if not exists\s+([a-zA-Z0-9_]+)\s*\(([\s\S]*?)\);/gi;
  let match;
  while ((match = createTable.exec(sql))) {
    const columns = new Set();
    for (const rawLine of match[2].split(/\r?\n/)) {
      const column = rawLine.trim().match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s+/)?.[1];
      if (column && !["primary", "unique", "constraint", "foreign", "check"].includes(column.toLowerCase())) columns.add(column);
    }
    tables.set(match[1], columns);
  }
  const alterColumn = /alter table\s+(?:if exists\s+)?([a-zA-Z0-9_]+)\s+add column if not exists\s+([a-zA-Z0-9_]+)/gi;
  while ((match = alterColumn.exec(sql))) {
    if (!tables.has(match[1])) tables.set(match[1], new Set());
    tables.get(match[1]).add(match[2]);
  }
  return {
    hasColumn(table, column) {
      return tables.get(table)?.has(column) || false;
    },
    columnsFor(table) {
      return [...(tables.get(table) || [])];
    }
  };
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
  return [];
}

function parseContentRange(value) {
  const match = clean(value).match(/\/(\d+|\*)$/);
  if (!match || match[1] === "*") return null;
  const count = Number(match[1]);
  return Number.isFinite(count) ? count : null;
}

function restUrl(table, params = {}) {
  const url = new URL(`${REST_URL}/${table}`);
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    url.searchParams.append(key, value);
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
  const response = await fetch(restUrl(table, params), { headers });
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
    rows: Array.isArray(body) ? body : [],
    count: parseContentRange(response.headers.get("content-range")),
    error: response.ok ? null : body?.message || body?.details || body?.hint || text || `http_${response.status}`
  };
}

async function countRows(table, filters = {}) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return { ok: false, count: null, error: "missing_supabase_env" };
  const result = await rest(table, { select: "*", ...filters }, {
    headers: { prefer: "count=exact", range: "0-0" }
  });
  return { ok: result.ok, count: result.ok ? result.count ?? result.rows.length : null, error: result.error, status: result.status };
}

async function fetchRows(table, schema, preferredColumns, options = {}) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return { ok: false, rows: [], count: null, sampled: false, error: "missing_supabase_env" };
  const available = schema.columnsFor(table);
  const columns = [...new Set(preferredColumns.filter(column => available.includes(column)))];
  const rows = [];
  let total = null;
  let from = 0;
  while (rows.length < (options.maxRows || MAX_ROWS)) {
    const to = Math.min(from + PAGE_SIZE - 1, (options.maxRows || MAX_ROWS) - 1);
    const params = { select: columns.length ? columns.join(",") : "*", ...(options.filters || {}) };
    if (options.order) params.order = options.order;
    if (options.limit) params.limit = String(options.limit);
    const result = await rest(table, params, {
      headers: { prefer: from === 0 ? "count=exact" : undefined, range: `${from}-${to}` }
    });
    if (!result.ok) return { ok: false, rows, count: total, sampled: false, error: result.error, status: result.status };
    if (from === 0) total = result.count;
    rows.push(...result.rows);
    if (options.limit || result.rows.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return { ok: true, rows, count: total ?? rows.length, sampled: Number.isFinite(total) ? rows.length < total : false };
}

async function latestRun(schema) {
  const active = await fetchRows("active_dataset_pointer", schema, ["id", "active_run_id", "promoted_at"], { maxRows: 10 });
  const activeRunId = active.rows.find(row => row.id === "current")?.active_run_id || active.rows[0]?.active_run_id || "";
  if (activeRunId) return { source: "active_dataset_pointer", run_id: activeRunId };

  const summary = await fetchRows("dashboard_summary_snapshots", schema, ["run_id", "generated_at", "is_latest_successful"], {
    filters: { is_latest_successful: "eq.true" },
    order: "generated_at.desc.nullslast",
    limit: 1,
    maxRows: 1
  });
  if (summary.rows[0]?.run_id) return { source: "dashboard_summary_snapshots", run_id: summary.rows[0].run_id };

  return { source: "static_json", run_id: extractRunId(readJson("dashboard/api/dashboard-summary.json", {})) || "" };
}

function extractRunId(data) {
  return clean(data?.run_id || data?.active_run_id || data?.status_run_id || data?.metadata?.run_id || data?.summary?.run_id);
}

async function loadAuditRows(schema) {
  const run = await latestRun(schema);
  const vesselColumns = [
    "run_id", "vessel_id", "master_vessel_id", "vessel_name", "canonical_name", "normalized_name", "normalized_vessel_name",
    "imo", "mmsi", "call_sign", "vessel_type", "vessel_type_group", "port", "port_code", "port_name", "port_name_ko",
    "commercial_value_score", "total_sales_priority_score", "cleaning_candidate_score", "candidate_band",
    "global_percentile", "port_percentile", "work_feasibility_score", "cleaning_window_score", "work_window_hours",
    "predicted_work_window_hours", "status_bucket", "operational_status", "status", "atd", "stay_hours",
    "commercial_relevance_status", "excluded_from_commercial_targets", "exclusion_reason", "is_immediate_candidate"
  ];

  const dbAvailable = Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);
  let vesselRows = { ok: false, rows: [], count: null, sampled: false, error: "missing_supabase_env" };
  let opportunityRows = { ok: false, rows: [], count: null, sampled: false, error: "missing_supabase_env" };
  let salesCount = { ok: false, count: null, error: "missing_supabase_env" };
  let immediateCount = { ok: false, count: null, error: "missing_supabase_env" };

  if (dbAvailable && run.run_id) {
    vesselRows = await fetchRows("vessel_snapshots", schema, vesselColumns, { filters: { run_id: `eq.${run.run_id}` } });
    opportunityRows = await fetchRows("opportunity_master", schema, [
      "run_id", "opportunity_id", "master_vessel_id", "vessel_name", "imo", "mmsi", "port_code", "port_name",
      "commercial_value_score", "lead_priority_score", "opportunity_status", "opportunity_state", "created_at"
    ], { filters: { run_id: `eq.${run.run_id}` } });
    salesCount = await countRows("sales_candidates_current", { run_id: `eq.${run.run_id}` });
    immediateCount = await countRows("immediate_targets_current", { run_id: `eq.${run.run_id}` });
  }

  if (!dbAvailable || !vesselRows.ok || !vesselRows.rows.length) {
    const staticRows = rowsFromPayload(readJson("dashboard/api/all-collected-vessels.json", []));
    if (staticRows.length) {
      vesselRows = { ok: true, rows: staticRows, count: staticRows.length, sampled: false, error: dbAvailable ? vesselRows.error : "static_json_fallback" };
    }
  }

  return {
    run,
    db_available: dbAvailable,
    vessels: vesselRows,
    opportunities: opportunityRows,
    sales_candidates_current_count: salesCount.count,
    immediate_targets_current_count: immediateCount.count,
    sales_error: salesCount.error,
    immediate_error: immediateCount.error
  };
}

function portAudit(rows) {
  const rawAliases = new Set();
  const normalized = new Map();
  let missing = 0;
  let unknown = 0;
  for (const row of rows) {
    const port = normalizeSharedRecordPort(row);
    if (port.missing) {
      missing += 1;
      continue;
    }
    rawAliases.add(clean(port.raw));
    const key = port.port.port_code || "UNKNOWN";
    const current = normalized.get(key) || { port_code: key, port_name: port.port.port_name || "Unknown port", aliases: new Set(), vessel_count: 0 };
    current.aliases.add(clean(port.raw));
    current.vessel_count += 1;
    normalized.set(key, current);
    if (port.unknown) unknown += 1;
  }
  return {
    raw_port_count: rawAliases.size,
    normalized_port_count: normalized.size,
    aliases_merged_per_port: [...normalized.values()]
      .sort((a, b) => b.aliases.size - a.aliases.size || b.vessel_count - a.vessel_count)
      .map(port => ({
        port_code: port.port_code,
        port_name: port.port_name,
        alias_count: port.aliases.size,
        aliases: [...port.aliases].slice(0, 12),
        vessel_count: port.vessel_count
      })),
    unknown_port_count: unknown,
    vessels_missing_port_field: missing
  };
}

function duplicateGroups(rows, keyFn) {
  const groups = new Map();
  for (const row of rows) {
    const key = cleanUpper(keyFn(row));
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return [...groups.entries()]
    .filter(([, values]) => values.length > 1)
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 10)
    .map(([key, values]) => ({
      key,
      count: values.length,
      examples: values.slice(0, 5).map(row => ({
        vessel_name: row.vessel_name || row.canonical_name || "",
        imo: row.imo || "",
        mmsi: row.mmsi || "",
        port: row.port_code || row.port_name || row.port || ""
      }))
    }));
}

function vesselAudit(rows) {
  const uniqueKeys = new Set();
  for (const row of rows) {
    const key = clean(row.imo)
      ? `IMO:${clean(row.imo).replace(/\D/g, "")}`
      : clean(row.mmsi)
        ? `MMSI:${clean(row.mmsi).replace(/\D/g, "")}`
        : `NAME:${normalizeVesselName(row.normalized_vessel_name || row.normalized_name || row.vessel_name || row.canonical_name)}|${cleanUpper(row.vessel_type_group || row.vessel_type)}`;
    if (key && !key.endsWith(":")) uniqueKeys.add(key);
  }
  return {
    raw_vessel_count: rows.length,
    unique_vessel_count: uniqueKeys.size,
    duplicate_groups_by_imo: duplicateGroups(rows, row => clean(row.imo).replace(/\D/g, "")),
    duplicate_groups_by_mmsi: duplicateGroups(rows, row => clean(row.mmsi).replace(/\D/g, "")),
    duplicate_groups_by_normalized_vessel_name: duplicateGroups(rows, row => `${normalizeVesselName(row.normalized_vessel_name || row.normalized_name || row.vessel_name || row.canonical_name)}|${cleanUpper(row.vessel_type_group || row.vessel_type)}`)
  };
}

function candidateFunnel(rows, opportunityCount, salesCurrentCount, immediateCurrentCount) {
  const rowsWithPort = rows.filter(row => normalizeSharedRecordPort(row).missing !== true);
  const rowsWithIdentity = rows.filter(row => clean(row.imo) || clean(row.mmsi));
  const rowsWithStayDuration = rows.filter(row =>
    Number(row.stay_hours || 0) > 0 ||
    Number(row.cumulative_stay_hours || 0) > 0 ||
    Number(row.anchorage_hours || 0) > 0 ||
    Number(row.berth_hours || 0) > 0
  );
  const rowsWithOpportunityScore = rows.filter(row => score(row) > 0);
  const hotThresholdRows = rows.filter(row => score(row) >= 75);
  const warmThresholdRows = rows.filter(row => score(row) >= 65);
  const steps = [
    { name: "all_vessels", rows },
    { name: "opportunity_score > 0", rows: rows.filter(row => score(row) > 0), condition: "commercialScore(record) > 0" },
    { name: "commercial_score >= 65", rows: rows.filter(row => score(row) >= 65), condition: "commercialScore(record) >= 65" },
    { name: "not_hard_excluded", rows: rows.filter(row => score(row) >= 65 && !isHardCandidateExcluded(row)), condition: "!isHardCandidateExcluded(record)" },
    { name: "not_departed", rows: rows.filter(row => score(row) >= 65 && !isHardCandidateExcluded(row) && !isDepartedRecord(row)), condition: "!isDepartedRecord(record)" },
    { name: "has commercial rank", rows: rows.filter(row => score(row) >= 65 && !isHardCandidateExcluded(row) && !isDepartedRecord(row) && hasCommercialRank(row)), condition: "global_percentile exists OR port_percentile exists" },
    { name: "sales percentile <= 20", rows: rows.filter(row => score(row) >= 65 && !isHardCandidateExcluded(row) && !isDepartedRecord(row) && hasCommercialRank(row) && withinCommercialPercentile(row, 20)), condition: "global_percentile <= 20 OR port_percentile <= 20" },
    { name: "sales target predicate", rows: rows.filter(isSalesTargetRecord), condition: "isSalesTargetRecord(record)" },
    { name: "immediate target predicate", rows: rows.filter(isImmediateTargetRecord), condition: "isImmediateTargetRecord(record)" }
  ];
  const removalSteps = [];
  for (let index = 1; index < steps.length; index += 1) {
    removalSteps.push({
      step: steps[index].name,
      condition: steps[index].condition,
      before_count: steps[index - 1].rows.length,
      after_count: steps[index].rows.length,
      removed_count: Math.max(0, steps[index - 1].rows.length - steps[index].rows.length)
    });
  }
  const excluded = rows
    .filter(row => score(row) >= 65 && !isSalesTargetRecord(row))
    .reduce((acc, row) => {
      const reason = candidateExclusionReason(row);
      acc[reason] = (acc[reason] || 0) + 1;
      return acc;
    }, {});
  return {
    all_vessels_count: rows.length,
    total_vessels: rows.length,
    vessels_with_port: rowsWithPort.length,
    vessels_with_imo_mmsi: rowsWithIdentity.length,
    vessels_with_stay_duration: rowsWithStayDuration.length,
    vessels_with_opportunity_score: rowsWithOpportunityScore.length,
    vessels_passing_hot_threshold: hotThresholdRows.length,
    vessels_passing_warm_threshold: warmThresholdRows.length,
    opportunity_master_count: opportunityCount ?? "unknown",
    sales_candidates_current_count: salesCurrentCount ?? "unknown",
    immediate_targets_current_count: immediateCurrentCount ?? "unknown",
    expected_sales_candidates_from_vessel_snapshots: steps.find(step => step.name === "sales target predicate")?.rows.length || 0,
    expected_immediate_targets_from_vessel_snapshots: steps.find(step => step.name === "immediate target predicate")?.rows.length || 0,
    filtering_steps: removalSteps,
    high_score_removed_reason_counts: excluded,
    zero_candidate_cause: zeroCandidateCause({ rows, opportunityCount, salesCurrentCount, steps })
  };
}

function zeroCandidateCause({ rows, opportunityCount, salesCurrentCount, steps }) {
  if (!(Number(opportunityCount || 0) > 0 && Number(salesCurrentCount || 0) === 0)) return null;
  if (!rows.length) {
    return "opportunity_master > 0 but latest vessel_snapshots for the audited run are empty; sales_candidates_current is generated from vessel snapshot records, not directly from opportunity_master.";
  }
  const salesStep = steps.find(step => step.name === "sales target predicate");
  if (salesStep?.rows.length > 0) {
    return "records pass isSalesTargetRecord(record), but sales_candidates_current is empty; likely materialized current-table write failed, was skipped, or was written for a different run_id.";
  }
  for (const step of steps.slice(1)) {
    if (step.rows.length === 0) {
      return `first zero-count filter: ${step.condition}`;
    }
  }
  const reasons = rows
    .filter(row => score(row) >= 65)
    .map(candidateExclusionReason)
    .filter(Boolean);
  const topReason = Object.entries(reasons.reduce((acc, reason) => {
    acc[reason] = (acc[reason] || 0) + 1;
    return acc;
  }, {})).sort((a, b) => b[1] - a[1])[0];
  return topReason ? `dominant removal condition: ${topReason[0]}` : "no row satisfies isSalesTargetRecord(record)";
}

function printReport({ run, mode, sourceWarning, port, vessel, funnel }) {
  console.log("Normalization & Candidate Funnel Audit");
  console.log("======================================");
  console.log("");
  console.log("1. Summary");
  console.log(`- mode: ${mode}`);
  console.log(`- run_id: ${run.run_id || "unknown"}`);
  console.log(`- run_source: ${run.source || "unknown"}`);
  if (sourceWarning) console.log(`- WARNING: ${sourceWarning}`);
  console.log("");

  console.log("2. Port normalization");
  console.log(`- raw_port_count: ${port.raw_port_count}`);
  console.log(`- normalized_port_count: ${port.normalized_port_count}`);
  console.log(`- unknown_port_count: ${port.unknown_port_count}`);
  console.log(`- vessels_missing_port_field: ${port.vessels_missing_port_field}`);
  console.log("- aliases merged per port:");
  if (!port.aliases_merged_per_port.length) console.log("  - none");
  for (const item of port.aliases_merged_per_port.slice(0, 20)) {
    console.log(`  - ${item.port_name} (${item.port_code}): aliases=${item.alias_count}, vessels=${item.vessel_count}, examples=${item.aliases.join(" | ")}`);
  }
  console.log("");

  console.log("3. Vessel normalization");
  console.log(`- raw_vessel_count: ${vessel.raw_vessel_count}`);
  console.log(`- unique_vessel_count: ${vessel.unique_vessel_count}`);
  printDuplicateSection("duplicate groups by IMO", vessel.duplicate_groups_by_imo);
  printDuplicateSection("duplicate groups by MMSI", vessel.duplicate_groups_by_mmsi);
  printDuplicateSection("duplicate groups by normalized vessel name", vessel.duplicate_groups_by_normalized_vessel_name);
  console.log("");

  console.log("4. Candidate funnel");
  console.log(`- all_vessels_count: ${funnel.all_vessels_count}`);
  console.log(`- vessels_with_port: ${funnel.vessels_with_port}`);
  console.log(`- vessels_with_imo_mmsi: ${funnel.vessels_with_imo_mmsi}`);
  console.log(`- vessels_with_stay_duration: ${funnel.vessels_with_stay_duration}`);
  console.log(`- vessels_with_opportunity_score: ${funnel.vessels_with_opportunity_score}`);
  console.log(`- vessels_passing_hot_threshold: ${funnel.vessels_passing_hot_threshold}`);
  console.log(`- vessels_passing_warm_threshold: ${funnel.vessels_passing_warm_threshold}`);
  console.log(`- opportunity_master_count: ${funnel.opportunity_master_count}`);
  console.log(`- sales_candidates_current_count: ${funnel.sales_candidates_current_count}`);
  console.log(`- immediate_targets_current_count: ${funnel.immediate_targets_current_count}`);
  console.log(`- expected_sales_candidates_from_vessel_snapshots: ${funnel.expected_sales_candidates_from_vessel_snapshots}`);
  console.log(`- expected_immediate_targets_from_vessel_snapshots: ${funnel.expected_immediate_targets_from_vessel_snapshots}`);
  console.log("- filtering step where candidates are removed:");
  for (const step of funnel.filtering_steps) {
    console.log(`  - ${step.step}: before=${step.before_count}, after=${step.after_count}, removed=${step.removed_count}, condition=${step.condition}`);
  }
  console.log("- high score removed reason counts:");
  const reasons = Object.entries(funnel.high_score_removed_reason_counts);
  if (!reasons.length) console.log("  - none");
  for (const [reason, count] of reasons.sort((a, b) => b[1] - a[1])) console.log(`  - ${reason}: ${count}`);
  if (funnel.zero_candidate_cause) {
    console.log(`- CRITICAL zero candidate cause: ${funnel.zero_candidate_cause}`);
    console.log("- exact sales filter: !isHardCandidateExcluded(record) AND !isDepartedRecord(record) AND (isImmediateTargetRecord(record) OR candidate_band = 'sales_target' OR (commercialScore(record) >= 65 AND global/port percentile exists AND (global_percentile <= 20 OR port_percentile <= 20)))");
  }
}

function printDuplicateSection(title, groups) {
  console.log(`- ${title}: ${groups.length}`);
  if (!groups.length) return;
  for (const group of groups.slice(0, 5)) {
    console.log(`  - key=${group.key}, count=${group.count}, examples=${JSON.stringify(group.examples)}`);
  }
}

async function main() {
  const schema = parseLocalSchema(readText("supabase/schema.sql"));
  const audit = await loadAuditRows(schema);
  if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY && !audit.vessels.ok) {
    throw new Error(`Could not load vessel rows from Supabase: ${audit.vessels.error}`);
  }
  const rows = audit.vessels.rows;
  const mode = audit.db_available && audit.vessels.error !== "static_json_fallback" ? "supabase" : "static_json_fallback";
  const sourceWarning = audit.db_available
    ? audit.vessels.sampled ? `audited row sample is capped at ${MAX_ROWS}` : null
    : "SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing; using static JSON where available.";
  const opportunityCount = audit.opportunities.ok ? audit.opportunities.count : null;
  const port = portAudit(rows);
  const vessel = vesselAudit(rows);
  const funnel = candidateFunnel(rows, opportunityCount, audit.sales_candidates_current_count, audit.immediate_targets_current_count);
  printReport({ run: audit.run, mode, sourceWarning, port, vessel, funnel });
}

main().catch(error => {
  console.error("Normalization & Candidate Funnel Audit");
  console.error("======================================");
  console.error(`CRITICAL: ${error?.message || String(error)}`);
  process.exit(1);
});
