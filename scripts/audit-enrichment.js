import fs from "fs";

const SUPABASE_URL = String(process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const REST_URL = SUPABASE_URL ? `${SUPABASE_URL}/rest/v1` : "";
const PAGE_SIZE = Math.min(1000, positiveInt(process.env.AUDIT_ENRICHMENT_PAGE_SIZE, 1000));
const MAX_ROWS = positiveInt(process.env.AUDIT_ENRICHMENT_MAX_ROWS, 25000);

function positiveInt(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback;
}

function clean(value) {
  return String(value ?? "").normalize("NFKC").trim();
}

function hasValue(value) {
  return value !== undefined && value !== null && clean(value) !== "" && clean(value) !== "-";
}

function rows(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.vessels)) return payload.vessels;
  if (Array.isArray(payload?.candidates)) return payload.candidates;
  if (Array.isArray(payload?.opportunities)) return payload.opportunities;
  return [];
}

function readJson(file, fallback = {}) {
  try {
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : fallback;
  } catch {
    return fallback;
  }
}

function pct(count, total) {
  if (!total) return "0.0%";
  return `${Math.round((count / total) * 1000) / 10}%`;
}

function urlFor(table, params = {}) {
  const url = new URL(`${REST_URL}/${table}`);
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    url.searchParams.append(key, value);
  }
  return url.toString();
}

function parseContentRange(value) {
  const match = clean(value).match(/\/(\d+|\*)$/);
  if (!match || match[1] === "*") return null;
  const count = Number(match[1]);
  return Number.isFinite(count) ? count : null;
}

async function rest(table, params = {}, options = {}) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return { ok: false, rows: [], count: null, error: "missing_supabase_env", status: 0 };
  }
  const response = await fetch(urlFor(table, params), {
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      accept: "application/json",
      ...options.headers
    }
  });
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

async function fetchRows(table, { filters = {}, order = "", maxRows = MAX_ROWS, select = "*" } = {}) {
  const out = [];
  let total = null;
  for (let offset = 0; offset < maxRows; offset += PAGE_SIZE) {
    const params = { select, ...filters };
    if (order) params.order = order;
    const result = await rest(table, params, {
      headers: {
        prefer: offset === 0 ? "count=exact" : undefined,
        range: `${offset}-${Math.min(offset + PAGE_SIZE - 1, maxRows - 1)}`
      }
    });
    if (!result.ok) return { ok: false, rows: out, count: total, error: result.error, status: result.status };
    if (offset === 0) total = result.count;
    out.push(...result.rows);
    if (result.rows.length < PAGE_SIZE) break;
  }
  return { ok: true, rows: out, count: total ?? out.length };
}

async function countRows(table, filters = {}) {
  const result = await rest(table, { select: "*", ...filters, limit: "1" }, { headers: { prefer: "count=exact" } });
  return result.ok ? { count: result.count ?? 0 } : { count: null, error: result.error };
}

async function latestRunId() {
  const pointer = await rest("active_dataset_pointer", { select: "active_run_id", id: "eq.current", limit: "1" });
  if (pointer.ok && pointer.rows[0]?.active_run_id) return pointer.rows[0].active_run_id;
  const latest = await rest("data_collection_runs", { select: "run_id,status,finished_at", order: "finished_at.desc.nullslast", limit: "1" });
  return latest.ok ? latest.rows[0]?.run_id || null : null;
}

function payload(row = {}) {
  return row.payload && typeof row.payload === "object" && !Array.isArray(row.payload) ? row.payload : {};
}

const FOCUS_FIELDS = [
  { key: "imo", label: "IMO", keys: ["imo"] },
  { key: "mmsi", label: "MMSI", keys: ["mmsi"] },
  { key: "call_sign", label: "Call Sign", keys: ["call_sign", "callsign", "clsgn"] },
  { key: "operator", label: "Operator", keys: ["operator_name", "operator", "operator_normalized"] },
  { key: "owner", label: "Owner", keys: ["owner_name", "owner", "ship_owner", "registered_owner"] },
  { key: "manager", label: "Manager", keys: ["manager_name", "manager", "ship_manager", "technical_manager"] },
  { key: "vessel_type", label: "Vessel Type", keys: ["vessel_type", "vessel_type_group", "vsslKndNm"] },
  { key: "gt", label: "GT", keys: ["gt", "grtg", "intrlGrtg", "gross_tonnage"] },
  { key: "dwt", label: "DWT", keys: ["dwt", "deadweight", "deadweight_tonnage"] },
  { key: "flag", label: "Flag", keys: ["flag", "vsslNltyNm", "vsslNltyCd", "nationality"] }
];

function objectValue(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function beforePayloads(row = {}) {
  return [
    objectValue(row.before_enrichment),
    objectValue(row.pre_enrichment),
    objectValue(row.pre_enrichment_payload),
    objectValue(row.raw_source_payload),
    objectValue(row.raw_payload),
    objectValue(row.source_payload),
    objectValue(row.original_payload),
    objectValue(payload(row).before_enrichment),
    objectValue(payload(row).pre_enrichment),
    objectValue(payload(row).raw_source_payload),
    objectValue(payload(row).raw_payload),
    objectValue(payload(row).source_payload)
  ].filter(Boolean);
}

function firstFromObject(object = {}, keys = []) {
  for (const key of keys) {
    if (hasValue(object[key])) return object[key];
  }
  return undefined;
}

function beforePrefixedField(row = {}, keys = []) {
  const merged = { ...payload(row), ...row };
  for (const key of keys) {
    for (const prefix of ["pre_enrichment_", "before_enrichment_", "raw_", "source_", "original_"]) {
      const value = merged[`${prefix}${key}`];
      if (hasValue(value)) return value;
    }
  }
  return undefined;
}

function beforeField(row = {}, keys = []) {
  const direct = beforePrefixedField(row, keys);
  if (hasValue(direct)) return direct;
  for (const source of beforePayloads(row)) {
    const value = firstFromObject(source, keys);
    if (hasValue(value)) return value;
  }
  return undefined;
}

function field(row = {}, keys = []) {
  const merged = { ...payload(row), ...row, ...(row.vessel_display || {}) };
  return keys.map(key => merged[key]).find(hasValue);
}

function hasFieldValue(def = {}, value) {
  if (!hasValue(value)) return false;
  if (["gt", "dwt"].includes(def.key)) {
    const number = Number(value);
    return Number.isFinite(number) ? number > 0 : true;
  }
  if (def.key === "mmsi") {
    const number = Number(value);
    return Number.isFinite(number) ? number > 0 : true;
  }
  return true;
}

function coverage(records, label, keys, mode = "after") {
  const getter = mode === "before" ? beforeField : field;
  const def = FOCUS_FIELDS.find(item => item.keys === keys || item.label === label.replace(/ coverage$/, ""));
  const count = records.filter(record => hasFieldValue(def, getter(record, keys))).length;
  console.log(`- ${label}: ${count}/${records.length} (${pct(count, records.length)})`);
  return count;
}

function sourceText(record = {}) {
  const values = [
    record.source,
    record.source_name,
    record.source_label,
    record.data_source_used,
    record.source_mode,
    record.operator_source,
    record.agent_source,
    record.enrichment_source,
    record.imo_recovery_source,
    record.berth_data_source,
    record.gt_source,
    record.eta_source,
    record.score_source,
    ...(Array.isArray(record.enrichment_sources) ? record.enrichment_sources : []),
    ...(Array.isArray(record.source_names) ? record.source_names : []),
    ...(Array.isArray(record.data_sources) ? record.data_sources : []),
    ...(Array.isArray(record.source_children) ? record.source_children : []),
    record.vessel_master_seed_match ? "vessel_master_seed_csv" : "",
    record.imo_recovered_from_seed ? "source_csv_imo_recovery" : "",
    record.vessel_master_cache_match ? "vessel_master_cache" : "",
    record.imo_recovered_from_cache ? "vessel_master_cache_imo_recovery" : "",
    record.secondary_enrichment_matched ? "secondary_port_facility_enrichment" : ""
  ];
  return values.filter(hasValue).join(" | ");
}

function sourceBuckets(record = {}) {
  const text = sourceText(record);
  const buckets = new Set();
  if (/source[_-]?csv|csv|vessel_master_seed|reference|dictionary/i.test(text)) buckets.add("source.csv");
  if (/vessel[_-]?spec|ship[_-]?spec|spec_api/i.test(text)) buckets.add("vessel_spec");
  if (/mof[_-]?ais[_-]?info|ais[_-]?info|\bAIS\b|VTS|mmsi/i.test(text)) buckets.add("AIS info");
  if (/vessel_master_cache|master_db|vessel_master/i.test(text)) buckets.add("vessel_master_cache");
  if (/port_facility|secondary_port_facility|berth|terminal|pilot/i.test(text)) buckets.add("port/berth enrichment");
  if (!buckets.size) buckets.add("unknown");
  return [...buckets];
}

function emptyContribution() {
  return Object.fromEntries(FOCUS_FIELDS.map(field => [field.key, 0]));
}

function buildContribution(records = []) {
  const bySource = new Map();
  const recordCounts = new Map();
  for (const record of records) {
    const recoveredFields = FOCUS_FIELDS.filter(def =>
      !hasFieldValue(def, beforeField(record, def.keys)) && hasFieldValue(def, field(record, def.keys))
    );
    if (!recoveredFields.length) continue;
    for (const source of sourceBuckets(record)) {
      if (!bySource.has(source)) bySource.set(source, emptyContribution());
      recordCounts.set(source, (recordCounts.get(source) || 0) + 1);
      const row = bySource.get(source);
      for (const def of recoveredFields) row[def.key] += 1;
    }
  }
  return { bySource, recordCounts };
}

function printCoverageBlock(records = [], mode = "after") {
  for (const def of FOCUS_FIELDS) coverage(records, `${def.label} coverage`, def.keys, mode);
}

function printContribution(records = []) {
  const { bySource, recordCounts } = buildContribution(records);
  const preferred = ["source.csv", "vessel_spec", "AIS info", "vessel_master_cache", "port/berth enrichment", "unknown"];
  console.log("\nFields recovered by source:");
  for (const source of preferred) {
    const row = bySource.get(source) || emptyContribution();
    const fields = FOCUS_FIELDS.map(def => `${def.label} ${row[def.key] || 0}`).join(", ");
    console.log(`- ${source}: ${fields}`);
  }
  console.log("\nSource contributions:");
  for (const source of preferred) {
    const present = records.filter(record => sourceBuckets(record).includes(source)).length;
    const recovered = recordCounts.get(source) || 0;
    console.log(`- ${source} contribution: ${present} records present, ${recovered} records recovered fields`);
  }
}

function staticRecords() {
  const page = readJson("dashboard/api/vessels/page-1.json", {});
  const all = readJson("dashboard/api/all-collected-vessels.json", {});
  const target = readJson("dashboard/api/target-vessels.json", {});
  return [...rows(page), ...rows(all), ...rows(target)];
}

function printSamples(records = []) {
  const samples = records
    .filter(record =>
      hasValue(field(record, ["imo"])) ||
      hasValue(field(record, ["call_sign", "callsign", "clsgn"])) ||
      hasValue(field(record, ["operator_name", "operator"])) ||
      hasValue(field(record, ["owner_name", "owner", "ship_owner", "registered_owner"])) ||
      hasValue(field(record, ["manager_name", "manager", "ship_manager", "technical_manager"]))
    )
    .slice(0, 20);
  console.log("\nTop 20 sample enriched vessels:");
  if (!samples.length) {
    console.log("- none");
    return;
  }
  samples.forEach((record, index) => {
    console.log(`${index + 1}. ${field(record, ["vessel_name", "name"]) || "-"} | IMO ${field(record, ["imo"]) || "-"} | Call ${field(record, ["call_sign", "callsign", "clsgn"]) || "-"} | Operator ${field(record, ["operator_name", "operator"]) || "-"} | Owner ${field(record, ["owner_name", "owner", "ship_owner", "registered_owner"]) || "-"} | Manager ${field(record, ["manager_name", "manager", "ship_manager", "technical_manager"]) || "-"}`);
  });
}

async function main() {
  console.log("Enrichment coverage audit:");
  let records = [];
  let runId = null;
  let source = "static_json";

  if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
    runId = await latestRunId();
    if (runId) {
      const fetched = await fetchRows("vessel_snapshots", {
        filters: { run_id: `eq.${runId}` },
        order: "commercial_value_score.desc.nullslast,collected_at.desc.nullslast"
      });
      if (fetched.ok) {
        records = fetched.rows;
        source = "supabase";
      } else {
        console.log(`- supabase_read_error: ${fetched.error}`);
      }
    }
  }

  if (!records.length) records = staticRecords();

  console.log(`- source: ${source}`);
  console.log(`- latest_successful_run_id: ${runId || "unknown"}`);
  console.log(`- total vessels: ${records.length}`);
  const beforeBasisRows = records.filter(record => beforePayloads(record).length || FOCUS_FIELDS.some(def => hasFieldValue(def, beforePrefixedField(record, def.keys)))).length;
  console.log(`- before_enrichment_basis_rows: ${beforeBasisRows}/${records.length}`);
  console.log(`- before_enrichment_basis: ${beforeBasisRows ? "raw/pre-enrichment payload fields" : "not retained in current snapshot; recovered counts use available raw/source-prefixed fields only"}`);

  console.log("\nField coverage before enrichment:");
  printCoverageBlock(records, "before");
  console.log("\nField coverage after enrichment:");
  printCoverageBlock(records, "after");
  printContribution(records);

  const enrichmentCandidates = records.filter(record =>
    !hasValue(field(record, ["imo"])) ||
    !hasValue(field(record, ["call_sign", "callsign", "clsgn"])) ||
    !hasValue(field(record, ["operator_name", "operator"]))
  ).length;

  let matchCandidates = { count: null };
  let recoveryQueue = { count: null };
  let dailyRuntime = readJson("dashboard/api/daily-enrichment-runtime.json", {});
  if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
    matchCandidates = await countRows("enrichment_match_candidates", runId ? { run_id: `eq.${runId}` } : {});
    recoveryQueue = await countRows("imo_recovery_queue", runId ? { run_id: `eq.${runId}` } : {});
  }

  const attempts = Number(dailyRuntime.input_rows || 0) || Number(matchCandidates.count || 0) + Number(recoveryQueue.count || 0);
  const successes = records.filter(record =>
    sourceBuckets(record).some(bucket => bucket !== "unknown") &&
    FOCUS_FIELDS.some(def => hasFieldValue(def, field(record, def.keys)))
  ).length;
  const failures = attempts ? Math.max(0, attempts - successes) : 0;
  const pipelineReport = readJson("data/pipeline-report.json", {});
  const identityResolution = pipelineReport.identity_resolution || dailyRuntime.identity_resolution || {};
  const recoveredImoBySource = identityResolution.recovered_imo_by_source || pipelineReport.imo_recovery_kpis?.recovered_imo_count_by_source || {};
  const recoveredMmsiBySource = identityResolution.recovered_mmsi_by_source || pipelineReport.imo_recovery_kpis?.recovered_mmsi_count_by_source || {};

  console.log("\nEnrichment activity:");
  console.log(`- enrichment candidates found: ${enrichmentCandidates}`);
  console.log(`- enrichment attempts: ${attempts}`);
  console.log(`- enrichment successes: ${successes}`);
  console.log(`- enrichment failures: ${failures}`);
  console.log(`- enrichment skipped: ${Math.max(0, records.length - enrichmentCandidates)}`);
  console.log(`- enrichment_match_candidates: ${matchCandidates.count ?? "unknown"}${matchCandidates.error ? ` (${matchCandidates.error})` : ""}`);
  console.log(`- imo_recovery_queue: ${recoveryQueue.count ?? "unknown"}${recoveryQueue.error ? ` (${recoveryQueue.error})` : ""}`);
  console.log(`- vessel_master_cache_status: ${dailyRuntime.vessel_master_cache?.status || "unknown"}`);
  console.log(`- MAX_IMO_RECOVERY_CALLS: ${process.env.MAX_IMO_RECOVERY_CALLS || "100"}`);

  console.log("\nIMO/MMSI Recovery:");
  console.log(`- total_records: ${identityResolution.total_records ?? records.length}`);
  console.log(`- records_missing_imo_before: ${identityResolution.records_missing_imo_before ?? "unknown"}`);
  console.log(`- records_missing_mmsi_before: ${identityResolution.records_missing_mmsi_before ?? "unknown"}`);
  console.log(`- candidates_created: ${identityResolution.candidates_created ?? "unknown"}`);
  console.log(`- candidates_resolved: ${identityResolution.candidates_resolved ?? "unknown"}`);
  console.log(`- applied_high_confidence: ${identityResolution.applied_high_confidence ?? "unknown"}`);
  console.log(`- needs_review: ${identityResolution.needs_review ?? "unknown"}`);
  console.log(`- conflicts: ${identityResolution.conflicts ?? "unknown"}`);
  console.log(`- recovered_imo_by_source: ${JSON.stringify(recoveredImoBySource)}`);
  console.log(`- recovered_mmsi_by_source: ${JSON.stringify(recoveredMmsiBySource)}`);
  console.log(`- final_imo_coverage: ${identityResolution.final_imo_coverage ?? "unknown"}%`);
  console.log(`- final_mmsi_coverage: ${identityResolution.final_mmsi_coverage ?? "unknown"}%`);
  if (identityResolution.candidates_created > 0 && Number(identityResolution.candidates_resolved || 0) === 0) {
    console.log("- WARNING: candidates_created > 0 but candidates_resolved = 0");
  }
  if ((identityResolution.final_imo_coverage ?? 0) === 0 && records.some(record => hasValue(field(record, ["call_sign", "callsign", "clsgn"])))) {
    const reason = Object.entries(identityResolution.failed_recovery_reasons || {}).sort((left, right) => right[1] - left[1])[0]?.[0] || "reference sources lack verified IMO/MMSI or no high-confidence matches";
    console.log(`- WARNING: call_sign coverage is high but IMO recovery remains 0 (${reason})`);
  }

  printSamples(records);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
