import { OceanConditionProvider, normalizeOceanCondition, normalizeOceanPortCode } from "./oceanConditionProvider.js";

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function firstNonEmpty(...values) {
  return values.find(value => value !== undefined && value !== null && String(value).trim() !== "") ?? "";
}

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, finiteNumber(value, min)));
}

function round(value, digits = 1) {
  const factor = 10 ** digits;
  return Math.round(finiteNumber(value) * factor) / factor;
}

export function sstFactor(sstC) {
  const sst = finiteNumber(sstC, 0);
  if (sst < 10) return 0;
  if (sst < 15) return 5;
  if (sst < 20) return 10;
  if (sst < 25) return 20;
  return 30;
}

export function anomalyFactor(anomalyC) {
  const anomaly = finiteNumber(anomalyC, 0);
  if (anomaly < 1) return 0;
  if (anomaly < 2) return 5;
  if (anomaly < 3) return 10;
  return 15;
}

export function marineHeatwaveBonus(level) {
  const normalized = String(level || "NORMAL").toUpperCase();
  if (normalized === "WATCH") return 5;
  if (normalized === "HIGH") return 10;
  if (normalized === "EXTREME") return 15;
  return 0;
}

export function oceanRiskLabel(score) {
  const value = finiteNumber(score, 0);
  if (value <= 30) return "LOW";
  if (value <= 60) return "MEDIUM";
  if (value <= 80) return "HIGH";
  return "VERY_HIGH";
}

export function oceanRiskLabelKo(scoreOrLabel) {
  const label = Number.isFinite(Number(scoreOrLabel)) ? oceanRiskLabel(Number(scoreOrLabel)) : String(scoreOrLabel || "LOW").toUpperCase();
  return {
    LOW: "낮음",
    MEDIUM: "보통",
    HIGH: "높음",
    VERY_HIGH: "매우 높음"
  }[label] || "낮음";
}

export function marineHeatwaveLabelKo(level) {
  return {
    NORMAL: "정상",
    WATCH: "주의",
    HIGH: "높음",
    EXTREME: "극심"
  }[String(level || "NORMAL").toUpperCase()] || "정상";
}

function recordPortCode(record = {}) {
  return normalizeOceanPortCode(firstNonEmpty(
    record.port_code,
    record.portCode,
    record.port_name,
    record.port,
    record.current_port,
    record.destination_port,
    record.destination,
    record.vessel_display?.current_port
  ));
}

function stayDaysFactor(record = {}) {
  const stayHours = finiteNumber(firstNonEmpty(
    record.stay_hours,
    record.current_call_stay_hours,
    record.cumulative_stay_hours,
    record.port_stay_hours,
    record.portStayHours
  ), 0);
  const stayDays = finiteNumber(firstNonEmpty(record.stay_days, record.dwell_days), stayHours / 24);
  return clamp((Math.max(stayHours / 24, stayDays) / 7) * 100);
}

function anchorageFactor(record = {}) {
  const hours = finiteNumber(firstNonEmpty(
    record.anchorage_hours,
    record.anchorageHours,
    record.waiting_hours,
    record.ais_dwell_hours,
    record.loitering_hours
  ), 0);
  return clamp((hours / 72) * 100);
}

function sensitiveRouteFactor(record = {}) {
  const text = [
    record.destination,
    record.destination_port,
    record.next_port,
    record.route_signal,
    record.route_summary,
    record.exposure_tags,
    record.reason_summary,
    record.reason_codes,
    record.top_factors
  ].flat().join(" ").toLowerCase();
  if (/brazil|brasil|australia|new zealand|california|canada|브라질|호주|뉴질랜드|캐나다/.test(text)) return 100;
  if (/singapore|malaysia|indonesia|philippines|vietnam|thailand/.test(text)) return 60;
  return 0;
}

export function calculateOceanRiskScore(record = {}, condition = {}) {
  const normalized = normalizeOceanCondition(condition, { portCode: recordPortCode(record) });
  const stay = stayDaysFactor(record);
  const anchorage = anchorageFactor(record);
  const route = sensitiveRouteFactor(record);
  const sst = sstFactor(normalized.sst_c);
  const anomaly = anomalyFactor(normalized.sst_anomaly_c);
  const heatwave = marineHeatwaveBonus(normalized.marine_heatwave_level);
  const score = clamp(
    stay * 0.35 +
    anchorage * 0.20 +
    route * 0.20 +
    sst * 0.15 +
    anomaly * 0.10 +
    heatwave
  );
  const foulingAcceleratorPct = clamp(
    normalized.sst_c >= 25 ? 45 :
      normalized.sst_c >= 20 ? 30 :
        normalized.sst_c >= 15 ? 15 : 0,
    0,
    100
  ) + Math.max(0, Math.round(normalized.sst_anomaly_c * 4));
  return {
    ocean_risk_score: Math.round(score),
    biofouling_risk_score: Math.round(score),
    fouling_accelerator_pct: Math.min(100, Math.round(foulingAcceleratorPct)),
    regulatory_multiplier: route >= 100 ? 1.25 : route >= 60 ? 1.1 : 1,
    ocean_score_components: {
      stay_days_factor: Math.round(stay),
      anchorage_factor: Math.round(anchorage),
      sensitive_route_factor: Math.round(route),
      sst_factor: sst,
      anomaly_factor: anomaly,
      marine_heatwave_bonus: heatwave
    },
    risk_label: oceanRiskLabel(score),
    risk_label_ko: oceanRiskLabelKo(score)
  };
}

export function applyOceanRiskToRecord(record = {}, condition = {}) {
  const normalized = normalizeOceanCondition(condition, { portCode: recordPortCode(record) });
  const score = calculateOceanRiskScore(record, normalized);
  Object.assign(record, {
    ocean_port_code: normalized.port_code,
    ocean_port_name_ko: normalized.port_name_ko,
    sst_c: normalized.sst_c,
    sstCelsius: normalized.sst_c,
    sst_anomaly_c: normalized.sst_anomaly_c,
    sstAnomalyCelsius: normalized.sst_anomaly_c,
    marine_heatwave_level: normalized.marine_heatwave_level,
    marine_heatwave_label_ko: marineHeatwaveLabelKo(normalized.marine_heatwave_level),
    biofouling_water_temp_factor: normalized.biofouling_water_temp_factor,
    fouling_accelerator_pct: score.fouling_accelerator_pct,
    ocean_risk_score: score.ocean_risk_score,
    ocean_risk_label: score.risk_label,
    ocean_risk_label_ko: score.risk_label_ko,
    regulatory_multiplier: score.regulatory_multiplier,
    ocean_source: normalized.source,
    ocean_observed_at: normalized.observed_at,
    ocean_updated_at: normalized.updated_at,
    ocean_score_components: score.ocean_score_components,
    biofouling_risk_score: Math.max(finiteNumber(record.biofouling_risk_score, 0), score.biofouling_risk_score),
    biofouling_score: Math.max(finiteNumber(record.biofouling_score, 0), score.biofouling_risk_score),
    risk_score: Math.max(finiteNumber(record.risk_score, 0), score.ocean_risk_score)
  });
  const reasons = [
    ...(Array.isArray(record.riskReasons) ? record.riskReasons : []),
    ...(Array.isArray(record.risk_reasons) ? record.risk_reasons : []),
    normalized.sst_c >= 20 ? `SST ${normalized.sst_c}도` : null,
    normalized.sst_anomaly_c >= 1 ? `평년 대비 +${normalized.sst_anomaly_c}도` : null,
    normalized.marine_heatwave_level !== "NORMAL" ? `해양열파 ${marineHeatwaveLabelKo(normalized.marine_heatwave_level)}` : null
  ].filter(Boolean);
  record.riskReasons = [...new Set(reasons)].slice(0, 10);
  record.risk_reasons = record.riskReasons;
  return record;
}

export async function buildOceanIntelligenceLayer({
  records = [],
  generatedAt = new Date().toISOString(),
  dataMode = "live",
  provider = OceanConditionProvider
} = {}) {
  let conditions = [];
  try {
    conditions = await provider.fetchPortOceanConditions({ generatedAt });
  } catch {
    conditions = [];
  }
  if (!conditions.length) conditions = provider.getFallbackOceanConditions({ generatedAt });
  const normalizedConditions = conditions.map(condition => normalizeOceanCondition(condition, { generatedAt }));
  const byPort = new Map(normalizedConditions.map(condition => [condition.port_code, condition]));
  const vesselRiskItems = [];
  for (const record of Array.isArray(records) ? records : []) {
    const condition = byPort.get(recordPortCode(record));
    if (!condition) continue;
    const score = calculateOceanRiskScore(record, condition);
    vesselRiskItems.push({
      vessel_key: firstNonEmpty(record.imo, record.mmsi, record.hybrid_entity_key, record.vessel_name, "UNKNOWN"),
      port_code: condition.port_code,
      sst_c: condition.sst_c,
      sst_anomaly_c: condition.sst_anomaly_c,
      fouling_accelerator_pct: score.fouling_accelerator_pct,
      ocean_risk_score: score.ocean_risk_score,
      regulatory_multiplier: score.regulatory_multiplier,
      updated_at: generatedAt
    });
  }
  const sourceSet = new Set(normalizedConditions.map(condition => condition.source));
  const staleCount = normalizedConditions.filter(condition => {
    const updated = Date.parse(condition.updated_at || "");
    return !Number.isFinite(updated) || (Date.now() - updated) > 48 * 36e5;
  }).length;
  const health = {
    source: [...sourceSet].join(", ") || "FALLBACK",
    last_updated: normalizedConditions.map(condition => condition.updated_at).sort().pop() || generatedAt,
    live_or_fallback: [...sourceSet].some(source => /CMEMS|NOAA|KOEM/i.test(source)) ? "live" : "fallback",
    ports_covered: normalizedConditions.length,
    stale_warning: staleCount > 0,
    stale_records_count: staleCount
  };
  return {
    schema_version: "1.0",
    generated_at: generatedAt,
    data_mode: dataMode,
    port_ocean_conditions: normalizedConditions,
    vessel_ocean_risk: vesselRiskItems,
    data_health: health
  };
}

export function enrichRecordsWithOceanRisk(records = [], oceanLayer = {}) {
  const byPort = new Map((oceanLayer.port_ocean_conditions || []).map(condition => [condition.port_code, condition]));
  for (const record of Array.isArray(records) ? records : []) {
    const condition = byPort.get(recordPortCode(record));
    if (condition) applyOceanRiskToRecord(record, condition);
  }
  return records;
}

export function buildOceanRiskGeoJson(oceanLayer = {}) {
  const features = (oceanLayer.port_ocean_conditions || []).map(condition => {
    const pseudoRecord = { port_code: condition.port_code, stay_hours: 96, anchorage_hours: 24 };
    const score = calculateOceanRiskScore(pseudoRecord, condition);
    return {
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [condition.lon, condition.lat]
      },
      properties: {
        port_code: condition.port_code,
        port_name_ko: condition.port_name_ko,
        sst_c: condition.sst_c,
        sst_anomaly_c: condition.sst_anomaly_c,
        marine_heatwave_level: condition.marine_heatwave_level,
        marine_heatwave_label_ko: marineHeatwaveLabelKo(condition.marine_heatwave_level),
        biofouling_risk_score: score.biofouling_risk_score,
        risk_label_ko: oceanRiskLabelKo(score.biofouling_risk_score),
        updated_at: condition.updated_at,
        source: condition.source
      }
    };
  });
  return {
    type: "FeatureCollection",
    schema_version: "1.0",
    generated_at: oceanLayer.generated_at || new Date().toISOString(),
    data_health: oceanLayer.data_health || {},
    features
  };
}
