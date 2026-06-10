const PORT_FIELD_NAMES = [
  "port_code",
  "port_name",
  "port",
  "port_name_ko",
  "prtAgCd",
  "prtAgNm",
  "portName",
  "port_nm",
  "current_port",
  "arrival_port",
  "destination_port"
];

const CANONICAL_PORTS = [
  {
    port_code: "020",
    port_name: "부산",
    aliases: ["020", "BUSAN", "PUSAN", "부산", "부산항", "KRPUS", "KR PUS"]
  },
  {
    port_code: "820",
    port_name: "울산",
    aliases: ["820", "ULSAN", "울산", "울산항", "KRUSN", "KR USN"]
  },
  {
    port_code: "620-YEOSU",
    port_name: "여수",
    aliases: ["620", "620-YEOSU", "YEOSU", "여수", "여수항", "KRYOS", "KR YOS"]
  },
  {
    port_code: "620-GWANGYANG",
    port_name: "광양",
    aliases: ["620-GWANGYANG", "GWANGYANG", "광양", "광양항", "KRKAN", "KR KAN"]
  },
  {
    port_code: "030",
    port_name: "인천",
    aliases: ["030", "INCHEON", "인천", "인천항", "KRICN", "KR ICN"]
  },
  {
    port_code: "031",
    port_name: "평택·당진",
    aliases: ["031", "PYEONGTAEK", "PYONGTAEK", "DANGJIN", "평택", "평택항", "당진", "당진항", "평택당진", "KRPTK", "KR PTK", "KRDJN", "KR DJN"]
  },
  {
    port_code: "810",
    port_name: "포항",
    aliases: ["810", "POHANG", "포항", "포항항", "KRKPO", "KR KPO"]
  },
  {
    port_code: "622",
    port_name: "마산/창원",
    aliases: ["622", "MASAN", "CHANGWON", "JINHAE", "마산", "마산항", "창원", "창원항", "진해", "진해항", "KRMAS", "KR MAS", "KRCHF", "KR CHF"]
  },
  {
    port_code: "070",
    port_name: "목포",
    aliases: ["070", "MOKPO", "목포", "목포항", "KRMOK", "KR MOK"]
  },
  {
    port_code: "080",
    port_name: "군산",
    aliases: ["080", "GUNSAN", "군산", "군산항", "KRKUV", "KR KUV"]
  },
  {
    port_code: "621",
    port_name: "대산",
    aliases: ["621", "DAESAN", "대산", "대산항", "KRTSN", "KR TSN"]
  },
  {
    port_code: "120",
    port_name: "동해/묵호",
    aliases: ["120", "DONGHAE", "MUKHO", "동해", "동해항", "묵호", "묵호항", "KRTGH", "KR TGH"]
  },
  {
    port_code: "940",
    port_name: "제주",
    aliases: ["940", "JEJU", "제주", "제주항", "KRCJU", "KR CJU"]
  }
];

const PORT_ALIAS_LOOKUP = new Map();
const PORT_CODE_LOOKUP = new Map();
for (const port of CANONICAL_PORTS) {
  PORT_CODE_LOOKUP.set(port.port_code, port);
  for (const alias of port.aliases) PORT_ALIAS_LOOKUP.set(aliasKey(alias), port);
}

function normalizeText(value) {
  return String(value || "").normalize("NFKC").trim();
}

function aliasKey(value) {
  return normalizeText(value).toUpperCase().replace(/[\s._-]+/g, "");
}

function unknownPort() {
  return { port_code: "UNKNOWN", port_name: "미확인 항만", display_name: "미확인 항만" };
}

function emptyPort() {
  return { port_code: null, port_name: "", display_name: "" };
}

function knownPort(port) {
  return { port_code: port.port_code, port_name: port.port_name, display_name: port.port_name };
}

function normalizePortScalar(value) {
  const raw = normalizeText(value);
  if (!raw) return emptyPort();

  const compact = aliasKey(raw);
  if (["UNKNOWN", "UNK", "NA", "N/A", "NULL", "미상", "미확인", "확인불가"].includes(compact)) return unknownPort();

  const numericCode = /^\d{1,3}$/.test(compact) ? compact.padStart(3, "0") : compact;
  const direct = PORT_ALIAS_LOOKUP.get(compact) || PORT_ALIAS_LOOKUP.get(numericCode) || PORT_CODE_LOOKUP.get(raw);
  if (direct) return knownPort(direct);

  if (/BUSAN|PUSAN/.test(compact) || compact.includes("부산")) return knownPort(PORT_CODE_LOOKUP.get("020"));
  if (/ULSAN/.test(compact) || compact.includes("울산")) return knownPort(PORT_CODE_LOOKUP.get("820"));
  if (/YEOSU/.test(compact) || compact.includes("여수")) return knownPort(PORT_CODE_LOOKUP.get("620-YEOSU"));
  if (/GWANGYANG/.test(compact) || compact.includes("광양")) return knownPort(PORT_CODE_LOOKUP.get("620-GWANGYANG"));
  if (/INCHEON/.test(compact) || compact.includes("인천")) return knownPort(PORT_CODE_LOOKUP.get("030"));
  if (/PYEONGTAEK|PYONGTAEK|DANGJIN/.test(compact) || compact.includes("평택") || compact.includes("당진")) return knownPort(PORT_CODE_LOOKUP.get("031"));
  if (/POHANG/.test(compact) || compact.includes("포항")) return knownPort(PORT_CODE_LOOKUP.get("810"));
  if (/MASAN|CHANGWON|JINHAE/.test(compact) || compact.includes("마산") || compact.includes("창원") || compact.includes("진해")) return knownPort(PORT_CODE_LOOKUP.get("622"));
  if (/MOKPO/.test(compact) || compact.includes("목포")) return knownPort(PORT_CODE_LOOKUP.get("070"));
  if (/GUNSAN/.test(compact) || compact.includes("군산")) return knownPort(PORT_CODE_LOOKUP.get("080"));
  if (/DAESAN/.test(compact) || compact.includes("대산")) return knownPort(PORT_CODE_LOOKUP.get("621"));
  if (/DONGHAE|MUKHO/.test(compact) || compact.includes("동해") || compact.includes("묵호")) return knownPort(PORT_CODE_LOOKUP.get("120"));
  if (/JEJU/.test(compact) || compact.includes("제주")) return knownPort(PORT_CODE_LOOKUP.get("940"));

  return unknownPort();
}

export function normalizePort(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return normalizeRecordPort(value).port;
  return normalizePortScalar(value);
}

export function normalizeRecordPort(record = {}) {
  let sawPortValue = false;
  let firstUnknown = null;
  for (const field of PORT_FIELD_NAMES) {
    const value = record?.[field];
    if (value === undefined || value === null || String(value).trim() === "") continue;
    sawPortValue = true;
    const port = normalizePortScalar(value);
    if (port.port_code && port.port_code !== "UNKNOWN") return { port, field, missing: false, unknown: false, raw: value };
    if (!firstUnknown && port.port_code === "UNKNOWN") firstUnknown = { port, field, missing: false, unknown: true, raw: value };
  }
  if (firstUnknown) return firstUnknown;
  return { port: emptyPort(), field: null, missing: !sawPortValue, unknown: false, raw: null };
}

export function normalizedPortKey(record = {}) {
  const normalized = normalizeRecordPort(record);
  return normalized.port.port_code || normalized.port.port_name || "UNKNOWN";
}

export function normalizedPortDisplay(record = {}) {
  const normalized = normalizeRecordPort(record);
  return normalized.port.display_name || normalized.port.port_name || "미확인 항만";
}

export function detectPortFieldNames(records = [], sampleSize = 50) {
  const found = new Set();
  for (const record of records.slice(0, sampleSize)) {
    for (const field of PORT_FIELD_NAMES) {
      const value = record?.[field];
      if (value !== undefined && value !== null && String(value).trim() !== "") found.add(field);
    }
  }
  return [...found].sort();
}

function firstFiniteNumber(values = []) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function opportunityScore(record = {}) {
  return firstFiniteNumber([
    record.salesScore,
    record.sales_score,
    record.commercial_value_score,
    record.total_sales_priority_score,
    record.opportunity_score,
    record.cleaning_candidate_score,
    record.cleaningOpportunityScore,
    record.cleaning_opportunity_score,
    record.hull_cleaning_opportunity_score,
    record.predicted_cleaning_opportunity_score
  ]);
}

function riskScore(record = {}) {
  return firstFiniteNumber([
    record.risk_score,
    record.biofouling_exposure_score,
    record.biofouling_risk_score,
    record.biofouling_score,
    record.operational_risk_score
  ]) || 0;
}

function hasText(value) {
  const text = String(value ?? "").normalize("NFKC").trim();
  if (!text) return false;
  return !["-", "--", "0", "unknown", "null", "undefined", "n/a", "na", "none", "확인 필요", "미확인", "정보 없음"].includes(text.toLowerCase());
}

function stayHours(record = {}) {
  const hours = firstFiniteNumber([
    record.stay_hours,
    record.current_call_stay_hours,
    record.cumulative_stay_hours,
    record.port_stay_hours,
    record.berth_hours
  ]);
  const days = firstFiniteNumber([record.stay_days]);
  const anchorage = firstFiniteNumber([record.anchorage_hours, record.waiting_hours, record.estimated_waiting_time]);
  return Math.max(hours || 0, days ? days * 24 : 0, anchorage || 0);
}

function hasTimingSignal(record = {}) {
  return hasText(record.port_name || record.port || record.current_port || record.destination_port) ||
    hasText(record.eta || record.etb || record.ata || record.atb) ||
    /arrival|inbound|waiting|anchor|anchorage|묘박|정박|대기|입항/.test(String(record.status || record.status_bucket || record.port_call_status || "").toLowerCase());
}

function commercialSignalCount(record = {}) {
  const score = opportunityScore(record) || 0;
  const risk = riskScore(record);
  const hours = stayHours(record);
  const gt = Number(record.gt || record.grtg || record.intrlGrtg || record.gross_tonnage || 0);
  const typeText = String(record.vessel_type || record.vessel_type_group || record.commercial_segment || "").toLowerCase();
  const repeat = Number(record.korea_call_count || record.repeat_korea_call_count || record.visit_count_90d || record.visit_count || record.repeat_caller_score || record.korea_presence_score || 0);
  const cleaningWindow = Number(record.cleaning_window_score || record.window_score || record.predicted_cleaning_opportunity_score || record.cleaningOpportunityScore || record.cleaning_opportunity_score || 0);
  const complianceScore = Number(record.compliance_score || record.compliance_exposure_score || 0);
  const highValueVessel = gt >= 30000 || /bulk|tanker|container|cargo|carrier|pctc|ro-ro|lng|lpg/.test(typeText);
  const signals = [];
  if (score >= 65 || (score >= 55 && risk >= 65) || cleaningWindow >= 70) signals.push("opportunity");
  if (risk >= 65 || complianceScore >= 65) signals.push("risk");
  if ((hours >= 72 || Number(record.anchorage_hours || record.waiting_hours || 0) >= 48) && (score >= 50 || risk >= 50 || cleaningWindow >= 50 || highValueVessel)) signals.push("long_stay");
  if ((gt >= 80000 && (score >= 55 || risk >= 55 || cleaningWindow >= 60 || hours >= 72)) ||
    (gt >= 30000 && (score >= 80 || risk >= 65 || Number(record.cleaning_window_score || record.window_score || 0) >= 70)) ||
    (/bulk|tanker|container|cargo|carrier|pctc|ro-ro|lng|lpg/.test(typeText) && (score >= 80 || risk >= 65 || Number(record.cleaning_window_score || record.window_score || 0) >= 70))) signals.push("large_vessel");
  if ((repeat >= 2 || Number(record.repeat_caller_score || record.korea_presence_score || 0) >= 70) && (score >= 50 || risk >= 60 || cleaningWindow >= 60 || hours >= 72)) signals.push("repeat");
  if (cleaningWindow >= 60) signals.push("cleaning_window");
  return new Set(signals).size;
}

function isHotCandidate(record = {}) {
  const score = opportunityScore(record) || 0;
  return score >= 75 && isSalesCandidate(record);
}

function isSalesCandidate(record = {}) {
  return commercialSignalCount(record) >= 2 && hasTimingSignal(record);
}

function isImmediatePortCandidate(record = {}) {
  const score = opportunityScore(record) || 0;
  return isSalesCandidate(record) &&
    isHotCandidate(record) &&
    hasTimingSignal(record) &&
    (riskScore(record) >= 60 || stayHours(record) >= 72 || Number(record.cleaning_window_score || record.window_score || 0) >= 60);
}

function latestTimestamp(record = {}) {
  for (const field of ["last_seen_at", "collected_at", "updated_at", "generated_at", "ata", "atb", "eta", "etb"]) {
    const value = record?.[field];
    const time = value ? Date.parse(value) : NaN;
    if (Number.isFinite(time)) return time;
  }
  return null;
}

function sortPortRows(left, right) {
  return Number(right.vessel_count || 0) - Number(left.vessel_count || 0) ||
    Number(right.hot_candidate_count || 0) - Number(left.hot_candidate_count || 0) ||
    Number(right.avg_opportunity_score || 0) - Number(left.avg_opportunity_score || 0) ||
    String(left.port_name || "").localeCompare(String(right.port_name || ""), "ko");
}

export function buildPortStatistics(records = [], generatedAt = new Date().toISOString()) {
  try {
    const inputRows = Array.isArray(records) ? records : [];
    const byPort = new Map();
    let vesselsMissingPortField = 0;
    let unknownPortCount = 0;

    for (const record of inputRows) {
      const normalized = normalizeRecordPort(record);
      if (normalized.missing) {
        vesselsMissingPortField += 1;
        continue;
      }
      if (normalized.unknown) unknownPortCount += 1;
      const { port_code, port_name, display_name } = normalized.port;
      const key = port_code || port_name || "UNKNOWN";
      const current = byPort.get(key) || {
        port_code: port_code || "UNKNOWN",
        port_name: port_name || "미확인 항만",
        display_name: display_name || port_name || "미확인 항만",
        vessel_count: 0,
        hot_candidate_count: 0,
        hot_count: 0,
        candidate_count: 0,
        sales_target_count: 0,
        immediate_target_count: 0,
        score_total: 0,
        score_count: 0,
        last_seen_ms: null,
        raw_aliases: new Set()
      };
      current.vessel_count += 1;
      if (normalized.raw !== null && normalized.raw !== undefined && String(normalized.raw).trim()) current.raw_aliases.add(String(normalized.raw).trim());
      if (isHotCandidate(record)) {
        current.hot_candidate_count += 1;
        current.hot_count += 1;
      }
      if (isSalesCandidate(record)) {
        current.candidate_count += 1;
        current.sales_target_count += 1;
      }
      if (isImmediatePortCandidate(record)) current.immediate_target_count += 1;
      const score = opportunityScore(record);
      if (score !== null) {
        current.score_total += score;
        current.score_count += 1;
      }
      const seenAt = latestTimestamp(record);
      if (seenAt !== null && (current.last_seen_ms === null || seenAt > current.last_seen_ms)) current.last_seen_ms = seenAt;
      byPort.set(key, current);
    }

    const ports = [...byPort.values()].map(port => {
      const avgScore = port.score_count ? Math.round((port.score_total / port.score_count) * 10) / 10 : null;
      const rawAliases = [...port.raw_aliases].sort((left, right) => left.localeCompare(right, "ko"));
      return {
        port_code: port.port_code,
        port_name: port.port_name,
        display_name: port.display_name,
        vessel_count: port.vessel_count,
        hot_count: port.hot_count,
        hot_candidate_count: port.hot_candidate_count,
        hot_count_semantics: "qualified sales target with commercial score >= 75",
        avg_opportunity_score: avgScore,
        last_seen_at: port.last_seen_ms === null ? null : new Date(port.last_seen_ms).toISOString(),
        total_vessels: port.vessel_count,
        candidate_count: port.candidate_count,
        target_count: port.sales_target_count,
        sales_target_count: port.sales_target_count,
        sales_candidates: port.candidate_count,
        sales_targets: port.sales_target_count,
        immediate_target_count: port.immediate_target_count,
        immediate_count: port.immediate_target_count,
        immediate_targets: port.immediate_target_count,
        port_opportunity_score: avgScore,
        raw_aliases: rawAliases,
        raw_alias_count: rawAliases.length
      };
    }).sort(sortPortRows);

    const status = !inputRows.length
      ? "empty"
      : ports.length
        ? "completed"
        : "empty";
    const error = !inputRows.length
      ? "record_count_zero"
      : ports.length
        ? null
        : "no_valid_port_field_found";
    return {
      record_count: inputRows.length,
      port_count: ports.length,
      ports,
      port_statistics_generated_at: generatedAt,
      port_statistics_status: status,
      port_statistics_error: error,
      unknown_port_count: unknownPortCount,
      vessels_missing_port_field: vesselsMissingPortField,
      port_field_names_found: detectPortFieldNames(inputRows)
    };
  } catch (error) {
    return {
      record_count: Array.isArray(records) ? records.length : 0,
      port_count: 0,
      ports: [],
      port_statistics_generated_at: generatedAt,
      port_statistics_status: "failed",
      port_statistics_error: error?.message || String(error),
      unknown_port_count: 0,
      vessels_missing_port_field: 0,
      port_field_names_found: []
    };
  }
}
