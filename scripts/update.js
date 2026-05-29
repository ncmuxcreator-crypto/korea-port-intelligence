import fs from "fs";
import { collectKoreaData, getCollectorDiagnostics } from "./collectors/korea.js";
import { createRunId, enrichWithVesselMasterCache, saveToSupabase } from "./lib/db.js";
import { archiveRawToGDrive } from "./lib/gdrive.js";
import { detectSecrets } from "./lib/secrets.js";
import { writeSnapshotOutputs, buildBackendOpsReport } from "./lib/snapshot-store.js";
import { enrichWithReferenceDictionaries, loadReferenceDictionaries } from "./lib/reference-dictionaries.js";

const VERSION = "17.7.0";
const BUILD_NAME = "Backend Stability Batch";
const PRIORITY_PORTS = [
  "Busan",
  "Yeosu/Gwangyang",
  "Ulsan",
  "Pyeongtaek-Dangjin",
  "Hadong/Samcheonpo",
  "Pohang"
];
const COMMERCIAL_GT_THRESHOLD = Number(process.env.COMMERCIAL_GT_THRESHOLD || 5000);
const REVIEW_TARGET_THRESHOLD = Number(process.env.REVIEW_TARGET_THRESHOLD || 35);
const SALES_CANDIDATE_THRESHOLD = Number(process.env.SALES_CANDIDATE_THRESHOLD || 60);
const IMMEDIATE_TARGET_THRESHOLD = Number(process.env.IMMEDIATE_TARGET_THRESHOLD || 80);
const CRITICAL_TARGET_THRESHOLD = Number(process.env.CRITICAL_TARGET_THRESHOLD || 90);
const MAX_TARGET_VESSELS = Number(process.env.MAX_TARGET_VESSELS || 5000);
const MAX_CANDIDATES = Number(process.env.MAX_CANDIDATES || 1000);

function parseScheduleTime(value) {
  if (!value) return null;
  const raw = String(value).trim();
  const isoish = raw.replace(" ", "T");
  const withZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(isoish) ? isoish : `${isoish}+09:00`;
  const parsed = new Date(withZone);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function hoursBetween(start, end) {
  const startDate = parseScheduleTime(start);
  const endDate = parseScheduleTime(end);
  if (!startDate || !endDate) return null;
  return Math.max(0, Math.round(((endDate.getTime() - startDate.getTime()) / 36e5) * 10) / 10);
}

function hasAnchorageSignal(v = {}) {
  const text = [
    v.status,
    v.berth_name,
    v.berth,
    v.anchorage_name,
    v.anchorage_zone,
    v.laidupFcltyNm,
    v.laidup_fclty_nm,
    v.facility_name_raw,
    v.facility_name_normalized,
    v.facility_code,
    v.berth_class,
    v.anchorage_class
  ].filter(Boolean).join(" ");
  return /waiting|anchorage|anchor|idle|drifting|묘박|정박|박지|외항|남외항|북외항|대기|ANCH|O\/A|OUTER/i.test(text);
}

function deriveScheduleMetrics(v) {
  const nowDate = new Date();
  const now = nowDate.toISOString();
  const ataDate = parseScheduleTime(v.ata);
  const atdDate = parseScheduleTime(v.atd);
  const etaValue = v.eta || v.eta_candidate || v.pilot_time || v.movement_time;
  const etbValue = v.etb || v.etb_candidate;
  const etdValue = v.etd || v.etd_candidate;
  const etaDate = parseScheduleTime(etaValue);
  const etdDate = parseScheduleTime(etdValue);
  const arrival = v.ata || etaValue;
  const berthStart = v.atb || etbValue;
  const departure = v.atd || etdValue;
  const plannedStayHours = hoursBetween(etaValue, etdValue);
  const stayHours = ataDate && atdDate
    ? hoursBetween(v.ata, v.atd)
    : ataDate && !atdDate
      ? hoursBetween(v.ata, now)
      : null;
  const berthEnd = v.atd ? v.atd : berthStart ? now : departure;
  const berthHours = hoursBetween(berthStart || arrival, berthEnd);
  const anchorageDetected = hasAnchorageSignal(v);
  const waitingHours = berthStart
    ? hoursBetween(arrival, berthStart)
    : anchorageDetected
      ? (stayHours ?? plannedStayHours ?? null)
      : null;
  const workWindowHours = etdDate && nowDate.getTime() < etdDate.getTime()
    ? Math.round(((etdDate.getTime() - nowDate.getTime()) / 36e5) * 10) / 10
    : null;
  const pilotDirection = String(v.pilot_direction || v.movement_type || "").toLowerCase();
  const outboundPilotSoon = pilotDirection === "outbound" && etdDate && nowDate.getTime() < etdDate.getTime();
  const workWindowStatus = atdDate
    ? "closed"
    : outboundPilotSoon
      ? "closing_by_pilot_schedule"
      : ataDate
        ? "open_or_ongoing"
        : workWindowHours !== null
          ? "scheduled"
          : "unknown";

  return {
    stay_hours: stayHours,
    planned_stay_hours: plannedStayHours,
    current_call_stay_hours: stayHours,
    cumulative_stay_hours: Number(v.cumulative_stay_hours || 0),
    cumulative_stay_days: Math.round((Number(v.cumulative_stay_hours || 0) / 24) * 10) / 10,
    berth_hours: berthHours,
    anchorage_hours: waitingHours,
    work_window_hours: workWindowHours,
    work_window_status: workWindowStatus,
    eta_candidate: v.eta_candidate || null,
    etb_candidate: v.etb_candidate || null,
    etd_candidate: v.etd_candidate || null,
    pilot_time: v.pilot_time || v.movement_time || null,
    schedule_confidence: Math.min(100, [v.eta, v.etb, v.ata, v.atb, v.etd, v.atd].filter(Boolean).length * 12 + (v.pilot_schedule_matched ? 24 : 0) + (v.pilot_only_arrival_review ? 12 : 0))
  };
}

function deriveBiofoulingScore(v, metrics) {
  const type = String(v.vessel_type || "").toLowerCase();
  const route = [v.destination, v.previous_port, v.next_port].join(" ").toLowerCase();
  let score = Number(v.risk_score || 0) * 0.55;
  score += Math.min(24, (metrics.stay_hours || 0) / 24 * 2.5);
  score += Math.min(18, (metrics.anchorage_hours || 0) / 24 * 3);
  if (/vlcc|cape|capesize|bulk|bulker|tanker|lng|lpg|cruise|container/.test(type)) score += 10;
  if (/australia|brazil|new zealand|california|usa|canada|port hedland|ponta da madeira/.test(route)) score += 12;
  return Math.max(0, Math.min(100, Math.round(score)));
}

function deriveCiiPressureScore(v, metrics, biofoulingScore) {
  const type = String(v.vessel_type || "").toLowerCase();
  const route = [v.destination, v.previous_port, v.next_port, v.destination_port].join(" ").toLowerCase();
  const routeProfile = deriveRouteCommercialProfile(v);
  let score = Math.round(biofoulingScore * 0.42);
  if (Number(v.gt || 0) >= 5000) score += 18;
  if (/container|bulk|bulker|tanker|vlcc|lng|lpg|cruise/.test(type)) score += 12;
  if ((metrics.stay_hours || 0) >= 72) score += 8;
  if (/australia|brazil|usa|california|canada|singapore|china/.test(route)) score += 8;
  score += Math.round((routeProfile.esg_sensitivity_score + routeProfile.fuel_efficiency_sensitivity_score) / 10);
  return Math.max(0, Math.min(100, score));
}

function routeSourceText(v = {}) {
  return [
    v.previous_port,
    v.next_port,
    v.destination_port,
    v.destination,
    v.route_region,
    v.voyage_pattern,
    v.commercial_segment
  ].filter(Boolean).join(" ").normalize("NFKC").toLowerCase();
}

function deriveRouteCommercialProfile(v = {}) {
  const route = routeSourceText(v);
  const type = String([v.vessel_type, v.vessel_type_group, v.commercial_segment].filter(Boolean).join(" ")).toLowerCase();
  const profile = {
    route_region: v.route_region || "unknown",
    route_commercial_weight: 0,
    biosecurity_exposure_score: 0,
    esg_sensitivity_score: 0,
    fuel_efficiency_sensitivity_score: 0,
    hull_performance_sensitivity_score: 0,
    high_regulation_route: false,
    compliance_priority: "standard",
    route_reason_codes: []
  };

  const setProfile = (region, weight, biosecurity, esg, fuel, hull, reasons) => {
    profile.route_region = region;
    profile.route_commercial_weight = weight;
    profile.biosecurity_exposure_score = biosecurity;
    profile.esg_sensitivity_score = esg;
    profile.fuel_efficiency_sensitivity_score = fuel;
    profile.hull_performance_sensitivity_score = hull;
    profile.high_regulation_route = weight >= 8;
    profile.compliance_priority = weight >= 15 ? "very_high" : weight >= 10 ? "high" : weight >= 6 ? "medium" : "standard";
    profile.route_reason_codes = reasons;
  };

  if (/australia|port hedland|newcastle|brisbane|melbourne|sydney|fremantle|adelaide|darwin|오스트레일리아|호주/.test(route)) {
    setProfile("australia", 18, 100, 85, 85, 90, ["AUSTRALIA_ROUTE", "HIGH_BIOSECURITY_PRESSURE", "HIGH_ESG_PRESSURE"]);
  } else if (/new zealand|newzealand|auckland|tauranga|wellington|lyttelton|뉴질랜드/.test(route)) {
    setProfile("new_zealand", 18, 100, 85, 85, 90, ["NZ_ROUTE", "HIGH_BIOSECURITY_PRESSURE", "HIGH_ESG_PRESSURE"]);
  } else if (/brazil|brasil|ponta da madeira|tubarao|santos|rio de janeiro|브라질/.test(route)) {
    setProfile("brazil", /bulk|bulker|bulk_carrier|ore|tanker|vlcc|commodity/.test(type) ? 15 : 12, 85, 70, 75, 85, ["BRAZIL_ROUTE", "HIGH_BIOSECURITY_PRESSURE"]);
  } else if (/north america|usa|u\.s\.a|united states|canada|california|los angeles|long beach|oakland|seattle|tacoma|vancouver|great lakes|미국|캐나다|북미/.test(route)) {
    setProfile("north_america", 10, 60, 85, 85, 80, ["NORTH_AMERICA_ROUTE", "HIGH_ESG_PRESSURE"]);
  } else if (/europe|north europe|mediterranean|rotterdam|hamburg|antwerp|felixstowe|algeciras|valencia|piraeus|유럽|지중해/.test(route)) {
    setProfile("europe", 8, 50, 80, 80, 75, ["EUROPE_ROUTE", "HIGH_ESG_PRESSURE"]);
  }

  if (profile.high_regulation_route && ["arrived_staying", "berthed", "anchorage_waiting"].includes(v.status_bucket)) {
    profile.route_reason_codes.push("PRE_ARRIVAL_COMPLIANCE_WINDOW");
  }
  return { ...profile, route_reason_codes: [...new Set(profile.route_reason_codes)] };
}

function normalizePortToken(value) {
  return String(value || "")
    .normalize("NFKC")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, " ");
}

function deriveRoutePattern(v = {}, metrics = {}, routeProfile = deriveRouteCommercialProfile(v)) {
  const fromPort = normalizePortToken(v.previous_port || v.last_port || "");
  const toPort = normalizePortToken(v.destination_port || v.destination || v.next_port || v.port_name || v.port || "");
  const typeGroup = v.vessel_type_group || defaultVesselTypeGroup(v);
  const routeKey = [fromPort || "UNKNOWN", toPort || "KOREA", typeGroup || "unknown"].join("|");
  const isKnownRoute = Boolean(fromPort && toPort);
  const gt = Number(v.gt || v.grtg || v.intrlGrtg || 0);
  const congestionProbability = Math.min(100, Math.round(
    (Number(metrics.anchorage_hours || 0) >= 24 ? 45 : 0) +
    (Number(metrics.stay_hours || 0) >= 48 ? 25 : 0) +
    (routeProfile.high_regulation_route ? 15 : 0) +
    (/bulk|tanker|pctc|container|lng|lpg/.test(String(typeGroup).toLowerCase()) ? 10 : 0) +
    (gt >= 30000 ? 5 : 0)
  ));
  const avgStayHours = Number(metrics.stay_hours || metrics.planned_stay_hours || 0);
  const avgWaitingHours = Number(metrics.anchorage_hours || 0);
  return {
    route_key: routeKey,
    route_from_port: fromPort,
    route_to_port: toPort,
    route_pattern_known: isKnownRoute,
    route_pattern_confidence: isKnownRoute ? Math.min(90, 45 + (routeProfile.high_regulation_route ? 20 : 0) + (avgStayHours > 0 ? 10 : 0) + (avgWaitingHours > 0 ? 10 : 0)) : 15,
    historical_avg_stay_hours: avgStayHours || null,
    historical_avg_waiting_hours: avgWaitingHours || null,
    predicted_congestion: congestionProbability,
    predicted_cleaning_window: Math.min(100, Math.round(
      (avgWaitingHours >= 24 ? 35 : 0) +
      (avgStayHours >= 48 ? 30 : 0) +
      (routeProfile.high_regulation_route ? 15 : 0) +
      (gt >= COMMERCIAL_GT_THRESHOLD ? 10 : 0) +
      (/bulk|tanker|pctc|container|lng|lpg/.test(String(typeGroup).toLowerCase()) ? 10 : 0)
    ))
  };
}

function deriveArrivalPrediction(v = {}, metrics = {}, routeProfile = deriveRouteCommercialProfile(v), routePattern = deriveRoutePattern(v, metrics, routeProfile)) {
  const now = new Date();
  const explicitEta = parseScheduleTime(v.eta || v.eta_candidate || v.next_port_eta || v.destination_eta || v.pilot_time || v.movement_time);
  const status = String(v.status_bucket || v.status || "").toLowerCase();
  let predictedArrival = explicitEta;
  let source = explicitEta ? "schedule_or_pilot" : "";
  if (!predictedArrival && v.atd && (v.destination_port || v.next_port || v.destination)) {
    const atd = parseScheduleTime(v.atd);
    const routeHours = Number(v.avg_transit_hours || v.historical_avg_transit_hours || 48);
    if (atd) {
      predictedArrival = new Date(atd.getTime() + routeHours * 36e5);
      source = "route_pattern";
    }
  }
  const hoursUntilArrival = predictedArrival ? Math.round(((predictedArrival.getTime() - now.getTime()) / 36e5) * 10) / 10 : null;
  const inWindow = hoursUntilArrival !== null && hoursUntilArrival >= 0 && hoursUntilArrival <= 72;
  const likelyArrival = inWindow || status === "arriving_soon" || v.source_origin === "pilot_schedule" || v.pilot_only_arrival_review;
  const gt = Number(v.gt || v.grtg || v.intrlGrtg || 0);
  const typeGroup = String(v.vessel_type_group || v.vessel_type || "").toLowerCase();
  const vesselTypeScore = /bulk|tanker|pctc|container|lng|lpg|cruise/.test(typeGroup) ? 20 : 8;
  const etaProximityScore = hoursUntilArrival === null ? 0 : hoursUntilArrival <= 24 ? 30 : hoursUntilArrival <= 48 ? 24 : hoursUntilArrival <= 72 ? 16 : 0;
  const arrivalOpportunityScore = Math.min(100, Math.round(
    etaProximityScore +
    vesselTypeScore +
    (gt >= 30000 ? 18 : gt >= COMMERCIAL_GT_THRESHOLD ? 12 : 0) +
    Math.round(routeProfile.route_commercial_weight * 1.2) +
    Math.round(Number(routePattern.predicted_congestion || 0) * 0.18) +
    Math.round(Number(routePattern.predicted_cleaning_window || 0) * 0.12)
  ));
  return {
    predicted_arrival_time: predictedArrival ? predictedArrival.toISOString() : "",
    arrival_prediction_confidence: Math.min(100, Math.round(
      (explicitEta ? 55 : source === "route_pattern" ? 35 : 0) +
      (routePattern.route_pattern_known ? 15 : 0) +
      (v.pilot_schedule_matched || v.source_origin === "pilot_schedule" ? 20 : 0) +
      (routeProfile.high_regulation_route ? 10 : 0)
    )),
    predicted_congestion: routePattern.predicted_congestion,
    predicted_cleaning_window: routePattern.predicted_cleaning_window,
    arrival_opportunity_score: arrivalOpportunityScore,
    arrival_prediction_source: source || "insufficient_route_data",
    predicted_arrival_window_hours: hoursUntilArrival,
    predicted_arrival_pipeline: Boolean(likelyArrival && arrivalOpportunityScore >= 35)
  };
}

function forecastBand(score) {
  const value = Number(score || 0);
  if (value >= 75) return "high";
  if (value >= 50) return "medium";
  if (value >= 30) return "watch";
  return "low";
}

function derivePredictiveSignals(v = {}, metrics = {}, routeProfile = deriveRouteCommercialProfile(v), routePattern = deriveRoutePattern(v, metrics, routeProfile), arrivalPrediction = deriveArrivalPrediction(v, metrics, routeProfile, routePattern)) {
  const gt = Number(v.gt || v.grtg || v.intrlGrtg || 0);
  const type = String([v.vessel_type_group, v.vessel_type, v.commercial_segment].filter(Boolean).join(" ")).toLowerCase();
  const stayHours = Number(metrics.stay_hours || v.stay_hours || 0);
  const anchorageHours = Number(metrics.anchorage_hours || v.anchorage_hours || 0);
  const workWindowHours = Number(metrics.work_window_hours || v.work_window_hours || 0);
  const isCommercialType = /bulk|bulker|tanker|container|pctc|cruise|lng|lpg/.test(type);
  const inboundPilot = String(v.pilot_direction || v.movement_type || "").toLowerCase() === "inbound";
  const outboundPilot = String(v.pilot_direction || v.movement_type || "").toLowerCase() === "outbound";
  const berthOccupied = Number(v.berth_occupancy_proxy || 0) >= 50 || /active|working|cargo|loading|discharging|작업|하역|진행/.test(String(v.terminal_activity || "").toLowerCase());
  const currentCongestion = deriveCongestionScore(v, metrics);
  const predictedCongestionScore = Math.min(100, Math.round(
    Math.max(Number(routePattern.predicted_congestion || 0), currentCongestion) +
    (inboundPilot ? 8 : 0) -
    (outboundPilot ? 8 : 0) +
    (berthOccupied ? 10 : 0) +
    (arrivalPrediction.predicted_arrival_pipeline ? 6 : 0)
  ));
  const anchorageProbability = Math.min(100, Math.round(
    predictedCongestionScore * 0.42 +
    Math.min(25, anchorageHours / 2) +
    (isCommercialType ? 12 : 4) +
    (gt >= 30000 ? 10 : gt >= COMMERCIAL_GT_THRESHOLD ? 6 : 0) +
    (Number(routePattern.historical_avg_waiting_hours || 0) >= 24 ? 10 : 0)
  ));
  const predictedWorkWindowHours = workWindowHours > 0
    ? workWindowHours
    : outboundPilot
      ? 0
      : v.etd || v.etd_candidate
        ? hoursBetween(new Date().toISOString(), v.etd || v.etd_candidate) || null
        : stayHours >= 24 || anchorageHours >= 12
          ? Math.min(72, Math.max(12, Math.round(Math.max(stayHours, anchorageHours) / 2)))
          : null;
  const workWindowConfidence = Math.min(100, Math.round(
    (v.etd || v.etd_candidate ? 35 : 0) +
    (v.pilot_schedule_matched ? 25 : 0) +
    (v.berth_name || v.anchorage_name ? 15 : 0) +
    (stayHours || anchorageHours ? 15 : 0) -
    (berthOccupied ? 10 : 0)
  ));
  const repeatCallerScore = Math.min(100, Math.round(
    (v.vessel_master_cache_match || v.vessel_master_seed_match ? 30 : 0) +
    (routePattern.route_pattern_known ? 25 : 0) +
    (Number(routePattern.route_pattern_confidence || 0) * 0.25) +
    (v.identity_confidence >= 70 ? 15 : 0)
  ));
  const repeatOperatorScore = Math.min(100, Math.round(
    (v.operator_normalized ? 20 : 0) +
    (v.operator_fleet_badges?.includes("repeat_observed_fleet") ? 35 : 0) +
    (v.operator_confidence ? Math.min(30, Number(v.operator_confidence) * 0.3) : 0) +
    (v.agent_normalized ? 10 : 0)
  ));
  const speed = Number(v.speed || v.sog || 0);
  const lowSpeedExposure = Math.min(100, Math.round((speed > 0 && speed < 1.5 ? 45 : 0) + Math.min(35, stayHours / 3) + Math.min(20, anchorageHours / 2)));
  const idleExposure = Math.min(100, Math.round(Math.min(55, stayHours / 2) + Math.min(35, anchorageHours / 2) + (v.is_anchorage_waiting ? 10 : 0)));
  const anchorageExposure = Math.min(100, Math.round(Math.min(70, anchorageHours * 1.2) + (v.is_anchorage_waiting ? 20 : 0) + (hasAnchorageSignal(v) ? 10 : 0)));
  const biofoulingExposureScore = Math.min(100, Math.round(
    anchorageExposure * 0.32 +
    idleExposure * 0.24 +
    Math.min(25, stayHours / 4) +
    Math.round(routeProfile.biosecurity_exposure_score * 0.16) +
    predictedCongestionScore * 0.16
  ));
  const predictedCleaningOpportunityScore = Math.min(100, Math.round(
    Number(v.commercial_value_score || v.total_sales_priority_score || 0) * 0.28 +
    anchorageProbability * 0.18 +
    (predictedWorkWindowHours ? Math.min(100, predictedWorkWindowHours * 3) : 0) * 0.16 +
    biofoulingExposureScore * 0.18 +
    predictedCongestionScore * 0.14 +
    Number(arrivalPrediction.arrival_opportunity_score || 0) * 0.06
  ));
  return {
    predicted_congestion_score: predictedCongestionScore,
    congestion_forecast_band: forecastBand(predictedCongestionScore),
    anchorage_probability: anchorageProbability,
    predicted_work_window_hours: predictedWorkWindowHours,
    work_window_confidence: workWindowConfidence,
    repeat_caller_score: repeatCallerScore,
    repeat_operator_score: repeatOperatorScore,
    low_speed_exposure: lowSpeedExposure,
    idle_exposure: idleExposure,
    anchorage_exposure: anchorageExposure,
    biofouling_exposure_score: biofoulingExposureScore,
    predicted_cleaning_opportunity_score: predictedCleaningOpportunityScore
  };
}

function normalizeIdentityToken(value) {
  return String(value || "")
    .normalize("NFKC")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9가-힣]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeVesselName(value) {
  return String(value || "")
    .normalize("NFKC")
    .toUpperCase()
    .replace(/[^A-Z0-9가-힣]+/g, "");
}

function normalizeCompanyName(value) {
  return String(value || "")
    .normalize("NFKC")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, " ");
}

function hasValue(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === "number") return Number.isFinite(value) && value > 0;
  return String(value).trim() !== "";
}

const BASIC_INFO_FIELDS = [
  "vessel_name",
  "normalized_vessel_name",
  "call_sign",
  "imo",
  "mmsi",
  "vessel_type",
  "vessel_type_group",
  "gt",
  "dwt",
  "loa",
  "beam",
  "flag",
  "operator",
  "operator_normalized",
  "agent",
  "agent_normalized",
  "previous_port",
  "next_port",
  "destination_port",
  "port_code",
  "port_name",
  "berth_name",
  "anchorage_name",
  "eta",
  "ata",
  "etd",
  "atd"
];

function basicInfoCompleteness(record = {}) {
  const present = BASIC_INFO_FIELDS.filter(field => hasValue(record[field]));
  const missing = BASIC_INFO_FIELDS.filter(field => !hasValue(record[field]));
  return {
    vessel_basic_info_completeness_score: Math.round((present.length / BASIC_INFO_FIELDS.length) * 100),
    vessel_basic_info_present_fields: present,
    vessel_basic_info_missing_fields: missing
  };
}

function shouldPrioritizeVesselSpecEnrichment(record = {}) {
  const type = String(record.vessel_type_group || record.vessel_type || "").toLowerCase();
  return Number(record.gt || record.grtg || record.intrlGrtg || 0) >= COMMERCIAL_GT_THRESHOLD ||
    !record.imo ||
    record.gt_status === "unknown_gt_review" ||
    (record.commercial_value_score || record.total_sales_priority_score || 0) >= REVIEW_TARGET_THRESHOLD ||
    record.is_anchorage_waiting ||
    ["arrived_staying", "berthed", "anchorage_waiting"].includes(record.status_bucket) ||
    /bulk|tanker|container|pctc|cruise|passenger/.test(type) ||
    (record.vessel_basic_info_completeness_score || 0) < 65;
}

function identityConfidenceBand(score = 0) {
  if (score >= 95) return "imo_exact";
  if (score >= 80) return "strong_identifier";
  if (score >= 60) return "context_match";
  if (score >= 40) return "weak_fuzzy";
  return "unresolved";
}

function contextualIdentityBonus(v = {}) {
  let bonus = 0;
  if (Number(v.gt || v.grtg || v.intrlGrtg || 0) > 0) bonus += 4;
  if (v.vessel_type_group && v.vessel_type_group !== "unknown") bonus += 3;
  if (v.operator || v.agent) bonus += 3;
  if (v.port_code || v.port) bonus += 2;
  if (v.observation_count && Number(v.observation_count) > 1) bonus += 3;
  return bonus;
}

function deriveIdentity(v) {
  const imo = normalizeIdentityToken(v.imo);
  const mmsi = normalizeIdentityToken(v.mmsi);
  const callSign = normalizeIdentityToken(v.call_sign || v.callsign);
  const vesselName = normalizeVesselName(v.vessel_name);
  const gt = normalizeIdentityToken(v.gt || v.grtg || v.intrlGrtg);
  const vesselType = normalizeIdentityToken(v.vessel_type_group || v.vessel_type);
  const port = normalizeIdentityToken(v.port);
  const contextBonus = contextualIdentityBonus(v);

  if (imo) {
    const confidence = 100;
    return {
      hybrid_entity_key: `IMO-${imo}`,
      master_vessel_id: `MASTER-IMO-${imo}`,
      identification_method: "IMO",
      identity_match_strategy: "imo_exact",
      identity_confidence: confidence,
      identity_confidence_band: identityConfidenceBand(confidence),
      normalized_vessel_name: vesselName,
      imo_status: "present",
      imo_recovery_priority: "none"
    };
  }
  if (mmsi) {
    const confidence = Math.min(94, 85 + contextBonus);
    return {
      hybrid_entity_key: `MMSI-${mmsi}`,
      master_vessel_id: `MASTER-MMSI-${mmsi}`,
      identification_method: "MMSI",
      identity_match_strategy: "mmsi_exact",
      identity_confidence: confidence,
      identity_confidence_band: identityConfidenceBand(confidence),
      normalized_vessel_name: vesselName,
      imo_status: "missing",
      imo_recovery_priority: "medium"
    };
  }
  if (callSign) {
    const confidence = Math.min(94, 82 + contextBonus);
    return {
      hybrid_entity_key: `HYBRID-${callSign}-${vesselName || "UNKNOWN"}-${gt || "GTUNKNOWN"}`,
      master_vessel_id: `MASTER-CALLSIGN-${callSign}`,
      identification_method: "CALLSIGN_EXACT",
      identity_match_strategy: "call_sign_exact",
      identity_confidence: confidence,
      identity_confidence_band: identityConfidenceBand(confidence),
      normalized_vessel_name: vesselName,
      imo_status: "missing_recoverable",
      imo_recovery_priority: "high"
    };
  }
  if (vesselName && gt && vesselType && vesselType !== "UNKNOWN") {
    const confidence = Math.min(79, 62 + contextBonus);
    return {
      hybrid_entity_key: `HYBRID-NAME-GT-TYPE-${vesselName}-${gt}-${vesselType}`,
      master_vessel_id: `MASTER-NAMEGT-${vesselName}-${gt}-${vesselType}`,
      identification_method: "NORMALIZED_NAME_GT_TYPE",
      identity_match_strategy: "normalized_name_gt_type",
      identity_confidence: confidence,
      identity_confidence_band: identityConfidenceBand(confidence),
      normalized_vessel_name: vesselName,
      imo_status: "missing_recoverable",
      imo_recovery_priority: "high"
    };
  }
  const confidence = vesselName ? Math.min(59, 42 + contextBonus) : 20;
  return {
    hybrid_entity_key: `NAME_PORT-${vesselName || "UNKNOWN"}-${port || "UNKNOWN"}`,
    master_vessel_id: `PROVISIONAL-NAMEPORT-${vesselName || "UNKNOWN"}-${port || "UNKNOWN"}`,
    identification_method: vesselName ? "FUZZY_NAME_PORT" : "UNRESOLVED",
    identity_match_strategy: vesselName ? "fuzzy_name_context" : "unresolved",
    identity_confidence: confidence,
    identity_confidence_band: identityConfidenceBand(confidence),
    normalized_vessel_name: vesselName,
    imo_status: "missing_low_confidence",
    imo_recovery_priority: "review"
  };
}

function deriveFleetBadges(v) {
  const operator = String(v.operator || "").toLowerCase();
  const vesselName = String(v.vessel_name || "").toLowerCase();
  const text = `${operator} ${vesselName}`;
  const badges = [];
  if (v.operator) badges.push("operator_known");
  if (/hmm|hyundai|glovis|pan ocean|panocean|kss|sk shipping|sinokor|kmtc|korea|현대|글로비스|팬오션|고려|흥아|장금/.test(text)) {
    badges.push("korea_linked_operator");
  }
  if (v.operator && (v.observation_count || 0) >= 2) badges.push("repeat_observed_fleet");
  if ((v.cleaning_candidate_score || 0) >= 65 && v.operator) badges.push("fleet_leverage_watch");
  return badges;
}

function inferOperatorInfo(v = {}) {
  const currentOperator = v.operator_name || v.operator || "";
  const currentAgent = v.agent_name || v.agent || v.satmntEntrpsNm || v.entrpsCdNm || "";
  const manager = v.manager_name || v.manager || v.ship_manager || "";
  const owner = v.owner_name || v.owner || v.ship_owner || "";
  const normalizedOperator = normalizeCompanyName(currentOperator);
  const normalizedAgent = normalizeCompanyName(currentAgent);
  const name = normalizeVesselName(v.vessel_name);
  let operatorName = currentOperator;
  let operatorSource = v.operator_source || "";
  let operatorConfidence = Number(v.operator_confidence || 0);
  let operatorInferred = Boolean(v.operator_inferred);

  if (operatorName && !operatorSource) {
    operatorSource = v.vessel_master_match ? "vessel_master" : v.vessel_spec_enriched ? "vessel_spec_api" : v.operator_normalized ? "operator_dictionary" : "source_field";
    operatorConfidence = Math.max(operatorConfidence, operatorSource === "vessel_master" ? 95 : operatorSource === "vessel_spec_api" ? 92 : operatorSource === "operator_dictionary" ? 90 : 72);
    operatorInferred = false;
  }

  const prefixRules = [
    { pattern: /^HMM|^HYUNDAI/, operator: "HMM", confidence: 78 },
    { pattern: /^MAERSK/, operator: "MAERSK", confidence: 78 },
    { pattern: /^MSC/, operator: "MSC", confidence: 78 },
    { pattern: /^WANHAI|^WAN HAI/, operator: "WAN HAI", confidence: 75 },
    { pattern: /^EVER|^EVERGREEN/, operator: "EVERGREEN", confidence: 75 },
    { pattern: /^CMA|^APL/, operator: "CMA CGM", confidence: 72 },
    { pattern: /^ONE|^NYK|^KLINE|^MOL/, operator: "ONE / 일본계 선사군", confidence: 68 },
    { pattern: /^PAN|^PAN OCEAN/, operator: "PAN OCEAN", confidence: 72 },
    { pattern: /^GLOVIS|^HYUNDAI GLOVIS/, operator: "HYUNDAI GLOVIS", confidence: 76 },
    { pattern: /^KMTC/, operator: "KMTC", confidence: 74 },
    { pattern: /^SINOKOR/, operator: "SINOKOR", confidence: 74 }
  ];
  if (!operatorName && name) {
    const prefix = prefixRules.find(rule => rule.pattern.test(name));
    if (prefix) {
      operatorName = prefix.operator;
      operatorSource = "vessel_name_prefix";
      operatorConfidence = prefix.confidence;
      operatorInferred = true;
    }
  }

  if (!operatorName && currentAgent && /HMM|HYUNDAI|GLOVIS|MAERSK|MSC|PAN OCEAN|SINOKOR|KMTC|EVERGREEN|WAN HAI/i.test(currentAgent)) {
    operatorName = currentAgent;
    operatorSource = "agent_heuristic";
    operatorConfidence = 45;
    operatorInferred = true;
  }

  const companyContactAvailable = hasValue(v.operator_website || v.operator_url || v.agent_website || v.agent_url || v.operator_email || v.agent_email || v.operator_phone || v.agent_phone || v.contact_email || v.contact_phone);
  const repeatSignal = Number(v.repeat_operator_score || v.repeat_caller_score || 0) > 0 ? 5 : 0;
  const contactPathAvailable = Boolean(operatorName || currentAgent || companyContactAvailable);
  const contactReadinessScore = Math.min(100, Math.round(
    (operatorName ? Math.min(55, 20 + Number(operatorConfidence || 0) * 0.35) : 0) +
    (currentAgent ? 35 : 0) +
    (companyContactAvailable ? 10 : 0) +
    repeatSignal +
    (manager ? 5 : 0) +
    (owner ? 5 : 0)
  ));
  return {
    operator_name: operatorName || "",
    operator: operatorName || currentOperator || "",
    operator_normalized: operatorName ? normalizeCompanyName(operatorName) : normalizedOperator,
    operator_inferred: operatorInferred,
    operator_confidence: operatorName ? Math.max(1, Math.min(100, Math.round(operatorConfidence || 60))) : 0,
    operator_source: operatorName ? (operatorSource || "source_field") : "",
    operator_website: v.operator_website || v.operator_url || "",
    operator_email: v.operator_email || "",
    operator_phone: v.operator_phone || "",
    agent_name: currentAgent || "",
    agent: currentAgent || "",
    agent_normalized: normalizedAgent,
    agent_source: currentAgent ? (v.agent_source || (v.satmntEntrpsNm || v.entrpsCdNm ? "port_operation" : "source_field")) : "",
    agent_website: v.agent_website || v.agent_url || "",
    agent_email: v.agent_email || "",
    agent_phone: v.agent_phone || "",
    manager_name: manager || "",
    owner_name: owner || "",
    contact_path_available: contactPathAvailable,
    contact_readiness_score: contactReadinessScore
  };
}

function deriveOperationalRisk(v, metrics, biofoulingScore) {
  const status = String(v.status || "").toLowerCase();
  const flags = [];
  if ((metrics.anchorage_hours || 0) >= 24 || /waiting|anchorage|anchor|idle|drifting/.test(status)) flags.push("anchorage_waiting");
  if ((metrics.work_window_hours || 0) >= 24) flags.push("uwc_window_available");
  if ((metrics.stay_hours || 0) >= 168) flags.push("long_stay_7d");
  if ((metrics.stay_hours || 0) >= 336) flags.push("long_stay_14d");
  if ((metrics.stay_hours || 0) >= 720) flags.push("long_stay_30d");
  if ((metrics.stay_hours || 0) >= 2160) flags.push("long_stay_90d");
  if (biofoulingScore >= 85) flags.push("biofouling_critical");
  else if (biofoulingScore >= 70) flags.push("biofouling_high");
  if (/berth|alongside|moored/.test(status)) flags.push("berth_coordination_needed");

  return {
    operational_risk_flags: flags,
    work_feasibility: (metrics.work_window_hours || 0) >= 24
      ? "workable_window"
      : /waiting|anchorage|anchor|idle|drifting/.test(status)
        ? "anchorage_review"
        : "monitor_window",
    operational_risk_score: Math.min(100, Math.round(
      (metrics.work_window_hours || 0) * 0.25 +
      (metrics.anchorage_hours || 0) * 0.15 +
      biofoulingScore * 0.45
    ))
  };
}

function deriveCommercialScoreParts(v, metrics) {
  const type = String([v.vessel_type, v.vessel_type_group, v.vsslKndNm, v.vsslKndCd, v.commercial_segment].filter(Boolean).join(" ")).toLowerCase();
  const route = [v.destination, v.previous_port, v.next_port].join(" ").toLowerCase();
  const routeProfile = deriveRouteCommercialProfile(v);
  const routePattern = deriveRoutePattern(v, metrics, routeProfile);
  const arrivalPrediction = deriveArrivalPrediction(v, metrics, routeProfile, routePattern);
  const predictiveSignals = derivePredictiveSignals(v, metrics, routeProfile, routePattern, arrivalPrediction);
  const status = String(v.status || "").toLowerCase();
  const berthStatus = String([v.berth_status, v.terminal_activity].filter(Boolean).join(" ")).toLowerCase();
  const gt = Number(v.gt || v.grtg || v.intrlGrtg || 0);
  const meetsCommercialGtThreshold = gt >= COMMERCIAL_GT_THRESHOLD;
  const anchorageDays = Number(metrics.anchorage_hours || 0) / 24;
  const stayDays = Number(metrics.stay_hours || 0) / 24;
  const configuredCommercialFit = Number(v.commercial_fit_score || 0);
  const isExcludedType = /excluded|low_priority|예선|어선|관공선|작업선|tug|fishing|workboat|patrol|dredger/.test(type) || v.target_eligibility === "excluded";
  const isCommercialType = !isExcludedType && (/vlcc|cape|capesize|bulk|bulker|bulk_carrier|crude_tanker|product_tanker|chemical_tanker|tanker|pctc|lng|lpg|cruise|container/.test(type) || configuredCommercialFit >= 3);
  const sensitiveRoute = routeProfile.high_regulation_route || /australia|brazil|new zealand|california|usa|canada|port hedland|ponta da madeira/.test(route);
  const isAnchorageWaiting = Boolean(v.is_anchorage_waiting) || anchorageDays >= 0.5 || hasAnchorageSignal(v) || /waiting|anchorage|anchor|idle|drifting/.test(status);
  const isStayingWithoutDeparture = ["arrived_staying", "berthed", "anchorage_waiting"].includes(v.status_bucket) || Boolean(v.ata && !v.atd) || stayDays >= 0.5;
  const isLongIdle = stayDays >= 7 || anchorageDays >= 3;
  const isHighGt = gt >= 30000;
  const isVeryHighGt = gt >= 80000;
  const isBulkTankerPctc = /bulk|bulker|bulk_carrier|tanker|vlcc|crude_tanker|product_tanker|chemical_tanker|pctc|car carrier/.test(type);
  const berthOccupancyProxy = Number(v.berth_occupancy_proxy || 0);
  const enrichmentMatched = Boolean(v.secondary_enrichment_matched || v.cargo_harbor_use_enriched);
  const terminalActive = /active|working|cargo|loading|discharging|작업|하역|운영|진행/.test(berthStatus);
  const pilotMatched = Boolean(v.pilot_schedule_matched);
  const operatorConfidence = Number(v.operator_confidence || 0);
  const operatorSource = String(v.operator_source || "");
  const pilotOnly = v.source_origin === "pilot_schedule" || v.pilot_only_arrival_review;
  const pilotInbound = String(v.pilot_direction || v.movement_type || "").toLowerCase() === "inbound";
  const pilotOutbound = String(v.pilot_direction || v.movement_type || "").toLowerCase() === "outbound";
  const outboundPilotSoon = pilotOutbound && parseScheduleTime(v.pilot_time || v.movement_time || v.etd_candidate)?.getTime() > Date.now();
  const minimumCongestionScore = deriveCongestionScore(v, metrics);
  const biofoulingRiskScore = Math.min(30, Math.round(Math.min(14, stayDays * 1.4) + Math.min(8, anchorageDays * 2) + (isBulkTankerPctc ? 5 : isCommercialType ? 3 : 0) + Math.round(routeProfile.biosecurity_exposure_score / 20) + (isVeryHighGt ? 2 : 0)));
  const performanceProxyScore = Math.min(20, Math.round(Math.min(9, anchorageDays * 2) + Math.min(6, stayDays * 0.7) + (Number(v.speed || 0) > 0 && Number(v.speed || 0) < 1.5 ? 3 : 0) + (isHighGt ? 3 : meetsCommercialGtThreshold ? 2 : 0) + Math.round(routeProfile.fuel_efficiency_sensitivity_score / 25)));
  const stayCongestionProxy = isStayingWithoutDeparture ? Math.min(6, 2 + stayDays) : 0;
  const congestionExposureScore = Math.min(20, Math.max(Math.round(minimumCongestionScore / 5), Math.round((isAnchorageWaiting ? 10 : 0) + Math.min(8, anchorageDays * 2) + stayCongestionProxy + (isLongIdle ? 4 : 0) + (v.berth_class === "anchorage" ? 2 : 0) + Math.min(4, berthOccupancyProxy / 25) + (enrichmentMatched ? 1 : 0))));
  const cleaningWindowScore = Math.min(15, Math.max(0, Math.round(Math.min(9, Number(metrics.work_window_hours || 0) / 4) + (isAnchorageWaiting ? 4 : 0) + (v.berth || v.berth_name ? 2 : 0) + (enrichmentMatched ? 1 : 0) + (pilotMatched && !outboundPilotSoon ? 2 : 0) - (outboundPilotSoon ? 4 : 0) - (terminalActive ? 2 : 0))));
  const compliancePressureScore = Math.min(10, Math.round(Math.round(routeProfile.biosecurity_exposure_score / 20) + Math.round(routeProfile.esg_sensitivity_score / 35) + (isHighGt ? 3 : meetsCommercialGtThreshold ? 2 : 0) + (isBulkTankerPctc ? 1 : 0)));
  const operatorAccessibilityBonus = operatorSource === "vessel_master" || operatorSource === "vessel_spec_api"
    ? 5
    : operatorSource === "operator_dictionary"
      ? 4
      : operatorSource === "vessel_name_prefix" && operatorConfidence >= 70
        ? 3
        : operatorSource === "agent_dictionary"
          ? 2
          : operatorSource === "agent_heuristic"
            ? 1
            : v.operator
              ? 2
              : 0;
  const commercialFitScore = Math.min(5, Math.round(Math.max(configuredCommercialFit, (isBulkTankerPctc ? 3 : isCommercialType ? 2 : 0)) + (isHighGt ? 1 : 0) + (operatorAccessibilityBonus > 0 || v.agent ? 1 : 0) + (v.port_code ? 1 : 0) - (isExcludedType ? 4 : 0)));
  const routeMultiplierBonus = routeProfile.high_regulation_route && (isAnchorageWaiting || isLongIdle || isHighGt || isCommercialType)
    ? Math.round(routeProfile.route_commercial_weight * 0.45)
    : Math.round(routeProfile.route_commercial_weight * 0.25);
  const arrivalOpportunityBonus = arrivalPrediction.predicted_arrival_pipeline ? Math.min(8, Math.round(arrivalPrediction.arrival_opportunity_score / 14)) : 0;
  const total = biofoulingRiskScore + performanceProxyScore + congestionExposureScore + cleaningWindowScore + compliancePressureScore + commercialFitScore + routeMultiplierBonus + arrivalOpportunityBonus;
  const reasonCodes = [];
  if (anchorageDays >= 1) reasonCodes.push("LONG_ANCHORAGE_WAIT");
  if (congestionExposureScore >= 14) reasonCodes.push("PORT_CONGESTION_HIGH");
  if (isLongIdle) reasonCodes.push("EXTENDED_IDLE_PERIOD");
  if (isAnchorageWaiting) reasonCodes.push("LOW_SPEED_CONGESTION_PATTERN");
  if (meetsCommercialGtThreshold) reasonCodes.push("HIGH_GT_VESSEL");
  if (isHighGt) reasonCodes.push("HIGH_VALUE_GT_30000_PLUS");
  if (isBulkTankerPctc) reasonCodes.push(/pctc|car carrier/.test(type) ? "PCTC_HIGH_VALUE_TYPE" : "BULK_OR_TANKER");
  if (isCommercialType && !isExcludedType) reasonCodes.push("VESSEL_TYPE_COMMERCIAL_TARGET");
  if (v.berth_class === "anchorage") reasonCodes.push("ANCHORAGE_CLASSIFIED");
  if (enrichmentMatched) reasonCodes.push("BERTH_ENRICHMENT_MATCHED");
  if (pilotMatched) reasonCodes.push("PILOT_SCHEDULE_MATCHED");
  if (pilotOnly) reasonCodes.push("PILOT_ONLY_ARRIVAL_REVIEW");
  if (pilotInbound) reasonCodes.push("PILOT_INBOUND_SCHEDULED");
  if (outboundPilotSoon) reasonCodes.push("OUTBOUND_PILOT_WINDOW_CLOSING");
  if (berthOccupancyProxy >= 50) reasonCodes.push("BERTH_OCCUPANCY_SIGNAL");
  if (terminalActive) reasonCodes.push("TERMINAL_ACTIVITY_ACTIVE");
  if (v.operator && !v.operator_inferred) reasonCodes.push("OPERATOR_IDENTIFIED");
  if (v.operator && v.operator_inferred) reasonCodes.push("OPERATOR_INFERRED");
  if (v.agent) reasonCodes.push("AGENT_IDENTIFIED");
  if (v.operator || v.agent) reasonCodes.push("CONTACT_PATH_AVAILABLE");
  if (v.operator_fleet_badges?.includes("repeat_observed_fleet")) reasonCodes.push("REPEAT_OPERATOR_CALL");
  if (stayDays >= 7) reasonCodes.push("LONG_PORT_STAY");
  if (/australia|brazil/.test(route)) reasonCodes.push("AUSTRALIA_BRAZIL_EXPOSURE");
  if (routePattern.route_pattern_known) reasonCodes.push("REPEAT_ROUTE_PATTERN");
  if (arrivalPrediction.predicted_arrival_pipeline) reasonCodes.push("PREDICTED_ARRIVAL_OPPORTUNITY");
  if (arrivalPrediction.predicted_arrival_window_hours !== null && arrivalPrediction.predicted_arrival_window_hours <= 72) reasonCodes.push("ETA_24_72H_WINDOW");
  if (arrivalPrediction.predicted_congestion >= 60) reasonCodes.push("PREDICTED_CONGESTION_RISK");
  if (predictiveSignals.anchorage_probability >= 60) reasonCodes.push("ANCHORAGE_PROBABILITY_HIGH");
  if (predictiveSignals.predicted_cleaning_opportunity_score >= 60) reasonCodes.push("PREDICTED_CLEANING_OPPORTUNITY");
  if (predictiveSignals.biofouling_exposure_score >= 60) reasonCodes.push("BIOFOULING_EXPOSURE_HIGH");
  if (predictiveSignals.repeat_caller_score >= 60) reasonCodes.push("REPEAT_CALLER_SIGNAL");
  reasonCodes.push(...routeProfile.route_reason_codes);
  if (Number(metrics.work_window_hours || 0) >= 24) reasonCodes.push("BERTH_WINDOW_AVAILABLE");
  return {
    vessel_value_score: Math.min(20, Math.round((isHighGt ? 8 : meetsCommercialGtThreshold ? 5 : 0) + (isVeryHighGt ? 4 : 0) + Math.max(configuredCommercialFit, isBulkTankerPctc ? 5 : isCommercialType ? 3 : 0) + (v.operator || v.agent ? 2 : 0) + (sensitiveRoute ? 1 : 0) - (isExcludedType ? 8 : 0))),
    biofouling_risk_score: biofoulingRiskScore,
    performance_proxy_score: performanceProxyScore,
    congestion_exposure_score: congestionExposureScore,
    congestion_score: minimumCongestionScore,
    cleaning_window_score: cleaningWindowScore,
    compliance_pressure_score: compliancePressureScore,
    sales_accessibility_score: Math.min(5, Math.max(operatorAccessibilityBonus, Math.round((v.agent ? 2 : 0) + (v.operator ? 2 : 0) + (v.operator_normalized || v.agent_normalized ? 1 : 0)))),
    contact_readiness_score: Math.max(Number(v.contact_readiness_score || 0), Math.min(100, Math.round((operatorAccessibilityBonus / 5) * 55 + (v.agent ? 35 : 0) + (v.manager_name ? 5 : 0) + (v.owner_name ? 5 : 0)))),
    commercial_fit_score: commercialFitScore,
    total_sales_priority_score: Math.min(100, total),
    sales_priority_band: total >= IMMEDIATE_TARGET_THRESHOLD ? "immediate_target" : total >= SALES_CANDIDATE_THRESHOLD ? "high_potential" : total >= REVIEW_TARGET_THRESHOLD ? "review_target" : "low_priority",
    commercial_gt_threshold: COMMERCIAL_GT_THRESHOLD,
    meets_commercial_gt_threshold: meetsCommercialGtThreshold,
    review_target: total >= REVIEW_TARGET_THRESHOLD,
    is_anchorage_waiting: isAnchorageWaiting,
    is_staying_without_departure: isStayingWithoutDeparture,
    is_long_idle: isLongIdle,
    anchorage_days: Math.round(anchorageDays * 10) / 10,
    estimated_waiting_time: metrics.anchorage_hours || 0,
    port_congestion_score: Math.max(minimumCongestionScore, congestionExposureScore * 5),
    anchorage_density_score: Math.min(100, Math.round(anchorageDays * 12 + (isAnchorageWaiting ? 20 : 0))),
    idle_risk_score: Math.min(100, Math.round(stayDays * 8 + anchorageDays * 10)),
    high_value_target: Boolean(isHighGt && isBulkTankerPctc),
    berth_occupancy_proxy: berthOccupancyProxy,
    terminal_activity_active: terminalActive,
    pilot_schedule_matched: pilotMatched,
    candidate_urgency_score: Math.min(100, Math.round(total + (pilotMatched ? 8 : 0) + (pilotInbound ? 5 : 0) - (outboundPilotSoon ? 10 : 0))),
    arrival_pipeline_score: Math.min(100, Math.round((pilotInbound ? 40 : 0) + (isHighGt ? 20 : meetsCommercialGtThreshold ? 12 : 0) + (isCommercialType ? 15 : 0) + (sensitiveRoute ? 10 : 0))),
    berth_timing_confidence: Math.max(Number(v.berth_timing_confidence || 0), pilotMatched ? Number(v.pilot_match_confidence || 0) : 0),
    commercial_signal_strength: Math.min(100, Math.round(total + routeProfile.route_commercial_weight + (isHighGt ? 8 : 0) + (isAnchorageWaiting ? 8 : 0) + (isBulkTankerPctc ? 5 : 0))),
    ...routeProfile,
    ...routePattern,
    ...arrivalPrediction,
    ...predictiveSignals,
    score_reason_codes: [...new Set(reasonCodes)]
  };
}

function commercialValueBand(score, gtStatus) {
  if (gtStatus === "unknown_gt_review" && score >= 40) return "unknown_gt_review";
  if (score >= CRITICAL_TARGET_THRESHOLD) return "critical_commercial_target";
  if (score >= IMMEDIATE_TARGET_THRESHOLD) return "immediate_commercial_target";
  if (score >= SALES_CANDIDATE_THRESHOLD) return "high_potential_target";
  if (score >= REVIEW_TARGET_THRESHOLD) return "review_target";
  return "low_priority";
}

function deriveCommercialValue(v = {}, scoreParts = {}) {
  const commercialValueScore = Math.min(100, Math.round(
    Number(scoreParts.vessel_value_score || 0) +
    Number(scoreParts.congestion_exposure_score || 0) +
    Number(scoreParts.biofouling_risk_score || 0) +
    Number(scoreParts.cleaning_window_score || 0) +
    Number(scoreParts.performance_proxy_score || 0) +
    Number(scoreParts.compliance_pressure_score || 0) +
    Number(scoreParts.sales_accessibility_score || 0) +
    Number(scoreParts.route_commercial_weight || 0) +
    Math.round(Number(scoreParts.arrival_opportunity_score || 0) / 12)
  ));
  return {
    commercial_value_score: commercialValueScore,
    commercial_value_band: commercialValueBand(commercialValueScore, v.gt_status),
    total_sales_priority_score: commercialValueScore,
    sales_priority_band: commercialValueScore >= IMMEDIATE_TARGET_THRESHOLD ? "immediate_target" : commercialValueScore >= SALES_CANDIDATE_THRESHOLD ? "high_potential" : commercialValueScore >= REVIEW_TARGET_THRESHOLD ? "review_target" : "low_priority"
  };
}

function boundedScore(value) {
  return Math.max(0, Math.min(100, Math.round(Number(value || 0))));
}

function deriveWorkFeasibilityScore(v = {}, metrics = {}) {
  const status = String(v.status_bucket || v.status || "").toLowerCase();
  const anchorageHours = Number(metrics.anchorage_hours ?? v.anchorage_hours ?? 0);
  const stayHours = Number(metrics.stay_hours ?? v.stay_hours ?? 0);
  const workWindowHours = Number(metrics.work_window_hours ?? v.work_window_hours ?? 0);
  const cleaningWindow = Number(v.cleaning_window_score || 0) * 5;
  let score = cleaningWindow;
  if (workWindowHours >= 12) score += 18;
  if (workWindowHours >= 24) score += 12;
  if (anchorageHours >= 24 || v.is_anchorage_waiting || status.includes("anchorage")) score += 22;
  if (stayHours >= 48 && !v.atd) score += 16;
  if (v.pilot_schedule_matched) score += 6;
  if (String(v.pilot_direction || v.movement_type || "").toLowerCase() === "outbound") score -= 12;
  if (/active|working|cargo|loading|discharging|작업|하역|진행/.test(String(v.terminal_activity || "").toLowerCase())) score -= 8;
  return boundedScore(score);
}

function deriveLeadStatus(v = {}, leadPriorityScore = 0) {
  const existing = String(v.lead_status || "").toLowerCase();
  if (["contacted", "quoted", "scheduled", "won", "lost"].includes(existing)) return existing;
  if (leadPriorityScore >= IMMEDIATE_TARGET_THRESHOLD && (v.contact_path_available || Number(v.contact_readiness_score || 0) >= 50)) return "contact_ready";
  if (leadPriorityScore >= SALES_CANDIDATE_THRESHOLD) return "new_lead";
  return "monitor";
}

function deriveSalesAngle(v = {}, metrics = {}) {
  const routeProfile = deriveRouteCommercialProfile(v);
  const type = String([v.vessel_type_group, v.vessel_type, v.commercial_segment].filter(Boolean).join(" ")).toLowerCase();
  const gt = Number(v.gt || v.grtg || v.intrlGrtg || 0);
  if (routeProfile.high_regulation_route) return "호주/브라질/북미/유럽 항로 컴플라이언스";
  if (Number(metrics.work_window_hours ?? v.work_window_hours ?? 0) > 0 || (v.etd && !v.atd)) return "출항 전 작업 가능성";
  if (Number(metrics.anchorage_hours ?? v.anchorage_hours ?? 0) >= 24 || v.is_anchorage_waiting) return "체선/묘박 기반 작업 가능성";
  if (gt >= 30000 && /bulk|bulker|bulk_carrier|tanker|container|pctc|cruise/.test(type)) return "대형 벌크선 선체오염 리스크";
  return "상업 후보 선박 우선 검토";
}

function deriveWhyNow(v = {}, metrics = {}) {
  const parts = [];
  const stayHours = Number(metrics.stay_hours ?? v.stay_hours ?? 0);
  const anchorageHours = Number(metrics.anchorage_hours ?? v.anchorage_hours ?? 0);
  const workWindowHours = Number(metrics.work_window_hours ?? v.work_window_hours ?? 0);
  const routeProfile = deriveRouteCommercialProfile(v);
  if (anchorageHours >= 24 || v.is_anchorage_waiting) parts.push(`묘박/대기 ${Math.round(anchorageHours)}시간`);
  if (stayHours >= 48 && !v.atd) parts.push(`체류 ${Math.round(stayHours)}시간`);
  if (workWindowHours > 0) parts.push(`출항 전 작업 가능 시간 ${Math.round(workWindowHours)}시간`);
  if (routeProfile.high_regulation_route) parts.push(`${routeProfile.route_region} 항로 민감도`);
  if (Number(v.gt || v.grtg || v.intrlGrtg || 0) >= 30000) parts.push("대형 상선");
  if (v.pilot_schedule_matched) parts.push("도선 스케줄 확인");
  return parts.length
    ? `${parts.slice(0, 3).join(" · ")} 때문에 지금 영업 판단이 필요합니다.`
    : "상업 점수와 항만 체류 신호를 기준으로 모니터링이 필요합니다.";
}

function deriveRecommendedNextAction(v = {}, leadPriorityScore = 0) {
  const outboundSoon = String(v.pilot_direction || v.movement_type || "").toLowerCase() === "outbound" || (v.etd && !v.atd && Number(v.work_window_hours || 0) <= 12);
  if (!v.agent_name && !v.agent) return "대리점 확인";
  if (!v.operator_name && !v.operator) return "운영선사 확인";
  if (outboundSoon) return "도선/출항 전 재확인";
  if (leadPriorityScore >= IMMEDIATE_TARGET_THRESHOLD) return "견적 제안";
  return "선박 스케줄 확인";
}

function deriveLeadTimeline(v = {}, metrics = {}) {
  return [
    { label: "ETA", value: v.eta || v.eta_candidate || null, source: v.eta_source || (v.eta_candidate ? "pilot_schedule" : "") },
    { label: "ETB", value: v.etb || v.etb_candidate || null, source: v.etb_source || (v.etb_candidate ? "berth_or_pilot_schedule" : "") },
    { label: "ETD", value: v.etd || v.etd_candidate || null, source: v.etd_source || "" },
    { label: "ATD", value: v.atd || null, source: v.atd ? "port_operation" : "" },
    { label: "도선", value: v.pilot_time || v.movement_time || null, source: v.pilot_schedule_matched ? "pilot_schedule" : "" },
    { label: "작업창", value: Number(metrics.work_window_hours ?? v.work_window_hours ?? 0) > 0 ? `${Math.round(Number(metrics.work_window_hours ?? v.work_window_hours ?? 0))}시간` : null, source: metrics.work_window_status || v.work_window_status || "" }
  ].filter(item => item.value);
}

function deriveCandidateSummaryKo(v = {}) {
  const pieces = [];
  if (Number(v.gt || v.grtg || v.intrlGrtg || 0) >= 50000) pieces.push("대형 상선");
  if (v.is_anchorage_waiting || Number(v.anchorage_hours || 0) >= 24) pieces.push("묘박/대기 신호");
  if (Number(v.stay_hours || v.current_call_stay_hours || 0) >= 48 && !v.atd) pieces.push("장기 체류");
  if (Number(v.predicted_cleaning_opportunity_score || 0) >= 60) pieces.push("예측 작업 기회");
  if (v.high_regulation_route) pieces.push("민감 항로");
  if (v.contact_path_available || v.agent_name || v.agent) pieces.push("연락 경로 확인");
  return pieces.length ? `${pieces.slice(0, 4).join(" · ")} 기반 영업 후보입니다.` : "상업 점수 기준으로 모니터링이 필요한 선박입니다.";
}

function derivePredictionAccuracy(v = {}) {
  const predicted = parseScheduleTime(v.predicted_arrival_time);
  const actual = parseScheduleTime(v.ata || v.actual_arrival_time);
  return {
    actual_arrival_time: actual ? actual.toISOString() : "",
    prediction_error_hours: predicted && actual ? Math.round(Math.abs(actual.getTime() - predicted.getTime()) / 36e5 * 10) / 10 : null
  };
}

function isAlertCandidate(v = {}) {
  return Number(v.gt || v.grtg || v.intrlGrtg || 0) >= 50000 ||
    Number(v.anchorage_hours || 0) >= 48 ||
    Number(v.commercial_value_score || v.total_sales_priority_score || 0) >= IMMEDIATE_TARGET_THRESHOLD ||
    (String(v.pilot_direction || v.movement_type || "").toLowerCase() !== "outbound" && !v.outbound_pilot_scheduled && Number(v.predicted_cleaning_opportunity_score || 0) >= 60);
}

function deriveLeadPipelineFields(v = {}, metrics = {}) {
  const workFeasibilityScore = deriveWorkFeasibilityScore(v, metrics);
  const leadPriorityScore = boundedScore(
    Number(v.commercial_value_score || v.total_sales_priority_score || 0) * 0.45 +
    Number(v.contact_readiness_score || 0) * 0.2 +
    workFeasibilityScore * 0.2 +
    Math.max(Number(v.arrival_opportunity_score || 0), Number(v.predicted_cleaning_opportunity_score || 0)) * 0.15
  );
  return {
    work_feasibility_score: workFeasibilityScore,
    lead_priority_score: leadPriorityScore,
    lead_status: deriveLeadStatus(v, leadPriorityScore),
    why_now: deriveWhyNow(v, metrics),
    candidate_summary_ko: deriveCandidateSummaryKo(v),
    sales_angle: deriveSalesAngle(v, metrics),
    recommended_next_action: deriveRecommendedNextAction(v, leadPriorityScore),
    lead_timeline: deriveLeadTimeline(v, metrics),
    ...derivePredictionAccuracy(v),
    alert_candidate: isAlertCandidate(v),
    information_enrichment_needed: Number(v.commercial_value_score || v.total_sales_priority_score || 0) >= SALES_CANDIDATE_THRESHOLD && Number(v.data_confidence_score || 0) < 60
  };
}

function deriveDataConfidence(v = {}) {
  let score = 0;
  if (Number(v.gt || v.grtg || v.intrlGrtg || 0) > 0) score += 16;
  if (v.call_sign) score += 12;
  if (v.imo || v.mmsi) score += 16;
  if (v.berth_name || v.berth || v.anchorage_name || v.anchorage_zone) score += 12;
  if (v.eta || v.ata) score += 10;
  if (v.etd || v.atd) score += 10;
  if (v.pilot_schedule_matched || v.source_origin === "pilot_schedule") score += 10;
  if (v.agent || v.operator) score += 10;
  if (v.vessel_master_seed_match) score += 8;
  if (v.reference_enriched) score += 8;
  if (v.cargo_harbor_use_enriched || v.source_children?.length) score += 8;
  const bounded = Math.min(100, score);
  return {
    data_confidence_score: bounded,
    data_confidence_band: bounded >= 80 ? "high" : bounded >= 60 ? "medium" : bounded >= 40 ? "low" : "review"
  };
}

function gtGroup(gt) {
  const value = Number(gt || 0);
  if (value >= 80000) return "gt_80000_plus";
  if (value >= 30000) return "gt_30000_79999";
  if (value >= 5000) return "gt_5000_29999";
  if (value > 0) return "gt_under_5000";
  return "gt_unknown";
}

function defaultVesselTypeGroup(v = {}) {
  const text = String([v.vessel_type_group, v.vessel_type, v.vsslKndNm, v.vsslKndCd, v.ship_type, v.kind, v.commercial_segment].filter(Boolean).join(" ")).toLowerCase();
  if (/bulk|bulker|cape|ore|산물|벌크|광석/.test(text)) return "bulk_carrier";
  if (/tanker|vlcc|crude|chemical|product|원유|유조|석유|케미컬/.test(text)) return "tanker";
  if (/pctc|pcc|car carrier|ro-?ro|roro|자동차|차량/.test(text)) return "pctc";
  if (/container|컨테이너/.test(text)) return "container";
  if (/lng|lpg|gas|가스/.test(text)) return "lng_lpg";
  if (/cruise|passenger|여객|크루즈/.test(text)) return "passenger";
  if (/tug|fish|fishing|patrol|workboat|dredger|어선|예선|관공선|작업선|준설/.test(text)) return "excluded_small_craft";
  return "unknown";
}

function commercialGtProfile(v = {}) {
  const grtg = Number(v.grtg || 0);
  const intrlGrtg = Number(v.intrlGrtg || 0);
  const fallbackGt = Number(v.gt || 0);
  const gt = Math.max(grtg, intrlGrtg, fallbackGt);
  const gtSource = grtg > 0 ? "grtg" : intrlGrtg > 0 ? "intrlGrtg" : fallbackGt > 0 ? "gt" : "unknown";
  const gtStatus = gt >= COMMERCIAL_GT_THRESHOLD
    ? "target_vessel"
    : gt > 0
      ? "non_target_small_vessel"
      : "unknown_gt_review";
  return {
    gt,
    grtg,
    intrlGrtg,
    gt_source: gtSource,
    gt_status: gtStatus,
    meets_commercial_gt_threshold: gt >= COMMERCIAL_GT_THRESHOLD,
    target_vessel: gt >= COMMERCIAL_GT_THRESHOLD || gtStatus === "unknown_gt_review"
  };
}

function excludedCommercialType(v = {}) {
  const type = String(v.vessel_type || "").toLowerCase();
  const name = String(v.vessel_name || "").toLowerCase();
  return /fishing|fishery|trawler|tug|pilot|patrol|government|navy|coast guard|workboat|barge|dredger|어선|예선|관공선|작업선|준설|순찰|해경/.test(`${type} ${name}`);
}

function deriveStatusBucket(v = {}, metrics = {}) {
  const now = new Date();
  const eta = parseScheduleTime(v.eta || v.eta_candidate);
  const ata = parseScheduleTime(v.ata);
  const atd = parseScheduleTime(v.atd);
  const etdCandidate = parseScheduleTime(v.etd_candidate);
  const status = String(v.status || "").toLowerCase();
  const facilityType = String(v.facility_type || v.berth_class || "").toLowerCase();
  if (v.pilot_only_arrival_review && eta && eta.getTime() >= now.getTime()) return "arriving_soon";
  if ((facilityType === "anchorage" || hasAnchorageSignal(v) || /waiting|anchorage|anchor|idle|drifting/.test(status) || (metrics.anchorage_hours || 0) > 0) && !atd) return "anchorage_waiting";
  if ((facilityType === "berth" || /berth|moored|alongside/.test(status) || v.berth || v.berth_name || v.atb) && !atd) return "berthed";
  if (ata && !atd) return "arrived_staying";
  if (eta && !ata && eta.getTime() >= now.getTime()) return "arriving_soon";
  if (atd) return "departed";
  if (etdCandidate && !atd) return "arrived_staying";
  return "unknown";
}

function deriveCongestionScore(v = {}, metrics = {}) {
  const anchorageHours = Number(metrics.anchorage_hours ?? v.anchorage_hours ?? 0);
  const stayHours = Number(metrics.stay_hours ?? v.stay_hours ?? v.current_call_stay_hours ?? v.cumulative_stay_hours ?? 0);
  const facilityType = String(v.facility_type || v.berth_class || v.anchorage_class || "").toLowerCase();
  const statusBucket = String(v.status_bucket || "").toLowerCase();
  const hasDeparture = hasValue(v.atd);
  let score = Math.max(
    0,
    Number(v.congestion_score || 0),
    Number(v.port_congestion_score || 0),
    Number(v.anchorage_density_score || 0),
    Number(v.congestion_exposure_score || 0) * 5
  );
  if (anchorageHours >= 24) score = Math.max(score, 40);
  if (anchorageHours >= 48) score = Math.max(score, 60);
  if (anchorageHours >= 72) score = Math.max(score, 75);
  if (stayHours >= 48 && !hasDeparture) score = Math.max(score, 45);
  if (stayHours >= 72 && !hasDeparture) score = Math.max(score, 60);
  if ((facilityType === "anchorage" || statusBucket === "anchorage_waiting" || hasAnchorageSignal(v)) && !hasDeparture) score = Math.max(score, 60);
  if ((anchorageHours > 0 || stayHours > 0 || ["arrived_staying", "berthed", "anchorage_waiting"].includes(statusBucket)) && score === 0) score = 20;
  return Math.min(100, Math.round(score));
}

function commercialRelevanceStatus(v = {}) {
  if (v.excluded_commercial_type) return "excluded_non_commercial_type";
  if (v.status_bucket === "departed") return "excluded_departure_only";
  if (v.gt_status === "target_vessel") return "target_vessel";
  if (v.gt_status === "unknown_gt_review") return "unknown_gt_review";
  return "non_target_small_vessel";
}

function isMainCommercialVessel(v = {}) {
  const score = Number(v.commercial_value_score || v.total_sales_priority_score || v.cleaning_candidate_score || 0);
  if (isExplicitlyExcluded(v)) return false;
  return ["target_vessel", "unknown_gt_review"].includes(v.commercial_relevance_status) || score >= SALES_CANDIDATE_THRESHOLD;
}

function isExplicitlyExcluded(v = {}) {
  const gt = Number(v.gt || v.grtg || v.intrlGrtg || 0);
  return v.commercial_relevance_status === "excluded_non_commercial_type" ||
    v.commercial_relevance_status === "excluded_departure_only" ||
    (v.commercial_relevance_status === "non_target_small_vessel" && gt > 0 && gt < COMMERCIAL_GT_THRESHOLD) ||
    v.excluded_from_commercial_targets === true;
}

function isSyntheticSample(v = {}) {
  const text = [v.vessel_name, v.name, v.source, v.source_name, v.data_mode].filter(Boolean).join(" ").toLowerCase();
  return /sample|demo|yeosu target|mv hf zhoushan|maersk demo/.test(text);
}

function isHardCandidateExcluded(v = {}) {
  return v.commercial_relevance_status === "excluded_non_commercial_type" ||
    v.commercial_relevance_status === "excluded_departure_only" ||
    v.excluded_from_commercial_targets === true ||
    isSyntheticSample(v);
}

function isSalesCandidate(v = {}) {
  const score = Number(v.commercial_value_score || v.total_sales_priority_score || v.cleaning_candidate_score || 0);
  return !isHardCandidateExcluded(v) && score >= SALES_CANDIDATE_THRESHOLD;
}

function isImmediateTarget(v = {}) {
  const score = Number(v.commercial_value_score || v.total_sales_priority_score || v.cleaning_candidate_score || 0);
  return !isHardCandidateExcluded(v) && score >= IMMEDIATE_TARGET_THRESHOLD;
}

function commercialExclusionReason(v = {}) {
  if (v.commercial_relevance_status === "excluded_non_commercial_type") return "excluded_non_commercial_type";
  if (v.commercial_relevance_status === "excluded_departure_only") return "excluded_departure_only";
  if (v.commercial_relevance_status === "non_target_small_vessel" && Number(v.gt || v.grtg || v.intrlGrtg || 0) > 0 && Number(v.gt || v.grtg || v.intrlGrtg || 0) < COMMERCIAL_GT_THRESHOLD) return "excluded_under_5000gt";
  if (v.excluded_from_commercial_targets === true) return v.exclusion_reason || "explicitly_excluded";
  return "";
}

function buildCommercialSignals(v = {}, metrics = {}) {
  const gt = Number(v.gt || v.grtg || v.intrlGrtg || 0);
  const typeGroup = String(v.vessel_type_group || v.vessel_type || "").toLowerCase();
  const routeProfile = deriveRouteCommercialProfile(v);
  const routePattern = deriveRoutePattern(v, metrics, routeProfile);
  const arrivalPrediction = deriveArrivalPrediction(v, metrics, routeProfile, routePattern);
  const predictiveSignals = derivePredictiveSignals(v, metrics, routeProfile, routePattern, arrivalPrediction);
  const flags = [];
  if (gt >= 30000) flags.push("GT_30000_PLUS");
  if (gt >= 80000) flags.push("GT_80000_PLUS");
  if (/bulk|bulk_carrier|tanker|pctc/.test(typeGroup)) flags.push("HIGH_VALUE_VESSEL_TYPE");
  if (/bulk|bulk_carrier/.test(typeGroup)) flags.push("LARGE_BULK_CARRIER");
  if (/tanker/.test(typeGroup)) flags.push("TANKER_TARGET");
  if (/pctc/.test(typeGroup)) flags.push("PCTC_TARGET");
  if (/cruise|passenger/.test(typeGroup)) flags.push("CRUISE_TARGET");
  if (v.is_anchorage_waiting || v.berth_class === "anchorage" || hasAnchorageSignal(v)) flags.push("ANCHORAGE_WAITING_CLASSIFIED");
  if ((metrics.stay_hours || 0) >= 48) flags.push("STAY_48H_PLUS");
  if ((metrics.stay_hours || 0) >= 720) flags.push("CUMULATIVE_STAY_30D_PLUS");
  if ((metrics.anchorage_hours || 0) >= 24) flags.push("ANCHORAGE_24H_PLUS");
  if ((v.congestion_exposure_score || 0) >= 14 || (v.port_congestion_score || 0) >= 60) flags.push("CONGESTION_EXPOSED");
  if (v.berth_class && v.berth_class !== "general") flags.push(`BERTH_CLASS_${String(v.berth_class).toUpperCase()}`);
  if (v.agent) flags.push("AGENT_IDENTIFIED");
  if (v.operator) flags.push("OPERATOR_IDENTIFIED");
  if (v.reference_enriched) flags.push("KNOWN_COMMERCIAL_SEGMENT");
  if (routePattern.route_pattern_known) flags.push("REPEAT_ROUTE_PATTERN");
  if (arrivalPrediction.predicted_arrival_pipeline) flags.push("PREDICTED_ARRIVAL_OPPORTUNITY");
  if (arrivalPrediction.predicted_congestion >= 60) flags.push("PREDICTED_CONGESTION_RISK");
  if (predictiveSignals.anchorage_probability >= 60) flags.push("ANCHORAGE_PROBABILITY_HIGH");
  if (predictiveSignals.predicted_cleaning_opportunity_score >= 60) flags.push("PREDICTED_CLEANING_OPPORTUNITY");
  if (predictiveSignals.biofouling_exposure_score >= 60) flags.push("BIOFOULING_EXPOSURE_HIGH");
  flags.push(...routeProfile.route_reason_codes);
  return {
    commercial_signal_flags: [...new Set(flags)],
    high_value_target: flags.includes("GT_30000_PLUS") && flags.includes("HIGH_VALUE_VESSEL_TYPE"),
    congestion_exposed_target: flags.includes("ANCHORAGE_WAITING_CLASSIFIED") || flags.includes("CONGESTION_EXPOSED"),
    route_region: routeProfile.route_region,
    biosecurity_exposure_score: routeProfile.biosecurity_exposure_score,
    esg_sensitivity_score: routeProfile.esg_sensitivity_score,
    fuel_efficiency_sensitivity_score: routeProfile.fuel_efficiency_sensitivity_score,
    hull_performance_sensitivity_score: routeProfile.hull_performance_sensitivity_score,
    high_regulation_route: routeProfile.high_regulation_route,
    compliance_priority: routeProfile.compliance_priority,
    ...routePattern,
    ...arrivalPrediction
  };
}

function buildImoRecovery(v = {}, metrics = {}) {
  if (v.imo) {
    return {
      imo_recovery_required: false,
      imo_recovery_score: 0,
      imo_recovery_priority: "none"
    };
  }
  const gt = Number(v.gt || v.grtg || v.intrlGrtg || 0);
  let score = 0;
  score += Math.min(45, Math.round(gt / 2000));
  score += Math.min(20, Math.round(Number(metrics.stay_hours || 0) / 24));
  score += Math.min(15, Math.round(Number(metrics.anchorage_hours || 0) / 8));
  score += Math.min(15, Math.round(Number(v.total_sales_priority_score || v.cleaning_candidate_score || 0) / 6));
  if (v.gt_status === "unknown_gt_review") score += 12;
  if (v.high_value_target) score += 15;
  if (v.is_cleaning_candidate || v.is_immediate_candidate) score += 10;
  const bounded = Math.min(100, score);
  return {
    imo_recovery_required: true,
    imo_recovery_score: bounded,
    imo_recovery_priority: bounded >= 80 ? "urgent" : bounded >= 60 ? "high" : bounded >= 40 ? "medium" : "review"
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

console.log(`[HWK] v${VERSION} ${BUILD_NAME} pipeline started`);

const startedAt = new Date().toISOString();
const runId = createRunId();
let status = "success";
let errorMessage = null;
let supabaseStatus = "not_configured";
let supabaseWrite = { status: "not_configured" };
let gdriveArchive = { status: "not_configured" };
let vessels = [];
let collectedRows = [];
let collectorDiagnosticsAfterCollection = {};
let vesselMasterCacheDiagnostics = {};

function ensureDirs() {
  fs.mkdirSync("dashboard/api", { recursive: true });
  fs.mkdirSync("data/history", { recursive: true });
  fs.mkdirSync("data/reports", { recursive: true });
  fs.mkdirSync("public", { recursive: true });
  for (const entry of fs.readdirSync("dashboard/api", { withFileTypes: true })) {
    const target = `dashboard/api/${entry.name}`;
    if (entry.isFile() && /\.(json|csv)$/i.test(entry.name)) fs.rmSync(target, { force: true });
    if (entry.isDirectory() && entry.name === "ports") fs.rmSync(target, { recursive: true, force: true });
  }
}

function riskLevel(score = 0) {
  if (score >= 85) return "Critical";
  if (score >= 70) return "High";
  if (score >= 45) return "Medium";
  return "Low";
}

function recommendedAction(v) {
  const score = v.risk_score || 0;
  if (score >= 85 && v.compliance_watch) return "Immediate outreach: propose UWC + compliance evidence package";
  if (score >= 85) return "Immediate outreach: propose hull-performance recovery check";
  if (score >= 70) return "Sales follow-up: confirm hull condition and itinerary";
  if (v.compliance_watch) return "Monitor: prepare biofouling documentation angle";
  return "Monitor only";
}

function estimateOpportunity(v) {
  const score = v.risk_score || 0;
  const type = String(v.vessel_type || "").toLowerCase();
  let base = 18000;
  if (/vlcc|cape|capesize|bulk|tanker/.test(type)) base = 42000;
  if (/container|cruise|lng|lpg/.test(type)) base = 36000;
  if (score >= 85) return base;
  if (score >= 70) return Math.round(base * 0.72);
  if (score >= 45) return Math.round(base * 0.42);
  return Math.round(base * 0.18);
}

function candidateSignals(v) {
  const reasons = [];
  const status = String(v.status || "").toLowerCase();
  const type = String(v.vessel_type || "").toLowerCase();
  const dest = String(v.destination || v.next_port_country || v.next_port || "").toLowerCase();
  const days = Number(v.days_in_korea || v.idle_days || 0);
  const speed = Number(v.speed || 0);
  const risk = Number(v.risk_score || 0);

  if (v.actionable_source_row === false) return reasons;
  if (/waiting|anchorage|anchor|idle|drifting/.test(status)) reasons.push({ key: "waiting", points: 22, label: "Waiting/anchorage condition" });
  if (days >= 21) reasons.push({ key: "long_idle_21", points: 24, label: "21+ days Korea stay / idle exposure" });
  else if (days >= 14) reasons.push({ key: "long_idle_14", points: 18, label: "14+ days Korea stay / idle exposure" });
  else if (days >= 7) reasons.push({ key: "idle_7", points: 9, label: "7+ days Korea stay" });
  if (speed > 0 && speed <= 3) reasons.push({ key: "low_speed", points: 12, label: "Low speed / near-static movement" });
  if (/vlcc|cape|capesize|bulk|bulker|tanker|lng|lpg|cruise|container/.test(type)) reasons.push({ key: "valuable_vessel", points: 12, label: "Commercially relevant vessel type" });
  if (/australia|brazil|new zealand|california|usa|canada/.test(dest)) reasons.push({ key: "regulated_destination", points: 16, label: "Biofouling-sensitive destination" });
  if ((v.work_window_hours || 0) >= 24) reasons.push({ key: "work_window", points: 8, label: "Workable UWC window available" });
  if (risk >= 85) reasons.push({ key: "risk_critical", points: 18, label: "Critical fouling / performance risk score" });
  else if (risk >= 70) reasons.push({ key: "risk_high", points: 12, label: "High fouling / performance risk score" });
  if (v.operator) reasons.push({ key: "operator_known", points: 4, label: "Operator identified for outreach" });

  return reasons;
}

function buildCandidateProfile(v) {
  const signals = candidateSignals(v);
  const rawScore = signals.reduce((sum, s) => sum + s.points, 0);
  const score = Math.min(100, rawScore);
  let level = "Monitor";
  let urgency = "Low";
  let contactWindow = "Monitor weekly";
  let nextAction = "Monitor only; wait for stronger port-stay or itinerary signal.";

  if (score >= IMMEDIATE_TARGET_THRESHOLD) {
    level = "Immediate Candidate";
    urgency = "Now";
    contactWindow = "Contact within 24 hours";
    nextAction = "Prepare UWC outreach now: confirm hull condition, port window, and compliance route.";
  } else if (score >= SALES_CANDIDATE_THRESHOLD) {
    level = "Strong Candidate";
    urgency = "Soon";
    contactWindow = "Contact within 48 hours";
    nextAction = "Send soft check-in: ask for itinerary, hull condition, and next regulated voyage.";
  } else if (score >= REVIEW_TARGET_THRESHOLD) {
    level = "Watch Candidate";
    urgency = "Watch";
    contactWindow = "Review in 3-5 days";
    nextAction = "Keep on watchlist; update score after next AIS/berth/pilot signal.";
  }

  const confidenceInputs = [
    v.vessel_name,
    v.port,
    v.status,
    v.vessel_type,
    v.destination,
    v.operator,
    typeof v.days_in_korea === "number",
    typeof v.speed === "number"
  ].filter(Boolean).length;
  const confidence = Math.min(100, Math.round((confidenceInputs / 8) * 100));

  return {
    cleaning_candidate_score: score,
    cleaning_candidate_level: level,
    contact_urgency: urgency,
    contact_window: contactWindow,
    candidate_next_action: nextAction,
    candidate_reasons: signals.map(s => s.label),
    candidate_confidence: confidence,
    is_cleaning_candidate: score >= SALES_CANDIDATE_THRESHOLD,
    is_immediate_candidate: score >= IMMEDIATE_TARGET_THRESHOLD
  };
}

function buildCandidateSummary(records) {
  const candidates = records.filter(v => v.is_cleaning_candidate);
  const immediate = records.filter(v => v.is_immediate_candidate);
  const strong = records.filter(v => v.cleaning_candidate_score >= SALES_CANDIDATE_THRESHOLD && v.cleaning_candidate_score < IMMEDIATE_TARGET_THRESHOLD);
  const watch = records.filter(v => v.cleaning_candidate_score >= REVIEW_TARGET_THRESHOLD && v.cleaning_candidate_score < SALES_CANDIDATE_THRESHOLD);
  const byPort = new Map();
  for (const v of candidates) {
    const port = v.port || "Unknown";
    const current = byPort.get(port) || { port, total: 0, immediate: 0, strong: 0, watch: 0, top_score: 0 };
    current.total += 1;
    current.immediate += v.is_immediate_candidate ? 1 : 0;
    current.strong += v.cleaning_candidate_score >= SALES_CANDIDATE_THRESHOLD && v.cleaning_candidate_score < IMMEDIATE_TARGET_THRESHOLD ? 1 : 0;
    current.watch += v.cleaning_candidate_score >= REVIEW_TARGET_THRESHOLD && v.cleaning_candidate_score < SALES_CANDIDATE_THRESHOLD ? 1 : 0;
    current.top_score = Math.max(current.top_score, v.cleaning_candidate_score || 0);
    byPort.set(port, current);
  }
  return {
    candidate_count: candidates.length,
    immediate_count: immediate.length,
    strong_count: strong.length,
    watch_count: watch.length,
    top_candidates: candidates
      .slice()
      .sort((a, b) => (b.cleaning_candidate_score || 0) - (a.cleaning_candidate_score || 0))
      .slice(0, 10)
      .map(v => ({
        vessel_name: v.vessel_name,
        port: v.port,
        score: v.cleaning_candidate_score,
        level: v.cleaning_candidate_level,
        contact_window: v.contact_window,
        next_action: v.candidate_next_action,
        reasons: v.candidate_reasons || []
      })),
    port_candidate_summary: [...byPort.values()].sort((a, b) => b.immediate - a.immediate || b.top_score - a.top_score || b.total - a.total),
    operating_rule: "Candidate score prioritizes immediate sales action: waiting/anchorage + long idle + high-value vessel + regulated destination + known operator."
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
  if (/masan|jinhae|마산|진해/.test(text)) return "622";
  if (/samcheonpo|hadong|삼천포|하동/.test(text)) return "622";
  if (/mokpo|목포/.test(text)) return "070";
  if (/gunsan|군산/.test(text)) return "080";
  if (/daesan|대산/.test(text)) return "621";
  if (/donghae|mukho|동해|묵호/.test(text)) return "120";
  if (/jeju|제주/.test(text)) return "940";
  if (/tongyeong|통영/.test(text)) return "622";
  if (/geoje|okpo|거제|옥포/.test(text)) return "622";
  return "unknown";
}
function buildPortIntelligence(records) {
  const byPort = new Map();
  for (const v of records) {
    const portName = v.port || v.port_name || "Unknown";
    const portCode = v.port_code || portCodeFromName(portName);
    const key = portCode !== "unknown" ? portCode : portName;
    const current = byPort.get(key) || {
      port_code: portCode,
      port_name: portName,
      vessel_count: 0,
      scored_count: 0,
      candidate_count: 0,
      immediate_target_count: 0,
      all_vessels: [],
      scored_vessels: [],
      sales_candidates: [],
      immediate_targets: [],
      berths: []
    };
    current.vessel_count += 1;
    current.all_vessels.push(v);
    if (typeof v.total_sales_priority_score === "number") {
      current.scored_count += 1;
      current.scored_vessels.push(v);
    }
    if (isSalesCandidate(v)) {
      current.candidate_count += 1;
      current.sales_candidates.push(v);
    }
    if (isImmediateTarget(v)) {
      current.immediate_target_count += 1;
      current.immediate_targets.push(v);
    }
    if (v.berth) current.berths.push({ berth_name: v.berth, vessel_name: v.vessel_name, status: v.status, eta: v.eta, etd: v.etd });
    byPort.set(key, current);
  }
  return [...byPort.values()].map(port => ({
    ...port,
    all_vessels: sortCommercialPriority(port.all_vessels),
    scored_vessels: sortCommercialPriority(port.scored_vessels),
    sales_candidates: sortCommercialPriority(dedupeCandidateRows(port.sales_candidates)),
    immediate_targets: sortCommercialPriority(dedupeCandidateRows(port.immediate_targets)),
    berths: port.berths.slice(0, 100)
  })).sort((a, b) => b.immediate_target_count - a.immediate_target_count || b.candidate_count - a.candidate_count || b.vessel_count - a.vessel_count);
}

function dataQualityTier(v) {
  const hasSchedule = Boolean(v.eta || v.ata || v.etb || v.atb || v.etd || v.atd || v.berth || v.berth_name);
  if ((v.imo || v.mmsi) && Number(v.gt || 0) > 0 && hasSchedule) return "A";
  if (v.vessel_name && v.call_sign && (v.port_code || v.port) && hasSchedule) return "B";
  if (v.vessel_name && (v.port_code || v.port)) return "C";
  return "D";
}

function buildCandidateList(records = []) {
  return sortCommercialPriority(dedupeCandidateRows(records
    .filter(v => v.actionable_source_row !== false && isSalesCandidate(v))
  ));
}

function buildPortSummary(records) {
  const summary = new Map();
  for (const v of records) {
    const port = v.port || "Unknown";
    const current = summary.get(port) || {
      port,
      total: 0,
      critical: 0,
      high_risk: 0,
      avg_risk: 0,
      waiting: 0,
      at_berth: 0,
      opportunity_usd: 0
    };
    current.total += 1;
    current.critical += (v.risk_score || 0) >= 85 ? 1 : 0;
    current.high_risk += (v.risk_score || 0) >= 70 ? 1 : 0;
    current.waiting += hasAnchorageSignal(v) || /waiting|anchorage|anchor|idle|drifting/i.test(v.status || "") ? 1 : 0;
    current.at_berth += /berth|alongside|moored/i.test(v.status || "") ? 1 : 0;
    current.avg_risk += v.risk_score || 0;
    current.opportunity_usd += v.opportunity_usd || 0;
    summary.set(port, current);
  }
  return [...summary.values()]
    .map(p => ({ ...p, avg_risk: p.total ? Math.round(p.avg_risk / p.total) : 0 }))
    .sort((a, b) => b.critical - a.critical || b.high_risk - a.high_risk || b.opportunity_usd - a.opportunity_usd);
}

function enrichSalesSignals(records) {
  const regulatedDestinations = ["australia", "brazil", "new zealand", "california", "usa", "canada"];
  return records.map(v => {
    const reasons = [];
    const destination = String(v.destination || "").toLowerCase();
    const routeProfile = deriveRouteCommercialProfile(v);
    const complianceWatch = routeProfile.high_regulation_route || regulatedDestinations.some(d => destination.includes(d));
    if ((v.risk_score || 0) >= 85) reasons.push("Critical hull-performance risk");
    else if ((v.risk_score || 0) >= 70) reasons.push("High fouling watchlist");
    if ((v.days_in_korea || 0) >= 14) reasons.push("Long Korea stay / idle exposure");
    if ((v.speed || 0) <= 3) reasons.push("Low-speed or waiting condition");
    if (complianceWatch) reasons.push("Biofouling-sensitive destination");

    const scheduleMetrics = deriveScheduleMetrics(v);
    const gtProfile = commercialGtProfile(v);
    const biofoulingScore = deriveBiofoulingScore(v, scheduleMetrics);
    const ciiPressureScore = deriveCiiPressureScore(v, scheduleMetrics, biofoulingScore);
    const normalizedTypeGroup = v.vessel_type_group || defaultVesselTypeGroup(v);
    const normalizedType = v.vessel_type || (normalizedTypeGroup === "unknown" ? "Unknown" : normalizedTypeGroup);
    const identity = deriveIdentity(v);
    const operatorInfo = inferOperatorInfo({ ...v, ...identity });
    const scoringInput = { ...v, ...operatorInfo, vessel_type: normalizedType, vessel_type_group: normalizedTypeGroup, gt: gtProfile.gt, grtg: gtProfile.grtg, intrlGrtg: gtProfile.intrlGrtg };
    const scoreParts = deriveCommercialScoreParts(scoringInput, scheduleMetrics);
    const commercialValue = deriveCommercialValue({ ...scoringInput, gt_status: gtProfile.gt_status }, scoreParts);
    const dataConfidence = deriveDataConfidence({ ...v, ...operatorInfo, ...gtProfile, ...scoreParts });
    const candidateProfile = buildCandidateProfile({ ...v, ...scheduleMetrics, risk_score: biofoulingScore, compliance_watch: complianceWatch });
    const isSample = String(v.source_mode || "").includes("sample");
    const reasonCodes = [
      ...(v.reason_codes || []),
      ...(scoreParts.score_reason_codes || []),
      ...reasons,
      ...(candidateProfile.candidate_reasons || [])
    ].filter((value, index, arr) => value && arr.indexOf(value) === index);
    const enriched = {
      ...v,
      ...operatorInfo,
      ...gtProfile,
      ...scheduleMetrics,
      ...candidateProfile,
      version: VERSION,
      contact_priority_rank: candidateProfile.is_immediate_candidate ? 1 : candidateProfile.cleaning_candidate_score >= 65 ? 2 : candidateProfile.cleaning_candidate_score >= 45 ? 3 : 9,
      stale_guard: isSample ? "sample_data_do_not_sell_as_live" : "verify_latest_signal_before_outreach",
      data_confidence: isSample ? "sample" : v.actionable_source_row === false ? "movement_only_not_sales_ready" : "source_configured",
      commercial_use_status: isSample ? "do_not_use_for_outreach" : v.actionable_source_row === false ? "not_sales_ready_movement_only" : "sales_review_ready",
      is_operating_candidate: !isSample && v.actionable_source_row !== false && candidateProfile.is_cleaning_candidate,
      is_operating_immediate_candidate: !isSample && v.actionable_source_row !== false && candidateProfile.is_immediate_candidate,
      operating_candidate_score: isSample || v.actionable_source_row === false ? 0 : candidateProfile.cleaning_candidate_score,
      biofouling_score: biofoulingScore,
      cii_pressure_score: ciiPressureScore,
      ...scoreParts,
      ...commercialValue,
      ...dataConfidence,
      risk_level: riskLevel(biofoulingScore),
      sales_priority: candidateProfile.is_immediate_candidate ? "Immediate Candidate" : biofoulingScore >= 85 ? "Critical" : biofoulingScore >= 70 ? "High" : "Normal",
      ...identity,
      data_quality_tier: dataQualityTier({ ...v, ...scheduleMetrics }),
      compliance_band: complianceWatch ? "biosecurity_watch" : "standard",
      port_code: v.port_code || portCodeFromName(v.port),
      port_name: v.port_name || v.port,
      vessel_type: normalizedType,
      vessel_type_group: normalizedTypeGroup,
      dwt: v.dwt || 0,
      loa: v.loa || 0,
      beam: v.beam || 0,
      flag: v.flag || "",
      operator_normalized: operatorInfo.operator_normalized || normalizeCompanyName(v.operator),
      agent_normalized: operatorInfo.agent_normalized || normalizeCompanyName(v.agent),
      destination_port: v.destination_port || v.destination || v.next_port || "",
      berth_name: v.berth_name || v.berth || "",
      anchorage_name: v.anchorage_name || v.anchorage_zone || "",
      excluded_commercial_type: excludedCommercialType(v),
      gt_group: gtGroup(gtProfile.gt),
      stay_days_group: stayDaysGroup(scheduleMetrics.stay_hours),
      reason_codes: reasonCodes,
      sales_reason: reasonCodes,
      compliance_watch: complianceWatch
    };
    enriched.status_bucket = deriveStatusBucket(enriched, scheduleMetrics);
    enriched.commercial_relevance_status = commercialRelevanceStatus(enriched);
    Object.assign(enriched, basicInfoCompleteness(enriched));
    enriched.vessel_spec_enrichment_priority = shouldPrioritizeVesselSpecEnrichment(enriched);
    if (v.actionable_source_row === false) {
      enriched.is_cleaning_candidate = false;
      enriched.is_immediate_candidate = false;
      enriched.cleaning_candidate_score = 0;
      enriched.cleaning_candidate_level = "Monitor";
      enriched.sales_priority = "Movement Only";
      enriched.contact_urgency = "Low";
      enriched.contact_window = "Movement-only; wait for schedule/identity enrichment";
      enriched.reason_codes = [...reasonCodes, "Movement-only AIS/VTS row; not sales-ready without vessel identity and port-call context"];
      enriched.sales_reason = enriched.reason_codes;
      enriched.total_sales_priority_score = 0;
    } else {
      enriched.exclusion_reason = commercialExclusionReason(enriched);
      enriched.is_cleaning_candidate = isSalesCandidate(enriched);
      enriched.is_immediate_candidate = isImmediateTarget(enriched);
      enriched.is_operating_candidate = enriched.is_cleaning_candidate;
      enriched.is_operating_immediate_candidate = enriched.is_immediate_candidate;
      enriched.cleaning_candidate_score = enriched.total_sales_priority_score;
      if (!isMainCommercialVessel(enriched) || !enriched.meets_commercial_gt_threshold) {
        const gtReason = enriched.gt_status === "unknown_gt_review"
          ? "GT_UNKNOWN_NEEDS_VESSEL_SPEC_ENRICHMENT"
          : enriched.commercial_relevance_status === "excluded_non_commercial_type"
            ? "NON_COMMERCIAL_VESSEL_TYPE_EXCLUDED"
            : enriched.commercial_relevance_status === "excluded_departure_only"
              ? "COMPLETED_DEPARTURE_ONLY_EXCLUDED"
              : "GT_BELOW_5000_NOT_COMMERCIAL_TARGET";
        enriched.reason_codes = [...new Set([...(enriched.reason_codes || []), gtReason])];
        enriched.sales_reason = enriched.reason_codes;
        enriched.sales_priority_band = "monitor";
      }
    }
    Object.assign(enriched, deriveOperationalRisk(enriched, scheduleMetrics, biofoulingScore));
    Object.assign(enriched, buildCommercialSignals(enriched, scheduleMetrics));
    Object.assign(enriched, buildImoRecovery(enriched, scheduleMetrics));
    if (enriched.high_value_target && (enriched.congestion_exposed_target || (scheduleMetrics.stay_hours || 0) >= 48)) {
      enriched.total_sales_priority_score = Math.max(enriched.total_sales_priority_score || 0, enriched.congestion_exposed_target ? IMMEDIATE_TARGET_THRESHOLD : SALES_CANDIDATE_THRESHOLD);
      enriched.commercial_value_score = Math.max(enriched.commercial_value_score || 0, enriched.total_sales_priority_score);
      enriched.commercial_value_band = commercialValueBand(enriched.commercial_value_score, enriched.gt_status);
      enriched.cleaning_candidate_score = enriched.total_sales_priority_score;
      enriched.sales_priority_band = enriched.total_sales_priority_score >= IMMEDIATE_TARGET_THRESHOLD ? "immediate_target" : "high_potential";
      enriched.exclusion_reason = commercialExclusionReason(enriched);
      enriched.is_cleaning_candidate = isSalesCandidate(enriched);
      enriched.is_immediate_candidate = isImmediateTarget(enriched);
      enriched.is_operating_candidate = enriched.is_cleaning_candidate;
      enriched.is_operating_immediate_candidate = enriched.is_immediate_candidate;
    }
    if (enriched.commercial_signal_flags?.length) {
      enriched.reason_codes = [...new Set([...(enriched.reason_codes || []), ...enriched.commercial_signal_flags])];
      enriched.sales_reason = enriched.reason_codes;
    }
    enriched.operator_fleet_badges = deriveFleetBadges(enriched);
    Object.assign(enriched, deriveLeadPipelineFields(enriched, scheduleMetrics));
    enriched.recommended_action = enriched.candidate_next_action || recommendedAction(enriched);
    enriched.opportunity_usd = estimateOpportunity(enriched);
    return enriched;
  });
}

function sortCommercialPriority(records) {
  return records.slice().sort((a, b) =>
    Number(b.is_immediate_candidate) - Number(a.is_immediate_candidate) ||
    (b.total_sales_priority_score || 0) - (a.total_sales_priority_score || 0) ||
    (b.congestion_score || b.port_congestion_score || 0) - (a.congestion_score || a.port_congestion_score || 0) ||
    (b.data_confidence_score || 0) - (a.data_confidence_score || 0) ||
    (b.biofouling_score || 0) - (a.biofouling_score || 0) ||
    (b.work_window_hours || 0) - (a.work_window_hours || 0)
  );
}

function candidateDedupeKey(v = {}) {
  const normalizedName = String(v.normalized_vessel_name || v.vessel_name || "")
    .normalize("NFKC")
    .toUpperCase()
    .replace(/[^A-Z0-9가-힣]+/g, "");
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
  const nextScore = Number(next.commercial_value_score || next.total_sales_priority_score || next.cleaning_candidate_score || 0);
  const currentScore = Number(current.commercial_value_score || current.total_sales_priority_score || current.cleaning_candidate_score || 0);
  const nextCongestion = Number(next.congestion_score || next.port_congestion_score || 0);
  const currentCongestion = Number(current.congestion_score || current.port_congestion_score || 0);
  return nextScore > currentScore ||
    (nextScore === currentScore && nextCongestion > currentCongestion) ||
    (nextScore === currentScore && nextCongestion === currentCongestion && Number(next.data_confidence_score || 0) > Number(current.data_confidence_score || 0)) ||
    (nextScore === currentScore && nextCongestion === currentCongestion && Number(next.data_confidence_score || 0) === Number(current.data_confidence_score || 0) && candidateTimestamp(next) > candidateTimestamp(current));
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

function buildHotVessels(records) {
  return sortCommercialPriority(dedupeCandidateRows(records))
    .filter(v => isMainCommercialVessel(v) && (v.is_cleaning_candidate || ["arrived_staying", "berthed", "anchorage_waiting", "arriving_soon"].includes(v.status_bucket) || (v.biofouling_score || 0) >= 65 || (v.operational_risk_score || 0) >= 60))
    .slice(0, 40);
}

function buildCommercialCommandCenter(records) {
  const hot = buildHotVessels(records);
  const missingImo = records.filter(v => v.imo_status && v.imo_status !== "present");
  const imoRecoveryQueue = buildImoRecoveryQueue(records);
  return {
    generated_at: new Date().toISOString(),
    focus_question: "Which vessel should HullWiper Korea contact now, and why?",
    hot_count: hot.length,
    full_count: records.length,
    immediate_targets: hot.filter(v => v.is_immediate_candidate).slice(0, 8),
    operational_risk_queue: sortCommercialPriority(records)
      .filter(v => (v.operational_risk_flags || []).length || (v.operational_risk_score || 0) >= 60)
      .slice(0, 12),
    high_value_targets: buildHighValueTargets(records).slice(0, 12),
    imo_recovery_board: imoRecoveryQueue.slice(0, 12),
    operating_rule: "Load hot vessels first for mobile speed. Load full vessels only when the operator expands the full queue."
  };
}

function buildImoRecoveryQueue(records = []) {
  return records
    .filter(v => !v.imo || v.imo_status !== "present")
    .slice()
    .sort((a, b) =>
      (b.imo_recovery_score || 0) - (a.imo_recovery_score || 0) ||
      (b.gt || 0) - (a.gt || 0) ||
      (b.stay_hours || 0) - (a.stay_hours || 0) ||
      (b.total_sales_priority_score || 0) - (a.total_sales_priority_score || 0)
    )
    .map(v => ({
      vessel_name: v.vessel_name,
      port: v.port,
      port_code: v.port_code,
      gt: v.gt,
      grtg: v.grtg,
      intrlGrtg: v.intrlGrtg,
      call_sign: v.call_sign || v.callsign || null,
      vessel_type: v.vessel_type,
      vessel_type_group: v.vessel_type_group,
      stay_hours: v.stay_hours || 0,
      anchorage_hours: v.anchorage_hours || 0,
      is_anchorage_waiting: Boolean(v.is_anchorage_waiting),
      vessel_master_seed_match: Boolean(v.vessel_master_seed_match),
      imo_recovery_source: v.imo_recovery_source || "",
      hybrid_entity_key: v.hybrid_entity_key,
      identification_method: v.identification_method,
      imo_status: v.imo_status,
      priority: v.imo_recovery_priority,
      imo_recovery_score: v.imo_recovery_score || 0,
      commercial_score: v.total_sales_priority_score || 0,
      reason_codes: v.reason_codes || []
    }));
}

function buildImoRecoveryKpis(records = []) {
  const target = records.filter(isMainCommercialVessel);
  const highValue = target.filter(v => (v.commercial_value_score || v.total_sales_priority_score || 0) >= REVIEW_TARGET_THRESHOLD || Number(v.gt || 0) >= COMMERCIAL_GT_THRESHOLD || v.is_anchorage_waiting);
  const recovered = records.filter(v => v.imo && (v.imo_recovered_from_seed || v.imo_recovered_from_cache || v.vessel_master_seed_match || v.recovery_source));
  const recoveryQueueCount = buildImoRecoveryQueue(target).length;
  const recoveryDenominator = recovered.length + recoveryQueueCount;
  return {
    total_vessels: records.length,
    target_vessels: target.length,
    imo_coverage: coverageRatio(target, v => hasValue(v.imo)),
    high_value_imo_coverage: coverageRatio(highValue, v => hasValue(v.imo)),
    recovered_imo_count: recovered.length,
    imo_recovered_count: recovered.length,
    unresolved_high_value_count: highValue.filter(v => !v.imo).length,
    call_sign_available_count: target.filter(v => hasValue(v.call_sign)).length,
    recovery_queue_count: recoveryQueueCount,
    imo_recovery_queue_count: recoveryQueueCount,
    imo_recovery_success_rate: recoveryDenominator ? Math.round((recovered.length / recoveryDenominator) * 100) : 0,
    call_sign_match_recovery_count: recovered.filter(v => /call.?sign/i.test(String(v.imo_recovery_source || v.identity_match_strategy || ""))).length,
    vessel_name_match_recovery_count: recovered.filter(v => /name|alias|seed/i.test(String(v.imo_recovery_source || v.identity_match_strategy || ""))).length,
    spec_api_recovery_count: recovered.filter(v => /spec/i.test(String(v.imo_recovery_source || v.recovery_source || ""))).length
  };
}

function buildHighValueTargets(records = []) {
  return sortCommercialPriority(records)
    .filter(v => v.high_value_target || (Number(v.gt || 0) >= 30000 && /bulk|bulk_carrier|tanker|pctc/.test(String(v.vessel_type_group || v.vessel_type || "").toLowerCase())))
    .map(v => ({
      vessel_name: v.vessel_name,
      port: v.port,
      port_code: v.port_code,
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

function buildUnknownGtReview(records = []) {
  return sortCommercialPriority(records)
    .filter(v => v.gt_status === "unknown_gt_review" && v.commercial_relevance_status === "unknown_gt_review")
    .map(v => ({
      vessel_name: v.vessel_name,
      port: v.port,
      port_code: v.port_code,
      call_sign: v.call_sign || "",
      vessel_type: v.vessel_type,
      vessel_type_group: v.vessel_type_group,
      status_bucket: v.status_bucket,
      berth_name: v.berth_name || "",
      anchorage_name: v.anchorage_name || "",
      commercial_value_score: v.commercial_value_score || 0,
      data_confidence_score: v.data_confidence_score || 0,
      reason_codes: v.reason_codes || []
    }));
}

function buildHighValueLowConfidence(records = []) {
  return sortCommercialPriority(records)
    .filter(v => (v.commercial_value_score || 0) >= REVIEW_TARGET_THRESHOLD && ((v.data_confidence_score || 0) < 60 || !v.imo))
    .map(v => ({
      vessel_name: v.vessel_name,
      port: v.port,
      port_code: v.port_code,
      gt: v.gt,
      imo: v.imo || "",
      call_sign: v.call_sign || "",
      vessel_type: v.vessel_type,
      vessel_type_group: v.vessel_type_group,
      commercial_value_score: v.commercial_value_score || 0,
      commercial_value_band: v.commercial_value_band,
      data_confidence_score: v.data_confidence_score || 0,
      data_confidence_band: v.data_confidence_band,
      review_reason: !v.imo ? "missing_imo" : !v.gt ? "missing_gt" : "weak_identity",
      reason_codes: v.reason_codes || []
    }));
}

function buildCongestionWatchlist(records = []) {
  return sortCommercialPriority(records)
    .filter(v => v.is_anchorage_waiting || hasAnchorageSignal(v) || v.congestion_exposed_target || (v.congestion_exposure_score || 0) >= 8 || (v.anchorage_hours || 0) >= 6)
    .map(v => ({
      vessel_name: v.vessel_name,
      port: v.port,
      port_code: v.port_code,
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

function buildAgentFollowupQueue(records = []) {
  return sortCommercialPriority(records)
    .filter(v => v.agent && (!v.operator || !v.imo || (v.data_confidence_score || 0) < 70))
    .map(v => ({
      vessel_name: v.vessel_name,
      port: v.port,
      port_code: v.port_code,
      agent: v.agent,
      operator: v.operator || "",
      imo: v.imo || "",
      call_sign: v.call_sign || "",
      commercial_value_score: v.commercial_value_score || 0,
      data_confidence_score: v.data_confidence_score || 0,
      next_action: "Confirm IMO/operator and cleaning decision path via local agent.",
      reason_codes: v.reason_codes || []
    }));
}

function buildScoringDiagnostics(records = []) {
  const buckets = {
    score_0_20: 0,
    score_20_35: 0,
    score_35_60: 0,
    score_60_80: 0,
    score_80_90: 0,
    score_90_plus: 0
  };
  for (const v of records) {
    const score = Number(v.commercial_value_score || v.total_sales_priority_score || v.cleaning_candidate_score || 0);
    if (score < 20) buckets.score_0_20 += 1;
    else if (score < REVIEW_TARGET_THRESHOLD) buckets.score_20_35 += 1;
    else if (score < SALES_CANDIDATE_THRESHOLD) buckets.score_35_60 += 1;
    else if (score < IMMEDIATE_TARGET_THRESHOLD) buckets.score_60_80 += 1;
    else if (score < CRITICAL_TARGET_THRESHOLD) buckets.score_80_90 += 1;
    else buckets.score_90_plus += 1;
  }
  buckets.score_35_50 = buckets.score_35_60;
  buckets.score_50_75 = buckets.score_60_80;
  buckets.score_75_plus = buckets.score_80_90 + buckets.score_90_plus;
  const highScoreRows = records.filter(v => Number(v.commercial_value_score || v.total_sales_priority_score || 0) >= SALES_CANDIDATE_THRESHOLD);
  const exclusionReasonCounts = {};
  for (const v of highScoreRows) {
    if (isSalesCandidate(v)) continue;
    const reason = commercialExclusionReason(v) || v.exclusion_reason || "unknown";
    exclusionReasonCounts[reason] = (exclusionReasonCounts[reason] || 0) + 1;
  }
  return {
    total_collected: records.length,
    target_vessels_5000gt_plus: records.filter(v => Number(v.gt || v.grtg || v.intrlGrtg || 0) >= COMMERCIAL_GT_THRESHOLD).length,
    ...buckets,
    review_target_threshold: REVIEW_TARGET_THRESHOLD,
    sales_candidate_threshold: SALES_CANDIDATE_THRESHOLD,
    immediate_target_threshold: IMMEDIATE_TARGET_THRESHOLD,
    high_score_not_promoted_count: highScoreRows.filter(v => !isSalesCandidate(v)).length,
    candidate_promotion_error: highScoreRows.some(v => !isSalesCandidate(v) && !commercialExclusionReason(v) && !v.exclusion_reason),
    exclusion_reason_counts: exclusionReasonCounts,
    missing_gt_count: records.filter(v => !Number(v.gt || v.grtg || v.intrlGrtg || 0)).length,
    missing_imo_count: records.filter(v => !v.imo).length,
    anchorage_detected_count: records.filter(v => v.is_anchorage_waiting || hasAnchorageSignal(v) || Number(v.anchorage_hours || 0) > 0).length,
    stay_hours_detected_count: records.filter(v => Number(v.stay_hours || v.current_call_stay_hours || v.planned_stay_hours || 0) > 0).length,
    work_window_detected_count: records.filter(v => Number(v.work_window_hours || 0) > 0 || v.work_window_status === "open_or_ongoing").length,
    eta_detected_count: records.filter(v => v.eta).length,
    etb_detected_count: records.filter(v => v.etb).length,
    ata_detected_count: records.filter(v => v.ata).length,
    atb_detected_count: records.filter(v => v.atb).length,
    etd_detected_count: records.filter(v => v.etd).length,
    atd_detected_count: records.filter(v => v.atd).length,
    detail_rows_flattened_count: records.filter(v => v.detail_rows_flattened).length,
    detail_rows_missing_time_count: records.filter(v => v.detail_rows_flattened && !v.eta && !v.etd && !v.ata && !v.atd && !v.etb && !v.atb).length,
    vessel_type_group_detected_count: records.filter(v => v.vessel_type_group && v.vessel_type_group !== "unknown").length,
    congestion_score_calculated_count: records.filter(v => deriveCongestionScore(v, v) > 0).length,
    congestion_score_zero_but_stay_exists_count: records.filter(v => (Number(v.stay_hours || v.current_call_stay_hours || v.cumulative_stay_hours || 0) > 0 || Number(v.anchorage_hours || 0) > 0) && deriveCongestionScore(v, v) <= 0).length,
    anchorage_hours_detected_count: records.filter(v => Number(v.anchorage_hours || 0) > 0).length,
    biofouling_score_nonzero_count: records.filter(v => Number(v.biofouling_risk_score || v.biofouling_score || 0) > 0).length,
    cii_score_nonzero_count: records.filter(v => Number(v.cii_pressure_score || v.compliance_pressure_score || 0) > 0).length,
    performance_proxy_nonzero_count: records.filter(v => Number(v.performance_proxy_score || 0) > 0).length,
    commercial_value_score_nonzero_count: records.filter(v => Number(v.commercial_value_score || v.total_sales_priority_score || 0) > 0).length,
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
    prediction_error_measured_count: records.filter(v => Number.isFinite(Number(v.prediction_error_hours))).length,
    high_route_commercial_weight_count: records.filter(v => Number(v.route_commercial_weight || 0) >= 8).length,
    vsslKndCd_coverage: coverageRatio(records, v => hasValue(v.vsslKndCd)),
    vsslKndNm_coverage: coverageRatio(records, v => hasValue(v.vsslKndNm)),
    vessel_type_unknown_count: records.filter(v => !v.vessel_type_group || v.vessel_type_group === "unknown" || !v.vessel_type || String(v.vessel_type).toLowerCase() === "unknown").length,
    commercial_segment_coverage: coverageRatio(records, v => hasValue(v.commercial_segment)),
    secondary_enrichment_matched_count: records.filter(v => v.secondary_enrichment_matched || v.cargo_harbor_use_enriched).length,
    berth_enrichment_match_rate: coverageRatio(records, v => v.secondary_enrichment_matched || v.cargo_harbor_use_enriched)
  };
}

function buildOperatorDiagnostics(records = [], salesCandidates = [], immediateTargets = []) {
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
    candidates_with_operator_count: salesCandidates.filter(v => hasValue(v.operator_name || v.operator)).length,
    candidates_with_agent_count: salesCandidates.filter(v => hasValue(v.agent_name || v.agent)).length,
    immediate_targets_with_contact_path_count: immediateTargets.filter(v => v.contact_path_available || hasValue(v.operator_name || v.operator) || hasValue(v.agent_name || v.agent)).length,
    contact_ready_count: records.filter(v => Number(v.contact_readiness_score || 0) >= 50 || v.contact_path_available).length,
    candidates_contact_ready_count: salesCandidates.filter(v => Number(v.contact_readiness_score || 0) >= 50 || v.contact_path_available).length
  };
}

function buildCountFunnel({ rawRecords = [], allCollected = [], targetVessels = [], salesCandidates = [], immediateTargets = [], collectorDiagnostics = {} } = {}) {
  const uniquePortCalls = new Set(allCollected.map(v => v.port_call_identity || v.snapshot_key || `${v.port_code || v.port}|${v.vessel_name}|${v.ata || v.eta || ""}`).filter(Boolean));
  const uniqueVessels = new Set(allCollected.map(v => v.vessel_identity || v.master_vessel_id || v.imo || v.mmsi || v.call_sign || `${v.vessel_name}|${v.gt}|${v.vessel_type}`).filter(Boolean));
  const collectorFunnel = collectorDiagnostics.count_funnel || {};
  return {
    raw_api_rows: collectorFunnel.raw_api_rows ?? rawRecords.length,
    detail_rows_flattened: collectorFunnel.detail_rows_flattened ?? rawRecords.filter(v => v.detail_rows_flattened).length,
    normalized_rows: collectorFunnel.normalized_rows ?? rawRecords.length,
    duplicate_raw_rows: collectorFunnel.duplicate_raw_rows ?? 0,
    unique_port_calls: collectorFunnel.unique_port_calls ?? uniquePortCalls.size,
    unique_vessels: collectorFunnel.unique_vessels ?? uniqueVessels.size,
    target_vessels_5000gt_plus: targetVessels.filter(v => Number(v.gt || v.grtg || v.intrlGrtg || 0) >= COMMERCIAL_GT_THRESHOLD).length,
    unknown_gt_review: targetVessels.filter(v => v.gt_status === "unknown_gt_review").length,
    excluded_under_5000gt: allCollected.filter(v => {
      const gt = Number(v.gt || v.grtg || v.intrlGrtg || 0);
      return gt > 0 && gt < COMMERCIAL_GT_THRESHOLD;
    }).length,
    sales_candidates: salesCandidates.length,
    immediate_targets: immediateTargets.length,
    capped_by_limit: Boolean(collectorFunnel.capped_by_limit || targetVessels.length > MAX_TARGET_VESSELS || salesCandidates.length > MAX_CANDIDATES),
    cap_name: collectorFunnel.cap_name || (targetVessels.length > MAX_TARGET_VESSELS ? "MAX_TARGET_VESSELS" : salesCandidates.length > MAX_CANDIDATES ? "MAX_CANDIDATES" : null),
    cap_value: collectorFunnel.cap_value || (targetVessels.length > MAX_TARGET_VESSELS ? MAX_TARGET_VESSELS : salesCandidates.length > MAX_CANDIDATES ? MAX_CANDIDATES : null)
  };
}

function coverageRatio(records = [], predicate = () => false) {
  if (!records.length) return 0;
  return Math.round((records.filter(predicate).length / records.length) * 100);
}

function buildBasicInfoCoverage(records = []) {
  return {
    generated_at: new Date().toISOString(),
    total_vessels: records.length,
    average_completeness_score: records.length
      ? Math.round(records.reduce((sum, v) => sum + Number(v.vessel_basic_info_completeness_score || 0), 0) / records.length)
      : 0,
    vessel_name_coverage: coverageRatio(records, v => hasValue(v.vessel_name)),
    call_sign_coverage: coverageRatio(records, v => hasValue(v.call_sign)),
    gt_coverage: coverageRatio(records, v => hasValue(v.gt || v.grtg || v.intrlGrtg)),
    vessel_type_coverage: coverageRatio(records, v => hasValue(v.vessel_type_group) && v.vessel_type_group !== "unknown"),
    imo_coverage: coverageRatio(records, v => hasValue(v.imo)),
    mmsi_coverage: coverageRatio(records, v => hasValue(v.mmsi)),
    operator_coverage: coverageRatio(records, v => hasValue(v.operator)),
    agent_coverage: coverageRatio(records, v => hasValue(v.agent)),
    loa_beam_coverage: coverageRatio(records, v => hasValue(v.loa) && hasValue(v.beam)),
    dwt_coverage: coverageRatio(records, v => hasValue(v.dwt)),
    prioritized_vessel_spec_enrichment_count: records.filter(shouldPrioritizeVesselSpecEnrichment).length,
    field_weights: BASIC_INFO_FIELDS
  };
}

function buildBasicInfoMissingReview(records = []) {
  return sortCommercialPriority(records)
    .filter(v => isMainCommercialVessel(v) && ((v.vessel_basic_info_completeness_score || 0) < 75 || shouldPrioritizeVesselSpecEnrichment(v)))
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
      vessel_basic_info_completeness_score: v.vessel_basic_info_completeness_score || 0,
      missing_fields: v.vessel_basic_info_missing_fields || [],
      vessel_spec_enrichment_priority: Boolean(v.vessel_spec_enrichment_priority),
      enrichment_reason: shouldPrioritizeVesselSpecEnrichment(v) ? "prioritized_for_vessel_spec_or_manual_identity_enrichment" : "basic_info_incomplete",
      reason_codes: v.reason_codes || []
    }));
}

function buildPortCongestionHeatmap(records) {
  const ports = new Map();
  for (const v of records) {
    const port = v.port || "Unknown";
    const current = ports.get(port) || {
      port,
      port_code: v.port_code || portCodeFromName(port),
      total: 0,
      waiting: 0,
      anchorage_vessels: 0,
      long_stay: 0,
      long_idle_vessels: 0,
      high_biofouling: 0,
      immediate: 0,
      score: 0,
      waiting_hours_total: 0,
      berth_hours_total: 0
    };
    current.total += 1;
    if (v.is_anchorage_waiting || (v.anchorage_hours || 0) >= 12 || /waiting|anchorage|anchor|idle|drifting/i.test(v.status || "")) {
      current.waiting += 1;
      current.anchorage_vessels += 1;
    }
    if (v.is_long_idle || (v.stay_hours || 0) >= 168) {
      current.long_stay += 1;
      current.long_idle_vessels += 1;
    }
    if ((v.biofouling_score || 0) >= 70) current.high_biofouling += 1;
    if (v.is_immediate_candidate) current.immediate += 1;
    current.waiting_hours_total += Number(v.anchorage_hours || 0);
    current.berth_hours_total += Number(v.berth_hours || 0);
    current.score += Math.min(100, (v.port_congestion_score || v.operational_risk_score || 0) + (v.is_immediate_candidate ? 15 : 0));
    ports.set(port, current);
  }
  return [...ports.values()]
    .map(p => ({
      ...p,
      average_waiting_time: p.waiting ? Math.round((p.waiting_hours_total / p.waiting) * 10) / 10 : 0,
      berth_occupancy: p.total ? Math.min(100, Math.round((p.berth_hours_total / Math.max(1, p.total * 24)) * 100)) : 0,
      anchorage_density: p.total ? Math.min(100, Math.round((p.anchorage_vessels / p.total) * 100)) : 0,
      congestion_score: p.total ? Math.min(100, Math.round(p.score / p.total + p.waiting * 4 + p.long_stay * 5 + p.immediate * 8)) : 0
    }))
    .sort((a, b) => b.congestion_score - a.congestion_score || b.immediate - a.immediate || b.high_biofouling - a.high_biofouling);
}

function buildPortAnchorage(records, portCode) {
  const rows = records.filter(v => String(v.port_code || portCodeFromName(v.port)) === String(portCode));
  return sortCommercialPriority(rows.filter(v => v.is_anchorage_waiting || (v.anchorage_hours || 0) > 0 || /waiting|anchorage|anchor|idle|drifting/i.test(v.status || "")))
    .map(v => ({
      vessel_id: v.vessel_id,
      vessel_name: v.vessel_name,
      port_code: v.port_code || portCode,
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

function buildBiofoulingTimeline(records) {
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
    const rows = records.filter(v => {
      const hours = Number(v.stay_hours || 0);
      return hours >= bucket.min && hours < bucket.max;
    });
    return {
      ...bucket,
      count: rows.length,
      high_biofouling: rows.filter(v => (v.biofouling_score || 0) >= 70).length,
      immediate: rows.filter(v => v.is_immediate_candidate).length,
      avg_biofouling_score: rows.length
        ? Math.round(rows.reduce((sum, v) => sum + (v.biofouling_score || 0), 0) / rows.length)
        : 0
    };
  });
}

function buildDataStrategy(apiSources = []) {
  const enabled = new Set(apiSources.filter(s => s.enabled).map(s => s.key));
  const publicGroups = ["source_csv", "vessel_spec", "pilot_sources", "berth_sources", "port_facility", "port_operation", "ulsan_core", "mof_vts", "mof_ais_dynamic", "mof_ais_info", "mof_ais_stat", "korea_public_data"];
  const paidGroups = ["marine_traffic", "vesselfinder", "aisstream"];
  const publicEnabled = publicGroups.filter(k => enabled.has(k));
  const paidEnabled = paidGroups.filter(k => enabled.has(k));
  return {
    mode: "public_data_first",
    principle: "Use Korean public/port/MOF sources as the operating base. Treat MarineTraffic/VesselFinder/AISStream as optional paid enrichment, not a blocker.",
    public_enabled_count: publicEnabled.length,
    paid_enabled_count: paidEnabled.length,
    public_enabled: publicEnabled,
    paid_enabled: paidEnabled,
    priority_ports: PRIORITY_PORTS,
    vts_architecture: "Integrated VTS / national vessel traffic layer. Yeosu is one monitored area, not the core architecture.",
    source_priority: [
      "PORT-MIS / Korean port call APIs",
      "Major port berth allocation data",
      "Integrated VTS / national vessel traffic information",
      "Public vessel specification data",
      "Manual correction CSV"
    ],
    next_focus: [
      "Normalize vessel identity across port, berth, VTS and AIS feeds",
      "Accumulate daily snapshots in Supabase for idle-time and port-stay history",
      "Keep paid AIS integrations disabled unless a customer requires global real-time coverage"
    ]
  };
}


function buildDataQuality(records, apiSources = []) {
  const enabledSources = apiSources.filter(s => s.enabled).length;
  const total = records.length;
  const missing = {
    vessel_name: records.filter(v => !v.vessel_name).length,
    port: records.filter(v => !v.port).length,
    operator: records.filter(v => !v.operator).length,
    destination: records.filter(v => !v.destination).length,
    updated_at: records.filter(v => !v.updated_at).length,
    risk_score: records.filter(v => typeof v.risk_score !== "number").length
  };
  const duplicates = (() => {
    const seen = new Set();
    let count = 0;
    for (const v of records) {
      const key = [v.vessel_id || v.imo || v.mmsi || v.vessel_name, v.port].join("|").toLowerCase();
      if (!key.trim()) continue;
      if (seen.has(key)) count += 1;
      seen.add(key);
    }
    return count;
  })();
  const completenessFields = Object.keys(missing);
  const possible = Math.max(1, total * completenessFields.length);
  const missingTotal = Object.values(missing).reduce((a, b) => a + b, 0);
  const completeness = Math.max(0, Math.round(((possible - missingTotal) / possible) * 100));
  const riskCoverage = total ? Math.round((records.filter(v => typeof v.risk_score === "number").length / total) * 100) : 0;
  const sourceCoverage = Math.min(100, Math.round((enabledSources / 8) * 100));
  const score = Math.round((completeness * 0.55) + (riskCoverage * 0.25) + (sourceCoverage * 0.20));
  const issues = [];
  if (total === 0) issues.push("No vessel records generated");
  if (duplicates > 0) issues.push(`${duplicates} duplicate vessel/port row(s) detected`);
  if (missing.operator > 0) issues.push(`${missing.operator} record(s) missing operator`);
  if (missing.destination > 0) issues.push(`${missing.destination} record(s) missing destination`);
  if (enabledSources < 3) issues.push("Low configured source coverage; public API keys may still be missing");
  return {
    score,
    grade: score >= 85 ? "Good" : score >= 70 ? "Watch" : "Needs Cleanup",
    record_count: total,
    enabled_source_groups: enabledSources,
    completeness_percent: completeness,
    risk_coverage_percent: riskCoverage,
    source_coverage_percent: sourceCoverage,
    duplicate_count: duplicates,
    missing_fields: missing,
    issues,
    next_cleanup_focus: issues.length ? issues.slice(0, 4) : ["Start historical trend comparison", "Add vessel identity merge rules", "Validate port-stay duration with AIS/VTS snapshots"]
  };
}

function buildDataMode(records, apiSources = [], supabaseStatus = "not_configured") {
  const enabledSources = apiSources.filter(s => s.enabled);
  const fallbackUsed = Boolean(getCollectorDiagnostics()?.fallback_used);
  const sampleRows = records.filter(v => String(v.source_mode || "").includes("sample")).length;
  const actionableRows = records.filter(v => v.actionable_source_row && !String(v.source_mode || "").includes("sample")).length;
  const apiReadyRows = records.filter(v => Array.isArray(v.api_ready) && v.api_ready.length > 0).length;
  const mode = !records.length ? "no_live_data" : fallbackUsed ? "degraded_sample_only" : apiReadyRows > 0 ? "api_ready_snapshot" : "static_snapshot";
  const label = mode === "no_live_data" ? "NO LIVE DATA" : mode === "degraded_sample_only" ? "DEGRADED SAMPLE ONLY" : mode === "api_ready_snapshot" ? "API READY SNAPSHOT" : "STATIC SNAPSHOT";
  const liveReady = !fallbackUsed && enabledSources.length > 0 && sampleRows < records.length && supabaseStatus === "synced";
  const commercialUseStatus = !records.length ? "not_ready" : actionableRows > 0 ? "review_required" : "not_ready";
  return {
    mode,
    label,
    live_ready: liveReady,
    sample_rows: sampleRows,
    real_rows: Math.max(0, records.length - sampleRows),
    actionable_rows: actionableRows,
    enabled_source_groups: enabledSources.map(s => s.key),
    supabase_status: supabaseStatus,
    fallback_used: fallbackUsed,
    commercial_use_status: commercialUseStatus,
    message: mode === "no_live_data"
      ? "No live vessel rows were collected. Showing diagnostics only; no synthetic vessels or sales candidates are generated."
      : mode === "degraded_sample_only"
        ? "Collector fallback was triggered. Synthetic candidates are disabled; investigate collector diagnostics."
      : actionableRows > 0
        ? "Live public source rows were collected. Verify freshness and source diagnostics before outreach."
        : "Rows were collected, but none are commercially actionable yet. Show diagnostics and continue normalization.",
    weight_policy: {
      current_track: "live_public_data_first",
      keep_repository_light: ["Do not commit node_modules", "Do not commit heavy raw archives", "Keep daily JSON snapshots small", "Archive bulky raw data to Google Drive/Supabase"],
      next_build_focus: ["collector normalization", "public API smoke tests", "Supabase history accumulation"]
    }
  };
}

function buildCollectorReadiness(apiSources = []) {
  const enabled = new Set(apiSources.filter(s => s.enabled).map(s => s.key));
  const groups = [
    {
      phase: "Phase 1",
      name: "Korea port-call base layer",
      sources: ["port_operation", "berth_sources", "pilot_sources"],
      goal: "Confirm arrivals, berth assignment, waiting status, and port-call timing without paid AIS."
    },
    {
      phase: "Phase 2",
      name: "Vessel identity enrichment",
      sources: ["vessel_spec", "mof_ais_info", "port_facility"],
      goal: "Normalize IMO/MMSI, vessel type, size class, operator, and target segment."
    },
    {
      phase: "Phase 3",
      name: "Movement / idle-time signals",
      sources: ["mof_vts", "mof_ais_dynamic", "ulsan_core"],
      goal: "Detect anchorage, low speed, long stay, berth shifts, and port congestion signals."
    },
    {
      phase: "Phase 4",
      name: "Trend and reporting history",
      sources: ["supabase", "google_drive"],
      goal: "Accumulate daily snapshots for sales timing, repeat calls, and pipeline reporting."
    },
    {
      phase: "Optional",
      name: "Paid AIS enrichment",
      sources: ["marine_traffic", "vesselfinder", "aisstream"],
      goal: "Use only when global real-time coverage becomes commercially justified."
    }
  ];
  return groups.map(group => {
    const active = group.sources.filter(s => enabled.has(s));
    const readiness = Math.round((active.length / group.sources.length) * 100);
    return {
      ...group,
      active_sources: active,
      missing_sources: group.sources.filter(s => !enabled.has(s)),
      readiness_percent: readiness,
      status: readiness === 100 ? "ready" : readiness > 0 ? "partial" : "waiting"
    };
  });
}


function buildCollectorManifest(apiSources = []) {
  const byKey = Object.fromEntries(apiSources.map(s => [s.key, s]));
  const definitions = [
    {
      collector: "port-operation-base",
      priority: 1,
      source_keys: ["port_operation", "korea_public_data"],
      output: "port_calls",
      weight: "light",
      business_use: "Korea arrivals/departures, port-call timing, and initial sales target discovery."
    },
    {
      collector: "berth-and-pilot-watch",
      priority: 2,
      source_keys: ["berth_sources", "pilot_sources", "ulsan_core"],
      output: "berth_watch",
      weight: "light_to_medium",
      business_use: "Berth assignment, waiting status, terminal movement, and short-window outreach timing."
    },
    {
      collector: "mof-ais-snapshot",
      priority: 3,
      source_keys: ["mof_ais_dynamic", "mof_ais_info", "mof_vts"],
      output: "ais_snapshot",
      weight: "medium",
      business_use: "Low-speed, anchorage, idle-time and movement confirmation without paid AIS dependency."
    },
    {
      collector: "vessel-master-enrichment",
      priority: 4,
      source_keys: ["vessel_spec", "mof_ais_info", "port_facility"],
      output: "vessel_master",
      weight: "light",
      business_use: "Vessel type, size class, identity merge, and opportunity segmentation."
    },
    {
      collector: "history-archive",
      priority: 5,
      source_keys: ["supabase", "google_drive"],
      output: "daily_history",
      weight: "external_storage",
      business_use: "Keep GitHub light while accumulating repeated snapshots for port-stay and lead history."
    },
    {
      collector: "paid-ais-enrichment",
      priority: 9,
      source_keys: ["marine_traffic", "vesselfinder", "aisstream"],
      output: "paid_ais_overlay",
      weight: "optional_paid",
      business_use: "Commercial-only enrichment when a customer or pilot project requires global real-time coverage."
    }
  ];

  return definitions.map(def => {
    const enabled = def.source_keys.filter(k => byKey[k]?.enabled);
    const partial = def.source_keys.filter(k => byKey[k]?.partial);
    const readiness = Math.round((enabled.length / def.source_keys.length) * 100);
    return {
      ...def,
      enabled_sources: enabled,
      partial_sources: partial,
      missing_sources: def.source_keys.filter(k => !byKey[k]?.enabled),
      readiness_percent: readiness,
      status: readiness === 100 ? "ready" : readiness > 0 || partial.length ? "partial" : "waiting",
      next_action: readiness === 100
        ? "Run a smoke test and inspect normalized output rows."
        : `Configure or validate: ${def.source_keys.filter(k => !byKey[k]?.enabled).join(", ")}`
    };
  });
}

function buildSourceRegistry(apiSources = []) {
  const enabled = apiSources.filter(s => s.enabled);
  const partial = apiSources.filter(s => s.partial);
  const publicKeys = ["vessel_spec", "pilot_sources", "berth_sources", "port_facility", "port_operation", "ulsan_core", "mof_vts", "mof_ais_dynamic", "mof_ais_info", "mof_ais_stat", "korea_public_data"];
  const storageKeys = ["supabase", "google_drive"];
  const paidKeys = ["marine_traffic", "vesselfinder", "aisstream"];
  const groupCount = keys => enabled.filter(s => keys.includes(s.key)).length;
  return {
    registry_version: "source-registry-v16.5",
    total_groups: apiSources.length,
    enabled_groups: enabled.length,
    partial_groups: partial.length,
    public_enabled_groups: groupCount(publicKeys),
    storage_enabled_groups: groupCount(storageKeys),
    paid_enabled_groups: groupCount(paidKeys),
    operating_posture: groupCount(publicKeys) >= 3 ? "public_data_ready" : groupCount(publicKeys) > 0 ? "public_data_partial" : "no_live_data",
    weight_guidance: "Keep collector outputs small in GitHub. Store raw/heavy archive data in Supabase or Google Drive.",
    immediate_focus: groupCount(publicKeys) >= 3
      ? "Start collector smoke tests and normalization rules."
      : "Add or verify Korean public/port/MOF API secrets before expanding UI features."
  };
}

function buildCloudMasterDbStrategy(records = [], apiSources = [], supabaseStatus = "not_configured") {
  const enabled = new Set(apiSources.filter(s => s.enabled).map(s => s.key));
  const hasSupabase = enabled.has("supabase") || Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
  const hasGDrive = enabled.has("google_drive") || Boolean(process.env.GDRIVE_SERVICE_ACCOUNT_JSON || process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  const currentMode = hasSupabase ? "supabase_ready" : hasGDrive ? "archive_ready" : "local_snapshot_only";
  const masterTables = [
    { table: "vessel_master", role: "One row per vessel identity", key: "imo / mmsi / normalized vessel_name", weight: "light", priority: 1 },
    { table: "port_call_events", role: "Arrival, berth, pilot, departure and status events", key: "event_id / vessel_id / port / timestamp", weight: "medium", priority: 2 },
    { table: "daily_vessel_snapshots", role: "Daily accumulated operating snapshot for idle-time and trend analysis", key: "snapshot_date / vessel_id / port", weight: "medium", priority: 3 },
    { table: "risk_scores", role: "Biofouling, idle, compliance and sales opportunity scoring history", key: "snapshot_date / vessel_id / model_version", weight: "light", priority: 4 },
    { table: "source_health", role: "API success, failure, fallback and last-sync telemetry", key: "source_key / run_id", weight: "light", priority: 5 },
    { table: "raw_archive_index", role: "Pointer table for heavy raw files stored outside GitHub", key: "source_key / date / storage_uri", weight: "index_only", priority: 6 }
  ];
  return {
    strategy_version: "cloud-master-db-v16.5",
    current_mode: currentMode,
    supabase_status: supabaseStatus,
    record_count_this_run: records.length,
    principle: "Use GitHub only for code and small dashboard snapshots. Use Supabase as the queryable master DB and Google Drive/Object Storage as the raw archive layer.",
    recommended_architecture: [
      "Collectors fetch public/port/MOF data on schedule",
      "Normalizer maps each source into common vessel, port-call and event fields",
      "Supabase stores normalized master tables and daily snapshots",
      "Raw bulky payloads are archived externally and referenced by URI",
      "Dashboard reads compact JSON exports or direct Supabase views"
    ],
    master_tables: masterTables,
    accumulation_policy: {
      daily_snapshot: "append-only by date; never overwrite historical rows",
      vessel_master: "upsert by IMO/MMSI/name identity confidence",
      port_call_events: "append events, then deduplicate by source + vessel + port + timestamp window",
      raw_data: "store only compressed/raw archive pointers in DB; do not commit raw bulk to GitHub",
      retention: "keep lightweight dashboard JSON in repo, keep full historical archive in cloud storage"
    },
    development_order: [
      "Create Supabase master tables and indexes",
      "Add idempotent upsert/append writers for normalized rows",
      "Add source_health logging for every collector run",
      "Generate dashboard/api/*.json from Supabase views",
      "Backfill history gradually from existing data/history snapshots"
    ],
    readiness: {
      supabase_ready: hasSupabase,
      archive_ready: hasGDrive,
      can_accumulate_history: hasSupabase,
      github_weight_safe: true
    }
  };
}

function buildNextDevelopmentPlan(reportBase, apiSources = []) {
  const enabled = apiSources.filter(s => s.enabled).map(s => s.key);
  const plan = [];
  plan.push({ step: 1, title: "Keep build lightweight", detail: "Do not add heavy raw archives to GitHub. Keep dashboard JSON small and push raw/history data to Supabase or GDrive." });
  plan.push({ step: 2, title: "Connect public collectors first", detail: "Prioritize PORT_OPERATION, BERTH/PILOT URLs, MOF AIS/VTS and Ulsan sources before paid AIS." });
  plan.push({ step: 3, title: "Normalize live rows", detail: "No synthetic vessels are allowed. Next work is source-specific normalization, duplicate control, and actionable-field coverage." });
  plan.push({ step: 4, title: "Build cloud master DB", detail: enabled.includes("supabase") ? "Supabase is available; next step is normalized master tables and append-only daily snapshots." : "Add/verify Supabase credentials before relying on accumulated DB history." });
  plan.push({ step: 5, title: "Separate master DB from raw archive", detail: "Supabase should store queryable normalized data; Google Drive/Object Storage should hold heavy raw payloads and source files." });
  return plan;
}

function buildReleaseCadence() {
  return {
    cadence_version: "major-bundle-v17.7",
    policy: "Bundle five to seven small improvements into one stable minor build instead of releasing every tiny patch.",
    current_bundle: [
      "GitHub Actions trigger fix and scheduled update stabilization",
      "Candidate detection/change tracker guardrails",
      "Backend snapshot and cloud master DB operating guidance"
    ],
    next_bundle_rule: "Only cut the next minor build after 5-7 meaningful backend/data improvements are ready, unless a blocking hotfix is required.",
    hotfix_rule: "Use patch-only release when GitHub Actions, build, validation, or dashboard rendering is broken.",
    stability_guardrails: [
      "Keep node_modules out of GitHub",
      "Keep heavy raw data out of GitHub",
      "Use public/MOF/port APIs before paid AIS",
      "Do not publish synthetic/sample vessels as commercial candidates",
      "Show candidate numbers only with source and freshness context"
    ]
  };
}

function buildCandidateOps(records = [], reportBase = {}) {
  const candidates = records
    .filter(v => v.is_operating_candidate || (v.is_cleaning_candidate && v.commercial_use_status !== "do_not_use_for_outreach"))
    .slice()
    .sort((a, b) => (a.contact_priority_rank || 9) - (b.contact_priority_rank || 9) || (b.operating_candidate_score || b.cleaning_candidate_score || 0) - (a.operating_candidate_score || a.cleaning_candidate_score || 0));
  const immediate = candidates.filter(v => v.is_operating_immediate_candidate || v.is_immediate_candidate);
  const confidenceBuckets = {
    high: candidates.filter(v => (v.candidate_confidence || 0) >= 75).length,
    medium: candidates.filter(v => (v.candidate_confidence || 0) >= 50 && (v.candidate_confidence || 0) < 75).length,
    low: candidates.filter(v => (v.candidate_confidence || 0) < 50).length
  };
  const portFocus = {};
  for (const v of candidates) {
    const port = v.port || "Unknown";
    portFocus[port] = portFocus[port] || { port, candidates: 0, immediate: 0, top_score: 0, opportunity_usd: 0 };
    portFocus[port].candidates += 1;
    portFocus[port].immediate += v.is_immediate_candidate ? 1 : 0;
    portFocus[port].top_score = Math.max(portFocus[port].top_score, v.cleaning_candidate_score || 0);
    portFocus[port].opportunity_usd += v.opportunity_usd || 0;
  }
  return {
    ops_version: "candidate-ops-v17.7",
    current_candidate_count: candidates.length,
    immediate_24h_count: immediate.length,
    recommended_daily_action: immediate.length
      ? `Contact ${immediate.length} immediate candidate(s) within 24 hours; verify port window before quoting.`
      : candidates.length
        ? `Review ${Math.min(candidates.length, 5)} top candidate(s) today; no immediate 24h blocker detected.`
        : "No live cleaning candidate signal yet; check collector status and no-live-data diagnostics.",
    confidence_buckets: confidenceBuckets,
    top_24h_queue: immediate.slice(0, 7).map((v, index) => ({
      rank: index + 1,
      vessel_name: v.vessel_name,
      port: v.port,
      score: v.cleaning_candidate_score,
      confidence: v.candidate_confidence,
      operator: v.operator || null,
      contact_window: v.contact_window,
      recommended_action: v.candidate_next_action || v.recommended_action,
      reasons: (v.candidate_reasons || []).slice(0, 5),
      stale_guard: v.stale_guard,
      commercial_use_status: v.commercial_use_status
    })),
    port_focus: Object.values(portFocus).sort((a,b) => b.immediate - a.immediate || b.top_score - a.top_score || b.opportunity_usd - a.opportunity_usd).slice(0, 8),
    live_data_warning: reportBase?.data_mode_detail?.mode === "no_live_data"
      ? "No live vessels are available. Candidate count is intentionally zero."
      : "Candidate count can be used as an operating signal after checking freshness/source health."
  };
}

function buildBackendHealth(records = [], apiSources = [], reportBase = {}) {
  const enabled = apiSources.filter(s => s.enabled);
  const partial = apiSources.filter(s => s.partial);
  const sampleRows = records.filter(v => String(v.source_mode || "").includes("sample")).length;
  const blockers = [];
  const warnings = [];
  if (!records.length) blockers.push("No vessel rows generated");
  if (records.length && sampleRows === records.length) warnings.push("All rows are blocked synthetic data");
  if (!enabled.some(s => s.key === "supabase")) warnings.push("Supabase master DB is not enabled");
  if (!enabled.some(s => ["mof_ais_dynamic","mof_ais_info","mof_vts","port_operation","ulsan_core"].includes(s.key))) warnings.push("No primary public movement/port source enabled");
  const sourceScore = Math.min(100, Math.round((enabled.length / Math.max(apiSources.length, 1)) * 100));
  const liveScore = Math.max(0, Math.round(((records.length - sampleRows) / Math.max(records.length,1)) * 100));
  const dataQualityScore = reportBase?.data_quality?.score || 0;
  const score = Math.round(sourceScore * 0.25 + liveScore * 0.35 + dataQualityScore * 0.40);
  return {
    health_version: "backend-health-v17.7",
    score,
    status: blockers.length ? "blocked" : score >= 75 ? "stable" : score >= 50 ? "watch" : "limited",
    enabled_source_groups: enabled.length,
    partial_source_groups: partial.length,
    sample_rows: sampleRows,
    real_rows: Math.max(0, records.length - sampleRows),
    blockers,
    warnings,
    next_backend_moves: [
      "Run collectors in smoke-test mode before publishing commercial candidates",
      "Write normalized snapshots to Supabase using idempotent upsert/append rules",
      "Generate candidate counts from the latest successful snapshot only",
      "Keep GitHub output compact and archive heavy raw payloads externally"
    ]
  };
}

function buildSevenPackSummary() {
  return {
    release_version: "17.7.0",
    bundle_size: 7,
    delivery_policy: "Ship one stable ZIP after grouping five to seven validated improvements.",
    improvements: [
      "Candidate operations center: 24h queue, confidence buckets, port focus",
      "Backend health score: source coverage, live row ratio, blockers and warnings",
      "Candidate priority rank and stale-data guard per vessel",
      "Workflow secret coverage expanded for detailed Ulsan/MOF public API keys",
      "Validation strengthened for candidate, backend and workflow outputs",
      "Release cadence updated from three-patch bundles to seven-pack stability releases",
      "Dashboard labeling updated so the user can distinguish operating candidates from no-live-data diagnostics"
    ],
    stability_guard: "No schema-breaking DB migration is required in this release; it remains compatible with existing data JSON outputs."
  };
}


function buildBackendStabilityBatch(records = [], apiSources = [], reportBase = {}) {
  const enabled = apiSources.filter(s => s.enabled).map(s => s.key);
  const sampleRows = records.filter(v => String(v.source_mode || "").includes("sample")).length;
  const candidateRows = records.filter(v => v.is_cleaning_candidate).length;
  const immediateRows = records.filter(v => v.is_immediate_candidate).length;
  const publicReady = enabled.filter(k => ["port_operation", "berth_sources", "pilot_sources", "ulsan_core", "mof_vts", "mof_ais_dynamic", "mof_ais_info", "vessel_spec"].includes(k));
  const storageReady = enabled.filter(k => ["supabase", "google_drive"].includes(k));
  const paidReady = enabled.filter(k => ["marine_traffic", "vesselfinder", "aisstream"].includes(k));
  const stabilityScore = Math.round(
    Math.min(100, publicReady.length * 8) * 0.35 +
    Math.min(100, storageReady.length * 35) * 0.25 +
    (reportBase?.data_quality?.score || 0) * 0.25 +
    Math.min(100, candidateRows * 20 + immediateRows * 10) * 0.15
  );
  return {
    batch_version: "backend-stability-batch-v17.7",
    release_policy: "Accumulate up to seven backend/data improvements and ship one validated ZIP instead of many tiny patches.",
    stability_score: stabilityScore,
    status: stabilityScore >= 75 ? "stable" : stabilityScore >= 50 ? "operational_watch" : "foundation_mode",
    public_source_groups_ready: publicReady,
    storage_groups_ready: storageReady,
    paid_source_groups_detected: paidReady,
    sample_rows: sampleRows,
    real_rows: Math.max(0, records.length - sampleRows),
    candidate_rows: candidateRows,
    immediate_rows: immediateRows,
    seven_improvements: [
      "Backend release cadence changed to batched stable releases",
      "Candidate count guarded by sample/live data mode",
      "Public-data-first source readiness separated from paid AIS readiness",
      "Storage readiness separated into Supabase and raw archive lanes",
      "Runtime budget and timeout policy documented for collectors",
      "Master DB evolution path clarified before heavy data ingestion",
      "Validation now checks backend stability batch outputs"
    ],
    operating_note: "Use current candidate counts as operational candidates only after data_mode is live/public and freshness is acceptable."
  };
}

function buildRuntimeBudget() {
  const updateMode = process.env.UPDATE_MODE || "scheduled";
  const updateTimeoutMs = Number(process.env.UPDATE_TIMEOUT_MS || 600000);
  const sourceTimeoutMs = Number(process.env.SOURCE_TIMEOUT_MS || 25000);
  const maxRows = Number(process.env.MAX_OUTPUT_ROWS || 500);
  return {
    policy_version: "runtime-budget-v17.7",
    update_mode: updateMode,
    update_timeout_ms: updateTimeoutMs,
    source_timeout_ms: sourceTimeoutMs,
    max_output_rows: maxRows,
    collector_policy: updateMode === "fast"
      ? "Run lightweight public-data collectors first; skip slow optional sources; never block dashboard generation."
      : "Run scheduled public-data collection with a realistic per-source timeout; never block dashboard generation if one source fails.",
    paid_ais_policy: "MarineTraffic/VesselFinder/AISStream stay optional and should not block Korea candidate detection.",
    failure_policy: "If collectors fail or time out, publish empty live outputs with diagnostics. Do not synthesize vessels."
  };
}

function buildMasterDbRoadmap(apiSources = []) {
  const enabled = new Set(apiSources.filter(s => s.enabled).map(s => s.key));
  return {
    roadmap_version: "master-db-roadmap-v17.7",
    current_master: enabled.has("supabase") ? "supabase_configured" : "static_json_until_supabase_verified",
    storage_layers: [
      { layer: "dashboard_json", role: "small latest snapshot for frontend", keep_in_git: true },
      { layer: "supabase_master", role: "queryable vessel snapshots, candidate history, port-stay history", keep_in_git: false },
      { layer: "raw_archive", role: "large raw API payloads and source files in GDrive/Object Storage", keep_in_git: false }
    ],
    next_schema_targets: [
      "vessel_master: stable identity, IMO/MMSI/name/operator/type",
      "vessel_snapshots: timestamped port/status/risk/candidate observations",
      "candidate_events: new candidate, score jump, became immediate, dropped",
      "source_runs: collector success/failure, row counts, latency and error text"
    ],
    migration_guard: "Do not require a destructive migration yet; add append-only tables and views first."
  };
}

function buildDeploymentReadiness(reportBase, records, apiSources = []) {
  const activeApiCount = apiSources.filter(s => s.enabled).length;
  const aisReady = apiSources.some(s => s.enabled && ["mof_ais_dynamic", "mof_ais_info", "mof_ais_stat", "marine_traffic", "vesselfinder", "aisstream"].includes(s.key));
  const checks = [
    {
      key: "static_build",
      label: "Static dashboard files generated",
      status: fs.existsSync("dashboard/index.html") ? "pass" : "fail",
      detail: "dashboard/index.html and public/index.html should exist for hosting."
    },
    {
      key: "data_outputs",
      label: "API JSON outputs generated",
      status: records.length > 0 ? "pass" : "warn",
      detail: `${records.length} vessel records available in dashboard/api/vessels.json.`
    },
    {
      key: "supabase",
      label: "Supabase credentials",
      status: process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY ? "pass" : "warn",
      detail: process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY ? "Supabase sync enabled." : "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY; static data still builds."
    },
    {
      key: "hosting",
      label: "Hosting output directory",
      status: "info",
      detail: "For Vercel/Netlify, set build command to npm run build and output directory to public or dashboard depending on routing."
    },
    {
      key: "api_secret_detection",
      label: "Existing API secrets detected",
      status: activeApiCount > 0 ? "pass" : "warn",
      detail: `${activeApiCount} API group(s) enabled. The pipeline will use configured sources and publish diagnostics for missing sources.`
    },
    {
      key: "collector_readiness",
      label: "Collector readiness roadmap",
      status: activeApiCount >= 3 ? "pass" : activeApiCount > 0 ? "warn" : "warn",
      detail: activeApiCount >= 3 ? "Enough source groups are configured for the next collector connection pass." : "Keep no-live-data mode until public collectors return usable rows."
    },
    {
      key: "ais_source",
      label: "AIS / vessel tracking source",
      status: aisReady ? "pass" : "warn",
      detail: aisReady ? "AIS source detected for vessel movement enrichment." : "No AIS source detected yet; dashboard remains in static/enriched snapshot mode. Add MOF_AIS_* or external AIS keys for live enrichment."
    },
    {
      key: "data_quality",
      label: "Data quality score",
      status: (reportBase.data_quality?.score || 0) >= 70 ? "pass" : "warn",
      detail: `Quality score ${reportBase.data_quality?.score || 0}/100 쨌 ${reportBase.data_quality?.grade || "Needs Cleanup"}.`
    },
    {
      key: "data_mode_guard",
      label: "Sample/live data guard",
      status: reportBase.data_mode_detail?.mode === "no_live_data" ? "warn" : "pass",
      detail: reportBase.data_mode_detail?.message || "Data mode not evaluated."
    },
    {
      key: "business_signal",
      label: "Sales signal coverage",
      status: reportBase.critical_count > 0 || reportBase.high_risk_count > 0 ? "pass" : "warn",
      detail: `${reportBase.critical_count} critical and ${reportBase.high_risk_count} high-risk targets detected.`
    }
  ];
  const blocking = checks.filter(c => c.status === "fail").length;
  const warnings = checks.filter(c => c.status === "warn").length;
  return { blocking, warnings, checks };
}

try {
  const apiSources = detectSecrets();
  console.log(`[HWK] API groups enabled: ${apiSources.filter(s => s.enabled).map(s => s.key).join(", ") || "none"}`);
  const dictionaries = loadReferenceDictionaries();
  collectedRows = await collectKoreaData({ apiSources });
  collectorDiagnosticsAfterCollection = getCollectorDiagnostics();
  const referenceEnrichedRows = enrichWithReferenceDictionaries(collectedRows, dictionaries);
  const cacheResult = await enrichWithVesselMasterCache(referenceEnrichedRows);
  vesselMasterCacheDiagnostics = cacheResult.diagnostics;
  vessels = enrichSalesSignals(cacheResult.records);
  vessels.sort((a, b) => (b.cleaning_candidate_score || 0) - (a.cleaning_candidate_score || 0) || (b.risk_score || 0) - (a.risk_score || 0));

  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    supabaseWrite = { status: "syncing" };
    const result = await saveToSupabase(vessels, {
      runId,
      startedAt,
      diagnostics: getCollectorDiagnostics(),
      status
    });
    supabaseWrite = { status: "synced", ...result };
    supabaseStatus = "synced";
  }
} catch (error) {
  status = "failed";
  errorMessage = error?.message || String(error);
} finally {
  ensureDirs();

  const completedAt = new Date().toISOString();
  const today = completedAt.slice(0, 10);
  const portSummary = buildPortSummary(vessels);
  const collectorDiagnostics = getCollectorDiagnostics();
  if (collectorDiagnostics.fallback_used && status === "success") {
    status = "degraded_sample_only";
  }
  const actionableRows = vessels.filter(v => v.actionable_source_row && !String(v.source_mode || "").includes("sample")).length;
  const baseReport = {
    version: VERSION,
    build_name: BUILD_NAME,
    status,
    run_id: runId,
    started_at: startedAt,
    completed_at: completedAt,
    record_count: vessels.length,
    actionable_rows: actionableRows,
    critical_count: vessels.filter(v => (v.risk_score || 0) >= 85).length,
    high_risk_count: vessels.filter(v => (v.risk_score || 0) >= 70).length,
    compliance_watch_count: vessels.filter(v => v.compliance_watch).length,
    opportunity_usd: vessels.reduce((sum, v) => sum + (v.opportunity_usd || 0), 0),
    candidate_summary: buildCandidateSummary(vessels),
    immediate_candidate_count: vessels.filter(v => v.is_immediate_candidate).length,
    cleaning_candidate_count: vessels.filter(v => v.is_cleaning_candidate).length,
    ports: [...new Set(vessels.map(v => v.port))],
    port_summary: portSummary,
    supabase_status: supabaseStatus,
    supabase_write: supabaseWrite,
    gdrive_archive: gdriveArchive,
    frontend_poll_interval_seconds: 900,
    collection_schedule: {
      github_actions_cron: "0 */6 * * *",
      meaning: "GitHub Actions collects public data every 6 hours or when manually triggered. The dashboard reads generated JSON files; it does not collect APIs every 30 seconds.",
      expected_collection_runtime_minutes: "3-12",
      per_source_timeout_seconds: Math.round(Number(process.env.SOURCE_TIMEOUT_MS || 25000) / 1000)
    },
    data_mode: buildDataMode(vessels, detectSecrets(), supabaseStatus).mode,
    data_mode_detail: buildDataMode(vessels, detectSecrets(), supabaseStatus),
    api_sources: detectSecrets(),
    api_registry_version: "korea-port-secret-registry-v12-backend-stability",
    data_strategy: buildDataStrategy(detectSecrets()),
    collector_diagnostics: { ...collectorDiagnostics, actionable_row_count: collectorDiagnostics.actionable_row_count ?? actionableRows },
    vessel_master_cache: vesselMasterCacheDiagnostics,
    data_quality: buildDataQuality(vessels, detectSecrets()),
    collector_readiness: buildCollectorReadiness(detectSecrets()),
    collector_manifest: buildCollectorManifest(detectSecrets()),
    source_registry: buildSourceRegistry(detectSecrets()),
    cloud_master_db: buildCloudMasterDbStrategy(vessels, detectSecrets(), supabaseStatus),
    release_cadence: buildReleaseCadence(),
    seven_pack_summary: buildSevenPackSummary(),
    runtime_budget: buildRuntimeBudget(),
    master_db_roadmap: buildMasterDbRoadmap(detectSecrets()),
    next_development_plan: [],
    recommended_hosting: {
      build_command: "npm run build",
      output_directory: "public",
      node_version: ">=18"
    },
    error: errorMessage
  };
  baseReport.next_development_plan = buildNextDevelopmentPlan(baseReport, detectSecrets());
  const snapshotOutputs = writeSnapshotOutputs({
    records: vessels,
    report: baseReport,
    version: VERSION,
    buildName: BUILD_NAME,
    apiSources: detectSecrets(),
    supabaseStatus
  });
  const allCollectedVessels = snapshotOutputs.merged;
  const targetVesselsRaw = allCollectedVessels.filter(isMainCommercialVessel);
  const targetVessels = targetVesselsRaw.slice(0, MAX_TARGET_VESSELS);
  const stayingVessels = targetVessels.filter(v => ["arrived_staying", "berthed", "anchorage_waiting"].includes(v.status_bucket));
  const arrivalPipeline = targetVessels.filter(v => v.status_bucket === "arriving_soon");
  vessels = targetVessels;
  const mergedActionableRows = vessels.filter(v => v.actionable_source_row && !String(v.source_mode || "").includes("sample")).length;
  const hotVessels = buildHotVessels(vessels);
  const commercialCommandCenter = buildCommercialCommandCenter(vessels);
  const portCongestionHeatmap = buildPortCongestionHeatmap(vessels);
  const biofoulingTimeline = buildBiofoulingTimeline(vessels);
  const portIntelligence = buildPortIntelligence(vessels);
  const candidateList = buildCandidateList(vessels).slice(0, MAX_CANDIDATES);

  const scoredVessels = vessels.filter(v => typeof v.commercial_value_score === "number");
  const salesCandidates = sortCommercialPriority(dedupeCandidateRows(vessels.filter(isSalesCandidate)));
  const immediateTargets = sortCommercialPriority(dedupeCandidateRows(vessels.filter(isImmediateTarget)));
  const scoringDiagnostics = buildScoringDiagnostics(vessels);
  const operatorDiagnostics = buildOperatorDiagnostics(vessels, salesCandidates, immediateTargets);
  const countFunnel = buildCountFunnel({
    rawRecords: collectedRows,
    allCollected: allCollectedVessels,
    targetVessels,
    salesCandidates,
    immediateTargets,
    collectorDiagnostics: collectorDiagnosticsAfterCollection
  });
  const report = {
    ...baseReport,
    visibility_goal: "commercially_relevant_vessels_not_raw_count",
    target_definition: {
      commercial_gt_threshold: COMMERCIAL_GT_THRESHOLD,
      include: ["grtg >= 5000", "intrlGrtg >= 5000", "unknown GT requiring review", "arriving/calling/staying/berthed/anchorage waiting vessels"],
      exclude_from_main_view: ["GT under 5000", "fishing vessels", "tugs", "government vessels", "workboats", "completed departure-only rows"]
    },
    all_collected_vessel_count: allCollectedVessels.length,
    raw_collected_vessel_count: collectedRows.length,
    target_vessel_count: targetVessels.length,
    target_vessel_uncapped_count: targetVesselsRaw.length,
    gt_5000_plus_count: targetVessels.filter(v => v.gt_status === "target_vessel").length,
    staying_vessel_count: stayingVessels.length,
    arrival_pipeline_count: arrivalPipeline.length,
    scored_vessel_count: scoredVessels.length,
    sales_candidate_count: salesCandidates.length,
    immediate_target_count: immediateTargets.length,
    scoring_diagnostics: scoringDiagnostics,
    operator_diagnostics: operatorDiagnostics,
    count_funnel: countFunnel,
    basic_info_coverage: buildBasicInfoCoverage(vessels),
    imo_recovery_kpis: buildImoRecoveryKpis(vessels),
    imo_missing_count: vessels.filter(v => !v.imo).length,
    imo_recovered_count: vessels.filter(v => v.vessel_master_seed_match && v.imo).length,
    high_value_low_confidence_count: buildHighValueLowConfidence(vessels).length,
    unknown_gt_review_count: targetVessels.filter(v => v.gt_status === "unknown_gt_review").length,
    non_target_small_vessel_count: allCollectedVessels.filter(v => v.gt_status === "non_target_small_vessel").length,
    record_count: vessels.length,
    actionable_rows: mergedActionableRows,
    candidate_summary: buildCandidateSummary(vessels),
    immediate_candidate_count: vessels.filter(v => v.is_immediate_candidate).length,
    cleaning_candidate_count: vessels.filter(v => v.is_cleaning_candidate).length,
    backend_ops: snapshotOutputs.backendOps,
    collector_diagnostics: { ...collectorDiagnosticsAfterCollection, actionable_row_count: collectorDiagnosticsAfterCollection.actionable_row_count ?? mergedActionableRows },
    vessel_master_cache: vesselMasterCacheDiagnostics,
    candidate_changes: snapshotOutputs.candidateChanges,
    supabase_write: supabaseWrite,
    gdrive_archive: gdriveArchive,
    backend_stability_batch: buildBackendStabilityBatch(vessels, detectSecrets(), baseReport),
    candidate_ops: buildCandidateOps(vessels, baseReport),
    backend_health: buildBackendHealth(vessels, detectSecrets(), baseReport),
    commercial_command_center: commercialCommandCenter,
    hot_vessel_count: hotVessels.length,
    port_intelligence: portIntelligence.map(({ all_vessels, scored_vessels, sales_candidates, immediate_targets, berths, ...port }) => port),
    port_congestion_heatmap: portCongestionHeatmap,
    biofouling_timeline: biofoulingTimeline,
    deployment_readiness: buildDeploymentReadiness(baseReport, vessels, detectSecrets())
  };

  try {
    gdriveArchive = await archiveRawToGDrive({
      generated_at: completedAt,
      records: vessels,
      report,
      collector_diagnostics: getCollectorDiagnostics()
    }, { namePrefix: "hwk-port-raw" });
  } catch (archiveError) {
    gdriveArchive = { status: "failed", error: archiveError?.message || String(archiveError) };
  }
  report.gdrive_archive = gdriveArchive;
  report.storage_status = {
    supabase: supabaseWrite,
    gdrive: gdriveArchive
  };

  fs.writeFileSync("dashboard/api/all-collected-vessels.json", JSON.stringify(allCollectedVessels, null, 2));
  fs.writeFileSync("dashboard/api/target-vessels.json", JSON.stringify(targetVessels, null, 2));
  fs.writeFileSync("dashboard/api/staying-vessels.json", JSON.stringify(stayingVessels, null, 2));
  fs.writeFileSync("dashboard/api/arrival-pipeline.json", JSON.stringify(arrivalPipeline, null, 2));
  fs.writeFileSync("dashboard/api/imo-recovery-queue.json", JSON.stringify(buildImoRecoveryQueue(vessels), null, 2));
  fs.writeFileSync("dashboard/api/imo-recovery-priority.json", JSON.stringify(buildImoRecoveryQueue(vessels), null, 2));
  fs.writeFileSync("dashboard/api/high-value-targets.json", JSON.stringify(buildHighValueTargets(vessels), null, 2));
  fs.writeFileSync("dashboard/api/unknown-gt-review.json", JSON.stringify(buildUnknownGtReview(vessels), null, 2));
  fs.writeFileSync("dashboard/api/high-value-low-confidence.json", JSON.stringify(buildHighValueLowConfidence(vessels), null, 2));
  fs.writeFileSync("dashboard/api/congestion-watchlist.json", JSON.stringify(buildCongestionWatchlist(vessels), null, 2));
  fs.writeFileSync("dashboard/api/agent-followup-queue.json", JSON.stringify(buildAgentFollowupQueue(vessels), null, 2));
  fs.mkdirSync("dashboard/api/quality", { recursive: true });
  fs.mkdirSync("dashboard/api/review", { recursive: true });
  fs.writeFileSync("dashboard/api/quality/basic-info-coverage.json", JSON.stringify(buildBasicInfoCoverage(vessels), null, 2));
  fs.writeFileSync("dashboard/api/review/basic-info-missing.json", JSON.stringify(buildBasicInfoMissingReview(vessels), null, 2));
  fs.writeFileSync("dashboard/api/vessels.json", JSON.stringify(vessels, null, 2));
  fs.writeFileSync("data/latest-lite.json", JSON.stringify(vessels, null, 2));
  fs.writeFileSync("dashboard/api/candidates.json", JSON.stringify(candidateList, null, 2));
  fs.writeFileSync("dashboard/api/candidate-summary.json", JSON.stringify(buildCandidateSummary(vessels), null, 2));
  fs.writeFileSync("dashboard/api/contact-queue.json", JSON.stringify(candidateList.slice(0, 50).map((v, index) => ({
    rank: index + 1,
    vessel_name: v.vessel_name,
    port: v.port,
    port_code: v.port_code,
    operator: v.operator || null,
    agent: v.agent || null,
    score: v.total_sales_priority_score || 0,
    band: v.sales_priority_band || "low_priority",
    contact_window: v.contact_window,
    next_action: v.candidate_next_action || v.recommended_action,
    reason_codes: v.reason_codes || []
  })), null, 2));
  fs.writeFileSync("dashboard/api/hot-candidates.json", JSON.stringify(candidateList.filter(v => v.is_immediate_candidate || (v.total_sales_priority_score || 0) >= IMMEDIATE_TARGET_THRESHOLD).slice(0, 40), null, 2));
  fs.writeFileSync("dashboard/api/hot-vessels.json", JSON.stringify(hotVessels, null, 2));
  fs.writeFileSync("dashboard/api/ports.json", JSON.stringify(portIntelligence.map(({ all_vessels, scored_vessels, sales_candidates, immediate_targets, berths, ...port }) => port), null, 2));
  fs.writeFileSync("dashboard/api/coverage-registry.json", JSON.stringify({
    generated_at: completedAt,
    data_mode: report.data_mode,
    record_count: vessels.length,
    port_count: portIntelligence.length,
    tier_1: PRIORITY_PORTS.map(port => {
      const found = portIntelligence.find(p => p.port_name === port || p.port_code === portCodeFromName(port));
      return {
        port,
        port_code: found?.port_code || portCodeFromName(port),
        vessel_count: found?.vessel_count || 0,
        candidate_count: found?.candidate_count || 0,
        immediate_target_count: found?.immediate_target_count || 0,
        coverage_status: found ? "observed" : "no_live_rows"
      };
    }),
    tier_2: portIntelligence
      .filter(p => !PRIORITY_PORTS.includes(p.port_name))
      .map(({ port_code, port_name, vessel_count, candidate_count, immediate_target_count }) => ({ port: port_name, port_code, vessel_count, candidate_count, immediate_target_count })),
    ports: portIntelligence.map(({ port_code, port_name, vessel_count, candidate_count, immediate_target_count }) => ({ port_code, port_name, vessel_count, candidate_count, immediate_target_count })),
    normalized_fields: ["vessel_name", "imo", "mmsi", "call_sign", "vessel_type", "gt", "operator", "agent", "port_code", "port_name", "berth_name", "anchorage_name", "eta", "ata", "etb", "atb", "etd", "atd", "stay_hours", "current_call_stay_hours", "cumulative_stay_hours", "cumulative_stay_days", "berth_hours", "anchorage_hours", "hybrid_entity_key", "identification_method"]
  }, null, 2));
  for (const port of portIntelligence) {
    const dir = `dashboard/api/ports/${port.port_code}`;
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(`${dir}/vessels.json`, JSON.stringify(port.all_vessels, null, 2));
    fs.writeFileSync(`${dir}/candidates.json`, JSON.stringify(port.sales_candidates, null, 2));
    fs.writeFileSync(`${dir}/berths.json`, JSON.stringify(port.berths, null, 2));
    fs.writeFileSync(`${dir}/congestion.json`, JSON.stringify(portCongestionHeatmap.find(p => String(p.port_code) === String(port.port_code) || p.port === port.port_name) || null, null, 2));
    fs.writeFileSync(`${dir}/anchorage.json`, JSON.stringify(buildPortAnchorage(vessels, port.port_code), null, 2));
  }
  fs.writeFileSync("dashboard/api/commercial-command-center.json", JSON.stringify(commercialCommandCenter, null, 2));
  fs.writeFileSync("dashboard/api/port-congestion-heatmap.json", JSON.stringify(portCongestionHeatmap, null, 2));
  fs.writeFileSync("dashboard/api/biofouling-timeline.json", JSON.stringify(biofoulingTimeline, null, 2));
  fs.writeFileSync("dashboard/api/status.json", JSON.stringify(report, null, 2));
  fs.writeFileSync("data/pipeline-report.json", JSON.stringify(report, null, 2));
  fs.writeFileSync(`data/reports/${today}.json`, JSON.stringify(report, null, 2));
  fs.copyFileSync("dashboard/index.html", "public/index.html");
}

console.log(`[HWK] v${VERSION} ${BUILD_NAME} dashboard data generated`);
