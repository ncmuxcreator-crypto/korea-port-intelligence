import { createClient } from "@supabase/supabase-js";
import ws from "ws";
import { createHash, randomUUID } from "node:crypto";

const COMMERCIAL_RULE_VERSION = process.env.COMMERCIAL_RULE_VERSION || "commercial_rules_v2026_05_31";
const CANDIDATE_RULE_VERSION = process.env.CANDIDATE_RULE_VERSION || "candidate_hybrid_percentile_v2026_05_31";
const EXPLAINABILITY_RULE_VERSION = process.env.EXPLAINABILITY_RULE_VERSION || "explainability_ko_v2026_05_31";

export function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }

  return createClient(url, key, {
    realtime: {
      transport: ws
    }
  });
}

export function createRunId() {
  return `run_${new Date().toISOString().replace(/[-:.TZ]/g, "")}_${randomUUID().slice(0, 8)}`;
}

function normalizeVesselName(value) {
  return String(value || "")
    .normalize("NFKC")
    .toUpperCase()
    .replace(/[^A-Z0-9\uAC00-\uD7A3]+/g, "");
}

function normalizeCompanyName(value) {
  return String(value || "")
    .normalize("NFKC")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, " ");
}

function stableEntityId(prefix, value) {
  const normalized = normalizeVesselName(value);
  return `${prefix}-${normalized || randomUUID().slice(0, 10)}`;
}

function stableHashId(prefix, value) {
  const hash = createHash("sha1")
    .update(String(value || "unknown"))
    .digest("hex")
    .slice(0, 16);
  return `${prefix}-${hash}`;
}

function fallbackMasterId(record = {}) {
  return record.master_vessel_id || record.hybrid_entity_key || record.vessel_id;
}

function commercialScore(record = {}) {
  return Number(record.commercial_value_score || record.total_sales_priority_score || record.cleaning_candidate_score || 0);
}

function isDepartedRecord(record = {}) {
  return String(record.status_bucket || record.operational_status || record.status || "").toLowerCase() === "departed" || Boolean(record.atd);
}

function isHardCandidateExcluded(record = {}) {
  const text = [record.vessel_name, record.name, record.source, record.source_name, record.data_mode, record.commercial_relevance_status, record.exclusion_reason]
    .filter(Boolean)
    .join(" ");
  return /sample|demo|fallback|synthetic/i.test(text) ||
    record.excluded_from_commercial_targets === true ||
    record.commercial_relevance_status === "excluded_non_commercial_type";
}

function hasCurrentOrNearTermWorkFeasibility(record = {}) {
  const status = String(record.status_bucket || record.operational_status || record.status || "").toLowerCase();
  return Number(record.work_feasibility_score || record.cleaning_window_score || 0) >= 35 ||
    Number(record.work_window_hours || record.predicted_work_window_hours || 0) > 0 ||
    ["arrived_staying", "berthed", "anchorage_waiting"].includes(status) ||
    Boolean(record.is_anchorage_waiting) ||
    (Number(record.stay_hours || record.cumulative_stay_hours || 0) > 0 && !record.atd);
}

function withinCommercialPercentile(record = {}, limit) {
  const global = Number(record.global_percentile);
  const port = Number(record.port_percentile);
  return (Number.isFinite(global) && global <= limit) || (Number.isFinite(port) && port <= limit);
}

function candidateExclusionReason(record = {}) {
  const score = commercialScore(record);
  if (isHardCandidateExcluded(record)) return record.exclusion_reason || record.commercial_relevance_status || "hard_excluded";
  if (isDepartedRecord(record)) return "departed_or_atd_present";
  if (score >= 75 && !hasCurrentOrNearTermWorkFeasibility(record)) return "missing_current_or_near_term_work_feasibility";
  if (score >= 75 && !withinCommercialPercentile(record, 10)) return "outside_immediate_top_10_percentile";
  if (score >= 65 && !withinCommercialPercentile(record, 20)) return "outside_sales_top_20_percentile";
  if (score >= 50 && !withinCommercialPercentile(record, 40)) return "outside_watchlist_top_40_percentile";
  return "";
}

function inferSummarySubPort(record = {}) {
  const text = [record.sub_port, record.sub_port_name, record.terminal_name, record.berth_name, record.anchorage_name, record.laidupFcltyNm, record.facility_name_raw, record.port_name, record.port]
    .filter(Boolean)
    .join(" ")
    .normalize("NFKC")
    .toLowerCase();
  if (/hadong|하동/.test(text)) return "하동항";
  if (/samcheonpo|삼천포/.test(text)) return "삼천포항";
  if (/masan|jinhae|마산|진해/.test(text)) return "마산·진해항";
  if (/tongyeong|통영/.test(text)) return "통영항";
  if (/geoje|okpo|고현|옥포|거제/.test(text)) return "거제·옥포항";
  if (/sokcho|속초/.test(text)) return "속초항";
  if (/boryeong|보령/.test(text)) return "보령항";
  if (/yeongheung|영흥/.test(text)) return "영흥 터미널";
  if (/taean|태안/.test(text)) return "태안 터미널";
  if (/dangjin industrial|당진 산업|당진화력|현대제철|당진항/.test(text)) return "당진 산업터미널";
  if (/pnit|pnc|hpnt|부산신항|신항|newport|pusan newport/.test(text)) return "부산신항";
  if (/감천|gamcheon/.test(text)) return "감천항";
  if (/신감만|감만|gamman/.test(text)) return "감만·신감만";
  return String(record.sub_port || "").trim();
}

function summaryPortUnit(record = {}) {
  const portCode = record.port_code || "";
  const subPort = inferSummarySubPort(record);
  const portName = subPort || record.port_name || record.port || portCode || "unknown";
  return {
    key: `${portCode || portName}|${subPort || ""}`,
    port_code: portCode || null,
    port_name: portName,
    port_group: record.port_name || record.port || portName,
    sub_port: subPort,
    display_scope: subPort ? "sub_port" : "representative_port"
  };
}

function isImmediateTargetRecord(record = {}) {
  if (isHardCandidateExcluded(record) || isDepartedRecord(record)) return false;
  if (record.is_immediate_candidate === true || ["critical", "immediate_target"].includes(record.candidate_band)) return true;
  return commercialScore(record) >= 75 && withinCommercialPercentile(record, 10) && hasCurrentOrNearTermWorkFeasibility(record);
}

function isSalesTargetRecord(record = {}) {
  if (isHardCandidateExcluded(record) || isDepartedRecord(record)) return false;
  if (isImmediateTargetRecord(record)) return true;
  if (["sales_target"].includes(record.candidate_band)) return true;
  return commercialScore(record) >= 65 && withinCommercialPercentile(record, 20);
}

function isWatchlistRecord(record = {}) {
  if (isHardCandidateExcluded(record) || isDepartedRecord(record)) return false;
  if (isSalesTargetRecord(record)) return false;
  const score = commercialScore(record);
  return score >= 50 && score < 65;
}

function imoRecoveryPriority(record = {}) {
  const score = commercialScore(record);
  const gt = Number(record.gt || record.grtg || record.intrlGrtg || 0);
  if (score >= 75) return "CRITICAL";
  if (gt > 30000) return "HIGH";
  if (gt >= 5000) return "MEDIUM";
  return "LOW";
}

function needsImoRecovery(record = {}) {
  if (record.imo) return false;
  const confidence = identityConfidence(record);
  return !record.vessel_master_cache_match ||
    confidence < 80 ||
    ["missing", "missing_recoverable", "missing_low_confidence", "unknown"].includes(String(record.imo_status || "").toLowerCase());
}

function buildImoRecoveryRows(records = [], runId, now) {
  return uniqueBy(records
    .filter(needsImoRecovery)
    .map(record => {
      const entityKey = record.hybrid_entity_key || record.vessel_id || `${record.vessel_name || "UNKNOWN"}-${record.port_code || ""}`;
      return {
        recovery_id: stableEntityId("IMOR", `${entityKey}-${record.port_code || ""}`),
        run_id: runId,
        master_vessel_id: fallbackMasterId(record),
        snapshot_id: record.snapshot_id || null,
        hybrid_entity_key: record.hybrid_entity_key || record.vessel_id || null,
        vessel_name: record.vessel_name || null,
        normalized_vessel_name: record.normalized_vessel_name || normalizeVesselName(record.vessel_name),
        call_sign: record.call_sign || null,
        gt: record.gt || record.grtg || record.intrlGrtg || null,
        vessel_type: record.vessel_type || null,
        vessel_type_group: record.vessel_type_group || null,
        port_code: record.port_code || null,
        commercial_value_score: commercialScore(record),
        data_confidence_score: Number(record.data_confidence_score || 0),
        priority: imoRecoveryPriority(record),
        status: "pending",
        attempt_count: Number(record.imo_recovery_attempt_count || 0),
        last_attempt_at: record.imo_recovery_last_attempt_at || null,
        updated_at: now,
        created_at: record.imo_recovery_created_at || now,
        recovery_source: record.imo_recovery_source || null,
        recovery_confidence: Number(record.imo_recovery_confidence || 0),
        payload: {
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
          imo_status: record.imo_status || "missing",
          identity_confidence: identityConfidence(record),
          reason_codes: record.reason_codes || [],
          vessel_master_cache_match: Boolean(record.vessel_master_cache_match),
          vessel_master_seed_match: Boolean(record.vessel_master_seed_match)
        }
      };
    }), row => row.recovery_id);
}

function buildImoRecoveryDiagnostics(records = []) {
  const queue = buildImoRecoveryRows(records, "diagnostic", new Date().toISOString());
  const target = records.filter(record => commercialScore(record) >= 35 || Number(record.gt || record.grtg || record.intrlGrtg || 0) >= 5000);
  const highValue = target.filter(record => commercialScore(record) >= 75 || Number(record.gt || record.grtg || record.intrlGrtg || 0) > 30000);
  const recovered = records.filter(record => record.imo && (record.imo_recovered_from_cache || record.imo_recovered_from_seed || record.vessel_master_seed_match || record.recovery_source));
  const denominator = recovered.length + queue.length;
  return {
    imo_recovery_queue_count: queue.length,
    imo_recovered_count: recovered.length,
    imo_recovery_success_rate: denominator ? Math.round((recovered.length / denominator) * 100) : 0,
    high_value_imo_coverage: highValue.length ? Math.round((highValue.filter(record => record.imo).length / highValue.length) * 100) : 0,
    unresolved_high_value_count: highValue.filter(record => !record.imo).length,
    call_sign_match_recovery_count: recovered.filter(record => /call.?sign/i.test(String(record.imo_recovery_source || record.identity_match_strategy || ""))).length,
    vessel_name_match_recovery_count: recovered.filter(record => /name|alias|seed/i.test(String(record.imo_recovery_source || record.identity_match_strategy || ""))).length,
    spec_api_recovery_count: recovered.filter(record => /spec/i.test(String(record.imo_recovery_source || record.recovery_source || ""))).length
  };
}

function unique(values = []) {
  return [...new Set(values.filter(value => value !== null && value !== undefined && String(value).trim() !== "").map(value => String(value).trim()))];
}

function chunk(values = [], size = 100) {
  const out = [];
  for (let index = 0; index < values.length; index += size) out.push(values.slice(index, index + size));
  return out;
}

function uniqueBy(values = [], keyFn) {
  const map = new Map();
  for (const value of values) {
    const key = keyFn(value);
    if (!key) continue;
    map.set(key, value);
  }
  return [...map.values()];
}

function dedupeForUpsert(values = [], keyFn, tableName, audit = {}) {
  const before = values.length;
  const deduped = uniqueBy(values, keyFn);
  const removed = before - deduped.length;
  if (removed > 0 && tableName) {
    audit[tableName] = {
      ...(audit[tableName] || {}),
      before,
      after: deduped.length,
      removed
    };
  }
  return deduped;
}

function dedupeRowsByConflictSpec(rows, onConflict, tableName, audit = {}) {
  if (!Array.isArray(rows) || !rows.length || !onConflict) return rows;
  const conflictKeys = String(onConflict)
    .split(",")
    .map(key => key.trim())
    .filter(Boolean);
  if (!conflictKeys.length) return rows;

  const passthroughRows = [];
  const keyedRows = new Map();
  for (const row of rows) {
    const values = conflictKeys.map(key => row?.[key]);
    if (values.some(value => value === null || value === undefined)) {
      passthroughRows.push(row);
      continue;
    }
    keyedRows.set(values.map(value => String(value)).join("\u001f"), row);
  }

  const deduped = [...passthroughRows, ...keyedRows.values()];
  const removed = rows.length - deduped.length;
  if (removed > 0 && tableName) {
    const auditKey = `${tableName}:${conflictKeys.join(",")}`;
    audit[auditKey] = {
      before: rows.length,
      after: deduped.length,
      removed,
      conflict_keys: conflictKeys
    };
  }
  return deduped;
}

const OPTIONAL_DB_WRITE_TABLES = new Set([
  "vessel_master",
  "operator_master",
  "agent_master",
  "agent_operator_links",
  "agent_operator_mapping",
  "contact_master",
  "vessel_operator_history",
  "operator_history",
  "operator_contact_history",
  "route_patterns",
  "vessel_route_history",
  "predicted_arrivals",
  "commercial_leads",
  "opportunity_master",
  "enrichment_match_candidates",
  "vessel_aliases",
  "vessel_identity_candidates",
  "imo_recovery_queue",
  "risk_history",
  "vessel_events",
  "pilot_schedule_events",
  "port_congestion_snapshots",
  "operator_fleet_opportunities",
  "feature_store",
  "feature_snapshots",
  "rule_evaluations",
  "explainability_snapshots",
  "route_graph_edges",
  "operator_graph_edges",
  "model_training_rows",
  "vessel_snapshot_daily",
  "port_snapshot_daily",
  "operator_snapshot_daily",
  "route_snapshot_daily",
  "commercial_opportunity_daily"
]);

function withDedupedUpserts(supabase, audit = {}) {
  return new Proxy(supabase, {
    get(target, property, receiver) {
      if (property !== "from") return Reflect.get(target, property, receiver);
      return tableName => {
        const builder = target.from(tableName);
        return new Proxy(builder, {
          get(query, queryProperty, queryReceiver) {
            if (!["upsert", "insert"].includes(queryProperty)) {
              const value = Reflect.get(query, queryProperty, queryReceiver);
              return typeof value === "function" ? value.bind(query) : value;
            }
            return async (rows, options = {}) => {
              const writeRows = queryProperty === "upsert"
                ? dedupeRowsByConflictSpec(rows, options?.onConflict, tableName, audit)
                : rows;
              const result = await query[queryProperty](writeRows, options);
              if (result?.error && OPTIONAL_DB_WRITE_TABLES.has(tableName)) {
                const optionalFailures = audit.optional_db_write_failures || {};
                optionalFailures[tableName] = [
                  ...(optionalFailures[tableName] || []),
                  {
                    operation: queryProperty,
                    rows: Array.isArray(writeRows) ? writeRows.length : writeRows ? 1 : 0,
                    error: compactDbError(result.error)
                  }
                ];
                audit.optional_db_write_failures = optionalFailures;
                console.warn(`[HWK] Optional DB write skipped: ${tableName}.${queryProperty}`, compactDbError(result.error));
                return { ...result, error: null };
              }
              return result;
            };
          }
        });
      };
    }
  });
}

function pickStaticFields(record = {}) {
  return {
    imo: record.imo || null,
    mmsi: record.mmsi || null,
    call_sign: record.call_sign || null,
    vessel_name: record.canonical_name || record.vessel_name || null,
    normalized_vessel_name: record.normalized_name || normalizeVesselName(record.canonical_name || record.vessel_name),
    vessel_type: record.vessel_type || null,
    vessel_type_group: record.vessel_type_group || null,
    gt: record.gt || null,
    dwt: record.dwt || null,
    loa: record.loa || null,
    beam: record.beam || null,
    operator: record.operator || null,
    operator_normalized: record.operator_normalized || null,
    flag: record.flag || null,
    master_vessel_id: record.master_vessel_id || null,
    identity_confidence: Number(record.identity_confidence || 0),
    imo_status: record.imo_status || (record.imo ? "present" : null)
  };
}

function mergeCachedStaticInfo(record = {}, cached = {}, strategy = "unknown") {
  const beforeHadImo = Boolean(record.imo);
  const merged = {
    ...record,
    imo: record.imo || cached.imo || "",
    mmsi: record.mmsi || cached.mmsi || "",
    call_sign: record.call_sign || cached.call_sign || "",
    vessel_name: record.vessel_name || cached.vessel_name || "",
    normalized_vessel_name: record.normalized_vessel_name || cached.normalized_vessel_name || normalizeVesselName(record.vessel_name || cached.vessel_name),
    vessel_type: record.vessel_type || cached.vessel_type || "",
    vessel_type_group: record.vessel_type_group || cached.vessel_type_group || "",
    gt: record.gt || cached.gt || 0,
    dwt: record.dwt || cached.dwt || 0,
    loa: record.loa || cached.loa || 0,
    beam: record.beam || cached.beam || 0,
    operator: record.operator || cached.operator || "",
    operator_name: record.operator_name || record.operator || cached.operator || "",
    operator_normalized: record.operator_normalized || cached.operator_normalized || "",
    operator_source: record.operator_source || (cached.operator ? "vessel_master" : ""),
    operator_confidence: Math.max(Number(record.operator_confidence || 0), cached.operator ? 95 : 0),
    operator_inferred: record.operator_inferred ?? false,
    flag: record.flag || cached.flag || "",
    master_vessel_id: cached.master_vessel_id || record.master_vessel_id,
    vessel_master_cache_match: true,
    vessel_master_cache_strategy: strategy,
    vessel_master_cache_confidence: cached.identity_confidence || record.identity_confidence || 0,
    reference_enriched: true,
    imo_status: record.imo_status || cached.imo_status || (cached.imo ? "present" : undefined),
    reason_codes: [...new Set([...(record.reason_codes || []), "MASTER_DB_MATCH_FOUND"])]
  };
  if (!beforeHadImo && cached.imo) {
    merged.imo_recovered_from_cache = true;
    merged.imo_recovery_source = "vessel_master_cache";
  }
  return merged;
}

async function selectIn(supabase, table, columns, field, values) {
  const rows = [];
  for (const part of chunk(unique(values), 100)) {
    if (!part.length) continue;
    const { data, error } = await supabase.from(table).select(columns).in(field, part);
    if (error) throw error;
    rows.push(...(data || []));
  }
  return rows;
}

export async function enrichWithVesselMasterCache(records = []) {
  const diagnostics = {
    enabled: false,
    status: "not_configured",
    input_rows: records.length,
    master_rows_loaded: 0,
    alias_rows_loaded: 0,
    matched_rows: 0,
    imo_recovered_count: 0,
    strategies: {}
  };
  if (!records.length || !process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { records, diagnostics };
  }

  try {
    diagnostics.enabled = true;
    diagnostics.status = "loading";
    const supabase = getSupabase();
    const normalizedRecords = records.map(record => ({
      ...record,
      normalized_vessel_name: record.normalized_vessel_name || normalizeVesselName(record.vessel_name)
    }));
    const imos = unique(normalizedRecords.map(record => record.imo));
    const mmsis = unique(normalizedRecords.map(record => record.mmsi));
    const callSigns = unique(normalizedRecords.map(record => record.call_sign));
    const names = unique(normalizedRecords.map(record => record.normalized_vessel_name));
    const columns = "master_vessel_id,imo,mmsi,call_sign,canonical_name,normalized_name,vessel_type,vessel_type_group,gt,dwt,loa,beam,operator,operator_normalized,flag,identity_confidence,imo_status";

    const masterRows = [
      ...(await selectIn(supabase, "vessel_master", columns, "imo", imos)),
      ...(await selectIn(supabase, "vessel_master", columns, "mmsi", mmsis)),
      ...(await selectIn(supabase, "vessel_master", columns, "call_sign", callSigns)),
      ...(await selectIn(supabase, "vessel_master", columns, "normalized_name", names))
    ];
    const byMasterId = new Map();
    for (const row of masterRows) if (row.master_vessel_id) byMasterId.set(row.master_vessel_id, pickStaticFields(row));

    const aliasRows = await selectIn(supabase, "vessel_aliases", "master_vessel_id,alias_name,normalized_alias_name,confidence", "normalized_alias_name", names);
    const aliasMasterRows = await selectIn(supabase, "vessel_master", columns, "master_vessel_id", aliasRows.map(row => row.master_vessel_id));
    for (const row of aliasMasterRows) if (row.master_vessel_id) byMasterId.set(row.master_vessel_id, pickStaticFields(row));

    diagnostics.master_rows_loaded = byMasterId.size;
    diagnostics.alias_rows_loaded = aliasRows.length;

    const byImo = new Map();
    const byMmsi = new Map();
    const byCallSign = new Map();
    const byNameGtType = new Map();
    const byAlias = new Map();
    for (const row of byMasterId.values()) {
      if (row.imo) byImo.set(String(row.imo), row);
      if (row.mmsi) byMmsi.set(String(row.mmsi), row);
      if (row.call_sign) byCallSign.set(String(row.call_sign), row);
      const key = `${row.normalized_vessel_name || ""}|${Number(row.gt || 0)}|${row.vessel_type_group || row.vessel_type || ""}`.toUpperCase();
      if (row.normalized_vessel_name && Number(row.gt || 0) > 0) byNameGtType.set(key, row);
    }
    for (const alias of aliasRows) {
      const master = byMasterId.get(alias.master_vessel_id);
      if (master && alias.normalized_alias_name) byAlias.set(String(alias.normalized_alias_name), master);
    }

    const enriched = normalizedRecords.map(record => {
      const nameGtTypeKey = `${record.normalized_vessel_name || ""}|${Number(record.gt || 0)}|${record.vessel_type_group || record.vessel_type || ""}`.toUpperCase();
      const candidates = [
        ["imo_exact_cache", record.imo && byImo.get(String(record.imo))],
        ["mmsi_exact_cache", record.mmsi && byMmsi.get(String(record.mmsi))],
        ["call_sign_exact_cache", record.call_sign && byCallSign.get(String(record.call_sign))],
        ["name_gt_type_cache", byNameGtType.get(nameGtTypeKey)],
        ["alias_name_cache", record.normalized_vessel_name && byAlias.get(String(record.normalized_vessel_name))]
      ];
      const [strategy, cached] = candidates.find(([, value]) => value) || [];
      if (!cached) return record;
      diagnostics.matched_rows += 1;
      diagnostics.strategies[strategy] = (diagnostics.strategies[strategy] || 0) + 1;
      if (!record.imo && cached.imo) diagnostics.imo_recovered_count += 1;
      return mergeCachedStaticInfo(record, cached, strategy);
    });

    diagnostics.status = "loaded";
    return { records: enriched, diagnostics };
  } catch (error) {
    diagnostics.status = "failed";
    diagnostics.error = error?.message || String(error);
    return { records, diagnostics };
  }
}

function identityConfidence(record = {}) {
  if (typeof record.identity_confidence === "number") return record.identity_confidence;
  if (record.identification_method === "IMO") return 100;
  if (record.identification_method === "MMSI") return 88;
  if (record.identification_method === "CALLSIGN_EXACT") return 85;
  if (record.identification_method === "NORMALIZED_NAME_GT_TYPE") return 65;
  if (record.identification_method === "FUZZY_NAME_PORT") return 45;
  return 25;
}

function shouldPromoteRun(records = [], diagnostics = {}) {
  const attempted = Number(diagnostics.attempted_count || 0);
  const portOperationSuccess = (diagnostics.sources || []).filter(source =>
    String(source.key || "").startsWith("port_operation_") && source.success && Number(source.normalized_count || 0) > 0
  ).length;
  const parseFailures = Number(diagnostics.failed_count || 0);
  const totalFinished = Number(diagnostics.success_count || 0) + parseFailures;
  const parseErrorRate = totalFinished ? parseFailures / totalFinished : 0;
  const malformedRows = (diagnostics.sources || []).reduce((sum, source) => sum + Number(source.detail_rows_missing_time_count || 0), 0);
  const normalizedRows = Math.max(1, Number(records.length || diagnostics.real_row_count || 0));
  const malformedRowRate = malformedRows / normalizedRows;
  const salesTargets = records.filter(isSalesTargetRecord).length;
  const targetRatio = records.length ? salesTargets / records.length : 0;
  const architectureDiagnostics = buildPortCallArchitectureDiagnostics(records);
  const validationMode = String(process.env.VALIDATION_MODE || (process.env.CI === "true" ? "production" : "local")).toLowerCase();
  const fallbackUsed = diagnostics.fallback_used === true;
  const dataMode = String(diagnostics.data_mode || diagnostics.data_mode_detail?.mode || "").toLowerCase();
  const lastSuccessfulDatasetLock = records.length <= 0 ||
    fallbackUsed ||
    dataMode === "no_live_data" ||
    dataMode === "degraded_sample_only";
  const validationGates = {
    last_successful_dataset_lock_clear: !lastSuccessfulDatasetLock,
    no_live_data_not_promotable: records.length > 0 && dataMode !== "no_live_data",
    degraded_sample_only_not_promotable: !fallbackUsed && dataMode !== "degraded_sample_only",
    all_vessels_count_positive: records.length > 0,
    port_call_master_count_positive: architectureDiagnostics.port_call_master_count > 0,
    port_call_id_coverage_above_threshold: architectureDiagnostics.port_call_id_coverage >= Number(process.env.PORT_CALL_ID_COVERAGE_MIN || 0.8),
    candidate_band_exists_for_scored_vessels: architectureDiagnostics.scored_vessels_missing_candidate_band_count === 0,
    port_operation_success_count: portOperationSuccess,
    malformed_row_rate_below_threshold: malformedRowRate < Number(process.env.MALFORMED_ROW_RATE_THRESHOLD || 0.35),
    target_ratio_reasonable: targetRatio <= Number(process.env.TARGET_RATIO_MAX || 0.3),
    no_fatal_db_write_error: diagnostics.fatal_db_write_error !== true
  };
  return {
    promotable: !lastSuccessfulDatasetLock &&
      attempted > 0 &&
      portOperationSuccess >= 1 &&
      records.length > 0 &&
      records.filter(r => ["target_vessel", "unknown_gt_review"].includes(r.commercial_relevance_status)).length > 0 &&
      parseErrorRate < 0.5 &&
      validationGates.port_call_master_count_positive &&
      validationGates.port_call_id_coverage_above_threshold &&
      validationGates.candidate_band_exists_for_scored_vessels &&
      validationGates.malformed_row_rate_below_threshold &&
      validationGates.target_ratio_reasonable &&
      validationGates.no_fatal_db_write_error,
    attempted,
    validation_mode: validationMode,
    portOperationSuccess,
    parseErrorRate,
    malformedRowRate,
    targetRatio,
    target_ratio_max: Number(process.env.TARGET_RATIO_MAX || 0.3),
    target_ratio_warning: targetRatio > Number(process.env.TARGET_RATIO_MAX || 0.3) ? "Target qualification is too broad." : "",
    last_successful_dataset_lock: {
      locked: lastSuccessfulDatasetLock,
      reason: records.length <= 0
        ? "empty_dataset"
        : fallbackUsed
          ? "collector_fallback_used"
          : dataMode === "no_live_data"
            ? "no_live_data"
            : dataMode === "degraded_sample_only"
              ? "degraded_sample_only"
              : null,
      record_count: records.length,
      all_vessels_count: records.length,
      data_mode: dataMode || null,
      fallback_used: fallbackUsed,
      action: lastSuccessfulDatasetLock
        ? "keep_serving_last_successful_dataset"
        : "eligible_for_promotion_checks"
    },
    ...architectureDiagnostics,
    validationGates,
    promotion_blockers: Object.entries(validationGates).filter(([, value]) => value === false).map(([key]) => key)
  };
}

function buildPortCallArchitectureDiagnostics(records = []) {
  const usefulRecords = records.filter(record => record.vessel_name || record.hybrid_entity_key || record.port_call_identity || record.port_call_key);
  const portCallRows = uniqueBy(usefulRecords.filter(record => record.port_code || record.port).map(record => ({
    port_call_id: buildPortCallId(record)
  })), row => row.port_call_id);
  const portCallIdRows = usefulRecords.filter(record => buildPortCallId(record));
  const scoredRecords = usefulRecords.filter(record =>
    commercialScore(record) > 0 ||
    scoreNumber(record.total_sales_priority_score) > 0 ||
    scoreNumber(record.predicted_cleaning_opportunity_score) > 0
  );
  const missingCandidateBand = scoredRecords.filter(record => !record.candidate_band && !record.sales_priority_band);
  const opportunityRecords = usefulRecords.filter(isOpportunityEligible);
  const explainedRecords = usefulRecords.filter(record =>
    record.why_now ||
    record.why_scored_high ||
    record.candidate_summary_ko ||
    (Array.isArray(record.reason_codes) && record.reason_codes.length) ||
    (Array.isArray(record.score_reasons) && record.score_reasons.length)
  );
  return {
    all_vessels_count: usefulRecords.length,
    port_call_master_count: portCallRows.length,
    port_call_id_coverage: usefulRecords.length ? Math.round((portCallIdRows.length / usefulRecords.length) * 1000) / 1000 : 0,
    scored_vessels_count: scoredRecords.length,
    scored_vessels_missing_candidate_band_count: missingCandidateBand.length,
    candidate_band_coverage: scoredRecords.length ? Math.round(((scoredRecords.length - missingCandidateBand.length) / scoredRecords.length) * 1000) / 1000 : 1,
    opportunity_created_count: opportunityRecords.length,
    explainability_generated_count: explainedRecords.length,
    high_score_without_explanation_count: usefulRecords.filter(record =>
      commercialScore(record) >= 75 &&
      !record.why_now &&
      !record.why_scored_high &&
      !record.candidate_summary_ko &&
      !(Array.isArray(record.reason_codes) && record.reason_codes.length) &&
      !(Array.isArray(record.score_reasons) && record.score_reasons.length)
    ).length
  };
}

function aggregatePortSummaryRows(portRows = []) {
  const grouped = new Map();
  for (const row of portRows) {
    const groupName = row.port_group || row.port_name || row.port_code || "항만 확인 필요";
    const key = `${row.port_code || groupName}|${groupName}`;
    const current = grouped.get(key) || {
      port_unit_key: key,
      port_code: row.port_code || null,
      port_name: groupName,
      port_group: groupName,
      sub_port: "",
      display_scope: "representative_port_aggregate",
      total_vessels: 0,
      target_vessels: 0,
      sales_targets: 0,
      sales_candidates: 0,
      immediate_targets: 0,
      anchorage_vessels: 0,
      long_stay_vessels: 0,
      port_opportunity_score: 0,
      child_units: []
    };
    for (const field of ["total_vessels", "target_vessels", "sales_targets", "sales_candidates", "immediate_targets", "anchorage_vessels", "long_stay_vessels"]) {
      current[field] += scoreNumber(row[field]);
    }
    if (scoreNumber(row.total_vessels) > 0 && row.sub_port) {
      current.child_units.push({
        port_name: row.port_name,
        sub_port: row.sub_port,
        total_vessels: row.total_vessels,
        target_vessels: row.target_vessels,
        sales_targets: row.sales_targets,
        anchorage_vessels: row.anchorage_vessels
      });
    }
    grouped.set(key, current);
  }
  return [...grouped.values()].map(row => ({
    ...row,
    child_units: row.child_units.sort((a, b) => scoreNumber(b.total_vessels) - scoreNumber(a.total_vessels)).slice(0, 5),
    port_opportunity_score: Math.min(100, Math.round(
      average([row.target_vessels, row.sales_targets * 10, row.immediate_targets * 20, row.anchorage_vessels * 2, row.long_stay_vessels * 3])
    ))
  })).filter(row => row.total_vessels > 0 || row.target_vessels > 0).sort((a, b) =>
    b.port_opportunity_score - a.port_opportunity_score ||
    b.target_vessels - a.target_vessels ||
    b.total_vessels - a.total_vessels
  );
}

function buildDashboardSummarySnapshot(records = [], runId, now, diagnostics = {}) {
  const usefulRecords = records.filter(record => record.vessel_name || record.hybrid_entity_key || record.port_call_identity || record.port_call_key);
  const targetRows = usefulRecords.filter(record => ["target_vessel", "unknown_gt_review"].includes(record.commercial_relevance_status) || isSalesTargetRecord(record) || isImmediateTargetRecord(record));
  const salesRows = usefulRecords.filter(isSalesTargetRecord);
  const immediateRows = usefulRecords.filter(isImmediateTargetRecord);
  const watchlistRows = usefulRecords.filter(isWatchlistRecord);
  const portGroups = groupBy(usefulRecords, record => summaryPortUnit(record).key);
  const portUnitSummary = [...portGroups.entries()].map(([portKey, rows]) => ({
    port_unit_key: portKey,
    port_code: summaryPortUnit(rows[0]).port_code || portKey,
    port_name: summaryPortUnit(rows[0]).port_name,
    port_group: summaryPortUnit(rows[0]).port_group,
    sub_port: summaryPortUnit(rows[0]).sub_port,
    display_scope: summaryPortUnit(rows[0]).display_scope,
    total_vessels: rows.length,
    target_vessels: rows.filter(row => targetRows.includes(row)).length,
    sales_targets: rows.filter(isSalesTargetRecord).length,
    immediate_targets: rows.filter(isImmediateTargetRecord).length,
    anchorage_vessels: rows.filter(row => row.is_anchorage_waiting || scoreNumber(row.anchorage_hours) > 0).length,
    long_stay_vessels: rows.filter(row => scoreNumber(row.stay_hours) >= 168 || scoreNumber(row.anchorage_hours) >= 168).length,
    port_opportunity_score: Math.min(100, Math.round(average(rows.map(commercialScore)) + rows.filter(isImmediateTargetRecord).length * 5))
  })).sort((a, b) => b.port_opportunity_score - a.port_opportunity_score || b.target_vessels - a.target_vessels);
  const portSummary = aggregatePortSummaryRows(portUnitSummary);
  const topImmediate = [...immediateRows].sort((a, b) => commercialScore(b) - commercialScore(a)).slice(0, 5);
  const topSales = [...salesRows].filter(row => !isImmediateTargetRecord(row)).sort((a, b) => commercialScore(b) - commercialScore(a)).slice(0, 5);
  return {
    snapshot_id: stableEntityId("DSUM", runId),
    run_id: runId,
    generated_at: now,
    status: "success",
    is_latest_successful: true,
    record_count: targetRows.length,
    all_vessels_count: usefulRecords.length,
    target_vessels_count: targetRows.length,
    sales_target_count: salesRows.length,
    immediate_target_count: immediateRows.length,
    opportunity_count: salesRows.length + immediateRows.length,
    watchlist_count: watchlistRows.length,
    port_count: portSummary.filter(port => port.total_vessels > 0).length,
    port_summary: portSummary.slice(0, 40),
    candidate_summary: {
      immediate_targets: topImmediate.map(summaryVesselRow),
      opportunities: topSales.map(summaryVesselRow),
      sales_target_count: salesRows.length,
      immediate_target_count: immediateRows.length,
      watchlist_count: watchlistRows.length
    },
    congestion_summary: {
      ports: portSummary.filter(port => port.anchorage_vessels || port.long_stay_vessels).slice(0, 20),
      anchorage_vessels: usefulRecords.filter(row => row.is_anchorage_waiting || scoreNumber(row.anchorage_hours) > 0).length,
      long_stay_vessels: usefulRecords.filter(row => scoreNumber(row.stay_hours) >= 168 || scoreNumber(row.anchorage_hours) >= 168).length
    },
    data_quality_summary: {
      imo_coverage: coverageRatio(usefulRecords, record => record.imo),
      gt_coverage: coverageRatio(usefulRecords, record => record.gt || record.grtg || record.intrlGrtg),
      call_sign_coverage: coverageRatio(usefulRecords, record => record.call_sign || record.clsgn),
      operator_coverage: coverageRatio(usefulRecords, record => record.operator_name || record.operator),
      agent_coverage: coverageRatio(usefulRecords, record => record.agent_name || record.agent || record.satmntEntrpsNm || record.entrpsCdNm)
    },
    source_health_summary: {
      attempted_count: diagnostics.attempted_count || 0,
      success_count: diagnostics.success_count || 0,
      failed_count: diagnostics.failed_count || 0,
      port_operation_success_count: (diagnostics.sources || []).filter(source =>
        String(source.key || "").startsWith("port_operation_") && source.success && Number(source.normalized_count || 0) > 0
      ).length
    },
    created_at: now
  };
}

function currentCandidateRow(record = {}, runId, now, prefix) {
  const portCallId = buildPortCallId(record);
  return {
    current_id: stableEntityId(prefix, `${runId}-${portCallId}-${record.hybrid_entity_key || record.vessel_id || record.vessel_name || ""}`),
    run_id: runId,
    port_call_id: portCallId,
    master_vessel_id: fallbackMasterId(record) || null,
    vessel_name: record.vessel_name || record.name || null,
    port_code: record.port_code || null,
    port_name: record.port_name || record.port || null,
    commercial_value_score: commercialScore(record),
    candidate_band: candidateLabel(record),
    payload: summaryVesselRow(record),
    is_current: true,
    updated_at: now
  };
}

function buildCurrentMaterializedRows(records = [], runId, now, summarySnapshot = null) {
  const salesRows = records.filter(isSalesTargetRecord);
  const immediateRows = records.filter(isImmediateTargetRecord);
  const summary = summarySnapshot || buildDashboardSummarySnapshot(records, runId, now);
  return {
    salesCandidates: uniqueBy(salesRows.map(record => currentCandidateRow(record, runId, now, "SCUR")), row => row.current_id),
    immediateTargets: uniqueBy(immediateRows.map(record => currentCandidateRow(record, runId, now, "ICUR")), row => row.current_id),
    portSummaries: uniqueBy((summary.port_summary || []).map(port => ({
      port_unit_key: port.port_unit_key || stableEntityId("PORTCUR", `${port.port_code || ""}-${port.sub_port || port.port_name || ""}`),
      run_id: runId,
      port_code: port.port_code || null,
      port_name: port.port_name || port.port_name_ko || null,
      port_group: port.port_group || port.port_name || null,
      sub_port: port.sub_port || null,
      display_scope: port.display_scope || (port.sub_port ? "sub_port" : "representative_port"),
      tier: scoreNumber(port.tier || 99),
      total_vessels: scoreNumber(port.total_vessels || port.vessel_count),
      target_vessels: scoreNumber(port.target_vessels || port.target_vessel_count),
      sales_candidates: scoreNumber(port.sales_candidates || port.sales_targets),
      immediate_targets: scoreNumber(port.immediate_targets || port.immediate_target_count),
      anchorage_vessels: scoreNumber(port.anchorage_vessels),
      long_stay_vessels: scoreNumber(port.long_stay_vessels || port.long_idle_vessels),
      port_opportunity_score: scoreNumber(port.port_opportunity_score),
      payload: port,
      is_current: true,
      updated_at: now
    })), row => row.port_unit_key)
  };
}

function summaryVesselRow(record = {}) {
  return {
    vessel_name: record.vessel_name || null,
    port_code: record.port_code || null,
    port_name: record.port_name || record.port || null,
    operator_name: record.operator_name || record.operator || null,
    agent_name: record.agent_name || record.agent || record.satmntEntrpsNm || record.entrpsCdNm || null,
    gt: scoreNumber(record.gt || record.grtg || record.intrlGrtg),
    vessel_type_group: record.vessel_type_group || record.vessel_type || null,
    commercial_value_score: commercialScore(record),
    candidate_band: candidateLabel(record),
    why_now: record.why_now || record.candidate_summary_ko || null,
    recommended_action: record.recommended_action || record.recommended_next_action || null
  };
}

function coverageRatio(records = [], predicate) {
  if (!records.length) return 0;
  const covered = records.filter(record => {
    const value = predicate(record);
    return value !== undefined && value !== null && String(value).trim() !== "";
  }).length;
  return Math.round((covered / records.length) * 1000) / 10;
}

function blockPromotion(promotion, gateName, warning) {
  promotion.promotable = false;
  promotion.validationGates = { ...(promotion.validationGates || {}), [gateName]: false };
  promotion.promotion_blockers = [...new Set([...(promotion.promotion_blockers || []), gateName])];
  if (warning) {
    promotion.validation_warnings = [...new Set([...(promotion.validation_warnings || []), warning])];
  }
}

function scoreNumber(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

function hasValue(value) {
  return value !== null && value !== undefined && String(value).trim() !== "";
}

function candidateLabel(record = {}) {
  const score = commercialScore(record);
  if (record.candidate_band) return record.candidate_band;
  if (isImmediateTargetRecord(record)) return score >= 90 ? "critical" : "immediate_target";
  if (isSalesTargetRecord(record)) return "sales_target";
  if (isWatchlistRecord(record)) return "watchlist";
  if (score >= 75) return "immediate_target";
  if (score >= 65) return "sales_target";
  if (score >= 50) return "watchlist";
  return "general";
}

function opportunityState(record = {}) {
  const explicit = String(record.opportunity_status || record.opportunity_state || record.lead_status || "").toLowerCase();
  if (["won", "lost", "closed", "scheduled", "quoted", "contacted", "contact_ready", "qualified", "identified", "monitor"].includes(explicit)) return explicit;
  if (record.quote_status && !["not_started", "none", "unknown"].includes(String(record.quote_status).toLowerCase())) return "quoted";
  if (record.last_contacted_at) return "contacted";
  if (scoreNumber(record.contact_readiness_score) >= 60 || record.contact_path_available || ["contact_available", "high_confidence_contact"].includes(record.contact_path_status)) return "contact_ready";
  if (commercialScore(record) >= 65 || scoreNumber(record.predicted_cleaning_opportunity_score) >= 60) return "qualified";
  if (commercialScore(record) >= 50 || scoreNumber(record.predicted_cleaning_opportunity_score) >= 40) return "monitor";
  return "identified";
}

function opportunityTimestampFields(state, record = {}, now) {
  return {
    qualified_at: ["qualified", "contact_ready", "contacted", "quoted", "scheduled", "won", "lost", "closed"].includes(state) ? now : null,
    contact_ready_at: ["contact_ready", "contacted", "quoted", "scheduled", "won", "lost", "closed"].includes(state) ? now : null,
    contacted_at: ["contacted", "quoted", "scheduled", "won", "lost", "closed"].includes(state) ? (record.last_contacted_at || now) : null,
    quoted_at: ["quoted", "scheduled", "won", "lost", "closed"].includes(state) ? now : null,
    scheduled_at: ["scheduled", "won"].includes(state) ? now : null,
    closed_at: ["won", "lost", "closed"].includes(state) ? now : null
  };
}

function opportunityType(record = {}) {
  const explicit = String(record.opportunity_type || "").trim();
  if (explicit) return explicit;
  if (scoreNumber(record.predicted_cleaning_opportunity_score) >= 60) return "predicted_hull_cleaning";
  return "hull_cleaning";
}

function buildOpportunityId(record = {}) {
  return stableEntityId("OPPTY", `${buildPortCallId(record)}-${opportunityType(record)}`);
}

function isOpportunityEligible(record = {}) {
  const band = candidateLabel(record);
  const state = opportunityState(record);
  return ["immediate_target", "sales_target"].includes(band) ||
    commercialScore(record) >= 65 ||
    scoreNumber(record.predicted_cleaning_opportunity_score) >= 60 ||
    ["identified", "qualified", "contact_ready", "contacted", "quoted", "scheduled", "won", "lost", "monitor", "closed"].includes(state);
}

function buildFoundationFeatureVector(record = {}) {
  const operatorScore = Math.max(
    scoreNumber(record.operator_score),
    scoreNumber(record.operator_confidence),
    scoreNumber(record.contact_readiness_score),
    record.operator_name || record.operator ? 45 : 0
  );
  return {
    gt: scoreNumber(record.gt || record.grtg || record.intrlGrtg),
    vessel_type: record.vessel_type || record.vsslKndNm || null,
    vessel_type_group: record.vessel_type_group || null,
    commercial_value_score: commercialScore(record),
    work_feasibility_score: scoreNumber(record.work_feasibility_score),
    congestion_score: scoreNumber(record.congestion_score || record.port_congestion_score),
    biofouling_exposure_score: scoreNumber(record.biofouling_exposure_score || record.biofouling_risk_score),
    performance_proxy_score: scoreNumber(record.performance_proxy_score),
    operator_score: Math.min(100, operatorScore),
    contact_readiness_score: scoreNumber(record.contact_readiness_score),
    data_quality_score: scoreNumber(record.data_quality_score || record.data_confidence_score),
    arrival_opportunity_score: scoreNumber(record.arrival_opportunity_score),
    anchorage_probability: scoreNumber(record.anchorage_probability),
    repeat_caller_score: scoreNumber(record.repeat_caller_score),
    repeat_operator_score: scoreNumber(record.repeat_operator_score),
    stay_hours: scoreNumber(record.stay_hours),
    anchorage_hours: scoreNumber(record.anchorage_hours),
    work_window_hours: scoreNumber(record.work_window_hours || record.predicted_work_window_hours),
    has_imo: Boolean(record.imo),
    has_call_sign: Boolean(record.call_sign),
    has_operator: Boolean(record.operator_name || record.operator),
    has_agent: Boolean(record.agent_name || record.agent || record.satmntEntrpsNm || record.entrpsCdNm),
    has_contact_path: Boolean(record.contact_path_available || record.contact_path_status === "contact_available"),
    status_bucket: record.status_bucket || null,
    facility_type: record.facility_type || null,
    route_region: record.route_region || null
  };
}

function buildFoundationLabels(record = {}) {
  const score = commercialScore(record);
  return {
    candidate_band: candidateLabel(record),
    is_watchlist: score >= 50,
    is_sales_target: score >= 65,
    is_immediate_target: score >= 75,
    lead_status: record.lead_status || "monitor",
    contact_priority: record.contact_priority || "LOW",
    cleaning_opportunity_band: record.cleaning_opportunity_band || null,
    biofouling_exposure_band: record.biofouling_exposure_band || null
  };
}

function buildScoreComponents(record = {}) {
  const routePressure = Math.max(
    scoreNumber(record.route_pressure_score),
    scoreNumber(record.route_bonus_score || record.route_bonus),
    scoreNumber(record.compliance_pressure_score)
  );
  return {
    commercial_value_score: commercialScore(record),
    vessel_value: scoreNumber(record.vessel_value_score || record.commercial_fit_score),
    work_feasibility: scoreNumber(record.work_feasibility_score || record.cleaning_window_score),
    congestion_exposure: scoreNumber(record.congestion_score || record.port_congestion_score || record.congestion_exposure_score),
    biofouling_exposure: scoreNumber(record.biofouling_exposure_score || record.biofouling_risk_score || record.biofouling_score),
    route_pressure: routePressure,
    contact_readiness: scoreNumber(record.contact_readiness_score || record.sales_accessibility_score),
    data_confidence: scoreNumber(record.data_confidence_score || record.data_quality_score),
    vessel_value_score: scoreNumber(record.vessel_value_score || record.commercial_fit_score),
    work_feasibility_score: scoreNumber(record.work_feasibility_score || record.cleaning_window_score),
    congestion_score: scoreNumber(record.congestion_score || record.port_congestion_score || record.congestion_exposure_score),
    biofouling_exposure_score: scoreNumber(record.biofouling_exposure_score || record.biofouling_risk_score || record.biofouling_score),
    performance_proxy_score: scoreNumber(record.performance_proxy_score),
    compliance_pressure_score: routePressure,
    contact_readiness_score: scoreNumber(record.contact_readiness_score || record.sales_accessibility_score),
    data_confidence_score: scoreNumber(record.data_confidence_score || record.data_quality_score),
    repeat_caller_score: scoreNumber(record.repeat_caller_score),
    operator_score: Math.min(100, Math.max(
      scoreNumber(record.operator_score),
      scoreNumber(record.operator_confidence),
      scoreNumber(record.contact_readiness_score),
      record.operator_name || record.operator ? 45 : 0
    )),
    predicted_cleaning_opportunity_score: scoreNumber(record.predicted_cleaning_opportunity_score)
  };
}

function buildScoreReasons(record = {}) {
  const reasons = [];
  const gt = scoreNumber(record.gt || record.grtg || record.intrlGrtg);
  const type = String(record.vessel_type_group || record.vessel_type || "").replace(/_/g, " ");
  const anchorageDays = scoreNumber(record.anchorage_hours) / 24;
  const stayDays = scoreNumber(record.stay_hours) / 24;

  if (gt >= 5000) reasons.push(`GT ${Math.round(gt).toLocaleString("en-US")}급 대상 선박`);
  if (type) reasons.push(`${type} 선종`);
  if (anchorageDays >= 1) reasons.push(`묘박/대기 ${Math.round(anchorageDays * 10) / 10}일`);
  if (stayDays >= 2) reasons.push(`항만 체류 ${Math.round(stayDays * 10) / 10}일`);
  if (record.pilot_outbound_missing || record.no_outbound_pilot || record.work_window_status === "open_or_ongoing") reasons.push("출항 도선 미확인 또는 작업창 열림");
  if (scoreNumber(record.work_feasibility_score) >= 60) reasons.push("작업 가능성 높음");
  if (scoreNumber(record.congestion_score || record.port_congestion_score) >= 50) reasons.push("체선/대기 노출 확인");
  if (scoreNumber(record.biofouling_exposure_score || record.biofouling_risk_score) >= 50) reasons.push("바이오파울링 노출 지표 높음");
  if (record.operator_name || record.operator) reasons.push("운영선사 확인");
  if (record.agent_name || record.agent || record.satmntEntrpsNm || record.entrpsCdNm) reasons.push("대리점/신고업체 확인");
  if (record.route_region) reasons.push(`${record.route_region} 항로 압박 신호`);
  for (const code of record.reason_codes || []) reasons.push(String(code).replace(/_/g, " "));

  return [...new Set(reasons)].slice(0, 12);
}

function buildWhyScoredHigh(record = {}) {
  const score = commercialScore(record);
  const reasons = buildScoreReasons(record).slice(0, 4);
  if (!score && !reasons.length) return null;
  const vessel = record.vessel_name || "해당 선박";
  const port = record.port_name || record.port || record.port_code || "현재 항만";
  return reasons.length
    ? `${port}의 ${vessel}은 상업 가치 ${score}점으로 평가되며, 주요 근거는 ${reasons.join(", ")}입니다.`
    : `${port}의 ${vessel}은 상업적으로 검토할 신호가 확인됩니다.`;
}

function buildWhyNowKo(record = {}) {
  if (record.why_now) return record.why_now;
  const port = record.port_name || record.port || "해당 항만";
  const gt = scoreNumber(record.gt || record.grtg || record.intrlGrtg);
  const type = String(record.vessel_type_group || record.vessel_type || "선박").replace(/_/g, " ");
  const anchorageDays = scoreNumber(record.anchorage_hours) / 24;
  const stayDays = scoreNumber(record.stay_hours || record.current_call_stay_hours || record.cumulative_stay_hours) / 24;
  const workScore = scoreNumber(record.work_feasibility_score || record.cleaning_window_score);
  const parts = [];
  if (gt >= 5000) parts.push(`GT ${Math.round(gt).toLocaleString("en-US")}급 ${type}`);
  else parts.push(type);
  if (anchorageDays >= 1) parts.push(`묘박/대기 ${Math.round(anchorageDays * 10) / 10}일`);
  else if (stayDays >= 1) parts.push(`체류 ${Math.round(stayDays * 10) / 10}일`);
  if (workScore >= 50 || record.work_window_status === "open_or_ongoing") parts.push("작업 가능성이 높음");
  if (record.no_outbound_pilot || record.pilot_outbound_missing || !record.atd) parts.push("출항 완료 전 확인 필요");
  return `${port}에서 ${parts.filter(Boolean).join(", ")} 신호가 확인되어 현재 영업 우선순위 검토가 필요합니다.`;
}

function buildRecommendedActionKo(record = {}) {
  if (record.recommended_action || record.recommended_next_action) return record.recommended_action || record.recommended_next_action;
  if (!(record.operator_name || record.operator) && !(record.agent_name || record.agent || record.satmntEntrpsNm || record.entrpsCdNm)) return "운영선사와 대리점 정보를 먼저 확인하세요.";
  if (scoreNumber(record.work_feasibility_score || record.work_window_hours) >= 50) return "대리점 확인 후 작업 가능 시간과 견적 요청 여부를 확인하세요.";
  if (record.eta || record.etb || record.predicted_arrival_time) return "입항/접안 일정 기준으로 사전 연락 가능성을 확인하세요.";
  return "선박 스케줄과 연락 경로를 확인하세요.";
}

function buildCandidateSummaryKo(record = {}) {
  if (record.candidate_summary_ko) return record.candidate_summary_ko;
  const vessel = record.vessel_name || "해당 선박";
  const port = record.port_name || record.port || "항만";
  const score = commercialScore(record);
  const band = candidateLabel(record);
  const reasons = buildScoreReasons(record).slice(0, 3).join(", ");
  return `${vessel} / ${port} / 상업 가치 ${score}점 / ${band}${reasons ? ` / ${reasons}` : ""}`;
}

function kstSnapshotDate(value = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date(value));
}

function average(values = []) {
  const numbers = values.map(scoreNumber).filter(value => Number.isFinite(value));
  if (!numbers.length) return 0;
  return Math.round((numbers.reduce((sum, value) => sum + value, 0) / numbers.length) * 10) / 10;
}

function historicalBand(record = {}) {
  const score = commercialScore(record);
  if (score >= 75) return "immediate_target";
  if (score >= 65) return "sales_target";
  if (score >= 50) return "watchlist";
  return record.candidate_band || record.sales_priority_band || "general";
}

function groupBy(records = [], keyFn) {
  const map = new Map();
  for (const record of records) {
    const key = keyFn(record);
    if (!key) continue;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(record);
  }
  return map;
}

function countBy(records = [], keyFn) {
  const counts = {};
  for (const record of records) {
    const key = keyFn(record) || "unknown";
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function topOpportunityRecord(records = []) {
  return [...records]
    .filter(isOpportunityEligible)
    .sort((a, b) =>
      scoreNumber(b.predicted_cleaning_opportunity_score) - scoreNumber(a.predicted_cleaning_opportunity_score) ||
      commercialScore(b) - commercialScore(a) ||
      scoreNumber(b.work_feasibility_score) - scoreNumber(a.work_feasibility_score)
    )[0] || null;
}

function evaluateFoundationRules(record = {}) {
  const score = commercialScore(record);
  const gt = scoreNumber(record.gt || record.grtg || record.intrlGrtg);
  const stayHours = scoreNumber(record.stay_hours);
  const anchorageHours = scoreNumber(record.anchorage_hours);
  const workScore = scoreNumber(record.work_feasibility_score);
  const contactScore = scoreNumber(record.contact_readiness_score);
  return [
    {
      rule_id: "HIGH_COMMERCIAL_VALUE",
      rule_version: COMMERCIAL_RULE_VERSION,
      rule_group: "candidate",
      passed: score >= 75,
      severity: score >= 90 ? "critical" : "high",
      score_impact: score,
      explanation_ko: "상업 가치 점수가 즉시 검토 기준 이상입니다."
    },
    {
      rule_id: "SALES_TARGET_SCORE",
      rule_version: CANDIDATE_RULE_VERSION,
      rule_group: "candidate",
      passed: score >= 65,
      severity: "medium",
      score_impact: score,
      explanation_ko: "상업 가치 점수가 영업대상 기준 이상입니다."
    },
    {
      rule_id: "MISSING_IMO_HIGH_VALUE",
      rule_version: COMMERCIAL_RULE_VERSION,
      rule_group: "identity",
      passed: !record.imo && (score >= 65 || gt >= 30000),
      severity: "medium",
      score_impact: score,
      explanation_ko: "고가치 선박이지만 IMO가 없어 복구 큐에 우선 반영해야 합니다."
    },
    {
      rule_id: "OPEN_WORK_WINDOW",
      rule_version: COMMERCIAL_RULE_VERSION,
      rule_group: "port_call",
      passed: workScore >= 50 || (!record.atd && (record.ata || stayHours > 0)),
      severity: "high",
      score_impact: workScore,
      explanation_ko: "현재 체류 중이거나 작업 가능성이 열려 있습니다."
    },
    {
      rule_id: "LONG_STAY_OR_ANCHORAGE",
      rule_version: COMMERCIAL_RULE_VERSION,
      rule_group: "event",
      passed: stayHours >= 72 || anchorageHours >= 72,
      severity: "medium",
      score_impact: Math.max(stayHours, anchorageHours),
      explanation_ko: "장기 체류 또는 장기 묘박 신호가 있습니다."
    },
    {
      rule_id: "CONTACT_PATH_READY",
      rule_version: COMMERCIAL_RULE_VERSION,
      rule_group: "operator",
      passed: contactScore >= 60 || record.contact_path_status === "contact_available",
      severity: "medium",
      score_impact: contactScore,
      explanation_ko: "운영선사 또는 대리점 연락 경로가 비교적 준비되어 있습니다."
    }
  ];
}

function leanStorageEnabled() {
  return String(process.env.DB_STORAGE_MODE || "lean").toLowerCase() !== "full";
}

function compactPayload(record = {}) {
  return {
    vessel_name: record.vessel_name || null,
    normalized_vessel_name: record.normalized_vessel_name || normalizeVesselName(record.vessel_name),
    hybrid_entity_key: record.hybrid_entity_key || record.vessel_id || null,
    port_call_identity: record.port_call_identity || record.port_call_key || null,
    port_code: record.port_code || null,
    port_name: record.port_name || record.port || null,
    vessel_type: record.vessel_type || null,
    vessel_type_group: record.vessel_type_group || null,
    gt: record.gt || record.grtg || record.intrlGrtg || null,
    imo: record.imo || null,
    mmsi: record.mmsi || null,
    call_sign: record.call_sign || null,
    ata: record.ata || null,
    atd: record.atd || null,
    etd: record.etd || null,
    eta: record.eta || null,
    stay_hours: record.stay_hours || 0,
    anchorage_hours: record.anchorage_hours || 0,
    status_bucket: record.status_bucket || null,
    commercial_value_score: commercialScore(record),
    candidate_band: candidateLabel(record),
    reason_codes: record.reason_codes || [],
    operator_name: record.operator_name || record.operator || null,
    agent_name: record.agent_name || record.agent || record.satmntEntrpsNm || record.entrpsCdNm || null,
    contact_readiness_score: scoreNumber(record.contact_readiness_score),
    data_confidence_score: scoreNumber(record.data_confidence_score),
    data_quality_score: scoreNumber(record.data_quality_score),
    why_now: record.why_now || record.candidate_summary_ko || null,
    recommended_action: record.recommended_action || record.recommended_next_action || null,
    source_name: record.source || record.source_name || record.source_mode || null,
    collected_at: record.collected_at || null
  };
}

function storagePayload(record = {}) {
  return leanStorageEnabled() ? compactPayload(record) : record;
}

function analyticsScope() {
  return String(process.env.DB_ANALYTICS_SCOPE || "candidate").toLowerCase();
}

function foundationWriteMode() {
  return String(process.env.DB_FOUNDATION_WRITE_MODE || "minimal").toLowerCase();
}

function shouldPersistAnalyticalRow(record = {}) {
  const score = commercialScore(record);
  const gt = scoreNumber(record.gt || record.grtg || record.intrlGrtg);
  const strategicReview = gt >= 30000 && (!record.imo || scoreNumber(record.stay_hours) >= 72 || scoreNumber(record.anchorage_hours) >= 72);
  if (!leanStorageEnabled() || analyticsScope() === "broad") {
    return score >= 50 ||
    gt >= 5000 ||
    scoreNumber(record.predicted_cleaning_opportunity_score) >= 35 ||
    scoreNumber(record.work_feasibility_score) >= 35 ||
    Boolean(record.is_immediate_candidate || record.is_cleaning_candidate || record.alert_candidate || record.information_enrichment_needed);
  }
  return score >= 65 ||
    scoreNumber(record.predicted_cleaning_opportunity_score) >= 60 ||
    strategicReview ||
    Boolean(record.is_immediate_candidate || record.is_cleaning_candidate || record.alert_candidate || record.information_enrichment_needed);
}

function shouldPersistTrainingRow(record = {}) {
  if (foundationWriteMode() === "off") return false;
  if (foundationWriteMode() === "minimal") {
    return commercialScore(record) >= 75 ||
      scoreNumber(record.predicted_cleaning_opportunity_score) >= 75 ||
      Boolean(record.is_immediate_candidate || record.alert_candidate);
  }
  return shouldPersistAnalyticalRow(record);
}

function shouldPersistFeatureRow(record = {}) {
  if (foundationWriteMode() === "off") return false;
  return shouldPersistAnalyticalRow(record);
}

function retentionCutoff(days, dateOnly = false) {
  const cutoff = new Date(Date.now() - Number(days || 0) * 24 * 60 * 60 * 1000).toISOString();
  return dateOnly ? cutoff.slice(0, 10) : cutoff;
}

async function activeDatasetRunId(supabase) {
  try {
    const { data, error } = await supabase
      .from("active_dataset_pointer")
      .select("active_run_id")
      .eq("id", "current")
      .limit(1);
    if (error) return null;
    return data?.[0]?.active_run_id || null;
  } catch {
    return null;
  }
}

async function latestPromotedRunIds(supabase, limit = 1) {
  try {
    const { data, error } = await supabase
      .from("data_collection_runs")
      .select("run_id,started_at,promoted_at")
      .eq("status", "promoted")
      .order("started_at", { ascending: false })
      .limit(Math.max(1, Number(limit || 1)));
    if (error) return [];
    return (data || []).map(row => row.run_id).filter(Boolean);
  } catch {
    return [];
  }
}

function retentionNumberEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || String(raw).trim() === "") return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

const RETENTION_PROFILES = {
  free_500mb: {
    targetMb: 450,
    hardCapMb: 500,
    keepPromotedRuns: 1,
    vesselSnapshotsDays: 1,
    portCallMasterDays: 7,
    riskHistoryDays: 3,
    enrichmentDays: 2,
    sourceLogsDays: 7,
    dashboardSummaryDays: 14,
    currentStaleDays: 2,
    eventDays: 3,
    pilotEventDays: 3,
    congestionDays: 3,
    identityDays: 3,
    historyDays: 3,
    routePredictionDays: 3,
    dailyWarehouseDays: 7,
    rawArchiveIndexDays: 14,
    ruleDays: 3,
    featureDays: 3,
    modelDays: 3,
    explainabilityDays: 3
  },
  ideal: {
    targetMb: 4096,
    hardCapMb: 8192,
    keepPromotedRuns: 14,
    vesselSnapshotsDays: 30,
    portCallMasterDays: 180,
    riskHistoryDays: 90,
    enrichmentDays: 30,
    sourceLogsDays: 90,
    dashboardSummaryDays: 180,
    currentStaleDays: 14,
    eventDays: 90,
    pilotEventDays: 90,
    congestionDays: 90,
    identityDays: 90,
    historyDays: 180,
    routePredictionDays: 90,
    dailyWarehouseDays: 365,
    rawArchiveIndexDays: 365,
    ruleDays: 90,
    featureDays: 90,
    modelDays: 180,
    explainabilityDays: 90
  }
};

function retentionProfileName() {
  const raw = String(process.env.DB_RETENTION_PROFILE || "free_500mb").trim().toLowerCase();
  if (["ideal", "analytics", "growth"].includes(raw)) return "ideal";
  if (["free", "free_500", "500mb", "free_500mb", "lean"].includes(raw)) return "free_500mb";
  return "free_500mb";
}

function retentionPolicyFromEnv() {
  const profile = retentionProfileName();
  const defaults = RETENTION_PROFILES[profile] || RETENTION_PROFILES.free_500mb;
  return {
    profile,
    targetMb: retentionNumberEnv("DB_RETENTION_TARGET_MB", defaults.targetMb),
    hardCapMb: retentionNumberEnv("DB_RETENTION_HARD_CAP_MB", defaults.hardCapMb),
    keepPromotedRuns: retentionNumberEnv("DB_RETENTION_KEEP_PROMOTED_RUNS", defaults.keepPromotedRuns),
    vesselSnapshotsDays: retentionNumberEnv("DB_RETENTION_VESSEL_SNAPSHOTS_DAYS", defaults.vesselSnapshotsDays),
    portCallMasterDays: retentionNumberEnv("DB_RETENTION_PORT_CALL_MASTER_DAYS", defaults.portCallMasterDays),
    riskHistoryDays: retentionNumberEnv("DB_RETENTION_RISK_HISTORY_DAYS", defaults.riskHistoryDays),
    enrichmentDays: retentionNumberEnv("DB_RETENTION_ENRICHMENT_DAYS", defaults.enrichmentDays),
    sourceLogsDays: retentionNumberEnv("DB_RETENTION_SOURCE_LOGS_DAYS", defaults.sourceLogsDays),
    dashboardSummaryDays: retentionNumberEnv("DB_RETENTION_DASHBOARD_SUMMARY_DAYS", defaults.dashboardSummaryDays),
    currentStaleDays: retentionNumberEnv("DB_RETENTION_CURRENT_STALE_DAYS", defaults.currentStaleDays),
    eventDays: retentionNumberEnv("DB_RETENTION_EVENT_DAYS", defaults.eventDays),
    pilotEventDays: retentionNumberEnv("DB_RETENTION_PILOT_EVENT_DAYS", defaults.pilotEventDays),
    congestionDays: retentionNumberEnv("DB_RETENTION_CONGESTION_DAYS", defaults.congestionDays),
    identityDays: retentionNumberEnv("DB_RETENTION_IDENTITY_DAYS", defaults.identityDays),
    historyDays: retentionNumberEnv("DB_RETENTION_HISTORY_DAYS", defaults.historyDays),
    routePredictionDays: retentionNumberEnv("DB_RETENTION_ROUTE_PREDICTION_DAYS", defaults.routePredictionDays),
    dailyWarehouseDays: retentionNumberEnv("DB_RETENTION_DAILY_WAREHOUSE_DAYS", defaults.dailyWarehouseDays),
    rawArchiveIndexDays: retentionNumberEnv("DB_RETENTION_RAW_ARCHIVE_INDEX_DAYS", defaults.rawArchiveIndexDays),
    ruleDays: retentionNumberEnv("DB_RETENTION_RULE_DAYS", defaults.ruleDays),
    featureDays: retentionNumberEnv("DB_RETENTION_FEATURE_DAYS", defaults.featureDays),
    modelDays: retentionNumberEnv("DB_RETENTION_MODEL_DAYS", defaults.modelDays),
    explainabilityDays: retentionNumberEnv("DB_RETENTION_EXPLAINABILITY_DAYS", defaults.explainabilityDays)
  };
}

async function deleteRowsOlderThan(supabase, job, activeRunId) {
  const days = Number(job.days);
  if (!Number.isFinite(days) || days <= 0) {
    return { status: "skipped", reason: "retention_disabled", retention_days: days || 0, rows_deleted: 0 };
  }
  try {
    let query = supabase
      .from(job.table)
      .delete({ count: "exact" })
      .lt(job.column, retentionCutoff(days, job.dateOnly));
    if (job.preserveActiveRun && activeRunId) query = query.neq("run_id", activeRunId);
    for (const filter of job.filters || []) {
      if (filter.op === "eq") query = query.eq(filter.column, filter.value);
      if (filter.op === "neq") query = query.neq(filter.column, filter.value);
    }
    const { error, count } = await query;
    return error
      ? { status: "skipped", error: error.message, retention_days: days, rows_deleted: 0 }
      : { status: "retained", retention_days: days, rows_deleted: Number(count || 0) };
  } catch (error) {
    return { status: "skipped", error: error.message, retention_days: days, rows_deleted: 0 };
  }
}

async function deleteRowsOutsideKeepRuns(supabase, table, keepRunIds = []) {
  const keep = [...new Set(keepRunIds.filter(Boolean))];
  if (!keep.length) return { status: "skipped", reason: "missing_keep_runs", rows_deleted: 0 };
  try {
    const { error, count } = await supabase
      .from(table)
      .delete({ count: "exact" })
      .not("run_id", "is", null)
      .not("run_id", "in", `(${keep.join(",")})`);
    return error
      ? { status: "skipped", error: error.message, keep_runs: keep, rows_deleted: 0 }
      : { status: "pruned_to_keep_runs", keep_runs: keep, rows_deleted: Number(count || 0) };
  } catch (error) {
    return { status: "skipped", error: error.message, keep_runs: keep, rows_deleted: 0 };
  }
}

function buildSourceCollectionLogRows(diagnostics = {}, runId) {
  return (diagnostics.sources || []).map(source => ({
    source_log_id: `${runId}:${source.key || source.source_name || source.label || randomUUID().slice(0, 8)}`,
    run_id: runId,
    source_name: source.source_name || source.key || source.label || "unknown_source",
    source_profile: source.source_profile || null,
    started_at: source.started_at || diagnostics.generated_at || new Date().toISOString(),
    finished_at: source.finished_at || source.started_at || diagnostics.generated_at || new Date().toISOString(),
    duration_ms: Number(source.duration_ms || source.latency_ms || 0),
    status: source.status || (source.skipped ? "skipped" : source.success ? "success" : source.error ? "failed" : "unknown"),
    rows_collected: Number(source.rows_collected || source.row_count || 0),
    rows_normalized: Number(source.rows_normalized || source.normalized_count || 0),
    rows_matched: Number(source.rows_matched || source.actionable_count || 0),
    error_message: source.error_message || source.error || source.reason || null,
    retry_count: Number(source.retry_count || 0),
    http_status: source.http_status || null,
    payload: source
  }));
}

async function runLeanRetentionCleanup(supabase) {
  if (!leanStorageEnabled() || String(process.env.DB_RETENTION_CLEANUP || "true").toLowerCase() === "false") {
    return { skipped: true, retention_groups: { daily_warehouse: "long_retention_not_deleted", raw_payloads: "google_drive_archive" } };
  }
  const retention = retentionPolicyFromEnv();
  const activeRunId = await activeDatasetRunId(supabase);
  const promotedRunIds = await latestPromotedRunIds(supabase, retention.keepPromotedRuns);
  const keepRunIds = [...new Set([activeRunId, ...promotedRunIds].filter(Boolean))];
  const runScopedBulkyTables = [
    "vessel_snapshots",
    "operator_contact_history",
    "operator_history",
    "vessel_operator_history",
    "predicted_arrivals",
    "vessel_identity_candidates",
    "vessel_route_history",
    "rule_evaluations",
    "explainability_snapshots",
    "risk_history",
    "feature_store",
    "feature_snapshots",
    "model_training_rows",
    "source_collection_logs",
    "port_call_master",
    "vessel_snapshot_daily",
    "commercial_opportunity_daily"
  ];
  const runPruneResult = {};
  for (const table of runScopedBulkyTables) {
    runPruneResult[table] = await deleteRowsOutsideKeepRuns(supabase, table, keepRunIds);
  }
  const jobs = [
    { table: "port_calls", column: "collected_at", days: retention.enrichmentDays },
    { table: "vessel_snapshots", column: "collected_at", days: retention.vesselSnapshotsDays, preserveActiveRun: true },
    { table: "port_call_master", column: "last_seen", days: retention.portCallMasterDays, preserveActiveRun: true },
    { table: "risk_history", column: "collected_at", days: retention.riskHistoryDays, preserveActiveRun: true },
    { table: "enrichment_match_candidates", column: "created_at", days: retention.enrichmentDays, preserveActiveRun: true },
    { table: "source_collection_logs", column: "started_at", days: retention.sourceLogsDays, preserveActiveRun: true },
    { table: "dashboard_summary_snapshots", column: "generated_at", days: retention.dashboardSummaryDays, preserveActiveRun: true, filters: [{ op: "neq", column: "is_latest_successful", value: true }] },
    { table: "sales_candidates_current", column: "updated_at", days: retention.currentStaleDays, preserveActiveRun: true, filters: [{ op: "eq", column: "is_current", value: false }] },
    { table: "immediate_targets_current", column: "updated_at", days: retention.currentStaleDays, preserveActiveRun: true, filters: [{ op: "eq", column: "is_current", value: false }] },
    { table: "port_summary_current", column: "updated_at", days: retention.currentStaleDays, preserveActiveRun: true, filters: [{ op: "eq", column: "is_current", value: false }] },
    { table: "vessel_events", column: "created_at", days: retention.eventDays, preserveActiveRun: true },
    { table: "pilot_schedule_events", column: "created_at", days: retention.pilotEventDays, preserveActiveRun: true },
    { table: "port_congestion_snapshots", column: "collected_at", days: retention.congestionDays, preserveActiveRun: true },
    { table: "anchorage_clusters", column: "collected_at", days: retention.congestionDays, preserveActiveRun: true },
    { table: "berth_occupancy_history", column: "collected_at", days: retention.congestionDays, preserveActiveRun: true },
    { table: "vessel_identity_candidates", column: "collected_at", days: retention.identityDays, preserveActiveRun: true },
    { table: "vessel_operator_history", column: "collected_at", days: retention.historyDays, preserveActiveRun: true },
    { table: "operator_history", column: "collected_at", days: retention.historyDays, preserveActiveRun: true },
    { table: "operator_contact_history", column: "collected_at", days: retention.historyDays, preserveActiveRun: true },
    { table: "predicted_arrivals", column: "created_at", days: retention.routePredictionDays, preserveActiveRun: true },
    { table: "vessel_route_history", column: "created_at", days: retention.routePredictionDays, preserveActiveRun: true },
    { table: "operator_fleet_opportunities", column: "created_at", days: retention.routePredictionDays, preserveActiveRun: true },
    { table: "commercial_leads", column: "updated_at", days: retention.routePredictionDays, preserveActiveRun: true },
    { table: "raw_archive_index", column: "created_at", days: retention.rawArchiveIndexDays, preserveActiveRun: true },
    { table: "feature_store", column: "collected_at", days: retention.featureDays, preserveActiveRun: true },
    { table: "feature_snapshots", column: "snapshot_time", days: retention.featureDays, preserveActiveRun: true },
    { table: "rule_evaluations", column: "collected_at", days: retention.ruleDays, preserveActiveRun: true },
    { table: "model_training_rows", column: "collected_at", days: retention.modelDays, preserveActiveRun: true },
    { table: "explainability_snapshots", column: "collected_at", days: retention.explainabilityDays, preserveActiveRun: true },
    { table: "vessel_snapshot_daily", column: "snapshot_date", days: retention.dailyWarehouseDays, preserveActiveRun: true, dateOnly: true },
    { table: "port_snapshot_daily", column: "snapshot_date", days: retention.dailyWarehouseDays, preserveActiveRun: true, dateOnly: true },
    { table: "operator_snapshot_daily", column: "snapshot_date", days: retention.dailyWarehouseDays, preserveActiveRun: true, dateOnly: true },
    { table: "route_snapshot_daily", column: "snapshot_date", days: retention.dailyWarehouseDays, preserveActiveRun: true, dateOnly: true },
    { table: "commercial_opportunity_daily", column: "snapshot_date", days: retention.dailyWarehouseDays, preserveActiveRun: true, dateOnly: true },
    { table: "data_collection_runs", column: "started_at", days: retention.dashboardSummaryDays, preserveActiveRun: true },
    { table: "pipeline_runs", column: "run_started_at", days: retention.dashboardSummaryDays }
  ];
  const result = {};
  for (const job of jobs) {
    result[job.table] = await deleteRowsOlderThan(supabase, job, activeRunId);
  }
  return {
    ...result,
    active_run_preserved: activeRunId || null,
    promoted_runs_preserved: promotedRunIds,
    keep_run_ids: keepRunIds,
    size_policy: {
      profile: retention.profile,
      target_mb: retention.targetMb,
      hard_cap_mb: retention.hardCapMb,
      keep_promoted_runs: retention.keepPromotedRuns,
      strategy: retention.profile === "ideal"
        ? "retain broader analytical history while still pruning stale run-scoped rows"
        : "keep active run plus latest promoted run, archive/fallback outside Supabase"
    },
    run_prune: runPruneResult,
    retention_groups: {
      run_snapshots: "short_retention",
      diagnostics: "medium_retention",
      daily_warehouse: `${retention.dailyWarehouseDays}_days`,
      raw_payloads: "google_drive_archive"
    }
  };
}

function lifecycleKey(record = {}) {
  const portCode = record.port_code || record.port || "";
  if (record.port_call_identity || record.port_call_key) return `PORTCALL|${portCode}|${record.port_call_identity || record.port_call_key}`;
  if (record.hybrid_entity_key || record.vessel_id) return `VESSELPORT|${portCode}|${record.hybrid_entity_key || record.vessel_id}`;
  if (record.call_sign) return `CALLSIGN|${portCode}|${record.call_sign}`;
  return `NAME|${portCode}|${normalizeVesselName(record.vessel_name)}`;
}

function buildPortCallId(record = {}) {
  if (record.port_call_id) return record.port_call_id;
  const portCode = record.port_code || record.prtAgCd || record.port || "";
  const etryptYear = record.etryptYear || record.etrypt_year || record.ETRYPT_YEAR;
  const etryptCo = record.etryptCo || record.etrypt_co || record.ETRYPT_CO;
  const callSign = record.call_sign || record.clsgn || record.CLSGN;
  if (portCode && etryptYear && etryptCo && callSign) {
    return stableEntityId("PCALL", `${portCode}-${etryptYear}-${etryptCo}-${callSign}`);
  }
  const explicitIdentity = record.port_call_identity || record.port_call_key || record.raw_port_call_identity;
  if (explicitIdentity) return stableEntityId("PCALL", `${portCode}-${explicitIdentity}`);
  const scheduleDate = String(record.ata || record.eta || record.etryptDt || record.collected_at || "").slice(0, 10);
  if (portCode && callSign && scheduleDate) {
    return stableEntityId("PCALL", `${portCode}-${callSign}-${scheduleDate}`);
  }
  const normalizedName = normalizeVesselName(record.normalized_vessel_name || record.vessel_name);
  if (portCode && normalizedName && scheduleDate) {
    return stableEntityId("PCALL", `${portCode}-${normalizedName}-${scheduleDate}`);
  }
  const vesselIdentity = record.master_vessel_id || record.hybrid_entity_key || record.imo || record.mmsi || record.call_sign || normalizeVesselName(record.vessel_name);
  const arrivalKey = record.ata || record.eta || record.etryptDt || record.etryptYear || record.collected_at || "";
  return stableEntityId("PCALL", `${portCode}-${vesselIdentity}-${arrivalKey}`);
}

function sourceGroupName(sourceName = "") {
  const key = String(sourceName || "").toLowerCase();
  if (key.startsWith("port_operation_")) return "Port Operation";
  if (key.includes("pilot")) return "Pilot";
  if (key.includes("pnc")) return "PNC";
  if (key.includes("ulsan")) return "Ulsan";
  if (key.includes("ais") || key.includes("vts")) return "AIS/VTS";
  if (key.includes("facility") || key.includes("berth")) return "Port Facility";
  if (key.includes("csv") || key.includes("dictionary")) return "CSV dictionaries";
  return "Other";
}

function buildSourceBreakdown(diagnostics = {}) {
  const grouped = new Map();
  for (const source of diagnostics.sources || []) {
    const group = sourceGroupName(source.key || source.source_name || source.label);
    const row = grouped.get(group) || {
      source_name: group,
      source_count: 0,
      rows_collected: 0,
      rows_normalized: 0,
      rows_discarded: 0,
      rows_failed: 0,
      rows_matched_to_port_operation: 0,
      match_rate: 0,
      error_summary: []
    };
    const collected = scoreNumber(source.rows_collected || source.row_count);
    const normalized = scoreNumber(source.rows_normalized || source.normalized_count);
    const matched = scoreNumber(source.rows_matched || source.actionable_count);
    row.source_count += 1;
    row.rows_collected += collected;
    row.rows_normalized += normalized;
    row.rows_discarded += Math.max(0, collected - normalized);
    row.rows_failed += source.status === "failed" || source.error ? collected || 1 : 0;
    row.rows_matched_to_port_operation += matched;
    if (source.error_message || source.error || source.reason) {
      row.error_summary.push(String(source.error_message || source.error || source.reason).slice(0, 240));
    }
    grouped.set(group, row);
  }
  return [...grouped.values()].map(row => ({
    ...row,
    match_rate: row.rows_collected ? Math.round((row.rows_matched_to_port_operation / row.rows_collected) * 1000) / 10 : 0,
    error_summary: [...new Set(row.error_summary)].slice(0, 10)
  }));
}

function buildDedupeAudit(records = [], diagnostics = {}) {
  const rawRows = scoreNumber(diagnostics.count_funnel?.raw_api_rows || diagnostics.raw_api_rows || diagnostics.real_row_count || records.length);
  const normalizedRows = records.length;
  const portCallKeys = records.map(record => buildPortCallId(record)).filter(Boolean);
  const vesselKeys = records.map(record => record.master_vessel_id || record.vessel_identity || record.hybrid_entity_key || record.imo || record.mmsi || record.call_sign || `${normalizeVesselName(record.vessel_name)}|${record.gt || 0}|${record.vessel_type_group || record.vessel_type || ""}`).filter(Boolean);
  const duplicateRowsRemoved = Math.max(0, rawRows - normalizedRows);
  return {
    raw_rows: rawRows,
    normalized_rows: normalizedRows,
    duplicate_rows_removed: duplicateRowsRemoved,
    duplicate_rate: rawRows ? Math.round((duplicateRowsRemoved / rawRows) * 1000) / 10 : 0,
    unique_port_calls: new Set(portCallKeys).size,
    unique_vessels: new Set(vesselKeys).size,
    duplicate_cause_estimates: {
      io_double_count_candidates: records.filter(record => record.deGb || record.de_gb || record.direction).length,
      repeated_detail_rows: records.filter(record => record.detail_rows_flattened || scoreNumber(record.detail_row_count) > 1).length,
      enrichment_only_rows: records.filter(record => /pilot|pnc|ulsan|berth|facility/i.test(String(record.source || record.source_name || "")) && !String(record.source || record.source_name || "").startsWith("port_operation_")).length,
      same_vessel_multiple_port_calls: Math.max(0, portCallKeys.length - new Set(vesselKeys).size)
    },
    dedupe_rule: "port_call_id first, then IMO/MMSI/call_sign/name+GT+type for vessel identity; never vessel_name alone"
  };
}

function buildCandidatePromotionAudit(records = []) {
  const scores = records.map(commercialScore);
  const scoreRangeCount = (min, max = Infinity) => scores.filter(score => score >= min && score <= max).length;
  const candidateRows = records.filter(record => commercialScore(record) >= 50 && !isDepartedRecord(record) && !isHardCandidateExcluded(record));
  const promotedRows = records.filter(record => isSalesTargetRecord(record) || isImmediateTargetRecord(record));
  const excludedHighValue = candidateRows
    .filter(record => commercialScore(record) >= 65 && !isSalesTargetRecord(record) && !isImmediateTargetRecord(record))
    .map((record, index) => ({
      port_call_id: buildPortCallId(record),
      vessel_name: record.vessel_name || "",
      commercial_value_score: commercialScore(record),
      candidate_band: record.candidate_band || record.sales_priority_band || null,
      exclusion_reason: record.exclusion_reason || (isDepartedRecord(record) ? "departed" : isHardCandidateExcluded(record) ? "hard_excluded" : "percentile_or_work_feasibility_guard"),
      candidate_id: record.snapshot_id || record.port_call_id || record.port_call_identity || record.hybrid_entity_key || `excluded-${index}`
    }));
  const exclusionReasonCounts = excludedHighValue.reduce((acc, row) => {
    acc[row.exclusion_reason] = (acc[row.exclusion_reason] || 0) + 1;
    return acc;
  }, {});
  return {
    commercial_score_distribution: {
      score_90_plus_count: scoreRangeCount(90),
      score_80_89_count: scoreRangeCount(80, 89),
      score_70_79_count: scoreRangeCount(70, 79),
      score_60_69_count: scoreRangeCount(60, 69),
      score_50_59_count: scoreRangeCount(50, 59),
      score_40_49_count: scoreRangeCount(40, 49),
      score_0_39_count: scores.filter(score => score < 40).length
    },
    candidate_generation_count: candidateRows.length,
    candidate_promotion_count: promotedRows.length,
    high_score_not_promoted_count: excludedHighValue.length,
    excluded_high_value_count: excludedHighValue.length,
    exclusion_reason_counts: exclusionReasonCounts,
    excluded_high_value_samples: excludedHighValue.slice(0, 50),
    classification_logic: {
      watchlist: "commercial_value_score 50-64 or rank watchlist",
      sales_target: "commercial_value_score >= 65 plus percentile qualification",
      immediate_target: "commercial_value_score >= 75 plus current/near-term work feasibility"
    }
  };
}

function buildVesselUniverseAuditRow(records = [], diagnostics = {}, runId, generatedAt = new Date().toISOString()) {
  const dedupeAudit = buildDedupeAudit(records, diagnostics);
  const candidateAudit = buildCandidatePromotionAudit(records);
  const sourceBreakdown = buildSourceBreakdown(diagnostics);
  const watchlistCount = records.filter(isWatchlistRecord).length;
  const salesTargetCount = records.filter(isSalesTargetRecord).length;
  const immediateTargetCount = records.filter(isImmediateTargetRecord).length;
  const targetRatio = records.length ? Math.round((salesTargetCount / records.length) * 1000) / 10 : 0;
  const portCallCoverage = records.length ? Math.round((records.filter(record => buildPortCallId(record)).length / records.length) * 1000) / 10 : 0;
  const suspected = [];
  if (dedupeAudit.duplicate_rate > 35) suspected.push("Duplicate rate is high; review I/O merge and detail-row flattening.");
  if (targetRatio > 30) suspected.push("영업대상 기준이 너무 넓습니다.");
  if (records.length > 0 && salesTargetCount === 0) suspected.push("영업대상 후보가 생성되지 않았습니다. 후보 생성 로직을 확인하세요.");
  if (portCallCoverage < 80) suspected.push("port_call_id coverage is below 80%.");
  if (candidateAudit.high_score_not_promoted_count > 0) suspected.push("High-score vessels exist that were not promoted; inspect exclusion reasons.");
  const recommendations = [
    "Use all_vessels as the full valid port-call universe.",
    "Use sales_candidates + immediate_targets for 영업대상선박.",
    "Treat Pilot/PNC/Ulsan rows as enrichment unless high-confidence unmatched arrivals.",
    "Review /api/quality/source-counts.json and /api/quality/dedupe-audit.json after every major collector change."
  ];
  return {
    audit_id: stableEntityId("VUAUD", runId || generatedAt),
    run_id: runId,
    generated_at: generatedAt,
    raw_rows_total: dedupeAudit.raw_rows,
    normalized_rows_total: dedupeAudit.normalized_rows,
    duplicate_rows_removed: dedupeAudit.duplicate_rows_removed,
    duplicate_rate: dedupeAudit.duplicate_rate,
    unique_port_calls_count: dedupeAudit.unique_port_calls,
    unique_vessels_count: dedupeAudit.unique_vessels,
    all_vessels_count: records.length,
    watchlist_count: watchlistCount,
    sales_target_count: salesTargetCount,
    immediate_target_count: immediateTargetCount,
    target_ratio: targetRatio,
    candidate_generation_status: candidateAudit.candidate_generation_count > 0 ? "completed" : records.length ? "completed_no_candidates" : "no_vessels",
    source_breakdown: sourceBreakdown,
    dedupe_audit: dedupeAudit,
    candidate_promotion_audit: candidateAudit,
    dashboard_dataset_audit: {
      all_vessels_api_source: "all_vessels",
      target_vessels_api_source: "sales_candidates + immediate_targets",
      immediate_targets_api_source: "immediate_targets top 5",
      all_vessels_api_count: records.length,
      target_vessels_api_count: salesTargetCount + immediateTargetCount,
      immediate_targets_api_count: immediateTargetCount,
      port_call_id_coverage_percent: portCallCoverage
    },
    suspected_counting_issues: suspected,
    recommendations,
    created_at: generatedAt
  };
}

function compactDbError(error) {
  if (!error) return null;
  return {
    code: error.code || null,
    message: error.message || String(error),
    details: error.details || null,
    hint: error.hint || null
  };
}

function isMissingSchemaTableError(error) {
  const text = [
    error?.code,
    error?.message,
    error?.details,
    error?.hint
  ].filter(Boolean).join(" ").toLowerCase();
  return text.includes("schema cache") ||
    text.includes("could not find the table") ||
    text.includes("does not exist") ||
    text.includes("pgrst205");
}

function missingSchemaColumnName(error) {
  const text = [
    error?.message,
    error?.details,
    error?.hint
  ].filter(Boolean).join(" ");
  const schemaCacheMatch = text.match(/Could not find the ['"]([^'"]+)['"] column/i);
  if (schemaCacheMatch?.[1]) return schemaCacheMatch[1];
  const columnMissingMatch = text.match(/column ["']?([a-zA-Z0-9_]+)["']? does not exist/i);
  if (columnMissingMatch?.[1]) return columnMissingMatch[1];
  return null;
}

function stripColumnsFromRows(rows, columns = []) {
  const columnSet = new Set(columns.filter(Boolean));
  if (!columnSet.size) return rows;
  return rows.map(row => {
    const next = { ...row };
    for (const column of columnSet) delete next[column];
    return next;
  });
}

function stripColumnsFromRow(row = {}, columns = []) {
  return stripColumnsFromRows([row], columns)[0] || {};
}

async function upsertWithSchemaCompatibility(supabase, table, rows, options = {}, compatibility = {}) {
  const optionalColumns = new Set(compatibility.optional_columns || compatibility.optionalColumns || []);
  const strippedColumns = new Set(compatibility.stripped_optional_columns || []);
  let retryCount = 0;

  while (true) {
    const writeRows = stripColumnsFromRows(rows, Array.from(strippedColumns));
    const { error } = await supabase.from(table).upsert(writeRows, options);
    if (!error) {
      compatibility.stripped_optional_columns = Array.from(strippedColumns);
      compatibility.retry_count = Number(compatibility.retry_count || 0) + retryCount;
      compatibility.status = strippedColumns.size ? "optional_columns_stripped" : "native_schema";
      return { error: null, stripped_optional_columns: Array.from(strippedColumns), retry_count: retryCount };
    }

    const missingColumn = missingSchemaColumnName(error);
    if (!missingColumn || !optionalColumns.has(missingColumn) || strippedColumns.has(missingColumn)) {
      return { error };
    }

    strippedColumns.add(missingColumn);
    retryCount += 1;
    compatibility.last_error = compactDbError(error);
    compatibility.status = "optional_columns_stripped";
    console.warn(`[HWK] Supabase schema compatibility: ${table}.${missingColumn} missing; retrying without optional column.`);
  }
}

async function insertWithSchemaCompatibility(supabase, table, row, compatibility = {}) {
  const optionalColumns = new Set(compatibility.optional_columns || compatibility.optionalColumns || []);
  const strippedColumns = new Set(compatibility.stripped_optional_columns || []);
  let retryCount = 0;

  while (true) {
    const writeRow = stripColumnsFromRow(row, Array.from(strippedColumns));
    const { error } = await supabase.from(table).insert(writeRow);
    if (!error) {
      compatibility.stripped_optional_columns = Array.from(strippedColumns);
      compatibility.retry_count = Number(compatibility.retry_count || 0) + retryCount;
      compatibility.status = strippedColumns.size ? "optional_columns_stripped" : "native_schema";
      return { error: null, stripped_optional_columns: Array.from(strippedColumns), retry_count: retryCount };
    }

    const missingColumn = missingSchemaColumnName(error);
    if (!missingColumn || !optionalColumns.has(missingColumn) || strippedColumns.has(missingColumn)) {
      return { error };
    }

    strippedColumns.add(missingColumn);
    retryCount += 1;
    compatibility.last_error = compactDbError(error);
    compatibility.status = "optional_columns_stripped";
    console.warn(`[HWK] Supabase schema compatibility: ${table}.${missingColumn} missing; retrying insert without optional column.`);
  }
}

async function updateRunWithSchemaCompatibility(supabase, table, row, runId, compatibility = {}) {
  const optionalColumns = new Set(compatibility.optional_columns || compatibility.optionalColumns || []);
  const strippedColumns = new Set(compatibility.stripped_optional_columns || []);
  let retryCount = 0;

  while (true) {
    const writeRow = stripColumnsFromRow(row, Array.from(strippedColumns));
    const { error } = await supabase.from(table).update(writeRow).eq("run_id", runId);
    if (!error) {
      compatibility.stripped_optional_columns = Array.from(strippedColumns);
      compatibility.retry_count = Number(compatibility.retry_count || 0) + retryCount;
      compatibility.status = strippedColumns.size ? "optional_columns_stripped" : "native_schema";
      return { error: null, stripped_optional_columns: Array.from(strippedColumns), retry_count: retryCount };
    }

    const missingColumn = missingSchemaColumnName(error);
    if (!missingColumn || !optionalColumns.has(missingColumn) || strippedColumns.has(missingColumn)) {
      return { error };
    }

    strippedColumns.add(missingColumn);
    retryCount += 1;
    compatibility.last_error = compactDbError(error);
    compatibility.status = "optional_columns_stripped";
    console.warn(`[HWK] Supabase schema compatibility: ${table}.${missingColumn} missing; retrying update without optional column.`);
  }
}

async function upsertOptionalDiagnosticsRow(supabase, table, row, options = {}) {
  const result = {
    table,
    status: "skipped_no_row",
    rows_written: 0,
    error: null,
    missing_table: false,
    optional: true
  };
  if (!row) return result;
  const { error } = await supabase.from(table).upsert(row, options);
  if (!error) {
    result.status = "written";
    result.rows_written = 1;
    return result;
  }
  result.error = compactDbError(error);
  result.missing_table = isMissingSchemaTableError(error);
  result.status = result.missing_table ? "skipped_missing_table" : "failed_nonfatal";
  console.warn(`[HWK] Optional diagnostics table write skipped: ${table}`, result.error);
  return result;
}

async function verifySupabaseWriteFinalization(supabase, context = {}) {
  const {
    runId,
    promoted,
    promotion,
    recordsSaved = 0,
    portCallMasterRowsWritten = 0,
    dashboardSummarySnapshotResult = {},
    dbRowsWrittenByTable = {}
  } = context;
  const verification = {
    status: "pending",
    run_id: runId,
    promotion_status: promoted ? "promoted" : "not_promoted",
    promotion_blockers: promotion?.promotion_blockers || [],
    rows_written_to_vessel_snapshots: Number(recordsSaved || 0),
    rows_written_to_port_call_master: Number(portCallMasterRowsWritten || 0),
    rows_written_by_table: dbRowsWrittenByTable,
    active_dataset_pointer_updated: false,
    dashboard_summary_snapshot_written: Number(dashboardSummarySnapshotResult.summary_snapshot_rows || 0) > 0,
    latest_successful_run_id_updated: false,
    active_run_id: null,
    latest_successful_run_id: null,
    errors: [],
    storage_errors: [],
    promotion_errors: []
  };

  if (verification.rows_written_to_vessel_snapshots <= 0) {
    verification.storage_errors.push("rows_written_to_vessel_snapshots_zero");
  }
  if (verification.rows_written_to_port_call_master <= 0) {
    verification.storage_errors.push("rows_written_to_port_call_master_zero");
  }
  if (!verification.dashboard_summary_snapshot_written) {
    verification.storage_errors.push("dashboard_summary_snapshot_not_written");
  }
  if (!promoted) {
    verification.promotion_errors.push("active_dataset_pointer_not_promoted");
  }
  if (promotion?.promotable === false && Array.isArray(promotion.promotion_blockers) && promotion.promotion_blockers.length) {
    verification.promotion_blockers = promotion.promotion_blockers;
    verification.promotion_errors.push("promotion_blocked");
  }

  const activePointer = await supabase
    .from("active_dataset_pointer")
    .select("active_run_id,promoted_at")
    .eq("id", "current")
    .limit(1);
  if (activePointer.error) {
    verification.promotion_errors.push(`active_dataset_pointer_read_failed:${activePointer.error.message}`);
  } else {
    const pointerRow = Array.isArray(activePointer.data) ? activePointer.data[0] : activePointer.data;
    verification.active_run_id = pointerRow?.active_run_id || null;
    verification.active_dataset_pointer_updated = Boolean(runId && pointerRow?.active_run_id === runId);
    if (promoted && !verification.active_dataset_pointer_updated) {
      verification.promotion_errors.push("active_dataset_pointer_run_id_mismatch");
    }
  }

  const latestSummary = await supabase
    .from("dashboard_summary_snapshots")
    .select("run_id,record_count,all_vessels_count,generated_at,is_latest_successful")
    .eq("is_latest_successful", true)
    .order("generated_at", { ascending: false })
    .limit(1);
  if (latestSummary.error) {
    verification.promotion_errors.push(`latest_successful_summary_read_failed:${latestSummary.error.message}`);
  } else {
    const summaryRow = Array.isArray(latestSummary.data) ? latestSummary.data[0] : latestSummary.data;
    verification.latest_successful_run_id = summaryRow?.run_id || null;
    verification.latest_successful_record_count = Number(summaryRow?.all_vessels_count || summaryRow?.record_count || 0);
    verification.latest_successful_run_id_updated = Boolean(runId && summaryRow?.run_id === runId);
    if (promoted && !verification.latest_successful_run_id_updated) {
      verification.promotion_errors.push("latest_successful_run_id_not_updated");
    }
    if (promoted && verification.latest_successful_record_count <= 0) {
      verification.promotion_errors.push("latest_successful_summary_record_count_zero");
    }
  }

  verification.status = verification.storage_errors.length ? "failed" : "completed";
  verification.promotion_verification_status = verification.promotion_errors.length
    ? promoted ? "failed" : "not_promoted"
    : promoted ? "completed" : "not_promoted";
  verification.errors = verification.storage_errors;
  verification.all_errors = [...verification.storage_errors, ...verification.promotion_errors];
  return verification;
}

function eventTimeBucket(value, fallback = new Date()) {
  const date = new Date(value || fallback);
  if (Number.isNaN(date.getTime())) return kstSnapshotDate(fallback);
  date.setUTCMinutes(0, 0, 0);
  return date.toISOString();
}

function isAnchorageState(record = {}) {
  const facility = String(record.facility_type || "").toLowerCase();
  const status = String(record.status_bucket || record.status || "").toLowerCase();
  return facility.includes("anchorage") ||
    status.includes("anchorage") ||
    Boolean(record.is_anchorage_waiting) ||
    scoreNumber(record.anchorage_hours) > 0 ||
    hasValue(record.anchorage_name);
}

function isBerthState(record = {}) {
  const facility = String(record.facility_type || "").toLowerCase();
  return facility.includes("berth") || (hasValue(record.berth_name || record.berth) && !isAnchorageState(record));
}

function isInboundPilot(record = {}) {
  return /in|입항|inbound/i.test([record.pilot_direction, record.movement_type].filter(Boolean).join(" "));
}

function isOutboundPilot(record = {}) {
  return /out|출항|outbound/i.test([record.pilot_direction, record.movement_type].filter(Boolean).join(" "));
}

async function fetchPreviousSnapshotMap(supabase) {
  try {
    const { data, error } = await supabase
      .from("vessel_snapshots")
      .select("hybrid_entity_key,vessel_id,port_call_id,port_call_identity,port_code,port,berth_name,anchorage_name,facility_type,status_bucket,status,eta,etb,ata,atb,etd,atd,pilot_time,pilot_direction,movement_type,stay_hours,anchorage_hours,congestion_score,port_congestion_score,commercial_value_score,total_sales_priority_score,candidate_band,sales_priority_band,is_cleaning_candidate,is_immediate_candidate,collected_at")
      .order("collected_at", { ascending: false })
      .limit(Number(process.env.EVENT_PREVIOUS_SNAPSHOT_LIMIT || 5000));
    if (error) return new Map();
    const map = new Map();
    for (const row of data || []) {
      const key = lifecycleKey(row);
      if (key && !map.has(key)) map.set(key, row);
    }
    return map;
  } catch {
    return new Map();
  }
}

function eventRow(record, runId, now, type, eventTime, confidence, reason, previous = null) {
  const bucket = eventTimeBucket(eventTime, now);
  const portCallId = buildPortCallId(record);
  return {
    event_uid: stableEntityId("EVT", `${portCallId}-${type}-${bucket}`),
    hybrid_entity_key: record.hybrid_entity_key || record.vessel_id,
    master_vessel_id: fallbackMasterId(record),
    run_id: runId,
    vessel_id: record.vessel_id || null,
    port_call_id: portCallId,
    event_type: type,
    event_time: eventTime || now,
    event_time_bucket: bucket,
    port_code: record.port_code || null,
    berth_name: record.berth_name || record.berth || record.anchorage_name || null,
    confidence,
    source_name: record.source || record.source_name || record.source_mode || "snapshot_diff",
    source: record.source || record.source_name || record.source_mode || "snapshot_diff",
    port: record.port || record.port_name || null,
    created_at: now,
    previous_snapshot: previous ? compactPayload(previous) : {},
    payload: {
      event_reason: reason,
      event_source: "snapshot_diff",
      event_time_bucket: bucket,
      port_call_id: portCallId,
      commercial_value_score: commercialScore(record),
      candidate_band: candidateLabel(record)
    }
  };
}

function buildLifecycleEvents(records = [], previousMap = new Map(), runId, now) {
  const rows = [];
  for (const record of records) {
    if (!record.hybrid_entity_key && !record.vessel_id && !record.call_sign && !record.vessel_name) continue;
    const previous = previousMap.get(lifecycleKey(record)) || null;
    const previousAnchorage = isAnchorageState(previous || {});
    const currentAnchorage = isAnchorageState(record);
    const previousBerth = previous?.berth_name || previous?.berth || null;
    const currentBerth = record.berth_name || record.berth || null;
    const stayHours = scoreNumber(record.stay_hours);
    const anchorageHours = scoreNumber(record.anchorage_hours);
    const congestionScore = scoreNumber(record.congestion_score || record.port_congestion_score);
    const previousBand = candidateLabel(previous || {});
    const currentBand = candidateLabel(record);
    const previousOpportunity = previous ? (isSalesTargetRecord(previous) || isImmediateTargetRecord(previous)) : false;
    const currentOpportunity = isSalesTargetRecord(record) || isImmediateTargetRecord(record);

    if (!previous) rows.push(eventRow(record, runId, now, "PORT_CALL_CREATED", record.ata || record.eta || now, 80, "New port call identity detected", previous));
    if (record.eta && !previous?.eta) rows.push(eventRow(record, runId, now, "ARRIVAL_PLANNED", record.eta, 70, "ETA or planned arrival appeared", previous));
    if (record.ata && !previous?.ata) rows.push(eventRow(record, runId, now, "PORT_ARRIVAL", record.ata, 90, "ATA newly detected", previous));
    if ((record.pilot_time || record.movement_time) && isInboundPilot(record) && !previous?.pilot_time) rows.push(eventRow(record, runId, now, "PILOT_INBOUND", record.pilot_time || record.movement_time, 75, "Inbound pilot schedule detected", previous));
    if (currentBerth && currentBerth !== previousBerth && isBerthState(record)) rows.push(eventRow(record, runId, now, "BERTH_ASSIGNED", record.atb || record.etb || record.ata || now, 80, "Berth assignment changed or appeared", previous));
    if (currentAnchorage && !previousAnchorage) rows.push(eventRow(record, runId, now, "ANCHORAGE_START", record.ata || record.eta || now, 75, "Anchorage state appeared", previous));
    if (!currentAnchorage && previousAnchorage) rows.push(eventRow(record, runId, now, "ANCHORAGE_END", record.atb || record.ata || now, 70, "Anchorage state ended", previous));
    if (currentAnchorage && anchorageHours >= 120 && scoreNumber(previous?.anchorage_hours) < 120) rows.push(eventRow(record, runId, now, "ANCHORAGE_EXTENDED", now, 70, "Anchorage duration crossed 5 days", previous));
    if ((stayHours >= 72 || anchorageHours >= 72) && (!previous || scoreNumber(previous.stay_hours) < 72 && scoreNumber(previous.anchorage_hours) < 72)) rows.push(eventRow(record, runId, now, "LONG_STAY_DETECTED", now, 70, "Stay or anchorage crossed 72 hours", previous));
    if (congestionScore >= 60 && scoreNumber(previous?.congestion_score || previous?.port_congestion_score) < 60) rows.push(eventRow(record, runId, now, "CONGESTION_DETECTED", now, 70, "Congestion score crossed operational threshold", previous));
    if ((record.pilot_time || record.movement_time) && isOutboundPilot(record) && !isOutboundPilot(previous || {})) rows.push(eventRow(record, runId, now, "PILOT_OUTBOUND", record.pilot_time || record.movement_time, 75, "Outbound pilot schedule detected", previous));
    if (record.etd && !previous?.etd) rows.push(eventRow(record, runId, now, "DEPARTURE_PLANNED", record.etd, 70, "ETD or planned departure appeared", previous));
    if (record.atd && !previous?.atd) rows.push(eventRow(record, runId, now, "PORT_DEPARTURE", record.atd, 90, "ATD newly detected", previous));
    if (previous && currentBand !== previousBand) rows.push(eventRow(record, runId, now, "SCORE_BAND_CHANGED", now, 70, `Candidate band changed from ${previousBand} to ${currentBand}`, previous));
    if (currentOpportunity && !previousOpportunity) rows.push(eventRow(record, runId, now, "OPPORTUNITY_CREATED", now, 75, "Port-call commercial opportunity became active", previous));
    if (!currentOpportunity && previousOpportunity) rows.push(eventRow(record, runId, now, "OPPORTUNITY_CLOSED", record.atd || now, 70, "Port-call commercial opportunity closed or no longer qualifies", previous));
  }
  return uniqueBy(rows, row => row.event_uid);
}

function buildHistoricalWarehouseRows(records = [], runId, now) {
  const snapshotDate = kstSnapshotDate(now);
  const usefulRecords = records.filter(record => record.vessel_name || record.hybrid_entity_key || record.port_call_identity || record.port_call_key);
  const vesselRows = uniqueBy(usefulRecords.map(record => {
    const portCallId = buildPortCallId(record);
    const eligibleOpportunity = isOpportunityEligible(record);
    const opportunityStatus = eligibleOpportunity ? opportunityState(record) : null;
    return {
      snapshot_date: snapshotDate,
      run_id: runId,
      master_vessel_id: fallbackMasterId(record),
      port_call_id: portCallId,
      opportunity_id: eligibleOpportunity ? buildOpportunityId(record) : null,
      vessel_name: record.vessel_name || null,
      imo: record.imo || null,
      mmsi: record.mmsi || null,
      call_sign: record.call_sign || null,
      gt: record.gt || record.grtg || record.intrlGrtg || null,
      vessel_type_group: record.vessel_type_group || null,
      operator_name: record.operator_name || record.operator || null,
      agent_name: record.agent_name || record.agent || record.satmntEntrpsNm || record.entrpsCdNm || null,
      port_code: record.port_code || null,
      port_name: record.port_name || record.port || null,
      sub_port: record.sub_port || "",
      berth_name: record.berth_name || record.berth || null,
      terminal_name: record.terminal_name || record.terminal || null,
      status_bucket: record.status_bucket || record.status || null,
      stay_hours: scoreNumber(record.stay_hours),
      anchorage_hours: scoreNumber(record.anchorage_hours),
      congestion_score: scoreNumber(record.congestion_score || record.port_congestion_score),
      work_feasibility_score: scoreNumber(record.work_feasibility_score),
      biofouling_exposure_score: scoreNumber(record.biofouling_exposure_score || record.biofouling_risk_score),
      commercial_value_score: commercialScore(record),
      predicted_cleaning_opportunity_score: scoreNumber(record.predicted_cleaning_opportunity_score),
      candidate_band: historicalBand(record),
      opportunity_status: opportunityStatus,
      data_confidence_score: scoreNumber(record.data_confidence_score),
      source_quality_score: scoreNumber(record.source_confidence_score || record.data_quality_score || record.data_confidence_score),
      created_at: now,
      payload: storagePayload({
        hybrid_entity_key: record.hybrid_entity_key || record.vessel_id || null,
        port_call_identity: record.port_call_identity || record.port_call_key || null,
        opportunity_type: eligibleOpportunity ? opportunityType(record) : null,
        why_now: record.why_now || null,
        recommended_action: record.recommended_action || record.recommended_next_action || null,
        raw_archive_url: record.raw_archive_url || null,
        raw_archive_filename: record.raw_archive_filename || null
      })
    };
  }), row => `${row.snapshot_date}|${row.port_call_id}`);

  const portRows = [...groupBy(usefulRecords, record => `${record.port_code || record.port || "unknown"}|${record.sub_port || ""}`).entries()].map(([key, rows]) => {
    const [portCode, subPort] = key.split("|");
    const scores = rows.map(commercialScore);
    const congestionScores = rows.map(row => row.congestion_score || row.port_congestion_score);
    const immediateTargets = rows.filter(isImmediateTargetRecord).length;
    const salesTargets = rows.filter(row => isSalesTargetRecord(row) && !isImmediateTargetRecord(row)).length;
    const opportunityRecords = rows.filter(isOpportunityEligible);
    const topOpportunity = topOpportunityRecord(rows);
    return {
      snapshot_date: snapshotDate,
      run_id: runId,
      port_code: portCode,
      port_name: rows.find(row => row.port_name || row.port)?.port_name || rows.find(row => row.port)?.port || null,
      sub_port: subPort || "",
      top_port_call_id: topOpportunity ? buildPortCallId(topOpportunity) : null,
      top_opportunity_id: topOpportunity ? buildOpportunityId(topOpportunity) : null,
      total_vessels: rows.length,
      target_vessels: rows.filter(isSalesTargetRecord).length,
      immediate_targets: immediateTargets,
      sales_targets: salesTargets,
      watchlist_count: rows.filter(isWatchlistRecord).length,
      opportunity_count: opportunityRecords.length,
      open_opportunities: opportunityRecords.filter(row => !["won", "lost", "closed"].includes(opportunityState(row))).length,
      closed_opportunities: opportunityRecords.filter(row => ["won", "lost", "closed"].includes(opportunityState(row))).length,
      anchorage_vessels: rows.filter(row => row.is_anchorage_waiting || scoreNumber(row.anchorage_hours) > 0).length,
      long_stay_vessels: rows.filter(row => scoreNumber(row.stay_hours) >= 72 || scoreNumber(row.anchorage_hours) >= 72).length,
      avg_stay_hours: average(rows.map(row => row.stay_hours)),
      avg_anchorage_hours: average(rows.map(row => row.anchorage_hours)),
      avg_congestion_score: average(congestionScores),
      avg_commercial_value_score: average(scores),
      avg_predicted_cleaning_opportunity_score: average(rows.map(row => row.predicted_cleaning_opportunity_score)),
      port_opportunity_score: Math.min(100, Math.round(average(scores) * 0.6 + immediateTargets * 8 + salesTargets * 4)),
      port_congestion_score: Math.round(average(congestionScores)),
      created_at: now,
      payload: {
        high_value_vessel_count: rows.filter(row => commercialScore(row) >= 75).length,
        candidate_band_distribution: countBy(rows, historicalBand),
        opportunity_status_distribution: countBy(opportunityRecords, opportunityState)
      }
    };
  });

  const operatorRows = [...groupBy(usefulRecords.filter(record => normalizeCompanyName(record.operator_name || record.operator)), record => normalizeCompanyName(record.operator_name || record.operator)).entries()].map(([operatorNormalized, rows]) => {
    const opportunityRecords = rows.filter(isOpportunityEligible);
    const topOpportunity = topOpportunityRecord(rows);
    return {
      snapshot_date: snapshotDate,
      run_id: runId,
      operator_name: rows.find(row => row.operator_name || row.operator)?.operator_name || rows.find(row => row.operator)?.operator || operatorNormalized,
      operator_normalized: operatorNormalized,
      top_port_call_id: topOpportunity ? buildPortCallId(topOpportunity) : null,
      top_opportunity_id: topOpportunity ? buildOpportunityId(topOpportunity) : null,
      active_vessels: new Set(rows.map(row => row.master_vessel_id || row.hybrid_entity_key || row.imo || row.mmsi || row.call_sign || row.vessel_name).filter(Boolean)).size,
      target_vessels: rows.filter(isSalesTargetRecord).length,
      immediate_targets: rows.filter(isImmediateTargetRecord).length,
      opportunity_count: opportunityRecords.length,
      open_opportunities: opportunityRecords.filter(row => !["won", "lost", "closed"].includes(opportunityState(row))).length,
      avg_commercial_value_score: average(rows.map(commercialScore)),
      avg_predicted_cleaning_opportunity_score: average(rows.map(row => row.predicted_cleaning_opportunity_score)),
      avg_biofouling_exposure_score: average(rows.map(row => row.biofouling_exposure_score || row.biofouling_risk_score)),
      avg_congestion_score: average(rows.map(row => row.congestion_score || row.port_congestion_score)),
      repeat_caller_count: rows.filter(row => scoreNumber(row.repeat_caller_score) > 0 || scoreNumber(row.repeat_call_count) > 1).length,
      fleet_opportunity_score: Math.round(average(rows.map(row => row.fleet_opportunity_score || row.commercial_value_score))),
      contact_readiness_score: Math.round(average(rows.map(row => row.contact_readiness_score))),
      created_at: now,
      payload: {
        ports: [...new Set(rows.map(row => row.port_code || row.port_name || row.port).filter(Boolean))],
        candidate_band_distribution: countBy(rows, historicalBand),
        opportunity_status_distribution: countBy(opportunityRecords, opportunityState)
      }
    };
  });

  const routeRows = uniqueBy([...groupBy(usefulRecords.filter(record => record.previous_port || record.destination_port || record.next_port || record.route_region), record => [
    normalizeCompanyName(record.previous_port || ""),
    normalizeCompanyName(record.destination_port || record.destination || ""),
    normalizeCompanyName(record.next_port || ""),
    normalizeCompanyName(record.route_region || ""),
    record.vessel_type_group || ""
  ].join("|")).entries()].map(([key, rows]) => {
    const [previousPort, destinationPort, nextPort, routeRegion, vesselTypeGroup] = key.split("|");
    return {
      snapshot_date: snapshotDate,
      run_id: runId,
      previous_port: previousPort,
      destination_port: destinationPort,
      next_port: nextPort,
      route_region: routeRegion,
      vessel_type_group: vesselTypeGroup,
      vessel_count: rows.length,
      avg_stay_hours: average(rows.map(row => row.stay_hours)),
      avg_waiting_hours: average(rows.map(row => row.anchorage_hours)),
      avg_commercial_value_score: average(rows.map(commercialScore)),
      avg_biofouling_exposure_score: average(rows.map(row => row.biofouling_exposure_score || row.biofouling_risk_score)),
      congestion_probability: Math.min(100, Math.round(average(rows.map(row => row.congestion_score || row.port_congestion_score || row.predicted_congestion_score)))),
      created_at: now,
      payload: {}
    };
  }), row => `${row.snapshot_date}|${row.previous_port}|${row.destination_port}|${row.vessel_type_group}`);

  const opportunityRows = uniqueBy(usefulRecords.filter(record => commercialScore(record) >= 50 || scoreNumber(record.predicted_cleaning_opportunity_score) >= 60).map(record => {
    const portCallId = buildPortCallId(record);
    const state = opportunityState(record);
    const type = opportunityType(record);
    const closedAt = ["won", "lost", "closed"].includes(state) ? (record.closed_at || now) : null;
    return {
      snapshot_date: snapshotDate,
      run_id: runId,
      opportunity_id: buildOpportunityId(record),
      master_vessel_id: fallbackMasterId(record),
      port_call_id: portCallId,
      vessel_name: record.vessel_name || null,
      operator_name: record.operator_name || record.operator || null,
      agent_name: record.agent_name || record.agent || record.satmntEntrpsNm || record.entrpsCdNm || null,
      port_code: record.port_code || null,
      opportunity_type: type,
      opportunity_status: state,
      commercial_value_score: commercialScore(record),
      predicted_cleaning_opportunity_score: scoreNumber(record.predicted_cleaning_opportunity_score),
      work_feasibility_score: scoreNumber(record.work_feasibility_score),
      biofouling_exposure_score: scoreNumber(record.biofouling_exposure_score || record.biofouling_risk_score),
      candidate_band: historicalBand(record),
      why_now: record.why_now || record.candidate_summary_ko || null,
      recommended_action: record.recommended_action || record.recommended_next_action || null,
      lead_status: record.lead_status || "new_lead",
      first_detected_at: record.first_detected_at || record.identified_at || now,
      last_seen_at: now,
      closed_at: closedAt,
      close_reason: record.close_reason || null,
      created_at: now,
      payload: {
        hybrid_entity_key: record.hybrid_entity_key || record.vessel_id || null,
        port_call_identity: record.port_call_identity || record.port_call_key || null,
        opportunity_type: type,
        opportunity_status: state,
        score_reasons: buildScoreReasons(record),
        raw_archive_url: record.raw_archive_url || null,
        raw_archive_filename: record.raw_archive_filename || null
      }
    };
  }), row => `${row.snapshot_date}|${row.opportunity_id}`);

  return { vesselRows, portRows, operatorRows, routeRows, opportunityRows };
}

export async function recordRawArchiveIndex({ runId, archive = {}, counts = {}, generatedAt } = {}) {
  if (!runId || archive.status !== "uploaded") return { status: "skipped", reason: archive.status || "not_uploaded" };
  let supabase;
  try {
    supabase = getSupabase();
  } catch (error) {
    return { status: "skipped", reason: "supabase_not_configured" };
  }
  const row = {
    run_id: runId,
    source_name: "google_drive",
    source_key: `hwk-port-raw:${runId}`,
    collected_at: generatedAt || new Date().toISOString(),
    archive_filename: archive.name || null,
    archive_url: archive.webViewLink || null,
    archive_file_id: archive.file_id || null,
    record_count: Number(counts.raw_records || counts.records || 0),
    payload_role: "external_raw_archive",
    payload: {
      normalized_records: Number(counts.normalized_records || 0),
      target_records: Number(counts.target_records || 0)
    }
  };
  const { error } = await supabase.from("raw_archive_index").upsert(row, { onConflict: "source_name,source_key" });
  if (error) return { status: "failed", error: error.message };
  return { status: "indexed", source_key: row.source_key };
}

export async function saveToSupabase(records, options = {}) {
  const upsertDedupeAudit = {};
  const supabase = withDedupedUpserts(getSupabase(), upsertDedupeAudit);
  const now = new Date().toISOString();
  const runId = options.runId || createRunId();
  const diagnostics = options.diagnostics || {};
  const promotion = shouldPromoteRun(records, diagnostics);
  const lockedDataset = promotion.last_successful_dataset_lock?.locked === true;
  const runStatus = options.status === "failed"
    ? "failed"
    : promotion.promotable
      ? "promotable"
      : records.length
        ? lockedDataset
          ? "degraded_sample_only"
          : "degraded_not_promoted"
        : "no_live_data";
  const storageMode = leanStorageEnabled() ? "lean" : "full";
  const batchSize = Number(process.env.SUPABASE_BATCH_SIZE || 100);
  const schemaCompatibility = {
    vessel_snapshots: {
      status: "native_schema",
      optional_columns: ["gt_source", "eta_source", "congestion_source", "score_source"],
      stripped_optional_columns: [],
      retry_count: 0
    },
    port_call_master: {
      status: "native_schema",
      optional_columns: ["gt_source", "eta_source", "operator_source", "congestion_source", "score_source"],
      stripped_optional_columns: [],
      retry_count: 0
    },
    data_collection_runs: {
      status: "native_schema",
      optional_columns: [
        "raw_collected_rows",
        "normalized_rows",
        "all_vessels_count",
        "target_vessels_count",
        "gt_5000_plus_count",
        "unknown_gt_review_count",
        "staying_vessels_count",
        "arrival_pipeline_count",
        "scored_vessels_count",
        "candidates_count",
        "watchlist_count",
        "sales_candidates_count",
        "immediate_targets_count",
        "high_score_not_promoted_count",
        "candidate_promotion_error",
        "exclusion_reason_counts",
        "imo_missing_count",
        "imo_recovered_count",
        "high_value_low_confidence_count",
        "actionable_rows",
        "validation_status"
      ],
      stripped_optional_columns: [],
      retry_count: 0
    }
  };
  const preRetentionCleanup = await runLeanRetentionCleanup(supabase);
  const highScoreNotPromoted = records
    .filter(r => commercialScore(r) >= 65 && !isSalesTargetRecord(r))
    .map(r => ({
      vessel_name: r.vessel_name || r.name || "",
      port_call_id: buildPortCallId(r),
      commercial_value_score: commercialScore(r),
      candidate_band: candidateLabel(r),
      exclusion_reason: candidateExclusionReason(r) || "not_promoted"
    }));
  const exclusionReasonCounts = highScoreNotPromoted.reduce((acc, row) => {
    acc[row.exclusion_reason] = (acc[row.exclusion_reason] || 0) + 1;
    return acc;
  }, {});
  const highScoreNotPromotedCount = highScoreNotPromoted.length;
  const imoRecoveryDiagnostics = buildImoRecoveryDiagnostics(records);

  const runInsert = await insertWithSchemaCompatibility(supabase, "data_collection_runs", {
    run_id: runId,
    started_at: options.startedAt || now,
    finished_at: now,
    status: runStatus,
    source_summary: {
      ...diagnostics,
      rule_versioning: {
        commercial_rule_version: COMMERCIAL_RULE_VERSION,
        candidate_rule_version: CANDIDATE_RULE_VERSION,
        explainability_rule_version: EXPLAINABILITY_RULE_VERSION
      },
      imo_recovery: imoRecoveryDiagnostics,
      db_storage_mode: storageMode,
      db_analytics_scope: analyticsScope(),
      db_foundation_write_mode: foundationWriteMode(),
      db_retention_cleanup: String(process.env.DB_RETENTION_CLEANUP || "true").toLowerCase() !== "false",
      db_pre_retention_cleanup: preRetentionCleanup,
      last_successful_dataset_lock: promotion.last_successful_dataset_lock,
      candidate_promotion_audit: {
        candidate_generation_count: records.filter(r => commercialScore(r) >= 50 && !isHardCandidateExcluded(r) && !isDepartedRecord(r)).length,
        candidate_promotion_count: records.filter(r => isSalesTargetRecord(r) || isImmediateTargetRecord(r)).length,
        candidate_excluded_count: highScoreNotPromotedCount,
        candidate_exclusion_samples: highScoreNotPromoted.slice(0, 25)
      }
    },
    total_rows: Number(diagnostics.real_row_count || records.length || 0),
    raw_collected_rows: Number(diagnostics.real_row_count || records.length || 0),
    normalized_rows: records.length,
    all_vessels_count: records.length,
    target_vessels_count: records.filter(r => ["target_vessel", "unknown_gt_review"].includes(r.commercial_relevance_status)).length,
    gt_5000_plus_count: records.filter(r => r.gt_status === "target_vessel").length,
    unknown_gt_review_count: records.filter(r => r.gt_status === "unknown_gt_review").length,
    staying_vessels_count: records.filter(r => ["arrived_staying", "berthed", "anchorage_waiting"].includes(r.status_bucket)).length,
    arrival_pipeline_count: records.filter(r => r.status_bucket === "arriving_soon").length,
    scored_vessels_count: records.filter(r => typeof r.total_sales_priority_score === "number").length,
    candidates_count: records.filter(r => isSalesTargetRecord(r) || isImmediateTargetRecord(r)).length,
    watchlist_count: records.filter(isWatchlistRecord).length,
    sales_candidates_count: records.filter(isSalesTargetRecord).length,
    immediate_targets_count: records.filter(isImmediateTargetRecord).length,
    high_score_not_promoted_count: highScoreNotPromotedCount,
    candidate_promotion_error: highScoreNotPromotedCount > 0,
    exclusion_reason_counts: exclusionReasonCounts,
    imo_missing_count: records.filter(r => !r.imo).length,
    imo_recovered_count: imoRecoveryDiagnostics.imo_recovered_count,
    high_value_low_confidence_count: records.filter(r => (r.commercial_value_score || 0) >= 35 && ((r.data_confidence_score || 0) < 60 || !r.imo)).length,
    actionable_rows: records.filter(r => r.actionable_source_row !== false).length,
    validation_status: promotion.promotable ? "passed" : "not_promoted",
    error_summary: { error: options.error || null, promotion }
  }, schemaCompatibility.data_collection_runs);
  if (runInsert.error) throw runInsert.error;
  const sourceCollectionLogRows = dedupeForUpsert(
    buildSourceCollectionLogRows(diagnostics, runId),
    row => row.source_log_id,
    "source_collection_logs",
    upsertDedupeAudit
  );
  if (sourceCollectionLogRows.length) {
    for (let index = 0; index < sourceCollectionLogRows.length; index += batchSize) {
      const batch = sourceCollectionLogRows.slice(index, index + batchSize);
      const { error } = await supabase.from("source_collection_logs").upsert(batch, { onConflict: "source_log_id" });
      if (error) throw error;
    }
  }
  const vesselUniverseAudit = buildVesselUniverseAuditRow(records, diagnostics, runId, now);
  const vesselUniverseAuditResult = await upsertOptionalDiagnosticsRow(
    supabase,
    "vessel_universe_audit",
    vesselUniverseAudit,
    { onConflict: "run_id" }
  );

  const rows = dedupeForUpsert(records.map(r => ({
    snapshot_uid: stableEntityId("SNAP", `${runId}-${buildPortCallId(r)}-${r.hybrid_entity_key || r.vessel_id || r.call_sign || r.vessel_name || ""}-${r.source || r.source_name || ""}`),
    run_id: runId,
    snapshot_date: now.slice(0, 10),
    master_vessel_id: fallbackMasterId(r),
    vessel_id: r.vessel_id,
    vessel_name: r.vessel_name,
    port: r.port,
    port_code: r.port_code || null,
    port_name: r.port_name || r.port || null,
    berth: r.berth || null,
    berth_name: r.berth_name || r.berth || null,
    anchorage_name: r.anchorage_name || r.anchorage_zone || null,
    call_sign: r.call_sign || null,
    imo: r.imo || null,
    mmsi: r.mmsi || null,
    vessel_type: r.vessel_type || null,
    gt: r.gt || null,
    gt_source: r.gt_source || (r.grtg ? "port_operation_grtg" : r.intrlGrtg ? "port_operation_intrlGrtg" : r.gt ? "source_gt" : "unknown"),
    eta_source: r.eta_source || (r.eta_candidate ? "pilot_schedule" : r.eta ? "source_eta" : "unknown"),
    congestion_source: r.congestion_source || (r.anchorage_hours || r.stay_hours ? "port_call_duration" : r.port_congestion_score ? "port_summary" : "scoring_engine"),
    score_source: r.score_source || "commercial_scoring_engine",
    eta: r.eta || null,
    ata: r.ata || null,
    etb: r.etb || null,
    atb: r.atb || null,
    etd: r.etd || null,
    atd: r.atd || null,
    stay_hours: r.stay_hours || 0,
    berth_hours: r.berth_hours || 0,
    anchorage_hours: r.anchorage_hours || 0,
    status: r.status,
    operator: r.operator || null,
    operator_name: r.operator_name || r.operator || null,
    operator_normalized: r.operator_normalized || normalizeCompanyName(r.operator_name || r.operator) || null,
    operator_inferred: Boolean(r.operator_inferred),
    operator_confidence: Number(r.operator_confidence || 0),
    operator_source: r.operator_source || null,
    agent_name: r.agent_name || r.agent || r.satmntEntrpsNm || r.entrpsCdNm || null,
    agent_normalized: r.agent_normalized || normalizeCompanyName(r.agent_name || r.agent || r.satmntEntrpsNm || r.entrpsCdNm) || null,
    agent_source: r.agent_source || null,
    manager_name: r.manager_name || null,
    owner_name: r.owner_name || null,
    contact_readiness_score: Number(r.contact_readiness_score || 0),
    contact_intelligence_score: Number(r.contact_intelligence_score || 0),
    contact_path_available: Boolean(r.contact_path_available || r.operator_name || r.operator || r.agent_name || r.agent),
    contact_path_status: r.contact_path_status || (r.contact_path_available ? "contact_available" : r.agent_name || r.agent ? "agent_known" : r.operator_name || r.operator ? "operator_known" : "unknown"),
    contact_priority: r.contact_priority || null,
    contact_path_label_ko: r.contact_path_label_ko || null,
    operator_website: r.operator_website || r.operator_url || null,
    operator_email: r.operator_email || null,
    operator_phone: r.operator_phone || null,
    agent_website: r.agent_website || r.agent_url || null,
    agent_email: r.agent_email || null,
    agent_phone: r.agent_phone || null,
    previous_port: r.previous_port || null,
    destination_port: r.destination_port || r.destination || r.next_port || null,
    next_port: r.next_port || null,
    route_region: r.route_region || null,
    route_pattern_confidence: Number(r.route_pattern_confidence || 0),
    predicted_arrival_time: r.predicted_arrival_time || null,
    arrival_prediction_confidence: Number(r.arrival_prediction_confidence || 0),
    predicted_congestion: Number(r.predicted_congestion || 0),
    predicted_cleaning_window: Number(r.predicted_cleaning_window || 0),
    predicted_congestion_score: Number(r.predicted_congestion_score || r.predicted_congestion || 0),
    congestion_forecast_band: r.congestion_forecast_band || null,
    anchorage_probability: Number(r.anchorage_probability || 0),
    predicted_work_window_hours: Number(r.predicted_work_window_hours || 0),
    work_window_confidence: Number(r.work_window_confidence || 0),
    calls_last_3m: Number(r.calls_last_3m || 0),
    calls_last_6m: Number(r.calls_last_6m || 0),
    calls_last_12m: Number(r.calls_last_12m || r.repeat_call_count || 0),
    repeat_caller_score: Number(r.repeat_caller_score || 0),
    repeat_operator_score: Number(r.repeat_operator_score || 0),
    repeat_call_count: Number(r.repeat_call_count || 0),
    repeat_operator_count: Number(r.repeat_operator_count || 0),
    operator_call_count: Number(r.operator_call_count || r.repeat_operator_count || 0),
    operator_vessel_count: Number(r.operator_vessel_count || r.repeat_operator_count || 0),
    operator_port_count: Number(r.operator_port_count || 0),
    fleet_opportunity_score: Number(r.fleet_opportunity_score || 0),
    low_speed_exposure: Number(r.low_speed_exposure || 0),
    idle_exposure: Number(r.idle_exposure || 0),
    anchorage_exposure: Number(r.anchorage_exposure || 0),
    biofouling_exposure_score: Number(r.biofouling_exposure_score || 0),
    biofouling_exposure_band: r.biofouling_exposure_band || null,
    biofouling_exposure_reasons: r.biofouling_exposure_reasons || [],
    predicted_cleaning_opportunity_score: Number(r.predicted_cleaning_opportunity_score || 0),
    cleaning_opportunity_band: r.cleaning_opportunity_band || null,
    opportunity_summary: r.opportunity_summary || null,
    arrival_opportunity_score: Number(r.arrival_opportunity_score || 0),
    predicted_arrival_pipeline: Boolean(r.predicted_arrival_pipeline),
    work_feasibility_score: Number(r.work_feasibility_score || 0),
    lead_status: r.lead_status || "monitor",
    lead_priority_score: Number(r.lead_priority_score || 0),
    why_now: buildWhyNowKo(r),
    candidate_summary_ko: buildCandidateSummaryKo(r),
    sales_angle: r.sales_angle || null,
    recommended_next_action: r.recommended_next_action || null,
    recommended_action: buildRecommendedActionKo(r),
    action_priority: r.action_priority || null,
    recommended_contact_path: r.recommended_contact_path || null,
    recommended_department: r.recommended_department || null,
    recommended_email_draft: r.recommended_email_draft || null,
    recommended_followup_date: r.recommended_followup_date || null,
    lead_timeline: r.lead_timeline || [],
    last_contacted_at: r.last_contacted_at || null,
    follow_up_due: r.follow_up_due || null,
    quote_status: r.quote_status || null,
    notes: r.notes || null,
    actual_arrival_time: r.actual_arrival_time || null,
    prediction_error_hours: r.prediction_error_hours ?? null,
    alert_candidate: Boolean(r.alert_candidate),
    information_enrichment_needed: Boolean(r.information_enrichment_needed),
    global_rank: r.global_rank || null,
    global_percentile: r.global_percentile || null,
    port_rank: r.port_rank || null,
    port_percentile: r.port_percentile || null,
    port_call_id: buildPortCallId(r),
    port_call_identity: r.port_call_identity || r.port_call_key || null,
    sub_port: r.sub_port || null,
    source_confidence_score: Number(r.source_confidence_score || r.data_confidence_score || r.data_quality_score || 0),
    data_quality_tier: r.data_quality_tier || null,
    data_quality_score: Number(r.data_quality_score || 0),
    data_quality_band: r.data_quality_band || null,
    risk_score: r.risk_score || 0,
    total_sales_priority_score: r.total_sales_priority_score || 0,
    commercial_value_score: r.commercial_value_score || r.total_sales_priority_score || 0,
    commercial_value_band: r.commercial_value_band || r.sales_priority_band || "low_priority",
    data_confidence_score: r.data_confidence_score || 0,
    candidate_band: r.candidate_band || r.sales_priority_band || candidateLabel(r),
    sales_reason: r.sales_reason || r.reason_codes || [],
    reason_codes: r.reason_codes || [],
    hybrid_entity_key: r.hybrid_entity_key || r.vessel_id,
    payload: storagePayload(r),
    updated_at: r.updated_at || now,
    collected_at: now,
    source: r.source || r.source_mode || "korea-port-hull-intelligence",
    source_name: r.source || r.source_label || r.source_mode || "korea-port-hull-intelligence"
  })), row => row.snapshot_uid, "vessel_snapshots", upsertDedupeAudit);

  if (!rows.length) {
    return {
      runId,
      recordsSaved: 0,
      table: "vessel_snapshots",
      mode: "empty",
      promoted: false,
      promotion,
      last_successful_dataset_lock: promotion.last_successful_dataset_lock,
      summary_snapshot_write_status: "skipped_last_successful_dataset_lock",
      materialized_current_write_status: "skipped_last_successful_dataset_lock"
    };
  }

  const previousSnapshotMap = await fetchPreviousSnapshotMap(supabase);

  let recordsSaved = 0;
  for (let index = 0; index < rows.length; index += batchSize) {
    const batch = rows.slice(index, index + batchSize);
    const { error } = await upsertWithSchemaCompatibility(
      supabase,
      "vessel_snapshots",
      batch,
      { onConflict: "snapshot_uid" },
      schemaCompatibility.vessel_snapshots
    );
    if (error) throw error;
    recordsSaved += batch.length;
  }

  const portCallMasterRows = uniqueBy(records
    .filter(r => r.port_code || r.port)
    .map(r => ({
      port_call_id: buildPortCallId(r),
      run_id: runId,
      master_vessel_id: fallbackMasterId(r),
      hybrid_entity_key: r.hybrid_entity_key || r.vessel_id || null,
      port_call_identity: r.port_call_identity || r.port_call_key || null,
      vessel_name: r.vessel_name || null,
      call_sign: r.call_sign || null,
      imo: r.imo || null,
      mmsi: r.mmsi || null,
      gt_source: r.gt_source || (r.grtg ? "port_operation_grtg" : r.intrlGrtg ? "port_operation_intrlGrtg" : r.gt ? "source_gt" : "unknown"),
      eta_source: r.eta_source || (r.eta_candidate ? "pilot_schedule" : r.eta ? "source_eta" : "unknown"),
      port_code: r.port_code || r.port || null,
      port_name: r.port_name || r.port || null,
      sub_port: r.sub_port || null,
      arrival: r.ata || r.eta || null,
      departure: r.atd || r.etd || null,
      eta: r.eta || null,
      etb: r.etb || r.etb_candidate || null,
      ata: r.ata || null,
      atb: r.atb || null,
      etd: r.etd || null,
      atd: r.atd || null,
      arrival_time: r.ata || r.eta || null,
      departure_time: r.atd || r.etd || null,
      pilot_inbound: r.pilot_inbound || (isInboundPilot(r) ? (r.pilot_time || r.movement_time || null) : null),
      pilot_outbound: r.pilot_outbound || (isOutboundPilot(r) ? (r.pilot_time || r.movement_time || null) : null),
      pilot_inbound_time: r.pilot_inbound_time || r.pilot_inbound || (isInboundPilot(r) ? (r.pilot_time || r.movement_time || null) : null),
      pilot_outbound_time: r.pilot_outbound_time || r.pilot_outbound || (isOutboundPilot(r) ? (r.pilot_time || r.movement_time || null) : null),
      berth: r.berth || r.berth_name || null,
      berth_name: r.berth_name || r.berth || null,
      terminal: r.terminal || r.terminal_name || null,
      terminal_name: r.terminal_name || r.terminal || null,
      anchorage_name: r.anchorage_name || r.anchorage_zone || null,
      operator: r.operator || r.operator_name || null,
      operator_name: r.operator_name || r.operator || null,
      operator_source: r.operator_source || null,
      operator_normalized: r.operator_normalized || normalizeCompanyName(r.operator_name || r.operator) || null,
      agent: r.agent || r.agent_name || r.satmntEntrpsNm || r.entrpsCdNm || null,
      agent_name: r.agent_name || r.agent || r.satmntEntrpsNm || r.entrpsCdNm || null,
      agent_normalized: r.agent_normalized || normalizeCompanyName(r.agent_name || r.agent || r.satmntEntrpsNm || r.entrpsCdNm) || null,
      status_bucket: r.status_bucket || r.status || null,
      stay_hours: scoreNumber(r.stay_hours || r.current_call_stay_hours || r.cumulative_stay_hours),
      anchorage_hours: scoreNumber(r.anchorage_hours),
      work_window_hours: scoreNumber(r.work_window_hours || r.predicted_work_window_hours),
      commercial_value_score: Number(r.commercial_value_score || r.total_sales_priority_score || 0),
      score_source: r.score_source || "commercial_scoring_engine",
      candidate_band: r.candidate_band || r.sales_priority_band || "general",
      work_feasibility_score: Number(r.work_feasibility_score || 0),
      congestion_score: scoreNumber(r.congestion_score || r.port_congestion_score || r.congestion_exposure_score),
      congestion_source: r.congestion_source || (r.anchorage_hours || r.stay_hours ? "port_call_duration" : r.port_congestion_score ? "port_summary" : "scoring_engine"),
      biofouling_exposure_score: scoreNumber(r.biofouling_exposure_score || r.biofouling_risk_score || r.biofouling_score),
      data_confidence_score: scoreNumber(r.data_confidence_score),
      contact_readiness_score: Number(r.contact_readiness_score || 0),
      last_seen: now,
      created_at: r.created_at || now,
      updated_at: r.updated_at || now,
      payload: storagePayload({
        ...r,
        port_call_master_role: "unique_port_visit_commercial_opportunity"
      })
    })), row => row.port_call_id);

  for (let index = 0; index < portCallMasterRows.length; index += batchSize) {
    const batch = portCallMasterRows.slice(index, index + batchSize);
    const { error } = await upsertWithSchemaCompatibility(
      supabase,
      "port_call_master",
      batch,
      { onConflict: "port_call_id" },
      schemaCompatibility.port_call_master
    );
    if (error) throw error;
  }

  const entities = dedupeForUpsert(records.map(r => ({
    hybrid_entity_key: r.hybrid_entity_key || r.vessel_id,
    vessel_id: r.vessel_id,
    vessel_name: r.vessel_name,
    imo: r.imo || null,
    mmsi: r.mmsi || null,
    call_sign: r.call_sign || null,
    vessel_type: r.vessel_type || null,
    gt: r.gt || null,
    operator: r.operator || null,
    last_seen_at: now,
    payload: storagePayload(r)
  })).filter(r => r.hybrid_entity_key), row => row.hybrid_entity_key, "vessel_entities", upsertDedupeAudit);

  for (let index = 0; index < entities.length; index += batchSize) {
    const batch = entities.slice(index, index + batchSize);
    const { error } = await supabase
      .from("vessel_entities")
      .upsert(batch, { onConflict: "hybrid_entity_key" });
    if (error) throw error;
  }

  let masterRows = dedupeForUpsert(records.map(r => ({
    master_vessel_id: fallbackMasterId(r),
    imo: r.imo || null,
    mmsi: r.mmsi || null,
    call_sign: r.call_sign || null,
    canonical_name: r.vessel_name,
    normalized_name: r.normalized_vessel_name || normalizeVesselName(r.vessel_name),
    vessel_type: r.vessel_type || null,
    vessel_type_group: r.vessel_type_group || null,
    gt: r.gt || null,
    dwt: r.dwt || null,
    loa: r.loa || null,
    beam: r.beam || null,
    operator: r.operator_name || r.operator || null,
    operator_normalized: r.operator_normalized || normalizeCompanyName(r.operator_name || r.operator) || null,
    flag: r.flag || null,
    identity_confidence: identityConfidence(r),
    imo_status: r.imo_status || (r.imo ? "present" : "missing"),
    last_seen: now,
    updated_at: now,
    payload: storagePayload(r)
  })).filter(r => r.master_vessel_id), row => row.master_vessel_id, "vessel_master", upsertDedupeAudit);

  const existingMasters = new Map();
  for (let index = 0; index < masterRows.length; index += batchSize) {
    const ids = masterRows.slice(index, index + batchSize).map(row => row.master_vessel_id);
    if (!ids.length) continue;
    const { data, error } = await supabase
      .from("vessel_master")
      .select("master_vessel_id,imo,mmsi,call_sign,canonical_name,normalized_name,vessel_type,vessel_type_group,gt,dwt,loa,beam,operator,operator_normalized,flag,identity_confidence,imo_status,first_seen")
      .in("master_vessel_id", ids);
    if (error) throw error;
    for (const row of data || []) existingMasters.set(row.master_vessel_id, row);
  }

  masterRows = dedupeForUpsert(masterRows.map(row => {
    const old = existingMasters.get(row.master_vessel_id);
    if (!old) return row;
    const oldConfidence = Number(old.identity_confidence || 0);
    const newConfidence = Number(row.identity_confidence || 0);
    const keepOldIdentity = oldConfidence > newConfidence;
    return {
      ...row,
      imo: row.imo || old.imo || null,
      mmsi: row.mmsi || old.mmsi || null,
      call_sign: row.call_sign || old.call_sign || null,
      canonical_name: keepOldIdentity ? old.canonical_name || row.canonical_name : row.canonical_name || old.canonical_name,
      normalized_name: keepOldIdentity ? old.normalized_name || row.normalized_name : row.normalized_name || old.normalized_name,
      vessel_type: row.vessel_type || old.vessel_type || null,
      vessel_type_group: row.vessel_type_group || old.vessel_type_group || null,
      gt: row.gt || old.gt || null,
      dwt: row.dwt || old.dwt || null,
      loa: row.loa || old.loa || null,
      beam: row.beam || old.beam || null,
      operator: row.operator || old.operator || null,
      operator_normalized: row.operator_normalized || old.operator_normalized || null,
      flag: row.flag || old.flag || null,
      identity_confidence: Math.max(oldConfidence, newConfidence),
      imo_status: row.imo_status || old.imo_status || null,
      first_seen: old.first_seen || row.first_seen
    };
  }), row => row.master_vessel_id, "vessel_master_after_merge", upsertDedupeAudit);

  for (let index = 0; index < masterRows.length; index += batchSize) {
    const batch = masterRows.slice(index, index + batchSize);
    const { error } = await supabase.from("vessel_master").upsert(batch, { onConflict: "master_vessel_id" });
    if (error) throw error;
  }

  const operatorRows = uniqueBy(records
    .map(r => {
      const operatorName = r.operator_name || r.operator;
      const operatorNormalized = r.operator_normalized || normalizeCompanyName(operatorName);
      if (!operatorName || !operatorNormalized) return null;
      return {
        operator_id: stableEntityId("OP", operatorNormalized),
        operator_name: operatorName,
        operator_normalized: operatorNormalized,
        website: r.operator_website || r.operator_url || null,
        country: r.operator_country || null,
        fleet_size: r.operator_fleet_size ? Number(r.operator_fleet_size) : null,
        segment: r.operator_segment || r.commercial_segment || null,
        source: r.operator_source || "collector",
        confidence: Number(r.operator_confidence || 0),
        last_seen: now,
        payload: {
          inferred: Boolean(r.operator_inferred),
          source: r.operator_source || null
        }
      };
    })
    .filter(Boolean), row => row.operator_normalized);

  for (let index = 0; index < operatorRows.length; index += batchSize) {
    const batch = operatorRows.slice(index, index + batchSize);
    const { error } = await supabase.from("operator_master").upsert(batch, { onConflict: "operator_normalized" });
    if (error) throw error;
  }

  const agentRows = uniqueBy(records
    .map(r => {
      const agentName = r.agent_name || r.agent || r.satmntEntrpsNm || r.entrpsCdNm;
      const agentNormalized = r.agent_normalized || normalizeCompanyName(agentName);
      if (!agentName || !agentNormalized) return null;
      return {
        agent_id: stableEntityId("AG", agentNormalized),
        agent_name: agentName,
        agent_normalized: agentNormalized,
        email: r.agent_email || null,
        phone: r.agent_phone || null,
        website: r.agent_website || r.agent_url || null,
        location: r.agent_location || r.port_name || r.port || null,
        source: r.agent_source || "collector",
        last_seen: now,
        payload: {
          satmntEntrpsNm: r.satmntEntrpsNm || null,
          entrpsCdNm: r.entrpsCdNm || null
        }
      };
    })
    .filter(Boolean), row => row.agent_normalized);

  for (let index = 0; index < agentRows.length; index += batchSize) {
    const batch = agentRows.slice(index, index + batchSize);
    const { error } = await supabase.from("agent_master").upsert(batch, { onConflict: "agent_normalized" });
    if (error) throw error;
  }

  const agentOperatorLinks = uniqueBy(records
    .map(r => {
      const operatorName = r.operator_name || r.operator;
      const agentName = r.agent_name || r.agent || r.satmntEntrpsNm || r.entrpsCdNm;
      const operatorNormalized = r.operator_normalized || normalizeCompanyName(operatorName);
      const agentNormalized = r.agent_normalized || normalizeCompanyName(agentName);
      if (!operatorNormalized || !agentNormalized) return null;
      return {
        link_id: stableEntityId("AGOP", `${agentNormalized}-${operatorNormalized}-${r.operator_source || "collector"}`),
        agent_id: stableEntityId("AG", agentNormalized),
        operator_id: stableEntityId("OP", operatorNormalized),
        agent_name: agentName,
        operator_name: operatorName,
        agent_normalized: agentNormalized,
        operator_normalized: operatorNormalized,
        source: r.operator_source || r.agent_source || "collector",
        confidence: Number(r.operator_confidence || 0),
        inferred: Boolean(r.operator_inferred),
        last_seen: now,
        payload: storagePayload(r)
      };
    })
    .filter(Boolean), row => `${row.agent_normalized}|${row.operator_normalized}|${row.source}`);

  for (let index = 0; index < agentOperatorLinks.length; index += batchSize) {
    const batch = agentOperatorLinks.slice(index, index + batchSize);
    const { error } = await supabase.from("agent_operator_links").upsert(batch, { onConflict: "agent_normalized,operator_normalized,source" });
    if (error) throw error;
  }

  for (let index = 0; index < agentOperatorLinks.length; index += batchSize) {
    const batch = agentOperatorLinks.slice(index, index + batchSize).map(row => ({
      mapping_id: row.link_id,
      agent_id: row.agent_id,
      operator_id: row.operator_id,
      agent_name: row.agent_name,
      operator_name: row.operator_name,
      agent_normalized: row.agent_normalized,
      operator_normalized: row.operator_normalized,
      source: row.source,
      confidence: row.confidence,
      inferred: row.inferred,
      last_seen: row.last_seen,
      payload: storagePayload(row.payload)
    }));
    const { error } = await supabase.from("agent_operator_mapping").upsert(batch, { onConflict: "agent_normalized,operator_normalized,source" });
    if (error) throw error;
  }

  const contactRows = uniqueBy(records
    .flatMap(r => {
      const out = [];
      const operatorName = r.operator_name || r.operator;
      const operatorNormalized = r.operator_normalized || normalizeCompanyName(operatorName);
      if (operatorName && operatorNormalized) {
        out.push({
          contact_id: stableEntityId("CT", `${operatorNormalized}-operator-${r.operator_source || "collector"}`),
          company_name: operatorName,
          company_normalized: operatorNormalized,
          contact_type: "operator",
          company_type: "operator",
          email: r.operator_email || r.general_email || null,
          general_email: r.general_email || r.operator_email || null,
          operations_email: r.operations_email || null,
          chartering_email: r.chartering_email || null,
          purchasing_email: r.purchasing_email || null,
          technical_email: r.technical_email || null,
          phone: r.operator_phone || null,
          website: r.operator_website || r.operator_url || null,
          country: r.operator_country || r.country || null,
          source: r.operator_source || "collector",
          confidence: Number(r.operator_confidence || 0),
          last_verified: r.contact_last_verified || null,
          updated_at: now,
          payload: storagePayload(r)
        });
      }
      const agentName = r.agent_name || r.agent || r.satmntEntrpsNm || r.entrpsCdNm;
      const agentNormalized = r.agent_normalized || normalizeCompanyName(agentName);
      if (agentName && agentNormalized) {
        out.push({
          contact_id: stableEntityId("CT", `${agentNormalized}-agent-${r.agent_source || "collector"}`),
          company_name: agentName,
          company_normalized: agentNormalized,
          contact_type: "agent",
          company_type: "agent",
          email: r.agent_email || r.general_email || null,
          general_email: r.general_email || r.agent_email || null,
          operations_email: r.operations_email || null,
          chartering_email: r.chartering_email || null,
          purchasing_email: r.purchasing_email || null,
          technical_email: r.technical_email || null,
          phone: r.agent_phone || null,
          website: r.agent_website || r.agent_url || null,
          country: r.agent_country || r.country || null,
          source: r.agent_source || "collector",
          confidence: Number(r.agent_confidence || r.operator_confidence || 0),
          last_verified: r.contact_last_verified || null,
          updated_at: now,
          payload: storagePayload(r)
        });
      }
      return out;
    }), row => `${row.company_normalized}|${row.contact_type}|${row.source}`);

  for (let index = 0; index < contactRows.length; index += batchSize) {
    const batch = contactRows.slice(index, index + batchSize);
    const { error } = await supabase.from("contact_master").upsert(batch, { onConflict: "company_normalized,contact_type,source" });
    if (error) throw error;
  }

  const operatorHistoryRows = uniqueBy(records
    .filter(r => r.operator_name || r.operator || r.agent_name || r.agent || r.satmntEntrpsNm || r.entrpsCdNm)
    .map(r => ({
      history_id: stableEntityId("VOH", `${runId}-${r.hybrid_entity_key || r.vessel_id}-${r.port_call_identity || r.port_code || r.port || ""}`),
      run_id: runId,
      master_vessel_id: fallbackMasterId(r),
      hybrid_entity_key: r.hybrid_entity_key || r.vessel_id,
      vessel_name: r.vessel_name || null,
      port_code: r.port_code || null,
      operator_name: r.operator_name || r.operator || null,
      operator_normalized: r.operator_normalized || normalizeCompanyName(r.operator_name || r.operator) || null,
      operator_inferred: Boolean(r.operator_inferred),
      operator_confidence: Number(r.operator_confidence || 0),
      operator_source: r.operator_source || null,
      agent_name: r.agent_name || r.agent || r.satmntEntrpsNm || r.entrpsCdNm || null,
      agent_normalized: r.agent_normalized || normalizeCompanyName(r.agent_name || r.agent || r.satmntEntrpsNm || r.entrpsCdNm) || null,
      agent_source: r.agent_source || null,
      contact_readiness_score: Number(r.contact_readiness_score || 0),
      contact_path_status: r.contact_path_status || (r.contact_path_available ? "contact_available" : r.agent_name || r.agent ? "agent_known" : r.operator_name || r.operator ? "operator_known" : "unknown"),
      contact_priority: r.contact_priority || null,
      contact_path_label_ko: r.contact_path_label_ko || null,
      collected_at: now,
      payload: storagePayload(r)
    })), row => row.history_id);

  for (let index = 0; index < operatorHistoryRows.length; index += batchSize) {
    const batch = operatorHistoryRows.slice(index, index + batchSize);
    const { error } = await supabase.from("vessel_operator_history").upsert(batch, { onConflict: "history_id" });
    if (error) throw error;
  }

  for (let index = 0; index < operatorHistoryRows.length; index += batchSize) {
    const batch = operatorHistoryRows.slice(index, index + batchSize).map(row => ({
      ...row,
      contact_path_available: Boolean(row.payload?.contact_path_available || row.operator_name || row.agent_name),
      contact_path_status: row.contact_path_status || row.payload?.contact_path_status || (row.payload?.contact_path_available ? "contact_available" : row.agent_name ? "agent_known" : row.operator_name ? "operator_known" : "unknown"),
      contact_priority: row.contact_priority || row.payload?.contact_priority || null,
      contact_path_label_ko: row.contact_path_label_ko || row.payload?.contact_path_label_ko || null
    }));
    const { error } = await supabase.from("operator_history").upsert(batch, { onConflict: "history_id" });
    if (error) throw error;
  }

  for (let index = 0; index < operatorHistoryRows.length; index += batchSize) {
    const batch = operatorHistoryRows.slice(index, index + batchSize).map(row => ({
      history_id: row.history_id.replace(/^VOH/, "OCH"),
      run_id: row.run_id,
      master_vessel_id: row.master_vessel_id,
      hybrid_entity_key: row.hybrid_entity_key,
      vessel_name: row.vessel_name,
      port_code: row.port_code,
      operator_name: row.operator_name,
      operator_normalized: row.operator_normalized,
      agent_name: row.agent_name,
      agent_normalized: row.agent_normalized,
      contact_path_status: row.contact_path_status || row.payload?.contact_path_status || (row.payload?.contact_path_available ? "contact_available" : row.agent_name ? "agent_known" : row.operator_name ? "operator_known" : "unknown"),
      contact_priority: row.contact_priority || row.payload?.contact_priority || null,
      contact_path_label_ko: row.contact_path_label_ko || row.payload?.contact_path_label_ko || null,
      contact_path_available: Boolean(row.payload?.contact_path_available || row.operator_name || row.agent_name),
      contact_readiness_score: Number(row.contact_readiness_score || 0),
      lead_status: row.payload?.lead_status || "monitor",
      recommended_action: row.payload?.recommended_action || row.payload?.recommended_next_action || null,
      collected_at: now,
      payload: storagePayload(row.payload)
    }));
    const { error } = await supabase.from("operator_contact_history").upsert(batch, { onConflict: "history_id" });
    if (error) throw error;
  }

  const routePatternRows = uniqueBy(records
    .filter(r => r.route_from_port || r.previous_port || r.destination_port || r.next_port)
    .map(r => {
      const fromPort = normalizeCompanyName(r.route_from_port || r.previous_port || "");
      const toPort = normalizeCompanyName(r.route_to_port || r.destination_port || r.destination || r.next_port || r.port_name || r.port || "");
      const vesselTypeGroup = r.vessel_type_group || "unknown";
      if (!fromPort && !toPort) return null;
      return {
        route_pattern_id: stableHashId("ROUTE", `${fromPort}|${toPort}|${vesselTypeGroup}`),
        from_port: fromPort || null,
        to_port: toPort || null,
        vessel_type_group: vesselTypeGroup,
        avg_transit_hours: Number(r.avg_transit_hours || r.historical_avg_transit_hours || 0),
        avg_waiting_hours: Number(r.historical_avg_waiting_hours || r.anchorage_hours || 0),
        avg_stay_hours: Number(r.historical_avg_stay_hours || r.stay_hours || 0),
        congestion_probability: Number(r.predicted_congestion || r.port_congestion_score || 0),
        route_pattern_confidence: Number(r.route_pattern_confidence || r.arrival_prediction_confidence || 0),
        observation_count: 1,
        last_seen: now,
        payload: storagePayload(r)
      };
    })
    .filter(Boolean), row => `${row.from_port}|${row.to_port}|${row.vessel_type_group}`);

  for (let index = 0; index < routePatternRows.length; index += batchSize) {
    const batch = routePatternRows.slice(index, index + batchSize);
    const { error } = await supabase.from("route_patterns").upsert(batch, { onConflict: "route_pattern_id" });
    if (error) throw error;
  }

  const vesselRouteHistoryRows = uniqueBy(records
    .filter(r => r.previous_port || r.destination_port || r.next_port || r.predicted_arrival_time)
    .map(r => ({
      route_history_id: stableEntityId("VRH", `${runId}-${r.hybrid_entity_key || r.vessel_id}-${r.previous_port || ""}-${r.destination_port || r.next_port || ""}`),
      run_id: runId,
      master_vessel_id: fallbackMasterId(r),
      hybrid_entity_key: r.hybrid_entity_key || r.vessel_id,
      vessel_name: r.vessel_name || null,
      previous_port: r.previous_port || null,
      destination_port: r.destination_port || r.destination || r.next_port || null,
      arrival: r.ata || r.eta || r.predicted_arrival_time || null,
      departure: r.atd || r.etd || null,
      vessel_type_group: r.vessel_type_group || null,
      route_region: r.route_region || null,
      arrival_opportunity_score: Number(r.arrival_opportunity_score || 0),
      predicted_arrival_time: r.predicted_arrival_time || null,
      actual_arrival_time: r.actual_arrival_time || r.ata || null,
      prediction_error_hours: r.prediction_error_hours ?? null,
      prediction_confidence: Number(r.arrival_prediction_confidence || r.prediction_confidence || 0),
      route_pattern_id: stableHashId("ROUTE", `${normalizeCompanyName(r.route_from_port || r.previous_port || "")}|${normalizeCompanyName(r.route_to_port || r.destination_port || r.destination || r.next_port || r.port_name || r.port || "")}|${r.vessel_type_group || "unknown"}`),
      arrival_prediction_confidence: Number(r.arrival_prediction_confidence || 0),
      payload: storagePayload(r)
    })), row => row.route_history_id);

  for (let index = 0; index < vesselRouteHistoryRows.length; index += batchSize) {
    const batch = vesselRouteHistoryRows.slice(index, index + batchSize);
    const { error } = await supabase.from("vessel_route_history").upsert(batch, { onConflict: "route_history_id" });
    if (error) throw error;
  }

  const predictedArrivalRows = uniqueBy(records
    .filter(r => r.predicted_arrival_pipeline || Number(r.arrival_opportunity_score || 0) >= 35)
    .map(r => ({
      predicted_arrival_id: stableEntityId("PARR", `${runId}-${r.hybrid_entity_key || r.vessel_id}-${r.predicted_arrival_time || r.eta || ""}`),
      run_id: runId,
      master_vessel_id: fallbackMasterId(r),
      hybrid_entity_key: r.hybrid_entity_key || r.vessel_id,
      vessel_name: r.vessel_name || null,
      previous_port: r.previous_port || null,
      destination_port: r.destination_port || r.destination || r.next_port || null,
      port_code: r.port_code || null,
      port_name: r.port_name || r.port || null,
      predicted_arrival_time: r.predicted_arrival_time || r.eta || null,
      actual_arrival_time: r.actual_arrival_time || r.ata || null,
      prediction_error_hours: r.prediction_error_hours ?? null,
      prediction_confidence: Number(r.arrival_prediction_confidence || r.prediction_confidence || 0),
      route_pattern_id: stableHashId("ROUTE", `${normalizeCompanyName(r.route_from_port || r.previous_port || "")}|${normalizeCompanyName(r.route_to_port || r.destination_port || r.destination || r.next_port || r.port_name || r.port || "")}|${r.vessel_type_group || "unknown"}`),
      arrival_prediction_confidence: Number(r.arrival_prediction_confidence || 0),
      predicted_congestion: Number(r.predicted_congestion || 0),
      predicted_cleaning_window: Number(r.predicted_cleaning_window || 0),
      predicted_congestion_score: Number(r.predicted_congestion_score || r.predicted_congestion || 0),
      congestion_forecast_band: r.congestion_forecast_band || null,
      anchorage_probability: Number(r.anchorage_probability || 0),
      predicted_work_window_hours: Number(r.predicted_work_window_hours || 0),
      work_window_confidence: Number(r.work_window_confidence || 0),
      repeat_caller_score: Number(r.repeat_caller_score || 0),
      repeat_operator_score: Number(r.repeat_operator_score || 0),
      repeat_call_count: Number(r.repeat_call_count || 0),
      repeat_operator_count: Number(r.repeat_operator_count || 0),
      biofouling_exposure_score: Number(r.biofouling_exposure_score || 0),
      biofouling_exposure_band: r.biofouling_exposure_band || null,
      biofouling_exposure_reasons: r.biofouling_exposure_reasons || [],
      predicted_cleaning_opportunity_score: Number(r.predicted_cleaning_opportunity_score || 0),
      cleaning_opportunity_band: r.cleaning_opportunity_band || null,
      opportunity_summary: r.opportunity_summary || null,
      arrival_opportunity_score: Number(r.arrival_opportunity_score || 0),
      status: r.predicted_arrival_pipeline ? "predicted_arrival_pipeline" : "route_watch",
      payload: storagePayload(r)
    })), row => row.predicted_arrival_id);

  for (let index = 0; index < predictedArrivalRows.length; index += batchSize) {
    const batch = predictedArrivalRows.slice(index, index + batchSize);
    const { error } = await supabase.from("predicted_arrivals").upsert(batch, { onConflict: "predicted_arrival_id" });
    if (error) throw error;
  }

  const commercialLeadRows = uniqueBy(records
    .filter(r => Number(r.commercial_value_score || r.total_sales_priority_score || 0) >= 75 || ["contact_ready", "contacted", "quoted", "scheduled", "won", "lost"].includes(String(r.lead_status || "").toLowerCase()))
    .map(r => ({
      lead_id: stableEntityId("LEAD", `${r.hybrid_entity_key || r.vessel_id}-${r.port_call_identity || r.port_code || r.port || ""}`),
      run_id: runId,
      master_vessel_id: fallbackMasterId(r),
      hybrid_entity_key: r.hybrid_entity_key || r.vessel_id,
      port_call_identity: r.port_call_identity || null,
      vessel_name: r.vessel_name || null,
      port_code: r.port_code || null,
      port_name: r.port_name || r.port || null,
      lead_status: r.lead_status || "monitor",
      lead_priority_score: Number(r.lead_priority_score || 0),
      auto_lead_created: Boolean(r.auto_lead_created || Number(r.commercial_value_score || r.total_sales_priority_score || 0) >= 75),
      lead_created_reason: r.lead_created_reason || (Number(r.commercial_value_score || r.total_sales_priority_score || 0) >= 75 ? "commercial_value_score_75_plus" : null),
      commercial_value_score: Number(r.commercial_value_score || r.total_sales_priority_score || 0),
      contact_readiness_score: Number(r.contact_readiness_score || 0),
      contact_path_status: r.contact_path_status || (r.contact_path_available ? "contact_available" : r.agent_name || r.agent ? "agent_known" : r.operator_name || r.operator ? "operator_known" : "unknown"),
      contact_priority: r.contact_priority || null,
      contact_path_label_ko: r.contact_path_label_ko || null,
      work_feasibility_score: Number(r.work_feasibility_score || 0),
      repeat_caller_score: Number(r.repeat_caller_score || 0),
      repeat_operator_score: Number(r.repeat_operator_score || 0),
      repeat_call_count: Number(r.repeat_call_count || 0),
      repeat_operator_count: Number(r.repeat_operator_count || 0),
      fleet_opportunity_score: Number(r.fleet_opportunity_score || 0),
      arrival_opportunity_score: Number(r.arrival_opportunity_score || 0),
      predicted_cleaning_opportunity_score: Number(r.predicted_cleaning_opportunity_score || 0),
      cleaning_opportunity_band: r.cleaning_opportunity_band || null,
      opportunity_summary: r.opportunity_summary || null,
      anchorage_probability: Number(r.anchorage_probability || 0),
      predicted_congestion_score: Number(r.predicted_congestion_score || r.predicted_congestion || 0),
      why_now: buildWhyNowKo(r),
      candidate_summary_ko: buildCandidateSummaryKo(r),
      sales_angle: r.sales_angle || null,
      recommended_next_action: r.recommended_next_action || null,
      recommended_action: buildRecommendedActionKo(r),
      action_priority: r.action_priority || null,
      recommended_contact_path: r.recommended_contact_path || null,
      recommended_department: r.recommended_department || null,
      recommended_email_draft: r.recommended_email_draft || null,
      recommended_followup_date: r.recommended_followup_date || null,
      lead_timeline: r.lead_timeline || [],
      last_contacted_at: r.last_contacted_at || null,
      follow_up_due: r.follow_up_due || null,
      quote_status: r.quote_status || null,
      notes: r.notes || null,
      actual_arrival_time: r.actual_arrival_time || null,
      prediction_error_hours: r.prediction_error_hours ?? null,
      alert_candidate: Boolean(r.alert_candidate),
      information_enrichment_needed: Boolean(r.information_enrichment_needed),
      payload: storagePayload(r),
      updated_at: now
    })), row => row.lead_id);

  for (let index = 0; index < commercialLeadRows.length; index += batchSize) {
    const batch = commercialLeadRows.slice(index, index + batchSize);
    const { error } = await supabase.from("commercial_leads").upsert(batch, { onConflict: "lead_id" });
    if (error) throw error;
  }

  const opportunityRows = uniqueBy(records
    .filter(isOpportunityEligible)
    .map(r => {
      const state = opportunityState(r);
      const portCallId = buildPortCallId(r);
      const type = opportunityType(r);
      const closedAt = ["won", "lost", "closed"].includes(state) ? (r.closed_at || now) : null;
      return {
        opportunity_id: buildOpportunityId(r),
        run_id: runId,
        master_vessel_id: fallbackMasterId(r),
        hybrid_entity_key: r.hybrid_entity_key || r.vessel_id || null,
        port_call_id: portCallId,
        port_call_identity: r.port_call_identity || r.port_call_key || null,
        vessel_name: r.vessel_name || null,
        port_code: r.port_code || null,
        port_name: r.port_name || r.port || null,
        operator_name: r.operator_name || r.operator || null,
        operator_normalized: r.operator_normalized || normalizeCompanyName(r.operator_name || r.operator) || null,
        agent_name: r.agent_name || r.agent || r.satmntEntrpsNm || r.entrpsCdNm || null,
        agent_normalized: r.agent_normalized || normalizeCompanyName(r.agent_name || r.agent || r.satmntEntrpsNm || r.entrpsCdNm) || null,
        opportunity_type: type,
        opportunity_status: state,
        opportunity_state: state,
        lead_status: r.lead_status || (state === "identified" ? "new_lead" : state),
        commercial_value_score: Number(r.commercial_value_score || r.total_sales_priority_score || 0),
        lead_priority_score: Number(r.lead_priority_score || r.commercial_value_score || r.total_sales_priority_score || 0),
        work_feasibility_score: Number(r.work_feasibility_score || 0),
        contact_readiness_score: Number(r.contact_readiness_score || 0),
        predicted_cleaning_opportunity_score: Number(r.predicted_cleaning_opportunity_score || 0),
        why_now: buildWhyNowKo(r),
        recommended_action: buildRecommendedActionKo(r),
        recommended_contact_path: r.recommended_contact_path || r.contact_path_label_ko || null,
        ...opportunityTimestampFields(state, r, now),
        first_detected_at: r.first_detected_at || r.identified_at || now,
        last_seen_at: now,
        last_seen: now,
        closed_at: closedAt,
        close_reason: r.close_reason || (state === "closed" ? "closed_by_status" : state === "won" ? "won" : state === "lost" ? "lost" : null),
        created_at: r.created_at || now,
        updated_at: now,
        payload: storagePayload({
          ...r,
          opportunity_lifecycle_role: "port_call_commercial_opportunity",
          opportunity_type: type,
          opportunity_status: state,
          opportunity_state: state,
          port_call_id: portCallId
        })
      };
    }), row => `${row.port_call_id}|${row.opportunity_type}`);

  for (let index = 0; index < opportunityRows.length; index += batchSize) {
    const batch = opportunityRows.slice(index, index + batchSize);
    const { error } = await supabase.from("opportunity_master").upsert(batch, { onConflict: "opportunity_id" });
    if (error) throw error;
  }

  const enrichmentMatchRows = uniqueBy(records
    .filter(r => {
      const score = Number(r.match_score || r.pilot_match_score || r.berth_match_confidence || r.enrichment_confidence || 0);
      if (leanStorageEnabled()) return score >= 60 || r.pilot_schedule_matched || r.secondary_enrichment_matched;
      return score > 0 || r.pilot_schedule_matched || r.secondary_enrichment_matched;
    })
    .map(r => ({
      match_id: stableEntityId("EMC", `${runId}-${r.hybrid_entity_key || r.vessel_id}-${r.port_call_identity || r.raw_row_identity || ""}-${r.enrichment_source || r.pilot_source_origin || r.source || ""}`),
      run_id: runId,
      master_vessel_id: fallbackMasterId(r),
      hybrid_entity_key: r.hybrid_entity_key || r.vessel_id,
      port_call_identity: r.port_call_identity || null,
      vessel_name: r.vessel_name || null,
      normalized_vessel_name: r.normalized_vessel_name || normalizeVesselName(r.vessel_name),
      call_sign: r.call_sign || null,
      port_code: r.port_code || null,
      source_name: r.enrichment_source || r.pilot_source_origin || r.source || null,
      source_row_id: r.source_row_id || r.raw_row_identity || null,
      snapshot_id: r.snapshot_id || null,
      enrichment_source: r.enrichment_source || r.pilot_source_origin || r.source || null,
      enrichment_source_type: r.pilot_schedule_matched ? "pilot_schedule" : r.secondary_enrichment_matched ? "berth_terminal" : r.source_profile || null,
      match_score: Number(r.match_score || r.pilot_match_score || r.berth_match_confidence || r.enrichment_confidence || 0),
      confidence: r.match_confidence || r.pilot_match_confidence || r.berth_match_confidence || null,
      match_confidence: r.match_confidence || r.pilot_match_confidence || r.berth_match_confidence || null,
      match_reasons: r.match_reasons || r.pilot_match_reasons || r.berth_match_reasons || [],
      matched_fields: r.matched_fields || r.pilot_matched_fields || {},
      raw_source_payload: leanStorageEnabled() ? {} : r.raw_source_payload || {},
      created_at: now,
      matched_at: now,
      reused_historical_match: Boolean(r.vessel_master_cache_match || r.vessel_master_seed_match || r.previous_enrichment_match),
      payload: storagePayload(r)
    })), row => row.match_id);

  for (let index = 0; index < enrichmentMatchRows.length; index += batchSize) {
    const batch = enrichmentMatchRows.slice(index, index + batchSize);
    const { error } = await supabase.from("enrichment_match_candidates").upsert(batch, { onConflict: "match_id" });
    if (error) {
      const legacyBatch = batch.map(row => ({
        match_id: row.match_id,
        run_id: row.run_id,
        master_vessel_id: row.master_vessel_id,
        hybrid_entity_key: row.hybrid_entity_key,
        port_call_identity: row.port_call_identity,
        vessel_name: row.vessel_name,
        normalized_vessel_name: row.normalized_vessel_name,
        call_sign: row.call_sign,
        port_code: row.port_code,
        enrichment_source: row.enrichment_source,
        enrichment_source_type: row.enrichment_source_type,
        match_score: row.match_score,
        match_confidence: row.match_confidence,
        match_reasons: row.match_reasons,
        matched_at: row.matched_at,
        reused_historical_match: row.reused_historical_match,
        payload: storagePayload(row.payload)
      }));
      const retry = await supabase.from("enrichment_match_candidates").upsert(legacyBatch, { onConflict: "match_id" });
      if (retry.error) throw retry.error;
    }
  }

  const aliases = records
    .filter(r => r.vessel_name && (r.hybrid_entity_key || r.vessel_id))
    .map(r => ({
      alias_name: r.vessel_name,
      normalized_alias_name: r.normalized_vessel_name || normalizeVesselName(r.vessel_name),
      master_vessel_id: fallbackMasterId(r),
      source: r.source || "collector",
      confidence: identityConfidence(r),
      last_seen: now
    }));

  for (let index = 0; index < aliases.length; index += batchSize) {
    const batch = aliases.slice(index, index + batchSize);
    const { error } = await supabase.from("vessel_aliases").upsert(batch, { onConflict: "alias_name,master_vessel_id,source" });
    if (error) throw error;
  }

  const identityCandidates = records
    .filter(r => !r.imo)
    .map(r => ({
      run_id: runId,
      hybrid_entity_key: r.hybrid_entity_key || r.vessel_id,
      vessel_id: r.vessel_id,
      raw_vessel_name: r.vessel_name,
      normalized_name: r.normalized_vessel_name || normalizeVesselName(r.vessel_name),
      call_sign: r.call_sign || null,
      mmsi: r.mmsi || null,
      gt: r.gt || null,
      port_code: r.port_code || null,
      likely_master_vessel_id: fallbackMasterId(r),
      confidence: identityConfidence(r),
      resolution_status: (r.commercial_value_score || r.total_sales_priority_score || 0) >= 35 || Number(r.gt || 0) >= 5000 || r.is_anchorage_waiting ? "manual_review_priority" : "unresolved",
      likely_imo_candidates: [],
      confidence_band: r.identity_confidence_band || (identityConfidence(r) >= 80 ? "strong_identifier" : identityConfidence(r) >= 60 ? "context_match" : identityConfidence(r) >= 40 ? "weak_fuzzy" : "unresolved"),
      manual_review_required: (r.commercial_value_score || r.total_sales_priority_score || 0) >= 35 || Number(r.gt || 0) >= 5000 || r.is_anchorage_waiting,
      payload: storagePayload(r)
    }));

  for (let index = 0; index < identityCandidates.length; index += batchSize) {
    const batch = identityCandidates.slice(index, index + batchSize);
    const { error } = await supabase.from("vessel_identity_candidates").insert(batch);
    if (error) throw error;
  }

  const imoRecoveryRows = buildImoRecoveryRows(records, runId, now);
  let imoRecoveryQueueRowsSaved = 0;
  try {
    for (let index = 0; index < imoRecoveryRows.length; index += batchSize) {
      const batch = imoRecoveryRows.slice(index, index + batchSize);
      const { error } = await supabase.from("imo_recovery_queue").upsert(batch, { onConflict: "recovery_id" });
      if (error) throw error;
      imoRecoveryQueueRowsSaved += batch.length;
    }
  } catch (error) {
    console.warn(`[HWK] IMO recovery queue save skipped: ${error.message}`);
  }

  const riskRows = records.filter(r => !leanStorageEnabled() || shouldPersistAnalyticalRow(r)).map(r => ({
    run_id: runId,
    master_vessel_id: fallbackMasterId(r),
    hybrid_entity_key: r.hybrid_entity_key || r.vessel_id,
    vessel_id: r.vessel_id,
    port: r.port || null,
    total_sales_priority_score: r.total_sales_priority_score || r.cleaning_candidate_score || r.risk_score || 0,
    commercial_value_score: r.commercial_value_score || r.total_sales_priority_score || r.cleaning_candidate_score || r.risk_score || 0,
    data_confidence_score: r.data_confidence_score || 0,
    biofouling_risk_score: r.biofouling_risk_score || r.biofouling_score || r.risk_score || 0,
    performance_proxy_score: r.performance_proxy_score || 0,
    congestion_exposure_score: r.congestion_exposure_score || 0,
    cleaning_window_score: r.cleaning_window_score || 0,
    compliance_pressure_score: r.compliance_pressure_score || 0,
    commercial_fit_score: r.commercial_fit_score || 0,
    candidate_band: r.sales_priority_band || "low_priority",
    reason_codes: r.reason_codes || [],
    collected_at: now,
    payload: storagePayload(r)
  })).filter(r => r.hybrid_entity_key);

  for (let index = 0; index < riskRows.length; index += batchSize) {
    const batch = riskRows.slice(index, index + batchSize);
    const { error } = await supabase.from("risk_history").insert(batch);
    if (error) throw error;
  }

  const rawEvents = buildLifecycleEvents(records, previousSnapshotMap, runId, now)
    .filter(r => r.hybrid_entity_key);
  const events = uniqueBy(rawEvents, row => row.event_uid);
  const eventDuplicatesSkipped = Math.max(0, rawEvents.length - events.length);

  for (let index = 0; index < events.length; index += batchSize) {
    const batch = events.slice(index, index + batchSize);
    const { error } = await supabase.from("vessel_events").upsert(batch, { onConflict: "event_uid" });
    if (error) throw error;
  }

  const pilotEvents = records
    .filter(r => r.pilot_schedule_matched || r.pilot_only_arrival_review || r.source_origin === "pilot_schedule" || r.pilot_time)
    .map(r => ({
      run_id: runId,
      port_code: r.port_code || null,
      port_name: r.port_name || r.port || null,
      vessel_name: r.vessel_name || null,
      normalized_vessel_name: r.normalized_vessel_name || normalizeVesselName(r.vessel_name),
      call_sign: r.call_sign || null,
      pilot_time: r.pilot_time || r.movement_time || r.eta_candidate || r.etb_candidate || null,
      pilot_direction: r.pilot_direction || r.movement_type || null,
      pilot_station: r.pilot_station || null,
      berth_name: r.berth_name || r.berth || null,
      movement_type: r.movement_type || r.pilot_direction || null,
      status: r.pilot_only_arrival_review ? "pilot_only_pending_port_operation" : "matched_to_port_operation",
      raw_payload: storagePayload(r),
      matched_snapshot_id: null,
      matched_master_vessel_id: r.pilot_only_arrival_review ? null : fallbackMasterId(r),
      match_confidence: Number(r.pilot_match_confidence || r.schedule_confidence || 0)
    }));

  for (let index = 0; index < pilotEvents.length; index += batchSize) {
    const batch = pilotEvents.slice(index, index + batchSize);
    const { error } = await supabase.from("pilot_schedule_events").insert(batch);
    if (error) throw error;
  }

  const byPort = new Map();
  for (const r of records) {
    const key = r.port_code || r.port || "unknown";
    const current = byPort.get(key) || { port_code: r.port_code || null, port_name: r.port_name || r.port || null, total_vessels: 0, anchorage_vessels: 0, long_idle_vessels: 0, waiting_hours_total: 0, berth_hours_total: 0, score_total: 0 };
    current.total_vessels += 1;
    if (r.is_anchorage_waiting || (r.anchorage_hours || 0) > 0) current.anchorage_vessels += 1;
    if (r.is_long_idle) current.long_idle_vessels += 1;
    current.waiting_hours_total += Number(r.anchorage_hours || 0);
    current.berth_hours_total += Number(r.berth_hours || 0);
    current.score_total += Number(r.port_congestion_score || 0);
    byPort.set(key, current);
  }

  const congestionRows = [...byPort.values()].map(p => ({
    port_code: p.port_code,
    run_id: runId,
    port_name: p.port_name,
    total_vessels: p.total_vessels,
    anchorage_vessels: p.anchorage_vessels,
    long_idle_vessels: p.long_idle_vessels,
    average_waiting_hours: p.anchorage_vessels ? Math.round((p.waiting_hours_total / p.anchorage_vessels) * 10) / 10 : 0,
    berth_occupancy_proxy: p.total_vessels ? Math.min(100, Math.round((p.berth_hours_total / Math.max(1, p.total_vessels * 24)) * 100)) : 0,
    anchorage_density_score: p.total_vessels ? Math.min(100, Math.round((p.anchorage_vessels / p.total_vessels) * 100)) : 0,
    port_congestion_score: p.total_vessels ? Math.min(100, Math.round(p.score_total / p.total_vessels)) : 0,
    collected_at: now,
    payload: p
  }));

  for (let index = 0; index < congestionRows.length; index += batchSize) {
    const batch = congestionRows.slice(index, index + batchSize);
    const { error } = await supabase.from("port_congestion_snapshots").insert(batch);
    if (error) throw error;
  }

  const fleetMap = new Map();
  for (const r of records) {
    const operatorName = r.operator_name || r.operator;
    const operatorNormalized = r.operator_normalized || normalizeCompanyName(operatorName);
    if (!operatorName || !operatorNormalized) continue;
    if (!fleetMap.has(operatorNormalized)) {
      fleetMap.set(operatorNormalized, {
        operator_name: operatorName,
        operator_normalized: operatorNormalized,
        vessels: new Map(),
        ports: new Set(),
        target_vessel_count: 0,
        immediate_target_count: 0,
        operator_call_count: 0,
        contact_score_total: 0,
        contact_score_count: 0,
        top_vessels: []
      });
    }
    const current = fleetMap.get(operatorNormalized);
    const vesselKey = r.master_vessel_id || r.hybrid_entity_key || r.imo || r.mmsi || r.call_sign || `${r.vessel_name || ""}-${r.gt || ""}-${r.vessel_type_group || r.vessel_type || ""}`;
    if (vesselKey) current.vessels.set(vesselKey, r);
    current.ports.add(String(r.port_code || r.port_name || r.port || "unknown"));
    if ((r.commercial_value_score || r.total_sales_priority_score || 0) >= 65 || r.is_cleaning_candidate) current.target_vessel_count += 1;
    if ((r.commercial_value_score || r.total_sales_priority_score || 0) >= 75 || r.is_immediate_candidate) current.immediate_target_count += 1;
    current.operator_call_count += Number(r.repeat_call_count || r.calls_last_12m || 1);
    current.contact_score_total += Number(r.contact_readiness_score || 0);
    current.commercial_total = (current.commercial_total || 0) + Number(r.commercial_value_score || r.total_sales_priority_score || 0);
    current.biofouling_total = (current.biofouling_total || 0) + Number(r.biofouling_exposure_score || r.biofouling_risk_score || r.biofouling_score || 0);
    current.congestion_total = (current.congestion_total || 0) + Number(r.congestion_score || r.port_congestion_score || 0);
    current.route_exposure_total = (current.route_exposure_total || 0) + Number(r.route_bonus || r.biosecurity_exposure_score || 0);
    current.operator_quality_total = (current.operator_quality_total || 0) + Number(r.operator_confidence || r.contact_readiness_score || 0);
    current.contact_score_count += 1;
    current.top_vessels.push(r);
  }

  const fleetOpportunityRows = [...fleetMap.values()]
    .map(row => ({
      fleet_opportunity_id: stableEntityId("FLEET", `${runId}-${row.operator_normalized}`),
      run_id: runId,
      operator_name: row.operator_name,
      operator_normalized: row.operator_normalized,
      current_vessel_count: row.vessels.size,
      target_vessel_count: row.target_vessel_count,
      immediate_target_count: row.immediate_target_count,
      operator_call_count: row.operator_call_count,
      operator_vessel_count: row.vessels.size,
      operator_port_count: row.ports.size,
      average_commercial_value: row.contact_score_count ? Math.round((row.commercial_total || 0) / row.contact_score_count) : 0,
      average_biofouling_exposure: row.contact_score_count ? Math.round((row.biofouling_total || 0) / row.contact_score_count) : 0,
      average_congestion_exposure: row.contact_score_count ? Math.round((row.congestion_total || 0) / row.contact_score_count) : 0,
      route_exposure_score: row.contact_score_count ? Math.round((row.route_exposure_total || 0) / row.contact_score_count) : 0,
      operator_quality_score: row.contact_score_count ? Math.round((row.operator_quality_total || 0) / row.contact_score_count) : 0,
      repeat_operator_score: Math.min(100, Number(row.top_vessels[0]?.repeat_operator_score || 0) || (row.operator_call_count >= 5 ? 30 : row.operator_call_count >= 3 ? 20 : row.operator_call_count >= 2 ? 10 : 0)),
      fleet_opportunity_score: Math.min(100, Math.round(
        Math.min(35, row.target_vessel_count * 9) +
        Math.min(30, row.immediate_target_count * 15) +
        Math.min(20, row.vessels.size * 4) +
        Math.min(10, row.ports.size * 3) +
        Math.min(10, row.contact_score_total / Math.max(1, row.contact_score_count) / 10)
      )),
      fleet_cleaning_probability: Math.min(100, Math.round(
        (row.contact_score_count ? Math.round((row.biofouling_total || 0) / row.contact_score_count) : 0) * 0.28 +
        (row.contact_score_count ? Math.round((row.congestion_total || 0) / row.contact_score_count) : 0) * 0.18 +
        (Math.min(100, Number(row.top_vessels[0]?.repeat_operator_score || 0) || (row.operator_call_count >= 5 ? 30 : row.operator_call_count >= 3 ? 20 : row.operator_call_count >= 2 ? 10 : 0))) * 0.16 +
        (row.contact_score_count ? Math.round((row.route_exposure_total || 0) / row.contact_score_count) : 0) * 0.12 +
        Math.min(14, row.target_vessel_count * 4) +
        Math.min(10, row.immediate_target_count * 5) +
        Math.min(8, row.vessels.size * 2) +
        Math.min(6, row.ports.size * 2)
      )),
      fleet_cleaning_probability_band: Math.min(100, Math.round(
        (row.contact_score_count ? Math.round((row.biofouling_total || 0) / row.contact_score_count) : 0) * 0.28 +
        (row.contact_score_count ? Math.round((row.congestion_total || 0) / row.contact_score_count) : 0) * 0.18 +
        (Math.min(100, Number(row.top_vessels[0]?.repeat_operator_score || 0) || (row.operator_call_count >= 5 ? 30 : row.operator_call_count >= 3 ? 20 : row.operator_call_count >= 2 ? 10 : 0))) * 0.16 +
        (row.contact_score_count ? Math.round((row.route_exposure_total || 0) / row.contact_score_count) : 0) * 0.12 +
        Math.min(14, row.target_vessel_count * 4) +
        Math.min(10, row.immediate_target_count * 5) +
        Math.min(8, row.vessels.size * 2) +
        Math.min(6, row.ports.size * 2)
      )) >= 80 ? "VERY_HIGH" : Math.min(100, Math.round(
        (row.contact_score_count ? Math.round((row.biofouling_total || 0) / row.contact_score_count) : 0) * 0.28 +
        (row.contact_score_count ? Math.round((row.congestion_total || 0) / row.contact_score_count) : 0) * 0.18 +
        (Math.min(100, Number(row.top_vessels[0]?.repeat_operator_score || 0) || (row.operator_call_count >= 5 ? 30 : row.operator_call_count >= 3 ? 20 : row.operator_call_count >= 2 ? 10 : 0))) * 0.16 +
        (row.contact_score_count ? Math.round((row.route_exposure_total || 0) / row.contact_score_count) : 0) * 0.12 +
        Math.min(14, row.target_vessel_count * 4) +
        Math.min(10, row.immediate_target_count * 5) +
        Math.min(8, row.vessels.size * 2) +
        Math.min(6, row.ports.size * 2)
      )) >= 65 ? "HIGH" : Math.min(100, Math.round(
        (row.contact_score_count ? Math.round((row.biofouling_total || 0) / row.contact_score_count) : 0) * 0.28 +
        (row.contact_score_count ? Math.round((row.congestion_total || 0) / row.contact_score_count) : 0) * 0.18 +
        (Math.min(100, Number(row.top_vessels[0]?.repeat_operator_score || 0) || (row.operator_call_count >= 5 ? 30 : row.operator_call_count >= 3 ? 20 : row.operator_call_count >= 2 ? 10 : 0))) * 0.16 +
        (row.contact_score_count ? Math.round((row.route_exposure_total || 0) / row.contact_score_count) : 0) * 0.12 +
        Math.min(14, row.target_vessel_count * 4) +
        Math.min(10, row.immediate_target_count * 5) +
        Math.min(8, row.vessels.size * 2) +
        Math.min(6, row.ports.size * 2)
      )) >= 45 ? "MEDIUM" : "LOW",
      forecast_window_days: 30,
      contact_readiness_avg: row.contact_score_count ? Math.round(row.contact_score_total / row.contact_score_count) : 0,
      fleet_alert: row.immediate_target_count >= 2 || row.target_vessel_count >= 4 ? "HIGH_FLEET_OPPORTUNITY" : null,
      fleet_alerts: row.immediate_target_count >= 2 || row.target_vessel_count >= 4 ? ["HIGH_FLEET_OPPORTUNITY"] : [],
      top_vessels: row.top_vessels
        .slice()
        .sort((a, b) => Number(b.commercial_value_score || b.total_sales_priority_score || 0) - Number(a.commercial_value_score || a.total_sales_priority_score || 0))
        .slice(0, 5)
        .map(v => ({
          vessel_name: v.vessel_name,
          port_name: v.port_name || v.port,
          commercial_value_score: Number(v.commercial_value_score || v.total_sales_priority_score || 0),
          candidate_band: v.candidate_band || v.sales_priority_band || "general"
        })),
      payload: {
        recommended_action: row.contact_score_total > 0 ? "운영선사 선대 담당팀 접촉" : "운영선사/대리점 연락 경로 확인"
      },
      created_at: now
    }))
    .filter(row => row.current_vessel_count >= 2 || row.target_vessel_count > 0 || row.fleet_opportunity_score >= 20);

  for (let index = 0; index < fleetOpportunityRows.length; index += batchSize) {
    const batch = fleetOpportunityRows.slice(index, index + batchSize);
    const { error } = await supabase.from("operator_fleet_opportunities").upsert(batch, { onConflict: "fleet_opportunity_id" });
    if (error) throw error;
  }

  const featureStoreRows = uniqueBy(records.filter(r => !leanStorageEnabled() || shouldPersistFeatureRow(r)).map(r => {
    const entityKey = r.hybrid_entity_key || r.vessel_id || `${r.vessel_name || "UNKNOWN"}-${r.port_code || ""}`;
    const portCallKey = r.port_call_identity || r.port_call_key || r.raw_row_identity || r.port_code || r.port || "unknown";
    const portCallId = buildPortCallId(r);
    return {
      feature_id: stableEntityId("FEAT", `${runId}-${portCallId}-${entityKey}`),
      run_id: runId,
      collected_at: now,
      entity_type: "vessel_port_call",
      entity_id: portCallId,
      hybrid_entity_key: r.hybrid_entity_key || r.vessel_id || null,
      port_call_id: portCallId,
      port_call_identity: r.port_call_identity || r.port_call_key || null,
      master_vessel_id: fallbackMasterId(r),
      port_code: r.port_code || null,
      feature_namespace: "model_ready_port_call",
      feature_version: "model_ready_port_call_v1",
      features: buildFoundationFeatureVector(r),
      labels: buildFoundationLabels(r),
      payload: {
        vessel_name: r.vessel_name || null,
        port_name: r.port_name || r.port || null,
        port_call_key: portCallKey,
        model_ready_fields: ["gt", "vessel_type", "stay_hours", "anchorage_hours", "commercial_value_score", "congestion_score", "biofouling_exposure_score", "operator_score", "repeat_caller_score"],
        reason_codes: r.reason_codes || [],
        why_now: buildWhyNowKo(r),
        recommended_action: buildRecommendedActionKo(r)
      }
    };
  }), row => row.feature_id);

  for (let index = 0; index < featureStoreRows.length; index += batchSize) {
    const batch = featureStoreRows.slice(index, index + batchSize);
    const { error } = await supabase.from("feature_store").upsert(batch, { onConflict: "feature_id" });
    if (error) throw error;
  }

  const featureSnapshotRows = uniqueBy(records.filter(r => !leanStorageEnabled() || shouldPersistFeatureRow(r)).map(r => {
    const portCallId = buildPortCallId(r);
    return {
      feature_snapshot_id: stableEntityId("FSNAP", `${runId}-${portCallId}`),
      run_id: runId,
      snapshot_time: now,
      port_call_id: portCallId,
      master_vessel_id: fallbackMasterId(r),
      port_code: r.port_code || null,
      vessel_type_group: r.vessel_type_group || null,
      gt: scoreNumber(r.gt || r.grtg || r.intrlGrtg),
      operator_name: r.operator_name || r.operator || null,
      agent_name: r.agent_name || r.agent || r.satmntEntrpsNm || r.entrpsCdNm || null,
      stay_hours: scoreNumber(r.stay_hours || r.current_call_stay_hours || r.cumulative_stay_hours),
      anchorage_hours: scoreNumber(r.anchorage_hours),
      work_window_hours: scoreNumber(r.work_window_hours || r.predicted_work_window_hours),
      congestion_score: scoreNumber(r.congestion_score || r.port_congestion_score || r.congestion_exposure_score),
      work_feasibility_score: scoreNumber(r.work_feasibility_score || r.cleaning_window_score),
      biofouling_exposure_score: scoreNumber(r.biofouling_exposure_score || r.biofouling_risk_score || r.biofouling_score),
      commercial_value_score: commercialScore(r),
      data_confidence_score: scoreNumber(r.data_confidence_score || r.data_quality_score),
      contact_readiness_score: scoreNumber(r.contact_readiness_score),
      repeat_caller_score: scoreNumber(r.repeat_caller_score),
      route_bonus_score: scoreNumber(r.route_bonus_score || r.route_bonus || r.compliance_pressure_score),
      arrival_opportunity_score: scoreNumber(r.arrival_opportunity_score),
      predicted_cleaning_opportunity_score: scoreNumber(r.predicted_cleaning_opportunity_score),
      candidate_band: candidateLabel(r),
      feature_version: "port_call_feature_snapshot_v1",
      created_at: now
    };
  }), row => row.feature_snapshot_id);

  for (let index = 0; index < featureSnapshotRows.length; index += batchSize) {
    const batch = featureSnapshotRows.slice(index, index + batchSize);
    const { error } = await supabase.from("feature_snapshots").upsert(batch, { onConflict: "feature_snapshot_id" });
    if (error) throw error;
  }

  const ruleEvaluationRows = uniqueBy(records.filter(r => !leanStorageEnabled() || shouldPersistFeatureRow(r)).flatMap(r => {
    const entityKey = r.hybrid_entity_key || r.vessel_id || `${r.vessel_name || "UNKNOWN"}-${r.port_code || ""}`;
    return evaluateFoundationRules(r).filter(rule => !leanStorageEnabled() || rule.passed).map(rule => ({
      evaluation_id: stableEntityId("RULE", `${runId}-${entityKey}-${rule.rule_id}`),
      run_id: runId,
      collected_at: now,
      rule_id: rule.rule_id,
      rule_version: rule.rule_version || COMMERCIAL_RULE_VERSION,
      rule_group: rule.rule_group,
      entity_type: "vessel_port_call",
      entity_id: entityKey,
      hybrid_entity_key: r.hybrid_entity_key || r.vessel_id || null,
      port_call_identity: r.port_call_identity || r.port_call_key || null,
      master_vessel_id: fallbackMasterId(r),
      port_code: r.port_code || null,
      passed: Boolean(rule.passed),
      severity: rule.severity,
      score_impact: Number(rule.score_impact || 0),
      explanation_ko: rule.explanation_ko,
      features: buildFoundationFeatureVector(r),
      payload: storagePayload(r)
    }));
  }), row => row.evaluation_id);

  for (let index = 0; index < ruleEvaluationRows.length; index += batchSize) {
    const batch = ruleEvaluationRows.slice(index, index + batchSize);
    const { error } = await supabase.from("rule_evaluations").upsert(batch, { onConflict: "evaluation_id" });
    if (error) throw error;
  }

  const explainabilityRows = uniqueBy(records.filter(r => !leanStorageEnabled() || shouldPersistFeatureRow(r)).map(r => {
    const entityKey = r.hybrid_entity_key || r.vessel_id || `${r.vessel_name || "UNKNOWN"}-${r.port_code || ""}`;
    const rules = evaluateFoundationRules(r).filter(rule => rule.passed);
    return {
      explainability_id: stableEntityId("EXPL", `${runId}-${entityKey}-${r.port_call_identity || r.port_code || ""}`),
      run_id: runId,
      collected_at: now,
      entity_type: "vessel_port_call",
      entity_id: entityKey,
      hybrid_entity_key: r.hybrid_entity_key || r.vessel_id || null,
      port_call_identity: r.port_call_identity || r.port_call_key || null,
      master_vessel_id: fallbackMasterId(r),
      port_code: r.port_code || null,
      commercial_value_score: commercialScore(r),
      candidate_band: candidateLabel(r),
      why_now: buildWhyNowKo(r),
      why_scored_high: r.why_scored_high || buildWhyScoredHigh(r),
      recommended_action: buildRecommendedActionKo(r),
      score_components: buildScoreComponents(r),
      score_reasons: buildScoreReasons(r),
      reason_codes: r.reason_codes || [],
      rule_hits: rules.map(rule => rule.rule_id),
      rule_versions: [...new Set(rules.map(rule => rule.rule_version || COMMERCIAL_RULE_VERSION))],
      feature_contributions: buildFoundationFeatureVector(r),
      payload: storagePayload({
        ...r,
        candidate_summary_ko: buildCandidateSummaryKo(r),
        why_now: buildWhyNowKo(r),
        recommended_action: buildRecommendedActionKo(r)
      })
    };
  }), row => row.explainability_id);

  for (let index = 0; index < explainabilityRows.length; index += batchSize) {
    const batch = explainabilityRows.slice(index, index + batchSize);
    const { error } = await supabase.from("explainability_snapshots").upsert(batch, { onConflict: "explainability_id" });
    if (error) throw error;
  }

  const routeGraphMap = new Map();
  for (const r of records) {
    const fromPort = normalizeCompanyName(r.previous_port || r.route_from_port || "");
    const toPort = normalizeCompanyName(r.destination_port || r.next_port || r.route_to_port || r.port_name || r.port || "");
    if (!fromPort || !toPort) continue;
    const vesselTypeGroup = r.vessel_type_group || "unknown";
    const edgeKey = `${fromPort}|${toPort}|${vesselTypeGroup}`;
    const edge = routeGraphMap.get(edgeKey) || {
      from_port: fromPort,
      to_port: toPort,
      vessel_type_group: vesselTypeGroup,
      observation_count: 0,
      commercial_value_total: 0,
      waiting_total: 0,
      stay_total: 0,
      confidence_total: 0
    };
    edge.observation_count += 1;
    edge.commercial_value_total += commercialScore(r);
    edge.waiting_total += scoreNumber(r.anchorage_hours);
    edge.stay_total += scoreNumber(r.stay_hours);
    edge.confidence_total += scoreNumber(r.arrival_prediction_confidence || r.data_confidence_score);
    routeGraphMap.set(edgeKey, edge);
  }

  const routeGraphRows = [...routeGraphMap.values()].map(edge => ({
    edge_id: stableEntityId("RG", `${edge.from_port}-${edge.to_port}-${edge.vessel_type_group}`),
    run_id: runId,
    from_port: edge.from_port,
    to_port: edge.to_port,
    vessel_type_group: edge.vessel_type_group,
    observation_count: edge.observation_count,
    avg_commercial_value_score: Math.round(edge.commercial_value_total / Math.max(1, edge.observation_count)),
    avg_waiting_hours: Math.round((edge.waiting_total / Math.max(1, edge.observation_count)) * 10) / 10,
    avg_stay_hours: Math.round((edge.stay_total / Math.max(1, edge.observation_count)) * 10) / 10,
    route_confidence: Math.round(edge.confidence_total / Math.max(1, edge.observation_count)),
    last_seen: now,
    payload: edge
  }));

  for (let index = 0; index < routeGraphRows.length; index += batchSize) {
    const batch = routeGraphRows.slice(index, index + batchSize);
    const { error } = await supabase.from("route_graph_edges").upsert(batch, { onConflict: "edge_id" });
    if (error) throw error;
  }

  const operatorGraphMap = new Map();
  for (const r of records) {
    const operatorNormalized = r.operator_normalized || normalizeCompanyName(r.operator_name || r.operator);
    if (!operatorNormalized) continue;
    const operatorName = r.operator_name || r.operator || operatorNormalized;
    const graphEdges = [
      r.agent_name || r.agent ? { type: "operator_agent", target: normalizeCompanyName(r.agent_name || r.agent), targetName: r.agent_name || r.agent } : null,
      r.port_code || r.port_name || r.port ? { type: "operator_port", target: String(r.port_code || r.port_name || r.port), targetName: r.port_name || r.port || r.port_code } : null,
      r.hybrid_entity_key || r.vessel_id ? { type: "operator_vessel", target: String(r.hybrid_entity_key || r.vessel_id), targetName: r.vessel_name || r.hybrid_entity_key || r.vessel_id } : null
    ].filter(Boolean);
    for (const graphEdge of graphEdges) {
      const edgeKey = `${operatorNormalized}|${graphEdge.type}|${graphEdge.target}`;
      const edge = operatorGraphMap.get(edgeKey) || {
        operator_name: operatorName,
        operator_normalized: operatorNormalized,
        edge_type: graphEdge.type,
        target_id: graphEdge.target,
        target_name: graphEdge.targetName,
        observation_count: 0,
        commercial_value_total: 0,
        contact_total: 0
      };
      edge.observation_count += 1;
      edge.commercial_value_total += commercialScore(r);
      edge.contact_total += scoreNumber(r.contact_readiness_score);
      operatorGraphMap.set(edgeKey, edge);
    }
  }

  const operatorGraphRows = [...operatorGraphMap.values()].map(edge => ({
    edge_id: stableEntityId("OG", `${edge.operator_normalized}-${edge.edge_type}-${edge.target_id}`),
    run_id: runId,
    operator_name: edge.operator_name,
    operator_normalized: edge.operator_normalized,
    edge_type: edge.edge_type,
    target_id: edge.target_id,
    target_name: edge.target_name,
    observation_count: edge.observation_count,
    avg_commercial_value_score: Math.round(edge.commercial_value_total / Math.max(1, edge.observation_count)),
    avg_contact_readiness_score: Math.round(edge.contact_total / Math.max(1, edge.observation_count)),
    last_seen: now,
    payload: edge
  }));

  for (let index = 0; index < operatorGraphRows.length; index += batchSize) {
    const batch = operatorGraphRows.slice(index, index + batchSize);
    const { error } = await supabase.from("operator_graph_edges").upsert(batch, { onConflict: "edge_id" });
    if (error) throw error;
  }

  const trainingRows = uniqueBy(records.filter(r => !leanStorageEnabled() || shouldPersistTrainingRow(r)).map(r => {
    const entityKey = r.hybrid_entity_key || r.vessel_id || `${r.vessel_name || "UNKNOWN"}-${r.port_code || ""}`;
    return {
      training_row_id: stableEntityId("TRAIN", `${runId}-${entityKey}-${r.port_call_identity || r.port_code || ""}`),
      run_id: runId,
      collected_at: now,
      entity_type: "vessel_port_call",
      entity_id: entityKey,
      hybrid_entity_key: r.hybrid_entity_key || r.vessel_id || null,
      port_call_identity: r.port_call_identity || r.port_call_key || null,
      master_vessel_id: fallbackMasterId(r),
      port_code: r.port_code || null,
      model_family: "commercial_prediction_foundation",
      dataset_version: "foundation_v1",
      features: buildFoundationFeatureVector(r),
      labels: buildFoundationLabels(r),
      target_values: {
        commercial_value_score: commercialScore(r),
        predicted_cleaning_opportunity_score: scoreNumber(r.predicted_cleaning_opportunity_score),
        contact_readiness_score: scoreNumber(r.contact_readiness_score),
        work_feasibility_score: scoreNumber(r.work_feasibility_score)
      },
      leakage_guard: {
        uses_actual_outcome: false,
        outcome_fields_reserved: ["actual_arrival_time", "prediction_error_hours", "lead_status"]
      },
      payload: storagePayload(r)
    };
  }), row => row.training_row_id);

  for (let index = 0; index < trainingRows.length; index += batchSize) {
    const batch = trainingRows.slice(index, index + batchSize);
    const { error } = await supabase.from("model_training_rows").upsert(batch, { onConflict: "training_row_id" });
    if (error) throw error;
  }

  const historicalWarehouse = promotion.promotable
    ? buildHistoricalWarehouseRows(records, runId, now)
    : { vesselRows: [], portRows: [], operatorRows: [], routeRows: [], opportunityRows: [] };
  const historicalSnapshotResult = {
    historical_snapshot_generation_status: promotion.promotable ? "generated" : "skipped_not_promoted",
    vessel_snapshot_daily_rows_written: 0,
    port_snapshot_daily_rows_written: 0,
    operator_snapshot_daily_rows_written: 0,
    route_snapshot_daily_rows_written: 0,
    commercial_opportunity_daily_rows_written: 0,
    daily_snapshot_rows_written: 0,
    duplicate_snapshot_rows_skipped: 0,
    raw_payloads_archived_to_gdrive: String(process.env.ARCHIVE_TO_DRIVE || "true").toLowerCase() !== "false" ? records.length : 0,
    raw_payloads_db_insert_blocked: records.length,
    ais_raw_rows_skipped: records.filter(record => /ais|vts/i.test(String(record.source || record.source_name || record.source_profile || ""))).length,
    event_rows_written: events.length,
    event_duplicates_skipped: eventDuplicatesSkipped,
    estimated_db_growth_per_day: historicalWarehouse.vesselRows.length + historicalWarehouse.portRows.length + historicalWarehouse.operatorRows.length + historicalWarehouse.routeRows.length + historicalWarehouse.opportunityRows.length,
    estimated_db_growth_per_year: (historicalWarehouse.vesselRows.length + historicalWarehouse.portRows.length + historicalWarehouse.operatorRows.length + historicalWarehouse.routeRows.length + historicalWarehouse.opportunityRows.length) * 365,
    historical_snapshot_error_summary: {}
  };

  try {
    for (let index = 0; index < historicalWarehouse.vesselRows.length; index += batchSize) {
      const batch = historicalWarehouse.vesselRows.slice(index, index + batchSize);
      const { error } = await supabase.from("vessel_snapshot_daily").upsert(batch, { onConflict: "snapshot_date,port_call_id" });
      if (error) throw error;
      historicalSnapshotResult.vessel_snapshot_daily_rows_written += batch.length;
    }
    for (let index = 0; index < historicalWarehouse.portRows.length; index += batchSize) {
      const batch = historicalWarehouse.portRows.slice(index, index + batchSize);
      const { error } = await supabase.from("port_snapshot_daily").upsert(batch, { onConflict: "snapshot_date,port_code,sub_port" });
      if (error) throw error;
      historicalSnapshotResult.port_snapshot_daily_rows_written += batch.length;
    }
    for (let index = 0; index < historicalWarehouse.operatorRows.length; index += batchSize) {
      const batch = historicalWarehouse.operatorRows.slice(index, index + batchSize);
      const { error } = await supabase.from("operator_snapshot_daily").upsert(batch, { onConflict: "snapshot_date,operator_normalized" });
      if (error) throw error;
      historicalSnapshotResult.operator_snapshot_daily_rows_written += batch.length;
    }
    for (let index = 0; index < historicalWarehouse.routeRows.length; index += batchSize) {
      const batch = historicalWarehouse.routeRows.slice(index, index + batchSize);
      const { error } = await supabase.from("route_snapshot_daily").upsert(batch, { onConflict: "snapshot_date,previous_port,destination_port,vessel_type_group" });
      if (error) throw error;
      historicalSnapshotResult.route_snapshot_daily_rows_written += batch.length;
    }
    for (let index = 0; index < historicalWarehouse.opportunityRows.length; index += batchSize) {
      const batch = historicalWarehouse.opportunityRows.slice(index, index + batchSize);
      const { error } = await supabase.from("commercial_opportunity_daily").upsert(batch, { onConflict: "snapshot_date,opportunity_id" });
      if (error) throw error;
      historicalSnapshotResult.commercial_opportunity_daily_rows_written += batch.length;
    }
  } catch (error) {
    historicalSnapshotResult.historical_snapshot_generation_status = "failed";
    historicalSnapshotResult.historical_snapshot_error_summary = { error: error.message };
    console.warn(`[HWK] Historical warehouse snapshot skipped: ${error.message}`);
  }
  historicalSnapshotResult.daily_snapshot_rows_written =
    historicalSnapshotResult.vessel_snapshot_daily_rows_written +
    historicalSnapshotResult.port_snapshot_daily_rows_written +
    historicalSnapshotResult.operator_snapshot_daily_rows_written +
    historicalSnapshotResult.route_snapshot_daily_rows_written +
    historicalSnapshotResult.commercial_opportunity_daily_rows_written;

  const intelligencePopulationDiagnostics = {
    port_call_master_count: portCallMasterRows.length,
    opportunity_created_count: opportunityRows.length,
    feature_snapshots_written: featureSnapshotRows.length,
    event_rows_written: events.length,
    explainability_generated_count: explainabilityRows.length,
    high_score_without_explanation_count: records.filter(r =>
      commercialScore(r) >= 75 &&
      !r.why_now &&
      !r.why_scored_high &&
      !r.candidate_summary_ko &&
      !(Array.isArray(r.reason_codes) && r.reason_codes.length) &&
      !(Array.isArray(r.score_reasons) && r.score_reasons.length)
    ).length,
    historical_snapshot_generation_status: historicalSnapshotResult.historical_snapshot_generation_status
  };

  if (portCallMasterRows.length <= 0) {
    blockPromotion(promotion, "port_call_master_count_positive", "Port Call Master rows were not generated.");
  }
  if (historicalSnapshotResult.historical_snapshot_generation_status === "failed") {
    blockPromotion(promotion, "no_fatal_db_write_error", "Historical warehouse write failed before promotion.");
  }

  const dashboardSummarySnapshotResult = {
    summary_snapshot_write_status: promotion.last_successful_dataset_lock?.locked ? "skipped_last_successful_dataset_lock" : "skipped_not_promoted",
    summary_snapshot_rows: 0,
    latest_successful_summary_run_id: null,
    summary_snapshot_error: null,
    last_successful_dataset_lock: promotion.last_successful_dataset_lock || null
  };
  const currentMaterializedResult = {
    materialized_current_write_status: promotion.last_successful_dataset_lock?.locked ? "skipped_last_successful_dataset_lock" : "skipped_not_promoted",
    sales_candidates_current_rows: 0,
    immediate_targets_current_rows: 0,
    port_summary_current_rows: 0,
    materialized_current_error: null,
    last_successful_dataset_lock: promotion.last_successful_dataset_lock || null
  };

  if (promotion.promotable) {
    try {
      const summarySnapshot = buildDashboardSummarySnapshot(records, runId, now, diagnostics);
      const previousSummary = await supabase
        .from("dashboard_summary_snapshots")
        .select("run_id,all_vessels_count,record_count,generated_at")
        .eq("status", "success")
        .order("generated_at", { ascending: false })
        .limit(10);
      if (previousSummary.error) throw previousSummary.error;
      const previousReference = (previousSummary.data || [])
        .slice()
        .sort((left, right) => Number(right.all_vessels_count || right.record_count || 0) - Number(left.all_vessels_count || left.record_count || 0))[0];
      const previousCount = Number(previousReference?.all_vessels_count || previousReference?.record_count || 0);
      const currentCount = Number(summarySnapshot.all_vessels_count || summarySnapshot.record_count || 0);
      if (previousCount >= 100 && currentCount > 0 && currentCount < previousCount * 0.5) {
        dashboardSummarySnapshotResult.summary_snapshot_write_status = "blocked_count_drop_guard";
        dashboardSummarySnapshotResult.summary_snapshot_error = `Current summary count ${currentCount} is below 50% of previous successful count ${previousCount}.`;
        dashboardSummarySnapshotResult.guarded_reference_run_id = previousReference?.run_id || null;
        dashboardSummarySnapshotResult.guarded_reference_count = previousCount;
        dashboardSummarySnapshotResult.guarded_current_count = currentCount;
        blockPromotion(promotion, "summary_count_drop_guard", dashboardSummarySnapshotResult.summary_snapshot_error);
        throw new Error(dashboardSummarySnapshotResult.summary_snapshot_error);
      }
      const { error } = await supabase
        .from("dashboard_summary_snapshots")
        .upsert(summarySnapshot, { onConflict: "snapshot_id" });
      if (error) throw error;
      const verifySummary = await supabase
        .from("dashboard_summary_snapshots")
        .select("snapshot_id,run_id,record_count,all_vessels_count,is_latest_successful")
        .eq("snapshot_id", summarySnapshot.snapshot_id)
        .limit(1);
      if (verifySummary.error) throw verifySummary.error;
      const writtenSummary = verifySummary.data?.[0] || null;
      if (!writtenSummary || Number(writtenSummary.record_count || writtenSummary.all_vessels_count || 0) <= 0) {
        throw new Error("Dashboard summary snapshot verification failed after write.");
      }
      const clearPrevious = await supabase
        .from("dashboard_summary_snapshots")
        .update({ is_latest_successful: false })
        .eq("is_latest_successful", true)
        .neq("snapshot_id", summarySnapshot.snapshot_id);
      if (clearPrevious.error) throw clearPrevious.error;
      const markCurrent = await supabase
        .from("dashboard_summary_snapshots")
        .update({ is_latest_successful: true })
        .eq("snapshot_id", summarySnapshot.snapshot_id);
      if (markCurrent.error) throw markCurrent.error;
      dashboardSummarySnapshotResult.summary_snapshot_write_status = "written";
      dashboardSummarySnapshotResult.summary_snapshot_rows = 1;
      dashboardSummarySnapshotResult.latest_successful_summary_run_id = runId;
      const currentRows = buildCurrentMaterializedRows(records, runId, now, summarySnapshot);
      await supabase.from("sales_candidates_current").update({ is_current: false }).eq("is_current", true);
      await supabase.from("immediate_targets_current").update({ is_current: false }).eq("is_current", true);
      await supabase.from("port_summary_current").update({ is_current: false }).eq("is_current", true);
      for (let index = 0; index < currentRows.salesCandidates.length; index += batchSize) {
        const batch = currentRows.salesCandidates.slice(index, index + batchSize);
        const { error } = await supabase.from("sales_candidates_current").upsert(batch, { onConflict: "current_id" });
        if (error) throw error;
        currentMaterializedResult.sales_candidates_current_rows += batch.length;
      }
      for (let index = 0; index < currentRows.immediateTargets.length; index += batchSize) {
        const batch = currentRows.immediateTargets.slice(index, index + batchSize);
        const { error } = await supabase.from("immediate_targets_current").upsert(batch, { onConflict: "current_id" });
        if (error) throw error;
        currentMaterializedResult.immediate_targets_current_rows += batch.length;
      }
      for (let index = 0; index < currentRows.portSummaries.length; index += batchSize) {
        const batch = currentRows.portSummaries.slice(index, index + batchSize);
        const { error } = await supabase.from("port_summary_current").upsert(batch, { onConflict: "port_unit_key" });
        if (error) throw error;
        currentMaterializedResult.port_summary_current_rows += batch.length;
      }
      currentMaterializedResult.materialized_current_write_status = "written";
    } catch (error) {
      if (dashboardSummarySnapshotResult.summary_snapshot_write_status !== "blocked_count_drop_guard") {
        dashboardSummarySnapshotResult.summary_snapshot_write_status = "failed";
        dashboardSummarySnapshotResult.summary_snapshot_error = error.message;
      }
      currentMaterializedResult.materialized_current_write_status = "failed";
      currentMaterializedResult.materialized_current_error = error.message;
      blockPromotion(promotion, "no_fatal_db_write_error", "Dashboard summary snapshot write failed before promotion.");
    }
  }

  let promoted = false;
  if (promotion.promotable) {
    if (recordsSaved <= 0) {
      blockPromotion(promotion, "rows_written_to_vessel_snapshots_positive", "No rows were written to vessel_snapshots.");
    }
    if (portCallMasterRows.length <= 0) {
      blockPromotion(promotion, "rows_written_to_port_call_master_positive", "No rows were written to port_call_master.");
    }
    if (dashboardSummarySnapshotResult.summary_snapshot_rows <= 0) {
      blockPromotion(promotion, "dashboard_summary_snapshot_written", "Dashboard summary snapshot was not written.");
    }
  }
  if (promotion.promotable) {
    const { error } = await supabase.from("active_dataset_pointer").upsert({
      id: "current",
      active_run_id: runId,
      active_collected_at: now,
      promoted_at: now,
      data_age_minutes: 0,
      is_stale: false
    }, { onConflict: "id" });
    if (error) throw error;
    const promotedRunUpdate = await supabase.from("data_collection_runs").update({ status: "promoted", promoted_at: now }).eq("run_id", runId);
    if (promotedRunUpdate.error) throw promotedRunUpdate.error;
    promoted = true;
  }

  const retentionCleanup = await runLeanRetentionCleanup(supabase);
  const dbRowsWrittenByTable = {
    vessel_snapshots: recordsSaved,
    source_collection_logs: sourceCollectionLogRows.length,
    vessel_entities: entities.length,
    vessel_master: masterRows.length,
    port_call_master: portCallMasterRows.length,
    opportunity_master: opportunityRows.length,
    risk_history: riskRows.length,
    vessel_events: events.length,
    pilot_schedule_events: pilotEvents.length,
    port_congestion_snapshots: congestionRows.length,
    enrichment_match_candidates: enrichmentMatchRows.length,
    commercial_leads: commercialLeadRows.length,
    dashboard_summary_snapshots: dashboardSummarySnapshotResult.summary_snapshot_rows,
    sales_candidates_current: currentMaterializedResult.sales_candidates_current_rows,
    immediate_targets_current: currentMaterializedResult.immediate_targets_current_rows,
    port_summary_current: currentMaterializedResult.port_summary_current_rows,
    feature_store: featureStoreRows.length,
    feature_snapshots: featureSnapshotRows.length,
    rule_evaluations: ruleEvaluationRows.length,
    explainability_snapshots: explainabilityRows.length,
    model_training_rows: trainingRows.length,
    vessel_snapshot_daily: historicalSnapshotResult.vessel_snapshot_daily_rows_written,
    port_snapshot_daily: historicalSnapshotResult.port_snapshot_daily_rows_written,
    operator_snapshot_daily: historicalSnapshotResult.operator_snapshot_daily_rows_written,
    route_snapshot_daily: historicalSnapshotResult.route_snapshot_daily_rows_written,
    commercial_opportunity_daily: historicalSnapshotResult.commercial_opportunity_daily_rows_written,
    vessel_universe_audit: vesselUniverseAuditResult.rows_written
  };
  const retentionRowsDeletedByTable = Object.fromEntries(Object.entries(retentionCleanup || {}).map(([table, value]) => [table, Number(value?.rows_deleted || 0)]));
  const postWriteVerification = await verifySupabaseWriteFinalization(supabase, {
    runId,
    promoted,
    promotion,
    recordsSaved,
    portCallMasterRowsWritten: portCallMasterRows.length,
    dashboardSummarySnapshotResult,
    dbRowsWrittenByTable
  });
  const storageFinalized = postWriteVerification.status === "completed";

  const finalRunUpdate = await updateRunWithSchemaCompatibility(supabase, "data_collection_runs", {
    status: storageFinalized ? promoted ? "promoted" : "completed" : "storage_finalization_failed",
    validation_status: storageFinalized ? promoted ? "passed" : "promotion_blocked" : "failed",
    source_summary: {
      ...diagnostics,
      imo_recovery: imoRecoveryDiagnostics,
      db_storage_mode: storageMode,
      db_analytics_scope: analyticsScope(),
      db_foundation_write_mode: foundationWriteMode(),
      db_rows_written_by_table: dbRowsWrittenByTable,
      db_upsert_dedupe: upsertDedupeAudit,
      optional_db_write_failures: upsertDedupeAudit.optional_db_write_failures || {},
      schema_compatibility: schemaCompatibility,
      retention_rows_deleted_by_table: retentionRowsDeletedByTable,
      post_write_verification: postWriteVerification,
      dashboard_summary_snapshot: dashboardSummarySnapshotResult,
      materialized_current_tables: currentMaterializedResult,
      vessel_universe_audit: vesselUniverseAuditResult,
      last_successful_dataset_lock: promotion.last_successful_dataset_lock,
      port_call_architecture: {
        port_call_id_coverage: promotion.port_call_id_coverage,
        port_call_master_count: intelligencePopulationDiagnostics.port_call_master_count,
        opportunity_created_count: intelligencePopulationDiagnostics.opportunity_created_count,
        feature_snapshots_written: intelligencePopulationDiagnostics.feature_snapshots_written,
        event_rows_written: intelligencePopulationDiagnostics.event_rows_written,
        explainability_generated_count: intelligencePopulationDiagnostics.explainability_generated_count,
        high_score_without_explanation_count: intelligencePopulationDiagnostics.high_score_without_explanation_count
      }
    },
    error_summary: { error: options.error || (storageFinalized ? null : "Supabase write did not finalize."), promotion, post_write_verification: postWriteVerification, historical_snapshot: historicalSnapshotResult.historical_snapshot_error_summary }
  }, runId, schemaCompatibility.data_collection_runs);
  if (finalRunUpdate.error) throw finalRunUpdate.error;

  return {
    runId,
    recordsSaved,
    table: "vessel_snapshots",
    mode: "append_only",
    promoted,
    promotion,
    batchSize,
    entitiesSaved: entities.length,
    masterRowsSaved: masterRows.length,
    operatorRowsSaved: operatorRows.length,
    agentRowsSaved: agentRows.length,
    agentOperatorLinksSaved: agentOperatorLinks.length,
    agentOperatorMappingRowsSaved: agentOperatorLinks.length,
    vesselOperatorHistoryRowsSaved: operatorHistoryRows.length,
    operatorHistoryRowsSaved: operatorHistoryRows.length,
    fleetOpportunityRowsSaved: fleetOpportunityRows.length,
    featureStoreRowsSaved: featureStoreRows.length,
    featureSnapshotRowsSaved: featureSnapshotRows.length,
    ruleEvaluationRowsSaved: ruleEvaluationRows.length,
    explainabilityRowsSaved: explainabilityRows.length,
    routeGraphRowsSaved: routeGraphRows.length,
    operatorGraphRowsSaved: operatorGraphRows.length,
    modelTrainingRowsSaved: trainingRows.length,
    ...historicalSnapshotResult,
    ...intelligencePopulationDiagnostics,
    ...dashboardSummarySnapshotResult,
    ...currentMaterializedResult,
    vesselUniverseAudit: vesselUniverseAuditResult,
    post_write_verification: postWriteVerification,
    storage_finalization_status: postWriteVerification.status,
    active_run_id: postWriteVerification.active_run_id,
    latest_successful_run_id: postWriteVerification.latest_successful_run_id,
    db_rows_written_by_table: dbRowsWrittenByTable,
    db_upsert_dedupe: upsertDedupeAudit,
    optional_db_write_failures: upsertDedupeAudit.optional_db_write_failures || {},
    schema_compatibility: schemaCompatibility,
    retention_rows_deleted_by_table: retentionRowsDeletedByTable,
    retentionCleanup,
    routePatternRowsSaved: routePatternRows.length,
    vesselRouteHistoryRowsSaved: vesselRouteHistoryRows.length,
    predictedArrivalRowsSaved: predictedArrivalRows.length,
    identityCandidatesSaved: identityCandidates.length,
    imoRecoveryQueueRowsSaved,
    riskRowsSaved: riskRows.length,
    eventsSaved: events.length,
    pilotScheduleEventsSaved: pilotEvents.length,
    congestionRowsSaved: congestionRows.length
  };
}
