import { createClient } from "@supabase/supabase-js";
import ws from "ws";
import { randomUUID } from "node:crypto";

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

function fallbackMasterId(record = {}) {
  return record.master_vessel_id || record.hybrid_entity_key || record.vessel_id;
}

function commercialScore(record = {}) {
  return Number(record.commercial_value_score || record.total_sales_priority_score || record.cleaning_candidate_score || 0);
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
  return {
    promotable: attempted > 0 && portOperationSuccess >= 1 && records.filter(r => ["target_vessel", "unknown_gt_review"].includes(r.commercial_relevance_status)).length > 0 && parseErrorRate < 0.5,
    attempted,
    portOperationSuccess,
    parseErrorRate
  };
}

function scoreNumber(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

function candidateLabel(record = {}) {
  const score = commercialScore(record);
  if (record.candidate_band) return record.candidate_band;
  if (score >= 75) return "immediate_target";
  if (score >= 65) return "sales_target";
  if (score >= 50) return "watchlist";
  return "general";
}

function buildFoundationFeatureVector(record = {}) {
  return {
    gt: scoreNumber(record.gt || record.grtg || record.intrlGrtg),
    commercial_value_score: commercialScore(record),
    work_feasibility_score: scoreNumber(record.work_feasibility_score),
    congestion_score: scoreNumber(record.congestion_score || record.port_congestion_score),
    biofouling_exposure_score: scoreNumber(record.biofouling_exposure_score || record.biofouling_risk_score),
    performance_proxy_score: scoreNumber(record.performance_proxy_score),
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
    vessel_type_group: record.vessel_type_group || null,
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
      rule_group: "candidate",
      passed: score >= 75,
      severity: score >= 90 ? "critical" : "high",
      score_impact: score,
      explanation_ko: "상업 가치 점수가 즉시 검토 기준 이상입니다."
    },
    {
      rule_id: "SALES_TARGET_SCORE",
      rule_group: "candidate",
      passed: score >= 65,
      severity: "medium",
      score_impact: score,
      explanation_ko: "상업 가치 점수가 영업대상 기준 이상입니다."
    },
    {
      rule_id: "MISSING_IMO_HIGH_VALUE",
      rule_group: "identity",
      passed: !record.imo && (score >= 65 || gt >= 30000),
      severity: "medium",
      score_impact: score,
      explanation_ko: "고가치 선박이지만 IMO가 없어 복구 큐에 우선 반영해야 합니다."
    },
    {
      rule_id: "OPEN_WORK_WINDOW",
      rule_group: "port_call",
      passed: workScore >= 50 || (!record.atd && (record.ata || stayHours > 0)),
      severity: "high",
      score_impact: workScore,
      explanation_ko: "현재 체류 중이거나 작업 가능성이 열려 있습니다."
    },
    {
      rule_id: "LONG_STAY_OR_ANCHORAGE",
      rule_group: "event",
      passed: stayHours >= 72 || anchorageHours >= 72,
      severity: "medium",
      score_impact: Math.max(stayHours, anchorageHours),
      explanation_ko: "장기 체류 또는 장기 묘박 신호가 있습니다."
    },
    {
      rule_id: "CONTACT_PATH_READY",
      rule_group: "operator",
      passed: contactScore >= 60 || record.contact_path_status === "contact_available",
      severity: "medium",
      score_impact: contactScore,
      explanation_ko: "운영선사 또는 대리점 연락 경로가 비교적 준비되어 있습니다."
    }
  ];
}

export async function saveToSupabase(records, options = {}) {
  const supabase = getSupabase();
  const now = new Date().toISOString();
  const runId = options.runId || createRunId();
  const diagnostics = options.diagnostics || {};
  const promotion = shouldPromoteRun(records, diagnostics);
  const runStatus = options.status === "failed" ? "failed" : promotion.promotable ? "promotable" : records.length ? "degraded_not_promoted" : "no_live_data";
  const exclusionReasonCounts = records.reduce((acc, r) => {
    const score = Number(r.commercial_value_score || r.total_sales_priority_score || r.cleaning_candidate_score || 0);
    const excluded = r.commercial_relevance_status === "excluded_non_commercial_type" ||
      r.commercial_relevance_status === "excluded_departure_only" ||
      r.excluded_from_commercial_targets === true ||
      /sample|demo|yeosu target|mv hf zhoushan|maersk demo/i.test([r.vessel_name, r.name, r.source, r.source_name, r.data_mode].filter(Boolean).join(" "));
    if (score >= 50 && excluded) {
      const reason = r.exclusion_reason || r.commercial_relevance_status || "excluded";
      acc[reason] = (acc[reason] || 0) + 1;
    }
    return acc;
  }, {});
  const highScoreNotPromotedCount = Object.values(exclusionReasonCounts).reduce((sum, count) => sum + Number(count || 0), 0);
  const imoRecoveryDiagnostics = buildImoRecoveryDiagnostics(records);

  await supabase.from("data_collection_runs").insert({
    run_id: runId,
    started_at: options.startedAt || now,
    finished_at: now,
    status: runStatus,
    source_summary: {
      ...diagnostics,
      imo_recovery: imoRecoveryDiagnostics
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
    candidates_count: records.filter(r => (r.commercial_value_score || r.total_sales_priority_score || 0) >= 50 || r.is_cleaning_candidate).length,
    sales_candidates_count: records.filter(r => (r.commercial_value_score || r.total_sales_priority_score || 0) >= 50 || r.is_cleaning_candidate).length,
    immediate_targets_count: records.filter(r => (r.commercial_value_score || r.total_sales_priority_score || 0) >= 75 || r.is_immediate_candidate).length,
    high_score_not_promoted_count: highScoreNotPromotedCount,
    candidate_promotion_error: highScoreNotPromotedCount > 0,
    exclusion_reason_counts: exclusionReasonCounts,
    imo_missing_count: records.filter(r => !r.imo).length,
    imo_recovered_count: imoRecoveryDiagnostics.imo_recovered_count,
    high_value_low_confidence_count: records.filter(r => (r.commercial_value_score || 0) >= 35 && ((r.data_confidence_score || 0) < 60 || !r.imo)).length,
    actionable_rows: records.filter(r => r.actionable_source_row !== false).length,
    validation_status: promotion.promotable ? "passed" : "not_promoted",
    error_summary: { error: options.error || null, promotion }
  });

  const rows = records.map(r => ({
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
    why_now: r.why_now || null,
    candidate_summary_ko: r.candidate_summary_ko || null,
    sales_angle: r.sales_angle || null,
    recommended_next_action: r.recommended_next_action || null,
    recommended_action: r.recommended_action || r.recommended_next_action || null,
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
    candidate_band: r.sales_priority_band || "low_priority",
    sales_reason: r.sales_reason || r.reason_codes || [],
    reason_codes: r.reason_codes || [],
    hybrid_entity_key: r.hybrid_entity_key || r.vessel_id,
    payload: r,
    updated_at: r.updated_at || now,
    collected_at: now,
    source: r.source || r.source_mode || "korea-port-hull-intelligence",
    source_name: r.source || r.source_label || r.source_mode || "korea-port-hull-intelligence"
  }));

  if (!rows.length) {
    return { runId, recordsSaved: 0, table: "vessel_snapshots", mode: "empty", promoted: false, promotion };
  }

  let recordsSaved = 0;
  const batchSize = Number(process.env.SUPABASE_BATCH_SIZE || 100);
  for (let index = 0; index < rows.length; index += batchSize) {
    const batch = rows.slice(index, index + batchSize);
    const { error } = await supabase
      .from("vessel_snapshots")
      .insert(batch);
    if (error) throw error;
    recordsSaved += batch.length;
  }

  const entities = records.map(r => ({
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
    payload: r
  })).filter(r => r.hybrid_entity_key);

  for (let index = 0; index < entities.length; index += batchSize) {
    const batch = entities.slice(index, index + batchSize);
    const { error } = await supabase
      .from("vessel_entities")
      .upsert(batch, { onConflict: "hybrid_entity_key" });
    if (error) throw error;
  }

  let masterRows = records.map(r => ({
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
    payload: r
  })).filter(r => r.master_vessel_id);

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

  masterRows = masterRows.map(row => {
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
  });

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
        payload: r
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
      payload: row.payload
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
          payload: r
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
          payload: r
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
      payload: r
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
      payload: row.payload
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
        route_pattern_id: stableEntityId("ROUTE", `${fromPort}-${toPort}-${vesselTypeGroup}`),
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
        payload: r
      };
    })
    .filter(Boolean), row => `${row.from_port}|${row.to_port}|${row.vessel_type_group}`);

  for (let index = 0; index < routePatternRows.length; index += batchSize) {
    const batch = routePatternRows.slice(index, index + batchSize);
    const { error } = await supabase.from("route_patterns").upsert(batch, { onConflict: "from_port,to_port,vessel_type_group" });
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
      route_pattern_id: stableEntityId("ROUTE", `${normalizeCompanyName(r.route_from_port || r.previous_port || "")}-${normalizeCompanyName(r.route_to_port || r.destination_port || r.destination || r.next_port || r.port_name || r.port || "")}-${r.vessel_type_group || "unknown"}`),
      arrival_prediction_confidence: Number(r.arrival_prediction_confidence || 0),
      payload: r
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
      route_pattern_id: stableEntityId("ROUTE", `${normalizeCompanyName(r.route_from_port || r.previous_port || "")}-${normalizeCompanyName(r.route_to_port || r.destination_port || r.destination || r.next_port || r.port_name || r.port || "")}-${r.vessel_type_group || "unknown"}`),
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
      payload: r
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
      why_now: r.why_now || null,
      candidate_summary_ko: r.candidate_summary_ko || null,
      sales_angle: r.sales_angle || null,
      recommended_next_action: r.recommended_next_action || null,
      recommended_action: r.recommended_action || r.recommended_next_action || null,
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
      payload: r,
      updated_at: now
    })), row => row.lead_id);

  for (let index = 0; index < commercialLeadRows.length; index += batchSize) {
    const batch = commercialLeadRows.slice(index, index + batchSize);
    const { error } = await supabase.from("commercial_leads").upsert(batch, { onConflict: "lead_id" });
    if (error) throw error;
  }

  const enrichmentMatchRows = uniqueBy(records
    .filter(r => Number(r.match_score || r.pilot_match_score || r.berth_match_confidence || r.enrichment_confidence || 0) > 0 || r.pilot_schedule_matched || r.secondary_enrichment_matched)
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
      raw_source_payload: r.raw_source_payload || {},
      created_at: now,
      matched_at: now,
      reused_historical_match: Boolean(r.vessel_master_cache_match || r.vessel_master_seed_match || r.previous_enrichment_match),
      payload: r
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
        payload: row.payload
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
      payload: r
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

  const riskRows = records.map(r => ({
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
    payload: r
  })).filter(r => r.hybrid_entity_key);

  for (let index = 0; index < riskRows.length; index += batchSize) {
    const batch = riskRows.slice(index, index + batchSize);
    const { error } = await supabase.from("risk_history").insert(batch);
    if (error) throw error;
  }

  const events = records
    .filter(r => r.is_cleaning_candidate || r.is_immediate_candidate || (r.total_sales_priority_score || 0) >= 60)
    .map(r => ({
      hybrid_entity_key: r.hybrid_entity_key || r.vessel_id,
      master_vessel_id: fallbackMasterId(r),
      run_id: runId,
      vessel_id: r.vessel_id,
      event_type: r.is_immediate_candidate ? "SCORE_INCREASED" : "LONG_IDLE_DETECTED",
      event_time: now,
      port_code: r.port_code || null,
      berth_name: r.berth_name || r.berth || null,
      confidence: r.candidate_confidence || 50,
      source_name: r.source || null,
      port: r.port || null,
      payload: r
    }))
    .filter(r => r.hybrid_entity_key);

  for (let index = 0; index < events.length; index += batchSize) {
    const batch = events.slice(index, index + batchSize);
    const { error } = await supabase.from("vessel_events").insert(batch);
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
      raw_payload: r,
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

  const featureStoreRows = uniqueBy(records.map(r => {
    const entityKey = r.hybrid_entity_key || r.vessel_id || `${r.vessel_name || "UNKNOWN"}-${r.port_code || ""}`;
    const portCallKey = r.port_call_identity || r.port_call_key || r.raw_row_identity || r.port_code || r.port || "unknown";
    return {
      feature_id: stableEntityId("FEAT", `${runId}-${entityKey}-${portCallKey}`),
      run_id: runId,
      collected_at: now,
      entity_type: "vessel_port_call",
      entity_id: entityKey,
      hybrid_entity_key: r.hybrid_entity_key || r.vessel_id || null,
      port_call_identity: r.port_call_identity || r.port_call_key || null,
      master_vessel_id: fallbackMasterId(r),
      port_code: r.port_code || null,
      feature_namespace: "commercial_foundation",
      feature_version: "foundation_v1",
      features: buildFoundationFeatureVector(r),
      labels: buildFoundationLabels(r),
      payload: {
        vessel_name: r.vessel_name || null,
        port_name: r.port_name || r.port || null,
        reason_codes: r.reason_codes || [],
        why_now: r.why_now || null,
        recommended_action: r.recommended_action || r.recommended_next_action || null
      }
    };
  }), row => row.feature_id);

  for (let index = 0; index < featureStoreRows.length; index += batchSize) {
    const batch = featureStoreRows.slice(index, index + batchSize);
    const { error } = await supabase.from("feature_store").upsert(batch, { onConflict: "feature_id" });
    if (error) throw error;
  }

  const ruleEvaluationRows = uniqueBy(records.flatMap(r => {
    const entityKey = r.hybrid_entity_key || r.vessel_id || `${r.vessel_name || "UNKNOWN"}-${r.port_code || ""}`;
    return evaluateFoundationRules(r).map(rule => ({
      evaluation_id: stableEntityId("RULE", `${runId}-${entityKey}-${rule.rule_id}`),
      run_id: runId,
      collected_at: now,
      rule_id: rule.rule_id,
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
      payload: r
    }));
  }), row => row.evaluation_id);

  for (let index = 0; index < ruleEvaluationRows.length; index += batchSize) {
    const batch = ruleEvaluationRows.slice(index, index + batchSize);
    const { error } = await supabase.from("rule_evaluations").upsert(batch, { onConflict: "evaluation_id" });
    if (error) throw error;
  }

  const explainabilityRows = uniqueBy(records.map(r => {
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
      why_now: r.why_now || r.candidate_summary_ko || null,
      recommended_action: r.recommended_action || r.recommended_next_action || null,
      reason_codes: r.reason_codes || [],
      rule_hits: rules.map(rule => rule.rule_id),
      feature_contributions: buildFoundationFeatureVector(r),
      payload: r
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

  const trainingRows = uniqueBy(records.map(r => {
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
      payload: r
    };
  }), row => row.training_row_id);

  for (let index = 0; index < trainingRows.length; index += batchSize) {
    const batch = trainingRows.slice(index, index + batchSize);
    const { error } = await supabase.from("model_training_rows").upsert(batch, { onConflict: "training_row_id" });
    if (error) throw error;
  }

  let promoted = false;
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
    await supabase.from("data_collection_runs").update({ status: "promoted", promoted_at: now }).eq("run_id", runId);
    promoted = true;
  }

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
    ruleEvaluationRowsSaved: ruleEvaluationRows.length,
    explainabilityRowsSaved: explainabilityRows.length,
    routeGraphRowsSaved: routeGraphRows.length,
    operatorGraphRowsSaved: operatorGraphRows.length,
    modelTrainingRowsSaved: trainingRows.length,
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
