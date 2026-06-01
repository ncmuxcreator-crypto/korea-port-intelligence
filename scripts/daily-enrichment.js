import fs from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { createRunId, enrichWithVesselMasterCache, getSupabase } from "./lib/db.js";
import {
  matchConfidenceBand,
  normalizeBerthName,
  normalizeCallSign,
  normalizeTerminalName,
  normalizeVesselName,
  scoreMatch
} from "./lib/matching.js";

const DAILY_ENRICHMENT_LIMIT = Number(process.env.DAILY_ENRICHMENT_LIMIT || 300);
const DAILY_ENRICHMENT_UPDATE_LIMIT = Number(process.env.DAILY_ENRICHMENT_UPDATE_LIMIT || 120);
const MATCH_TIME_WINDOW_HOURS = Number(process.env.MATCH_TIME_WINDOW_HOURS || 48);
const STRONG_TIME_MATCH_HOURS = Number(process.env.STRONG_TIME_MATCH_HOURS || 6);

function ensureDir(path) {
  fs.mkdirSync(path, { recursive: true });
}

function stableId(prefix, value) {
  const hash = createHash("sha1").update(String(value || randomUUID())).digest("hex").slice(0, 18);
  return `${prefix}-${hash}`;
}

function normalizeCompany(value = "") {
  return String(value || "")
    .normalize("NFKC")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, " ");
}

function hasValue(value) {
  return value !== null && value !== undefined && String(value).trim() !== "";
}

function numberValue(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function commercialScore(record = {}) {
  return numberValue(record.commercial_value_score || record.total_sales_priority_score || record.predicted_cleaning_opportunity_score);
}

function identityConfidence(record = {}) {
  if (record.imo) return 100;
  if (record.mmsi) return 88;
  if (record.call_sign) return 82;
  if (record.normalized_vessel_name && numberValue(record.gt) > 0 && record.vessel_type_group) return 65;
  if (record.normalized_vessel_name && record.port_code) return 45;
  return 20;
}

function recoveryPriority(record = {}) {
  const score = commercialScore(record);
  const gt = numberValue(record.gt);
  if (score >= 75) return "CRITICAL";
  if (gt > 30000) return "HIGH";
  if (gt >= 5000) return "MEDIUM";
  return "LOW";
}

function priorityScore(record = {}) {
  let score = commercialScore(record);
  const gt = numberValue(record.gt);
  if (!record.imo) score += 20;
  if (!record.operator_name && !record.operator) score += 8;
  if (gt >= 5000) score += 10;
  if (gt >= 30000) score += 8;
  if (record.call_sign) score += 6;
  if (record.is_anchorage_waiting || numberValue(record.anchorage_hours) >= 24) score += 6;
  if (record.pilot_schedule_matched || record.secondary_enrichment_matched) score += 4;
  return score;
}

function rowKey(record = {}) {
  return [
    record.port_call_identity,
    record.hybrid_entity_key,
    record.master_vessel_id,
    record.imo,
    record.mmsi,
    record.call_sign,
    normalizeVesselName(record.vessel_name)
  ].find(Boolean);
}

function dedupeAndPrioritize(records = []) {
  const byKey = new Map();
  for (const record of records) {
    const key = rowKey(record);
    if (!key) continue;
    const current = byKey.get(key);
    if (!current || priorityScore(record) > priorityScore(current)) byKey.set(key, record);
  }
  return [...byKey.values()]
    .sort((a, b) => priorityScore(b) - priorityScore(a))
    .slice(0, DAILY_ENRICHMENT_LIMIT);
}

function uniqueBy(rows = [], keyFn) {
  const map = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    if (!key) continue;
    map.set(key, row);
  }
  return [...map.values()];
}

async function loadActiveRunId(supabase) {
  const { data, error } = await supabase
    .from("active_dataset_pointer")
    .select("active_run_id")
    .eq("id", "current")
    .maybeSingle();
  if (error) return null;
  return data?.active_run_id || null;
}

async function loadCandidateSnapshots(supabase) {
  const activeRunId = await loadActiveRunId(supabase);
  const columns = [
    "id",
    "snapshot_id",
    "run_id",
    "master_vessel_id",
    "hybrid_entity_key",
    "port_call_identity",
    "vessel_name",
    "call_sign",
    "imo",
    "mmsi",
    "gt",
    "vessel_type",
    "vessel_type_group",
    "port_code",
    "port_name",
    "berth_name",
    "anchorage_name",
    "eta",
    "etb",
    "ata",
    "atb",
    "etd",
    "atd",
    "stay_hours",
    "anchorage_hours",
    "commercial_value_score",
    "data_confidence_score",
    "operator_name",
    "operator_normalized",
    "operator_confidence",
    "operator_source",
    "agent_name",
    "agent_normalized",
    "agent_source",
    "collected_at"
  ].join(",");

  let query = supabase
    .from("vessel_snapshots")
    .select(columns)
    .order("commercial_value_score", { ascending: false })
    .limit(DAILY_ENRICHMENT_LIMIT * 4);

  if (activeRunId) query = query.eq("run_id", activeRunId);
  else query = query.order("collected_at", { ascending: false });

  const { data, error } = await query;
  if (error) throw error;
  return { records: dedupeAndPrioritize(data || []), activeRunId };
}

async function loadHistoricalMatches(supabase, records = []) {
  const names = [...new Set(records.map(record => normalizeVesselName(record.vessel_name)).filter(Boolean))].slice(0, 100);
  if (!names.length) return new Map();
  const { data, error } = await supabase
    .from("enrichment_match_candidates")
    .select("normalized_vessel_name,call_sign,port_code,source_name,match_score,confidence,match_reasons,matched_fields,created_at")
    .in("normalized_vessel_name", names)
    .gte("match_score", 60)
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) return new Map();
  const map = new Map();
  for (const row of data || []) {
    const key = `${row.normalized_vessel_name || ""}|${normalizeCallSign(row.call_sign || "")}|${row.port_code || ""}`;
    if (!map.has(key)) map.set(key, row);
  }
  return map;
}

function historicalMatchFor(record = {}, historicalMatches = new Map()) {
  const name = normalizeVesselName(record.vessel_name);
  const call = normalizeCallSign(record.call_sign);
  return historicalMatches.get(`${name}|${call}|${record.port_code || ""}`) ||
    historicalMatches.get(`${name}||${record.port_code || ""}`) ||
    null;
}

function buildMatchMemoryRow(record = {}, runId, now, historicalMatch = null) {
  const normalizedName = normalizeVesselName(record.vessel_name);
  const selfMatch = scoreMatch(record, {
    vessel_name: record.vessel_name,
    normalized_vessel_name: normalizedName,
    call_sign: record.call_sign,
    port_code: record.port_code,
    berth_name: record.berth_name || record.anchorage_name,
    terminal_name: record.terminal_name,
    vessel_type_group: record.vessel_type_group,
    gt: record.gt,
    eta: record.eta,
    etb: record.etb,
    ata: record.ata,
    atb: record.atb,
    etd: record.etd,
    atd: record.atd,
    pilot_time: record.pilot_time,
    movement_time: record.movement_time,
    agent_name: record.agent_name,
    operator_name: record.operator_name || record.operator
  }, {
    timeWindowHours: MATCH_TIME_WINDOW_HOURS,
    strongTimeMatchHours: STRONG_TIME_MATCH_HOURS
  });

  const baseScore = Math.max(
    selfMatch.score,
    numberValue(record.match_score),
    numberValue(historicalMatch?.match_score)
  );
  const score = Math.min(100, baseScore + (historicalMatch ? 8 : 0));
  const reasons = [
    ...selfMatch.reasons,
    ...(historicalMatch ? ["historical_match_reused"] : []),
    ...(record.pilot_schedule_matched ? ["pilot_schedule_matched"] : []),
    ...(record.secondary_enrichment_matched ? ["secondary_enrichment_matched"] : [])
  ];

  return {
    match_id: stableId("DEM", `${runId}-${record.id || record.snapshot_id || rowKey(record)}-${record.port_code || ""}`),
    run_id: runId,
    source_name: "daily_critical_enrichment",
    source_row_id: String(record.id || record.snapshot_id || rowKey(record) || ""),
    snapshot_id: record.snapshot_id ? String(record.snapshot_id) : record.id ? String(record.id) : null,
    master_vessel_id: record.master_vessel_id || record.hybrid_entity_key || null,
    hybrid_entity_key: record.hybrid_entity_key || null,
    port_call_identity: record.port_call_identity || null,
    vessel_name: record.vessel_name || null,
    normalized_vessel_name: normalizedName,
    call_sign: record.call_sign || null,
    port_code: record.port_code || null,
    enrichment_source: "daily_critical_enrichment",
    enrichment_source_type: "matching_memory",
    match_score: score,
    confidence: matchConfidenceBand(score),
    match_confidence: matchConfidenceBand(score),
    match_reasons: [...new Set(reasons)],
    matched_fields: {
      ...selfMatch.matched_fields,
      berth_alias: normalizeBerthName(record.berth_name || record.anchorage_name || ""),
      terminal_alias: normalizeTerminalName(record.terminal_name || record.berth_name || ""),
      historical_source: historicalMatch?.source_name || null
    },
    raw_source_payload: {},
    matched_at: now,
    reused_historical_match: Boolean(historicalMatch),
    created_at: now,
    payload: {
      job: "daily_critical_info_enrichment",
      match_time_window_hours: MATCH_TIME_WINDOW_HOURS,
      strong_time_match_hours: STRONG_TIME_MATCH_HOURS,
      commercial_value_score: commercialScore(record),
      data_confidence_score: numberValue(record.data_confidence_score)
    }
  };
}

function buildImoRecoveryRow(record = {}, runId, now) {
  const normalizedName = normalizeVesselName(record.vessel_name);
  return {
    recovery_id: stableId("DIMOR", `${record.hybrid_entity_key || record.port_call_identity || normalizedName}-${record.port_code || ""}`),
    run_id: runId,
    master_vessel_id: record.master_vessel_id || record.hybrid_entity_key || null,
    snapshot_id: record.snapshot_id ? String(record.snapshot_id) : record.id ? String(record.id) : null,
    hybrid_entity_key: record.hybrid_entity_key || null,
    vessel_name: record.vessel_name || null,
    normalized_vessel_name: normalizedName,
    call_sign: record.call_sign || null,
    gt: record.gt || null,
    vessel_type: record.vessel_type || null,
    vessel_type_group: record.vessel_type_group || null,
    port_code: record.port_code || null,
    commercial_value_score: commercialScore(record),
    data_confidence_score: numberValue(record.data_confidence_score),
    priority: recoveryPriority(record),
    status: "pending",
    attempt_count: 0,
    last_attempt_at: null,
    recovery_source: null,
    recovery_confidence: 0,
    payload: {
      queued_by: "daily_critical_info_enrichment",
      match_priority: [
        "call_sign_exact",
        "vessel_master_lookup",
        "vessel_aliases_lookup",
        "vessel_master_seed_csv",
        "normalized_vessel_name",
        "gt_similarity",
        "vessel_type_similarity",
        "vessel_spec_api_lookup"
      ],
      identity_confidence: identityConfidence(record)
    },
    created_at: now,
    updated_at: now
  };
}

function buildIdentityCandidate(record = {}, runId) {
  const confidence = identityConfidence(record);
  return {
    run_id: runId,
    hybrid_entity_key: record.hybrid_entity_key || null,
    vessel_id: record.hybrid_entity_key || record.master_vessel_id || null,
    raw_vessel_name: record.vessel_name || null,
    normalized_name: normalizeVesselName(record.vessel_name),
    call_sign: record.call_sign || null,
    mmsi: record.mmsi || null,
    gt: record.gt || null,
    port_code: record.port_code || null,
    likely_master_vessel_id: record.master_vessel_id || record.hybrid_entity_key || null,
    confidence,
    resolution_status: commercialScore(record) >= 35 || numberValue(record.gt) >= 5000 ? "daily_recovery_priority" : "unresolved",
    likely_imo_candidates: [],
    confidence_band: confidence >= 80 ? "strong_identifier" : confidence >= 60 ? "context_match" : confidence >= 40 ? "weak_fuzzy" : "unresolved",
    manual_review_required: commercialScore(record) >= 35 || numberValue(record.gt) >= 5000,
    payload: {
      queued_by: "daily_critical_info_enrichment",
      priority: recoveryPriority(record)
    }
  };
}

function buildAliasRow(record = {}, now) {
  return {
    alias_name: record.vessel_name,
    normalized_alias_name: normalizeVesselName(record.vessel_name),
    master_vessel_id: record.master_vessel_id || record.hybrid_entity_key,
    source: "daily_enrichment",
    confidence: identityConfidence(record),
    first_seen: now,
    last_seen: now
  };
}

function snapshotPatch(before = {}, after = {}) {
  const patch = {};
  for (const field of [
    "imo",
    "mmsi",
    "call_sign",
    "master_vessel_id",
    "operator_name",
    "owner_name",
    "manager_name",
    "operator_normalized",
    "operator_source",
    "operator_confidence",
    "vessel_type",
    "vessel_type_group",
    "gt"
  ]) {
    if (!hasValue(before[field]) && hasValue(after[field])) patch[field] = after[field];
  }
  if (Object.keys(patch).length) {
    patch.information_enrichment_needed = !patch.imo && !after.imo;
    patch.updated_at = new Date().toISOString();
  }
  return patch;
}

async function upsertRows(supabase, table, rows, options = {}) {
  const batchSize = Number(process.env.SUPABASE_BATCH_SIZE || 200);
  let saved = 0;
  for (let index = 0; index < rows.length; index += batchSize) {
    const batch = rows.slice(index, index + batchSize);
    if (!batch.length) continue;
    const query = options.onConflict
      ? supabase.from(table).upsert(batch, { onConflict: options.onConflict })
      : supabase.from(table).insert(batch);
    const { error } = await query;
    if (error) throw error;
    saved += batch.length;
  }
  return saved;
}

async function updateSnapshots(supabase, beforeRecords = [], afterRecords = []) {
  const byId = new Map(beforeRecords.map(record => [record.id, record]));
  let updated = 0;
  for (const after of afterRecords.slice(0, DAILY_ENRICHMENT_UPDATE_LIMIT)) {
    const before = byId.get(after.id);
    if (!before?.id) continue;
    const patch = snapshotPatch(before, after);
    if (!Object.keys(patch).length) continue;
    const { error } = await supabase.from("vessel_snapshots").update(patch).eq("id", before.id);
    if (error) throw error;
    updated += 1;
  }
  return updated;
}

async function main() {
  const runId = createRunId().replace("run_", "daily_enrich_");
  const now = new Date().toISOString();
  const supabase = getSupabase();

  const { records, activeRunId } = await loadCandidateSnapshots(supabase);
  const cacheResult = await enrichWithVesselMasterCache(records);
  const enrichedRecords = cacheResult.records;
  const historicalMatches = await loadHistoricalMatches(supabase, enrichedRecords);

  const matchRows = uniqueBy(enrichedRecords
    .map(record => buildMatchMemoryRow(record, runId, now, historicalMatchFor(record, historicalMatches)))
    .filter(row => row.match_score >= 40), row => row.match_id);
  const unresolved = enrichedRecords.filter(record => !record.imo || identityConfidence(record) < 80);
  const imoRows = uniqueBy(unresolved.map(record => buildImoRecoveryRow(record, runId, now)), row => row.recovery_id);
  const identityRows = unresolved.map(record => buildIdentityCandidate(record, runId));
  const aliasRows = uniqueBy(enrichedRecords
    .filter(record => record.vessel_name && (record.master_vessel_id || record.hybrid_entity_key))
    .map(record => buildAliasRow(record, now)), row => `${row.alias_name}|${row.master_vessel_id}|${row.source}`);

  const result = {
    run_id: runId,
    active_run_id: activeRunId,
    status: "success",
    scheduled_role: "daily_midnight_critical_info_enrichment",
    generated_at: now,
    input_rows: records.length,
    enriched_rows: enrichedRecords.length,
    vessel_master_cache: cacheResult.diagnostics,
    snapshot_rows_updated: 0,
    enrichment_match_candidates_saved: 0,
    imo_recovery_queue_saved: 0,
    identity_candidates_saved: 0,
    vessel_aliases_saved: 0,
    diagnostics: {
      daily_enrichment_limit: DAILY_ENRICHMENT_LIMIT,
      match_time_window_hours: MATCH_TIME_WINDOW_HOURS,
      strong_time_match_hours: STRONG_TIME_MATCH_HOURS,
      missing_imo_count: enrichedRecords.filter(record => !record.imo).length,
      operator_missing_count: enrichedRecords.filter(record => !record.operator_name && !record.operator).length,
      historical_match_reused_count: matchRows.filter(row => row.reused_historical_match).length,
      high_confidence_match_count: matchRows.filter(row => row.match_score >= 80).length,
      medium_confidence_match_count: matchRows.filter(row => row.match_score >= 60 && row.match_score < 80).length,
      low_confidence_match_count: matchRows.filter(row => row.match_score >= 40 && row.match_score < 60).length,
      critical_imo_recovery_count: imoRows.filter(row => row.priority === "CRITICAL").length,
      high_imo_recovery_count: imoRows.filter(row => row.priority === "HIGH").length
    }
  };

  result.snapshot_rows_updated = await updateSnapshots(supabase, records, enrichedRecords);
  result.enrichment_match_candidates_saved = await upsertRows(supabase, "enrichment_match_candidates", matchRows, { onConflict: "match_id" });
  result.imo_recovery_queue_saved = await upsertRows(supabase, "imo_recovery_queue", imoRows, { onConflict: "recovery_id" });
  result.identity_candidates_saved = await upsertRows(supabase, "vessel_identity_candidates", identityRows);
  result.vessel_aliases_saved = await upsertRows(supabase, "vessel_aliases", aliasRows, { onConflict: "alias_name,master_vessel_id,source" });

  ensureDir("dashboard/api");
  ensureDir("data");
  fs.writeFileSync("dashboard/api/daily-enrichment-runtime.json", JSON.stringify(result, null, 2));
  fs.writeFileSync("data/daily-enrichment-report.json", JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
