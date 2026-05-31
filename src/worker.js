const API_CACHE_SECONDS = 300;
const UI_ASSET_CACHE_CONTROL = "no-store, max-age=0, must-revalidate";
const AUTO_UPDATE_INTERVAL_HOURS = 4;
const SALES_CANDIDATE_THRESHOLD = 65;
const IMMEDIATE_TARGET_THRESHOLD = 75;
const CRITICAL_TARGET_THRESHOLD = 90;
const PORT_REGISTRY_SOURCE = "data/reference/ports_registry.csv";
const PORT_REGISTRY_GENERATED_FROM_CSV = true;
const SUPPORTED_SERVING_MODES = new Set(["worker_supabase", "static_json", "local_diagnostics"]);
// Compatibility cache generated from data/reference/ports_registry.csv.
// Update the CSV source first, then regenerate this Worker constant.
const PORT_REGISTRY = [
  { port_code: "020", port_name_ko: "부산항", tier: 1, sort: 10 },
  { port_code: "820", port_name_ko: "울산항", tier: 1, sort: 20 },
  { port_code: "620", port_name_ko: "여수·광양항", tier: 1, sort: 30 },
  { port_code: "031", port_name_ko: "평택·당진항", tier: 1, sort: 40 },
  { port_code: "030", port_name_ko: "인천항", tier: 1, sort: 50 },
  { port_code: "810", port_name_ko: "포항항", tier: 1, sort: 60 },
  { port_code: "622", port_name_ko: "하동항", sub_port: "하동항", tier: 2, sort: 110 },
  { port_code: "622", port_name_ko: "삼천포항", sub_port: "삼천포항", tier: 2, sort: 120 },
  { port_code: "621", port_name_ko: "대산항", tier: 2, sort: 130 },
  { port_code: "622", port_name_ko: "마산·진해항", sub_port: "마산·진해항", tier: 2, sort: 140 },
  { port_code: "622", port_name_ko: "통영항", sub_port: "통영항", tier: 2, sort: 150 },
  { port_code: "622", port_name_ko: "거제·옥포항", sub_port: "거제·옥포항", tier: 2, sort: 160 },
  { port_code: "070", port_name_ko: "목포항", tier: 2, sort: 170 },
  { port_code: "080", port_name_ko: "군산항", tier: 2, sort: 180 },
  { port_code: "120", port_name_ko: "동해·묵호항", sub_port: "동해·묵호항", tier: 2, sort: 190 },
  { port_code: "940", port_name_ko: "제주항", tier: 3, sort: 210 },
  { port_code: "120", port_name_ko: "속초항", sub_port: "속초항", tier: 3, sort: 220 },
  { port_code: "031", port_name_ko: "보령항", sub_port: "보령항", tier: 3, sort: 230 },
  { port_code: "030", port_name_ko: "영흥 터미널", sub_port: "영흥 터미널", tier: 3, sort: 240 },
  { port_code: "621", port_name_ko: "태안 터미널", sub_port: "태안 터미널", tier: 3, sort: 250 },
  { port_code: "031", port_name_ko: "당진 산업터미널", sub_port: "당진 산업터미널", tier: 3, sort: 260 },
  { port_code: "820", port_name_ko: "LNG·산업 터미널", sub_port: "LNG·산업 터미널", tier: 3, sort: 270 }
];
const REPRESENTATIVE_PORT_NAMES = {
  "020": "부산항",
  "030": "인천항",
  "031": "평택·당진항",
  "070": "목포항",
  "080": "군산항",
  "120": "동해·묵호항",
  "620": "여수·광양항",
  "621": "대산항",
  "622": "경남권 항만",
  "810": "포항항",
  "820": "울산항",
  "940": "제주항"
};
function normalizePortCode(value) {
  const raw = String(value || "").trim();
  if (!raw || raw === "unknown") return "unknown";
  if (/^\d+$/.test(raw)) return raw.padStart(3, "0");
  return raw;
}
function representativePortName(portCode, fallback = "") {
  const code = normalizePortCode(portCode);
  return REPRESENTATIVE_PORT_NAMES[code] || fallback || code;
}
function representativeRegistryForCode(portCode) {
  const code = normalizePortCode(portCode);
  const candidates = PORT_REGISTRY
    .filter(port => normalizePortCode(port.port_code) === code)
    .sort((a, b) => Number(a.tier || 99) - Number(b.tier || 99) || Number(a.sort || 999) - Number(b.sort || 999));
  return candidates.find(port => Number(port.tier || 99) === 1) || candidates[0] || null;
}
function parseJsonField(value, fallback) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") return value;
  if (typeof value === "string" && value.trim()) {
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  }
  return fallback;
}
function normalizeServingMode(mode, fallback = "worker_supabase") {
  const value = String(mode || "").trim().toLowerCase();
  if (SUPPORTED_SERVING_MODES.has(value)) return value;
  if (value === "production_api" || value === "mixed") return "worker_supabase";
  if (value === "debug_diagnostics_only" || value === "diagnostics_only") return "local_diagnostics";
  return fallback;
}
function defaultDataSourceForServingMode(servingMode) {
  if (servingMode === "worker_supabase") return "supabase_active_dataset";
  if (servingMode === "static_json") return "static_json";
  return "diagnostics_only_no_live_data";
}
function withApiServingMetadata(data, meta = {}) {
  const isObject = data && typeof data === "object" && !Array.isArray(data);
  const current = isObject ? data : {};
  const servingMode = normalizeServingMode(meta.serving_mode || current.serving_mode);
  const dataSourceUsed = meta.data_source_used || current.data_source_used || defaultDataSourceForServingMode(servingMode);
  const fallbackUsed = meta.fallback_used ?? current.fallback_used ?? dataSourceUsed.includes("fallback") ?? false;
  const fallbackReason = meta.fallback_reason ?? current.fallback_reason ?? (fallbackUsed ? dataSourceUsed : null);
  if (Array.isArray(data)) {
    return {
      serving_mode: servingMode,
      data_source_used: dataSourceUsed,
      fallback_used: Boolean(fallbackUsed),
      fallback_reason: fallbackReason,
      record_count: data.length,
      data
    };
  }
  return {
    serving_mode: servingMode,
    data_source_used: dataSourceUsed,
    fallback_used: Boolean(fallbackUsed),
    fallback_reason: fallbackReason,
    ...current,
    serving_mode: normalizeServingMode(current.serving_mode || servingMode, servingMode),
    data_source_used: current.data_source_used || dataSourceUsed,
    fallback_used: current.fallback_used ?? Boolean(fallbackUsed),
    fallback_reason: current.fallback_reason ?? fallbackReason
  };
}
const BASIC_INFO_FIELDS = [
  "vessel_name", "normalized_vessel_name", "call_sign", "imo", "mmsi", "vessel_type", "vessel_type_group",
  "gt", "dwt", "loa", "beam", "flag", "operator", "operator_normalized", "agent", "agent_normalized",
  "previous_port", "next_port", "destination_port", "port_code", "port_name", "berth_name", "anchorage_name",
  "eta", "ata", "etd", "atd"
];
function json(data, init = {}) {
  const { meta, ...responseInit } = init;
  return new Response(JSON.stringify(withApiServingMetadata(data, meta), null, 2), {
    ...responseInit,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": `public, max-age=${API_CACHE_SECONDS}, stale-while-revalidate=900`,
      ...(responseInit.headers || {})
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

function normalizeVesselName(value) {
  return String(value || "")
    .normalize("NFKC")
    .toUpperCase()
    .replace(/[^A-Z0-9가-힣]+/g, "");
}

function normalizeIdentityToken(value) {
  return String(value || "")
    .normalize("NFKC")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9가-힣]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function repeatVesselKey(v = {}) {
  return normalizeIdentityToken(
    v.master_vessel_id ||
    v.hybrid_entity_key ||
    v.imo ||
    v.mmsi ||
    v.call_sign ||
    `${v.vessel_name || ""}-${v.gt || v.grtg || v.intrlGrtg || ""}-${v.vessel_type_group || v.vessel_type || ""}`
  );
}

function repeatOperatorKey(v = {}) {
  return normalizeCompanyName(v.operator_name || v.operator || v.operator_normalized || "");
}

function repeatScoreFromCalls(count = 0) {
  const value = Number(count || 0);
  if (value >= 5) return 30;
  if (value >= 3) return 20;
  if (value >= 2) return 10;
  return 0;
}

function fleetCleaningProbability({
  averageBiofoulingExposure = 0,
  averageCongestionExposure = 0,
  repeatOperatorScore = 0,
  routeExposureScore = 0,
  targetVesselCount = 0,
  immediateTargetCount = 0,
  operatorVesselCount = 0,
  operatorPortCount = 0,
  operatorQualityScore = 0
} = {}) {
  return boundedScore(
    Number(averageBiofoulingExposure || 0) * 0.28 +
    Number(averageCongestionExposure || 0) * 0.18 +
    Number(repeatOperatorScore || 0) * 0.16 +
    Number(routeExposureScore || 0) * 0.12 +
    Math.min(14, Number(targetVesselCount || 0) * 4) +
    Math.min(10, Number(immediateTargetCount || 0) * 5) +
    Math.min(8, Number(operatorVesselCount || 0) * 2) +
    Math.min(6, Number(operatorPortCount || 0) * 2) +
    Number(operatorQualityScore || 0) * 0.04
  );
}

function fleetCleaningProbabilityBand(probability = 0) {
  const value = Number(probability || 0);
  if (value >= 80) return "VERY_HIGH";
  if (value >= 65) return "HIGH";
  if (value >= 45) return "MEDIUM";
  return "LOW";
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

function deriveContactPathStatus(v = {}) {
  const hasOperator = hasValue(v.operator_name || v.operator);
  const hasAgent = hasValue(v.agent_name || v.agent || v.satmntEntrpsNm || v.entrpsCdNm);
  const hasContact = hasValue(
    v.operator_website || v.operator_url ||
    v.agent_website || v.agent_url ||
    v.operator_email || v.agent_email ||
    v.operator_phone || v.agent_phone ||
    v.contact_email || v.contact_phone ||
    v.general_email || v.operations_email || v.chartering_email || v.purchasing_email || v.technical_email
  );
  const confidence = Number(v.operator_confidence || v.contact_confidence || 0);
  if (hasContact && confidence >= 70) return "high_confidence_contact";
  if (hasContact) return "contact_available";
  if (hasAgent) return "agent_known";
  if (hasOperator) return "operator_known";
  return "unknown";
}

function deriveContactPriority(v = {}) {
  const hasOperator = hasValue(v.operator_name || v.operator);
  const hasAgent = hasValue(v.agent_name || v.agent || v.satmntEntrpsNm || v.entrpsCdNm);
  const confidence = Number(v.operator_confidence || 0);
  const status = v.contact_path_status || deriveContactPathStatus(v);
  if ((hasOperator && hasAgent) || status === "high_confidence_contact" || status === "contact_available") return "HIGH";
  if ((hasOperator && confidence >= 45) || v.operator_inferred || status === "operator_known") return "MEDIUM";
  return "LOW";
}

function contactPathLabelKo(v = {}) {
  const status = v.contact_path_status || deriveContactPathStatus(v);
  const priority = v.contact_priority || deriveContactPriority({ ...v, contact_path_status: status });
  const labels = {
    high_confidence_contact: "고신뢰 연락처 확인",
    contact_available: "회사 연락처 확인",
    agent_known: "대리점 경로 확인",
    operator_known: "운영선사 경로 확인",
    unknown: "연락 경로 확인 필요"
  };
  return `${labels[status] || labels.unknown} · ${priority}`;
}

function deriveSalesAccessibilityScore(v = {}) {
  const source = String(v.operator_source || "");
  const confidence = Number(v.operator_confidence || 0);
  if (source === "vessel_master" || source === "vessel_spec_api") return 5;
  if (source === "operator_dictionary") return 4;
  if (source === "vessel_name_prefix" && confidence >= 70) return 3;
  if (source === "agent_dictionary") return 2;
  if (source === "agent_heuristic") return 1;
  const raw = Number(v.contact_intelligence_score ?? (
    (hasValue(v.operator_name || v.operator) ? 3 : 0) +
    (hasValue(v.agent_name || v.agent || v.satmntEntrpsNm || v.entrpsCdNm) ? 2 : 0) +
    (v.contact_path_available ? 3 : 0)
  ));
  return Math.min(5, Math.max(0, Math.round(raw)));
}

function deriveContactReadinessScore(v = {}) {
  const accessibility = deriveSalesAccessibilityScore(v);
  const rawContactScore = Number(v.contact_intelligence_score ?? (
    (hasValue(v.operator_name || v.operator) ? 3 : 0) +
    (hasValue(v.agent_name || v.agent || v.satmntEntrpsNm || v.entrpsCdNm) ? 2 : 0) +
    (v.contact_path_available ? 3 : 0)
  ));
  const companyContactAvailable = hasValue(v.operator_website || v.operator_url || v.agent_website || v.agent_url || v.operator_email || v.agent_email || v.operator_phone || v.agent_phone || v.contact_email || v.contact_phone || v.general_email || v.operations_email || v.chartering_email || v.purchasing_email || v.technical_email);
  const repeatSignal = Number(v.repeat_operator_score || v.repeat_caller_score || 0) > 0 ? 5 : 0;
  return Math.min(100, Math.round(
    (accessibility / 5) * 55 +
    (hasValue(v.agent_name || v.agent || v.satmntEntrpsNm || v.entrpsCdNm) ? 35 : 0) +
    (companyContactAvailable ? 10 : 0) +
    Math.min(10, rawContactScore) +
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
  if (!hasCommercialRank(v)) return false;
  return Number(v.global_percentile ?? 101) <= percent || Number(v.port_percentile ?? 101) <= percent;
}

function candidateDedupeKey(v = {}) {
  const normalizedName = String(v.normalized_vessel_name || v.vessel_name || "").normalize("NFKC").toUpperCase().replace(/[^A-Z0-9가-힣]+/g, "");
  const portCode = String(v.port_code || portCodeFromName(v.port || v.port_name) || "");
  const eventDate = String(v.ata || v.eta || v.atd || v.etd || v.first_seen_at || v.collected_at || "").slice(0, 10);
  if (hasValue(v.port_call_id)) return `PORTCALL_ID|${v.port_call_id}`;
  if (hasValue(v.port_call_identity)) return `PORTCALL|${portCode}|${v.port_call_identity}`;
  if (hasValue(v.master_vessel_id) && eventDate) return `MASTER_DATE|${v.master_vessel_id}|${portCode}|${eventDate}`;
  if (hasValue(v.imo) && eventDate) return `IMO_DATE|${v.imo}|${portCode}|${eventDate}`;
  if (hasValue(v.call_sign) && (hasValue(v.etryptYear) || hasValue(v.etryptCo))) return `CALL_PORTCALL|${v.call_sign}|${portCode}|${v.etryptYear || ""}|${v.etryptCo || ""}`;
  if (hasValue(v.call_sign) && eventDate) return `CALL_DATE|${v.call_sign}|${portCode}|${eventDate}`;
  if (normalizedName && eventDate) return `NAME_PORT_DATE|${normalizedName}|${portCode}|${eventDate}`;
  return `NAME_PORT_BERTH|${normalizedName}|${portCode}|${v.berth_name || v.berth || v.anchorage_name || ""}`;
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

function duplicatePortCallDiagnostics(records = []) {
  const groups = new Map();
  records.forEach((record, index) => {
    const key = candidateDedupeKey(record);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ record, index });
  });
  const duplicates = [...groups.entries()].filter(([, rows]) => rows.length > 1);
  const reasonBreakdown = {};
  for (const [key, rows] of duplicates) {
    const reason = key.split("|")[0] || "UNKNOWN";
    reasonBreakdown[reason] = (reasonBreakdown[reason] || 0) + rows.length - 1;
  }
  return {
    duplicate_rows_detected: duplicates.reduce((sum, [, rows]) => sum + rows.length - 1, 0),
    duplicate_rows_removed: duplicates.reduce((sum, [, rows]) => sum + rows.length - 1, 0),
    duplicate_reason_breakdown: reasonBreakdown,
    duplicate_examples: duplicates.slice(0, 10).map(([key, rows]) => ({
      dedupe_key: key,
      row_count: rows.length,
      vessels: rows.slice(0, 5).map(({ record }) => ({
        vessel_name: record.vessel_name || record.name || "",
        call_sign: record.call_sign || "",
        port_code: record.port_code || "",
        port_name: record.port_name || record.port || "",
        ata: record.ata || "",
        eta: record.eta || "",
        atd: record.atd || "",
        source: record.source || record.source_name || record.source_origin || ""
      }))
    }))
  };
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
  const arrivalPrediction = deriveArrivalPredictionFromSignals(merged);
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
  const routeBonus = Number(merged.route_bonus || deriveRouteBonus(merged));
  const biofoulingExposure = deriveBiofoulingExposureEngine(merged);
  const predictedCleaningOpportunityScore = Number(merged.predicted_cleaning_opportunity_score || derivePredictedCleaningOpportunityScore({ ...merged, route_bonus: routeBonus, biofouling_exposure_score: biofoulingExposure.biofouling_exposure_score }));
  const recommendedAction = merged.recommended_action || merged.recommended_next_action || deriveRecommendedNextAction(merged, leadPriorityScore);
  const copilotContext = { ...merged, recommended_action: recommendedAction, recommended_next_action: recommendedAction };
  const recommendedContactPath = merged.recommended_contact_path || deriveRecommendedContactPath(copilotContext);
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
    laidupFcltyNm: merged.laidupFcltyNm || "",
    facility_name: merged.facility_name || "",
    facility_name_raw: merged.facility_name_raw || "",
    facility_type: merged.facility_type || "",
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
    contact_path_status: merged.contact_path_status || deriveContactPathStatus(merged),
    contact_priority: merged.contact_priority || deriveContactPriority(merged),
    contact_path_label_ko: merged.contact_path_label_ko || contactPathLabelKo(merged),
    destination_port: merged.destination_port || merged.destination || merged.next_port || "",
    route_region: merged.route_region || "unknown",
    route_from_port: merged.route_from_port || arrivalPrediction.route_from_port || merged.previous_port || "",
    route_to_port: merged.route_to_port || arrivalPrediction.route_to_port || merged.destination_port || merged.destination || merged.next_port || "",
    route_pattern_known: Boolean(merged.route_pattern_known || arrivalPrediction.route_pattern_known),
    route_pattern_confidence: Number(merged.route_pattern_confidence || arrivalPrediction.route_pattern_confidence || 0),
    avg_transit_hours: Number(merged.avg_transit_hours || arrivalPrediction.avg_transit_hours || 0),
    predicted_arrival_time: merged.predicted_arrival_time || arrivalPrediction.predicted_arrival_time || "",
    arrival_prediction_confidence: Number(merged.arrival_prediction_confidence || arrivalPrediction.arrival_prediction_confidence || 0),
    predicted_congestion: Number(merged.predicted_congestion || 0),
    predicted_cleaning_window: Number(merged.predicted_cleaning_window || 0),
    predicted_congestion_score: Number(merged.predicted_congestion_score || merged.predicted_congestion || derivePredictedCongestionScore(merged)),
    congestion_forecast_band: merged.congestion_forecast_band || forecastBand(merged.predicted_congestion_score || merged.predicted_congestion || derivePredictedCongestionScore(merged)),
    anchorage_probability: Number(merged.anchorage_probability || deriveAnchorageProbability(merged)),
    predicted_work_window_hours: Number(merged.predicted_work_window_hours || merged.work_window_hours || 0),
    work_window_confidence: Number(merged.work_window_confidence || 0),
    calls_last_3m: Number(merged.calls_last_3m || 0),
    calls_last_6m: Number(merged.calls_last_6m || 0),
    calls_last_12m: Number(merged.calls_last_12m || merged.repeat_call_count || merged.observation_count || 0),
    repeat_call_count: Number(merged.repeat_call_count || merged.observation_count || 0),
    repeat_operator_count: Number(merged.repeat_operator_count || 0),
    repeat_caller_score: Number(merged.repeat_caller_score || 0),
    repeat_operator_score: Number(merged.repeat_operator_score || 0),
    operator_call_count: Number(merged.operator_call_count || merged.repeat_operator_count || 0),
    operator_vessel_count: Number(merged.operator_vessel_count || merged.repeat_operator_count || 0),
    operator_port_count: Number(merged.operator_port_count || 0),
    fleet_opportunity_score: Number(merged.fleet_opportunity_score || 0),
    low_speed_exposure: Number(merged.low_speed_exposure || 0),
    idle_exposure: Number(merged.idle_exposure || 0),
    anchorage_exposure: Number(merged.anchorage_exposure || 0),
    biofouling_exposure_score: Number(merged.biofouling_exposure_score || biofoulingExposure.biofouling_exposure_score),
    biofouling_exposure_band: merged.biofouling_exposure_band || biofoulingExposure.biofouling_exposure_band,
    biofouling_exposure_reasons: Array.isArray(merged.biofouling_exposure_reasons) ? merged.biofouling_exposure_reasons : biofoulingExposure.biofouling_exposure_reasons,
    route_bonus: routeBonus,
    predicted_cleaning_opportunity_score: predictedCleaningOpportunityScore,
    cleaning_opportunity_band: merged.cleaning_opportunity_band || cleaningOpportunityBand(predictedCleaningOpportunityScore),
    opportunity_summary: merged.opportunity_summary || deriveOpportunitySummary({ ...merged, biofouling_exposure_score: biofoulingExposure.biofouling_exposure_score, predicted_cleaning_opportunity_score: predictedCleaningOpportunityScore }),
    arrival_opportunity_score: Number(merged.arrival_opportunity_score || arrivalPrediction.arrival_opportunity_score || 0),
    predicted_arrival_window_hours: Number(merged.predicted_arrival_window_hours ?? arrivalPrediction.predicted_arrival_window_hours ?? 0),
    predicted_arrival_pipeline: Boolean(merged.predicted_arrival_pipeline || arrivalPrediction.predicted_arrival_pipeline),
    arrival_prediction_source: merged.arrival_prediction_source || arrivalPrediction.arrival_prediction_source || "",
    contact_intelligence_score: Number(merged.contact_intelligence_score ?? (
      (merged.operator_name || merged.operator ? 3 : 0) +
      (merged.agent_name || merged.agent || merged.satmntEntrpsNm || merged.entrpsCdNm ? 2 : 0) +
      (merged.contact_path_available ? 3 : 0)
    )),
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
    recommended_next_action: recommendedAction,
    recommended_action: recommendedAction,
    action_priority: merged.action_priority || deriveActionPriority(merged, recommendedAction),
    recommended_contact_path: recommendedContactPath,
    recommended_department: merged.recommended_department || deriveRecommendedDepartment(copilotContext),
    recommended_email_draft: merged.recommended_email_draft || deriveRecommendedEmailDraft({ ...copilotContext, recommended_contact_path: recommendedContactPath }),
    recommended_followup_date: merged.recommended_followup_date || deriveRecommendedFollowupDate(copilotContext),
    lead_timeline: Array.isArray(merged.lead_timeline) ? merged.lead_timeline : deriveLeadTimeline(merged),
    last_contacted_at: merged.last_contacted_at || "",
    follow_up_due: merged.follow_up_due || "",
    quote_status: merged.quote_status || "not_started",
    notes: merged.notes || "",
    actual_arrival_time: merged.actual_arrival_time || merged.ata || "",
    prediction_error_hours: merged.prediction_error_hours ?? arrivalPrediction.prediction_error_hours ?? derivePredictionErrorHours({ ...merged, predicted_arrival_time: arrivalPrediction.predicted_arrival_time || merged.predicted_arrival_time }),
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
    data_quality_score: Number(merged.data_quality_score || deriveDataQualityScore(merged)),
    data_quality_band: merged.data_quality_band || (deriveDataQualityScore(merged) >= 80 ? "high" : deriveDataQualityScore(merged) >= 60 ? "medium" : deriveDataQualityScore(merged) >= 40 ? "low" : "needs_cleanup"),
    vessel_basic_info_completeness_score: Number(merged.vessel_basic_info_completeness_score || basicInfoCompleteness(merged)),
    vessel_basic_info_missing_fields: merged.vessel_basic_info_missing_fields || BASIC_INFO_FIELDS.filter(field => !hasValue(merged[field])),
    vessel_spec_enrichment_priority: Boolean(merged.vessel_spec_enrichment_priority),
    status_bucket: merged.status_bucket || deriveStatusBucket(merged),
    is_anchorage_waiting: Boolean(merged.is_anchorage_waiting || (deriveStatusBucket(merged) === "anchorage_waiting")),
    anchorage_detection_source: merged.anchorage_detection_source || anchorageSignalSource(merged),
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

function anchorageSignalSource(v = {}) {
  const facilityText = [
    v.facility_type,
    v.berth_class,
    v.anchorage_class,
    v.anchorage_name,
    v.anchorage_zone,
    v.laidupFcltyNm,
    v.facility_name,
    v.facility_name_raw,
    v.berth_name,
    v.berth,
    v.terminal_name,
    v.status_bucket,
    v.operational_status,
    v.status
  ].filter(Boolean).join(" ").normalize("NFKC");
  if (Number(v.anchorage_hours || 0) > 0) return "anchorage_hours";
  if (String(v.facility_type || v.berth_class || "").toLowerCase() === "anchorage") return "facility_type";
  if (/anchorage|anchor|waiting|outer|drifting|idle|묘박|정박|박지|외항|대기/i.test(facilityText)) return "facility_name";
  if (String(v.status_bucket || "").toLowerCase() === "anchorage_waiting") return "status_bucket";
  return "";
}

function isAnchorageLike(v = {}) {
  return Boolean(anchorageSignalSource(v));
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
  if (isAnchorageLike(v) && !atd) return "anchorage_waiting";
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
  if (isSyntheticSample(v)) return "sample_or_demo_row";
  if (isDepartedRecord(v)) return "departed_or_atd_present";
  if (!hasUsefulVesselIdentity(v)) return "missing_useful_vessel_identity";
  if (status === "excluded_non_commercial_type") return "excluded_non_commercial_type";
  if (status === "non_target_small_vessel" && Number(v.gt || v.grtg || v.intrlGrtg || 0) > 0 && Number(v.gt || v.grtg || v.intrlGrtg || 0) < Number(v.commercial_gt_threshold || 5000)) return "excluded_under_5000gt";
  if (v.excluded_from_commercial_targets === true) return v.exclusion_reason || "explicitly_excluded";
  const score = commercialScore(v);
  if (score >= IMMEDIATE_TARGET_THRESHOLD && !hasCurrentOrNearTermWorkFeasibility(v)) return "missing_current_or_near_term_work_feasibility";
  if (score >= IMMEDIATE_TARGET_THRESHOLD && !withinCommercialPercentile(v, 10)) return "outside_immediate_top_10_percentile";
  if (score >= SALES_CANDIDATE_THRESHOLD && !withinCommercialPercentile(v, 20)) return "outside_sales_top_20_percentile";
  if (score >= 50 && !withinCommercialPercentile(v, 40)) return "outside_watchlist_top_40_percentile";
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
    Number(parts.commercialValueScore ?? commercialScore(v)) * 0.5 +
    Number(parts.contactReadinessScore ?? v.contact_readiness_score ?? deriveContactReadinessScore(v)) * 0.25 +
    Number(parts.workFeasibilityScore ?? v.work_feasibility_score ?? deriveWorkFeasibilityScore(v)) * 0.25
  );
}

function forecastBand(score) {
  const value = Number(score || 0);
  if (value >= 85) return "CRITICAL";
  if (value >= 65) return "HIGH";
  if (value >= 40) return "MEDIUM";
  return "LOW";
}

function derivePredictedCongestionScore(v = {}) {
  const historicalWaiting = Number(v.historical_avg_waiting_hours || v.avg_waiting_hours || 0);
  const historicalStay = Number(v.historical_avg_stay_hours || v.avg_stay_hours || 0);
  const routeCongestion = Number(v.congestion_probability || v.predicted_congestion || 0);
  return boundedScore(
    Math.max(routeCongestion, Number(v.port_congestion_score || v.congestion_score || 0)) +
    (String(v.pilot_direction || v.movement_type || "").toLowerCase() === "inbound" ? 8 : 0) -
    (String(v.pilot_direction || v.movement_type || "").toLowerCase() === "outbound" ? 8 : 0) +
    (Number(v.berth_occupancy_proxy || 0) >= 50 ? 10 : 0) +
    (historicalWaiting >= 120 ? 20 : historicalWaiting >= 72 ? 14 : historicalWaiting >= 48 ? 9 : historicalWaiting >= 24 ? 5 : 0) +
    (historicalStay >= 96 ? 10 : historicalStay >= 48 ? 5 : 0)
  );
}

function deriveAnchorageProbability(v = {}) {
  const type = String([v.vessel_type_group, v.vessel_type, v.commercial_segment].filter(Boolean).join(" ")).toLowerCase();
  const historicalWaiting = Number(v.historical_avg_waiting_hours || v.avg_waiting_hours || 0);
  const routeConfidence = Number(v.route_pattern_confidence || 0);
  return boundedScore(
    derivePredictedCongestionScore(v) * 0.42 +
    Math.min(25, Number(v.anchorage_hours || 0) / 2) +
    (/bulk|bulker|tanker|container|pctc|cruise|lng|lpg/.test(type) ? 12 : 4) +
    (Number(v.gt || 0) >= 80000 ? 14 : Number(v.gt || 0) >= 30000 ? 10 : Number(v.gt || 0) >= 5000 ? 6 : 0) +
    (historicalWaiting >= 120 ? 18 : historicalWaiting >= 72 ? 13 : historicalWaiting >= 48 ? 9 : historicalWaiting >= 24 ? 5 : 0) +
    Math.min(8, Math.round(routeConfidence * 0.08))
  );
}

function deriveBiofoulingExposureScore(v = {}) {
  return deriveBiofoulingExposureEngine(v).biofouling_exposure_score;
}

function deriveRouteBonus(v = {}) {
  const explicit = Number(v.route_bonus || 0);
  if (explicit > 0) return boundedScore(explicit);
  const biosecurity = Number(v.biosecurity_exposure_score || 0);
  const esg = Number(v.esg_sensitivity_score || 0);
  const fuel = Number(v.fuel_efficiency_sensitivity_score || 0);
  const highRoute = highRegulationRoute(v) ? 40 : 0;
  return boundedScore(Math.max(
    highRoute,
    biosecurity * 0.35,
    esg * 0.25,
    fuel * 0.25
  ));
}

function cleaningOpportunityBand(score) {
  const value = Number(score || 0);
  if (value >= 90) return "Exceptional Opportunity";
  if (value >= 75) return "High Opportunity";
  if (value >= 60) return "Potential Opportunity";
  if (value >= 40) return "Watch";
  return "Low";
}

function biofoulingExposureBand(score) {
  const value = Number(score || 0);
  if (value >= 80) return "VERY HIGH";
  if (value >= 60) return "HIGH";
  if (value >= 35) return "MEDIUM";
  return "LOW";
}

function deriveBiofoulingExposureEngine(v = {}) {
  const route = routeRegionText(v);
  const type = String([v.vessel_type_group, v.vessel_type, v.commercial_segment, v.vsslKndNm].filter(Boolean).join(" ")).toLowerCase();
  const gt = Number(v.gt || v.grtg || v.intrlGrtg || 0);
  const anchorageHours = Number(v.anchorage_hours || 0);
  const stayHours = Number(v.cumulative_stay_hours || v.stay_hours || v.current_call_stay_hours || 0);
  const congestion = Number(v.predicted_congestion_score || v.congestion_score || v.port_congestion_score || derivePredictedCongestionScore(v) || 0);
  const idleExposure = Number(v.idle_exposure || Math.min(100, Math.round(Math.min(55, stayHours / 2) + Math.min(35, anchorageHours / 2))));
  const lowSpeedExposure = Number(v.low_speed_exposure || 0);
  const routeExposure = /australia|new zealand|호주|뉴질랜드/.test(route)
    ? 100
    : /brazil|브라질/.test(route)
      ? 85
      : /north_america|california|vancouver|usa|canada|북미|미국|캐나다/.test(route)
        ? 60
        : /europe|mediterranean|유럽|지중해/.test(route)
          ? 50
          : Number(v.biosecurity_exposure_score || 0);
  const vesselTypeExposure = /bulk|bulker|tanker|container|pctc|cruise|lng|lpg|벌크|탱커|컨테이너|자동차|크루즈/.test(type)
    ? 85
    : /general|cargo|화물/.test(type)
      ? 45
      : 25;
  const anchorageExposure = boundedScore(Math.min(90, anchorageHours / 24 * 18) + (v.is_anchorage_waiting ? 10 : 0));
  const stayExposure = boundedScore(Math.min(90, stayHours / 24 * 12) + (stayHours >= 168 ? 10 : 0));
  const gtExposure = gt >= 80000 ? 12 : gt >= 30000 ? 8 : gt >= 5000 ? 4 : 0;
  const score = boundedScore(
    anchorageExposure * 0.30 +
    stayExposure * 0.20 +
    congestion * 0.15 +
    Math.max(idleExposure, lowSpeedExposure) * 0.15 +
    routeExposure * 0.10 +
    vesselTypeExposure * 0.10 +
    gtExposure
  );
  const reasons = [];
  if (anchorageHours >= 72 || anchorageExposure >= 45) reasons.push("LONG_ANCHORAGE_EXPOSURE");
  if (stayHours >= 72) reasons.push("LONG_PORT_STAY");
  if (lowSpeedExposure >= 35 || idleExposure >= 45) reasons.push("LOW_SPEED_EXPOSURE");
  if (congestion >= 40) reasons.push("HIGH_CONGESTION_EXPOSURE");
  if (/australia|new zealand|호주|뉴질랜드/.test(route)) reasons.push("AUSTRALIA_ROUTE");
  if (/brazil|브라질/.test(route)) reasons.push("BRAZIL_ROUTE");
  if (gt >= 30000) reasons.push("HIGH_GT_EXPOSURE");
  return {
    biofouling_exposure_score: score,
    biofouling_exposure_band: biofoulingExposureBand(score),
    biofouling_exposure_reasons: [...new Set(reasons)]
  };
}

function derivePredictedCleaningOpportunityScore(v = {}) {
  return boundedScore(
    commercialScore(v) * 0.25 +
    deriveWorkFeasibilityScore(v) * 0.25 +
    Number(v.biofouling_exposure_score || deriveBiofoulingExposureScore(v)) * 0.20 +
    Math.max(Number(v.anchorage_probability || 0), derivePredictedCongestionScore(v)) * 0.15 +
    Number(v.arrival_opportunity_score || 0) * 0.10 +
    Number(v.contact_readiness_score || deriveContactReadinessScore(v)) * 0.05
  );
}

function deriveOpportunitySummary(v = {}) {
  const fragments = [];
  const gt = Number(v.gt || v.grtg || v.intrlGrtg || 0);
  const type = String(v.vessel_type_group || v.vessel_type || "선종 확인 필요").replace(/_/g, " ");
  const anchorageDays = Number(v.anchorage_hours || 0) / 24;
  const stayDays = Number(v.stay_hours || v.current_call_stay_hours || v.cumulative_stay_hours || 0) / 24;
  if (gt > 0) fragments.push(`GT ${Math.round(gt).toLocaleString("en-US")} ${type}`);
  else fragments.push(`${type} 선박`);
  if (anchorageDays >= 1) fragments.push(`묘박/대기 ${Math.round(anchorageDays * 10) / 10}일`);
  else if (stayDays >= 1) fragments.push(`항만 체류 ${Math.round(stayDays * 10) / 10}일`);
  if (Number(v.biofouling_exposure_score || deriveBiofoulingExposureScore(v)) >= 60) fragments.push("바이오파울링 노출 높음");
  if (deriveWorkFeasibilityScore(v) >= 60) fragments.push("작업 가능성 높음");
  if (Number(v.anchorage_probability || 0) >= 60) fragments.push("묘박 가능성 높음");
  if (String(v.pilot_direction || v.movement_type || "").toLowerCase() !== "outbound" && !v.outbound_pilot_scheduled) fragments.push("출항 도선 미확인");
  if (v.operator_name || v.operator || v.agent_name || v.agent) fragments.push("연락 경로 확인 가능");
  return fragments.slice(0, 5).join(" · ");
}

function normalizePortToken(value = "") {
  return String(value || "")
    .normalize("NFKC")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, " ");
}

function routeTransitHours(fromPort = "", toPort = "", typeGroup = "") {
  const route = `${normalizePortToken(fromPort)} ${normalizePortToken(toPort)} ${String(typeGroup || "").toLowerCase()}`;
  if (/PORT HEDLAND|NEWCASTLE|DAMPIER|GLADSTONE|HAY POINT|AUSTRALIA|호주/.test(route)) return /bulk|ore|cape/.test(route) ? 210 : 190;
  if (/SANTOS|TUBARAO|PONTA DA MADEIRA|BRAZIL|브라질/.test(route)) return /bulk|ore|tanker/.test(route) ? 720 : 680;
  if (/SINGAPORE|싱가포르/.test(route)) return 96;
  if (/SHANGHAI|NINGBO|QINGDAO|TIANJIN|CHINA|중국/.test(route)) return 36;
  if (/YOKOHAMA|KOBE|NAGOYA|JAPAN|일본/.test(route)) return 24;
  if (/VANCOUVER|LOS ANGELES|LONG BEACH|SEATTLE|TACOMA|CALIFORNIA|USA|CANADA|북미|미국|캐나다/.test(route)) return 300;
  if (/ROTTERDAM|HAMBURG|ANTWERP|EUROPE|MEDITERRANEAN|유럽|지중해/.test(route)) return 650;
  return 72;
}

function deriveRoutePatternPrediction(v = {}) {
  const fromPort = normalizePortToken(v.route_from_port || v.previous_port || "");
  const toPort = normalizePortToken(v.route_to_port || v.destination_port || v.destination || v.next_port || v.port_name || v.port || "");
  const typeGroup = v.vessel_type_group || v.vessel_type || "unknown";
  const known = Boolean(fromPort && toPort);
  const avgTransitHours = Number(v.avg_transit_hours || v.historical_avg_transit_hours || 0) || routeTransitHours(fromPort, toPort, typeGroup);
  const confidence = boundedScore(
    Number(v.route_pattern_confidence || 0) ||
    (known ? 42 : 12) +
    (Number(v.repeat_call_count || 0) >= 2 ? 12 : 0) +
    (Number(v.repeat_operator_count || 0) >= 2 ? 8 : 0) +
    (highRegulationRoute(v) ? 8 : 0)
  );
  return {
    route_from_port: fromPort,
    route_to_port: toPort,
    route_pattern_known: known,
    route_pattern_confidence: confidence,
    avg_transit_hours: avgTransitHours
  };
}

function deriveArrivalPredictionFromSignals(v = {}) {
  const routePattern = deriveRoutePatternPrediction(v);
  const explicit = parseDate(v.predicted_arrival_time || v.eta || v.eta_candidate || v.next_port_eta || v.destination_eta || v.pilot_time || v.movement_time);
  let predicted = explicit;
  let source = explicit ? (v.pilot_time || v.movement_time || v.pilot_schedule_matched || v.source_origin === "pilot_schedule" ? "pilot_schedule" : "schedule") : "";
  if (!predicted && v.atd && (v.destination_port || v.next_port || v.destination || routePattern.route_to_port)) {
    const departure = parseDate(v.atd);
    if (departure) {
      predicted = new Date(departure.getTime() + routePattern.avg_transit_hours * 36e5);
      source = "route_pattern";
    }
  }
  const now = new Date();
  const hours = predicted ? Math.round(((predicted.getTime() - now.getTime()) / 36e5) * 10) / 10 : null;
  const type = String(v.vessel_type_group || v.vessel_type || "").toLowerCase();
  const gt = Number(v.gt || v.grtg || v.intrlGrtg || 0);
  const etaProximity = hours === null ? 0 : hours <= 24 && hours >= 0 ? 30 : hours <= 48 && hours >= 0 ? 24 : hours <= 72 && hours >= 0 ? 16 : hours > 72 ? 8 : 0;
  const confidence = boundedScore(
    (source === "pilot_schedule" ? 72 : source === "schedule" ? 58 : source === "route_pattern" ? 38 : 0) +
    Math.round(routePattern.route_pattern_confidence * 0.25) +
    (v.pilot_schedule_matched ? 15 : 0)
  );
  const arrivalOpportunityScore = boundedScore(
    etaProximity +
    (/bulk|tanker|container|pctc|cruise|lng|lpg/.test(type) ? 18 : 8) +
    (gt >= 30000 ? 18 : gt >= 5000 ? 12 : 0) +
    Math.round(derivePredictedCongestionScore(v) * 0.14) +
    (highRegulationRoute(v) ? 10 : 0)
  );
  return {
    ...routePattern,
    predicted_arrival_time: predicted ? predicted.toISOString() : "",
    predicted_arrival_window_hours: hours,
    arrival_prediction_confidence: confidence,
    arrival_prediction_source: source || "insufficient_route_data",
    arrival_opportunity_score: arrivalOpportunityScore,
    predicted_arrival_pipeline: Boolean(predicted && hours !== null && hours >= 0 && hours <= 168 && arrivalOpportunityScore >= 35),
    prediction_error_hours: v.prediction_error_hours ?? (predicted && (v.actual_arrival_time || v.ata) ? derivePredictionErrorHours({ ...v, predicted_arrival_time: predicted.toISOString() }) : null)
  };
}

function predictionEtaBucketHours(v = {}) {
  const predicted = parseDate(v.predicted_arrival_time || v.eta || v.eta_candidate || v.pilot_time || v.movement_time);
  if (!predicted) return null;
  return Math.round(((predicted.getTime() - Date.now()) / 36e5) * 10) / 10;
}

function predictionEtaBucket(v = {}) {
  const hours = predictionEtaBucketHours(v);
  if (hours === null) return "ETA_UNKNOWN";
  if (hours >= 0 && hours <= 24) return "ETA_LT_24H";
  if (hours >= 0 && hours <= 72) return "ETA_LT_72H";
  if (hours >= 0 && hours <= 168) return "ETA_LT_7D";
  return "ETA_FUTURE";
}

function buildPortPredictionContext(records = []) {
  const byPort = new Map();
  for (const record of records.filter(v => !isDepartedRecord(v))) {
    const key = String(record.port_code || record.port_name || record.port || "unknown");
    const current = byPort.get(key) || {
      vessels: 0,
      anchorage: 0,
      staying: 0,
      berthOccupied: 0,
      inboundPilot: 0,
      outboundPilot: 0,
      congestionTotal: 0,
      stayTotal: 0,
      waitTotal: 0
    };
    current.vessels += 1;
    if (isAnchorageLike(record)) current.anchorage += 1;
    if (["arrived_staying", "berthed", "anchorage_waiting"].includes(record.status_bucket) || (record.ata && !record.atd)) current.staying += 1;
    if (Number(record.berth_occupancy_proxy || 0) >= 50 || /active|working|cargo|loading|discharging|작업|하역|진행/.test(String(record.terminal_activity || "").toLowerCase())) current.berthOccupied += 1;
    if (String(record.pilot_direction || record.movement_type || "").toLowerCase() === "inbound") current.inboundPilot += 1;
    if (String(record.pilot_direction || record.movement_type || "").toLowerCase() === "outbound") current.outboundPilot += 1;
    current.congestionTotal += Number(record.congestion_score || record.port_congestion_score || 0);
    current.stayTotal += Number(record.stay_hours || record.current_call_stay_hours || 0);
    current.waitTotal += Number(record.anchorage_hours || 0);
    byPort.set(key, current);
  }
  for (const context of byPort.values()) {
    context.avgCongestion = context.vessels ? Math.round(context.congestionTotal / context.vessels) : 0;
    context.avgStayHours = context.staying ? Math.round(context.stayTotal / Math.max(1, context.staying)) : 0;
    context.avgWaitingHours = context.anchorage ? Math.round(context.waitTotal / Math.max(1, context.anchorage)) : 0;
    context.futureCongestionScore = boundedScore(
      context.avgCongestion * 0.35 +
      Math.min(28, context.anchorage * 5) +
      Math.min(20, context.staying * 3) +
      Math.min(18, context.inboundPilot * 6) -
      Math.min(12, context.outboundPilot * 4) +
      Math.min(14, context.berthOccupied * 4)
    );
  }
  return byPort;
}

function enhancePredictiveArrivalIntelligence(records = []) {
  const portContext = buildPortPredictionContext(records);
  return records.map(record => {
    const key = String(record.port_code || record.port_name || record.port || "unknown");
    const context = portContext.get(key) || {};
    const etaHours = predictionEtaBucketHours(record);
    const gt = Number(record.gt || record.grtg || record.intrlGrtg || 0);
    const type = String([record.vessel_type_group, record.vessel_type, record.commercial_segment].filter(Boolean).join(" ")).toLowerCase();
    const commercialType = /bulk|bulker|tanker|container|pctc|cruise|lng|lpg/.test(type);
    const predictionError = Number(record.prediction_error_hours);
    const feedbackBoost = Number.isFinite(predictionError)
      ? predictionError <= 12 ? 10 : predictionError <= 24 ? 5 : predictionError >= 72 ? -15 : -5
      : 0;
    const routeConfidence = Number(record.route_pattern_confidence || 0);
    const predictedCongestionScore = boundedScore(Math.max(
      Number(record.predicted_congestion_score || record.predicted_congestion || 0),
      Number(context.futureCongestionScore || 0)
    ) + (etaHours !== null && etaHours >= 0 && etaHours <= 72 ? 5 : 0));
    const anchorageProbability = boundedScore(Math.max(Number(record.anchorage_probability || 0), (
      predictedCongestionScore * 0.45 +
      Math.min(20, Number(context.avgWaitingHours || 0) / 4) +
      (commercialType ? 12 : 4) +
      (gt >= 80000 ? 12 : gt >= 30000 ? 9 : gt >= 5000 ? 5 : 0)
    )));
    const etdDate = record.etd && !record.atd ? parseDate(record.etd) : null;
    const predictedWorkWindowHours = Number(record.predicted_work_window_hours || 0) ||
      (etdDate ? Math.max(0, Math.round((etdDate.getTime() - Date.now()) / 36e5 || 0)) : 0) ||
      (String(record.pilot_direction || record.movement_type || "").toLowerCase() === "outbound" ? 0 : Math.min(96, Math.max(12, Number(context.avgStayHours || context.avgWaitingHours || record.stay_hours || 0) / 2)));
    const etaProximityScore = etaHours === null ? 0 : etaHours >= 0 && etaHours <= 24 ? 30 : etaHours <= 72 ? 24 : etaHours <= 168 ? 14 : 0;
    const arrivalOpportunityScore = boundedScore(Math.max(Number(record.arrival_opportunity_score || 0), (
      etaProximityScore +
      (gt >= 80000 ? 18 : gt >= 30000 ? 14 : gt >= 5000 ? 9 : 0) +
      (commercialType ? 14 : 5) +
      Math.round(predictedCongestionScore * 0.16) +
      Math.round(anchorageProbability * 0.12) +
      Math.min(12, Number(record.route_bonus || deriveRouteBonus(record))) +
      (record.operator_name || record.operator ? 4 : 0)
    )));
    return {
      ...record,
      predicted_congestion_score: predictedCongestionScore,
      congestion_forecast_band: forecastBand(predictedCongestionScore),
      anchorage_probability: anchorageProbability,
      predicted_work_window_hours: predictedWorkWindowHours,
      work_window_confidence: boundedScore(Number(record.work_window_confidence || 0) || (predictedWorkWindowHours > 0 ? 45 : 15) + (record.pilot_schedule_matched ? 15 : 0)),
      arrival_opportunity_score: arrivalOpportunityScore,
      arrival_prediction_confidence: boundedScore(Math.max(Number(record.arrival_prediction_confidence || 0), 25) + Math.round(routeConfidence * 0.15) + (record.pilot_schedule_matched ? 15 : 0) + feedbackBoost),
      predicted_arrival_window_hours: etaHours,
      predicted_arrival_pipeline: Boolean(record.predicted_arrival_pipeline || record.status_bucket === "arriving_soon" || (etaHours !== null && etaHours >= 0 && etaHours <= 168 && arrivalOpportunityScore >= 35)),
      route_pattern_confidence: boundedScore(routeConfidence + feedbackBoost),
      route_pattern_confidence_adjustment: feedbackBoost,
      prediction_feedback_status: Number.isFinite(predictionError) ? predictionError <= 24 ? "accurate" : "needs_calibration" : "pending_actual_arrival"
    };
  });
}

function deriveLeadStatus(v = {}, leadPriorityScore = deriveLeadPriorityScore(v)) {
  const existing = String(v.lead_status || "").toLowerCase();
  if (["contacted", "quoted", "scheduled", "won", "lost"].includes(existing)) return existing;
  if (leadPriorityScore >= IMMEDIATE_TARGET_THRESHOLD && (v.contact_path_available || ["contact_available", "high_confidence_contact"].includes(v.contact_path_status) || Number(v.contact_readiness_score || 0) >= 50)) return "contact_ready";
  if (commercialScore(v) >= IMMEDIATE_TARGET_THRESHOLD) return "new_lead";
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
  const port = v.port_name || v.port || "해당 항만";
  const berth = v.anchorage_name || v.berth_name || v.berth || v.laidupFcltyNm || "";
  const typeText = String(v.vessel_type_group || v.vessel_type || v.vsslKndNm || "상선")
    .replace(/bulk_carrier|bulk/i, "벌크선")
    .replace(/crude_tanker/i, "원유운반선")
    .replace(/product_tanker/i, "석유제품운반선")
    .replace(/tanker/i, "탱커")
    .replace(/container/i, "컨테이너선")
    .replace(/pctc/i, "자동차운반선")
    .replace(/lng_lpg|lng|lpg/i, "가스운반선");
  const stayHours = Number(v.stay_hours || v.current_call_stay_hours || 0);
  const anchorageHours = Number(v.anchorage_hours || 0);
  const workWindowHours = Number(v.work_window_hours || 0);
  const gt = Number(v.gt || v.grtg || v.intrlGrtg || 0);
  const score = Number(v.commercial_value_score || v.total_sales_priority_score || 0);
  const congestion = Number(v.congestion_score || v.port_congestion_score || v.congestion_exposure_score || 0);
  const workFeasibility = Number(v.work_feasibility_score || v.cleaning_window_score || 0);
  const location = berth ? `${port} ${berth}` : port;
  const duration = anchorageHours >= 24 || v.is_anchorage_waiting
    ? `묘박/대기 ${Math.round(anchorageHours / 24 * 10) / 10}일째`
    : stayHours >= 24
      ? `체류 ${Math.round(stayHours / 24 * 10) / 10}일째`
      : "현재 항만 체류 중";
  const vesselValue = gt >= 5000 ? `GT ${Math.round(gt).toLocaleString("ko-KR")} ${typeText}` : `${typeText}`;
  const signals = [];
  if (!v.atd && (stayHours > 0 || anchorageHours > 0)) signals.push("아직 출항 완료가 확인되지 않았습니다");
  if (workWindowHours > 0) signals.push(`출항 전 약 ${Math.round(workWindowHours)}시간의 작업 가능 시간이 보입니다`);
  if (!v.outbound_pilot_scheduled && !/outbound/i.test(String(v.pilot_direction || v.movement_type || ""))) signals.push("출항도선 신호가 강하지 않습니다");
  if (workFeasibility >= 60) signals.push("작업 가능성이 높습니다");
  if (congestion >= 50) signals.push("체선/대기 신호가 누적되고 있습니다");
  if (highRegulationRoute(v)) signals.push("민감 항로 신호가 있습니다");
  if (v.agent_name || v.agent || v.operator_name || v.operator) signals.push("연락 경로 단서가 있습니다");
  if (score >= 75) signals.push("상업 가치 점수가 즉시 검토권입니다");
  return `${location}에서 ${duration}인 ${vesselValue}으로, ${signals.slice(0, 3).join(" · ") || "상업 신호 보강이 필요합니다"}.`;
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

function deriveDataQualityScore(v = {}) {
  const vesselType = String(v.vessel_type_group || v.vessel_type || v.vsslKndNm || "").toLowerCase();
  const hasVesselType = Boolean(vesselType && vesselType !== "unknown");
  const hasGt = Number(v.gt || v.grtg || v.intrlGrtg || 0) > 0;
  const hasBerthFacility = Boolean(v.berth_name || v.berth || v.anchorage_name || v.anchorage_zone || v.laidupFcltyNm || v.facility_name_raw);
  let score = 0;
  if (hasGt) score += 16;
  if (v.imo) score += 14;
  if (v.call_sign) score += 14;
  if (hasVesselType) score += 12;
  if (v.ata) score += 12;
  if (v.atd || v.etd) score += 10;
  if (hasBerthFacility) score += 12;
  if (v.operator_name || v.operator) score += 10;
  if (v.agent_name || v.agent || v.satmntEntrpsNm || v.entrpsCdNm) score += 10;
  return Math.min(100, score);
}

function isAlertCandidate(v = {}) {
  return Number(v.gt || v.grtg || v.intrlGrtg || 0) >= 50000 ||
    Number(v.anchorage_hours || 0) >= 48 ||
    commercialScore(v) >= IMMEDIATE_TARGET_THRESHOLD ||
    (String(v.pilot_direction || v.movement_type || "").toLowerCase() !== "outbound" && !v.outbound_pilot_scheduled && Number(v.predicted_cleaning_opportunity_score || 0) >= 60);
}

function deriveRecommendedNextAction(v = {}, leadPriorityScore = deriveLeadPriorityScore(v)) {
  const outboundSoon = String(v.pilot_direction || v.movement_type || "").toLowerCase() === "outbound" || (v.etd && !v.atd && Number(v.work_window_hours || 0) <= 12);
  const score = commercialScore(v);
  const contactReadiness = Number(v.contact_readiness_score || 0);
  const workFeasibility = Number(v.work_feasibility_score || v.cleaning_window_score || 0);
  const arrivalWindow = Number(v.predicted_arrival_window_hours);
  if (outboundSoon) return "도선/출항 전 재확인";
  if (Number.isFinite(arrivalWindow) && arrivalWindow > 0 && arrivalWindow <= 48) return "ETA 48h 전 연락";
  if (!hasValue(v.agent_name || v.agent)) return "대리점 확인";
  if (!hasValue(v.operator_name || v.operator)) return "운영선사 확인";
  if (score >= IMMEDIATE_TARGET_THRESHOLD && contactReadiness >= 60 && workFeasibility >= 50) return "견적 발송";
  if (leadPriorityScore >= IMMEDIATE_TARGET_THRESHOLD || score >= IMMEDIATE_TARGET_THRESHOLD) return "대리점 확인 후 견적 제안";
  if (score >= SALES_CANDIDATE_THRESHOLD) return "선박 스케줄 확인 후 영업 검토";
  return "선박 스케줄 확인";
}

function deriveActionPriority(v = {}, action = "") {
  const score = commercialScore(v);
  const workFeasibility = Number(v.work_feasibility_score || v.cleaning_window_score || 0);
  const contactReadiness = Number(v.contact_readiness_score || 0);
  const arrivalWindow = Number(v.predicted_arrival_window_hours);
  if (/견적 발송|출항 전 재확인/.test(action)) return "HIGH";
  if (score >= IMMEDIATE_TARGET_THRESHOLD && (workFeasibility >= 50 || contactReadiness >= 60)) return "HIGH";
  if (Number.isFinite(arrivalWindow) && arrivalWindow > 0 && arrivalWindow <= 48) return "HIGH";
  if (/대리점 확인|운영선사 확인|ETA 48h 전 연락/.test(action)) return "MEDIUM";
  if (score >= SALES_CANDIDATE_THRESHOLD) return "MEDIUM";
  return "LOW";
}

function deriveRecommendedContactPath(v = {}) {
  const operator = v.operator_name || v.operator || "";
  const agent = v.agent_name || v.agent || v.satmntEntrpsNm || v.entrpsCdNm || "";
  if (operator && agent) return `${agent} 경유 ${operator} 담당팀`;
  if (agent) return `${agent} 대리점/신고업체`;
  if (operator) return `${operator} 운영선사 담당팀`;
  return "대리점/운영선사 확인 필요";
}

function deriveRecommendedDepartment(v = {}) {
  const action = v.recommended_action || v.recommended_next_action || "";
  const type = String([v.vessel_type_group, v.vessel_type, v.commercial_segment].filter(Boolean).join(" ")).toLowerCase();
  if (/견적|선체|biofouling|cii|performance|technical|벌크|탱커|container|bulk|tanker|pctc|cruise/.test(`${action} ${type}`)) return "Technical / Fleet Management";
  if (/eta|스케줄|도선|출항|입항|operation|ops/.test(action)) return "Operations";
  if (/대리점|agent/.test(action)) return "Port Agent / Operations";
  return "Operations / Technical";
}

function deriveRecommendedFollowupDate(v = {}) {
  const arrivalWindow = Number(v.predicted_arrival_window_hours);
  const workWindow = Number(v.work_window_hours || v.predicted_work_window_hours || 0);
  const action = v.recommended_action || v.recommended_next_action || "";
  const days = /출항 전|견적 발송/.test(action) || workWindow > 0
    ? 1
    : Number.isFinite(arrivalWindow) && arrivalWindow > 48
      ? Math.max(1, Math.min(5, Math.floor((arrivalWindow - 48) / 24)))
      : commercialScore(v) >= IMMEDIATE_TARGET_THRESHOLD
        ? 1
        : 3;
  return new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
}

function deriveRecommendedEmailDraft(v = {}) {
  const vessel = v.vessel_name || "해당 선박";
  const port = v.port_name || v.port || "한국 항만";
  const why = v.why_now || deriveWhyNow(v);
  const action = v.recommended_action || v.recommended_next_action || "선박 스케줄 확인";
  const contactPath = v.recommended_contact_path || deriveRecommendedContactPath(v);
  return `안녕하세요.\n\n${vessel} 관련하여 ${port} 기항 중 수중 선체관리 가능성을 검토하고 있습니다.\n${why}\n\n권장 다음 단계: ${action}\n연락 경로: ${contactPath}\n\n가능하시면 현재 작업/출항 일정과 선체관리 검토 가능 여부를 확인 부탁드립니다.`;
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
    isAnchorageLike(v) ||
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

async function fetchLatestCompletedRunPointer(env, diagnostics = []) {
  const completed = await supabaseGet(env, "/rest/v1/data_collection_runs?select=run_id,finished_at,promoted_at,status,total_rows,raw_collected_rows,normalized_rows,all_vessels_count,candidates_count,immediate_targets_count&status=in.(completed,promoted)&or=(all_vessels_count.gt.0,total_rows.gt.0,raw_collected_rows.gt.0,normalized_rows.gt.0)&order=finished_at.desc.nullslast&order=promoted_at.desc.nullslast&limit=1");
  diagnostics.push({ source: "latest_completed_real_run", ok: completed.ok, status: completed.status, row_count: completed.rows.length, error: completed.error });
  const run = completed.rows[0] || null;
  if (!run?.run_id) return null;
  return {
    configured: true,
    active_run_id: run.run_id,
    active_collected_at: run.finished_at || run.promoted_at || null,
    promoted_at: run.promoted_at || null,
    is_stale: true,
    auth_key_type: completed.keyType || supabaseBase(env)?.keyType || "unknown",
    pointer_source: "latest_completed_real_run",
    pointer_diagnostics: diagnostics,
    fallback_pointer: true,
    latest_completed_run: true,
    latest_run_status: run.status || null,
    latest_run_row_count: Number(run.all_vessels_count || run.total_rows || run.raw_collected_rows || run.normalized_rows || 0),
    error: null
  };
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

  const completedPointer = await fetchLatestCompletedRunPointer(env, diagnostics);
  if (completedPointer?.active_run_id) return completedPointer;

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
    error: active.error || latestRun.error || legacy.error || "missing_active_dataset",
    pointer_source: "none",
    auth_key_type: base.keyType,
    pointer_diagnostics: diagnostics
  };
}

async function fetchSupabaseRows(env) {
  if (!supabaseBase(env)) {
    const local = await fetchLocalStaticSnapshot(env, "missing_supabase_binding");
    if (local.rows.length) return local;
    return {
      rows: [],
      configured: false,
      error: "missing_supabase_binding",
      data_source_used: "diagnostics_only_no_live_data",
      fallback_used: false,
      fallback_reason: "missing_supabase_binding"
    };
  }
  const pointer = await fetchActivePointer(env);
  if (!pointer.active_run_id && !pointer.legacy_latest) {
    const local = await fetchLocalStaticSnapshot(env, pointer.error || "missing_active_dataset");
    if (local.rows.length) return { ...local, configured: pointer.configured, pointer: { ...local.pointer, supabase_pointer_error: pointer.error || null } };
    return {
      rows: [],
      configured: pointer.configured,
      error: pointer.error || "missing_active_dataset",
      pointer,
      data_source_used: "diagnostics_only_no_live_data",
      fallback_used: false,
      fallback_reason: pointer.error || "missing_active_dataset"
    };
  }

  const query = pointer.legacy_latest
    ? "/rest/v1/vessel_snapshots?select=*&order=collected_at.desc&limit=5000"
    : `/rest/v1/vessel_snapshots?select=*&run_id=eq.${encodeURIComponent(pointer.active_run_id)}&order=collected_at.desc&limit=5000`;
  const response = await supabaseGet(env, query);
  if (response.ok && response.rows.length) {
    return {
      rows: response.rows.map(normalizeSnapshot).map(enrichCumulativeStay),
      configured: true,
      error: null,
      pointer,
      data_source_used: pointer.legacy_latest || pointer.fallback_pointer ? "supabase_latest_snapshot_fallback" : "supabase_active_dataset",
      fallback_used: Boolean(pointer.legacy_latest || pointer.fallback_pointer),
      fallback_reason: pointer.legacy_latest || pointer.fallback_pointer ? pointer.pointer_source || "supabase_latest_snapshot_fallback" : null
    };
  }

  if (!pointer.legacy_latest) {
    const completedPointer = await fetchLatestCompletedRunPointer(env, pointer.pointer_diagnostics || []);
    if (completedPointer?.active_run_id && completedPointer.active_run_id !== pointer.active_run_id) {
      const completedRows = await supabaseGet(env, `/rest/v1/vessel_snapshots?select=*&run_id=eq.${encodeURIComponent(completedPointer.active_run_id)}&order=collected_at.desc&limit=5000`);
      if (completedRows.ok && completedRows.rows.length) {
        return {
          rows: completedRows.rows.map(normalizeSnapshot).map(enrichCumulativeStay),
          configured: true,
          error: null,
          pointer: {
            ...completedPointer,
            active_dataset_error: response.ok ? null : response.error,
            active_dataset_empty: response.ok && response.rows.length === 0
          },
          data_source_used: "supabase_latest_completed_run_fallback",
          fallback_used: true,
          fallback_reason: response.ok && response.rows.length === 0 ? "active_dataset_empty" : response.error || "active_dataset_failed"
        };
      }
    }

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
      return {
        rows: fallback.rows.map(normalizeSnapshot).map(enrichCumulativeStay),
        configured: true,
        error: null,
        pointer: fallbackPointer,
        data_source_used: "supabase_latest_snapshot_fallback",
        fallback_used: true,
        fallback_reason: "active_dataset_empty_or_failed"
      };
    }
    const local = await fetchLocalStaticSnapshot(env, response.error || fallback.error || "empty_active_dataset");
    if (local.rows.length) return { ...local, configured: true, pointer: { ...local.pointer, supabase_pointer_error: response.error || fallback.error || null } };
    return {
      rows: [],
      configured: true,
      error: response.error || fallback.error || "empty_active_dataset",
      pointer: fallbackPointer,
      data_source_used: "diagnostics_only_no_live_data",
      fallback_used: false,
      fallback_reason: response.error || fallback.error || "empty_active_dataset"
    };
  }

  const local = await fetchLocalStaticSnapshot(env, response.ok ? "empty_active_dataset" : response.error);
  if (local.rows.length) return { ...local, configured: true, pointer: { ...local.pointer, supabase_pointer_error: response.ok ? null : response.error } };
  if (!response.ok) return {
    rows: [],
    configured: true,
    error: response.error,
    pointer,
    data_source_used: "diagnostics_only_no_live_data",
    fallback_used: false,
    fallback_reason: response.error
  };
  return {
    rows: [],
    configured: true,
    error: "empty_active_dataset",
    pointer,
    data_source_used: "diagnostics_only_no_live_data",
    fallback_used: false,
    fallback_reason: "empty_active_dataset"
  };
}

async function fetchAssetJson(env, path) {
  if (!env?.ASSETS?.fetch) return null;
  try {
    const response = await env.ASSETS.fetch(new Request(`https://local-assets.invalid${path}`));
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

async function fetchLocalStaticSnapshot(env, reason = "supabase_unavailable") {
  const vesselsPayload = await fetchAssetJson(env, "/api/vessels.json");
  const statusPayload = await fetchAssetJson(env, "/api/status.json");
  const rows = Array.isArray(vesselsPayload)
    ? vesselsPayload
    : Array.isArray(vesselsPayload?.data)
      ? vesselsPayload.data
      : Array.isArray(vesselsPayload?.vessels)
        ? vesselsPayload.vessels
        : [];
  const normalizedRows = rows.map(normalizeSnapshot).map(enrichCumulativeStay);
  return {
    rows: normalizedRows,
    configured: false,
    error: normalizedRows.length ? null : reason,
    pointer: {
      active_run_id: statusPayload?.run_id || normalizedRows.find(row => row.run_id)?.run_id || null,
      active_collected_at: statusPayload?.completed_at || statusPayload?.generated_at || null,
      promoted_at: null,
      is_stale: true,
      pointer_source: "local_static_snapshot",
      fallback_pointer: true,
      local_static_snapshot: true
    },
    local_status: statusPayload || null,
    data_source_used: normalizedRows.length ? "local_static_snapshot" : "diagnostics_only_no_live_data",
    fallback_used: normalizedRows.length > 0,
    fallback_reason: normalizedRows.length ? reason : "no_local_static_snapshot_rows"
  };
}

async function fetchLatestSummarySnapshot(env) {
  const response = await supabaseGet(env, "/rest/v1/dashboard_summary_snapshots?select=*&status=eq.success&order=generated_at.desc&limit=100");
  if (!response.ok || !response.rows.length) return null;
  const latest = response.rows[0];
  const commercialCount = row => Number(row?.sales_target_count || row?.opportunity_count || row?.immediate_target_count || 0);
  const bestCommercial = response.rows
    .filter(row => commercialCount(row) > 0)
    .sort((a, b) =>
      commercialCount(b) - commercialCount(a) ||
      Number(b.all_vessels_count || b.record_count || 0) - Number(a.all_vessels_count || a.record_count || 0)
    )[0];
  if (bestCommercial && commercialCount(latest) === 0) {
    return {
      ...bestCommercial,
      fallback_reason: "latest_summary_sales_target_drop_guard",
      guarded_latest_run_id: latest.run_id,
      guarded_latest_sales_target_count: Number(latest.sales_target_count || 0),
      guarded_reference_sales_target_count: Number(bestCommercial.sales_target_count || bestCommercial.opportunity_count || 0)
    };
  }
  const bestRecent = response.rows
    .slice()
    .sort((a, b) => Number(b.all_vessels_count || b.record_count || 0) - Number(a.all_vessels_count || a.record_count || 0))[0];
  const latestCount = Number(latest.all_vessels_count || latest.record_count || 0);
  const bestCount = Number(bestRecent?.all_vessels_count || bestRecent?.record_count || 0);
  if (bestRecent && bestCount >= 100 && latestCount > 0 && latestCount < bestCount * 0.5) {
    return {
      ...bestRecent,
      fallback_reason: "latest_summary_count_drop_guard",
      guarded_latest_run_id: latest.run_id,
      guarded_latest_count: latestCount,
      guarded_reference_count: bestCount
    };
  }
  return latest;
}

async function fetchSummarySnapshotByRun(env, runId) {
  if (!runId) return null;
  const response = await supabaseGet(env, `/rest/v1/dashboard_summary_snapshots?select=*&run_id=eq.${encodeURIComponent(runId)}&limit=1`);
  return response.ok && response.rows.length ? response.rows[0] : null;
}

function isBetterSnapshotRepresentative(next = {}, current = {}) {
  return commercialScore(next) > commercialScore(current) ||
    (commercialScore(next) === commercialScore(current) && deriveCongestionScore(next) > deriveCongestionScore(current)) ||
    (commercialScore(next) === commercialScore(current) && deriveCongestionScore(next) === deriveCongestionScore(current) && Number(next.data_confidence_score || 0) > Number(current.data_confidence_score || 0)) ||
    (commercialScore(next) === commercialScore(current) && deriveCongestionScore(next) === deriveCongestionScore(current) && Number(next.data_confidence_score || 0) === Number(current.data_confidence_score || 0) && candidateTimestamp(next) > candidateTimestamp(current));
}

function snapshotRepresentativeKey(record = {}, index = 0) {
  const portCode = String(record.port_code || portCodeFromName(record.port || record.port_name) || "");
  if (hasValue(record.port_call_id)) return `PORTCALL_ID|${record.port_call_id}`;
  if (hasValue(record.port_call_identity)) return `PORTCALL|${portCode}|${record.port_call_identity}`;
  const eventDate = String(record.ata || record.eta || record.atd || record.etd || record.first_seen_at || record.collected_at || "").slice(0, 10);
  if (hasValue(record.master_vessel_id) && hasValue(record.ata || record.eta || record.etryptYear || record.etryptCo)) {
    return `MASTER_TIME|${record.master_vessel_id}|${portCode}|${record.ata || record.eta || record.etryptYear || ""}|${record.etryptCo || ""}`;
  }
  if (hasValue(record.call_sign) && hasValue(record.etryptYear || record.etryptCo)) {
    return `CALL_PORTCALL|${record.call_sign}|${portCode}|${record.etryptYear || ""}|${record.etryptCo || ""}`;
  }
  if (hasValue(record.call_sign) && eventDate) return `CALL_DATE|${record.call_sign}|${portCode}|${eventDate}`;
  const normalizedName = String(record.normalized_vessel_name || record.vessel_name || record.name || "")
    .normalize("NFKC")
    .toUpperCase()
    .replace(/[^A-Z0-9가-힣]+/g, "");
  if (normalizedName && eventDate) return `NAME_PORT_DATE|${normalizedName}|${portCode}|${eventDate}`;
  if (hasValue(record.snapshot_id)) return `SNAPSHOT|${record.snapshot_id}`;
  return `NAME_PORT_TIME|${normalizedName || record.hybrid_entity_key || record.vessel_id || `ROW-${index}`}|${portCode}|${index}`;
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
    const rawPort = v.port_name || v.port || "";
    const portCode = normalizePortCode(v.port_code || portCodeFromName(rawPort));
    if (portCode === "unknown") continue;
    const port = representativePortName(portCode, rawPort);
    const p = map.get(portCode) || { port, port_name: port, port_name_ko: port, port_code: portCode, total: 0, vessel_count: 0, target_vessels: 0, target_vessel_count: 0, waiting: 0, anchorage_waiting: 0, anchorage_vessels: 0, long_stay: 0, long_idle_vessels: 0, long_stay_vessels: 0, high_biofouling: 0, immediate: 0, immediate_targets: 0, immediate_target_count: 0, score: 0, waiting_hours_total: 0, berth_hours_total: 0 };
    p.total += 1;
    p.vessel_count += 1;
    p.target_vessels += 1;
    p.target_vessel_count += 1;
    if (isAnchorageLike(v) || (v.anchorage_hours || 0) >= 12) {
      p.waiting += 1;
      p.anchorage_waiting += 1;
      p.anchorage_vessels += 1;
    }
    if (v.is_long_idle || (v.stay_hours || 0) >= 168) {
      p.long_stay += 1;
      p.long_idle_vessels += 1;
      p.long_stay_vessels += 1;
    }
    if ((v.biofouling_score || 0) >= 70) p.high_biofouling += 1;
    if (v.is_immediate_candidate || isImmediateTarget(v)) {
      p.immediate += 1;
      p.immediate_targets += 1;
      p.immediate_target_count += 1;
    }
    p.waiting_hours_total += Number(v.anchorage_hours || 0);
    p.berth_hours_total += Number(v.berth_hours || 0);
    p.score += v.port_congestion_score || v.operational_risk_score || v.biofouling_score || 0;
    map.set(portCode, p);
  }
  return [...map.values()].map(p => ({
    ...p,
    average_waiting_time: p.waiting ? Math.round((p.waiting_hours_total / p.waiting) * 10) / 10 : 0,
    berth_occupancy: p.total ? Math.min(100, Math.round((p.berth_hours_total / Math.max(1, p.total * 24)) * 100)) : 0,
    anchorage_density: p.total ? Math.min(100, Math.round((p.anchorage_vessels / p.total) * 100)) : 0,
    congestion_score: p.total ? Math.min(100, Math.round(p.score / p.total + p.waiting * 4 + p.long_stay * 5 + p.immediate * 8)) : 0
  })).sort((a, b) => b.congestion_score - a.congestion_score);
}

function buildPortOpportunityRanking(records = []) {
  const map = new Map();
  for (const v of activeRecordsOnly(records).filter(hasUsefulVesselIdentity)) {
    const portName = v.port_name || v.port || "Unknown";
    const portCode = normalizePortCode(v.port_code || portCodeFromName(portName));
    if (portCode === "unknown") continue;
    const key = portCode;
    const displayPortName = representativePortName(portCode, portName);
    const p = map.get(key) || {
      port_code: portCode,
      port_name: displayPortName,
      port_name_ko: displayPortName,
      vessel_count: 0,
      target_vessels: 0,
      target_vessel_count: 0,
      high_value_vessels: 0,
      anchorage_waiting: 0,
      anchorage_vessels: 0,
      work_window_hours_total: 0,
      work_window_count: 0,
      operator_known_count: 0,
      agent_known_count: 0,
      immediate_targets: 0,
      immediate_target_count: 0,
      sales_candidates: 0
    };
    const score = commercialScore(v);
    const gt = Number(v.gt || v.grtg || v.intrlGrtg || 0);
    const workWindowHours = Number(v.work_window_hours || v.predicted_work_window_hours || 0);
    p.vessel_count += 1;
    p.target_vessels += 1;
    p.target_vessel_count += 1;
    if (score >= 75 || gt >= 30000 || v.high_value_target) p.high_value_vessels += 1;
    if (isAnchorageLike(v)) {
      p.anchorage_waiting += 1;
      p.anchorage_vessels += 1;
    }
    if (workWindowHours > 0) {
      p.work_window_hours_total += workWindowHours;
      p.work_window_count += 1;
    }
    if (hasValue(v.operator_name || v.operator)) p.operator_known_count += 1;
    if (hasValue(v.agent_name || v.agent || v.satmntEntrpsNm || v.entrpsCdNm)) p.agent_known_count += 1;
    if (isImmediateTarget(v)) {
      p.immediate_targets += 1;
      p.immediate_target_count += 1;
    }
    if (isSalesCandidate(v)) p.sales_candidates += 1;
    map.set(key, p);
  }
  return [...map.values()].map(p => {
    const avgWorkWindow = p.work_window_count ? Math.round((p.work_window_hours_total / p.work_window_count) * 10) / 10 : 0;
    const operatorQuality = p.vessel_count ? Math.round(((p.operator_known_count * 0.65 + p.agent_known_count * 0.35) / p.vessel_count) * 100) : 0;
    const portOpportunityScore = Math.min(100, Math.round(
      Math.min(35, p.high_value_vessels * 7) +
      Math.min(25, p.anchorage_waiting * 6) +
      Math.min(20, avgWorkWindow * 0.8) +
      Math.min(15, operatorQuality * 0.15) +
      Math.min(10, p.immediate_targets * 5)
    ));
    return {
      ...p,
      average_work_window_hours: avgWorkWindow,
      work_window_hours: avgWorkWindow,
      operator_quality: operatorQuality,
      port_opportunity_score: portOpportunityScore
    };
  }).sort((a, b) =>
    b.port_opportunity_score - a.port_opportunity_score ||
    b.immediate_targets - a.immediate_targets ||
    b.high_value_vessels - a.high_value_vessels ||
    b.anchorage_waiting - a.anchorage_waiting
  );
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
    focus_question: "지금 어떤 선박에 연락해야 하며, 그 이유는 무엇인가?",
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
  const queue = buildUnknownImo(target);
  const recovered = records.filter(v => v.imo && (v.imo_recovered_from_seed || v.imo_recovered_from_cache || v.vessel_master_seed_match || v.recovery_source || v.imo_recovery_source));
  const denominator = recovered.length + queue.length;
  return {
    total_vessels: records.length,
    target_vessels: target.length,
    imo_coverage: coverageRatio(target, v => hasValue(v.imo)),
    high_value_imo_coverage: coverageRatio(highValue, v => hasValue(v.imo)),
    imo_recovery_queue_count: queue.length,
    imo_recovered_count: recovered.length,
    recovered_imo_count: recovered.length,
    imo_recovery_success_rate: denominator ? Math.round((recovered.length / denominator) * 100) : 0,
    unresolved_high_value_count: highValue.filter(v => !v.imo).length,
    call_sign_match_recovery_count: recovered.filter(v => /call.?sign/i.test(String(v.imo_recovery_source || v.identity_match_strategy || ""))).length,
    spec_api_recovery_count: recovered.filter(v => /spec/i.test(String(v.imo_recovery_source || v.recovery_source || ""))).length
  };
}

function buildMatchingDiagnostics(records = []) {
  const sourceText = v => String([v.enrichment_source, v.pilot_source_url, v.berth_data_source, v.pnc_source_url, v.ulsan_source, v.secondary_enrichment_source, v.source].filter(Boolean).join(" ")).toLowerCase();
  const sourceRows = records.filter(v => v.enrichment_source || v.pilot_source_url || v.berth_data_source || v.pnc_source_url || v.ulsan_source || v.secondary_enrichment_source);
  const matchedRows = records.filter(v => v.pilot_schedule_matched || v.secondary_enrichment_matched || Number(v.match_score || v.pilot_match_score || v.berth_match_confidence || v.enrichment_confidence || 0) >= 40);
  const sourceCollected = pattern => sourceRows.filter(v => pattern.test(sourceText(v)));
  const sourceMatched = pattern => matchedRows.filter(v => pattern.test(sourceText(v)));
  const matchScores = matchedRows.map(v => Number(v.match_score || v.pilot_match_score || v.berth_match_confidence || v.enrichment_confidence || 0));
  const rate = (matched, total) => total ? Math.round((matched / total) * 100) : 0;
  const avg = values => values.length ? Math.round(values.reduce((sum, value) => sum + Number(value || 0), 0) / values.length) : 0;
  const pilotRows = sourceCollected(/pilot|도선/);
  const pncRows = sourceCollected(/pnc|pnit|newport|busan/);
  const ulsanRows = sourceCollected(/ulsan|울산/);
  const berthRows = sourceCollected(/berth|terminal|facility|선석|터미널/);
  const pilotMatched = sourceMatched(/pilot|도선/);
  const pncMatched = sourceMatched(/pnc|pnit|newport|busan/);
  const ulsanMatched = sourceMatched(/ulsan|울산/);
  const berthMatched = sourceMatched(/berth|terminal|facility|선석|터미널/);
  return {
    enrichment_rows_collected: sourceRows.length,
    enrichment_rows_matched: matchedRows.length,
    enrichment_rows_unmatched: Math.max(0, sourceRows.length - matchedRows.length),
    enrichment_match_rate: rate(matchedRows.length, sourceRows.length),
    enrichment_high_confidence_matches: matchScores.filter(score => score >= 80).length,
    enrichment_medium_confidence_matches: matchScores.filter(score => score >= 60 && score < 80).length,
    enrichment_low_confidence_matches: matchScores.filter(score => score >= 40 && score < 60).length,
    pilot_rows_collected: pilotRows.length,
    pilot_rows_matched: pilotMatched.length,
    pilot_match_rate: rate(pilotMatched.length, pilotRows.length),
    pnc_rows_collected: pncRows.length,
    pnc_rows_matched: pncMatched.length,
    pnc_match_rate: rate(pncMatched.length, pncRows.length),
    ulsan_rows_collected: ulsanRows.length,
    ulsan_rows_matched: ulsanMatched.length,
    ulsan_match_rate: rate(ulsanMatched.length, ulsanRows.length),
    berth_rows_collected: berthRows.length,
    berth_rows_matched: berthMatched.length,
    berth_match_rate: rate(berthMatched.length, berthRows.length),
    match_score_avg: avg(matchScores),
    match_memory_ready: true,
    matching_memory_table: "enrichment_match_candidates",
    alias_memory_sources: ["berth_aliases.csv", "terminal_aliases.csv", "enrichment_match_candidates"]
  };
}

function buildPredictionDiagnostics(records = []) {
  const predicted = records.filter(v => v.predicted_arrival_time || v.predicted_arrival_pipeline || Number(v.arrival_opportunity_score || 0) > 0);
  const matched = predicted.filter(v => v.actual_arrival_time || v.ata);
  const errors = matched.map(v => Number(v.prediction_error_hours ?? derivePredictionErrorHours(v))).filter(Number.isFinite);
  const avgError = errors.length ? Math.round((errors.reduce((sum, value) => sum + value, 0) / errors.length) * 10) / 10 : null;
  const routeConfidences = records.map(v => Number(v.route_pattern_confidence || 0)).filter(value => value > 0);
  const avgRouteConfidence = routeConfidences.length ? Math.round(routeConfidences.reduce((sum, value) => sum + value, 0) / routeConfidences.length) : 0;
  return {
    predicted_arrivals_count: predicted.length,
    predictions_matched_to_actual_count: matched.length,
    avg_prediction_error_hours: avgError,
    prediction_accuracy_band: avgError === null ? "insufficient_data" : avgError <= 6 ? "high" : avgError <= 24 ? "medium" : "low",
    route_pattern_confidence_avg: avgRouteConfidence,
    route_patterns_known_count: records.filter(v => v.route_pattern_known).length,
    vessel_route_history_ready_count: records.filter(v => v.previous_port || v.destination_port || v.next_port || v.route_from_port || v.route_to_port).length,
    predicted_cleaning_opportunity_count: records.filter(v => Number(v.predicted_cleaning_opportunity_score || 0) > 0).length,
    prediction_feedback_tables: ["predicted_arrivals", "vessel_route_history", "route_patterns"]
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

function buildDataQualityLayerDiagnostics(records = [], matchingDiagnostics = buildMatchingDiagnostics(records)) {
  const avg = values => values.length ? Math.round(values.reduce((sum, value) => sum + Number(value || 0), 0) / values.length) : 0;
  const scores = records.map(v => Number(v.data_quality_score || deriveDataQualityScore(v) || 0));
  const parseMs = value => {
    const date = parseDate(value);
    return date ? date.getTime() : null;
  };
  const gtValues = records.map(v => Number(v.gt || v.grtg || v.intrlGrtg || 0));
  const sourceConfidenceValues = records.map(v => Number(v.source_confidence_score || v.data_confidence_score || v.data_quality_score || deriveDataQualityScore(v) || 0));
  const hasPortCallIdentity = v => hasValue(v.port_call_identity || v.port_call_key || v.raw_port_call_identity) ||
    (hasValue(v.port_code) && hasValue(v.call_sign || v.normalized_vessel_name || v.vessel_name) && hasValue(v.ata || v.eta || v.etryptYear || v.etryptCo));
  const timeOrderWarning = v => {
    const ata = parseMs(v.ata);
    const atd = parseMs(v.atd);
    const etd = parseMs(v.etd);
    return Boolean((ata && atd && atd < ata) || (ata && etd && etd < ata));
  };
  return {
    total_vessels: records.length,
    overall_data_quality_score: avg(scores),
    data_quality_score_avg: avg(scores),
    high_quality_count: records.filter(v => Number(v.data_quality_score || deriveDataQualityScore(v)) >= 80).length,
    medium_quality_count: records.filter(v => Number(v.data_quality_score || deriveDataQualityScore(v)) >= 60 && Number(v.data_quality_score || deriveDataQualityScore(v)) < 80).length,
    low_quality_count: records.filter(v => Number(v.data_quality_score || deriveDataQualityScore(v)) >= 40 && Number(v.data_quality_score || deriveDataQualityScore(v)) < 60).length,
    needs_cleanup_count: records.filter(v => Number(v.data_quality_score || deriveDataQualityScore(v)) < 40).length,
    gt_coverage: coverageRatio(records, v => Number(v.gt || v.grtg || v.intrlGrtg || 0) > 0),
    imo_coverage: coverageRatio(records, v => hasValue(v.imo)),
    call_sign_coverage: coverageRatio(records, v => hasValue(v.call_sign)),
    vessel_type_coverage: coverageRatio(records, v => hasValue(v.vessel_type_group || v.vessel_type || v.vsslKndNm) && String(v.vessel_type_group || v.vessel_type || v.vsslKndNm).toLowerCase() !== "unknown"),
    ata_coverage: coverageRatio(records, v => hasValue(v.ata)),
    atd_coverage: coverageRatio(records, v => hasValue(v.atd)),
    etd_coverage: coverageRatio(records, v => hasValue(v.etd)),
    berth_facility_coverage: coverageRatio(records, v => hasValue(v.berth_name || v.berth || v.anchorage_name || v.anchorage_zone || v.laidupFcltyNm || v.facility_name_raw)),
    operator_coverage: coverageRatio(records, v => hasValue(v.operator_name || v.operator)),
    agent_coverage: coverageRatio(records, v => hasValue(v.agent_name || v.agent || v.satmntEntrpsNm || v.entrpsCdNm)),
    pilot_match_rate: matchingDiagnostics.pilot_match_rate || 0,
    pnc_match_rate: matchingDiagnostics.pnc_match_rate || 0,
    ulsan_match_rate: matchingDiagnostics.ulsan_match_rate || 0,
    port_call_identity_coverage: coverageRatio(records, hasPortCallIdentity),
    gt_invalid_count: gtValues.filter(value => value < 0 || value > 500000).length,
    ata_atd_etd_order_warning_count: records.filter(timeOrderWarning).length,
    source_confidence_score_avg: avg(sourceConfidenceValues),
    source_confidence_scored_count: sourceConfidenceValues.filter(Boolean).length,
    data_quality_bands: {
      high: records.filter(v => Number(v.data_quality_score || deriveDataQualityScore(v) || 0) >= 80).length,
      medium: records.filter(v => Number(v.data_quality_score || deriveDataQualityScore(v) || 0) >= 60 && Number(v.data_quality_score || deriveDataQualityScore(v) || 0) < 80).length,
      low: records.filter(v => Number(v.data_quality_score || deriveDataQualityScore(v) || 0) >= 40 && Number(v.data_quality_score || deriveDataQualityScore(v) || 0) < 60).length,
      needs_cleanup: records.filter(v => Number(v.data_quality_score || deriveDataQualityScore(v) || 0) < 40).length
    },
    normalization_focus: [
      "port_call_identity",
      "gt_validation",
      "ata_atd_etd_validation",
      "vessel_type_normalization",
      "port_sub_port_extraction",
      "agent_normalization",
      "operator_inference_quality",
      "source_confidence_scoring"
    ]
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
  const predictiveRecords = enhancePredictiveArrivalIntelligence(records);
  return sortCommercialPriority(predictiveRecords
    .filter(v => v.predicted_arrival_pipeline || v.predicted_arrival_time || Number(v.arrival_opportunity_score || 0) >= 35 || v.status_bucket === "arriving_soon"))
    .sort((a, b) =>
      Number(b.arrival_opportunity_score || 0) - Number(a.arrival_opportunity_score || 0) ||
      Number(b.arrival_prediction_confidence || 0) - Number(a.arrival_prediction_confidence || 0) ||
      commercialScore(b) - commercialScore(a)
    )
    .map(v => ({
      vessel_name: v.vessel_name,
      normalized_vessel_name: v.normalized_vessel_name || "",
      operator_name: v.operator_name || v.operator || "",
      operator_normalized: v.operator_normalized || "",
      agent_name: v.agent_name || v.agent || "",
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
      congestion_forecast_band: v.congestion_forecast_band || forecastBand(v.predicted_congestion_score || v.predicted_congestion || 0),
      anchorage_probability: Number(v.anchorage_probability || 0),
      predicted_work_window_hours: Number(v.predicted_work_window_hours || 0),
      work_window_confidence: Number(v.work_window_confidence || 0),
      repeat_call_count: Number(v.repeat_call_count || 0),
      repeat_operator_count: Number(v.repeat_operator_count || 0),
      repeat_caller_score: Number(v.repeat_caller_score || 0),
      repeat_operator_score: Number(v.repeat_operator_score || 0),
      route_bonus: Number(v.route_bonus || deriveRouteBonus(v)),
      biofouling_exposure_score: Number(v.biofouling_exposure_score || 0),
      biofouling_exposure_band: v.biofouling_exposure_band || biofoulingExposureBand(v.biofouling_exposure_score),
      biofouling_exposure_reasons: v.biofouling_exposure_reasons || [],
      predicted_cleaning_opportunity_score: Number(v.predicted_cleaning_opportunity_score || 0),
      cleaning_opportunity_band: v.cleaning_opportunity_band || cleaningOpportunityBand(v.predicted_cleaning_opportunity_score),
      predicted_arrival_window_hours: Number(v.predicted_arrival_window_hours || 0),
      arrival_prediction_source: v.arrival_prediction_source || "",
      route_pattern_known: Boolean(v.route_pattern_known),
      route_pattern_confidence: Number(v.route_pattern_confidence || 0),
      prediction_error_hours: v.prediction_error_hours ?? null,
      arrival_window_bucket: predictionEtaBucket(v),
      commercial_value_score: commercialScore(v),
      reason_codes: v.reason_codes || []
    }));
}

function buildPredictedCleaningOpportunities(records = []) {
  return sortCommercialPriority(activeRecordsOnly(records)
    .filter(hasUsefulVesselIdentity)
    .map(v => {
      const bio = deriveBiofoulingExposureEngine(v);
      const score = Number(v.predicted_cleaning_opportunity_score || derivePredictedCleaningOpportunityScore({ ...v, biofouling_exposure_score: bio.biofouling_exposure_score }));
      return {
        ...v,
        biofouling_exposure_score: Number(v.biofouling_exposure_score || bio.biofouling_exposure_score),
        biofouling_exposure_band: v.biofouling_exposure_band || bio.biofouling_exposure_band,
        biofouling_exposure_reasons: v.biofouling_exposure_reasons || bio.biofouling_exposure_reasons,
        predicted_cleaning_opportunity_score: score,
        cleaning_opportunity_band: v.cleaning_opportunity_band || cleaningOpportunityBand(score),
        opportunity_summary: v.opportunity_summary || deriveOpportunitySummary({ ...v, biofouling_exposure_score: bio.biofouling_exposure_score, predicted_cleaning_opportunity_score: score })
      };
    })
    .filter(v => Number(v.predicted_cleaning_opportunity_score || 0) >= 35 || Number(v.commercial_value_score || 0) >= 50)
    .sort((a, b) =>
      Number(b.predicted_cleaning_opportunity_score || 0) - Number(a.predicted_cleaning_opportunity_score || 0) ||
      Number(b.work_feasibility_score || 0) - Number(a.work_feasibility_score || 0) ||
      commercialScore(b) - commercialScore(a)
    ))
    .slice(0, 10);
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
        auto_lead_created: Boolean(v.auto_lead_created || commercialScore(v) >= IMMEDIATE_TARGET_THRESHOLD),
        lead_created_reason: v.lead_created_reason || (commercialScore(v) >= IMMEDIATE_TARGET_THRESHOLD ? "commercial_value_score_75_plus" : ""),
        why_now: v.why_now || deriveWhyNow(v),
        candidate_summary_ko: v.candidate_summary_ko || deriveCandidateSummaryKo(v),
        sales_angle: v.sales_angle || deriveSalesAngle(v),
        recommended_next_action: v.recommended_next_action || v.recommended_action || deriveRecommendedNextAction(v, leadPriorityScore),
        recommended_action: v.recommended_action || v.recommended_next_action || deriveRecommendedNextAction(v, leadPriorityScore),
        action_priority: v.action_priority || deriveActionPriority(v, v.recommended_action || v.recommended_next_action || deriveRecommendedNextAction(v, leadPriorityScore)),
        recommended_contact_path: v.recommended_contact_path || deriveRecommendedContactPath(v),
        recommended_department: v.recommended_department || deriveRecommendedDepartment(v),
        recommended_email_draft: v.recommended_email_draft || deriveRecommendedEmailDraft(v),
        recommended_followup_date: v.recommended_followup_date || deriveRecommendedFollowupDate(v),
        lead_timeline: Array.isArray(v.lead_timeline) ? v.lead_timeline : deriveLeadTimeline(v)
      };
    })
    .filter(v => commercialScore(v) >= IMMEDIATE_TARGET_THRESHOLD || ["contact_ready", "contacted", "quoted", "scheduled", "won", "lost"].includes(String(v.lead_status || "").toLowerCase()))))
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
      route_bonus: Number(v.route_bonus || deriveRouteBonus(v)),
      predicted_cleaning_opportunity_score: Number(v.predicted_cleaning_opportunity_score || 0),
      cleaning_opportunity_band: v.cleaning_opportunity_band || cleaningOpportunityBand(v.predicted_cleaning_opportunity_score),
      anchorage_probability: Number(v.anchorage_probability || 0),
      predicted_congestion_score: Number(v.predicted_congestion_score || 0),
      congestion_forecast_band: v.congestion_forecast_band || "low",
      predicted_work_window_hours: Number(v.predicted_work_window_hours || 0),
      work_window_confidence: Number(v.work_window_confidence || 0),
      biofouling_exposure_score: Number(v.biofouling_exposure_score || 0),
      repeat_call_count: Number(v.repeat_call_count || 0),
      repeat_operator_count: Number(v.repeat_operator_count || 0),
      repeat_caller_score: Number(v.repeat_caller_score || 0),
      repeat_operator_score: Number(v.repeat_operator_score || 0),
      lead_priority_score: Number(v.lead_priority_score || 0),
      lead_status: v.lead_status || "monitor",
      auto_lead_created: Boolean(v.auto_lead_created),
      lead_created_reason: v.lead_created_reason || "",
      why_now: v.why_now || "",
      candidate_summary_ko: v.candidate_summary_ko || "",
      sales_angle: v.sales_angle || "",
      recommended_next_action: v.recommended_next_action || "",
      recommended_action: v.recommended_action || v.recommended_next_action || "",
      action_priority: v.action_priority || deriveActionPriority(v, v.recommended_action || v.recommended_next_action || ""),
      recommended_contact_path: v.recommended_contact_path || deriveRecommendedContactPath(v),
      recommended_department: v.recommended_department || deriveRecommendedDepartment(v),
      recommended_email_draft: v.recommended_email_draft || deriveRecommendedEmailDraft(v),
      recommended_followup_date: v.recommended_followup_date || deriveRecommendedFollowupDate(v),
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

function buildContactReadyVessels(records = []) {
  return sortCommercialPriority(dedupeCandidateRows(records
    .filter(v =>
      Number(v.contact_readiness_score || 0) >= 60 ||
      ["contact_available", "high_confidence_contact"].includes(v.contact_path_status) ||
      (v.contact_path_available && commercialScore(v) >= SALES_CANDIDATE_THRESHOLD)
    )))
    .sort((a, b) =>
      Number(b.contact_readiness_score || 0) - Number(a.contact_readiness_score || 0) ||
      commercialScore(b) - commercialScore(a) ||
      Number(b.lead_priority_score || 0) - Number(a.lead_priority_score || 0)
    )
    .map(v => ({
      vessel_name: v.vessel_name,
      port: v.port,
      port_code: v.port_code || portCodeFromName(v.port),
      port_name: v.port_name || v.port,
      operator_name: v.operator_name || v.operator || "",
      agent_name: v.agent_name || v.agent || "",
      operator_website: v.operator_website || v.operator_url || "",
      agent_website: v.agent_website || v.agent_url || "",
      contact_readiness_score: Number(v.contact_readiness_score || 0),
      contact_path_status: v.contact_path_status || deriveContactPathStatus(v),
      contact_priority: v.contact_priority || deriveContactPriority(v),
      contact_path_label_ko: v.contact_path_label_ko || contactPathLabelKo(v),
      contact_path_available: Boolean(v.contact_path_available),
      lead_status: v.lead_status || deriveLeadStatus(v, Number(v.lead_priority_score || deriveLeadPriorityScore(v))),
      lead_priority_score: Number(v.lead_priority_score || deriveLeadPriorityScore(v)),
      commercial_value_score: commercialScore(v),
      recommended_action: v.recommended_action || v.recommended_next_action || deriveRecommendedNextAction(v),
      why_now: v.why_now || deriveWhyNow(v),
      reason_codes: v.reason_codes || []
    }));
}

function buildFleetOpportunityRows(records = []) {
  const map = new Map();
  for (const record of records.filter(v => !isDepartedRecord(v))) {
    const operatorKey = repeatOperatorKey(record);
    if (!operatorKey) continue;
    if (!map.has(operatorKey)) {
      map.set(operatorKey, {
        operator_name: record.operator_name || record.operator || operatorKey,
        operator_normalized: operatorKey,
        vessels: new Map(),
        ports: new Set(),
        target_vessels: 0,
        immediate_targets: 0,
        repeat_call_total: 0,
        repeated_vessels: 0,
        route_regions: new Set(),
        congestion_exposed: 0,
        contact_ready: 0,
        commercial_total: 0,
        biofouling_total: 0,
        congestion_total: 0,
        route_exposure_total: 0,
        operator_quality_total: 0,
        top_vessels: []
      });
    }
    const fleet = map.get(operatorKey);
    const vesselKey = repeatVesselKey(record) || normalizeVesselName(record.vessel_name);
    if (vesselKey) fleet.vessels.set(vesselKey, record);
    fleet.ports.add(String(record.port_code || record.port_name || record.port || "unknown"));
    const score = commercialScore(record);
    if (!isHardCandidateExcluded(record) && score >= SALES_CANDIDATE_THRESHOLD) fleet.target_vessels += 1;
    if (!isHardCandidateExcluded(record) && score >= IMMEDIATE_TARGET_THRESHOLD && hasCurrentOrNearTermWorkFeasibility(record)) fleet.immediate_targets += 1;
    const repeatCalls = Number(record.repeat_call_count || record.calls_last_12m || 0);
    fleet.repeat_call_total += repeatCalls;
    if (repeatCalls >= 3) fleet.repeated_vessels += 1;
    if (record.route_region && record.route_region !== "unknown") fleet.route_regions.add(record.route_region);
    if (deriveCongestionScore(record) >= 40 || Number(record.anchorage_hours || 0) >= 72) fleet.congestion_exposed += 1;
    if (Number(record.contact_readiness_score || 0) >= 60 || ["contact_available", "high_confidence_contact"].includes(record.contact_path_status)) fleet.contact_ready += 1;
    fleet.commercial_total += score;
    fleet.biofouling_total += Number(record.biofouling_exposure_score || record.biofouling_risk_score || record.biofouling_score || 0);
    fleet.congestion_total += Number(record.congestion_score || record.port_congestion_score || 0);
    fleet.route_exposure_total += Number(record.route_bonus || record.biosecurity_exposure_score || 0);
    fleet.operator_quality_total += Number(record.operator_confidence || record.contact_readiness_score || 0);
    fleet.top_vessels.push(record);
  }

  return [...map.values()]
    .map(fleet => {
      const operatorVesselCount = fleet.vessels.size;
      const operatorPortCount = [...fleet.ports].filter(Boolean).length;
      const operatorCallCount = Math.max(operatorVesselCount, fleet.repeat_call_total);
      const divisor = Math.max(1, fleet.top_vessels.length);
      const averageCommercialValue = Math.round(fleet.commercial_total / divisor);
      const averageBiofoulingExposure = Math.round(fleet.biofouling_total / divisor);
      const averageCongestionExposure = Math.round(fleet.congestion_total / divisor);
      const routeExposureScore = Math.round(fleet.route_exposure_total / divisor);
      const operatorQualityScore = Math.round(fleet.operator_quality_total / divisor);
      const repeatOperatorScore = boundedScore(
        repeatScoreFromCalls(operatorCallCount) +
        Math.min(25, operatorVesselCount * 4) +
        Math.min(15, operatorPortCount * 4) +
        Math.min(15, fleet.repeated_vessels * 5)
      );
      const fleetOpportunityScore = boundedScore(
        Math.min(20, operatorVesselCount * 4) +
        Math.min(24, fleet.target_vessels * 8) +
        Math.min(22, fleet.immediate_targets * 12) +
        repeatOperatorScore * 0.15 +
        Math.min(12, routeExposureScore * 0.12) +
        Math.min(10, operatorQualityScore * 0.10)
      );
      const cleaningProbability = fleetCleaningProbability({
        averageBiofoulingExposure,
        averageCongestionExposure,
        repeatOperatorScore,
        routeExposureScore,
        targetVesselCount: fleet.target_vessels,
        immediateTargetCount: fleet.immediate_targets,
        operatorVesselCount,
        operatorPortCount,
        operatorQualityScore
      });
      const alertCodes = [];
      if (fleetOpportunityScore >= 70 || fleet.immediate_targets >= 2 || fleet.target_vessels >= 4) alertCodes.push("HIGH_FLEET_OPPORTUNITY");
      if (cleaningProbability >= 65) alertCodes.push("FLEET_CLEANING_DEMAND_30D");
      const topVessels = sortCommercialPriority(fleet.top_vessels).slice(0, 5).map(v => ({
        vessel_name: v.vessel_name,
        port_name: v.port_name || v.port,
        commercial_value_score: commercialScore(v),
        candidate_band: v.candidate_band || v.sales_priority_band || "general"
      }));
      return {
        operator_name: fleet.operator_name,
        operator_normalized: fleet.operator_normalized,
        current_vessel_count: operatorVesselCount,
        target_vessel_count: fleet.target_vessels,
        immediate_target_count: fleet.immediate_targets,
        operator_call_count: operatorCallCount,
        operator_vessel_count: operatorVesselCount,
        operator_port_count: operatorPortCount,
        repeat_operator_score: repeatOperatorScore,
        fleet_opportunity_score: fleetOpportunityScore,
        fleet_cleaning_probability: cleaningProbability,
        fleet_cleaning_probability_band: fleetCleaningProbabilityBand(cleaningProbability),
        forecast_window_days: 30,
        average_commercial_value: averageCommercialValue,
        average_biofouling_exposure: averageBiofoulingExposure,
        average_congestion_exposure: averageCongestionExposure,
        route_exposure_score: routeExposureScore,
        operator_quality_score: operatorQualityScore,
        fleet_alerts: alertCodes,
        fleet_alert: alertCodes[0] || "",
        contact_ready_count: fleet.contact_ready,
        route_concentration_count: fleet.route_regions.size,
        top_vessels: topVessels,
        why_now: `${fleet.operator_name} 선사는 현재 한국 항만에 ${operatorVesselCount}척이 확인되며, 영업대상 ${fleet.target_vessels}척·즉시후보 ${fleet.immediate_targets}척이 포함됩니다. 30일 세척 수요 가능성은 ${cleaningProbability}점이며 평균 바이오파울링 노출 ${averageBiofoulingExposure}점, 평균 체선노출 ${averageCongestionExposure}점입니다.`,
        recommended_action: cleaningProbability >= 65 ? "30일 선대 세척 수요 사전 제안" : fleet.contact_ready > 0 ? "운영선사 선대 담당팀 접촉" : "운영선사/대리점 연락 경로 확인"
      };
    })
    .filter(row => row.current_vessel_count >= 2 || row.target_vessel_count > 0 || row.fleet_opportunity_score >= 20)
    .sort((a, b) =>
      Number(b.fleet_opportunity_score || 0) - Number(a.fleet_opportunity_score || 0) ||
      Number(b.fleet_cleaning_probability || 0) - Number(a.fleet_cleaning_probability || 0) ||
      Number(b.immediate_target_count || 0) - Number(a.immediate_target_count || 0) ||
      Number(b.target_vessel_count || 0) - Number(a.target_vessel_count || 0) ||
      Number(b.current_vessel_count || 0) - Number(a.current_vessel_count || 0)
    );
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
      route_bonus: Number(v.route_bonus || deriveRouteBonus(v)),
      predicted_cleaning_opportunity_score: Number(v.predicted_cleaning_opportunity_score || 0),
      cleaning_opportunity_band: v.cleaning_opportunity_band || cleaningOpportunityBand(v.predicted_cleaning_opportunity_score),
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

function runContextFields({ statusRunId, summaryRunId, activeRunId, latestSuccessfulRunId, warnings = [] } = {}) {
  const normalizedStatusRunId = statusRunId || activeRunId || summaryRunId || null;
  const normalizedSummaryRunId = summaryRunId || normalizedStatusRunId || null;
  const normalizedActiveRunId = activeRunId || normalizedStatusRunId || normalizedSummaryRunId || null;
  const normalizedLatestSuccessfulRunId = latestSuccessfulRunId || normalizedSummaryRunId || normalizedActiveRunId || null;
  const mismatch = Boolean(normalizedStatusRunId && normalizedSummaryRunId && String(normalizedStatusRunId) !== String(normalizedSummaryRunId));
  const mergedWarnings = Array.isArray(warnings) ? [...warnings] : [];
  if (mismatch && !mergedWarnings.includes("status_run_id !== summary_run_id")) {
    mergedWarnings.push("status_run_id !== summary_run_id");
  }
  return {
    status_run_id: normalizedStatusRunId,
    summary_run_id: normalizedSummaryRunId,
    active_run_id: normalizedActiveRunId,
    latest_successful_run_id: normalizedLatestSuccessfulRunId,
    latest_successful_summary_run_id: normalizedLatestSuccessfulRunId,
    run_context_mismatch: mismatch,
    run_context_warning: mismatch ? "status_run_id !== summary_run_id" : null,
    warnings: mergedWarnings
  };
}

function buildDashboardSummary(allRecords = [], source = {}) {
  const activeRecords = activeRecordsOnly(allRecords);
  const buckets = buildVisibilityBuckets(activeRecords);
  const immediateTargets = sortCommercialPriority(buckets.immediate_targets).slice(0, 5);
  const immediateKeys = new Set(immediateTargets.map(candidateDedupeKey));
  const opportunities = sortCommercialPriority(buckets.sales_candidates.filter(v => !immediateKeys.has(candidateDedupeKey(v)))).slice(0, 5);
  const predictedArrivals = buildPredictedArrivals(activeRecords).slice(0, 10);
  const predictedCleaningOpportunities = buildPredictedCleaningOpportunities(activeRecords).slice(0, 10);
  const status = buildStatus(activeRecords, source);
  const context = runContextFields({
    statusRunId: status.status_run_id || status.run_id || status.active_run_id,
    summaryRunId: status.summary_run_id || status.run_id || status.active_run_id,
    activeRunId: status.active_run_id,
    latestSuccessfulRunId: status.latest_successful_run_id || status.latest_successful_summary_run_id
  });
  return {
    run_id: status.active_run_id,
    ...context,
    serving_mode: status.serving_mode || "worker_supabase",
    data_source_used: status.data_source_used,
    fallback_used: status.fallback_used,
    fallback_reason: status.fallback_reason,
    generated_at: status.generated_at,
    data_freshness: status.data_freshness,
    record_count: status.record_count,
    all_vessels_count: status.all_vessels_count,
    target_count: buckets.target_vessels.length,
    sales_target_count: buckets.sales_candidates.length,
    immediate_target_count: buckets.immediate_targets.length,
    opportunity_count: status.opportunity_count,
    status,
    ports: buildPorts(activeRecords),
    immediate_targets: immediateTargets,
    opportunities,
    predicted_arrivals: predictedArrivals,
    arrival_pipeline: predictedArrivals,
    predicted_cleaning_opportunities: predictedCleaningOpportunities,
    lead_pipeline: buildLeadPipeline(activeRecords).slice(0, 8),
    contact_ready_vessels: buildContactReadyVessels(activeRecords).slice(0, 5),
    fleet_opportunities: buildFleetOpportunityRows(activeRecords).slice(0, 20),
    alert_candidates: buildAlertCandidates(activeRecords).slice(0, 5),
    port_opportunities: buildPortOpportunityRanking(buckets.target_vessels).slice(0, 5),
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

function snapshotDataFreshness(snapshot = {}) {
  const generatedAt = snapshot.generated_at || snapshot.created_at || null;
  const dataAgeMinutes = generatedAt ? Math.round((Date.now() - new Date(generatedAt).getTime()) / 60000) : null;
  return {
    active_collected_at: generatedAt,
    data_age_minutes: dataAgeMinutes,
    is_stale: dataAgeMinutes === null ? true : dataAgeMinutes > AUTO_UPDATE_INTERVAL_HOURS * 60
  };
}

function buildStatusFromSummarySnapshot(snapshot = {}, source = {}, reason = "latest_successful_summary_snapshot") {
  const freshness = snapshotDataFreshness(snapshot);
  const portSummary = parseJsonField(snapshot.port_summary, []);
  const anchorageCount = Array.isArray(portSummary)
    ? portSummary.reduce((sum, port) => sum + Number(port.anchorage_vessels || port.anchorage_waiting || 0), 0)
    : 0;
  const context = runContextFields({
    statusRunId: source.pointer?.active_run_id || snapshot.run_id || null,
    summaryRunId: snapshot.run_id || null,
    activeRunId: source.pointer?.active_run_id || snapshot.run_id || null,
    latestSuccessfulRunId: snapshot.run_id || null
  });
  return {
    run_id: context.status_run_id,
    ...context,
    serving_mode: "worker_supabase",
    data_source_used: "latest_successful_summary_snapshot",
    generated_at: new Date().toISOString(),
    data_freshness: freshness,
    auto_update_interval_hours: AUTO_UPDATE_INTERVAL_HOURS,
    auto_update_label: "데이터는 4시간마다 자동 업데이트됩니다.",
    is_fallback: true,
    fallback_used: true,
    fallback_reason: reason,
    latest_successful_summary_run_id: snapshot.run_id || null,
    last_successful_generated_at: snapshot.generated_at || null,
    version: "worker-live-api-v1",
    status: "success",
    data_mode: "latest_successful_summary_snapshot",
    commercial_use_status: "review_required",
    live_data_available: Number(snapshot.record_count || snapshot.all_vessels_count || 0) > 0,
    displayable_vessel_count: Number(snapshot.record_count || 0),
    completed_at: snapshot.generated_at || snapshot.created_at || null,
    record_count: Number(snapshot.record_count || 0),
    all_collected_vessel_count: Number(snapshot.all_vessels_count || 0),
    all_vessels_count: Number(snapshot.all_vessels_count || 0),
    target_count: Number(snapshot.target_vessels_count || 0),
    target_vessel_count: Number(snapshot.target_vessels_count || 0),
    sales_candidate_count: Number(snapshot.sales_target_count || 0),
    immediate_target_count: Number(snapshot.immediate_target_count || 0),
    anchorage_waiting_count: anchorageCount,
    anchorage_detected_count: anchorageCount,
    opportunity_count: Number(snapshot.opportunity_count || 0),
    watchlist_count: Number(snapshot.watchlist_count || 0),
    port_count: Number(snapshot.port_count || 0),
    source_runtime: {
      provider: "supabase",
      data_source_used: "latest_successful_summary_snapshot",
      active_run_id: source.pointer?.active_run_id || null,
      active_collected_at: source.pointer?.active_collected_at || null,
      fallback_used: true,
      fallback_reason: reason,
      fallback_status: "showing_latest_successful_summary_snapshot",
      using_latest_summary_fallback: true,
      stale_warning: "최신 수집이 진행 중이거나 실패하여 마지막 정상 수치를 표시 중입니다."
    },
    summary_diagnostics: {
      latest_successful_summary_run_id: snapshot.run_id || null,
      current_active_run_id: source.pointer?.active_run_id || null,
      summary_is_fallback: true,
      summary_fallback_reason: reason,
      last_successful_generated_at: snapshot.generated_at || null,
      guarded_latest_run_id: snapshot.guarded_latest_run_id || null,
      guarded_latest_count: snapshot.guarded_latest_count || null,
      guarded_reference_count: snapshot.guarded_reference_count || null,
      current_run_status: source.pointer?.active_run_id ? "unknown" : "missing_active_run",
      current_run_validation_status: "unknown",
      summary_snapshot_rows: 1,
      summary_snapshot_write_status: "latest_successful_available"
    },
    scoring_diagnostics: {
      all_vessels_count: Number(snapshot.all_vessels_count || 0),
      sales_target_count: Number(snapshot.sales_target_count || 0),
      immediate_target_count: Number(snapshot.immediate_target_count || 0),
      watchlist_count: Number(snapshot.watchlist_count || 0)
    }
  };
}

function buildDashboardSummaryFromSnapshot(snapshot = {}, source = {}, reason = "latest_successful_summary_snapshot") {
  const status = buildStatusFromSummarySnapshot(snapshot, source, reason);
  const candidateSummary = parseJsonField(snapshot.candidate_summary, {}) || {};
  const congestionSummary = parseJsonField(snapshot.congestion_summary, {}) || {};
  const portSummary = parseJsonField(snapshot.port_summary, []);
  const ports = Array.isArray(portSummary) ? portSummary : [];
  const context = runContextFields({
    statusRunId: status.status_run_id || status.run_id,
    summaryRunId: status.summary_run_id || snapshot.run_id,
    activeRunId: status.active_run_id,
    latestSuccessfulRunId: status.latest_successful_run_id || snapshot.run_id
  });
  return {
    run_id: context.status_run_id,
    ...context,
    serving_mode: status.serving_mode || "worker_supabase",
    data_source_used: status.data_source_used,
    is_fallback: true,
    fallback_used: true,
    fallback_reason: reason,
    generated_at: snapshot.generated_at || status.generated_at,
    data_freshness: status.data_freshness,
    record_count: status.record_count,
    all_vessels_count: status.all_vessels_count,
    target_count: status.target_count,
    target_vessels_count: status.target_vessel_count,
    sales_target_count: status.sales_candidate_count,
    immediate_target_count: status.immediate_target_count,
    opportunity_count: status.opportunity_count,
    watchlist_count: status.watchlist_count,
    status,
    ports,
    port_units: flattenSummaryPortUnits(ports),
    immediate_targets: Array.isArray(candidateSummary.immediate_targets) ? candidateSummary.immediate_targets : [],
    opportunities: Array.isArray(candidateSummary.opportunities) ? candidateSummary.opportunities : [],
    predicted_arrivals: [],
    arrival_pipeline: [],
    predicted_cleaning_opportunities: [],
    port_opportunities: ports.slice(0, 5),
    congestion_summary: Array.isArray(congestionSummary.ports) ? congestionSummary.ports : [],
    candidate_counts: {
      target_vessels: status.target_vessel_count,
      sales_candidates: status.sales_candidate_count,
      immediate_targets: status.immediate_target_count
    },
    summary_diagnostics: status.summary_diagnostics
  };
}

function portCodeFromName(port = "") {
  const text = String(port || "").toLowerCase();
  if (/^\d+$/.test(text.trim())) return normalizePortCode(text);
  if (/busan|부산/.test(text)) return "020";
  if (/incheon|인천|yeongheung|영흥/.test(text)) return "030";
  if (/yeosu|gwangyang|여수|광양/.test(text)) return "620";
  if (/ulsan|울산/.test(text)) return "820";
  if (/pyeongtaek|dangjin|boryeong|평택|당진|보령/.test(text)) return "031";
  if (/pohang|포항/.test(text)) return "810";
  if (/mokpo|목포/.test(text)) return "070";
  if (/gunsan|군산/.test(text)) return "080";
  if (/daesan|taean|대산|태안/.test(text)) return "621";
  if (/donghae|mukho|sokcho|동해|묵호|속초/.test(text)) return "120";
  if (/jeju|제주/.test(text)) return "940";
  if (/masan|jinhae|samcheonpo|hadong|tongyeong|geoje|okpo|마산|진해|삼천포|하동|통영|거제|옥포/.test(text)) return "622";
  return "unknown";
}

function portRegistryKey(port = {}) {
  return `${normalizePortCode(port.port_code) || "unknown"}|${String(port.sub_port || port.port_name_ko || port.port_name || "").toLowerCase()}`;
}

function recordPortKey(record = {}) {
  const portCode = normalizePortCode(record.port_code || portCodeFromName(record.port_name || record.port));
  const subPort = String(record.sub_port || "").toLowerCase();
  if (subPort) return `${portCode}|${subPort}`;
  return `${portCode}|`;
}

function inferSubPortName(record = {}) {
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
  if (/lng|lpg|gas|가스|산업|terminal|터미널/.test(text) && normalizePortCode(record.port_code) === "820") return "LNG·산업 터미널";
  if (/pnit|pnc|hpnt|부산신항|신항|newport|pusan newport/.test(text)) return "부산신항";
  if (/감천|gamcheon/.test(text)) return "감천항";
  if (/신감만|감만|gamman/.test(text)) return "감만·신감만";
  return String(record.sub_port || "").trim();
}

function hasSubPortBreakdown(portCode) {
  const code = normalizePortCode(portCode);
  if (["020", "030", "031", "120", "620", "621", "622", "820"].includes(code)) return true;
  return PORT_REGISTRY.filter(port => normalizePortCode(port.port_code) === code && port.sub_port).length > 0;
}

function subPortRegistryForRecord(record = {}) {
  const portCode = normalizePortCode(record.port_code || portCodeFromName(record.port_name || record.port));
  const inferred = inferSubPortName(record);
  if (inferred) {
    const candidate = PORT_REGISTRY.find(port =>
      normalizePortCode(port.port_code) === portCode &&
      String(port.sub_port || port.port_name_ko || "").toLowerCase() === inferred.toLowerCase()
    );
    return candidate || {
      port_code: portCode,
      port_name_ko: inferred,
      sub_port: inferred,
      tier: 3,
      sort: 900
    };
  }
  if (hasSubPortBreakdown(portCode)) {
    return {
      port_code: portCode,
      port_name_ko: "기타/확인 필요",
      sub_port: "기타/확인 필요",
      tier: 3,
      sort: 999
    };
  }
  return registryForRecord(record);
}

function registryForRecord(record = {}) {
  const portCode = normalizePortCode(record.port_code || portCodeFromName(record.port_name || record.port));
  const inferredSubPort = inferSubPortName(record);
  const candidates = PORT_REGISTRY
    .filter(port => normalizePortCode(port.port_code) === portCode)
    .sort((a, b) => Number(a.tier || 99) - Number(b.tier || 99) || Number(a.sort || 999) - Number(b.sort || 999));
  if (inferredSubPort) {
    const exact = candidates.find(port => String(port.sub_port || port.port_name_ko || "").toLowerCase() === inferredSubPort.toLowerCase());
    if (exact) return exact;
    const fuzzy = candidates.find(port => {
      const label = String([port.sub_port, port.port_name_ko].filter(Boolean).join(" ")).toLowerCase();
      return label && (label.includes(inferredSubPort.toLowerCase()) || inferredSubPort.toLowerCase().includes(label));
    });
    if (fuzzy) return fuzzy;
    return { port_code: portCode, port_name_ko: inferredSubPort, sub_port: inferredSubPort, tier: 3, sort: 900 };
  }
  return candidates.find(port => Number(port.tier || 99) === 1) || candidates[0] || { port_code: portCode, port_name_ko: representativePortName(portCode, record.port_name || record.port), tier: record.port_tier || 99, sort: 999 };
}

function registryKeyForRecord(record = {}, map = new Map()) {
  const portCode = normalizePortCode(record.port_code || portCodeFromName(record.port_name || record.port) || "unknown");
  const exactKey = recordPortKey(record);
  if (map.has(exactKey)) return exactKey;

  const candidates = PORT_REGISTRY
    .filter(port => normalizePortCode(port.port_code) === portCode)
    .sort((a, b) => Number(a.tier || 99) - Number(b.tier || 99) || Number(a.sort || 999) - Number(b.sort || 999));

  const mainPort = candidates.find(port => Number(port.tier || 99) === 1) || candidates[0];
  if (mainPort) {
    const mainKey = portRegistryKey(mainPort);
    if (map.has(mainKey)) return mainKey;
  }

  return exactKey;
}

function isDisplayablePortName(value = "") {
  const text = String(value || "").trim();
  return text && !/^korea$/i.test(text) && !/^unknown$/i.test(text);
}

function buildPortUnitRows(records) {
  const map = new Map();
  for (const registry of PORT_REGISTRY) {
    const code = normalizePortCode(registry.port_code);
    const key = portRegistryKey(registry);
    const name = registry.sub_port || registry.port_name_ko || representativePortName(code, registry.port_name_ko);
    map.set(key, {
      port_code: code,
      port_unit_key: key,
      port_name: name,
      port_name_ko: name,
      port_group: representativePortName(code, registry.port_name_ko),
      sub_port: registry.sub_port || "",
      display_scope: registry.sub_port ? "sub_port" : "representative_port",
      tier: registry.tier,
      commercial_priority: registry.tier === 1 ? "high" : registry.tier === 2 ? "medium_high" : "medium",
      registry_sort: registry.sort,
      vessel_count: 0,
      total_vessels: 0,
      target_vessels: 0,
      target_vessel_count: 0,
      scored_count: 0,
      candidate_count: 0,
      sales_candidates: 0,
      immediate_target_count: 0,
      immediate_targets: 0,
      high_value_vessels: 0,
      anchorage_waiting: 0,
      anchorage_vessels: 0,
      long_stay_vessels: 0,
      long_idle_vessels: 0,
      work_window_hours_total: 0,
      work_window_count: 0,
      operator_known_count: 0,
      agent_known_count: 0,
      port_opportunity_score: 0,
      operator_quality: 0,
      work_window_hours: 0
    });
  }
  for (const v of records) {
    const portName = v.port_name || v.port || "Unknown";
    const portCode = normalizePortCode(v.port_code || portCodeFromName(portName));
    if (portCode === "unknown") continue;
    const registry = subPortRegistryForRecord(v);
    const key = portRegistryKey(registry);
    const representativeName = registry.sub_port || registry.port_name_ko || representativePortName(portCode, portName);
    const p = map.get(key) || {
      port_code: portCode,
      port_unit_key: key,
      port_name: representativeName,
      port_name_ko: representativeName,
      port_group: representativePortName(portCode, portName),
      sub_port: registry.sub_port || "",
      display_scope: registry.sub_port ? "sub_port" : "representative_port",
      tier: v.port_tier || "",
      commercial_priority: v.commercial_priority || "",
      vessel_count: 0,
      total_vessels: 0,
      target_vessels: 0,
      target_vessel_count: 0,
      scored_count: 0,
      candidate_count: 0,
      sales_candidates: 0,
      immediate_target_count: 0,
      immediate_targets: 0,
      high_value_vessels: 0,
      anchorage_waiting: 0,
      anchorage_vessels: 0,
      long_stay_vessels: 0,
      long_idle_vessels: 0,
      work_window_hours_total: 0,
      work_window_count: 0,
      operator_known_count: 0,
      agent_known_count: 0,
      port_opportunity_score: 0,
      operator_quality: 0,
      work_window_hours: 0
    };
    p.vessel_count += 1;
    p.total_vessels += 1;
    if (isMainCommercialVessel(v)) {
      p.target_vessels += 1;
      p.target_vessel_count += 1;
    }
    if (typeof v.total_sales_priority_score === "number") p.scored_count += 1;
    if (isSalesCandidate(v)) {
      p.candidate_count += 1;
      p.sales_candidates += 1;
    }
    if (isImmediateTarget(v)) {
      p.immediate_target_count += 1;
      p.immediate_targets += 1;
    }
    if (commercialScore(v) >= 75 || Number(v.gt || 0) >= 30000 || v.high_value_target) p.high_value_vessels += 1;
    if (isAnchorageLike(v)) {
      p.anchorage_waiting += 1;
      p.anchorage_vessels += 1;
    }
    if (v.is_long_idle || Number(v.stay_hours || 0) >= 168 || Number(v.anchorage_hours || 0) >= 168) {
      p.long_stay_vessels += 1;
      p.long_idle_vessels += 1;
    }
    if (Number(v.work_window_hours || v.predicted_work_window_hours || 0) > 0) {
      p.work_window_hours_total += Number(v.work_window_hours || v.predicted_work_window_hours || 0);
      p.work_window_count += 1;
    }
    if (hasValue(v.operator_name || v.operator)) p.operator_known_count += 1;
    if (hasValue(v.agent_name || v.agent || v.satmntEntrpsNm || v.entrpsCdNm)) p.agent_known_count += 1;
    map.set(key, p);
  }
  return [...map.values()].map(p => {
    const avgWorkWindow = p.work_window_count ? Math.round((p.work_window_hours_total / p.work_window_count) * 10) / 10 : 0;
    const operatorQuality = p.vessel_count ? Math.round(((p.operator_known_count * 0.65 + p.agent_known_count * 0.35) / p.vessel_count) * 100) : 0;
    const portOpportunityScore = Math.min(100, Math.round(
      Math.min(35, p.high_value_vessels * 7) +
      Math.min(25, p.anchorage_waiting * 6) +
      Math.min(20, avgWorkWindow * 0.8) +
      Math.min(15, operatorQuality * 0.15) +
      Math.min(10, p.immediate_target_count * 5)
    ));
    return {
      ...p,
      work_window_hours: avgWorkWindow,
      average_work_window_hours: avgWorkWindow,
      operator_quality: operatorQuality,
      port_opportunity_score: portOpportunityScore
    };
  }).sort((a, b) =>
    Number(a.tier || 99) - Number(b.tier || 99) ||
    Number(a.registry_sort || 999) - Number(b.registry_sort || 999) ||
    Number(b.total_vessels || 0) - Number(a.total_vessels || 0) ||
    b.port_opportunity_score - a.port_opportunity_score ||
    b.immediate_target_count - a.immediate_target_count ||
    b.candidate_count - a.candidate_count ||
    b.vessel_count - a.vessel_count
  );
}

function buildPorts(records) {
  const unitRows = buildPortUnitRows(records);
  const grouped = new Map();
  for (const row of unitRows) {
    const groupName = row.port_group || row.port_name || row.port_name_ko || row.port_code || "항만 확인 필요";
    const key = `${row.port_code || groupName}|${groupName}`;
    const current = grouped.get(key) || {
      port_code: row.port_code,
      port_unit_key: key,
      port_name: groupName,
      port_name_ko: groupName,
      port_group: groupName,
      sub_port: "",
      display_scope: "representative_port_aggregate",
      tier: row.tier,
      commercial_priority: row.commercial_priority,
      registry_sort: row.registry_sort,
      vessel_count: 0,
      total_vessels: 0,
      target_vessels: 0,
      target_vessel_count: 0,
      scored_count: 0,
      candidate_count: 0,
      sales_candidates: 0,
      immediate_target_count: 0,
      immediate_targets: 0,
      high_value_vessels: 0,
      anchorage_waiting: 0,
      anchorage_vessels: 0,
      long_stay_vessels: 0,
      long_idle_vessels: 0,
      work_window_hours_total: 0,
      work_window_count: 0,
      operator_known_count: 0,
      agent_known_count: 0,
      child_units: []
    };
    for (const field of ["vessel_count", "total_vessels", "target_vessels", "target_vessel_count", "scored_count", "candidate_count", "sales_candidates", "immediate_target_count", "immediate_targets", "high_value_vessels", "anchorage_waiting", "anchorage_vessels", "long_stay_vessels", "long_idle_vessels", "work_window_hours_total", "work_window_count", "operator_known_count", "agent_known_count"]) {
      current[field] += Number(row[field] || 0);
    }
    if (row.total_vessels > 0 && row.sub_port) {
      current.child_units.push({
        port_code: row.port_code,
        port_name: row.port_name,
        sub_port: row.sub_port,
        total_vessels: row.total_vessels,
        target_vessels: row.target_vessels,
        sales_candidates: row.sales_candidates,
        immediate_targets: row.immediate_targets,
        watchlist_count: row.watchlist_count || 0,
        anchorage_vessels: row.anchorage_vessels,
        long_stay_vessels: row.long_stay_vessels
      });
    }
    grouped.set(key, current);
  }
  return [...grouped.values()].map(p => {
    const avgWorkWindow = p.work_window_count ? Math.round((p.work_window_hours_total / p.work_window_count) * 10) / 10 : 0;
    const operatorQuality = p.vessel_count ? Math.round(((p.operator_known_count * 0.65 + p.agent_known_count * 0.35) / p.vessel_count) * 100) : 0;
    const portOpportunityScore = Math.min(100, Math.round(
      Math.min(35, p.high_value_vessels * 7) +
      Math.min(25, p.anchorage_waiting * 6) +
      Math.min(20, avgWorkWindow * 0.8) +
      Math.min(15, operatorQuality * 0.15) +
      Math.min(10, p.immediate_target_count * 5)
    ));
    return {
      ...p,
      child_units: p.child_units.sort((a, b) => Number(b.total_vessels || 0) - Number(a.total_vessels || 0)).slice(0, 5),
      sub_ports: p.child_units.sort((a, b) => Number(b.total_vessels || 0) - Number(a.total_vessels || 0)),
      work_window_hours: avgWorkWindow,
      average_work_window_hours: avgWorkWindow,
      operator_quality: operatorQuality,
      port_opportunity_score: portOpportunityScore
    };
  }).filter(p => p.total_vessels > 0 || Number(p.tier || 99) <= 2).sort((a, b) =>
    Number(a.tier || 99) - Number(b.tier || 99) ||
    Number(a.registry_sort || 999) - Number(b.registry_sort || 999) ||
    Number(b.total_vessels || 0) - Number(a.total_vessels || 0) ||
    b.port_opportunity_score - a.port_opportunity_score
  );
}

function buildPortUnits(records) {
  return buildPortUnitRows(records)
    .filter(row => row.sub_port && Number(row.total_vessels || 0) > 0)
    .map(row => ({
      ...row,
      parent_port_name: row.port_group || representativePortName(row.port_code, row.port_name),
      unit_label: row.sub_port || row.port_name
    }));
}

function buildSubPortConsistencyDiagnostics(ports = []) {
  const mismatches = [];
  for (const port of ports) {
    const children = Array.isArray(port.sub_ports) ? port.sub_ports : (Array.isArray(port.child_units) ? port.child_units : []);
    if (!children.length) continue;
    const parentTotal = Number(port.total_vessels || 0);
    const subPortSum = children.reduce((sum, child) => sum + Number(child.total_vessels || 0), 0);
    if (parentTotal !== subPortSum) {
      mismatches.push({
        parent_port_code: port.port_code || null,
        parent_port_name: port.port_name || port.port_group || null,
        parent_total: parentTotal,
        sub_port_sum: subPortSum,
        difference: parentTotal - subPortSum,
        warning: "서브항 합계와 모항 합계가 일치하지 않습니다."
      });
    }
  }
  return {
    checked_parent_ports: ports.filter(port => Array.isArray(port.sub_ports || port.child_units) && (port.sub_ports || port.child_units).length).length,
    mismatch_count: mismatches.length,
    mismatches
  };
}

function flattenSummaryPortUnits(ports = []) {
  return ports.flatMap(port => (Array.isArray(port.sub_ports) ? port.sub_ports : (Array.isArray(port.child_units) ? port.child_units : [])).map(unit => ({
    port_code: port.port_code || unit.port_code || null,
    port_name: unit.port_name || unit.sub_port || port.port_name,
    port_name_ko: unit.port_name || unit.sub_port || port.port_name,
    port_group: port.port_name || port.port_group || "",
    parent_port_name: port.port_name || port.port_group || "",
    sub_port: unit.sub_port || unit.port_name || "",
    unit_label: unit.sub_port || unit.port_name || "",
    display_scope: "sub_port",
    total_vessels: Number(unit.total_vessels || 0),
    target_vessels: Number(unit.target_vessels || 0),
    target_vessel_count: Number(unit.target_vessels || 0),
    sales_candidates: Number(unit.sales_candidates || unit.sales_targets || 0),
    sales_targets: Number(unit.sales_targets || unit.sales_candidates || 0),
    anchorage_vessels: Number(unit.anchorage_vessels || 0),
    anchorage_waiting: Number(unit.anchorage_vessels || 0),
    immediate_targets: Number(unit.immediate_targets || 0),
    immediate_target_count: Number(unit.immediate_targets || 0)
  })));
}

function recordsForPort(records, portCode) {
  const requested = normalizePortCode(portCode);
  return records.filter(v => normalizePortCode(v.port_code || portCodeFromName(v.port_name || v.port)) === requested);
}

function buildVisibilityBuckets(records) {
  const activeRecords = activeRecordsOnly(records);
  const targetVessels = annotateCommercialRanks(activeRecords.filter(isMainCommercialVessel));
  for (const vessel of targetVessels) {
    const score = commercialScore(vessel);
    vessel.is_cleaning_candidate = isSalesCandidate(vessel);
    vessel.is_immediate_candidate = isImmediateTarget(vessel);
    vessel.candidate_band = isImmediateTarget(vessel) && score >= CRITICAL_TARGET_THRESHOLD ? "critical" : isImmediateTarget(vessel) ? "immediate_target" : isSalesCandidate(vessel) ? "sales_target" : isWatchlistVessel(vessel) ? "watchlist" : "general";
  }
  const canonicalScoredVessels = sortCommercialPriority(dedupeCandidateRows(targetVessels));
  const salesCandidates = sortCommercialPriority(dedupeCandidateRows(canonicalScoredVessels.filter(isSalesCandidate))).map(v => ({ ...v, candidate_band: commercialScore(v) >= CRITICAL_TARGET_THRESHOLD && isImmediateTarget(v) ? "critical" : isImmediateTarget(v) ? "immediate_target" : "sales_target", exclusion_reason: exclusionReason(v) }));
  const immediateTargets = sortCommercialPriority(dedupeCandidateRows(canonicalScoredVessels.filter(isImmediateTarget))).map(v => ({ ...v, candidate_band: commercialScore(v) >= CRITICAL_TARGET_THRESHOLD ? "critical" : "immediate_target", is_immediate_candidate: true, exclusion_reason: exclusionReason(v) }));
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
  const uniquePortCalls = new Set(records.map((record, index) => candidateDedupeKey(record) || recordKey(record, `ROW-${index}`))).size;
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

function buildSourceCountsFromLogs(logRows = [], activeRunId = null) {
  const scopedRows = activeRunId ? logRows.filter(row => String(row.run_id || "") === String(activeRunId)) : logRows;
  const grouped = new Map();
  for (const row of scopedRows) {
    const group = sourceGroupName(row.source_name);
    const current = grouped.get(group) || {
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
    const collected = Number(row.rows_collected || 0);
    const normalized = Number(row.rows_normalized || 0);
    const matched = Number(row.rows_matched || 0);
    current.source_count += 1;
    current.rows_collected += collected;
    current.rows_normalized += normalized;
    current.rows_discarded += Math.max(0, collected - normalized);
    current.rows_failed += String(row.status || "").toLowerCase() === "failed" ? collected || 1 : 0;
    current.rows_matched_to_port_operation += matched;
    if (row.error_message) current.error_summary.push(String(row.error_message).slice(0, 240));
    grouped.set(group, current);
  }
  return [...grouped.values()].map(row => ({
    ...row,
    match_rate: row.rows_collected ? Math.round((row.rows_matched_to_port_operation / row.rows_collected) * 1000) / 10 : 0,
    error_summary: [...new Set(row.error_summary)].slice(0, 10)
  }));
}

function buildDedupeAudit(records = [], buckets = buildVisibilityBuckets(records)) {
  const funnel = buildCountFunnel(records, buckets);
  const duplicateDiagnostics = duplicatePortCallDiagnostics(records);
  const duplicateRowsRemoved = Math.max(Number(funnel.duplicate_raw_rows || 0), duplicateDiagnostics.duplicate_rows_removed);
  return {
    raw_rows: Number(funnel.raw_api_rows || records.length),
    normalized_rows: Number(funnel.normalized_rows || records.length),
    duplicate_rows_detected: duplicateDiagnostics.duplicate_rows_detected,
    duplicate_rows_removed: duplicateRowsRemoved,
    duplicate_rate: Number(funnel.raw_api_rows || 0) ? Math.round((duplicateRowsRemoved / Number(funnel.raw_api_rows || 1)) * 1000) / 10 : 0,
    unique_port_calls: Number(funnel.unique_port_calls || 0),
    unique_vessels: Number(funnel.unique_vessels || 0),
    duplicate_reason_breakdown: duplicateDiagnostics.duplicate_reason_breakdown,
    duplicate_examples: duplicateDiagnostics.duplicate_examples,
    duplicate_cause_estimates: {
      io_double_count_candidates: records.filter(record => record.deGb || record.de_gb || record.direction).length,
      repeated_detail_rows: records.filter(record => record.detail_rows_flattened || Number(record.detail_row_count || 0) > 1).length,
      enrichment_only_rows: records.filter(record => /pilot|pnc|ulsan|berth|facility/i.test(String(record.source || record.source_name || "")) && !String(record.source || record.source_name || "").startsWith("port_operation_")).length,
      same_vessel_multiple_port_calls: Math.max(0, Number(funnel.unique_port_calls || 0) - Number(funnel.unique_vessels || 0))
    },
    dedupe_rule: "port_call_id first, then IMO/MMSI/call_sign/name+GT+type for vessel identity; never vessel_name alone"
  };
}

function buildCandidatePromotionAudit(records = []) {
  const scoring = buildScoringDiagnostics(records);
  const buckets = buildVisibilityBuckets(records);
  const targetTableRows = vesselGroupRows(records, "target");
  return {
    active_run_id: records.find(record => record.run_id)?.run_id || null,
    commercial_score_distribution: scoring.score_distribution,
    score_90_plus_count: scoring.score_90_plus_count,
    score_80_89_count: scoring.score_80_89_count,
    score_70_79_count: scoring.score_70_79_count,
    score_60_69_count: scoring.score_60_69_count,
    score_50_59_count: scoring.score_50_59_count,
    score_40_49_count: scoring.score_40_49_count,
    score_0_39_count: scoring.score_0_39_count,
    candidate_generation_count: scoring.candidate_generation_count,
    candidate_promotion_count: scoring.candidate_promotion_count,
    sales_target_count_summary: buckets.sales_candidates.length,
    sales_target_count_table_api: targetTableRows.length,
    sales_target_count_rendered: targetTableRows.length,
    immediate_target_count_summary: buckets.immediate_targets.length,
    immediate_target_count_table_api: buckets.immediate_targets.length,
    immediate_target_count_rendered: buckets.immediate_targets.length,
    dataset_run_id_summary: records.find(record => record.run_id)?.run_id || null,
    dataset_run_id_table: records.find(record => record.run_id)?.run_id || null,
    high_score_not_promoted_count: scoring.high_score_not_promoted_count,
    excluded_high_value_count: scoring.high_score_not_promoted_count,
    exclusion_reason_counts: scoring.exclusion_reason_counts || scoring.candidate_exclusion_reason_counts || {},
    excluded_high_value_samples: scoring.excluded_candidate_samples || [],
    classification_logic: scoring.candidate_classification_logic
  };
}

function buildVesselUniverseAudit(records = [], sourceCounts = []) {
  const buckets = buildVisibilityBuckets(records);
  const dedupe = buildDedupeAudit(records, buckets);
  const candidateAudit = buildCandidatePromotionAudit(records);
  const watchlistCount = records.filter(v => !isSalesCandidate(v) && isWatchlistVessel(v)).length;
  const salesTargetCount = buckets.sales_candidates.length;
  const immediateTargetCount = buckets.immediate_targets.length;
  const targetRatio = records.length ? Math.round((salesTargetCount / records.length) * 1000) / 10 : 0;
  const portCallCoverage = records.length ? Math.round((records.filter((record, index) => recordKey(record, `ROW-${index}`)).length / records.length) * 1000) / 10 : 0;
  const allVesselsApiCount = vesselGroupRows(records, "all").length;
  const targetVesselsApiCount = vesselGroupRows(records, "target").length;
  const suspected = [];
  if (dedupe.raw_rows > 0 && records.length === 0) suspected.push("전체선박 생성 실패: 정규화 후 all_vessels가 비어 있습니다.");
  if (records.length > 0 && allVesselsApiCount === 0) suspected.push("전체선박 UI/API 바인딩 실패.");
  if (dedupe.duplicate_rate > 35) suspected.push("Duplicate rate is high; review I/O merge and detail-row flattening.");
  if (targetRatio > 30) suspected.push("영업대상 기준이 너무 넓습니다.");
  if (records.length > 0 && salesTargetCount === 0) suspected.push("영업대상 후보가 생성되지 않았습니다. 후보 생성 로직을 확인하세요.");
  if (portCallCoverage < 80) suspected.push("port_call_id coverage is below 80%.");
  if (candidateAudit.high_score_not_promoted_count > 0) suspected.push("High-score vessels exist that were not promoted; inspect exclusion reasons.");
  return {
    run_id: records.find(record => record.run_id)?.run_id || null,
    generated_at: new Date().toISOString(),
    raw_rows_total: dedupe.raw_rows,
    normalized_rows_total: dedupe.normalized_rows,
    duplicate_rows_removed: dedupe.duplicate_rows_removed,
    duplicate_rate: dedupe.duplicate_rate,
    unique_port_calls_count: dedupe.unique_port_calls,
    unique_vessels_count: dedupe.unique_vessels,
    all_vessels_count: records.length,
    watchlist_count: watchlistCount,
    sales_target_count: salesTargetCount,
    immediate_target_count: immediateTargetCount,
    target_ratio: targetRatio,
    candidate_generation_status: candidateAudit.candidate_generation_count > 0 ? "completed" : records.length ? "completed_no_candidates" : "no_vessels",
    source_breakdown: sourceCounts,
    dedupe_audit: dedupe,
    candidate_promotion_audit: candidateAudit,
    regression_diagnostics: {
      raw_rows_total: dedupe.raw_rows,
      normalized_rows_total: dedupe.normalized_rows,
      all_vessels_count: records.length,
      all_vessels_api_count: allVesselsApiCount,
      all_vessels_rendered_count: allVesselsApiCount,
      target_vessels_count: targetVesselsApiCount,
      sales_target_count: salesTargetCount,
      immediate_target_count: immediateTargetCount,
      watchlist_count: watchlistCount
    },
    dashboard_dataset_audit: {
      all_vessels_api_source: "all_vessels",
      target_vessels_api_source: "sales_candidates + immediate_targets",
      immediate_targets_api_source: "immediate_targets top 5",
      all_vessels_api_count: allVesselsApiCount,
      target_vessels_api_count: targetVesselsApiCount,
      immediate_targets_api_count: immediateTargetCount,
      dashboard_all_vessels_rendered_count: allVesselsApiCount,
      dashboard_target_vessels_rendered_count: targetVesselsApiCount,
      port_call_id_coverage_percent: portCallCoverage
    },
    suspected_counting_issues: suspected,
    recommendations: [
      "Use all_vessels as the full valid port-call universe.",
      "Use sales_candidates + immediate_targets for 영업대상선박.",
      "Treat Pilot/PNC/Ulsan rows as enrichment unless high-confidence unmatched arrivals.",
      "Review source counts and dedupe audit after collector changes."
    ]
  };
}

function buildDatasetGenerationAudit(records = [], source = {}, sourceCounts = []) {
  const activeRecords = activeRecordsOnly(records);
  const buckets = buildVisibilityBuckets(activeRecords);
  const allRows = vesselGroupRows(activeRecords, "all");
  const targetRows = vesselGroupRows(activeRecords, "target");
  const sourceRowsCollected = sourceCounts.reduce((sum, row) => sum + Number(row.rows_collected || 0), 0) || activeRecords.reduce((sum, record) => sum + Math.max(1, Number(record.raw_row_count || record.detail_row_count || 1)), 0);
  const normalizedRows = activeRecords.length;
  const watchlistGenerated = activeRecords.filter(v => !isSalesCandidate(v) && isWatchlistVessel(v)).length;
  const salesTargetsGenerated = buckets.sales_candidates.length;
  const immediateTargetsGenerated = buckets.immediate_targets.length;
  const sourceError = source?.error || source?.query_error || null;
  let failedStage = null;
  let rootCause = "dataset_generation_completed";
  if (sourceError && !normalizedRows) {
    failedStage = "active_dataset_fetch";
    rootCause = "worker_could_not_fetch_active_dataset_from_supabase";
  } else if (!sourceRowsCollected && !normalizedRows) {
    failedStage = "source_collection_or_active_dataset";
    rootCause = "no_source_rows_or_active_dataset_rows_available";
  } else if (sourceRowsCollected > 0 && !normalizedRows) {
    failedStage = "normalization_or_active_dataset_binding";
    rootCause = "source_rows_exist_but_active_all_vessels_is_empty";
  } else if (normalizedRows > 0 && !allRows.length) {
    failedStage = "all_vessels_api_binding";
    rootCause = "active_records_exist_but_group_all_returns_zero_rows";
  }
  const gateBlockReasons = [];
  if (sourceError) gateBlockReasons.push(`Active dataset query error: ${sourceError}`);
  if (source?.pointer?.active_dataset_empty) gateBlockReasons.push("active_dataset_pointer resolved to an empty dataset.");
  if (!normalizedRows) gateBlockReasons.push("No active normalized vessel rows are available to Worker APIs.");
  if (normalizedRows > 0 && !allRows.length) gateBlockReasons.push("group=all binding returned zero rows despite active records.");
  return {
    generated_at: new Date().toISOString(),
    audit_type: "dataset_generation",
    root_cause: rootCause,
    failed_stage: failedStage,
    counts_by_stage: {
      source_rows_collected: sourceRowsCollected,
      normalized_rows: normalizedRows,
      all_vessels_generated: allRows.length,
      watchlist_generated: watchlistGenerated,
      sales_targets_generated: salesTargetsGenerated,
      immediate_targets_generated: immediateTargetsGenerated,
      vessels_json_rows: targetRows.length,
      candidates_json_rows: salesTargetsGenerated
    },
    source_rows_collected: sourceRowsCollected,
    normalized_rows: normalizedRows,
    all_vessels_generated: allRows.length,
    watchlist_generated: watchlistGenerated,
    sales_targets_generated: salesTargetsGenerated,
    immediate_targets_generated: immediateTargetsGenerated,
    vessels_json_rows: targetRows.length,
    candidates_json_rows: salesTargetsGenerated,
    active_dataset_audit: {
      active_dataset_pointer_run_id: source?.pointer?.active_run_id || null,
      latest_successful_run: source?.latest_successful_run_id || null,
      current_run: source?.pointer?.active_run_id || activeRecords.find(record => record.run_id)?.run_id || null,
      status_json_basis: "Worker /api/status.json is generated from Supabase active_dataset_pointer or latest successful summary fallback.",
      vessels_api_basis: "/api/vessels?group=all reads active normalized records; /api/vessels?group=target reads sales/immediate target rows.",
      static_json_note: "Repository dashboard/api/*.json files may be stale local no-secret exports and are not the production source of truth."
    },
    gate_audit: {
      active_dataset_fetch_gate: sourceError ? "blocked" : "pass",
      normalization_gate: normalizedRows > 0 ? "pass" : "blocked",
      all_vessels_gate: allRows.length > 0 ? "pass" : "blocked",
      candidate_generation_gate: normalizedRows > 0 ? "pass" : "not_reached",
      api_export_gate: allRows.length > 0 ? "pass" : "blocked"
    },
    gate_block_reasons: gateBlockReasons,
    source_breakdown: sourceCounts,
    recommended_fix: [
      "If this audit is empty in production, inspect active_dataset_pointer and vessel_snapshots for the active_run_id.",
      "If static dashboard/api/status.json shows record_count=0 but this Worker audit has rows, ignore the stale static export.",
      "If source rows exist but all_vessels_generated is zero, inspect normalization and group=all filtering before scoring."
    ]
  };
}

function buildPortCongestion(records, portCode) {
  const requested = normalizePortCode(portCode);
  return buildPortHeatmap(records).find(p => normalizePortCode(p.port_code || portCodeFromName(p.port)) === requested) || {
    port_code: requested,
    port_name: representativePortName(requested),
    total: 0,
    total_vessels: 0,
    vessel_count: 0,
    anchorage_vessels: 0,
    anchorage_waiting: 0,
    long_idle_vessels: 0,
    long_stay_vessels: 0,
    average_waiting_time: 0,
    berth_occupancy: 0,
    anchorage_density: 0,
    congestion_score: 0
  };
}

function buildAnchorage(records) {
  return sortCommercialPriority(records.filter(v => isAnchorageLike(v)))
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
  const salesTargetCount = buckets.sales_candidates.length;
  const immediateTargetCount = buckets.immediate_targets.length;
  const rankedTargetRows = buckets.target_vessels;
  const percentileRankPresentCount = rankedTargetRows.filter(hasCommercialRank).length;
  const percentileRankMissingCount = rankedTargetRows.length - percentileRankPresentCount;
  const thresholdOnlySalesTargetCount = records.filter(v => commercialScore(v) >= SALES_CANDIDATE_THRESHOLD && !isDepartedRecord(v) && !isHardCandidateExcluded(v)).length;
  const candidateGenerationRows = records.filter(v => commercialScore(v) >= 50 && !isDepartedRecord(v) && !isHardCandidateExcluded(v));
  const promotedCandidateRows = records.filter(v => isSalesCandidate(v) || isImmediateTarget(v));
  const excludedCandidateRows = candidateGenerationRows
    .filter(v => commercialScore(v) >= SALES_CANDIDATE_THRESHOLD && !isSalesCandidate(v))
    .map((v, index) => ({
      candidate_id: v.snapshot_id || v.port_call_id || v.port_call_identity || v.hybrid_entity_key || v.vessel_id || `excluded-${index}`,
      vessel_name: v.vessel_name || v.name || "",
      port_call_id: v.port_call_id || v.port_call_identity || "",
      commercial_value_score: commercialScore(v),
      candidate_band: v.candidate_band || v.sales_priority_band || (commercialScore(v) >= 75 ? "immediate_target_score_only" : "sales_target_score_only"),
      exclusion_reason: exclusionReason(v) || "not_promoted"
    }));
  const candidateExclusionReasonCounts = excludedCandidateRows.reduce((acc, row) => {
    acc[row.exclusion_reason] = (acc[row.exclusion_reason] || 0) + 1;
    return acc;
  }, {});
  const percentileLogicActive = percentileRankPresentCount > 0;
  const onlyThresholdLogicActive = false;
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
    score_distribution: {
      score_90_plus_count: scoreRangeCount(90),
      score_80_89_count: scoreRangeCount(80, 89),
      score_70_79_count: scoreRangeCount(70, 79),
      score_60_69_count: scoreRangeCount(60, 69),
      score_50_59_count: scoreRangeCount(50, 59),
      score_40_49_count: scoreRangeCount(40, 49),
      score_0_39_count: scores.filter(score => score < 40).length
    },
    raw_collected_rows: funnel.raw_api_rows,
    normalized_rows: records.length,
    all_vessels_count: records.length,
    target_vessels_count: buckets.target_vessels.length,
    sales_candidates_count: buckets.sales_candidates.length,
    immediate_targets_count: buckets.immediate_targets.length,
    candidate_generation_count: candidateGenerationRows.length,
    candidate_promotion_count: promotedCandidateRows.length,
    candidate_excluded_count: excludedCandidateRows.length,
    excluded_candidates: excludedCandidateRows,
    excluded_candidate_samples: excludedCandidateRows.slice(0, 50),
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
    sales_target_count_calculation: "score >= 65 AND not departed/excluded AND global_percentile <= 20 OR port_percentile <= 20",
    sales_target_threshold_only_count: thresholdOnlySalesTargetCount,
    percentile_logic_active: percentileLogicActive,
    only_threshold_logic_active: onlyThresholdLogicActive,
    percentile_rank_present_count: percentileRankPresentCount,
    percentile_rank_missing_count: percentileRankMissingCount,
    candidate_classification_logic: {
      immediate_targets: "score >= 75 AND top 10% global/port AND current/near-term work feasibility",
      sales_targets: "score >= 65 AND top 20% global/port",
      watchlist: "score >= 50 OR top 40% global/port",
      percentile_fallback: "if rank fields are missing, percentile guard fails so target ratio cannot inflate"
    },
    watchlist_count: records.filter(v => !isSalesCandidate(v) && isWatchlistVessel(v)).length,
    immediate_target_count: immediateTargetCount,
    candidate_exclusion_reason_counts: candidateExclusionReasonCounts,
    zero_sales_target_warning: records.length > 0 && salesTargetCount === 0 ? "영업대상 후보가 생성되지 않았습니다. 후보 생성 로직 또는 기준을 확인하세요." : "",
    target_ratio: targetRatio,
    immediate_target_ratio: immediateTargetRatio,
    target_ratio_warning: targetRatio > 30 ? "영업대상 기준이 너무 넓습니다." : "",
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
    anchorage_detected_count: records.filter(isAnchorageLike).length,
    staying_vessels_count: records.filter(v => ["arrived_staying", "berthed", "anchorage_waiting"].includes(String(v.status_bucket || deriveStatusBucket(v))) || (v.ata && !v.atd)).length,
    facility_unknown_count: records.filter(v => !hasValue(v.facility_type || v.berth_name || v.berth || v.anchorage_name || v.laidupFcltyNm || v.facility_name || v.facility_name_raw || v.terminal_name)).length,
    anchorage_detection_source_breakdown: records.reduce((acc, v) => {
      const source = anchorageSignalSource(v);
      if (source) acc[source] = (acc[source] || 0) + 1;
      return acc;
    }, {}),
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
    repeat_call_count_3plus: records.filter(v => Number(v.repeat_call_count || 0) >= 3).length,
    repeat_operator_count_3plus: records.filter(v => Number(v.repeat_operator_count || 0) >= 3).length,
    repeat_caller_count: records.filter(v => Number(v.repeat_call_count || 0) >= 3 || Number(v.repeat_caller_score || 0) >= 20).length,
    repeat_operator_count: records.filter(v => Number(v.operator_vessel_count || v.repeat_operator_count || 0) >= 3 || Number(v.repeat_operator_score || 0) >= 20).length,
    fleet_opportunity_count: buildFleetOpportunityRows(records).filter(row => Number(row.fleet_opportunity_score || 0) >= 35).length,
    operators_with_multiple_targets: buildFleetOpportunityRows(records).filter(row => Number(row.target_vessel_count || 0) >= 2).length,
    operators_with_multiple_immediate_targets: buildFleetOpportunityRows(records).filter(row => Number(row.immediate_target_count || 0) >= 2).length,
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
    contact_available_count: records.filter(v => ["contact_available", "high_confidence_contact"].includes(v.contact_path_status) || hasValue(v.operator_email || v.agent_email || v.operator_website || v.agent_website || v.operator_phone || v.agent_phone)).length,
    operator_confidence_avg: known.length ? Math.round(known.reduce((sum, v) => sum + Number(v.operator_confidence || 0), 0) / known.length) : 0,
    operator_source_breakdown: sourceBreakdown,
    candidates_with_operator_count: buckets.sales_candidates.filter(v => hasValue(v.operator_name || v.operator)).length,
    candidates_with_agent_count: buckets.sales_candidates.filter(v => hasValue(v.agent_name || v.agent)).length,
    immediate_targets_with_contact_path_count: buckets.immediate_targets.filter(v => v.contact_path_available || hasValue(v.operator_name || v.operator) || hasValue(v.agent_name || v.agent)).length,
    contact_ready_count: records.filter(v => Number(v.contact_readiness_score || 0) >= 50 || v.contact_path_available).length,
    candidates_contact_ready_count: buckets.sales_candidates.filter(v => Number(v.contact_readiness_score || 0) >= 50 || v.contact_path_available).length,
    repeat_caller_count: records.filter(v => Number(v.repeat_call_count || 0) >= 3 || Number(v.repeat_caller_score || 0) >= 20).length,
    repeat_operator_count: records.filter(v => Number(v.operator_vessel_count || v.repeat_operator_count || 0) >= 3 || Number(v.repeat_operator_score || 0) >= 20).length,
    fleet_opportunity_count: buildFleetOpportunityRows(records).filter(row => Number(row.fleet_opportunity_score || 0) >= 35).length,
    operators_with_multiple_targets: buildFleetOpportunityRows(records).filter(row => Number(row.target_vessel_count || 0) >= 2).length,
    operators_with_multiple_immediate_targets: buildFleetOpportunityRows(records).filter(row => Number(row.immediate_target_count || 0) >= 2).length
  };
}

function buildStatus(records, source) {
  const buckets = buildVisibilityBuckets(records);
  const countFunnel = buildCountFunnel(records, buckets);
  const dedupeDiagnostics = buildDedupeAudit(records, buckets);
  const matchingDiagnostics = buildMatchingDiagnostics(records);
  const predictionDiagnostics = buildPredictionDiagnostics(records);
  const dataQualityLayer = buildDataQualityLayerDiagnostics(records, matchingDiagnostics);
  const scoringDiagnostics = buildScoringDiagnostics(records);
  const high = records.filter(v => (v.risk_score || 0) >= 70);
  const displayableRows = buckets.target_vessels.length || records.length;
  const allDisplayVessels = vesselGroupRows(records, "all");
  const monitoringVessels = allDisplayVessels.filter(v => commercialScore(v) < SALES_CANDIDATE_THRESHOLD);
  const dataMode = buckets.target_vessels.length ? "supabase_live_snapshot" : records.length ? "supabase_snapshot_no_targets" : "no_live_data";
  const usingSnapshotFallback = Boolean(source.pointer?.fallback_pointer && records.length);
  const dataSourceUsed = source.data_source_used || (records.length
    ? (source.pointer?.local_static_snapshot ? "local_static_snapshot" : source.pointer?.fallback_pointer ? "supabase_latest_snapshot_fallback" : "supabase_active_dataset")
    : "diagnostics_only_no_live_data");
  const servingMode = dataSourceUsed === "local_static_snapshot"
    ? "static_json"
    : dataSourceUsed === "diagnostics_only_no_live_data"
      ? "local_diagnostics"
      : "worker_supabase";
  const fallbackUsed = Boolean(source.fallback_used || usingSnapshotFallback || dataSourceUsed !== "supabase_active_dataset");
  const fallbackReason = source.fallback_reason || (fallbackUsed ? source.pointer?.pointer_source || source.error || dataSourceUsed : null);
  const activeRunId = source.pointer?.active_run_id || null;
  const context = runContextFields({
    statusRunId: activeRunId,
    summaryRunId: activeRunId,
    activeRunId,
    latestSuccessfulRunId: source.latest_successful_run_id || activeRunId
  });
  const activeCollectedAt = source.pointer?.active_collected_at || source.pointer?.promoted_at || null;
  const dataAgeMinutes = activeCollectedAt ? Math.round((Date.now() - new Date(activeCollectedAt).getTime()) / 60000) : null;
  const dataIsStale = dataAgeMinutes === null ? Boolean(source.pointer?.is_stale) : dataAgeMinutes > AUTO_UPDATE_INTERVAL_HOURS * 60;
  return {
    run_id: activeRunId,
    ...context,
    serving_mode: servingMode,
    data_source_used: dataSourceUsed,
    fallback_used: fallbackUsed,
    fallback_reason: fallbackReason,
    generated_at: new Date().toISOString(),
    data_freshness: {
      active_collected_at: activeCollectedAt,
      data_age_minutes: dataAgeMinutes,
      is_stale: dataIsStale
    },
    auto_update_interval_hours: AUTO_UPDATE_INTERVAL_HOURS,
    auto_update_label: "데이터는 4시간마다 자동 업데이트됩니다.",
    version: "worker-live-api-v1",
    status: source.error && !records.length ? "degraded" : "success",
    user_message: fallbackUsed ? "최신 갱신 실패 - 마지막 정상 데이터 표시 중" : null,
    data_health: {
      label: "데이터 상태",
      last_successful_update: activeCollectedAt,
      current_run_status: source.pointer?.latest_run_status || (source.error ? "failed_or_unavailable" : "active"),
      vessel_record_count: records.length,
      supabase_storage_status: source.configured === false ? "static_json" : records.length ? "completed" : "unavailable",
      dataset_promotion_status: source.pointer?.fallback_pointer ? "fallback" : "promoted"
    },
    data_mode: dataMode,
    commercial_use_status: displayableRows ? "review_required" : "not_ready",
    live_data_available: Boolean(displayableRows),
    displayable_vessel_count: displayableRows,
    completed_at: new Date().toISOString(),
    record_count: records.length,
    target_count: buckets.target_vessels.length,
    opportunity_count: buckets.sales_candidates.length,
    all_vessels_count: records.length,
    all_collected_vessel_count: records.length,
    all_display_vessel_count: allDisplayVessels.length,
    monitoring_vessel_count: monitoringVessels.length,
    commercial_target_vessel_count: buckets.sales_candidates.length,
    target_vessel_count: buckets.target_vessels.length,
    staying_vessel_count: buckets.staying_vessels.length,
    anchorage_waiting_count: records.filter(isAnchorageLike).length,
    anchorage_detected_count: records.filter(isAnchorageLike).length,
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
    sales_target_count: buckets.sales_candidates.length,
    sales_target_count_summary: buckets.sales_candidates.length,
    sales_target_count_table_api: vesselGroupRows(records, "target").length,
    immediate_target_count_summary: buckets.immediate_targets.length,
    immediate_target_count_table_api: buckets.immediate_targets.length,
    dataset_run_id_summary: activeRunId,
    dataset_run_id_table: activeRunId,
    immediate_target_count: buckets.immediate_targets.length,
    lead_pipeline_count: buildLeadPipeline(records).length,
    imo_missing_count: buckets.target_vessels.filter(v => !v.imo).length,
    imo_recovery_kpis: buildImoRecoveryKpis(buckets.target_vessels),
    high_value_low_confidence_count: buildHighValueLowConfidence(buckets.target_vessels).length,
    opportunity_usd: records.reduce((sum, v) => sum + (v.opportunity_usd || 0), 0),
    count_funnel: countFunnel,
    dedupe_diagnostics: dedupeDiagnostics,
    scoring_diagnostics: scoringDiagnostics,
    candidate_generation_count: scoringDiagnostics.candidate_generation_count,
    candidate_promotion_count: scoringDiagnostics.candidate_promotion_count,
    candidate_excluded_count: scoringDiagnostics.candidate_excluded_count,
    candidate_exclusion_reason_counts: scoringDiagnostics.candidate_exclusion_reason_counts,
    candidate_excluded_samples: scoringDiagnostics.excluded_candidate_samples,
    sales_target_warning: records.length > 0 && buckets.sales_candidates.length === 0 ? "영업대상 후보가 생성되지 않았습니다. 후보 생성 로직 또는 기준을 확인하세요." : "",
    high_score_visibility_audit: highScoreVisibilityAudit(records, 93),
    commercial_ranking_audit: commercialRankingAudit(records),
    matching_diagnostics: matchingDiagnostics,
    prediction_diagnostics: predictionDiagnostics,
    data_quality_layer: dataQualityLayer,
    operator_diagnostics: buildOperatorDiagnostics(records, buckets),
    frontend_poll_interval_seconds: 900,
    source_runtime: {
      provider: dataSourceUsed.startsWith("supabase") ? "supabase" : dataSourceUsed === "local_static_snapshot" ? "static_json" : "diagnostics",
      configured: source.configured,
      error: source.error,
      data_source_used: dataSourceUsed,
      fallback_used: fallbackUsed,
      fallback_reason: fallbackReason,
      auth_key_type: source.pointer?.auth_key_type || (source.configured ? "unknown" : "missing"),
      row_count: records.length,
      active_run_id: activeRunId,
      active_collected_at: activeCollectedAt,
      promoted_at: source.pointer?.promoted_at || null,
      is_stale: dataIsStale,
      pointer_source: source.pointer?.pointer_source || "none",
      fallback_pointer: Boolean(source.pointer?.fallback_pointer),
      using_latest_snapshot_fallback: usingSnapshotFallback,
      fallback_status: fallbackUsed ? fallbackReason || "fallback" : null,
      pointer_diagnostics: source.pointer?.pointer_diagnostics || [],
      stale_warning: source.pointer?.fallback_pointer
        ? "활성 데이터셋 포인터가 비어 있어 최신 사용 가능 스냅샷을 표시 중입니다."
        : null
    },
    visibility_goal: "commercially_relevant_vessels_not_raw_count",
    target_definition: {
      commercial_gt_threshold: 5000,
      include: ["grtg >= 5000", "intrlGrtg >= 5000", "unknown GT requiring review"],
      exclude_from_main_view: ["GT under 5000", "non-commercial vessel types", "completed departure-only rows"]
    },
    commercial_command_center: buildCommandCenter(buckets.target_vessels),
    port_intelligence: buildPorts(records),
    port_intelligence_units: buildPortUnits(records),
    port_congestion_heatmap: buildPortHeatmap(buckets.target_vessels),
    all_port_congestion_heatmap: buildPortHeatmap(records),
    biofouling_timeline: buildBioTimeline(buckets.target_vessels)
  };
}

function historyLimit(searchParams) {
  return Math.min(1000, Math.max(1, Number(searchParams.get("limit") || 180)));
}

function appendHistoryFilters(path, searchParams, fieldMap = {}) {
  const params = [];
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  if (from) params.push(`snapshot_date=gte.${encodeURIComponent(from)}`);
  if (to) params.push(`snapshot_date=lte.${encodeURIComponent(to)}`);
  for (const [queryKey, column] of Object.entries(fieldMap)) {
    const value = searchParams.get(queryKey);
    if (value) params.push(`${column}=eq.${encodeURIComponent(value)}`);
  }
  params.push("order=snapshot_date.desc");
  params.push(`limit=${historyLimit(searchParams)}`);
  return `${path}${path.includes("?") ? "&" : "?"}${params.join("&")}`;
}

async function historyTable(env, table, searchParams, fieldMap = {}) {
  const response = await supabaseGet(env, appendHistoryFilters(`/rest/v1/${table}?select=*`, searchParams, fieldMap));
  return {
    table,
    rows: response.rows,
    ok: response.ok,
    status: response.status,
    error: response.error,
    filters: {
      from: searchParams.get("from") || null,
      to: searchParams.get("to") || null,
      port: searchParams.get("port") || null,
      operator: searchParams.get("operator") || null,
      vessel_type_group: searchParams.get("vessel_type_group") || null
    }
  };
}

async function historyApiResponse(pathname, searchParams, env) {
  if (pathname === "/api/history/ports.json") return json(await historyTable(env, "port_snapshot_daily", searchParams, { port: "port_code" }), { headers: corsHeaders() });
  const portMatch = pathname.match(new RegExp("^/api/history/ports/([^/]+)\\.json$"));
  if (portMatch) {
    const localParams = new URLSearchParams(searchParams);
    localParams.set("port", decodeURIComponent(portMatch[1]));
    return json(await historyTable(env, "port_snapshot_daily", localParams, { port: "port_code" }), { headers: corsHeaders() });
  }
  if (pathname === "/api/history/operators.json") return json(await historyTable(env, "operator_snapshot_daily", searchParams, { operator: "operator_normalized" }), { headers: corsHeaders() });
  const operatorMatch = pathname.match(new RegExp("^/api/history/operators/([^/]+)\\.json$"));
  if (operatorMatch) {
    const localParams = new URLSearchParams(searchParams);
    localParams.set("operator", normalizeCompanyName(decodeURIComponent(operatorMatch[1])));
    return json(await historyTable(env, "operator_snapshot_daily", localParams, { operator: "operator_normalized" }), { headers: corsHeaders() });
  }
  if (pathname === "/api/history/routes.json") return json(await historyTable(env, "route_snapshot_daily", searchParams, { vessel_type_group: "vessel_type_group" }), { headers: corsHeaders() });
  if (pathname === "/api/history/opportunities.json") return json(await historyTable(env, "commercial_opportunity_daily", searchParams, { port: "port_code" }), { headers: corsHeaders() });
  return null;
}

function ratePercent(numerator, denominator) {
  const total = Number(denominator || 0);
  return total ? Math.round((Number(numerator || 0) / total) * 1000) / 10 : 0;
}

function workerEnvPresent(env, name) {
  return Boolean(env?.[name] && String(env[name]).trim());
}

function workerNumberEnv(env, name, fallback) {
  const value = Number(env?.[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

const DEFAULT_PORT_OPERATION_API_URL = "http://apis.data.go.kr/1192000/VsslEtrynd5/Info5";
const PORT_OPERATION_SERVICE_KEY_ALIASES = ["PORT_OPERATION_SERVICE_KEY", "PORT_OPERATION_API_KEY", "DATA_GO_KR_API_KEY", "SERVICE_KEY", "SERVICEKEY", "YGPA_SERVICE_KEY"];

function workerAnyEnvPresent(env, names = []) {
  return names.some(name => workerEnvPresent(env, name));
}

function buildConfigStatus(env = {}) {
  const required = ["PORT_OPERATION_SERVICE_KEY", "PORT_OPERATION_API_URL", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];
  const portOperationApiUrlEffective = workerEnvPresent(env, "PORT_OPERATION_API_URL") || Boolean(DEFAULT_PORT_OPERATION_API_URL);
  const missingRequired = [
    workerAnyEnvPresent(env, PORT_OPERATION_SERVICE_KEY_ALIASES) ? null : "PORT_OPERATION_SERVICE_KEY",
    portOperationApiUrlEffective ? null : "PORT_OPERATION_API_URL",
    workerEnvPresent(env, "SUPABASE_URL") ? null : "SUPABASE_URL",
    workerEnvPresent(env, "SUPABASE_SERVICE_ROLE_KEY") ? null : "SUPABASE_SERVICE_ROLE_KEY"
  ].filter(Boolean);
  const sourceChecks = [
    ["port_operation", [...PORT_OPERATION_SERVICE_KEY_ALIASES, "PORT_OPERATION_API_URL"]],
    ["port_facility", ["PORT_FACILITY_SERVICE_KEY", "PORT_FACILITY_API_URL"]],
    ["pilot_sources", ["PILOT_SOURCE_URLS"]],
    ["berth_sources", ["BERTH_SOURCE_URLS", "PNC_SOURCE_URLS"]],
    ["ulsan_core", ["ULSAN_BERTH_DETAIL_API_URL", "ULSAN_CARGO_PLAN_API_URL", "ULSAN_BERTH_OPERATION_API_URL", "ULSAN_TERMINAL_PROCESS_API_URL"]],
    ["vessel_spec", ["VESSEL_SPEC_SERVICE_KEY", "VESSEL_SPEC_API_URL"]],
    ["mof_vts", ["MOF_VTS_API_BASE", "MOF_VTS_SERVICE_KEY"]],
    ["mof_ais_dynamic", ["MOF_AIS_DYNAMIC_API_URL", "MOF_AIS_DYNAMIC_SERVICE_KEY"]],
    ["google_drive", ["GDRIVE_SERVICE_ACCOUNT_JSON", "GDRIVE_FOLDER_ID"]]
  ];
  const enabledSources = sourceChecks
    .filter(([, keys]) => keys.some(key => workerEnvPresent(env, key)))
    .map(([name]) => name);
  const enrichmentSources = enabledSources.filter(name => !["port_operation", "google_drive"].includes(name));
  const workerSupabaseAvailable = workerEnvPresent(env, "SUPABASE_URL") && workerEnvPresent(env, "SUPABASE_SERVICE_ROLE_KEY");
  return {
    generated_at: new Date().toISOString(),
    environment: env.ENVIRONMENT || env.UPDATE_MODE || "cloudflare_worker",
    validation_mode: env.VALIDATION_MODE || "production",
    serving_mode: "worker_supabase",
    supported_serving_modes: [...SUPPORTED_SERVING_MODES],
    production_data_source: "supabase_active_dataset",
    worker_supabase_available: workerSupabaseAvailable,
    fallback_used: false,
    fallback_reason: null,
    config_source_model: {
      secrets: "Cloudflare/GitHub runtime secrets only",
      csv_registry: PORT_REGISTRY_SOURCE,
      env_vars: "runtime limits and toggles",
      code_defaults: PORT_REGISTRY_GENERATED_FROM_CSV ? "generated safe fallback cache" : "manual fallback"
    },
    required_env_vars: required,
    expected_env_names: required,
    accepted_fallback_env_names: {
      PORT_OPERATION_SERVICE_KEY: PORT_OPERATION_SERVICE_KEY_ALIASES.filter(name => name !== "PORT_OPERATION_SERVICE_KEY"),
      PORT_OPERATION_API_URL: ["default:PORT_OPERATION_API_URL=VsslEtrynd5/Info5"]
    },
    missing_required_config: missingRequired,
    secrets_present: Object.fromEntries(required.map(name => [name, workerEnvPresent(env, name)])),
    fallback_env_present: {
      PORT_OPERATION_SERVICE_KEY: Object.fromEntries(PORT_OPERATION_SERVICE_KEY_ALIASES.filter(name => name !== "PORT_OPERATION_SERVICE_KEY").map(name => [name, workerEnvPresent(env, name)]))
    },
    effective_config_present: {
      PORT_OPERATION_SERVICE_KEY: workerAnyEnvPresent(env, PORT_OPERATION_SERVICE_KEY_ALIASES),
      PORT_OPERATION_API_URL: portOperationApiUrlEffective,
      SUPABASE_URL: workerEnvPresent(env, "SUPABASE_URL"),
      SUPABASE_SERVICE_ROLE_KEY: workerEnvPresent(env, "SUPABASE_SERVICE_ROLE_KEY")
    },
    port_operation_api_url_default_used: !workerEnvPresent(env, "PORT_OPERATION_API_URL") && Boolean(DEFAULT_PORT_OPERATION_API_URL),
    enabled_sources: enabledSources,
    enabled_enrichment_sources: enrichmentSources,
    enabled_ports_count: PORT_REGISTRY.length,
    ports_registry_source: PORT_REGISTRY_SOURCE,
    ports_registry_generated_from_csv: PORT_REGISTRY_GENERATED_FROM_CSV,
    active_runtime_limits: {
      SOURCE_TIMEOUT_MS: workerNumberEnv(env, "SOURCE_TIMEOUT_MS", 30000),
      MAX_PORTS_PER_RUN: workerNumberEnv(env, "MAX_PORTS_PER_RUN", 50),
      MAX_OUTPUT_ROWS: workerNumberEnv(env, "MAX_OUTPUT_ROWS", 10000),
      MAX_SOURCE_ROWS: workerNumberEnv(env, "MAX_SOURCE_ROWS", 5000),
      MAX_TARGET_VESSELS: workerNumberEnv(env, "MAX_TARGET_VESSELS", 5000),
      MAX_CANDIDATES: workerNumberEnv(env, "MAX_CANDIDATES", 1000),
      MAX_CHILD_ENRICHMENT_ROWS: workerNumberEnv(env, "MAX_CHILD_ENRICHMENT_ROWS", 100),
      MAX_IMO_RECOVERY_CALLS: workerNumberEnv(env, "MAX_IMO_RECOVERY_CALLS", 100),
      MAX_API_RESPONSE_BYTES: workerNumberEnv(env, "MAX_API_RESPONSE_BYTES", 25000000),
      PORT_OPERATION_NUM_OF_ROWS: workerNumberEnv(env, "PORT_OPERATION_NUM_OF_ROWS", 50),
      PORT_OPERATION_MAX_PAGES: workerNumberEnv(env, "PORT_OPERATION_MAX_PAGES", 20),
      SOURCE_MAX_RETRIES: workerNumberEnv(env, "SOURCE_MAX_RETRIES", 2),
      API_CACHE_SECONDS
    },
    diagnosis_help: {
      missing_secret: "Check missing_required_config and secrets_present.",
      disabled_source: "Check enabled_sources and the matching source env/secret pair.",
      wrong_port_registry: `Ports are generated from ${PORT_REGISTRY_SOURCE}; update CSV before regenerating Worker constants.`,
      hardcoded_limit: "Check active_runtime_limits.",
      runtime_timeout: "Check SOURCE_TIMEOUT_MS and collector runtime budget in workflow env."
    }
  };
}

function buildCollectionLimitDiagnostics(logRows = [], activeRunId = null) {
  const scopedRows = activeRunId ? logRows.filter(row => String(row.run_id || "") === String(activeRunId)) : logRows;
  const portRows = scopedRows.filter(row => String(row.source_name || row.payload?.key || "").startsWith("port_operation_"));
  const sourceRows = portRows.map(row => {
    const payload = row.payload || {};
    const totalCount = Number(payload.pagination_total_count || payload.totalCount || 0);
    const rowsCollected = Number(row.rows_collected || payload.rows_collected || payload.row_count || 0);
    const maxRows = Number(payload.max_rows || 0);
    const truncated = Boolean(payload.truncated || payload.pagination_truncated || (totalCount > 0 && rowsCollected < totalCount) || (maxRows > 0 && rowsCollected >= maxRows));
    return {
      source_name: row.source_name,
      port_code: payload.portCode || payload.prtAgCd || null,
      prtAgCd: payload.prtAgCd || null,
      deGb: payload.deGb || payload.defaultParams?.deGb || String(row.source_name || "").split("_").pop()?.toUpperCase() || null,
      sde: payload.sde || null,
      ede: payload.ede || null,
      totalCount,
      totalPages_expected: Number(payload.totalPages_expected || payload.pagination_total_pages_expected || 0),
      pages_collected: Number(payload.pages_collected || payload.pagination_pages_collected || 0),
      rows_collected: rowsCollected,
      max_rows: maxRows || null,
      truncated,
      cap_name: truncated ? (payload.cap_name || (maxRows > 0 && rowsCollected >= maxRows ? "MAX_SOURCE_ROWS" : "PORT_OPERATION_MAX_PAGES")) : null,
      cap_value: truncated ? (payload.cap_value || maxRows || Number(payload.totalPages_expected || 0)) : null
    };
  });
  const rowsByPort = {};
  for (const row of sourceRows) {
    const key = row.prtAgCd || row.port_code || "unknown";
    rowsByPort[key] ||= { port_code: key, rows_collected: 0, totalCount: 0, truncated: false, sources: 0 };
    rowsByPort[key].rows_collected += row.rows_collected;
    rowsByPort[key].totalCount += row.totalCount;
    rowsByPort[key].truncated = rowsByPort[key].truncated || row.truncated;
    rowsByPort[key].sources += 1;
  }
  return {
    active_run_id: activeRunId,
    port_operation_sources_checked: sourceRows.length,
    truncated_source_count: sourceRows.filter(row => row.truncated).length,
    capped_by_limit: sourceRows.some(row => row.truncated),
    source_rows: sourceRows,
    rows_by_port: Object.values(rowsByPort).sort((a, b) => Number(b.rows_collected || 0) - Number(a.rows_collected || 0))
  };
}

async function buildPipelineHealth(env) {
  const pointer = await fetchActivePointer(env);
  const runs = await supabaseGet(env, "/rest/v1/data_collection_runs?select=*&order=started_at.desc&limit=20");
  const sourceLogs = await supabaseGet(env, "/rest/v1/source_collection_logs?select=*&order=started_at.desc&limit=200");
  const runRows = runs.rows || [];
  const logRows = sourceLogs.rows || [];
  const lastSuccessfulRun = runRows.find(row => ["promoted", "promotable"].includes(String(row.status || "").toLowerCase())) || null;
  const lastFailedRun = runRows.find(row => /failed|degraded|not_promoted|no_live_data/i.test(String(row.status || ""))) || null;
  const failedSources = logRows.filter(row => ["failed", "skipped"].includes(String(row.status || "").toLowerCase()) && row.error_message);
  const matchedRows = logRows.reduce((sum, row) => sum + Number(row.rows_matched || 0), 0);
  const collectedRows = logRows.reduce((sum, row) => sum + Number(row.rows_collected || 0), 0);
  const latestRun = runRows[0] || {};
  const sourceSummary = Object.values(logRows.reduce((acc, row) => {
    const key = row.source_name || "unknown_source";
    acc[key] ||= { source_name: key, latest_status: row.status, attempts: 0, success_count: 0, failed_count: 0, rows_collected: 0, rows_matched: 0, last_error: null };
    acc[key].attempts += 1;
    acc[key].success_count += String(row.status || "").toLowerCase() === "success" ? 1 : 0;
    acc[key].failed_count += String(row.status || "").toLowerCase() === "failed" ? 1 : 0;
    acc[key].rows_collected += Number(row.rows_collected || 0);
    acc[key].rows_matched += Number(row.rows_matched || 0);
    if (row.error_message && !acc[key].last_error) acc[key].last_error = row.error_message;
    return acc;
  }, {}));
  const targetRatio = Number(latestRun.target_ratio || latestRun.source_summary?.scoring_diagnostics?.target_ratio || 0);
  const imoRecovery = latestRun.source_summary?.imo_recovery || {};
  const enrichmentMatchRate = ratePercent(matchedRows, collectedRows);
  const collectionLimitDiagnostics = buildCollectionLimitDiagnostics(logRows, pointer.active_run_id || latestRun.run_id || null);
  const activeCollectedAt = pointer.active_collected_at || pointer.promoted_at || lastSuccessfulRun?.finished_at || null;
  const dataAgeMinutes = activeCollectedAt ? Math.round((Date.now() - new Date(activeCollectedAt).getTime()) / 60000) : null;
  const warnings = {
    no_live_data: !pointer.active_run_id && !pointer.legacy_latest,
    stale_data: dataAgeMinutes === null ? Boolean(pointer.is_stale) : dataAgeMinutes > AUTO_UPDATE_INTERVAL_HOURS * 60,
    source_failure: failedSources.length > 0,
    target_ratio_too_high: targetRatio > 30 || targetRatio > 0.3,
    enrichment_match_rate_low: collectedRows > 0 && enrichmentMatchRate < 20,
    imo_recovery_rate_low: Number(imoRecovery.imo_recovery_success_rate || 0) > 0 && Number(imoRecovery.imo_recovery_success_rate || 0) < 20,
    prediction_error_high: Number(latestRun.source_summary?.prediction?.avg_prediction_error_hours || 0) > 48
  };
  return {
    generated_at: new Date().toISOString(),
    active_run_id: pointer.active_run_id || null,
    active_pointer_source: pointer.pointer_source || null,
    last_successful_run: lastSuccessfulRun,
    last_failed_run: lastFailedRun,
    source_health_summary: sourceSummary,
    failed_sources: failedSources.slice(0, 50),
    data_freshness: {
      active_collected_at: activeCollectedAt,
      data_age_minutes: dataAgeMinutes,
      is_stale: warnings.stale_data
    },
    target_ratio: targetRatio,
    imo_recovery_status: imoRecovery,
    enrichment_match_rates: {
      enrichment_rows_collected: collectedRows,
      enrichment_rows_matched: matchedRows,
      enrichment_match_rate: enrichmentMatchRate
    },
    collection_limit_diagnostics: collectionLimitDiagnostics,
    warning_flags: warnings,
    alert_ready_diagnostics: warnings,
    query_status: {
      runs_ok: runs.ok,
      source_logs_ok: sourceLogs.ok,
      runs_error: runs.error,
      source_logs_error: sourceLogs.error
    }
  };
}

async function apiResponse(url, env) {
  const pathname = typeof url === "string" ? url : url.pathname;
  const searchParams = typeof url === "string" ? new URLSearchParams() : url.searchParams;
  if (pathname === "/api/config-status.json" || pathname.endsWith("/config-status.json")) return json(buildConfigStatus(env), { headers: corsHeaders() });
  if (pathname === "/api/health/pipeline.json" || pathname.endsWith("/health/pipeline.json")) return json(await buildPipelineHealth(env), { headers: corsHeaders() });
  if (pathname === "/api/quality/collection-limits.json" || pathname.endsWith("/quality/collection-limits.json")) {
    const pointer = await fetchActivePointer(env);
    const logs = await supabaseGet(env, "/rest/v1/source_collection_logs?select=*&order=started_at.desc&limit=300");
    return json({
      generated_at: new Date().toISOString(),
      active_run_id: pointer.active_run_id || null,
      query_status: { ok: logs.ok, error: logs.error || null },
      ...buildCollectionLimitDiagnostics(logs.rows || [], pointer.active_run_id || null)
    }, { headers: corsHeaders() });
  }
  if (pathname.startsWith("/api/history/")) {
    const historical = await historyApiResponse(pathname, searchParams, env);
    if (historical) return historical;
  }
  const lightweightSummaryRoute = pathname.endsWith("/dashboard-summary.json") ||
    pathname.endsWith("/status.json") ||
    pathname.endsWith("/changes.json") ||
    pathname.endsWith("/candidates/top.json") ||
    pathname.endsWith("/ports.json");
  if (lightweightSummaryRoute) {
    const pointer = await fetchActivePointer(env);
    const latestSummarySnapshot = await fetchLatestSummarySnapshot(env);
    if (latestSummarySnapshot && pathname.endsWith("/candidates/top.json")) {
      const summarySource = { configured: pointer.configured, error: pointer.error, pointer };
      const summary = buildDashboardSummaryFromSnapshot(latestSummarySnapshot, summarySource, latestSummarySnapshot.fallback_reason || "summary_snapshot_top_route");
      return json({
        active_run_id: summary.active_run_id,
        summary_run_id: summary.summary_run_id,
        data_source_used: summary.data_source_used,
        is_fallback: summary.is_fallback,
        fallback_used: summary.fallback_used,
        fallback_reason: summary.fallback_reason,
        generated_at: summary.generated_at,
        data_freshness: summary.data_freshness,
        record_count: summary.record_count,
        target_count: summary.target_count,
        immediate_target_count: summary.immediate_target_count,
        opportunity_count: summary.opportunity_count,
        immediate_targets: summary.immediate_targets,
        opportunities: summary.opportunities
      }, { headers: corsHeaders() });
    }
    if (latestSummarySnapshot && (!pointer.active_run_id || pointer.active_dataset_empty || pointer.error)) {
      const summarySource = { configured: pointer.configured, error: pointer.error, pointer };
      const summary = buildDashboardSummaryFromSnapshot(latestSummarySnapshot, summarySource, latestSummarySnapshot.fallback_reason || pointer.error || (pointer.active_run_id && pointer.active_run_id !== latestSummarySnapshot.run_id ? "latest_successful_summary_snapshot" : "active_summary_snapshot"));
      if (pathname.endsWith("/dashboard-summary.json")) return json(summary, { headers: corsHeaders() });
      if (pathname.endsWith("/status.json")) return json(summary.status, { headers: corsHeaders() });
      if (pathname.endsWith("/candidates/top.json")) return json({
        active_run_id: summary.active_run_id,
        summary_run_id: summary.summary_run_id,
        data_source_used: summary.data_source_used,
        is_fallback: summary.is_fallback,
        fallback_used: summary.fallback_used,
        fallback_reason: summary.fallback_reason,
        generated_at: summary.generated_at,
        data_freshness: summary.data_freshness,
        record_count: summary.record_count,
        target_count: summary.target_count,
        immediate_target_count: summary.immediate_target_count,
        opportunity_count: summary.opportunity_count,
        immediate_targets: summary.immediate_targets,
        opportunities: summary.opportunities
      }, { headers: corsHeaders() });
      if (pathname.endsWith("/ports.json")) {
        const portUnits = summary.port_units || flattenSummaryPortUnits(summary.ports || []);
        const data = searchParams.get("scope") === "units" ? portUnits : summary.ports;
        const subPortConsistency = buildSubPortConsistencyDiagnostics(summary.ports || []);
        return json({
        active_run_id: summary.active_run_id,
        summary_run_id: summary.summary_run_id,
        data_source_used: summary.data_source_used,
        is_fallback: summary.is_fallback,
        fallback_used: summary.fallback_used,
        fallback_reason: summary.fallback_reason,
        generated_at: summary.generated_at,
        data_freshness: summary.data_freshness,
        record_count: summary.record_count,
        target_count: summary.target_count,
        immediate_target_count: summary.immediate_target_count,
        opportunity_count: summary.opportunity_count,
        data,
        port_units: portUnits,
        sub_port_consistency: subPortConsistency
        }, { headers: corsHeaders() });
      }
      if (pathname.endsWith("/changes.json")) {
        const previousVersion = searchParams.get("since") || null;
        const previousSnapshot = previousVersion ? await fetchSummarySnapshotByRun(env, previousVersion) : null;
        const previousPortSummary = parseJsonField(previousSnapshot?.port_summary, []);
        const currentPortSummary = parseJsonField(latestSummarySnapshot?.port_summary, []);
        const previousPorts = new Set((Array.isArray(previousPortSummary) ? previousPortSummary : []).map(port => port.port_unit_key || port.port_code || port.port_name).filter(Boolean));
        const currentPorts = new Set((Array.isArray(currentPortSummary) ? currentPortSummary : []).map(port => port.port_unit_key || port.port_code || port.port_name).filter(Boolean));
        return json({
          dataset_version: latestSummarySnapshot.run_id,
          previous_dataset_version: previousVersion,
          active_run_id: pointer.active_run_id || null,
          summary_run_id: latestSummarySnapshot.run_id,
          data_source_used: summary.data_source_used,
          generated_at: summary.generated_at,
          data_freshness: summary.data_freshness,
          record_count: summary.record_count,
          target_count: summary.target_count,
          immediate_target_count: summary.immediate_target_count,
          opportunity_count: summary.opportunity_count,
          new_immediate_targets: Math.max(0, Number(latestSummarySnapshot.immediate_target_count || 0) - Number(previousSnapshot?.immediate_target_count || 0)),
          new_sales_candidates: Math.max(0, Number(latestSummarySnapshot.sales_target_count || 0) - Number(previousSnapshot?.sales_target_count || 0)),
          removed_targets: Math.max(0, Number(previousSnapshot?.sales_target_count || 0) - Number(latestSummarySnapshot.sales_target_count || 0)),
          changed_ports: [...currentPorts].filter(port => !previousPorts.has(port)),
          changed_operators: [],
          is_fallback: summary.is_fallback,
          fallback_used: summary.fallback_used,
          fallback_reason: summary.fallback_reason,
          changed: previousVersion ? String(previousVersion) !== String(latestSummarySnapshot.run_id || "") : false
        }, { headers: corsHeaders() });
      }
    }
  }
  const source = await fetchSupabaseRows(env);
  const latestSummarySnapshot = await fetchLatestSummarySnapshot(env);
  const allRecords = activeRecordsOnly(latestPerVesselPort(source.rows));
  const buckets = buildVisibilityBuckets(allRecords);
  const records = buckets.target_vessels;
  const shouldUseSummaryFallback = latestSummarySnapshot && (!allRecords.length || source.error || source.pointer?.active_dataset_empty);
  if (pathname.endsWith("/dashboard-summary.json")) {
    if (shouldUseSummaryFallback) return json(buildDashboardSummaryFromSnapshot(latestSummarySnapshot, source, source.error || "active_dataset_missing_or_empty"), { headers: corsHeaders() });
    const summary = buildDashboardSummary(allRecords, source);
    summary.is_fallback = false;
    Object.assign(summary, runContextFields({
      statusRunId: summary.status_run_id || summary.run_id || summary.active_run_id,
      summaryRunId: summary.active_run_id,
      activeRunId: summary.active_run_id,
      latestSuccessfulRunId: latestSummarySnapshot?.run_id || summary.latest_successful_run_id
    }));
    if (summary.status) {
      Object.assign(summary.status, runContextFields({
        statusRunId: summary.status.status_run_id || summary.status.run_id || summary.active_run_id,
        summaryRunId: summary.summary_run_id,
        activeRunId: summary.active_run_id,
        latestSuccessfulRunId: summary.latest_successful_run_id
      }));
    }
    summary.fallback_used = Boolean(summary.fallback_used);
    if (!summary.fallback_used) summary.fallback_reason = null;
    return json(summary, { headers: corsHeaders() });
  }
  if (pathname.endsWith("/status.json")) {
    if (shouldUseSummaryFallback) return json(buildStatusFromSummarySnapshot(latestSummarySnapshot, source, source.error || "active_dataset_missing_or_empty"), { headers: corsHeaders() });
    const status = buildStatus(allRecords, source);
    status.is_fallback = false;
    Object.assign(status, runContextFields({
      statusRunId: status.status_run_id || status.run_id || status.active_run_id,
      summaryRunId: status.active_run_id,
      activeRunId: status.active_run_id,
      latestSuccessfulRunId: latestSummarySnapshot?.run_id || status.latest_successful_run_id
    }));
    status.fallback_used = Boolean(status.fallback_used);
    if (!status.fallback_used) status.fallback_reason = null;
    return json(status, { headers: corsHeaders() });
  }
  if (pathname.endsWith("/changes.json")) {
    const status = shouldUseSummaryFallback
      ? buildStatusFromSummarySnapshot(latestSummarySnapshot, source, source.error || "active_dataset_missing_or_empty")
      : buildStatus(allRecords, source);
    const previousVersion = searchParams.get("since") || null;
    const previousSnapshot = previousVersion ? await fetchSummarySnapshotByRun(env, previousVersion) : null;
    const currentSnapshot = shouldUseSummaryFallback ? latestSummarySnapshot : {
      run_id: status.active_run_id,
      sales_target_count: status.sales_candidate_count,
      immediate_target_count: status.immediate_target_count,
      opportunity_count: status.opportunity_count,
      port_summary: buildPorts(allRecords),
      candidate_summary: { sales_target_count: status.sales_candidate_count, immediate_target_count: status.immediate_target_count }
    };
    const previousPortSummary = parseJsonField(previousSnapshot?.port_summary, []);
    const currentPortSummary = parseJsonField(currentSnapshot?.port_summary, []);
    const previousPorts = new Set((Array.isArray(previousPortSummary) ? previousPortSummary : []).map(port => port.port_code || port.port_name).filter(Boolean));
    const currentPorts = new Set((Array.isArray(currentPortSummary) ? currentPortSummary : []).map(port => port.port_code || port.port_name).filter(Boolean));
    const changedPorts = [...currentPorts].filter(port => !previousPorts.has(port));
    return json({
      dataset_version: currentSnapshot?.run_id || status.summary_run_id || status.active_run_id,
      previous_dataset_version: previousVersion,
      active_run_id: status.active_run_id,
      summary_run_id: status.summary_run_id || currentSnapshot?.run_id || null,
      data_source_used: status.data_source_used,
      generated_at: status.generated_at,
      data_freshness: status.data_freshness,
      record_count: status.record_count,
      target_count: status.target_count,
      immediate_target_count: status.immediate_target_count,
      opportunity_count: status.opportunity_count,
      new_immediate_targets: Math.max(0, Number(currentSnapshot?.immediate_target_count || 0) - Number(previousSnapshot?.immediate_target_count || 0)),
      new_sales_candidates: Math.max(0, Number(currentSnapshot?.sales_target_count || 0) - Number(previousSnapshot?.sales_target_count || 0)),
      removed_targets: Math.max(0, Number(previousSnapshot?.sales_target_count || 0) - Number(currentSnapshot?.sales_target_count || 0)),
      changed_ports: changedPorts,
      changed_operators: [],
      is_fallback: Boolean(shouldUseSummaryFallback),
      fallback_used: Boolean(status.fallback_used || shouldUseSummaryFallback),
      fallback_reason: shouldUseSummaryFallback ? status.fallback_reason : null,
      changed: previousVersion ? String(previousVersion) !== String(currentSnapshot?.run_id || status.active_run_id || "") : false
    }, { headers: corsHeaders() });
  }
  if (pathname.endsWith("/all-collected-vessels.json")) return json(allRecords, { headers: corsHeaders() });
  if (pathname.endsWith("/target-vessels.json")) return json(buckets.canonical_scored_vessels, { headers: corsHeaders() });
  if (pathname.endsWith("/staying-vessels.json")) return json(buckets.staying_vessels, { headers: corsHeaders() });
  if (pathname.endsWith("/arrival-pipeline.json")) return json(buckets.arrival_pipeline, { headers: corsHeaders() });
  if (pathname.endsWith("/predicted-arrivals.json")) return json(buildPredictedArrivals(allRecords), { headers: corsHeaders() });
  if (pathname.endsWith("/predicted-cleaning-opportunities.json")) return json(buildPredictedCleaningOpportunities(allRecords), { headers: corsHeaders() });
  if (pathname.endsWith("/lead-pipeline.json")) return json(buildLeadPipeline(allRecords), { headers: corsHeaders() });
  if (pathname.endsWith("/contact-ready-vessels.json")) return json(buildContactReadyVessels(allRecords), { headers: corsHeaders() });
  if (pathname.endsWith("/fleet-opportunities.json")) return json(buildFleetOpportunityRows(allRecords), { headers: corsHeaders() });
  if (pathname.endsWith("/fleet-cleaning-forecast.json")) return json(buildFleetOpportunityRows(allRecords).slice(0, 20), { headers: corsHeaders() });
  if (pathname.endsWith("/alert-candidates.json")) return json(buildAlertCandidates(allRecords), { headers: corsHeaders() });
  if (pathname.endsWith("/pilot-only-arrival-review.json") || pathname.endsWith("/review/pilot-only-arrivals.json")) return json(buckets.pilot_only_arrival_review, { headers: corsHeaders() });
  if (pathname.endsWith("/imo-recovery-queue.json")) return json(buildUnknownImo(records), { headers: corsHeaders() });
  if (pathname.endsWith("/imo-recovery-priority.json")) return json(buildUnknownImo(records), { headers: corsHeaders() });
  if (pathname.endsWith("/high-value-targets.json")) return json(buildHighValueTargets(records), { headers: corsHeaders() });
  if (pathname.endsWith("/review/unknown-gt.json")) return json(buildUnknownGtReview(records), { headers: corsHeaders() });
  if (pathname.endsWith("/review/high-value-low-confidence.json")) return json(buildHighValueLowConfidence(records), { headers: corsHeaders() });
  if (pathname.endsWith("/review/congestion-watchlist.json")) return json(buildCongestionWatchlist(records), { headers: corsHeaders() });
  if (pathname.endsWith("/quality/source-counts.json") || pathname.endsWith("/quality/vessel-universe-audit.json") || pathname.endsWith("/quality/dataset-generation-audit.json")) {
    const logs = await supabaseGet(env, "/rest/v1/source_collection_logs?select=*&order=started_at.desc&limit=300");
    const activeRunId = source.pointer?.active_run_id || allRecords.find(record => record.run_id)?.run_id || null;
    const sourceCounts = buildSourceCountsFromLogs(logs.rows || [], activeRunId);
    if (pathname.endsWith("/quality/source-counts.json")) {
      return json({
        generated_at: new Date().toISOString(),
        active_run_id: activeRunId,
        query_status: { ok: logs.ok, error: logs.error || null },
        source_counts: sourceCounts
      }, { headers: corsHeaders() });
    }
    if (pathname.endsWith("/quality/dataset-generation-audit.json")) {
      return json(buildDatasetGenerationAudit(allRecords, {
        ...source,
        latest_successful_run_id: latestSummarySnapshot?.run_id || null
      }, sourceCounts), { headers: corsHeaders() });
    }
    return json({
      active_run_id: activeRunId,
      query_status: { source_logs_ok: logs.ok, source_logs_error: logs.error || null },
      vessel_universe_audit: buildVesselUniverseAudit(allRecords, sourceCounts)
    }, { headers: corsHeaders() });
  }
  if (pathname.endsWith("/quality/dedupe-audit.json")) return json(buildDedupeAudit(allRecords), { headers: corsHeaders() });
  if (pathname.endsWith("/quality/candidate-promotion-audit.json")) return json(buildCandidatePromotionAudit(allRecords), { headers: corsHeaders() });
  if (pathname.endsWith("/quality/basic-info-coverage.json")) return json(buildBasicInfoCoverage(records), { headers: corsHeaders() });
  if (pathname.endsWith("/quality/scoring-diagnostics.json")) return json(buildScoringDiagnostics(allRecords), { headers: corsHeaders() });
  if (pathname.endsWith("/quality/matching-diagnostics.json")) return json(buildMatchingDiagnostics(allRecords), { headers: corsHeaders() });
  if (pathname.endsWith("/quality/imo-recovery.json")) return json(buildImoRecoveryKpis(records), { headers: corsHeaders() });
  if (pathname.endsWith("/quality/prediction-feedback.json")) return json(buildPredictionDiagnostics(allRecords), { headers: corsHeaders() });
  if (pathname.endsWith("/quality/data-quality.json")) return json(buildDataQualityLayerDiagnostics(allRecords), { headers: corsHeaders() });
  if (pathname.endsWith("/review/basic-info-missing.json")) return json(buildBasicInfoMissing(records), { headers: corsHeaders() });
  if (pathname.endsWith("/quality/high-score-visibility-audit.json")) {
    return json(highScoreVisibilityAudit(allRecords, Number(searchParams.get("threshold") || 93)), { headers: corsHeaders() });
  }
  if (pathname.endsWith("/quality/commercial-ranking-audit.json")) {
    return json(commercialRankingAudit(allRecords), { headers: corsHeaders() });
  }
  const portMatch = pathname.match(new RegExp("^/api/ports/([^/]+)/(vessels|target-vessels|staying-vessels|arrivals|candidates|berths|congestion|anchorage)\\.json$"));
  if (portMatch) {
    const rows = recordsForPort(allRecords, decodeURIComponent(portMatch[1]));
    if (portMatch[2] === "vessels") return json(rows, { headers: corsHeaders() });
    if (portMatch[2] === "target-vessels") return json(rows.filter(isMainCommercialVessel), { headers: corsHeaders() });
    if (portMatch[2] === "staying-vessels") return json(rows.filter(v => ["arrived_staying", "berthed", "anchorage_waiting"].includes(v.status_bucket)), { headers: corsHeaders() });
    if (portMatch[2] === "arrivals") return json(rows.filter(v => v.status_bucket === "arriving_soon"), { headers: corsHeaders() });
    if (portMatch[2] === "candidates") return json(buildVisibilityBuckets(rows).sales_candidates, { headers: corsHeaders() });
    if (portMatch[2] === "congestion") return json(buildPortCongestion(records, decodeURIComponent(portMatch[1])), { headers: corsHeaders() });
    if (portMatch[2] === "anchorage") return json(buildAnchorage(rows), { headers: corsHeaders() });
    return json(rows.filter(v => v.berth).map(v => ({ berth_name: v.berth, vessel_name: v.vessel_name, status: v.status, eta: v.eta, etd: v.etd })), { headers: corsHeaders() });
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
    const paged = pageRows(sourceRows, searchParams);
    const groupCounts = {
      target: vesselGroupRows(allRecords, "target").length,
      all: vesselGroupRows(allRecords, "all").length
    };
    const status = buildStatus(allRecords, source);
    const regressionWarnings = [];
    if (status.record_count > 0 && groupCounts.all === 0) regressionWarnings.push("전체선박 생성 실패: 정규화 후 all_vessels가 비어 있습니다.");
    if (group === "all" && groupCounts.all > 0 && !paged.data.length) regressionWarnings.push("전체선박 UI/API 바인딩 실패.");
    return json({
      active_run_id: status.active_run_id,
      data_source_used: status.data_source_used,
      fallback_used: status.fallback_used,
      fallback_reason: status.fallback_reason,
      generated_at: status.generated_at,
      data_freshness: status.data_freshness,
      record_count: status.record_count,
      all_vessels_count: groupCounts.all,
      target_count: status.target_count,
      immediate_target_count: status.immediate_target_count,
      opportunity_count: status.opportunity_count,
      ...paged,
      vessels: paged.data,
      groupCounts,
      all_vessels_api_count: groupCounts.all,
      target_vessels_api_count: groupCounts.target,
      all_vessels_rendered_count: group === "all" ? sourceRows.length : groupCounts.all,
      target_vessels_rendered_count: group === "target" ? sourceRows.length : groupCounts.target,
      sales_target_count_table_api: groupCounts.target,
      sales_target_count_rendered: group === "target" ? sourceRows.length : groupCounts.target,
      immediate_target_count_table_api: buildVisibilityBuckets(allRecords).immediate_targets.length,
      immediate_target_count_rendered: buildVisibilityBuckets(allRecords).immediate_targets.length,
      dataset_run_id_table: status.active_run_id,
      dataset_run_id_summary: status.active_run_id,
      dataset_relationship: "all_vessels contains watchlist, sales_targets, and immediate_targets",
      regression_warnings: regressionWarnings
    }, { headers: corsHeaders() });
  }
  const vesselMatch = pathname.match(new RegExp("^/api/vessels/([^/]+)$"));
  if (vesselMatch) {
    const vessel = findVesselById(allRecords, vesselMatch[1]);
    return json(vessel || { error: "not_found" }, { status: vessel ? 200 : 404, headers: corsHeaders() });
  }
  const operatorMatch = pathname.match(new RegExp("^/api/operators/([^/]+)/portfolio\\.json$"));
  if (operatorMatch) {
    const key = decodeURIComponent(operatorMatch[1]);
    const rows = activeRecordsOnly(allRecords).filter(v => repeatOperatorKey(v) === normalizeCompanyName(key) || String(v.operator_name || v.operator || "").toLowerCase() === key.toLowerCase());
    const fleet = buildFleetOpportunityRows(rows)[0] || buildFleetOpportunityRows(allRecords).find(row => row.operator_normalized === normalizeCompanyName(key) || row.operator_name === key);
    return json({
      operator: fleet || { operator_name: key, current_vessel_count: rows.length },
      vessels: sortCommercialPriority(rows).slice(0, 100)
    }, { headers: corsHeaders() });
  }
  if (pathname.endsWith("/candidates.json")) return json(buckets.sales_candidates, { headers: corsHeaders() });
  if (pathname.endsWith("/candidates/top.json")) {
    if (shouldUseSummaryFallback) {
      const summary = buildDashboardSummaryFromSnapshot(latestSummarySnapshot, source, source.error || "active_dataset_missing_or_empty");
      return json({
        active_run_id: summary.active_run_id,
        summary_run_id: summary.summary_run_id,
        data_source_used: summary.data_source_used,
        is_fallback: true,
        fallback_used: summary.fallback_used,
        fallback_reason: summary.fallback_reason,
        generated_at: summary.generated_at,
        data_freshness: summary.data_freshness,
        record_count: summary.record_count,
        target_count: summary.target_count,
        immediate_target_count: summary.immediate_target_count,
        opportunity_count: summary.opportunity_count,
        immediate_targets: summary.immediate_targets,
        opportunities: summary.opportunities
      }, { headers: corsHeaders() });
    }
    const status = buildStatus(allRecords, source);
    return json({
    active_run_id: status.active_run_id,
    data_source_used: status.data_source_used,
    fallback_used: status.fallback_used,
    fallback_reason: status.fallback_reason,
    generated_at: status.generated_at,
    data_freshness: status.data_freshness,
    record_count: status.record_count,
    target_count: status.target_count,
    immediate_target_count: status.immediate_target_count,
    opportunity_count: status.opportunity_count,
    immediate_targets: sortCommercialPriority(buckets.immediate_targets).slice(0, 5),
    opportunities: sortCommercialPriority(buckets.sales_candidates.filter(v => !isImmediateTarget(v))).slice(0, 5)
    }, { headers: corsHeaders() });
  }
  if (pathname.endsWith("/hot-candidates.json")) return json(buckets.immediate_targets, { headers: corsHeaders() });
  if (pathname.endsWith("/master/unknown-imo.json")) return json(buildUnknownImo(records), { headers: corsHeaders() });
  if (pathname.endsWith("/ports.json")) {
    if (shouldUseSummaryFallback) {
      const summary = buildDashboardSummaryFromSnapshot(latestSummarySnapshot, source, source.error || "active_dataset_missing_or_empty");
      return json({
        active_run_id: summary.active_run_id,
        summary_run_id: summary.summary_run_id,
        data_source_used: summary.data_source_used,
        is_fallback: true,
        fallback_used: summary.fallback_used,
        fallback_reason: summary.fallback_reason,
        generated_at: summary.generated_at,
        data_freshness: summary.data_freshness,
        record_count: summary.record_count,
        target_count: summary.target_count,
        immediate_target_count: summary.immediate_target_count,
        opportunity_count: summary.opportunity_count,
      data: searchParams.get("scope") === "units" ? (summary.port_units || flattenSummaryPortUnits(summary.ports || [])) : summary.ports,
      port_units: summary.port_units || flattenSummaryPortUnits(summary.ports || [])
      }, { headers: corsHeaders() });
    }
    const status = buildStatus(allRecords, source);
    const ports = buildPorts(allRecords);
    const portUnits = buildPortUnits(allRecords);
    return json({
      active_run_id: status.active_run_id,
      data_source_used: status.data_source_used,
      fallback_used: status.fallback_used,
      fallback_reason: status.fallback_reason,
      generated_at: status.generated_at,
      data_freshness: status.data_freshness,
      record_count: status.record_count,
      target_count: status.target_count,
      immediate_target_count: status.immediate_target_count,
      opportunity_count: status.opportunity_count,
      data: searchParams.get("scope") === "units" ? portUnits : ports,
      port_units: portUnits,
      sub_port_consistency: buildSubPortConsistencyDiagnostics(ports)
    }, { headers: corsHeaders() });
  }
  if (pathname.endsWith("/port-opportunities.json")) return json(buildPortOpportunityRanking(records), { headers: corsHeaders() });
  if (pathname.endsWith("/hot-vessels.json")) return json(buildHot(records), { headers: corsHeaders() });
  if (pathname.endsWith("/commercial-command-center.json")) return json(buildCommandCenter(records), { headers: corsHeaders() });
  if (pathname.endsWith("/port-congestion-heatmap.json")) return json(buildPortHeatmap(records), { headers: corsHeaders() });
  if (pathname.endsWith("/biofouling-timeline.json")) return json(buildBioTimeline(records), { headers: corsHeaders() });
  return null;
}

function isWorkerCacheableApi(pathname = "") {
  return pathname.endsWith("/dashboard-summary.json") ||
    pathname.endsWith("/status.json") ||
    pathname.endsWith("/changes.json") ||
    pathname.endsWith("/candidates/top.json") ||
    pathname.endsWith("/ports.json");
}

function shouldBypassAssetCache(pathname = "") {
  return pathname === "/" ||
    pathname.endsWith(".html") ||
    pathname.endsWith(".js") ||
    pathname.endsWith(".css");
}

function withUiAssetCacheHeaders(request, response) {
  const pathname = new URL(request.url).pathname;
  if (!shouldBypassAssetCache(pathname)) return response;
  const headers = new Headers(response.headers);
  headers.set("cache-control", UI_ASSET_CACHE_CONTROL);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders() });
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      if (request.method === "GET" && isWorkerCacheableApi(url.pathname) && typeof caches !== "undefined") {
        const cache = caches.default;
        const cacheKey = new Request(url.toString(), request);
        const cached = await cache.match(cacheKey);
        if (cached) return cached;
        const response = await apiResponse(url, env);
        if (response) {
          response.headers.set("cache-control", `public, max-age=${API_CACHE_SECONDS}, stale-while-revalidate=900`);
          await cache.put(cacheKey, response.clone());
          return response;
        }
      }
      const response = await apiResponse(url, env);
      if (response) return response;
    }
    return withUiAssetCacheHeaders(request, await env.ASSETS.fetch(request));
  }
};
