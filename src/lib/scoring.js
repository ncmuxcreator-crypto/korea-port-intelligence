function clamp(value, min = 0, max = 100) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.max(min, Math.min(max, number));
}

function round(value, digits = 0) {
  const factor = 10 ** digits;
  return Math.round(Number(value || 0) * factor) / factor;
}

function firstFiniteNumber(...values) {
  for (const value of values) {
    if (value === undefined || value === null || String(value).trim() === "") continue;
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function firstNonEmpty(...values) {
  return values.find(value => value !== undefined && value !== null && String(value).trim() !== "") ?? "";
}

function normalizedConfidence(value) {
  const text = String(value || "").toLowerCase();
  if (text === "high") return 100;
  if (text === "medium") return 65;
  if (text === "low") return 35;
  const number = Number(value);
  if (Number.isFinite(number)) return clamp(number);
  return 45;
}

function confidenceLabel(score) {
  const value = normalizedConfidence(score);
  if (value >= 75) return "high";
  if (value >= 45) return "medium";
  return "low";
}

function scoreAction(score) {
  const value = Number(score || 0);
  if (value >= 85) return "즉시 영업 / 견적 발송";
  if (value >= 70) return "우선 모니터링 / 접촉 준비";
  if (value >= 50) return "관심 후보";
  return "낮은 우선순위";
}

function asReasons(value) {
  if (Array.isArray(value)) return value.map(item => String(item).trim()).filter(Boolean);
  if (value) return [String(value).trim()].filter(Boolean);
  return [];
}

function deriveInput(record = {}, environment = {}) {
  const anchorageHours = firstFiniteNumber(record.anchorageHours, record.anchorage_hours, record.waiting_hours, record.loitering_hours, record.low_speed_hours, 0) || 0;
  const portStayHours = firstFiniteNumber(record.portStayHours, record.port_stay_hours, record.stay_hours, record.current_call_stay_hours, record.cumulative_stay_hours, record.berth_hours, anchorageHours, 0) || 0;
  const sstAnomaly = firstFiniteNumber(environment.sstAnomalyCelsius, record.sstAnomalyCelsius, record.sst_anomaly_celsius, record.sst_anomaly, record.noaa_sst_anomaly, 0) || 0;
  const sstCelsius = firstFiniteNumber(environment.sstCelsius, record.sstCelsius, record.sst_celsius, record.sst_72h_c_avg, record.sst_7d_c_avg, 18 + sstAnomaly, 18) || 18;
  const salinityPsu = firstFiniteNumber(environment.salinityPsu, record.salinityPsu, record.salinity_psu, record.salinity, record.salinity_proxy && Number(record.salinity_proxy) <= 2 ? Number(record.salinity_proxy) * 35 : record.salinity_proxy, 34) || 34;
  const tropicalExposureDays = firstFiniteNumber(record.tropicalExposureDays, record.tropical_exposure_days, record.tropical_days, record.warm_water_exposure_days, /brazil|australia|new zealand|singapore|malaysia|indonesia|philippines|vietnam|thailand|브라질|호주/i.test(String([record.destination, record.destination_port, record.next_port, record.route_signal, record.exposure_tags].flat().join(" "))) ? 7 : 0, 0) || 0;
  const slowSteamingHours = firstFiniteNumber(record.slowSteamingHours, record.slow_steaming_hours, record.low_speed_hours, record.loitering_hours, record.ais_dwell_hours, 0) || 0;
  const dataConfidence = normalizedConfidence(firstNonEmpty(record.confidence, record.data_confidence_score, record.confidence_score, record.candidate_confidence, environment.quality === "good" ? 80 : environment.quality === "estimated" ? 55 : 35));
  return {
    anchorageHours: Math.max(0, round(anchorageHours, 1)),
    portStayHours: Math.max(0, round(portStayHours, 1)),
    sstCelsius: round(sstCelsius, 1),
    sstAnomalyCelsius: round(sstAnomaly, 2),
    salinityPsu: round(salinityPsu, 1),
    tropicalExposureDays: Math.max(0, round(tropicalExposureDays, 1)),
    slowSteamingHours: Math.max(0, round(slowSteamingHours, 1)),
    dataConfidence,
    environmentalSource: environment.source || record.environmental_source || "FALLBACK",
    environmentalQuality: environment.quality || record.environmental_quality || "missing"
  };
}

export function calculateBiofoulingRiskScore(input = {}) {
  const reasons = [];
  let score = 0;
  if (Number(input.anchorageHours || 0) >= 168) {
    score += 35;
    reasons.push("168시간 이상 정박");
  } else if (Number(input.anchorageHours || 0) >= 72) {
    score += 25;
    reasons.push("72시간 이상 정박");
  }
  if (Number(input.portStayHours || 0) >= 48) {
    score += 15;
    reasons.push("48시간 이상 항만 체류");
  }
  if (Number(input.sstCelsius || 0) >= 22) {
    score += 15;
    reasons.push("수온 22도 이상");
  }
  if (Number(input.sstAnomalyCelsius || 0) >= 0.8) {
    score += 15;
    reasons.push("평년 대비 SST +0.8°C 이상");
  }
  if (Number(input.tropicalExposureDays || 0) >= 7) {
    score += 15;
    reasons.push("열대 해역 노출 가능성");
  }
  if (Number(input.slowSteamingHours || 0) >= 24) {
    score += 10;
    reasons.push("저속 운항 누적");
  }
  if (Number(input.salinityPsu || 0) >= 28 && Number(input.salinityPsu || 0) <= 36) {
    score += 5;
    reasons.push("염분 조건 생물부착 가능 범위");
  }
  return { score: clamp(score), reasons };
}

export function calculateHullGrowthIndex(input = {}, biofoulingRiskScore = 0) {
  const sstFactor = clamp(((Number(input.sstCelsius || 0) - 12) / 12) * 100);
  const anchorageFactor = clamp((Number(input.anchorageHours || 0) / 168) * 100);
  const slowSteamingFactor = clamp((Number(input.slowSteamingHours || 0) / 72) * 100);
  return clamp(round(
    Number(biofoulingRiskScore || 0) * 0.5 +
    sstFactor * 0.2 +
    anchorageFactor * 0.2 +
    slowSteamingFactor * 0.1
  ));
}

export function calculateCleaningOpportunityScore(input = {}, biofoulingRiskScore = 0, hullGrowthIndex = 0) {
  const stayFactor = clamp((Math.max(Number(input.portStayHours || 0), Number(input.anchorageHours || 0)) / 168) * 100);
  return clamp(round(
    Number(biofoulingRiskScore || 0) * 0.4 +
    Number(hullGrowthIndex || 0) * 0.3 +
    stayFactor * 0.2 +
    normalizedConfidence(input.dataConfidence) * 0.1
  ));
}

export function buildHullCleaningScores(record = {}, environment = {}) {
  const input = deriveInput(record, environment);
  const risk = calculateBiofoulingRiskScore(input);
  const biofoulingRiskScore = risk.score;
  const hullGrowthIndex = calculateHullGrowthIndex(input, biofoulingRiskScore);
  const cleaningOpportunityScore = calculateCleaningOpportunityScore(input, biofoulingRiskScore, hullGrowthIndex);
  const existingReasons = [
    ...asReasons(record.riskReasons),
    ...asReasons(record.risk_reasons),
    ...asReasons(record.reason_codes),
    ...asReasons(record.top_factors)
  ];
  const riskReasons = [...new Set([...risk.reasons, ...existingReasons])].slice(0, 10);
  const confidence = confidenceLabel(input.dataConfidence);
  const recommendedAction = scoreAction(cleaningOpportunityScore);
  return {
    biofoulingRiskScore,
    hullGrowthIndex,
    cleaningOpportunityScore,
    anchorageHours: input.anchorageHours,
    portStayHours: input.portStayHours,
    sstCelsius: input.sstCelsius,
    sstAnomalyCelsius: input.sstAnomalyCelsius,
    salinityPsu: input.salinityPsu,
    tropicalExposureDays: input.tropicalExposureDays,
    slowSteamingHours: input.slowSteamingHours,
    riskReasons,
    recommendedAction,
    confidence,
    biofouling_risk_score: biofoulingRiskScore,
    hull_growth_index: hullGrowthIndex,
    cleaning_opportunity_score: cleaningOpportunityScore,
    port_stay_hours: input.portStayHours,
    sst_celsius: input.sstCelsius,
    sst_anomaly_celsius: input.sstAnomalyCelsius,
    salinity_psu: input.salinityPsu,
    tropical_exposure_days: input.tropicalExposureDays,
    slow_steaming_hours: input.slowSteamingHours,
    risk_reasons: riskReasons,
    environmental_source: input.environmentalSource,
    environmental_quality: input.environmentalQuality
  };
}

export function vesselCandidateDedupeKey(record = {}) {
  const imo = firstNonEmpty(record.imo, record.imo_no, record.vessel_display?.imo);
  if (imo && imo !== "-") return `IMO:${String(imo).toUpperCase().trim()}`;
  const mmsi = firstNonEmpty(record.mmsi, record.vessel_display?.mmsi);
  if (mmsi && mmsi !== "-") return `MMSI:${String(mmsi).toUpperCase().trim()}`;
  const name = firstNonEmpty(record.vessel_name, record.name, record.ship_name, record.vessel_display?.vessel_name, "UNKNOWN");
  const portCode = firstNonEmpty(record.port_code, record.portCode, record.port_name, record.port, record.vessel_display?.current_port, "UNKNOWN");
  return `NAME_PORT:${String(name).normalize("NFKC").toUpperCase().replace(/\s+/g, " ").trim()}|${String(portCode).toUpperCase().trim()}`;
}

export function dedupeVesselCandidates(records = []) {
  const byKey = new Map();
  for (const record of records) {
    if (!record || typeof record !== "object") continue;
    const key = vesselCandidateDedupeKey(record);
    const current = byKey.get(key);
    if (!current) {
      byKey.set(key, record);
      continue;
    }
    const nextTime = Date.parse(firstNonEmpty(record.updatedAt, record.updated_at, record.last_seen_at, record.generated_at, record.collected_at)) || 0;
    const currentTime = Date.parse(firstNonEmpty(current.updatedAt, current.updated_at, current.last_seen_at, current.generated_at, current.collected_at)) || 0;
    const nextScore = firstFiniteNumber(record.cleaningOpportunityScore, record.cleaning_opportunity_score, record.opportunity_score, record.commercial_value_score, 0) || 0;
    const currentScore = firstFiniteNumber(current.cleaningOpportunityScore, current.cleaning_opportunity_score, current.opportunity_score, current.commercial_value_score, 0) || 0;
    const keepNext = nextTime > currentTime || (nextTime === currentTime && nextScore > currentScore);
    const mergedReasons = [...new Set([
      ...asReasons(current.riskReasons),
      ...asReasons(current.risk_reasons),
      ...asReasons(record.riskReasons),
      ...asReasons(record.risk_reasons)
    ])];
    const winner = keepNext ? record : current;
    winner.riskReasons = mergedReasons;
    winner.risk_reasons = mergedReasons;
    byKey.set(key, winner);
  }
  return [...byKey.values()];
}

export { scoreAction as recommendedActionForScore, confidenceLabel };
