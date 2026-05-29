const API_CACHE_SECONDS = 300;
const SALES_CANDIDATE_THRESHOLD = 65;
const IMMEDIATE_TARGET_THRESHOLD = 75;
const CRITICAL_TARGET_THRESHOLD = 90;
const PORT_REGISTRY = [
  { port_code: "020", port_name_ko: "부산항", tier: 1, sort: 10 },
  { port_code: "820", port_name_ko: "울산항", tier: 1, sort: 20 },
  { port_code: "620", port_name_ko: "여수·광양항", tier: 1, sort: 30 },
  { port_code: "031", port_name_ko: "평택·당진항", tier: 1, sort: 40 },
  { port_code: "030", port_name_ko: "인천항", tier: 1, sort: 50 },
  { port_code: "810", port_name_ko: "포항항", tier: 1, sort: 60 },
  { port_code: "622", port_name_ko: "하동항", sub_port: "Hadong", tier: 2, sort: 110 },
  { port_code: "622", port_name_ko: "삼천포항", sub_port: "Samcheonpo", tier: 2, sort: 120 },
  { port_code: "621", port_name_ko: "대산항", tier: 2, sort: 130 },
  { port_code: "622", port_name_ko: "마산·진해항", sub_port: "Masan/Jinhae", tier: 2, sort: 140 },
  { port_code: "622", port_name_ko: "통영항", sub_port: "Tongyeong", tier: 2, sort: 150 },
  { port_code: "622", port_name_ko: "거제·옥포항", sub_port: "Geoje/Okpo", tier: 2, sort: 160 },
  { port_code: "070", port_name_ko: "목포항", tier: 2, sort: 170 },
  { port_code: "080", port_name_ko: "군산항", tier: 2, sort: 180 },
  { port_code: "120", port_name_ko: "동해·묵호항", sub_port: "Donghae/Mukho", tier: 2, sort: 190 },
  { port_code: "940", port_name_ko: "제주항", tier: 3, sort: 210 },
  { port_code: "120", port_name_ko: "속초항", sub_port: "Sokcho", tier: 3, sort: 220 },
  { port_code: "031", port_name_ko: "보령항", sub_port: "Boryeong", tier: 3, sort: 230 },
  { port_code: "030", port_name_ko: "영흥 터미널", sub_port: "Yeongheung", tier: 3, sort: 240 },
  { port_code: "621", port_name_ko: "태안 터미널", sub_port: "Taean", tier: 3, sort: 250 },
  { port_code: "031", port_name_ko: "당진 산업터미널", sub_port: "Dangjin Industrial", tier: 3, sort: 260 },
  { port_code: "820", port_name_ko: "LNG·산업 터미널", sub_port: "LNG/Industrial", tier: 3, sort: 270 }
];
const BASIC_INFO_FIELDS = [
  "vessel_name", "normalized_vessel_name", "call_sign", "imo", "mmsi", "vessel_type", "vessel_type_group",
  "gt", "dwt", "loa", "beam", "flag", "operator", "operator_normalized", "agent", "agent_normalized",
  "previous_port", "next_port", "destination_port", "port_code", "port_name", "berth_name", "anchorage_name",
  "eta", "ata", "etd", "atd"
];
function json(data, init = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": `public, max-age=${API_CACHE_SECONDS}, stale-while-revalidate=900`,
      ...(init.headers || {})
    }
  });
}

function corsHeaders() {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, OPTIONS",
    "access-control-allow-headers": "content-type"
  };
}

function scoreLevel(score = 0) {
  if (score >= CRITICAL_TARGET_THRESHOLD) return "Critical";
  if (score >= IMMEDIATE_TARGET_THRESHOLD) return "Immediate";
  if (score >= SALES_CANDIDATE_THRESHOLD) return "Target";
  if (score >= 40) return "Watch";
  return "Low";
}

function hasValue(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === "number") return Number.isFinite(value) && value > 0;
  return String(value).trim() !== "";
}

function normalizeCompanyName(value) {
  return String(value || "")
    .normalize("NFKC")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, " ");
}

function basicInfoCompleteness(record = {}) {
  const present = BASIC_INFO_FIELDS.filter(field => hasValue(record[field]));
  return Math.round((present.length / BASIC_INFO_FIELDS.length) * 100);
}

function operatorReasonCodes(v = {}) {
  const codes = [];
  if (hasValue(v.operator_name || v.operator) && !v.operator_inferred) codes.push("OPERATOR_IDENTIFIED");
  if (hasValue(v.operator_name || v.operator) && v.operator_inferred) codes.push("OPERATOR_INFERRED");
  if (hasValue(v.agent_name || v.agent)) codes.push("AGENT_IDENTIFIED");
  if (hasValue(v.operator_name || v.operator) || hasValue(v.agent_name || v.agent)) codes.push("CONTACT_PATH_AVAILABLE");
  return codes;
}

function deriveSalesAccessibilityScore(v = {}) {
  const source = String(v.operator_source || "");
  const confidence = Number(v.operator_confidence || 0);
  if (source === "vessel_master" || source === "vessel_spec_api") return 5;
  if (source === "operator_dictionary") return 4;
  if (source === "vessel_name_prefix" && confidence >= 70) return 3;
  if (source === "agent_dictionary") return 2;
  if (source === "agent_heuristic") return 1;
  if (hasValue(v.operator_name || v.operator)) return 2;
  if (hasValue(v.agent_name || v.agent)) return 1;
  return 0;
}

function deriveContactReadinessScore(v = {}) {
  const accessibility = deriveSalesAccessibilityScore(v);
  const companyContactAvailable = hasValue(v.operator_website || v.operator_url || v.agent_website || v.agent_url || v.operator_email || v.agent_email || v.operator_phone || v.agent_phone || v.contact_email || v.contact_phone);
  const repeatSignal = Number(v.repeat_operator_score || v.repeat_caller_score || 0) > 0 ? 5 : 0;
  return Math.min(100, Math.round(
    (accessibility / 5) * 55 +
    (hasValue(v.agent_name || v.agent || v.satmntEntrpsNm || v.entrpsCdNm) ? 35 : 0) +
    (companyContactAvailable ? 10 : 0) +
    repeatSignal +
    (hasValue(v.manager_name || v.manager) ? 5 : 0) +
    (hasValue(v.owner_name || v.owner) ? 5 : 0)
  ));
}

function sortCommercialPriority(records) {
  return records.slice().sort((a, b) =>
    commercialScore(b) - commercialScore(a) ||
    Number(b.is_immediate_candidate) - Number(a.is_immediate_candidate) ||
    Number(b.work_feasibility_score || b.cleaning_window_score || 0) - Number(a.work_feasibility_score || a.cleaning_window_score || 0) ||
    deriveCongestionScore(b) - deriveCongestionScore(a) ||
    (b.data_confidence_score || 0) - (a.data_confidence_score || 0) ||
    (b.biofouling_score || b.biofouling_risk_score || 0) - (a.biofouling_score || a.biofouling_risk_score || 0) ||
    candidateTimestamp(b) - candidateTimestamp(a)
  );
}

function percentileForRank(rank, total) {
  if (total <= 1) return 0;
  return Math.round(((rank - 1) / (total - 1)) * 1000) / 10;
}

function annotateCommercialRanks(records = []) {
  const ranked = sortCommercialPriority(records);
  ranked.forEach((record, index) => {
    record.global_rank = index + 1;
    record.global_percentile = percentileForRank(index + 1, ranked.length);
  });
  const byPort = new Map();
  for (const record of records) {
    const key = String(record.port_code || record.port_name || record.port || "UNKNOWN");
    if (!byPort.has(key)) byPort.set(key, []);
    byPort.get(key).push(record);
  }
  for (const group of byPort.values()) {
    sortCommercialPriority(group).forEach((record, index) => {
      record.port_rank = index + 1;
      record.port_percentile = percentileForRank(index + 1, group.length);
    });
  }
  return records;
}

function hasCommercialRank(v = {}) {
  return Number.isFinite(Number(v.global_percentile)) || Number.isFinite(Number(v.port_percentile));
}

function withinCommercialPercentile(v = {}, percent = 20) {
  if (!hasCommercialRank(v)) return true;
  return Number(v.global_percentile ?? 101) <= percent || Number(v.port_percentile ?? 101) <= percent;
}

function candidateDedupeKey(v = {}) {
  const normalizedName = String(v.normalized_vessel_name || v.vessel_name || "").normalize("NFKC").toUpperCase().replace(/[^A-Z0-9가-힣]+/g, "");
  const portCode = String(v.port_code || portCodeFromName(v.port || v.port_name) || "");
  if (hasValue(v.master_vessel_id) && hasValue(v.port_call_identity)) return `MASTER_PORTCALL|${v.master_vessel_id}|${portCode}|${v.port_call_identity}`;
  if (hasValue(v.imo)) return `IMO_TIME|${v.imo}|${portCode}|${v.ata || v.eta || ""}`;
  if (hasValue(v.call_sign) && (hasValue(v.etryptYear) || hasValue(v.etryptCo))) return `CALL_PORTCALL|${v.call_sign}|${portCode}|${v.etryptYear || ""}|${v.etryptCo || ""}`;
  return `NAME_PORT_BERTH_TIME|${normalizedName}|${portCode}|${v.berth_name || v.berth || v.anchorage_name || ""}|${v.ata || v.eta || ""}`;
}

function candidateTimestamp(v = {}) {
  const value = Date.parse(v.collected_at || v.updated_at || v.last_seen_at || v.first_seen_at || "");
  return Number.isNaN(value) ? 0 : value;
}

function isBetterCandidate(next = {}, current = {}) {
  return commercialScore(next) > commercialScore(current) ||
    (commercialScore(next) === commercialScore(current) && deriveCongestionScore(next) > deriveCongestionScore(current)) ||
    (commercialScore(next) === commercialScore(current) && deriveCongestionScore(next) === deriveCongestionScore(current) && Number(next.data_confidence_score || 0) > Number(current.data_confidence_score || 0)) ||
    (commercialScore(next) === commercialScore(current) && deriveCongestionScore(next) === deriveCongestionScore(current) && Number(next.data_confidence_score || 0) === Number(current.data_confidence_score || 0) && candidateTimestamp(next) > candidateTimestamp(current));
}

function dedupeCandidateRows(records = []) {
  const byKey = new Map();
  for (const record of records) {
    const key = candidateDedupeKey(record);
    const current = byKey.get(key);
    if (!current || isBetterCandidate(record, current)) byKey.set(key, record);
  }
  return [...byKey.values()];
}

function highScoreAuditRow(v = {}) {
  return {
    vessel_name: v.vessel_name || v.name || "",
    port: v.port_name || v.port || "",
    port_code: v.port_code || portCodeFromName(v.port || v.port_name),
    score: commercialScore(v),
    gt: Number(v.gt || v.grtg || v.intrlGrtg || 0),
    vessel_type: v.vessel_type_group || v.vessel_type || v.vsslKndNm || "",
    status_bucket: v.status_bucket || "",
    candidate_key: candidateDedupeKey(v),
    hard_excluded: isHardCandidateExcluded(v),
    exclusion_reason: exclusionReason(v) || ""
  };
}

function highScoreVisibilityAudit(records = [], threshold = 93) {
  const usefulRows = records.filter(v => !isSyntheticSample(v) && hasUsefulVesselIdentity(v));
  const sourceHighScoreRows = usefulRows.filter(v => commercialScore(v) >= threshold);
  const targetRows = vesselGroupRows(records, "target");
  const targetKeys = new Set(targetRows.map(candidateDedupeKey));
  const visibleHighScoreRows = targetRows.filter(v => commercialScore(v) >= threshold);
  const hiddenHighScoreRows = sourceHighScoreRows.filter(v => !targetKeys.has(candidateDedupeKey(v)));
  const excludedHighScoreRows = sourceHighScoreRows.filter(isHardCandidateExcluded);
  const groups = new Map();
  for (const row of sourceHighScoreRows) {
    const key = candidateDedupeKey(row);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  const dedupedGroups = [...groups.entries()]
    .filter(([, rows]) => rows.length > 1)
    .map(([key, rows]) => {
      const kept = sortCommercialPriority(rows)[0] || {};
      return {
        key,
        count: rows.length,
        kept_vessel_name: kept.vessel_name || kept.name || "",
        kept_score: commercialScore(kept),
        kept_port: kept.port_name || kept.port || "",
        duplicate_examples: rows.slice(0, 4).map(highScoreAuditRow)
      };
    })
    .slice(0, 12);

  return {
    threshold,
    source_high_score_count: sourceHighScoreRows.length,
    visible_high_score_count: visibleHighScoreRows.length,
    hidden_high_score_count: hiddenHighScoreRows.length,
    excluded_high_score_count: excludedHighScoreRows.length,
    deduped_high_score_group_count: dedupedGroups.length,
    hidden_high_score_examples: hiddenHighScoreRows.slice(0, 12).map(highScoreAuditRow),
    excluded_high_score_examples: excludedHighScoreRows.slice(0, 12).map(highScoreAuditRow),
    deduped_high_score_groups: dedupedGroups
  };
}

function compactRankRow(v = {}, rank = 0) {
  return {
    rank,
    vessel_name: v.vessel_name || v.name || "",
    port: v.port_name || v.port || "",
    port_code: v.port_code || portCodeFromName(v.port || v.port_name),
    score: commercialScore(v),
    congestion_score: deriveCongestionScore(v),
    data_confidence_score: Number(v.data_confidence_score || 0),
    gt: Number(v.gt || v.grtg || v.intrlGrtg || 0),
    status_bucket: v.status_bucket || "",
    candidate_band: v.candidate_band || scoreLevel(commercialScore(v)),
    key: candidateDedupeKey(v),
    exclusion_reason: exclusionReason(v) || ""
  };
}

function commercialRankingAudit(records = []) {
  const usefulRows = records.filter(v => !isSyntheticSample(v) && hasUsefulVesselIdentity(v));
  const sourceRanked = sortCommercialPriority(usefulRows);
  const targetRanked = vesselGroupRows(records, "target");
  const immediateRanked = sortCommercialPriority(dedupeCandidateRows(targetRanked.filter(isImmediateTarget)));
  const targetKeys = new Set(targetRanked.map(candidateDedupeKey));
  const sourceTopKeys = new Set(sourceRanked.slice(0, 20).map(candidateDedupeKey));
  const missingFromTargetTop = sourceRanked
    .slice(0, 20)
    .filter(v => commercialScore(v) >= SALES_CANDIDATE_THRESHOLD && !targetKeys.has(candidateDedupeKey(v)))
    .map((v, index) => compactRankRow(v, index + 1));
  return {
    ranking_rule: "commercial_value_score desc, then immediate flag, congestion score, data confidence, biofouling score, latest timestamp",
    source_top_score: commercialScore(sourceRanked[0] || {}),
    target_top_score: commercialScore(targetRanked[0] || {}),
    immediate_top_score: commercialScore(immediateRanked[0] || {}),
    source_top_20_count: sourceTopKeys.size,
    source_top_20_missing_from_target_count: missingFromTargetTop.length,
    source_top_10: sourceRanked.slice(0, 10).map((v, i) => compactRankRow(v, i + 1)),
    target_top_10: targetRanked.slice(0, 10).map((v, i) => compactRankRow(v, i + 1)),
    immediate_top_10: immediateRanked.slice(0, 10).map((v, i) => compactRankRow(v, i + 1)),
    missing_from_target_top_examples: missingFromTargetTop.slice(0, 10)
  };
}

function normalizeSnapshot(row = {}) {
  const payload = row.payload || row.raw_payload || {};
  const merged = { ...row, ...payload };
  const riskScore = Number(merged.risk_score || merged.biofouling_score || 0);
  const sourceMode = merged.source_mode || "supabase_snapshot";
  const congestionScore = deriveCongestionScore(merged);
  const biofoulingRiskScore = deriveBiofoulingProxyScore(merged, congestionScore, riskScore);
  const performanceProxyScore = derivePerformanceProxyScore(merged, congestionScore);
  const ciiPressureScore = deriveCiiProxyScore(merged, congestionScore, performanceProxyScore);
  const candidateScore = Math.max(
    Number(merged.cleaning_candidate_score || merged.total_sales_priority_score || riskScore || 0),
    deriveCommercialProxyScore(merged, {
      congestionScore,
      biofoulingRiskScore,
      performanceProxyScore,
      ciiPressureScore
    })
  );
  const workFeasibilityScore = Number(merged.work_feasibility_score || deriveWorkFeasibilityScore(merged));
  const leadPriorityScore = Number(merged.lead_priority_score || deriveLeadPriorityScore(merged, {
    commercialValueScore: Math.max(Number(merged.commercial_value_score || merged.total_sales_priority_score || 0), candidateScore),
    contactReadinessScore: Number(merged.contact_readiness_score || deriveContactReadinessScore(merged)),
    workFeasibilityScore,
    arrivalOpportunityScore: Number(merged.arrival_opportunity_score || 0)
  }));
  return {
    vessel_id: merged.vessel_id,
    vessel_name: merged.vessel_name,
    imo: merged.imo || "",
    mmsi: merged.mmsi || "",
    call_sign: merged.call_sign || merged.callsign || "",
    port: merged.port || "Korea",
    port_code: merged.port_code || portCodeFromName(merged.port || merged.port_name),
    port_name: merged.port_name || merged.port || "Korea",
    port_name_ko: merged.port_name_ko || "",
    port_group: merged.port_group || "",
    sub_port: merged.sub_port || "",
    port_tier: merged.port_tier || "",
    commercial_focus: merged.commercial_focus || "",
    commercial_priority: merged.commercial_priority || "",
    anchorage_relevance: merged.anchorage_relevance || "",
    berth: merged.berth || "",
    anchorage_zone: merged.anchorage_zone || "",
    anchorage_name: merged.anchorage_name || merged.anchorage_zone || "",
    berth_class: merged.berth_class || "",
    anchorage_class: merged.anchorage_class || "",
    status: merged.status || "Observed",
    operator_name: merged.operator_name || merged.operator || "",
    operator: merged.operator_name || merged.operator || "",
    operator_inferred: Boolean(merged.operator_inferred),
    operator_confidence: Number(merged.operator_confidence || 0),
    operator_source: merged.operator_source || "",
    operator_website: merged.operator_website || merged.operator_url || "",
    operator_email: merged.operator_email || "",
    operator_phone: merged.operator_phone || "",
    destination: merged.destination || "",
    previous_port: merged.previous_port || "",
    next_port: merged.next_port || "",
    vessel_type: merged.vessel_type || "",
    vessel_type_group: merged.vessel_type_group || "",
    vsslKndCd: merged.vsslKndCd || "",
    vsslKndNm: merged.vsslKndNm || "",
    commercial_segment: merged.commercial_segment || "",
    target_eligibility: merged.target_eligibility || "",
    biofouling_relevance: merged.biofouling_relevance || "",
    gt: Number(merged.gt || merged.grtg || merged.intrlGrtg || 0),
    dwt: Number(merged.dwt || 0),
    loa: Number(merged.loa || 0),
    beam: Number(merged.beam || 0),
    flag: merged.flag || "",
    operator_normalized: merged.operator_normalized || normalizeCompanyName(merged.operator_name || merged.operator || ""),
    agent_name: merged.agent_name || merged.agent || merged.satmntEntrpsNm || merged.entrpsCdNm || "",
    agent: merged.agent_name || merged.agent || merged.satmntEntrpsNm || merged.entrpsCdNm || "",
    agent_normalized: merged.agent_normalized || normalizeCompanyName(merged.agent_name || merged.agent || merged.satmntEntrpsNm || merged.entrpsCdNm || ""),
    agent_source: merged.agent_source || (merged.satmntEntrpsNm || merged.entrpsCdNm ? "port_operation" : ""),
    agent_website: merged.agent_website || merged.agent_url || "",
    agent_email: merged.agent_email || "",
    agent_phone: merged.agent_phone || "",
    manager_name: merged.manager_name || merged.manager || merged.ship_manager || "",
    owner_name: merged.owner_name || merged.owner || merged.ship_owner || "",
    contact_path_available: Boolean(merged.contact_path_available || merged.operator_name || merged.operator || merged.agent_name || merged.agent || merged.satmntEntrpsNm || merged.entrpsCdNm),
    destination_port: merged.destination_port || merged.destination || merged.next_port || "",
    route_region: merged.route_region || "unknown",
    route_from_port: merged.route_from_port || merged.previous_port || "",
    route_to_port: merged.route_to_port || merged.destination_port || merged.destination || merged.next_port || "",
    route_pattern_known: Boolean(merged.route_pattern_known),
    route_pattern_confidence: Number(merged.route_pattern_confidence || 0),
    predicted_arrival_time: merged.predicted_arrival_time || "",
    arrival_prediction_confidence: Number(merged.arrival_prediction_confidence || 0),
    predicted_congestion: Number(merged.predicted_congestion || 0),
    predicted_cleaning_window: Number(merged.predicted_cleaning_window || 0),
    predicted_congestion_score: Number(merged.predicted_congestion_score || merged.predicted_congestion || derivePredictedCongestionScore(merged)),
    congestion_forecast_band: merged.congestion_forecast_band || forecastBand(merged.predicted_congestion_score || merged.predicted_congestion || derivePredictedCongestionScore(merged)),
    anchorage_probability: Number(merged.anchorage_probability || deriveAnchorageProbability(merged)),
    predicted_work_window_hours: Number(merged.predicted_work_window_hours || merged.work_window_hours || 0),
    work_window_confidence: Number(merged.work_window_confidence || 0),
    repeat_caller_score: Number(merged.repeat_caller_score || 0),
    repeat_operator_score: Number(merged.repeat_operator_score || 0),
    low_speed_exposure: Number(merged.low_speed_exposure || 0),
    idle_exposure: Number(merged.idle_exposure || 0),
    anchorage_exposure: Number(merged.anchorage_exposure || 0),
    biofouling_exposure_score: Number(merged.biofouling_exposure_score || deriveBiofoulingExposureScore(merged)),
    predicted_cleaning_opportunity_score: Number(merged.predicted_cleaning_opportunity_score || derivePredictedCleaningOpportunityScore(merged)),
    arrival_opportunity_score: Number(merged.arrival_opportunity_score || 0),
    predicted_arrival_window_hours: Number(merged.predicted_arrival_window_hours || 0),
    predicted_arrival_pipeline: Boolean(merged.predicted_arrival_pipeline),
    arrival_prediction_source: merged.arrival_prediction_source || "",
    sales_accessibility_score: Number(merged.sales_accessibility_score || deriveSalesAccessibilityScore(merged)),
    contact_readiness_score: Number(merged.contact_readiness_score || deriveContactReadinessScore(merged)),
    biosecurity_exposure_score: Number(merged.biosecurity_exposure_score || 0),
    esg_sensitivity_score: Number(merged.esg_sensitivity_score || 0),
    fuel_efficiency_sensitivity_score: Number(merged.fuel_efficiency_sensitivity_score || 0),
    hull_performance_sensitivity_score: Number(merged.hull_performance_sensitivity_score || 0),
    high_regulation_route: Boolean(merged.high_regulation_route),
    compliance_priority: merged.compliance_priority || "standard",
    grtg: Number(merged.grtg || 0),
    intrlGrtg: Number(merged.intrlGrtg || 0),
    gt_source: merged.gt_source || (Number(merged.grtg || 0) > 0 ? "grtg" : Number(merged.intrlGrtg || 0) > 0 ? "intrlGrtg" : Number(merged.gt || 0) > 0 ? "gt" : "unknown"),
    gt_status: merged.gt_status || (Number(merged.gt || merged.grtg || merged.intrlGrtg || 0) >= Number(merged.commercial_gt_threshold || 5000) ? "target_vessel" : Number(merged.gt || merged.grtg || merged.intrlGrtg || 0) > 0 ? "non_target_small_vessel" : "unknown_gt_review"),
    commercial_gt_threshold: Number(merged.commercial_gt_threshold || 5000),
    meets_commercial_gt_threshold: Boolean(merged.meets_commercial_gt_threshold ?? Number(merged.gt || merged.grtg || merged.intrlGrtg || 0) >= Number(merged.commercial_gt_threshold || 5000)),
    eta: merged.eta || "",
    eta_candidate: merged.eta_candidate || "",
    eta_source: merged.eta_source || "",
    etb: merged.etb || "",
    etb_candidate: merged.etb_candidate || "",
    etb_source: merged.etb_source || "",
    ata: merged.ata || "",
    atb: merged.atb || "",
    atb_source: merged.atb_source || "",
    etd: merged.etd || "",
    etd_candidate: merged.etd_candidate || "",
    etd_source: merged.etd_source || "",
    atd: merged.atd || "",
    stay_hours: Number(merged.stay_hours || 0),
    current_call_stay_hours: Number(merged.current_call_stay_hours || merged.stay_hours || 0),
    cumulative_stay_hours: Number(merged.cumulative_stay_hours || merged.stay_hours || 0),
    cumulative_stay_days: Number(merged.cumulative_stay_days || Math.round((Number(merged.cumulative_stay_hours || merged.stay_hours || 0) / 24) * 10) / 10),
    berth_hours: Number(merged.berth_hours || 0),
    anchorage_hours: Number(merged.anchorage_hours || 0),
    work_window_hours: Number(merged.work_window_hours || 0),
    work_feasibility_score: workFeasibilityScore,
    terminal_name: merged.terminal_name || "",
    berth_status: merged.berth_status || "",
    berth_occupancy_proxy: Number(merged.berth_occupancy_proxy || 0),
    terminal_activity: merged.terminal_activity || "",
    cargo_workload_proxy: Number(merged.cargo_workload_proxy || 0),
    secondary_enrichment_matched: Boolean(merged.secondary_enrichment_matched || merged.cargo_harbor_use_enriched),
    enrichment_source: merged.enrichment_source || "",
    enrichment_sources: merged.enrichment_sources || [],
    enrichment_confidence: Number(merged.enrichment_confidence || 0),
    berth_data_source: merged.berth_data_source || "",
    berth_match_method: merged.berth_match_method || "",
    berth_match_confidence: Number(merged.berth_match_confidence || 0),
    source_origin: merged.source_origin || "",
    ledger_status: merged.ledger_status || "",
    pilot_schedule_matched: Boolean(merged.pilot_schedule_matched),
    pilot_only_arrival_review: Boolean(merged.pilot_only_arrival_review),
    pilot_match_method: merged.pilot_match_method || "",
    pilot_match_confidence: Number(merged.pilot_match_confidence || 0),
    pilot_source_url: merged.pilot_source_url || "",
    pilot_last_seen_at: merged.pilot_last_seen_at || "",
    pilot_time: merged.pilot_time || "",
    pilot_direction: merged.pilot_direction || "",
    pilot_station: merged.pilot_station || "",
    movement_time: merged.movement_time || "",
    movement_type: merged.movement_type || "",
    arrival_timing_confidence: Number(merged.arrival_timing_confidence || 0),
    departure_timing_confidence: Number(merged.departure_timing_confidence || 0),
    schedule_confidence: Number(merged.schedule_confidence || 0),
    outbound_pilot_scheduled: Boolean(merged.outbound_pilot_scheduled),
    berth_timing_confidence: Number(merged.berth_timing_confidence || 0),
    risk_score: riskScore,
    risk_level: merged.risk_level || scoreLevel(riskScore),
    biofouling_score: biofoulingRiskScore,
    biofouling_risk_score: biofoulingRiskScore,
    cii_pressure_score: ciiPressureScore,
    performance_proxy_score: performanceProxyScore,
    congestion_score: congestionScore,
    congestion_exposure_score: Math.max(Number(merged.congestion_exposure_score || 0), Math.round(congestionScore / 5)),
    port_congestion_score: Math.max(Number(merged.port_congestion_score || 0), congestionScore),
    total_sales_priority_score: boundedScore(Math.max(Number(merged.total_sales_priority_score || 0), candidateScore)),
    commercial_value_score: boundedScore(Math.max(Number(merged.commercial_value_score || merged.total_sales_priority_score || 0), candidateScore)),
    lead_status: merged.lead_status || deriveLeadStatus(merged, leadPriorityScore),
    lead_priority_score: leadPriorityScore,
    why_now: merged.why_now || deriveWhyNow(merged),
    candidate_summary_ko: merged.candidate_summary_ko || deriveCandidateSummaryKo(merged),
    sales_angle: merged.sales_angle || deriveSalesAngle(merged),
    recommended_next_action: merged.recommended_next_action || deriveRecommendedNextAction(merged, leadPriorityScore),
    recommended_action: merged.recommended_action || merged.recommended_next_action || deriveRecommendedNextAction(merged, leadPriorityScore),
    lead_timeline: Array.isArray(merged.lead_timeline) ? merged.lead_timeline : deriveLeadTimeline(merged),
    last_contacted_at: merged.last_contacted_at || "",
    follow_up_due: merged.follow_up_due || "",
    quote_status: merged.quote_status || "not_started",
    notes: merged.notes || "",
    actual_arrival_time: merged.actual_arrival_time || merged.ata || "",
    prediction_error_hours: merged.prediction_error_hours ?? derivePredictionErrorHours(merged),
    alert_candidate: Boolean(merged.alert_candidate || isAlertCandidate(merged)),
    information_enrichment_needed: Boolean(merged.information_enrichment_needed || (Math.max(Number(merged.commercial_value_score || merged.total_sales_priority_score || 0), candidateScore) >= SALES_CANDIDATE_THRESHOLD && Number(merged.data_confidence_score || 0) < 60)),
    commercial_value_band: merged.commercial_value_band || merged.sales_priority_band || "low_priority",
    data_confidence_score: Number(merged.data_confidence_score || 0),
    data_confidence_band: merged.data_confidence_band || "review",
    cleaning_candidate_score: candidateScore,
    is_cleaning_candidate: Boolean(merged.is_cleaning_candidate ?? (Number(merged.gt || 0) >= Number(merged.commercial_gt_threshold || 5000) && candidateScore >= SALES_CANDIDATE_THRESHOLD)),
    is_immediate_candidate: Boolean(merged.is_immediate_candidate ?? (Number(merged.gt || 0) >= Number(merged.commercial_gt_threshold || 5000) && candidateScore >= IMMEDIATE_TARGET_THRESHOLD)),
    reason_codes: [...new Set([...(merged.reason_codes || merged.sales_reason || []), ...operatorReasonCodes(merged)])],
    sales_reason: [...new Set([...(merged.sales_reason || merged.reason_codes || []), ...operatorReasonCodes(merged)])],
    hybrid_entity_key: merged.hybrid_entity_key || merged.vessel_id,
    master_vessel_id: merged.master_vessel_id || merged.hybrid_entity_key || merged.vessel_id,
    identification_method: merged.identification_method || (merged.imo ? "IMO" : merged.mmsi ? "MMSI" : "NAME_PORT_FALLBACK"),
    identity_match_strategy: merged.identity_match_strategy || merged.identification_method || "",
    identity_confidence: Number(merged.identity_confidence || 0),
    identity_confidence_band: merged.identity_confidence_band || "",
    normalized_vessel_name: merged.normalized_vessel_name || "",
    imo_status: merged.imo_status || (merged.imo ? "present" : "missing_low_confidence"),
    compliance_band: merged.compliance_band || (merged.compliance_watch ? "biosecurity_watch" : "standard"),
    compliance_watch: Boolean(merged.compliance_watch),
    gt_group: merged.gt_group || "gt_unknown",
    stay_days_group: merged.stay_days_group || "stay_under_3d",
    operational_risk_flags: merged.operational_risk_flags || [],
    operational_risk_score: Number(merged.operational_risk_score || riskScore),
    commercial_signal_flags: merged.commercial_signal_flags || [],
    commercial_signal_strength: Number(merged.commercial_signal_strength || 0),
    high_value_target: Boolean(merged.high_value_target),
    congestion_exposed_target: Boolean(merged.congestion_exposed_target),
    imo_recovery_required: Boolean(merged.imo_recovery_required),
    imo_recovery_score: Number(merged.imo_recovery_score || 0),
    imo_recovery_priority: merged.imo_recovery_priority || "review",
    operator_fleet_badges: merged.operator_fleet_badges || [],
    actionable_source_row: Boolean(merged.actionable_source_row ?? merged.sales_ready_input ?? true),
    sales_ready_input: Boolean(merged.sales_ready_input ?? merged.actionable_source_row ?? true),
    opportunity_usd: Number(merged.opportunity_usd || 0),
    source: merged.source || "supabase",
    source_mode: sourceMode,
    run_id: merged.run_id || row.run_id || "",
    first_seen_at: merged.first_seen_at || row.first_seen_at || "",
    last_seen_at: merged.last_seen_at || row.last_seen_at || "",
    data_quality_tier: merged.data_quality_tier || "",
    vessel_basic_info_completeness_score: Number(merged.vessel_basic_info_completeness_score || basicInfoCompleteness(merged)),
    vessel_basic_info_missing_fields: merged.vessel_basic_info_missing_fields || BASIC_INFO_FIELDS.filter(field => !hasValue(merged[field])),
    vessel_spec_enrichment_priority: Boolean(merged.vessel_spec_enrichment_priority),
    status_bucket: merged.status_bucket || deriveStatusBucket(merged),
    commercial_relevance_status: merged.commercial_relevance_status || deriveCommercialRelevance(merged),
    candidate_band: merged.candidate_band || merged.sales_priority_band || "low_priority",
    updated_at: merged.updated_at || merged.collected_at || row.collected_at || new Date().toISOString()
  };
}

function enrichCumulativeStay(record = {}) {
  const parse = value => {
    const date = value ? new Date(String(value).replace(" ", "T")) : null;
    return date && !Number.isNaN(date.getTime()) ? date.getTime() : null;
  };
  const first = parse(record.first_seen_at);
  const last = parse(record.last_seen_at || record.updated_at);
  const observedHours = first && last && last >= first ? Math.round(((last - first) / 36e5) * 10) / 10 : 0;
  const cumulative = Math.max(Number(record.cumulative_stay_hours || 0), Number(record.stay_hours || 0), observedHours);
  const reasons = [
    ...(record.reason_codes || []),
    cumulative >= 2160 ? "CUMULATIVE_STAY_90D_PLUS" : null,
    cumulative >= 720 ? "CUMULATIVE_STAY_30D_PLUS" : null
  ].filter(Boolean);
  return {
    ...record,
    stay_hours: cumulative,
    cumulative_stay_hours: cumulative,
    cumulative_stay_days: Math.round((cumulative / 24) * 10) / 10,
    stay_days_group: stayDaysGroup(cumulative),
    reason_codes: [...new Set(reasons)]
  };
}

function stayDaysGroup(hours) {
  const days = Number(hours || 0) / 24;
  if (days >= 90) return "stay_90d_plus";
  if (days >= 30) return "stay_30_89d";
  if (days >= 21) return "stay_21_29d";
  if (days >= 14) return "stay_14_20d";
  if (days >= 7) return "stay_7_13d";
  if (days >= 3) return "stay_3_6d";
  return "stay_under_3d";
}

function deriveStatusBucket(v = {}) {
  const status = String(v.status || "").toLowerCase();
  const now = Date.now();
  const parse = value => {
    if (!value) return null;
    const raw = String(value).trim().replace(" ", "T");
    const date = new Date(/(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw) ? raw : `${raw}+09:00`);
    return date && !Number.isNaN(date.getTime()) ? date.getTime() : null;
  };
  const eta = parse(v.eta || v.eta_candidate || v.pilot_time || v.movement_time);
  const ata = parse(v.ata);
  const etd = parse(v.etd || v.etd_candidate);
  const atd = parse(v.atd);
  const facilityType = String(v.facility_type || v.berth_class || "").toLowerCase();
  if (v.pilot_only_arrival_review || v.ledger_status === "pilot_only_pending_port_operation") return "arriving_soon";
  if ((facilityType === "anchorage" || /waiting|anchorage|anchor|idle|drifting|묘박|정박|박지|외항|대기/i.test(status) || Number(v.anchorage_hours || 0) > 0) && !atd) return "anchorage_waiting";
  if ((facilityType === "berth" || /berth|moored|alongside/.test(status) || v.berth || v.berth_name || v.atb) && !atd) return "berthed";
  if (ata && !atd) return "arrived_staying";
  if (eta && !ata && eta >= now) return "arriving_soon";
  if (/departed|departure_completed|출항 완료/i.test(status)) return "departed";
  if (etd && etd >= now) return "arrived_staying";
  if (ata || atd) return "arrived_staying";
  return "unknown";
}

function isDepartedRecord(v = {}) {
  const status = String(v.status_bucket || v.operational_status || v.status || "").toLowerCase();
  return status === "departed" ||
    status === "departure_completed" ||
    status.includes("departed") ||
    status.includes("출항 완료") ||
    String(v.commercial_relevance_status || "").toLowerCase() === "excluded_departure_only" ||
    String(v.ledger_status || "").toLowerCase() === "departed";
}

function activeRecordsOnly(records = []) {
  return records.filter(v => !isSyntheticSample(v) && !isDepartedRecord(v));
}

function deriveCommercialRelevance(v = {}) {
  const typeText = `${v.vessel_type || ""} ${v.vessel_name || ""}`.toLowerCase();
  if (/fishing|fishery|trawler|tug|pilot|patrol|government|navy|coast guard|workboat|barge|dredger|어선|예선|관공선|작업선|준설|순찰|해경/.test(typeText)) return "excluded_non_commercial_type";
  const gt = Number(v.gt || v.grtg || v.intrlGrtg || 0);
  if ((v.gt_status || "") === "target_vessel" || gt >= Number(v.commercial_gt_threshold || 5000)) return "target_vessel";
  if ((v.gt_status || "") === "unknown_gt_review" || gt <= 0) return "unknown_gt_review";
  return "non_target_small_vessel";
}

function isMainCommercialVessel(v = {}) {
  const status = v.commercial_relevance_status || deriveCommercialRelevance(v);
  const commercialScore = Number(v.commercial_value_score || v.total_sales_priority_score || v.cleaning_candidate_score || 0);
  if (isSyntheticSample(v) || isDepartedRecord(v) || v.excluded_from_commercial_targets === true) return false;
  if (commercialScore >= SALES_CANDIDATE_THRESHOLD) return true;
  return ["target_vessel", "unknown_gt_review"].includes(status) || commercialScore >= SALES_CANDIDATE_THRESHOLD;
}

function isExplicitlyExcluded(v = {}) {
  const status = v.commercial_relevance_status || deriveCommercialRelevance(v);
  const gt = Number(v.gt || v.grtg || v.intrlGrtg || 0);
  const threshold = Number(v.commercial_gt_threshold || 5000);
  return status === "excluded_non_commercial_type" ||
    (status === "non_target_small_vessel" && gt > 0 && gt < threshold) ||
    v.excluded_from_commercial_targets === true;
}

function isHardCandidateExcluded(v = {}) {
  const status = v.commercial_relevance_status || deriveCommercialRelevance(v);
  const score = Number(v.commercial_value_score || v.total_sales_priority_score || v.cleaning_candidate_score || 0);
  if (isDepartedRecord(v)) return true;
  return (status === "excluded_non_commercial_type" && score < SALES_CANDIDATE_THRESHOLD) ||
    v.excluded_from_commercial_targets === true ||
    isSyntheticSample(v);
}

function isSyntheticSample(v = {}) {
  const text = [v.vessel_name, v.name, v.source_name, v.data_mode, v.payload?.data_mode].filter(Boolean).join(" ").toLowerCase();
  return /sample|demo|yeosu target|mv hf zhoushan|maersk demo/.test(text);
}

function hasUsefulVesselIdentity(v = {}) {
  const name = String(v.vessel_name || v.name || "").trim();
  const port = String(v.port_name || v.port || v.port_code || "").trim();
  const identity = String(v.call_sign || v.imo || v.mmsi || v.hybrid_entity_key || v.port_call_identity || "").trim();
  if (!name && !identity) return false;
  if (/^korea$/i.test(port) && !name && !identity) return false;
  return true;
}

function exclusionReason(v = {}) {
  const status = v.commercial_relevance_status || deriveCommercialRelevance(v);
  if (status === "excluded_non_commercial_type") return "excluded_non_commercial_type";
  if (status === "non_target_small_vessel" && Number(v.gt || v.grtg || v.intrlGrtg || 0) > 0 && Number(v.gt || v.grtg || v.intrlGrtg || 0) < Number(v.commercial_gt_threshold || 5000)) return "excluded_under_5000gt";
  if (v.excluded_from_commercial_targets === true) return v.exclusion_reason || "explicitly_excluded";
  return "";
}

function commercialScore(v = {}) {
  return boundedScore(v.commercial_value_score || v.total_sales_priority_score || v.cleaning_candidate_score || 0);
}

function boundedScore(value) {
  return Math.max(0, Math.min(100, Math.round(Number(value || 0))));
}

function deriveWorkFeasibilityScore(v = {}) {
  const status = String(v.status_bucket || v.status || "").toLowerCase();
  const anchorageHours = Number(v.anchorage_hours || 0);
  const stayHours = Number(v.stay_hours || v.current_call_stay_hours || 0);
  const workWindowHours = Number(v.work_window_hours || 0);
  let score = Number(v.cleaning_window_score || 0) * 5;
  if (workWindowHours >= 12) score += 18;
  if (workWindowHours >= 24) score += 12;
  if (anchorageHours >= 24 || v.is_anchorage_waiting || status.includes("anchorage")) score += 22;
  if (stayHours >= 48 && !v.atd) score += 16;
  if (v.pilot_schedule_matched) score += 6;
  if (String(v.pilot_direction || v.movement_type || "").toLowerCase() === "outbound") score -= 12;
  if (/active|working|cargo|loading|discharging|작업|하역|진행/.test(String(v.terminal_activity || "").toLowerCase())) score -= 8;
  return boundedScore(score);
}

function deriveLeadPriorityScore(v = {}, parts = {}) {
  return boundedScore(
    Number(parts.commercialValueScore ?? commercialScore(v)) * 0.45 +
    Number(parts.contactReadinessScore ?? v.contact_readiness_score ?? deriveContactReadinessScore(v)) * 0.2 +
    Number(parts.workFeasibilityScore ?? v.work_feasibility_score ?? deriveWorkFeasibilityScore(v)) * 0.2 +
    Math.max(Number(parts.arrivalOpportunityScore ?? v.arrival_opportunity_score ?? 0), Number(v.predicted_cleaning_opportunity_score || 0)) * 0.15
  );
}

function forecastBand(score) {
  const value = Number(score || 0);
  if (value >= 75) return "high";
  if (value >= 50) return "medium";
  if (value >= 30) return "watch";
  return "low";
}

function derivePredictedCongestionScore(v = {}) {
  return boundedScore(
    Number(v.predicted_congestion || v.port_congestion_score || v.congestion_score || 0) +
    (String(v.pilot_direction || v.movement_type || "").toLowerCase() === "inbound" ? 8 : 0) -
    (String(v.pilot_direction || v.movement_type || "").toLowerCase() === "outbound" ? 8 : 0) +
    (Number(v.berth_occupancy_proxy || 0) >= 50 ? 10 : 0)
  );
}

function deriveAnchorageProbability(v = {}) {
  const type = String([v.vessel_type_group, v.vessel_type, v.commercial_segment].filter(Boolean).join(" ")).toLowerCase();
  return boundedScore(
    derivePredictedCongestionScore(v) * 0.42 +
    Math.min(25, Number(v.anchorage_hours || 0) / 2) +
    (/bulk|bulker|tanker|container|pctc|cruise|lng|lpg/.test(type) ? 12 : 4) +
    (Number(v.gt || 0) >= 30000 ? 10 : Number(v.gt || 0) >= 5000 ? 6 : 0)
  );
}

function deriveBiofoulingExposureScore(v = {}) {
  const anchorage = boundedScore(Math.min(70, Number(v.anchorage_hours || 0) * 1.2) + (v.is_anchorage_waiting ? 20 : 0));
  const idle = boundedScore(Math.min(55, Number(v.stay_hours || v.current_call_stay_hours || 0) / 2) + Math.min(35, Number(v.anchorage_hours || 0) / 2));
  return boundedScore(
    anchorage * 0.32 +
    idle * 0.24 +
    Math.min(25, Number(v.stay_hours || v.current_call_stay_hours || 0) / 4) +
    Number(v.biosecurity_exposure_score || 0) * 0.16 +
    derivePredictedCongestionScore(v) * 0.16
  );
}

function derivePredictedCleaningOpportunityScore(v = {}) {
  return boundedScore(
    commercialScore(v) * 0.28 +
    deriveAnchorageProbability(v) * 0.18 +
    (Number(v.predicted_work_window_hours || v.work_window_hours || 0) ? Math.min(100, Number(v.predicted_work_window_hours || v.work_window_hours || 0) * 3) : 0) * 0.16 +
    deriveBiofoulingExposureScore(v) * 0.18 +
    derivePredictedCongestionScore(v) * 0.14 +
    Number(v.arrival_opportunity_score || 0) * 0.06
  );
}

function deriveLeadStatus(v = {}, leadPriorityScore = deriveLeadPriorityScore(v)) {
  const existing = String(v.lead_status || "").toLowerCase();
  if (["contacted", "quoted", "scheduled", "won", "lost"].includes(existing)) return existing;
  if (leadPriorityScore >= IMMEDIATE_TARGET_THRESHOLD && (v.contact_path_available || Number(v.contact_readiness_score || 0) >= 50)) return "contact_ready";
  if (leadPriorityScore >= SALES_CANDIDATE_THRESHOLD) return "new_lead";
  return "monitor";
}

function routeRegionText(v = {}) {
  return String([v.route_region, v.destination_port, v.next_port, v.destination, v.previous_port].filter(Boolean).join(" ")).toLowerCase();
}

function highRegulationRoute(v = {}) {
  return Boolean(v.high_regulation_route) || /australia|new zealand|brazil|north_america|europe|california|vancouver|usa|canada|호주|뉴질랜드|브라질|유럽|북미/.test(routeRegionText(v));
}

function deriveSalesAngle(v = {}) {
  const type = String([v.vessel_type_group, v.vessel_type, v.commercial_segment].filter(Boolean).join(" ")).toLowerCase();
  const gt = Number(v.gt || v.grtg || v.intrlGrtg || 0);
  if (highRegulationRoute(v)) return "호주/브라질/북미/유럽 항로 컴플라이언스";
  if (Number(v.work_window_hours || 0) > 0 || (v.etd && !v.atd)) return "출항 전 작업 가능성";
  if (Number(v.anchorage_hours || 0) >= 24 || v.is_anchorage_waiting) return "체선/묘박 기반 작업 가능성";
  if (gt >= 30000 && /bulk|bulker|bulk_carrier|tanker|container|pctc|cruise/.test(type)) return "대형 벌크선 선체오염 리스크";
  return "상업 후보 선박 우선 검토";
}

function deriveWhyNow(v = {}) {
  const parts = [];
  const stayHours = Number(v.stay_hours || v.current_call_stay_hours || 0);
  const anchorageHours = Number(v.anchorage_hours || 0);
  const workWindowHours = Number(v.work_window_hours || 0);
  if (anchorageHours >= 24 || v.is_anchorage_waiting) parts.push(`묘박/대기 ${Math.round(anchorageHours)}시간`);
  if (stayHours >= 48 && !v.atd) parts.push(`체류 ${Math.round(stayHours)}시간`);
  if (workWindowHours > 0) parts.push(`출항 전 작업 가능 시간 ${Math.round(workWindowHours)}시간`);
  if (highRegulationRoute(v)) parts.push("민감 항로");
  if (Number(v.gt || v.grtg || v.intrlGrtg || 0) >= 30000) parts.push("대형 상선");
  if (v.pilot_schedule_matched) parts.push("도선 스케줄 확인");
  return parts.length
    ? `${parts.slice(0, 3).join(" · ")} 때문에 지금 영업 판단이 필요합니다.`
    : "상업 점수와 항만 체류 신호를 기준으로 모니터링이 필요합니다.";
}

function deriveCandidateSummaryKo(v = {}) {
  const pieces = [];
  if (Number(v.gt || v.grtg || v.intrlGrtg || 0) >= 50000) pieces.push("대형 상선");
  if (v.is_anchorage_waiting || Number(v.anchorage_hours || 0) >= 24) pieces.push("묘박/대기 신호");
  if (Number(v.stay_hours || v.current_call_stay_hours || 0) >= 48 && !v.atd) pieces.push("장기 체류");
  if (Number(v.predicted_cleaning_opportunity_score || 0) >= 60) pieces.push("예측 작업 기회");
  if (highRegulationRoute(v)) pieces.push("민감 항로");
  if (v.contact_path_available || v.agent_name || v.agent) pieces.push("연락 경로 확인");
  return pieces.length ? `${pieces.slice(0, 4).join(" · ")} 기반 영업 후보입니다.` : "상업 점수 기준으로 모니터링이 필요한 선박입니다.";
}

function parseDate(value) {
  if (!value) return null;
  const parsed = new Date(String(value).replace(" ", "T"));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function derivePredictionErrorHours(v = {}) {
  const predicted = parseDate(v.predicted_arrival_time);
  const actual = parseDate(v.actual_arrival_time || v.ata);
  return predicted && actual ? Math.round(Math.abs(actual.getTime() - predicted.getTime()) / 36e5 * 10) / 10 : null;
}

function isAlertCandidate(v = {}) {
  return Number(v.gt || v.grtg || v.intrlGrtg || 0) >= 50000 ||
    Number(v.anchorage_hours || 0) >= 48 ||
    commercialScore(v) >= IMMEDIATE_TARGET_THRESHOLD ||
    (String(v.pilot_direction || v.movement_type || "").toLowerCase() !== "outbound" && !v.outbound_pilot_scheduled && Number(v.predicted_cleaning_opportunity_score || 0) >= 60);
}

function deriveRecommendedNextAction(v = {}, leadPriorityScore = deriveLeadPriorityScore(v)) {
  const outboundSoon = String(v.pilot_direction || v.movement_type || "").toLowerCase() === "outbound" || (v.etd && !v.atd && Number(v.work_window_hours || 0) <= 12);
  if (!hasValue(v.agent_name || v.agent)) return "대리점 확인";
  if (!hasValue(v.operator_name || v.operator)) return "운영선사 확인";
  if (outboundSoon) return "도선/출항 전 재확인";
  if (leadPriorityScore >= IMMEDIATE_TARGET_THRESHOLD) return "견적 제안";
  return "선박 스케줄 확인";
}

function deriveLeadTimeline(v = {}) {
  return [
    { label: "ETA", value: v.eta || v.eta_candidate || null, source: v.eta_source || (v.eta_candidate ? "pilot_schedule" : "") },
    { label: "ETB", value: v.etb || v.etb_candidate || null, source: v.etb_source || (v.etb_candidate ? "berth_or_pilot_schedule" : "") },
    { label: "ETD", value: v.etd || v.etd_candidate || null, source: v.etd_source || "" },
    { label: "ATD", value: v.atd || null, source: v.atd ? "port_operation" : "" },
    { label: "도선", value: v.pilot_time || v.movement_time || null, source: v.pilot_schedule_matched ? "pilot_schedule" : "" },
    { label: "작업창", value: Number(v.work_window_hours || 0) > 0 ? `${Math.round(Number(v.work_window_hours || 0))}시간` : null, source: v.work_window_status || "" }
  ].filter(item => item.value);
}

function numericMax(...values) {
  return Math.max(0, ...values.map(value => Number(value || 0)).filter(Number.isFinite));
}

function statusHasOpenStay(v = {}) {
  const statusBucket = String(v.status_bucket || deriveStatusBucket(v) || "").toLowerCase();
  return !hasValue(v.atd) && ["arrived_staying", "berthed", "anchorage_waiting"].includes(statusBucket);
}

function waitingDurationSignal(waitingDays = 0) {
  if (waitingDays >= 10) return 40;
  if (waitingDays >= 7) return 30;
  if (waitingDays >= 5) return 20;
  if (waitingDays >= 3) return 10;
  return 0;
}

function commercialGtWeight(v = {}) {
  const gt = Number(v.gt || v.grtg || v.intrlGrtg || 0);
  if (gt >= 150000) return 1.35;
  if (gt >= 80000) return 1.25;
  if (gt >= 30000) return 1.12;
  if (gt >= 5000) return 1;
  if (gt > 0) return 0.55;
  return 0.8;
}

function commercialTypeWeight(v = {}) {
  const type = String([v.vessel_type_group, v.vessel_type, v.commercial_segment, v.vsslKndNm].filter(Boolean).join(" ")).toLowerCase();
  if (/cape|bulk|bulker|bulk_carrier|ore|vlcc|crude_tanker|product_tanker|chemical_tanker|tanker|lng|lpg|pctc|container|cruise|벌크|산물|광석|원유|유조|석유|탱커|가스|자동차|컨테이너|크루즈/.test(type)) return 1.2;
  if (/general|cargo|일반화물/.test(type)) return 0.85;
  if (/tug|fishing|workboat|patrol|dredger|예선|어선|작업선|관공선|준설/.test(type)) return 0.35;
  return 0.7;
}

function portRelevanceWeight(v = {}) {
  const code = String(v.port_code || v.prtAgCd || "");
  const name = String([v.port_name, v.port, v.port_group, v.sub_port].filter(Boolean).join(" ")).toLowerCase();
  if (["620", "820", "031", "810", "621"].includes(code) || /gwangyang|yeosu|ulsan|pyeongtaek|dangjin|pohang|daesan|광양|여수|울산|평택|당진|포항|대산/.test(name)) return 1.2;
  if (["020", "030"].includes(code) || /busan|incheon|부산|인천/.test(name)) return 1.1;
  if (["622", "070", "080", "120"].includes(code)) return 1.05;
  return 1;
}

function commercialWaitingDays(v = {}) {
  const anchorageHours = Number(v.anchorage_hours || 0);
  const stayHours = Number(v.cumulative_stay_hours || v.stay_hours || v.current_call_stay_hours || 0);
  return Math.max(anchorageHours, stayHours) / 24;
}

function deriveCongestionScore(v = {}) {
  const anchorageHours = Number(v.anchorage_hours || 0);
  const stayHours = Number(v.cumulative_stay_hours || v.stay_hours || v.current_call_stay_hours || 0);
  const waitingDays = Math.max(anchorageHours, stayHours) / 24;
  const durationSignal = waitingDurationSignal(waitingDays);
  const combinedSignal = durationSignal * commercialGtWeight(v) * commercialTypeWeight(v) * portRelevanceWeight(v);
  const externalPortSignal = Math.min(15, Number(v.port_congestion_score || 0) * 0.15);
  const densitySignal = Math.min(10, Number(v.anchorage_density_score || 0) * 0.1);
  return Math.min(100, Math.round(Math.max(0, combinedSignal + externalPortSignal + densitySignal)));
}

function deriveBiofoulingProxyScore(v = {}, congestionScore = deriveCongestionScore(v), fallback = 0) {
  const gt = Number(v.gt || v.grtg || v.intrlGrtg || 0);
  const type = String([v.vessel_type_group, v.vessel_type, v.vsslKndNm].filter(Boolean).join(" ")).toLowerCase();
  const stayHours = Number(v.cumulative_stay_hours || v.stay_hours || v.current_call_stay_hours || 0);
  const anchorageHours = Number(v.anchorage_hours || 0);
  const routeScore = numericMax(v.biosecurity_exposure_score, v.high_regulation_route ? 20 : 0);
  let score = numericMax(v.biofouling_risk_score, v.biofouling_score, fallback);
  score = Math.max(score, Math.round(
    Math.min(24, stayHours / 24 * 2.2) +
    Math.min(24, anchorageHours / 24 * 3) +
    Math.min(12, congestionScore * 0.12) +
    (/bulk|tanker|container|pctc|cruise|lng|lpg|벌크|탱커|컨테이너|자동차|크루즈/.test(type) ? 12 : 0) +
    (gt >= 5000 ? 8 : 0) +
    Math.min(12, routeScore / 8)
  ));
  return Math.min(100, Math.round(score));
}

function derivePerformanceProxyScore(v = {}, congestionScore = deriveCongestionScore(v)) {
  const gt = Number(v.gt || v.grtg || v.intrlGrtg || 0);
  const type = String([v.vessel_type_group, v.vessel_type, v.commercial_segment].filter(Boolean).join(" ")).toLowerCase();
  const stayHours = Number(v.cumulative_stay_hours || v.stay_hours || v.current_call_stay_hours || 0);
  const anchorageHours = Number(v.anchorage_hours || 0);
  let score = numericMax(v.performance_proxy_score);
  score = Math.max(score, Math.round(
    Math.min(16, congestionScore * 0.16) +
    Math.min(16, stayHours / 24 * 1.8) +
    Math.min(14, anchorageHours / 24 * 2.5) +
    (gt >= 30000 ? 14 : gt >= 5000 ? 8 : 0) +
    (/bulk|tanker|container|pctc|cruise|lng|lpg/.test(type) ? 10 : 0) +
    Math.min(10, Number(v.fuel_efficiency_sensitivity_score || 0) / 10)
  ));
  return Math.min(100, Math.round(score));
}

function deriveCiiProxyScore(v = {}, congestionScore = deriveCongestionScore(v), performanceScore = derivePerformanceProxyScore(v, congestionScore)) {
  const gt = Number(v.gt || v.grtg || v.intrlGrtg || 0);
  const type = String([v.vessel_type_group, v.vessel_type, v.commercial_segment].filter(Boolean).join(" ")).toLowerCase();
  let score = numericMax(v.cii_pressure_score, v.compliance_pressure_score);
  score = Math.max(score, Math.round(
    Math.min(25, performanceScore * 0.25) +
    Math.min(18, congestionScore * 0.18) +
    (gt >= 5000 ? 18 : 0) +
    (/bulk|tanker|container|pctc|cruise|lng|lpg/.test(type) ? 10 : 0) +
    Math.min(20, numericMax(v.esg_sensitivity_score, v.fuel_efficiency_sensitivity_score) / 5)
  ));
  return Math.min(100, Math.round(score));
}

function deriveCommercialProxyScore(v = {}, scores = {}) {
  const gt = Number(v.gt || v.grtg || v.intrlGrtg || 0);
  const type = String([v.vessel_type_group, v.vessel_type, v.commercial_segment].filter(Boolean).join(" ")).toLowerCase();
  const gtValue = gt >= 150000 ? 10 : gt >= 80000 ? 8 : gt >= 30000 ? 5 : gt >= 5000 ? 2 : 0;
  const typeValue = /lng|lpg/.test(type) ? 4 : /bulk|tanker|container|pctc|cruise/.test(type) ? 5 : /general|cargo|일반화물/.test(type) ? 2 : 0;
  const workFeasibility = Math.min(20, Number(v.work_feasibility_score || 0) * 0.2 + Number(v.cleaning_window_score || 0));
  const dataAssist = Math.min(10, Number(v.vessel_basic_info_completeness_score || v.data_confidence_score || 0) / 10);
  return Math.min(100, Math.round(
    Math.min(20, gtValue + typeValue) +
    workFeasibility +
    Number(scores.biofoulingRiskScore || 0) * 0.15 +
    Number(scores.congestionScore || 0) * 0.10 +
    Number(scores.performanceProxyScore || 0) * 0.10 +
    Number(scores.ciiPressureScore || 0) * 0.10 +
    Math.min(10, Number(v.biosecurity_exposure_score || 0) / 10) +
    Math.min(5, deriveSalesAccessibilityScore(v) + (v.agent || v.operator ? 1 : 0)) +
    dataAssist
  ));
}

function isSalesCandidate(v = {}) {
  return !isSyntheticSample(v) &&
    !isDepartedRecord(v) &&
    v.excluded_from_commercial_targets !== true &&
    hasUsefulVesselIdentity(v) &&
    commercialScore(v) >= SALES_CANDIDATE_THRESHOLD &&
    withinCommercialPercentile(v, 20);
}

function isCurrentActionableCandidate(v = {}) {
  const status = String(v.status_bucket || v.operational_status || v.status || "").toLowerCase();
  if (status === "departed") return false;
  return ["arrived_staying", "berthed", "anchorage_waiting"].includes(status) ||
    Boolean(v.is_anchorage_waiting) ||
    Number(v.anchorage_hours || 0) > 0 ||
    Number(v.stay_hours || v.current_call_stay_hours || v.cumulative_stay_hours || 0) > 0 ||
    Number(v.work_window_hours || 0) > 0;
}

function hasCurrentOrNearTermWorkFeasibility(v = {}) {
  return Number(v.work_feasibility_score || 0) >= 25 ||
    Number(v.cleaning_window_score || 0) >= 12 ||
    Number(v.work_window_hours || 0) > 0 ||
    isCurrentActionableCandidate(v);
}

function isImmediateTarget(v = {}) {
  return !isSyntheticSample(v) &&
    !isDepartedRecord(v) &&
    v.excluded_from_commercial_targets !== true &&
    hasUsefulVesselIdentity(v) &&
    commercialScore(v) >= IMMEDIATE_TARGET_THRESHOLD &&
    withinCommercialPercentile(v, 10) &&
    hasCurrentOrNearTermWorkFeasibility(v);
}

function isWatchlistVessel(v = {}) {
  return !isSyntheticSample(v) &&
    !isDepartedRecord(v) &&
    v.excluded_from_commercial_targets !== true &&
    hasUsefulVesselIdentity(v) &&
    (commercialScore(v) >= 50 || withinCommercialPercentile(v, 40));
}

function supabaseBase(env) {
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return { url: url.replace(/\/$/, ""), key, keyType: env.SUPABASE_SERVICE_ROLE_KEY ? "service_role" : "anon" };
}

async function supabaseGet(env, path) {
  const base = supabaseBase(env);
  if (!base) {
    return { ok: false, status: 0, rows: [], error: "missing_supabase_binding", keyType: "missing" };
  }
  const res = await fetch(`${base.url}${path}`, {
    headers: { apikey: base.key, authorization: `Bearer ${base.key}`, accept: "application/json" }
  });
  if (!res.ok) {
    let detail = "";
    try {
      detail = await res.text();
    } catch {
      detail = "";
    }
    return { ok: false, status: res.status, rows: [], error: `supabase_http_${res.status}`, detail: detail.slice(0, 240), keyType: base.keyType };
  }
  const rows = await res.json();
  return { ok: true, status: res.status, rows: Array.isArray(rows) ? rows : [], error: null, keyType: base.keyType };
}

async function fetchActivePointer(env) {
  const base = supabaseBase(env);
  if (!base) return { configured: false, active_run_id: null, error: "missing_supabase_binding", auth_key_type: "missing" };

  const diagnostics = [];
  const active = await supabaseGet(env, "/rest/v1/active_dataset_pointer?select=*&id=eq.current&limit=1");
  diagnostics.push({ source: "active_dataset_pointer", ok: active.ok, status: active.status, row_count: active.rows.length, error: active.error });
  const pointer = active.rows[0] || null;
  if (pointer?.active_run_id) {
    return { configured: true, ...pointer, auth_key_type: base.keyType, pointer_source: "active_dataset_pointer", pointer_diagnostics: diagnostics, error: null };
  }

  const promoted = await supabaseGet(env, "/rest/v1/data_collection_runs?select=run_id,promoted_at,finished_at,status,total_rows,all_vessels_count,candidates_count,immediate_targets_count&status=eq.promoted&order=promoted_at.desc.nullslast&order=finished_at.desc.nullslast&limit=1");
  diagnostics.push({ source: "latest_promoted_run", ok: promoted.ok, status: promoted.status, row_count: promoted.rows.length, error: promoted.error });
  const run = promoted.rows[0] || null;
  if (run?.run_id) {
    return {
      configured: true,
      active_run_id: run.run_id,
      active_collected_at: run.finished_at || null,
      promoted_at: run.promoted_at || null,
      is_stale: false,
      auth_key_type: base.keyType,
      pointer_source: "latest_promoted_run",
      pointer_diagnostics: diagnostics,
      fallback_pointer: true,
      error: null
    };
  }

  const latestRun = await supabaseGet(env, "/rest/v1/vessel_snapshots?select=run_id,collected_at&run_id=not.is.null&order=collected_at.desc&limit=1");
  diagnostics.push({ source: "latest_snapshot_run", ok: latestRun.ok, status: latestRun.status, row_count: latestRun.rows.length, error: latestRun.error });
  const snapshotRun = latestRun.rows[0] || null;
  if (snapshotRun?.run_id) {
    return {
      configured: true,
      active_run_id: snapshotRun.run_id,
      active_collected_at: snapshotRun.collected_at || null,
      promoted_at: null,
      is_stale: true,
      auth_key_type: base.keyType,
      pointer_source: "latest_snapshot_run",
      pointer_diagnostics: diagnostics,
      fallback_pointer: true,
      error: null
    };
  }

  const legacy = await supabaseGet(env, "/rest/v1/vessel_snapshots?select=collected_at&order=collected_at.desc&limit=1");
  diagnostics.push({ source: "legacy_latest_snapshots", ok: legacy.ok, status: legacy.status, row_count: legacy.rows.length, error: legacy.error });
  if (legacy.rows.length) {
    return {
      configured: true,
      active_run_id: null,
      active_collected_at: legacy.rows[0]?.collected_at || null,
      promoted_at: null,
      is_stale: true,
      auth_key_type: base.keyType,
      legacy_latest: true,
      pointer_source: "legacy_latest_snapshots",
      pointer_diagnostics: diagnostics,
      fallback_pointer: true,
      error: null
    };
  }

  return {
    configured: true,
    active_run_id: null,
    error: active.error || promoted.error || latestRun.error || legacy.error || "missing_active_dataset",
    pointer_source: "none",
    auth_key_type: base.keyType,
    pointer_diagnostics: diagnostics
  };
}

async function fetchSupabaseRows(env) {
  if (!supabaseBase(env)) return { rows: [], configured: false, error: "missing_supabase_binding" };
  const pointer = await fetchActivePointer(env);
  if (!pointer.active_run_id && !pointer.legacy_latest) return { rows: [], configured: pointer.configured, error: pointer.error || "missing_active_dataset", pointer };

  const query = pointer.legacy_latest
    ? "/rest/v1/vessel_snapshots?select=*&order=collected_at.desc&limit=5000"
    : `/rest/v1/vessel_snapshots?select=*&run_id=eq.${encodeURIComponent(pointer.active_run_id)}&order=collected_at.desc&limit=5000`;
  const response = await supabaseGet(env, query);
  if (response.ok && response.rows.length) {
    return { rows: response.rows.map(normalizeSnapshot).map(enrichCumulativeStay), configured: true, error: null, pointer };
  }

  if (!pointer.legacy_latest) {
    const fallback = await supabaseGet(env, "/rest/v1/vessel_snapshots?select=*&order=collected_at.desc&limit=5000");
    const fallbackPointer = {
      ...pointer,
      legacy_latest: true,
      is_stale: true,
      fallback_pointer: true,
      pointer_source: "legacy_latest_snapshots_after_empty_active",
      active_dataset_empty: response.ok && response.rows.length === 0,
      active_dataset_error: response.ok ? null : response.error
    };
    if (fallback.ok && fallback.rows.length) {
      return { rows: fallback.rows.map(normalizeSnapshot).map(enrichCumulativeStay), configured: true, error: null, pointer: fallbackPointer };
    }
    return { rows: [], configured: true, error: response.error || fallback.error || "empty_active_dataset", pointer: fallbackPointer };
  }

  if (!response.ok) return { rows: [], configured: true, error: response.error, pointer };
  return { rows: [], configured: true, error: "empty_active_dataset", pointer };
}

function isBetterSnapshotRepresentative(next = {}, current = {}) {
  return commercialScore(next) > commercialScore(current) ||
    (commercialScore(next) === commercialScore(current) && deriveCongestionScore(next) > deriveCongestionScore(current)) ||
    (commercialScore(next) === commercialScore(current) && deriveCongestionScore(next) === deriveCongestionScore(current) && Number(next.data_confidence_score || 0) > Number(current.data_confidence_score || 0)) ||
    (commercialScore(next) === commercialScore(current) && deriveCongestionScore(next) === deriveCongestionScore(current) && Number(next.data_confidence_score || 0) === Number(current.data_confidence_score || 0) && candidateTimestamp(next) > candidateTimestamp(current));
}

function snapshotRepresentativeKey(record = {}, index = 0) {
  const portCode = String(record.port_code || portCodeFromName(record.port || record.port_name) || "");
  if (hasValue(record.port_call_identity)) return `PORTCALL|${portCode}|${record.port_call_identity}`;
  if (hasValue(record.snapshot_id)) return `SNAPSHOT|${record.snapshot_id}`;
  if (hasValue(record.master_vessel_id) && hasValue(record.ata || record.eta || record.etryptYear || record.etryptCo)) {
    return `MASTER_TIME|${record.master_vessel_id}|${portCode}|${record.ata || record.eta || record.etryptYear || ""}|${record.etryptCo || ""}`;
  }
  if (hasValue(record.call_sign) && hasValue(record.etryptYear || record.etryptCo)) {
    return `CALL_PORTCALL|${record.call_sign}|${portCode}|${record.etryptYear || ""}|${record.etryptCo || ""}`;
  }
  const normalizedName = String(record.normalized_vessel_name || record.vessel_name || record.name || "")
    .normalize("NFKC")
    .toUpperCase()
    .replace(/[^A-Z0-9가-힣]+/g, "");
  const time = record.ata || record.eta || record.atd || record.etd || record.collected_at || index;
  return `NAME_PORT_TIME|${normalizedName || record.hybrid_entity_key || record.vessel_id || `ROW-${index}`}|${portCode}|${time}`;
}

function latestPerVesselPort(records) {
  const byKey = new Map();
  records.forEach((record, index) => {
    const key = snapshotRepresentativeKey(record, index);
    const old = byKey.get(key);
    if (!old || isBetterSnapshotRepresentative(record, old)) byKey.set(key, record);
  });
  return [...byKey.values()];
}

function buildHot(records) {
  return sortCommercialPriority(records)
    .filter(v => v.actionable_source_row !== false && isMainCommercialVessel(v) && (isSalesCandidate(v) || v.is_cleaning_candidate || ["arrived_staying", "berthed", "anchorage_waiting", "arriving_soon"].includes(v.status_bucket) || (v.biofouling_score || 0) >= 65 || (v.operational_risk_score || 0) >= 60))
    .slice(0, 40);
}

function buildPortHeatmap(records) {
  const map = new Map();
  for (const v of records) {
    const port = v.port || "Korea";
    const p = map.get(port) || { port, port_code: v.port_code || portCodeFromName(port), total: 0, waiting: 0, anchorage_vessels: 0, long_stay: 0, long_idle_vessels: 0, high_biofouling: 0, immediate: 0, score: 0, waiting_hours_total: 0, berth_hours_total: 0 };
    p.total += 1;
    if (v.is_anchorage_waiting || (v.anchorage_hours || 0) >= 12 || /waiting|anchorage|anchor|idle|drifting/i.test(v.status || "")) {
      p.waiting += 1;
      p.anchorage_vessels += 1;
    }
    if (v.is_long_idle || (v.stay_hours || 0) >= 168) {
      p.long_stay += 1;
      p.long_idle_vessels += 1;
    }
    if ((v.biofouling_score || 0) >= 70) p.high_biofouling += 1;
    if (v.is_immediate_candidate) p.immediate += 1;
    p.waiting_hours_total += Number(v.anchorage_hours || 0);
    p.berth_hours_total += Number(v.berth_hours || 0);
    p.score += v.port_congestion_score || v.operational_risk_score || v.biofouling_score || 0;
    map.set(port, p);
  }
  return [...map.values()].map(p => ({
    ...p,
    average_waiting_time: p.waiting ? Math.round((p.waiting_hours_total / p.waiting) * 10) / 10 : 0,
    berth_occupancy: p.total ? Math.min(100, Math.round((p.berth_hours_total / Math.max(1, p.total * 24)) * 100)) : 0,
    anchorage_density: p.total ? Math.min(100, Math.round((p.anchorage_vessels / p.total) * 100)) : 0,
    congestion_score: p.total ? Math.min(100, Math.round(p.score / p.total + p.waiting * 4 + p.long_stay * 5 + p.immediate * 8)) : 0
  })).sort((a, b) => b.congestion_score - a.congestion_score);
}

function buildBioTimeline(records) {
  const buckets = [
    { key: "0_3d", label: "0-3 days", min: 0, max: 72 },
    { key: "3_7d", label: "3-7 days", min: 72, max: 168 },
    { key: "7_14d", label: "7-14 days", min: 168, max: 336 },
    { key: "14_21d", label: "14-21 days", min: 336, max: 504 },
    { key: "21_30d", label: "21-30 days", min: 504, max: 720 },
    { key: "30_90d", label: "30-90 days", min: 720, max: 2160 },
    { key: "90d_plus", label: "90+ days", min: 2160, max: Infinity }
  ];
  return buckets.map(bucket => {
    const rows = records.filter(v => (v.stay_hours || 0) >= bucket.min && (v.stay_hours || 0) < bucket.max);
    return {
      ...bucket,
      count: rows.length,
      high_biofouling: rows.filter(v => (v.biofouling_score || 0) >= 70).length,
      immediate: rows.filter(v => v.is_immediate_candidate).length,
      avg_biofouling_score: rows.length ? Math.round(rows.reduce((sum, v) => sum + (v.biofouling_score || 0), 0) / rows.length) : 0
    };
  });
}

function buildCommandCenter(records) {
  const hot = buildHot(records);
  return {
    generated_at: new Date().toISOString(),
    focus_question: "Which vessel should HullWiper Korea contact now, and why?",
    hot_count: hot.length,
    full_count: records.length,
    immediate_targets: sortCommercialPriority(records).filter(isImmediateTarget).slice(0, 8),
    operational_risk_queue: sortCommercialPriority(records)
      .filter(v => (v.operational_risk_flags || []).length || (v.operational_risk_score || 0) >= 60)
      .slice(0, 12),
    high_value_targets: buildHighValueTargets(records).slice(0, 12),
    imo_recovery_board: buildUnknownImo(records).slice(0, 12),
    operating_rule: "Worker reads Supabase snapshots at request time; GitHub main is no longer mutated by generated JSON commits."
  };
}

function buildUnknownImo(records) {
  return records.filter(v => !v.imo || v.imo_status !== "present")
    .slice()
    .sort((a, b) =>
      (b.imo_recovery_score || 0) - (a.imo_recovery_score || 0) ||
      (b.gt || 0) - (a.gt || 0) ||
      (b.stay_hours || 0) - (a.stay_hours || 0) ||
      (b.total_sales_priority_score || 0) - (a.total_sales_priority_score || 0)
    )
    .map(v => ({
      vessel_name: v.vessel_name,
      port_code: v.port_code || portCodeFromName(v.port),
      port_name: v.port_name || v.port,
      call_sign: v.call_sign || "",
      mmsi: v.mmsi || "",
      gt: v.gt || 0,
      vessel_type: v.vessel_type || "",
      vessel_type_group: v.vessel_type_group || "",
      stay_hours: v.stay_hours || 0,
      anchorage_hours: v.anchorage_hours || 0,
      is_anchorage_waiting: Boolean(v.is_anchorage_waiting),
      hybrid_entity_key: v.hybrid_entity_key,
      master_vessel_id: v.master_vessel_id || v.hybrid_entity_key,
      confidence_band: (v.imo_recovery_score || 0) >= 80 ? "urgent" : (v.imo_recovery_score || 0) >= 60 ? "high" : (v.gt || 0) >= 5000 ? "probable" : "unresolved",
      priority: v.imo_recovery_priority || "review",
      imo_recovery_score: v.imo_recovery_score || 0,
      score: v.total_sales_priority_score || 0,
      reason_codes: v.reason_codes || []
    }));
}

function buildImoRecoveryKpis(records = []) {
  const target = records.filter(isMainCommercialVessel);
  const highValue = target.filter(v => (v.commercial_value_score || v.total_sales_priority_score || 0) >= 35 || Number(v.gt || 0) >= 5000 || v.is_anchorage_waiting);
  return {
    total_vessels: records.length,
    target_vessels: target.length,
    imo_coverage: coverageRatio(target, v => hasValue(v.imo)),
    high_value_imo_coverage: coverageRatio(highValue, v => hasValue(v.imo)),
    recovered_imo_count: records.filter(v => v.imo_recovered_from_seed || v.vessel_master_seed_match && v.imo).length,
    unresolved_high_value_count: highValue.filter(v => !v.imo).length
  };
}

function buildHighValueTargets(records) {
  return sortCommercialPriority(records)
    .filter(v => v.high_value_target || (Number(v.gt || 0) >= 30000 && /bulk|bulk_carrier|tanker|pctc/.test(String(v.vessel_type_group || v.vessel_type || "").toLowerCase())))
    .map(v => ({
      vessel_name: v.vessel_name,
      port: v.port,
      port_code: v.port_code || portCodeFromName(v.port),
      gt: v.gt,
      vessel_type: v.vessel_type,
      vessel_type_group: v.vessel_type_group,
      berth_class: v.berth_class || null,
      anchorage_name: v.anchorage_name || null,
      stay_hours: v.stay_hours || 0,
      anchorage_hours: v.anchorage_hours || 0,
      is_anchorage_waiting: Boolean(v.is_anchorage_waiting),
      total_sales_priority_score: v.total_sales_priority_score || 0,
      commercial_signal_strength: v.commercial_signal_strength || 0,
      reason_codes: v.reason_codes || []
    }));
}

function buildUnknownGtReview(records) {
  return sortCommercialPriority(records)
    .filter(v => v.gt_status === "unknown_gt_review" && v.commercial_relevance_status === "unknown_gt_review")
    .map(v => ({
      vessel_name: v.vessel_name,
      port: v.port,
      port_code: v.port_code || portCodeFromName(v.port),
      call_sign: v.call_sign || "",
      vessel_type: v.vessel_type,
      vessel_type_group: v.vessel_type_group,
      status_bucket: v.status_bucket,
      berth_name: v.berth_name || v.berth || "",
      anchorage_name: v.anchorage_name || "",
      commercial_value_score: v.commercial_value_score || 0,
      data_confidence_score: v.data_confidence_score || 0,
      reason_codes: v.reason_codes || []
    }));
}

function buildHighValueLowConfidence(records) {
  return sortCommercialPriority(records)
    .filter(v => (v.commercial_value_score || 0) >= 35 && ((v.data_confidence_score || 0) < 60 || !v.imo))
    .map(v => ({
      vessel_name: v.vessel_name,
      port: v.port,
      port_code: v.port_code || portCodeFromName(v.port),
      gt: v.gt,
      imo: v.imo || "",
      call_sign: v.call_sign || "",
      vessel_type: v.vessel_type,
      vessel_type_group: v.vessel_type_group,
      commercial_value_score: v.commercial_value_score || 0,
      commercial_value_band: v.commercial_value_band,
      data_confidence_score: v.data_confidence_score || 0,
      data_confidence_band: v.data_confidence_band,
      reason_codes: v.reason_codes || []
    }));
}

function coverageRatio(records = [], predicate = () => false) {
  if (!records.length) return 0;
  return Math.round((records.filter(predicate).length / records.length) * 100);
}

function buildBasicInfoCoverage(records = []) {
  return {
    generated_at: new Date().toISOString(),
    total_vessels: records.length,
    average_completeness_score: records.length ? Math.round(records.reduce((sum, v) => sum + Number(v.vessel_basic_info_completeness_score || basicInfoCompleteness(v)), 0) / records.length) : 0,
    vessel_name_coverage: coverageRatio(records, v => hasValue(v.vessel_name)),
    call_sign_coverage: coverageRatio(records, v => hasValue(v.call_sign)),
    gt_coverage: coverageRatio(records, v => hasValue(v.gt)),
    vessel_type_coverage: coverageRatio(records, v => hasValue(v.vessel_type_group) && v.vessel_type_group !== "unknown"),
    imo_coverage: coverageRatio(records, v => hasValue(v.imo)),
    mmsi_coverage: coverageRatio(records, v => hasValue(v.mmsi)),
    operator_coverage: coverageRatio(records, v => hasValue(v.operator)),
    agent_coverage: coverageRatio(records, v => hasValue(v.agent)),
    loa_beam_coverage: coverageRatio(records, v => hasValue(v.loa) && hasValue(v.beam)),
    dwt_coverage: coverageRatio(records, v => hasValue(v.dwt)),
    prioritized_vessel_spec_enrichment_count: records.filter(v => v.vessel_spec_enrichment_priority).length,
    field_weights: BASIC_INFO_FIELDS
  };
}

function buildBasicInfoMissing(records = []) {
  return sortCommercialPriority(records)
    .filter(v => isMainCommercialVessel(v) && ((v.vessel_basic_info_completeness_score || basicInfoCompleteness(v)) < 75 || v.vessel_spec_enrichment_priority))
    .map(v => ({
      vessel_name: v.vessel_name,
      normalized_vessel_name: v.normalized_vessel_name,
      port: v.port,
      port_code: v.port_code,
      gt: v.gt,
      call_sign: v.call_sign || "",
      imo: v.imo || "",
      mmsi: v.mmsi || "",
      vessel_type: v.vessel_type,
      vessel_type_group: v.vessel_type_group,
      commercial_value_score: v.commercial_value_score || 0,
      vessel_basic_info_completeness_score: v.vessel_basic_info_completeness_score || basicInfoCompleteness(v),
      missing_fields: v.vessel_basic_info_missing_fields || BASIC_INFO_FIELDS.filter(field => !hasValue(v[field])),
      vessel_spec_enrichment_priority: Boolean(v.vessel_spec_enrichment_priority),
      reason_codes: v.reason_codes || []
    }));
}

function buildCongestionWatchlist(records) {
  return sortCommercialPriority(records)
    .filter(v => v.is_anchorage_waiting || v.congestion_exposed_target || (v.congestion_exposure_score || 0) >= 12 || (v.anchorage_hours || 0) >= 12)
    .map(v => ({
      vessel_name: v.vessel_name,
      port: v.port,
      port_code: v.port_code || portCodeFromName(v.port),
      gt: v.gt,
      vessel_type: v.vessel_type,
      berth_class: v.berth_class || "",
      anchorage_name: v.anchorage_name || "",
      anchorage_hours: v.anchorage_hours || 0,
      estimated_waiting_time: v.estimated_waiting_time || 0,
      congestion_exposure_score: v.congestion_exposure_score || 0,
      port_congestion_score: v.port_congestion_score || 0,
      commercial_value_score: v.commercial_value_score || 0,
      reason_codes: v.reason_codes || []
    }));
}

function buildPredictedArrivals(records = []) {
  return sortCommercialPriority(records
    .filter(v => v.predicted_arrival_pipeline || v.predicted_arrival_time || Number(v.arrival_opportunity_score || 0) >= 35 || v.status_bucket === "arriving_soon"))
    .sort((a, b) =>
      Number(b.arrival_opportunity_score || 0) - Number(a.arrival_opportunity_score || 0) ||
      Number(b.arrival_prediction_confidence || 0) - Number(a.arrival_prediction_confidence || 0) ||
      commercialScore(b) - commercialScore(a)
    )
    .map(v => ({
      vessel_name: v.vessel_name,
      normalized_vessel_name: v.normalized_vessel_name || "",
      port_code: v.port_code || portCodeFromName(v.port),
      port_name: v.port_name || v.port,
      previous_port: v.previous_port || "",
      next_port: v.next_port || "",
      destination_port: v.destination_port || v.destination || v.next_port || "",
      route_region: v.route_region || "unknown",
      route_from_port: v.route_from_port || v.previous_port || "",
      route_to_port: v.route_to_port || v.destination_port || v.destination || v.next_port || "",
      vessel_type: v.vessel_type || "",
      vessel_type_group: v.vessel_type_group || "",
      gt: v.gt || 0,
      eta: v.eta || v.eta_candidate || "",
      predicted_arrival_time: v.predicted_arrival_time || v.eta || v.eta_candidate || "",
      arrival_prediction_confidence: Number(v.arrival_prediction_confidence || 0),
      arrival_opportunity_score: Number(v.arrival_opportunity_score || 0),
      predicted_congestion: Number(v.predicted_congestion || 0),
      predicted_cleaning_window: Number(v.predicted_cleaning_window || 0),
      predicted_congestion_score: Number(v.predicted_congestion_score || 0),
      congestion_forecast_band: v.congestion_forecast_band || "low",
      anchorage_probability: Number(v.anchorage_probability || 0),
      predicted_work_window_hours: Number(v.predicted_work_window_hours || 0),
      work_window_confidence: Number(v.work_window_confidence || 0),
      repeat_caller_score: Number(v.repeat_caller_score || 0),
      repeat_operator_score: Number(v.repeat_operator_score || 0),
      biofouling_exposure_score: Number(v.biofouling_exposure_score || 0),
      predicted_cleaning_opportunity_score: Number(v.predicted_cleaning_opportunity_score || 0),
      predicted_arrival_window_hours: Number(v.predicted_arrival_window_hours || 0),
      arrival_prediction_source: v.arrival_prediction_source || "",
      route_pattern_known: Boolean(v.route_pattern_known),
      route_pattern_confidence: Number(v.route_pattern_confidence || 0),
      commercial_value_score: commercialScore(v),
      reason_codes: v.reason_codes || []
    }));
}

function buildLeadPipeline(records = []) {
  return sortCommercialPriority(dedupeCandidateRows(records
    .filter(isMainCommercialVessel)
    .map(v => {
      const leadPriorityScore = Number(v.lead_priority_score || deriveLeadPriorityScore(v));
      return {
        ...v,
        work_feasibility_score: Number(v.work_feasibility_score || deriveWorkFeasibilityScore(v)),
        lead_priority_score: leadPriorityScore,
        lead_status: v.lead_status || deriveLeadStatus(v, leadPriorityScore),
        why_now: v.why_now || deriveWhyNow(v),
        candidate_summary_ko: v.candidate_summary_ko || deriveCandidateSummaryKo(v),
        sales_angle: v.sales_angle || deriveSalesAngle(v),
        recommended_next_action: v.recommended_next_action || deriveRecommendedNextAction(v, leadPriorityScore),
        lead_timeline: Array.isArray(v.lead_timeline) ? v.lead_timeline : deriveLeadTimeline(v)
      };
    })
    .filter(v => Number(v.lead_priority_score || 0) >= 35 || commercialScore(v) >= SALES_CANDIDATE_THRESHOLD || Number(v.arrival_opportunity_score || 0) >= 35)))
    .sort((a, b) =>
      Number(b.lead_priority_score || 0) - Number(a.lead_priority_score || 0) ||
      commercialScore(b) - commercialScore(a) ||
      Number(b.work_feasibility_score || 0) - Number(a.work_feasibility_score || 0) ||
      Number(b.contact_readiness_score || 0) - Number(a.contact_readiness_score || 0)
    )
    .map(v => ({
      vessel_name: v.vessel_name,
      port: v.port,
      port_code: v.port_code || portCodeFromName(v.port),
      port_name: v.port_name || v.port,
      berth_name: v.berth_name || v.berth || "",
      anchorage_name: v.anchorage_name || v.anchorage_zone || "",
      operator_name: v.operator_name || v.operator || "",
      agent_name: v.agent_name || v.agent || "",
      gt: v.gt,
      vessel_type: v.vessel_type,
      vessel_type_group: v.vessel_type_group,
      commercial_value_score: commercialScore(v),
      contact_readiness_score: Number(v.contact_readiness_score || 0),
      work_feasibility_score: Number(v.work_feasibility_score || 0),
      arrival_opportunity_score: Number(v.arrival_opportunity_score || 0),
      predicted_cleaning_opportunity_score: Number(v.predicted_cleaning_opportunity_score || 0),
      anchorage_probability: Number(v.anchorage_probability || 0),
      predicted_congestion_score: Number(v.predicted_congestion_score || 0),
      congestion_forecast_band: v.congestion_forecast_band || "low",
      predicted_work_window_hours: Number(v.predicted_work_window_hours || 0),
      work_window_confidence: Number(v.work_window_confidence || 0),
      biofouling_exposure_score: Number(v.biofouling_exposure_score || 0),
      repeat_caller_score: Number(v.repeat_caller_score || 0),
      repeat_operator_score: Number(v.repeat_operator_score || 0),
      lead_priority_score: Number(v.lead_priority_score || 0),
      lead_status: v.lead_status || "monitor",
      why_now: v.why_now || "",
      candidate_summary_ko: v.candidate_summary_ko || "",
      sales_angle: v.sales_angle || "",
      recommended_next_action: v.recommended_next_action || "",
      recommended_action: v.recommended_action || v.recommended_next_action || "",
      lead_timeline: v.lead_timeline || [],
      last_contacted_at: v.last_contacted_at || "",
      follow_up_due: v.follow_up_due || "",
      quote_status: v.quote_status || "not_started",
      notes: v.notes || "",
      actual_arrival_time: v.actual_arrival_time || v.ata || "",
      prediction_error_hours: v.prediction_error_hours ?? null,
      alert_candidate: Boolean(v.alert_candidate),
      information_enrichment_needed: Boolean(v.information_enrichment_needed),
      eta: v.eta || v.eta_candidate || "",
      etb: v.etb || v.etb_candidate || "",
      etd: v.etd || v.etd_candidate || "",
      atd: v.atd || "",
      pilot_time: v.pilot_time || v.movement_time || "",
      work_window_hours: Number(v.work_window_hours || 0),
      reason_codes: v.reason_codes || []
    }));
}

function buildAlertCandidates(records = []) {
  return sortCommercialPriority(dedupeCandidateRows(records.filter(isAlertCandidate)))
    .slice(0, 100)
    .map(v => ({
      vessel_name: v.vessel_name,
      port: v.port,
      port_code: v.port_code,
      gt: v.gt,
      anchorage_hours: v.anchorage_hours || 0,
      commercial_value_score: commercialScore(v),
      predicted_cleaning_opportunity_score: Number(v.predicted_cleaning_opportunity_score || 0),
      outbound_pilot_scheduled: Boolean(v.outbound_pilot_scheduled),
      why_now: v.why_now || deriveWhyNow(v),
      candidate_summary_ko: v.candidate_summary_ko || deriveCandidateSummaryKo(v),
      recommended_action: v.recommended_action || v.recommended_next_action || deriveRecommendedNextAction(v),
      information_enrichment_needed: Boolean(v.information_enrichment_needed),
      reason_codes: v.reason_codes || []
    }));
}

function pageRows(records = [], searchParams = new URLSearchParams()) {
  const page = Math.max(1, Number(searchParams.get("page") || 1));
  const pageSize = Math.min(200, Math.max(1, Number(searchParams.get("pageSize") || searchParams.get("limit") || 50)));
  const sortKey = String(searchParams.get("sort") || "commercial");
  const sortDir = String(searchParams.get("dir") || "desc") === "asc" ? "asc" : "desc";
  const value = (v = {}) => ({
    vessel: String(v.vessel_name || v.normalized_vessel_name || ""),
    port: String(v.port_name || v.port || ""),
    gt: Number(v.gt || v.grtg || v.intrlGrtg || 0),
    type: String(v.vessel_type_group || v.vessel_type || v.vsslKndNm || ""),
    eta: Date.parse(v.ata || v.eta || "") || 0,
    etd: Date.parse(v.atd || v.etd || "") || 0,
    stay: Number(v.stay_hours || v.current_call_stay_hours || v.cumulative_stay_hours || 0),
    anchorage: Number(v.anchorage_hours || 0),
    commercial: commercialScore(v),
    confidence: Number(v.data_confidence_score || 0),
    congestion: deriveCongestionScore(v),
    band: commercialScore(v),
    operator: String(v.operator_name || v.operator || ""),
    agent: String(v.agent_name || v.agent || "")
  }[sortKey] ?? "");
  const sortedRecords = records.slice().sort((a, b) => {
    const av = value(a);
    const bv = value(b);
    const result = typeof av === "number" && typeof bv === "number"
      ? av - bv
      : String(av).localeCompare(String(bv), "ko");
    const primary = sortDir === "asc" ? result : -result;
    return primary ||
      commercialScore(b) - commercialScore(a) ||
      Number(b.work_feasibility_score || b.cleaning_window_score || 0) - Number(a.work_feasibility_score || a.cleaning_window_score || 0) ||
      deriveCongestionScore(b) - deriveCongestionScore(a) ||
      Number(b.data_confidence_score || 0) - Number(a.data_confidence_score || 0) ||
      candidateTimestamp(b) - candidateTimestamp(a);
  });
  const start = (page - 1) * pageSize;
  return {
    page,
    pageSize,
    total: records.length,
    totalPages: Math.max(1, Math.ceil(records.length / pageSize)),
    group: searchParams.get("group") || "target",
    data: sortedRecords.slice(start, start + pageSize)
  };
}

function vesselGroupRows(allRecords = [], group = "target") {
  const usefulRows = annotateCommercialRanks(activeRecordsOnly(allRecords).filter(hasUsefulVesselIdentity));
  const rows = group === "all"
    ? usefulRows
    : usefulRows.filter(isSalesCandidate);
  return sortCommercialPriority(dedupeCandidateRows(rows));
}

function csvCell(value) {
  const text = Array.isArray(value) ? value.join("|") : String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function vesselCsv(records = []) {
  const columns = [
    ["vessel_name", "선박명"],
    ["call_sign", "호출부호"],
    ["imo", "IMO"],
    ["mmsi", "MMSI"],
    ["port_name", "항만"],
    ["port_code", "항만코드"],
    ["berth_name", "선석/시설"],
    ["anchorage_name", "묘박지"],
    ["vessel_type", "선종"],
    ["vessel_type_group", "선종그룹"],
    ["gt", "GT"],
    ["operator_name", "운영선사"],
    ["operator_website", "운영선사웹사이트"],
    ["agent_name", "대리점/신고업체"],
    ["agent_website", "대리점웹사이트"],
    ["contact_readiness_score", "연락준비도"],
    ["commercial_value_score", "상업가치점수"],
    ["data_confidence_score", "데이터신뢰도"],
    ["congestion_score", "체선점수"],
    ["biofouling_risk_score", "바이오파울링위험도"],
    ["cii_pressure_score", "CII압박도"],
    ["stay_hours", "체류시간"],
    ["anchorage_hours", "묘박시간"],
    ["status_bucket", "상태"],
    ["candidate_band", "후보밴드"],
    ["reason_codes", "후보선정사유"]
  ];
  const lines = [columns.map(([, label]) => csvCell(label)).join(",")];
  for (const record of records) {
    lines.push(columns.map(([key]) => csvCell(record[key])).join(","));
  }
  return `\uFEFF${lines.join("\r\n")}`;
}

function publicVesselId(v = {}) {
  return encodeURIComponent(String(v.master_vessel_id || v.hybrid_entity_key || v.vessel_id || candidateDedupeKey(v)));
}

function findVesselById(records = [], vesselId = "") {
  const decoded = decodeURIComponent(vesselId || "");
  return records.find(v => [
    v.master_vessel_id,
    v.hybrid_entity_key,
    v.vessel_id,
    candidateDedupeKey(v)
  ].some(value => String(value || "") === decoded));
}

function buildDashboardSummary(allRecords = [], source = {}) {
  const activeRecords = activeRecordsOnly(allRecords);
  const buckets = buildVisibilityBuckets(activeRecords);
  const immediateTargets = sortCommercialPriority(buckets.immediate_targets).slice(0, 5);
  const immediateKeys = new Set(immediateTargets.map(candidateDedupeKey));
  const opportunities = sortCommercialPriority(buckets.sales_candidates.filter(v => !immediateKeys.has(candidateDedupeKey(v)))).slice(0, 5);
  return {
    status: buildStatus(activeRecords, source),
    ports: buildPorts(buckets.target_vessels),
    immediate_targets: immediateTargets,
    opportunities,
    lead_pipeline: buildLeadPipeline(activeRecords).slice(0, 8),
    alert_candidates: buildAlertCandidates(activeRecords).slice(0, 5),
    congestion_summary: buildPortHeatmap(buckets.target_vessels).slice(0, 12),
    candidate_counts: {
      target_vessels: buckets.target_vessels.length,
      sales_candidates: buckets.sales_candidates.length,
      immediate_targets: buckets.immediate_targets.length,
      staying_vessels: buckets.staying_vessels.length,
      arrival_pipeline: buckets.arrival_pipeline.length
    }
  };
}

function portCodeFromName(port = "") {
  const text = String(port || "").toLowerCase();
  if (/busan|부산/.test(text)) return "020";
  if (/incheon|인천/.test(text)) return "030";
  if (/yeosu|gwangyang|여수|광양/.test(text)) return "620";
  if (/ulsan|울산/.test(text)) return "820";
  if (/pyeongtaek|dangjin|평택|당진/.test(text)) return "031";
  if (/pohang|포항/.test(text)) return "810";
  if (/mokpo|목포/.test(text)) return "070";
  if (/gunsan|군산/.test(text)) return "080";
  if (/daesan|대산/.test(text)) return "621";
  if (/donghae|mukho|동해|묵호/.test(text)) return "120";
  if (/jeju|제주/.test(text)) return "940";
  if (/masan|jinhae|samcheonpo|hadong|tongyeong|geoje|okpo|마산|진해|삼천포|하동|통영|거제|옥포/.test(text)) return "622";
  return "unknown";
}

function portRegistryKey(port = {}) {
  return `${port.port_code || "unknown"}|${String(port.sub_port || port.port_name_ko || port.port_name || "").toLowerCase()}`;
}

function recordPortKey(record = {}) {
  const portCode = record.port_code || portCodeFromName(record.port_name || record.port);
  const subPort = String(record.sub_port || "").toLowerCase();
  if (subPort) return `${portCode}|${subPort}`;
  return `${portCode}|`;
}

function isDisplayablePortName(value = "") {
  const text = String(value || "").trim();
  return text && !/^korea$/i.test(text) && !/^unknown$/i.test(text);
}

function buildPorts(records) {
  const map = new Map();
  for (const registry of PORT_REGISTRY) {
    const key = portRegistryKey(registry);
    map.set(key, {
      port_code: registry.port_code,
      port_name: registry.port_name_ko,
      port_name_ko: registry.port_name_ko,
      port_group: registry.port_name_ko,
      sub_port: registry.sub_port || "",
      tier: registry.tier,
      commercial_priority: registry.tier === 1 ? "high" : registry.tier === 2 ? "medium_high" : "medium",
      registry_sort: registry.sort,
      vessel_count: 0,
      scored_count: 0,
      candidate_count: 0,
      immediate_target_count: 0
    });
  }
  for (const v of records) {
    const portName = v.port_name || v.port || "Unknown";
    const portCode = v.port_code || portCodeFromName(portName);
    if (portCode === "unknown" || !isDisplayablePortName(portName)) continue;
    const exactKey = recordPortKey(v);
    const registryMatch = [...map.keys()].find(key => key.startsWith(`${portCode}|`) && (exactKey === key || !exactKey.split("|")[1]));
    const key = registryMatch || exactKey || portCode;
    const p = map.get(key) || {
      port_code: portCode,
      port_name: portName,
      port_name_ko: v.port_name_ko || "",
      port_group: v.port_group || portName,
      sub_port: v.sub_port || "",
      tier: v.port_tier || "",
      commercial_priority: v.commercial_priority || "",
      vessel_count: 0,
      scored_count: 0,
      candidate_count: 0,
      immediate_target_count: 0
    };
    p.vessel_count += 1;
    if (typeof v.total_sales_priority_score === "number") p.scored_count += 1;
    if (isSalesCandidate(v)) p.candidate_count += 1;
    if (isImmediateTarget(v)) p.immediate_target_count += 1;
    map.set(key, p);
  }
  return [...map.values()].sort((a, b) =>
    Number(a.tier || 99) - Number(b.tier || 99) ||
    Number(a.registry_sort || 999) - Number(b.registry_sort || 999) ||
    b.immediate_target_count - a.immediate_target_count ||
    b.candidate_count - a.candidate_count ||
    b.vessel_count - a.vessel_count
  );
}

function recordsForPort(records, portCode) {
  return records.filter(v => String(v.port_code || portCodeFromName(v.port)) === String(portCode));
}

function buildVisibilityBuckets(records) {
  const activeRecords = activeRecordsOnly(records);
  const targetVessels = annotateCommercialRanks(activeRecords.filter(isMainCommercialVessel));
  for (const vessel of targetVessels) {
    vessel.is_cleaning_candidate = isSalesCandidate(vessel);
    vessel.is_immediate_candidate = isImmediateTarget(vessel);
    vessel.candidate_band = isImmediateTarget(vessel) ? "immediate_target" : isSalesCandidate(vessel) ? "sales_candidate" : isWatchlistVessel(vessel) ? "watchlist" : "general";
  }
  const canonicalScoredVessels = sortCommercialPriority(dedupeCandidateRows(targetVessels));
  const salesCandidates = sortCommercialPriority(dedupeCandidateRows(canonicalScoredVessels.filter(isSalesCandidate))).map(v => ({ ...v, candidate_band: commercialScore(v) >= IMMEDIATE_TARGET_THRESHOLD ? "immediate_target" : "sales_candidate", exclusion_reason: exclusionReason(v) }));
  const immediateTargets = sortCommercialPriority(dedupeCandidateRows(canonicalScoredVessels.filter(isImmediateTarget))).map(v => ({ ...v, candidate_band: "immediate_target", is_immediate_candidate: true, exclusion_reason: exclusionReason(v) }));
  return {
    target_vessels: targetVessels,
    canonical_scored_vessels: canonicalScoredVessels,
    staying_vessels: targetVessels.filter(v => ["arrived_staying", "berthed", "anchorage_waiting"].includes(v.status_bucket)),
    arrival_pipeline: targetVessels.filter(v => v.status_bucket === "arriving_soon" || v.predicted_arrival_pipeline || Number(v.arrival_opportunity_score || 0) >= 35),
    pilot_only_arrival_review: targetVessels.filter(v => v.pilot_only_arrival_review || v.ledger_status === "pilot_only_pending_port_operation"),
    sales_candidates: salesCandidates,
    immediate_targets: immediateTargets
  };
}

function recordKey(record = {}, fallback = "") {
  return String(fallback || record.port_call_identity || record.snapshot_id || record.vessel_id || `${record.vessel_name || "UNKNOWN"}|${record.port_code || record.port || "KOREA"}|${record.call_sign || ""}`).toUpperCase();
}

function vesselIdentityKey(record = {}, fallback = "") {
  return String(fallback || record.vessel_identity || record.master_vessel_id || record.hybrid_entity_key || record.imo || record.mmsi || record.call_sign || `${record.normalized_vessel_name || record.vessel_name || "UNKNOWN"}|${record.gt || 0}|${record.vessel_type_group || record.vessel_type || ""}`).toUpperCase();
}

function buildCountFunnel(records = [], buckets = buildVisibilityBuckets(records)) {
  const rawRows = records.reduce((sum, record) => sum + Math.max(1, Number(record.raw_row_count || record.detail_row_count || 1)), 0);
  const uniquePortCalls = new Set(records.map((record, index) => recordKey(record, `ROW-${index}`))).size;
  const uniqueVessels = new Set(records.map((record, index) => vesselIdentityKey(record, `ROW-${index}`))).size;
  return {
    raw_api_rows: rawRows,
    detail_rows_flattened: records.reduce((sum, record) => sum + Number(record.detail_rows_flattened_count || record.detail_rows_flattened || 0), 0),
    normalized_rows: records.length,
    duplicate_raw_rows: Math.max(0, rawRows - uniquePortCalls),
    unique_port_calls: uniquePortCalls,
    unique_vessels: uniqueVessels,
    target_vessels_5000gt_plus: buckets.target_vessels.filter(v => Number(v.gt || v.grtg || v.intrlGrtg || 0) >= Number(v.commercial_gt_threshold || 5000)).length,
    unknown_gt_review: buckets.target_vessels.filter(v => v.gt_status === "unknown_gt_review").length,
    excluded_under_5000gt: records.filter(v => {
      const gt = Number(v.gt || v.grtg || v.intrlGrtg || 0);
      return gt > 0 && gt < Number(v.commercial_gt_threshold || 5000);
    }).length,
    sales_candidates: buckets.sales_candidates.length,
    immediate_targets: buckets.immediate_targets.length,
    capped_by_limit: false,
    cap_name: null,
    cap_value: null
  };
}


function buildPortCongestion(records, portCode) {
  return buildPortHeatmap(records).find(p => String(p.port_code || portCodeFromName(p.port)) === String(portCode)) || {
    port_code: portCode,
    total: 0,
    anchorage_vessels: 0,
    long_idle_vessels: 0,
    average_waiting_time: 0,
    berth_occupancy: 0,
    anchorage_density: 0,
    congestion_score: 0
  };
}

function buildAnchorage(records) {
  return sortCommercialPriority(records.filter(v => v.is_anchorage_waiting || (v.anchorage_hours || 0) > 0 || /waiting|anchorage|anchor|idle|drifting/i.test(v.status || "")))
    .map(v => ({
      vessel_id: v.vessel_id,
      vessel_name: v.vessel_name,
      port_code: v.port_code || portCodeFromName(v.port),
      port_name: v.port_name || v.port,
      anchorage_name: v.anchorage_name || v.anchorage_zone || "",
      anchorage_hours: v.anchorage_hours || 0,
      anchorage_days: v.anchorage_days || 0,
      anchorage_density_score: v.anchorage_density_score || 0,
      idle_risk_score: v.idle_risk_score || 0,
      total_sales_priority_score: v.total_sales_priority_score || 0,
      reason_codes: v.reason_codes || []
    }));
}

function buildScoringDiagnostics(records = []) {
  const buckets = buildVisibilityBuckets(records);
  const funnel = buildCountFunnel(records, buckets);
  const scoreBuckets = records.reduce((acc, v) => {
    const value = commercialScore(v);
    if (value < 20) acc.score_0_20 += 1;
    else if (value < 35) acc.score_20_35 += 1;
    else if (value < 50) acc.score_35_50 += 1;
    else if (value < SALES_CANDIDATE_THRESHOLD) acc.score_50_65 += 1;
    else if (value < IMMEDIATE_TARGET_THRESHOLD) acc.score_65_75 += 1;
    else if (value < CRITICAL_TARGET_THRESHOLD) acc.score_75_90 += 1;
    else acc.score_90_plus += 1;
    return acc;
  }, { score_0_20: 0, score_20_35: 0, score_35_50: 0, score_50_65: 0, score_65_75: 0, score_75_90: 0, score_90_plus: 0 });
  scoreBuckets.score_35_60 = scoreBuckets.score_35_50 + scoreBuckets.score_50_65;
  scoreBuckets.score_60_80 = scoreBuckets.score_65_75 + scoreBuckets.score_75_90;
  scoreBuckets.score_80_90 = scoreBuckets.score_75_90;
  scoreBuckets.score_50_75 = scoreBuckets.score_50_65 + scoreBuckets.score_65_75;
  scoreBuckets.score_75_plus = scoreBuckets.score_75_90 + scoreBuckets.score_90_plus;
  const congestionScores = records.map(deriveCongestionScore);
  const workScores = records.map(v => Number(v.work_feasibility_score || 0) || Number(v.cleaning_window_score || 0));
  const waitingDays = records.map(commercialWaitingDays);
  const salesTargetCount = records.filter(isSalesCandidate).length;
  const immediateTargetCount = records.filter(isImmediateTarget).length;
  const percentileRankPresentCount = records.filter(hasCommercialRank).length;
  const percentileRankMissingCount = records.length - percentileRankPresentCount;
  const thresholdOnlySalesTargetCount = records.filter(v => commercialScore(v) >= SALES_CANDIDATE_THRESHOLD && !isDepartedRecord(v) && !isHardCandidateExcluded(v)).length;
  const percentileLogicActive = percentileRankPresentCount > 0;
  const onlyThresholdLogicActive = percentileRankMissingCount === records.length;
  const targetRatio = records.length ? Math.round((salesTargetCount / records.length) * 1000) / 10 : 0;
  const immediateTargetRatio = records.length ? Math.round((immediateTargetCount / records.length) * 1000) / 10 : 0;
  const avg = values => values.length ? Math.round(values.reduce((sum, value) => sum + Number(value || 0), 0) / values.length) : 0;
  const percentileValue = (values, p) => {
    const sorted = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
    if (!sorted.length) return 0;
    return Math.round(sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))]);
  };
  const percentileDistribution = values => ({
    top_10: values.filter(value => Number(value) <= 10).length,
    top_20: values.filter(value => Number(value) <= 20).length,
    top_40: values.filter(value => Number(value) <= 40).length
  });
  const scores = records.map(commercialScore);
  const scoreRangeCount = (min, max = Infinity) => scores.filter(score => score >= min && score <= max).length;
  return {
    valid_vessels_count: records.length,
    score_90_plus_count: scoreRangeCount(90),
    score_80_89_count: scoreRangeCount(80, 89),
    score_70_79_count: scoreRangeCount(70, 79),
    score_60_69_count: scoreRangeCount(60, 69),
    score_50_59_count: scoreRangeCount(50, 59),
    score_40_49_count: scoreRangeCount(40, 49),
    score_0_39_count: scores.filter(score => score < 40).length,
    raw_collected_rows: funnel.raw_api_rows,
    normalized_rows: records.length,
    all_vessels_count: records.length,
    target_vessels_count: buckets.target_vessels.length,
    sales_candidates_count: buckets.sales_candidates.length,
    immediate_targets_count: buckets.immediate_targets.length,
    ...scoreBuckets,
    commercial_score_bands: {
      critical: "90+",
      immediate_target: "75-89",
      sales_target: "65-74",
      watchlist: "50-64",
      general_vessel: "0-49"
    },
    congestion_score_avg: avg(congestionScores),
    congestion_score_nonzero_count: congestionScores.filter(value => value > 0).length,
    congestion_score_calculated_count: congestionScores.filter(value => value > 0).length,
    congestion_score_zero_but_stay_exists_count: records.filter(v => commercialWaitingDays(v) >= 3 && deriveCongestionScore(v) <= 0).length,
    waiting_0_3d_count: waitingDays.filter(value => value > 0 && value < 3).length,
    waiting_3_5d_count: waitingDays.filter(value => value >= 3 && value < 5).length,
    waiting_5_7d_count: waitingDays.filter(value => value >= 5 && value < 7).length,
    waiting_7_10d_count: waitingDays.filter(value => value >= 7 && value < 10).length,
    waiting_10d_plus_count: waitingDays.filter(value => value >= 10).length,
    work_feasibility_score_avg: avg(workScores),
    sales_target_count: salesTargetCount,
    sales_target_count_calculation: "score >= 65 AND not departed/excluded AND global_percentile <= 20 OR port_percentile <= 20; rows without percentile rank currently pass percentile guard",
    sales_target_threshold_only_count: thresholdOnlySalesTargetCount,
    percentile_logic_active: percentileLogicActive,
    only_threshold_logic_active: onlyThresholdLogicActive,
    percentile_rank_present_count: percentileRankPresentCount,
    percentile_rank_missing_count: percentileRankMissingCount,
    candidate_classification_logic: {
      immediate_targets: "score >= 75 AND top 10% global/port AND current/near-term work feasibility",
      sales_targets: "score >= 65 AND top 20% global/port",
      watchlist: "score >= 50 OR top 40% global/port",
      percentile_fallback: "if rank fields are missing, percentile guard passes to avoid hiding rows"
    },
    watchlist_count: records.filter(v => {
      const value = commercialScore(v);
      return value >= 50 && value < SALES_CANDIDATE_THRESHOLD;
    }).length,
    immediate_target_count: immediateTargetCount,
    target_ratio: targetRatio,
    immediate_target_ratio: immediateTargetRatio,
    target_ratio_warning: targetRatio > 30 ? "Target qualification is too broad." : "",
    immediate_target_ratio_warning: immediateTargetRatio > 15 ? "즉시영업후보 기준이 너무 넓습니다." : "",
    global_percentile_distribution: percentileDistribution(records.map(v => v.global_percentile)),
    port_percentile_distribution: percentileDistribution(records.map(v => v.port_percentile)),
    score_avg: avg(scores),
    score_median: percentileValue(scores, 50),
    score_p90: percentileValue(scores, 90),
    score_p75: percentileValue(scores, 75),
    score_p50: percentileValue(scores, 50),
    over_scoring_warning: targetRatio > 30 || immediateTargetRatio > 15 ? "영업 후보 점수 또는 비율이 과대 산정될 수 있습니다." : "",
    anchorage_hours_detected_count: records.filter(v => Number(v.anchorage_hours || 0) > 0).length,
    stay_hours_detected_count: records.filter(v => Number(v.stay_hours || v.current_call_stay_hours || v.cumulative_stay_hours || 0) > 0).length,
    biofouling_score_nonzero_count: records.filter(v => deriveBiofoulingProxyScore(v) > 0).length,
    cii_score_nonzero_count: records.filter(v => deriveCiiProxyScore(v) > 0).length,
    performance_proxy_nonzero_count: records.filter(v => derivePerformanceProxyScore(v) > 0).length,
    commercial_value_score_nonzero_count: records.filter(v => commercialScore(v) > 0).length,
    route_pattern_known_count: records.filter(v => v.route_pattern_known).length,
    predicted_arrival_count: records.filter(v => v.predicted_arrival_time).length,
    predicted_arrival_pipeline_count: records.filter(v => v.predicted_arrival_pipeline).length,
    arrival_opportunity_score_nonzero_count: records.filter(v => Number(v.arrival_opportunity_score || 0) > 0).length,
    predicted_congestion_score_nonzero_count: records.filter(v => Number(v.predicted_congestion_score || 0) > 0).length,
    anchorage_probability_nonzero_count: records.filter(v => Number(v.anchorage_probability || 0) > 0).length,
    predicted_work_window_count: records.filter(v => Number(v.predicted_work_window_hours || 0) > 0).length,
    repeat_caller_signal_count: records.filter(v => Number(v.repeat_caller_score || 0) > 0).length,
    repeat_operator_signal_count: records.filter(v => Number(v.repeat_operator_score || 0) > 0).length,
    biofouling_exposure_nonzero_count: records.filter(v => Number(v.biofouling_exposure_score || 0) > 0).length,
    predicted_cleaning_opportunity_nonzero_count: records.filter(v => Number(v.predicted_cleaning_opportunity_score || 0) > 0).length,
    alert_candidate_count: records.filter(isAlertCandidate).length,
    information_enrichment_needed_count: records.filter(v => v.information_enrichment_needed).length,
    high_score_not_promoted_count: records.filter(v => commercialScore(v) >= SALES_CANDIDATE_THRESHOLD && !isSalesCandidate(v)).length,
    candidate_promotion_error: records.some(v => commercialScore(v) >= SALES_CANDIDATE_THRESHOLD && !isSalesCandidate(v) && !v.exclusion_reason),
    exclusion_reason_counts: records.reduce((acc, v) => {
      if (commercialScore(v) >= SALES_CANDIDATE_THRESHOLD && !isSalesCandidate(v)) {
        const reason = v.exclusion_reason || exclusionReason(v) || "unknown";
        acc[reason] = (acc[reason] || 0) + 1;
      }
      return acc;
    }, {}),
    prediction_error_measured_count: records.filter(v => Number.isFinite(Number(v.prediction_error_hours))).length
  };
}

function buildOperatorDiagnostics(records = [], buckets = buildVisibilityBuckets(records)) {
  const known = records.filter(v => hasValue(v.operator_name || v.operator));
  const sourceBreakdown = {};
  for (const v of known) {
    const source = v.operator_source || "source_field";
    sourceBreakdown[source] = (sourceBreakdown[source] || 0) + 1;
  }
  return {
    operator_known_count: known.length,
    operator_inferred_count: records.filter(v => v.operator_inferred).length,
    operator_unknown_count: records.filter(v => !hasValue(v.operator_name || v.operator)).length,
    agent_known_count: records.filter(v => hasValue(v.agent_name || v.agent)).length,
    operator_confidence_avg: known.length ? Math.round(known.reduce((sum, v) => sum + Number(v.operator_confidence || 0), 0) / known.length) : 0,
    operator_source_breakdown: sourceBreakdown,
    candidates_with_operator_count: buckets.sales_candidates.filter(v => hasValue(v.operator_name || v.operator)).length,
    candidates_with_agent_count: buckets.sales_candidates.filter(v => hasValue(v.agent_name || v.agent)).length,
    immediate_targets_with_contact_path_count: buckets.immediate_targets.filter(v => v.contact_path_available || hasValue(v.operator_name || v.operator) || hasValue(v.agent_name || v.agent)).length,
    contact_ready_count: records.filter(v => Number(v.contact_readiness_score || 0) >= 50 || v.contact_path_available).length,
    candidates_contact_ready_count: buckets.sales_candidates.filter(v => Number(v.contact_readiness_score || 0) >= 50 || v.contact_path_available).length
  };
}

function buildStatus(records, source) {
  const buckets = buildVisibilityBuckets(records);
  const countFunnel = buildCountFunnel(records, buckets);
  const high = records.filter(v => (v.risk_score || 0) >= 70);
  const displayableRows = buckets.target_vessels.length || records.length;
  const allDisplayVessels = vesselGroupRows(records, "all");
  const monitoringVessels = allDisplayVessels.filter(v => commercialScore(v) < SALES_CANDIDATE_THRESHOLD);
  const dataMode = buckets.target_vessels.length ? "supabase_live_snapshot" : records.length ? "supabase_snapshot_no_targets" : "no_live_data";
  const usingSnapshotFallback = Boolean(source.pointer?.fallback_pointer && records.length);
  return {
    version: "worker-live-api-v1",
    status: source.error && !records.length ? "degraded" : "success",
    data_mode: dataMode,
    commercial_use_status: displayableRows ? "review_required" : "not_ready",
    live_data_available: Boolean(displayableRows),
    displayable_vessel_count: displayableRows,
    completed_at: new Date().toISOString(),
    record_count: buckets.target_vessels.length,
    all_collected_vessel_count: records.length,
    all_display_vessel_count: allDisplayVessels.length,
    monitoring_vessel_count: monitoringVessels.length,
    commercial_target_vessel_count: buckets.sales_candidates.length,
    target_vessel_count: buckets.target_vessels.length,
    staying_vessel_count: buckets.staying_vessels.length,
    arrival_pipeline_count: buckets.arrival_pipeline.length,
    pilot_only_arrival_review_count: buckets.pilot_only_arrival_review.length,
    unknown_gt_review_count: buckets.target_vessels.filter(v => v.gt_status === "unknown_gt_review").length,
    non_target_small_vessel_count: records.filter(v => v.gt_status === "non_target_small_vessel").length,
    actionable_rows: buckets.target_vessels.filter(v => v.actionable_source_row !== false).length,
    hot_vessel_count: buildHot(buckets.target_vessels).length,
    critical_count: records.filter(v => (v.risk_score || 0) >= 85).length,
    high_risk_count: high.length,
    cleaning_candidate_count: records.filter(v => v.is_cleaning_candidate).length,
    immediate_candidate_count: records.filter(v => v.is_immediate_candidate).length,
    scored_vessel_count: buckets.target_vessels.filter(v => typeof v.commercial_value_score === "number").length,
    sales_candidate_count: buckets.sales_candidates.length,
    immediate_target_count: buckets.immediate_targets.length,
    lead_pipeline_count: buildLeadPipeline(records).length,
    imo_missing_count: buckets.target_vessels.filter(v => !v.imo).length,
    imo_recovery_kpis: buildImoRecoveryKpis(buckets.target_vessels),
    high_value_low_confidence_count: buildHighValueLowConfidence(buckets.target_vessels).length,
    opportunity_usd: records.reduce((sum, v) => sum + (v.opportunity_usd || 0), 0),
    count_funnel: countFunnel,
    scoring_diagnostics: buildScoringDiagnostics(records),
    high_score_visibility_audit: highScoreVisibilityAudit(records, 93),
    commercial_ranking_audit: commercialRankingAudit(records),
    operator_diagnostics: buildOperatorDiagnostics(records, buckets),
    frontend_poll_interval_seconds: 900,
    source_runtime: {
      provider: "supabase",
      configured: source.configured,
      error: source.error,
      auth_key_type: source.pointer?.auth_key_type || (source.configured ? "unknown" : "missing"),
      row_count: records.length,
      active_run_id: source.pointer?.active_run_id || null,
      active_collected_at: source.pointer?.active_collected_at || null,
      promoted_at: source.pointer?.promoted_at || null,
      is_stale: Boolean(source.pointer?.is_stale),
      pointer_source: source.pointer?.pointer_source || "none",
      fallback_pointer: Boolean(source.pointer?.fallback_pointer),
      using_latest_snapshot_fallback: usingSnapshotFallback,
      fallback_status: usingSnapshotFallback ? "showing_latest_supabase_snapshot" : null,
      pointer_diagnostics: source.pointer?.pointer_diagnostics || [],
      stale_warning: source.pointer?.fallback_pointer
        ? "Active dataset pointer is missing or empty; showing latest available Supabase snapshot run."
        : null
    },
    visibility_goal: "commercially_relevant_vessels_not_raw_count",
    target_definition: {
      commercial_gt_threshold: 5000,
      include: ["grtg >= 5000", "intrlGrtg >= 5000", "unknown GT requiring review"],
      exclude_from_main_view: ["GT under 5000", "non-commercial vessel types", "completed departure-only rows"]
    },
    commercial_command_center: buildCommandCenter(buckets.target_vessels),
    port_intelligence: buildPorts(buckets.target_vessels),
    port_congestion_heatmap: buildPortHeatmap(buckets.target_vessels),
    all_port_congestion_heatmap: buildPortHeatmap(records),
    biofouling_timeline: buildBioTimeline(buckets.target_vessels)
  };
}

async function apiResponse(url, env) {
  const pathname = typeof url === "string" ? url : url.pathname;
  const searchParams = typeof url === "string" ? new URLSearchParams() : url.searchParams;
  const source = await fetchSupabaseRows(env);
  const allRecords = activeRecordsOnly(latestPerVesselPort(source.rows));
  const buckets = buildVisibilityBuckets(allRecords);
  const records = buckets.target_vessels;
  if (pathname.endsWith("/dashboard-summary.json")) return json(buildDashboardSummary(allRecords, source), { headers: corsHeaders() });
  if (pathname.endsWith("/status.json")) return json(buildStatus(allRecords, source), { headers: corsHeaders() });
  if (pathname.endsWith("/all-collected-vessels.json")) return json(allRecords, { headers: corsHeaders() });
  if (pathname.endsWith("/target-vessels.json")) return json(buckets.canonical_scored_vessels, { headers: corsHeaders() });
  if (pathname.endsWith("/staying-vessels.json")) return json(buckets.staying_vessels, { headers: corsHeaders() });
  if (pathname.endsWith("/arrival-pipeline.json")) return json(buckets.arrival_pipeline, { headers: corsHeaders() });
  if (pathname.endsWith("/predicted-arrivals.json")) return json(buildPredictedArrivals(allRecords), { headers: corsHeaders() });
  if (pathname.endsWith("/lead-pipeline.json")) return json(buildLeadPipeline(allRecords), { headers: corsHeaders() });
  if (pathname.endsWith("/alert-candidates.json")) return json(buildAlertCandidates(allRecords), { headers: corsHeaders() });
  if (pathname.endsWith("/pilot-only-arrival-review.json") || pathname.endsWith("/review/pilot-only-arrivals.json")) return json(buckets.pilot_only_arrival_review, { headers: corsHeaders() });
  if (pathname.endsWith("/imo-recovery-queue.json")) return json(buildUnknownImo(records), { headers: corsHeaders() });
  if (pathname.endsWith("/imo-recovery-priority.json")) return json(buildUnknownImo(records), { headers: corsHeaders() });
  if (pathname.endsWith("/high-value-targets.json")) return json(buildHighValueTargets(records), { headers: corsHeaders() });
  if (pathname.endsWith("/review/unknown-gt.json")) return json(buildUnknownGtReview(records), { headers: corsHeaders() });
  if (pathname.endsWith("/review/high-value-low-confidence.json")) return json(buildHighValueLowConfidence(records), { headers: corsHeaders() });
  if (pathname.endsWith("/review/congestion-watchlist.json")) return json(buildCongestionWatchlist(records), { headers: corsHeaders() });
  if (pathname.endsWith("/quality/basic-info-coverage.json")) return json(buildBasicInfoCoverage(records), { headers: corsHeaders() });
  if (pathname.endsWith("/review/basic-info-missing.json")) return json(buildBasicInfoMissing(records), { headers: corsHeaders() });
  if (pathname.endsWith("/quality/high-score-visibility-audit.json")) {
    return json(highScoreVisibilityAudit(allRecords, Number(searchParams.get("threshold") || 93)), { headers: corsHeaders() });
  }
  if (pathname.endsWith("/quality/commercial-ranking-audit.json")) {
    return json(commercialRankingAudit(allRecords), { headers: corsHeaders() });
  }
  if (pathname === "/api/vessels.csv" || pathname.endsWith("/vessels.csv")) {
    const group = String(searchParams.get("group") || "target").toLowerCase();
    const sourceRows = vesselGroupRows(allRecords, group);
    return new Response(vesselCsv(sourceRows), {
      headers: {
        ...corsHeaders(),
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="hwk-${group === "all" ? "monitoring-vessels" : "sales-target-vessels"}.csv"`
      }
    });
  }
  if (pathname === "/api/vessels" || pathname.endsWith("/vessels.json")) {
    const group = String(searchParams.get("group") || "target").toLowerCase();
    const sourceRows = vesselGroupRows(allRecords, group);
    const groupCounts = {
      target: vesselGroupRows(allRecords, "target").length,
      all: vesselGroupRows(allRecords, "all").length
    };
    return json({ ...pageRows(sourceRows, searchParams), groupCounts }, { headers: corsHeaders() });
  }
  const vesselMatch = pathname.match(new RegExp("^/api/vessels/([^/]+)$"));
  if (vesselMatch) {
    const vessel = findVesselById(allRecords, vesselMatch[1]);
    return json(vessel || { error: "not_found" }, { status: vessel ? 200 : 404, headers: corsHeaders() });
  }
  if (pathname.endsWith("/candidates.json")) return json(buckets.sales_candidates, { headers: corsHeaders() });
  if (pathname.endsWith("/candidates/top.json")) return json({
    immediate_targets: sortCommercialPriority(buckets.immediate_targets).slice(0, 5),
    opportunities: sortCommercialPriority(buckets.sales_candidates.filter(v => !isImmediateTarget(v))).slice(0, 5)
  }, { headers: corsHeaders() });
  if (pathname.endsWith("/hot-candidates.json")) return json(buckets.immediate_targets, { headers: corsHeaders() });
  if (pathname.endsWith("/master/unknown-imo.json")) return json(buildUnknownImo(records), { headers: corsHeaders() });
  if (pathname.endsWith("/ports.json")) return json(buildPorts(records), { headers: corsHeaders() });
  const portMatch = pathname.match(new RegExp("^/api/ports/([^/]+)/(vessels|target-vessels|staying-vessels|arrivals|candidates|berths|congestion|anchorage)\\.json$"));
  if (portMatch) {
    const rows = recordsForPort(records, decodeURIComponent(portMatch[1]));
    if (portMatch[2] === "vessels") return json(rows, { headers: corsHeaders() });
    if (portMatch[2] === "target-vessels") return json(rows.filter(isMainCommercialVessel), { headers: corsHeaders() });
    if (portMatch[2] === "staying-vessels") return json(rows.filter(v => ["arrived_staying", "berthed", "anchorage_waiting"].includes(v.status_bucket)), { headers: corsHeaders() });
    if (portMatch[2] === "arrivals") return json(rows.filter(v => v.status_bucket === "arriving_soon"), { headers: corsHeaders() });
    if (portMatch[2] === "candidates") return json(buildVisibilityBuckets(rows).sales_candidates, { headers: corsHeaders() });
    if (portMatch[2] === "congestion") return json(buildPortCongestion(records, decodeURIComponent(portMatch[1])), { headers: corsHeaders() });
    if (portMatch[2] === "anchorage") return json(buildAnchorage(rows), { headers: corsHeaders() });
    return json(rows.filter(v => v.berth).map(v => ({ berth_name: v.berth, vessel_name: v.vessel_name, status: v.status, eta: v.eta, etd: v.etd })), { headers: corsHeaders() });
  }
  if (pathname.endsWith("/hot-vessels.json")) return json(buildHot(records), { headers: corsHeaders() });
  if (pathname.endsWith("/commercial-command-center.json")) return json(buildCommandCenter(records), { headers: corsHeaders() });
  if (pathname.endsWith("/port-congestion-heatmap.json")) return json(buildPortHeatmap(records), { headers: corsHeaders() });
  if (pathname.endsWith("/biofouling-timeline.json")) return json(buildBioTimeline(records), { headers: corsHeaders() });
  return null;
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders() });
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      const response = await apiResponse(url, env);
      if (response) return response;
    }
    return env.ASSETS.fetch(request);
  }
};
