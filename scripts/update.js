import fs from "fs";
import { collectKoreaData, getCollectorDiagnostics } from "./collectors/korea.js";
import { createRunId, enrichWithVesselMasterCache, recordRawArchiveIndex, saveToSupabase } from "./lib/db.js";
import { archiveRawToGDrive, buildRawArchivePayload } from "./lib/gdrive.js";
import { detectSecrets } from "./lib/secrets.js";
import { writeSnapshotOutputs, buildBackendOpsReport } from "./lib/snapshot-store.js";
import { enrichWithReferenceDictionaries, loadReferenceDictionaries } from "./lib/reference-dictionaries.js";
import { configDiagnostics, validateRequiredConfig } from "./lib/config.js";
import {
  buildRuntimeConfigAudit,
  buildRunOrigin,
  missingRequiredEnvNames,
  portOperationApiUrlInfo,
  portOperationServiceKeyPresent,
  printRuntimeConfigAudit
} from "./lib/runtime-config-audit.js";
import { latestSuccessfulFallbackState } from "./lib/dataset-state.js";
import { buildPortStatistics, normalizePort, normalizeRecordPort } from "./lib/port-statistics.js";
import { PIPELINE_STAGES, sourceOfTruthTables } from "./pipeline/index.js";

const VERSION = "17.7.0";
const BUILD_NAME = "Backend Stability Batch";
const PRIORITY_PORTS = [
  "부산",
  "여수",
  "광양",
  "울산",
  "평택·당진",
  "포항"
];
const COMMERCIAL_GT_THRESHOLD = Number(process.env.COMMERCIAL_GT_THRESHOLD || 5000);
const REVIEW_TARGET_THRESHOLD = Number(process.env.REVIEW_TARGET_THRESHOLD || 35);
const SALES_CANDIDATE_THRESHOLD = Number(process.env.SALES_CANDIDATE_THRESHOLD || 65);
const IMMEDIATE_TARGET_THRESHOLD = Number(process.env.IMMEDIATE_TARGET_THRESHOLD || 75);
const CRITICAL_TARGET_THRESHOLD = Number(process.env.CRITICAL_TARGET_THRESHOLD || 90);
const COMMERCIAL_RULE_VERSION = process.env.COMMERCIAL_RULE_VERSION || "commercial_rules_v2026_05_31";
const CANDIDATE_RULE_VERSION = process.env.CANDIDATE_RULE_VERSION || "candidate_hybrid_percentile_v2026_05_31";
const EXPLAINABILITY_RULE_VERSION = process.env.EXPLAINABILITY_RULE_VERSION || "explainability_ko_v2026_05_31";
const MAX_TARGET_VESSELS = Number(process.env.MAX_TARGET_VESSELS || 5000);
const MAX_CANDIDATES = Number(process.env.MAX_CANDIDATES || 1000);
const VALIDATION_MODE = String(process.env.VALIDATION_MODE || (process.env.CI === "true" ? "production" : "local")).toLowerCase();
const DEBUG_API_DIR = "dashboard/api/debug";
const SUCCESSFUL_DATASET_DIR = "data/successful";
const SUCCESSFUL_DATASET_MANIFEST = `${SUCCESSFUL_DATASET_DIR}/latest.json`;

function envPresent(name) {
  return Boolean(process.env[name] && String(process.env[name]).trim());
}

function missingPortOperationRequiredConfig() {
  return missingRequiredEnvNames().filter(name => ["PORT_OPERATION_SERVICE_KEY", "PORT_OPERATION_API_URL"].includes(name));
}

function portOperationCollectorNotAttemptedReason(diagnostics = {}) {
  const preflight = diagnostics.preflight || {};
  const plan = diagnostics.port_operation_collection_plan || {};
  const missing = missingPortOperationRequiredConfig();
  if (missing.includes("PORT_OPERATION_SERVICE_KEY")) return "missing_service_key";
  if (missing.includes("PORT_OPERATION_API_URL")) return "missing_api_url";
  return diagnostics.preflight_failure_reason || preflight.preflight_failure_reason || plan.ports_skipped_reason || diagnostics.skip_reason || "unknown_error";
}

// Canonical output fields for new pipeline logic:
// score -> commercial_value_score
// location -> port_code, port_name, berth_name, terminal_name, source_name
// Legacy aliases such as risk_score, total_sales_priority_score, port, berth,
// and source remain as read/write compatibility fields until consumers migrate.

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
    v.status_bucket,
    v.operational_status,
    v.status,
    v.port_call_status,
    v.call_status,
    v.movement_status,
    v.berth_name,
    v.berth,
    v.anchorage_name,
    v.anchorage_zone,
    v.anchorage_area,
    v.location_area,
    v.area_name,
    v.laidupFcltyNm,
    v.laidup_fclty_nm,
    v.facility_name_raw,
    v.facility_name_normalized,
    v.facility_code,
    v.berth_class,
    v.anchorage_class
  ].filter(Boolean).join(" ");
  return /waiting|pre[-\s]?berth|anchorage|anchor|idle|drifting|묘박|정박|박지|외항|남외항|북외항|대기|접안대기|ANCH|O\/A|OUTER/i.test(text);
}

function hasAnchorageWaitingSignal(v = {}) {
  if (isDepartedRecord(v)) return false;
  const text = [
    v.status_bucket,
    v.operational_status,
    v.status,
    v.port_call_status,
    v.call_status,
    v.movement_status,
    v.berth_name,
    v.berth,
    v.anchorage_name,
    v.anchorage_zone,
    v.anchorage_area,
    v.location_area,
    v.area_name,
    v.laidupFcltyNm,
    v.laidup_fclty_nm,
    v.facility_name_raw,
    v.facility_name_normalized
  ].filter(Boolean).join(" ");
  const etaLike = firstNonEmpty(v.eta, v.etb, v.predicted_arrival_time, v.arrival_time, v.eta_candidate, v.etb_candidate);
  const hasBerthConfirmed = hasValue(firstNonEmpty(v.ata, v.atb, v.berth_name, v.berth)) && !hasAnchorageSignal(v);
  const repeatedInArea = Number(v.observation_count || v.sighting_count || v.same_area_sightings || v.snapshot_count || 0) > 1 &&
    hasPortSignal(v) &&
    !v.atd;
  return Boolean(
    v.is_anchorage_waiting ||
    hasAnchorageSignal(v) ||
    Number(v.anchorage_hours || v.estimated_waiting_time || 0) > 0 ||
    /waiting|pre[-\s]?berth|anchorage|anchor|idle|drifting|묘박|정박|박지|외항|대기|접안대기/i.test(text) ||
    repeatedInArea ||
    (hasValue(etaLike) && !hasBerthConfirmed)
  );
}

function anchorageWaitingReason(v = {}) {
  if (Number(v.anchorage_hours || v.estimated_waiting_time || 0) > 0) return "묘박/대기 시간이 감지되었습니다.";
  if (hasAnchorageSignal(v)) return "상태 또는 위치명에 묘박/대기 신호가 있습니다.";
  if (hasValue(firstNonEmpty(v.eta, v.etb, v.predicted_arrival_time, v.arrival_time)) && !hasValue(firstNonEmpty(v.ata, v.atb, v.berth_name, v.berth))) {
    return "입항 예정은 있으나 접안/도착 확정 정보가 없습니다.";
  }
  return "동일 항만/해역 반복 체류 신호가 있습니다.";
}

function hasArrivalPipelineSignal(v = {}) {
  if (isDepartedRecord(v)) return false;
  const status = [v.status_bucket, v.operational_status, v.status, v.port_call_status, v.call_status, v.movement_status].filter(Boolean).join(" ");
  return Boolean(
    v.predicted_arrival_pipeline ||
    v.pilot_only_arrival_review ||
    v.port_operation_planned_arrival ||
    hasValue(firstNonEmpty(v.eta, v.etb, v.arrival_time, v.predicted_arrival_time, v.eta_candidate, v.etb_candidate, v.pilot_time, v.movement_time)) ||
    hasPortSignal({ port_code: v.destination_port_code, port_name: v.destination_port || v.destination || v.next_port }) ||
    hasPortSignal(v) && /inbound|arrival|arriving|eta|입항예정|입항\s*대기|도착예정/i.test(status)
  );
}

function arrivalPipelineReason(v = {}) {
  if (hasValue(firstNonEmpty(v.eta, v.etb, v.arrival_time, v.predicted_arrival_time))) return "ETA/ETB 또는 입항 예정 시간이 확인되었습니다.";
  if (/inbound|arrival|arriving|입항예정|도착예정/i.test([v.status_bucket, v.status, v.port_call_status].filter(Boolean).join(" "))) return "입항 예정 상태 신호가 있습니다.";
  return "목적지 또는 현재 항만이 모니터링 항만으로 확인되었습니다.";
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

function deriveRoutePattern(v = {}, metrics = {}, routeProfile = deriveRouteCommercialProfile(v)) {
  const fromPort = normalizePortToken(v.previous_port || v.last_port || "");
  const toPort = normalizePortToken(v.destination_port || v.destination || v.next_port || v.port_name || v.port || "");
  const typeGroup = v.vessel_type_group || defaultVesselTypeGroup(v);
  const routeKey = [fromPort || "UNKNOWN", toPort || "KOREA", typeGroup || "unknown"].join("|");
  const isKnownRoute = Boolean(fromPort && toPort);
  const avgTransitHours = Number(v.avg_transit_hours || v.historical_avg_transit_hours || 0) || routeTransitHours(fromPort, toPort, typeGroup);
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
    avg_transit_hours: avgTransitHours,
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
    const routeHours = Number(v.avg_transit_hours || v.historical_avg_transit_hours || routePattern.avg_transit_hours || 48);
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
  if (value >= 85) return "CRITICAL";
  if (value >= 65) return "HIGH";
  if (value >= 40) return "MEDIUM";
  return "LOW";
}

function deriveRouteBonus(v = {}, routeProfile = deriveRouteCommercialProfile(v)) {
  const explicit = Number(v.route_bonus || 0);
  if (explicit > 0) return Math.min(100, Math.round(explicit));
  const routeWeight = Number(routeProfile.route_commercial_weight || 0);
  const routeScores = [
    Number(routeProfile.biosecurity_exposure_score || v.biosecurity_exposure_score || 0) * 0.35,
    Number(routeProfile.esg_sensitivity_score || v.esg_sensitivity_score || 0) * 0.25,
    Number(routeProfile.fuel_efficiency_sensitivity_score || v.fuel_efficiency_sensitivity_score || 0) * 0.25,
    routeWeight * 3
  ];
  return Math.min(100, Math.round(Math.max(0, ...routeScores)));
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

function deriveBiofoulingExposureEngine(v = {}, metrics = {}, routeProfile = deriveRouteCommercialProfile(v), predictiveParts = {}) {
  const gt = Number(v.gt || v.grtg || v.intrlGrtg || 0);
  const type = String([v.vessel_type_group, v.vessel_type, v.commercial_segment, v.vsslKndNm].filter(Boolean).join(" ")).toLowerCase();
  const anchorageHours = Number(metrics.anchorage_hours || v.anchorage_hours || 0);
  const stayHours = Number(metrics.stay_hours || v.cumulative_stay_hours || v.stay_hours || v.current_call_stay_hours || 0);
  const congestion = Number(predictiveParts.predicted_congestion_score || v.congestion_score || v.port_congestion_score || deriveCongestionScore(v, metrics) || 0);
  const idleExposure = Number(predictiveParts.idle_exposure || v.idle_exposure || Math.min(100, Math.round(Math.min(55, stayHours / 2) + Math.min(35, anchorageHours / 2))));
  const lowSpeedExposure = Number(predictiveParts.low_speed_exposure || v.low_speed_exposure || 0);
  const routeExposure = Math.max(
    Number(routeProfile.biosecurity_exposure_score || v.biosecurity_exposure_score || 0),
    routeProfile.route_region === "australia" || routeProfile.route_region === "new_zealand" ? 100 :
      routeProfile.route_region === "brazil" ? 85 :
        routeProfile.route_region === "north_america" ? 60 :
          routeProfile.route_region === "europe" ? 50 : 0
  );
  const vesselTypeExposure = /bulk|bulker|tanker|container|pctc|cruise|lng|lpg|벌크|탱커|컨테이너|자동차|크루즈/.test(type)
    ? 85
    : /general|cargo|화물/.test(type)
      ? 45
      : 25;
  const anchorageExposure = Math.min(100, Math.round(Math.min(90, anchorageHours / 24 * 18) + (v.is_anchorage_waiting || hasAnchorageSignal(v) ? 10 : 0)));
  const stayExposure = Math.min(100, Math.round(Math.min(90, stayHours / 24 * 12) + (stayHours >= 168 ? 10 : 0)));
  const gtExposure = gt >= 80000 ? 12 : gt >= 30000 ? 8 : gt >= COMMERCIAL_GT_THRESHOLD ? 4 : 0;
  const score = boundedScore(
    anchorageExposure * 0.30 +
    stayExposure * 0.20 +
    congestion * 0.15 +
    Math.max(lowSpeedExposure, idleExposure) * 0.15 +
    routeExposure * 0.10 +
    vesselTypeExposure * 0.10 +
    gtExposure
  );
  const reasons = [];
  if (anchorageHours >= 72 || anchorageExposure >= 45) reasons.push("LONG_ANCHORAGE_EXPOSURE");
  if (stayHours >= 72) reasons.push("LONG_PORT_STAY");
  if (lowSpeedExposure >= 35 || idleExposure >= 45) reasons.push("LOW_SPEED_EXPOSURE");
  if (congestion >= 40) reasons.push("HIGH_CONGESTION_EXPOSURE");
  if (routeProfile.route_region === "australia" || routeProfile.route_region === "new_zealand") reasons.push("AUSTRALIA_ROUTE");
  if (routeProfile.route_region === "brazil") reasons.push("BRAZIL_ROUTE");
  if (gt >= 30000) reasons.push("HIGH_GT_EXPOSURE");
  return {
    biofouling_exposure_score: score,
    biofouling_exposure_band: biofoulingExposureBand(score),
    biofouling_exposure_reasons: [...new Set(reasons)]
  };
}

function deriveCleaningOpportunityPrediction(v = {}, metrics = {}, routeProfile = deriveRouteCommercialProfile(v), predictiveParts = {}) {
  const commercialValue = Number(v.commercial_value_score || v.total_sales_priority_score || v.cleaning_candidate_score || 0);
  const congestion = Number(
    predictiveParts.predicted_congestion_score ||
    v.congestion_score ||
    v.port_congestion_score ||
    v.congestion_exposure_score ||
    deriveCongestionScore(v, metrics) ||
    0
  );
  const workFeasibility = Number(
    v.work_feasibility_score ||
    v.cleaning_window_score ||
    (predictiveParts.predicted_work_window_hours ? Math.min(100, Number(predictiveParts.predicted_work_window_hours) * 3) : 0)
  );
  const biofoulingExposure = Number(
    predictiveParts.biofouling_exposure_score ||
    v.biofouling_exposure_score ||
    v.biofouling_risk_score ||
    v.biofouling_score ||
    0
  );
  const anchorageProbability = Number(predictiveParts.anchorage_probability || v.anchorage_probability || 0);
  const arrivalOpportunity = Number(v.arrival_opportunity_score || predictiveParts.arrival_opportunity_score || 0);
  const contactReadiness = Number(v.contact_readiness_score || 0);
  const routeBonus = deriveRouteBonus(v, routeProfile);
  const score = Math.min(100, Math.round(
    commercialValue * 0.25 +
    workFeasibility * 0.25 +
    biofoulingExposure * 0.20 +
    Math.max(anchorageProbability, congestion) * 0.15 +
    arrivalOpportunity * 0.10 +
    contactReadiness * 0.05
  ));
  const opportunitySummary = buildOpportunitySummary(v, {
    commercialValue,
    workFeasibility,
    biofoulingExposure,
    anchorageProbability,
    arrivalOpportunity,
    contactReadiness
  });
  return {
    route_bonus: routeBonus,
    predicted_cleaning_opportunity_score: score,
    cleaning_opportunity_band: cleaningOpportunityBand(score),
    opportunity_summary: opportunitySummary
  };
}

function buildOpportunitySummary(v = {}, parts = {}) {
  const fragments = [];
  const gt = Number(v.gt || v.grtg || v.intrlGrtg || 0);
  const type = String(v.vessel_type_group || v.vessel_type || "선종 확인 필요").replace(/_/g, " ");
  const anchorageDays = Number(v.anchorage_hours || 0) / 24;
  const stayDays = Number(v.stay_hours || v.current_call_stay_hours || v.cumulative_stay_hours || 0) / 24;
  if (gt > 0) fragments.push(`GT ${Math.round(gt).toLocaleString("en-US")} ${type}`);
  else fragments.push(`${type} 선박`);
  if (anchorageDays >= 1) fragments.push(`묘박/대기 ${Math.round(anchorageDays * 10) / 10}일`);
  else if (stayDays >= 1) fragments.push(`항만 체류 ${Math.round(stayDays * 10) / 10}일`);
  if (Number(parts.biofoulingExposure || v.biofouling_exposure_score || 0) >= 60) fragments.push("바이오파울링 노출 높음");
  if (Number(parts.workFeasibility || v.work_feasibility_score || 0) >= 60) fragments.push("작업 가능성 높음");
  if (Number(parts.anchorageProbability || v.anchorage_probability || 0) >= 60) fragments.push("묘박 가능성 높음");
  if (String(v.pilot_direction || v.movement_type || "").toLowerCase() !== "outbound" && !v.outbound_pilot_scheduled) fragments.push("출항 도선 미확인");
  if (v.operator_name || v.operator || v.agent_name || v.agent) fragments.push("연락 경로 확인 가능");
  return fragments.slice(0, 5).join(" · ");
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
  const repeatCallCount = Number(v.repeat_call_count || v.observation_count || 0);
  const repeatOperatorCount = Number(v.repeat_operator_count || 0);
  const repeatCallerScore = Math.min(100, Math.round(
    (repeatCallCount >= 10 ? 85 : repeatCallCount >= 5 ? 65 : repeatCallCount >= 3 ? 45 : repeatCallCount >= 2 ? 20 : 0) +
    (v.vessel_master_cache_match || v.vessel_master_seed_match ? 30 : 0) +
    (routePattern.route_pattern_known ? 25 : 0) +
    (Number(routePattern.route_pattern_confidence || 0) * 0.25) +
    (v.identity_confidence >= 70 ? 15 : 0)
  ));
  const repeatOperatorScore = Math.min(100, Math.round(
    (repeatOperatorCount >= 10 ? 80 : repeatOperatorCount >= 5 ? 55 : repeatOperatorCount >= 3 ? 35 : repeatOperatorCount >= 2 ? 18 : 0) +
    (v.operator_normalized ? 20 : 0) +
    (v.operator_fleet_badges?.includes("repeat_observed_fleet") ? 35 : 0) +
    (v.operator_confidence ? Math.min(30, Number(v.operator_confidence) * 0.3) : 0) +
    (v.agent_normalized ? 10 : 0)
  ));
  const speed = Number(v.speed || v.sog || 0);
  const lowSpeedExposure = Math.min(100, Math.round((speed > 0 && speed < 1.5 ? 45 : 0) + Math.min(35, stayHours / 3) + Math.min(20, anchorageHours / 2)));
  const idleExposure = Math.min(100, Math.round(Math.min(55, stayHours / 2) + Math.min(35, anchorageHours / 2) + (v.is_anchorage_waiting ? 10 : 0)));
  const anchorageExposure = Math.min(100, Math.round(Math.min(70, anchorageHours * 1.2) + (v.is_anchorage_waiting ? 20 : 0) + (hasAnchorageSignal(v) ? 10 : 0)));
  const biofoulingExposure = deriveBiofoulingExposureEngine(v, metrics, routeProfile, {
    predicted_congestion_score: predictedCongestionScore,
    idle_exposure: idleExposure,
    low_speed_exposure: lowSpeedExposure
  });
  const cleaningOpportunity = deriveCleaningOpportunityPrediction(v, metrics, routeProfile, {
    predicted_congestion_score: predictedCongestionScore,
    predicted_work_window_hours: predictedWorkWindowHours,
    biofouling_exposure_score: biofoulingExposure.biofouling_exposure_score
  });
  return {
    predicted_congestion_score: predictedCongestionScore,
    congestion_forecast_band: forecastBand(predictedCongestionScore),
    anchorage_probability: anchorageProbability,
    predicted_work_window_hours: predictedWorkWindowHours,
    work_window_confidence: workWindowConfidence,
    repeat_call_count: repeatCallCount,
    repeat_operator_count: repeatOperatorCount,
    repeat_caller_score: repeatCallerScore,
    repeat_operator_score: repeatOperatorScore,
    low_speed_exposure: lowSpeedExposure,
    idle_exposure: idleExposure,
    anchorage_exposure: anchorageExposure,
    biofouling_exposure_score: biofoulingExposure.biofouling_exposure_score,
    biofouling_exposure_band: biofoulingExposure.biofouling_exposure_band,
    biofouling_exposure_reasons: biofoulingExposure.biofouling_exposure_reasons,
    route_bonus: cleaningOpportunity.route_bonus,
    predicted_cleaning_opportunity_score: cleaningOpportunity.predicted_cleaning_opportunity_score,
    cleaning_opportunity_band: cleaningOpportunity.cleaning_opportunity_band,
    opportunity_summary: cleaningOpportunity.opportunity_summary
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

function repeatPortCallKey(v = {}) {
  return normalizeIdentityToken(
    v.port_call_identity ||
    `${v.port_code || v.port || ""}-${v.etryptYear || ""}-${v.etryptCo || ""}-${v.call_sign || ""}-${v.ata || v.eta || v.vessel_name || ""}`
  );
}

function repeatOperatorKey(v = {}) {
  return normalizeCompanyName(v.operator_name || v.operator || v.operator_normalized || "");
}

function annotateRepeatCallerIntelligence(records = []) {
  const vesselCalls = new Map();
  const operatorVessels = new Map();
  const operatorPorts = new Map();
  for (const record of records) {
    const vesselKey = repeatVesselKey(record);
    if (vesselKey) {
      if (!vesselCalls.has(vesselKey)) vesselCalls.set(vesselKey, new Set());
      vesselCalls.get(vesselKey).add(repeatPortCallKey(record) || vesselKey);
    }
    const operatorKey = repeatOperatorKey(record);
    if (operatorKey && vesselKey) {
      if (!operatorVessels.has(operatorKey)) operatorVessels.set(operatorKey, new Set());
      operatorVessels.get(operatorKey).add(vesselKey);
    }
    if (operatorKey) {
      if (!operatorPorts.has(operatorKey)) operatorPorts.set(operatorKey, new Set());
      operatorPorts.get(operatorKey).add(String(record.port_code || record.port_name || record.port || "unknown"));
    }
  }

  return records.map(record => {
    const vesselKey = repeatVesselKey(record);
    const operatorKey = repeatOperatorKey(record);
    const repeatCallCount = Math.max(Number(record.repeat_call_count || record.observation_count || 0), vesselKey ? vesselCalls.get(vesselKey)?.size || 0 : 0);
    const repeatOperatorCount = Math.max(Number(record.repeat_operator_count || 0), operatorKey ? operatorVessels.get(operatorKey)?.size || 0 : 0);
    const callsLast12m = Math.max(Number(record.calls_last_12m || 0), repeatCallCount || 1);
    const callsLast6m = Math.max(Number(record.calls_last_6m || 0), Math.min(callsLast12m, Math.ceil(callsLast12m * 0.7)));
    const callsLast3m = Math.max(Number(record.calls_last_3m || 0), Math.min(callsLast6m, Math.ceil(callsLast6m * 0.5)));
    return {
      ...record,
      calls_last_3m: callsLast3m,
      calls_last_6m: callsLast6m,
      calls_last_12m: callsLast12m,
      repeat_call_count: repeatCallCount,
      repeat_operator_count: repeatOperatorCount,
      operator_call_count: operatorKey ? operatorVessels.get(operatorKey)?.size || repeatOperatorCount : repeatOperatorCount,
      operator_vessel_count: operatorKey ? operatorVessels.get(operatorKey)?.size || repeatOperatorCount : repeatOperatorCount,
      operator_port_count: operatorKey ? operatorPorts.get(operatorKey)?.size || 0 : 0,
      repeat_caller: repeatCallCount >= 3,
      repeat_operator: repeatOperatorCount >= 3
    };
  });
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
    const score = Number(record.commercial_value_score || record.total_sales_priority_score || record.cleaning_candidate_score || 0);
    if (!isHardCandidateExcluded(record) && score >= SALES_CANDIDATE_THRESHOLD) fleet.target_vessels += 1;
    if (!isHardCandidateExcluded(record) && score >= IMMEDIATE_TARGET_THRESHOLD && hasCurrentOrNearTermWorkFeasibility(record)) fleet.immediate_targets += 1;
    const repeatCalls = Number(record.repeat_call_count || record.calls_last_12m || 0);
    fleet.repeat_call_total += repeatCalls;
    if (repeatCalls >= 3) fleet.repeated_vessels += 1;
    if (record.route_region && record.route_region !== "unknown") fleet.route_regions.add(record.route_region);
    if (Number(record.congestion_score || record.port_congestion_score || 0) >= 40 || Number(record.anchorage_hours || 0) >= 72) fleet.congestion_exposed += 1;
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
        commercial_value_score: Number(v.commercial_value_score || v.total_sales_priority_score || 0),
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

function annotateFleetIntelligence(records = []) {
  const fleetRows = buildFleetOpportunityRows(records);
  const byOperator = new Map(fleetRows.map(row => [row.operator_normalized, row]));
  return records.map(record => {
    const operatorKey = repeatOperatorKey(record);
    const fleet = byOperator.get(operatorKey);
    const repeatCallCount = Number(record.repeat_call_count || record.calls_last_12m || 0);
    const repeatCallerScore = Math.max(Number(record.repeat_caller_score || 0), repeatScoreFromCalls(repeatCallCount));
    const reasonCodes = new Set(record.reason_codes || []);
    if (repeatCallCount >= 3) reasonCodes.add("REPEAT_CALLER");
    if (fleet?.operator_vessel_count >= 2) reasonCodes.add("MULTIPLE_ACTIVE_VESSELS");
    if (fleet?.repeat_operator_score >= 20) reasonCodes.add("REPEAT_OPERATOR");
    if (fleet?.fleet_opportunity_score >= 45) reasonCodes.add("FLEET_OPPORTUNITY");
    if (fleet?.operator_vessel_count >= 5 || fleet?.operator_port_count >= 3) reasonCodes.add("HIGH_OPERATOR_PRESENCE");
    const fleetScoreBoost = fleet ? Math.min(8, Math.round(Number(fleet.fleet_opportunity_score || 0) / 15)) : 0;
    const commercialValue = boundedScore(Number(record.commercial_value_score || record.total_sales_priority_score || 0) + fleetScoreBoost);
    const fleetWhyNow = fleet?.fleet_opportunity_score >= 45 ? fleet.why_now : "";
    return {
      ...record,
      repeat_caller_score: repeatCallerScore,
      repeat_operator_score: Math.max(Number(record.repeat_operator_score || 0), Number(fleet?.repeat_operator_score || 0)),
      operator_call_count: Number(fleet?.operator_call_count || record.operator_call_count || record.repeat_operator_count || 0),
      operator_vessel_count: Number(fleet?.operator_vessel_count || record.operator_vessel_count || record.repeat_operator_count || 0),
      operator_port_count: Number(fleet?.operator_port_count || record.operator_port_count || 0),
      fleet_opportunity_score: Number(fleet?.fleet_opportunity_score || record.fleet_opportunity_score || 0),
      commercial_value_score: commercialValue,
      total_sales_priority_score: Math.max(Number(record.total_sales_priority_score || 0), commercialValue),
      reason_codes: [...reasonCodes],
      sales_reason: [...reasonCodes],
      why_now: fleetWhyNow ? `${fleetWhyNow} ${record.why_now || deriveWhyNow(record)}` : record.why_now,
      recommended_action: fleet?.fleet_opportunity_score >= 55 ? fleet.recommended_action : record.recommended_action,
      recommended_next_action: fleet?.fleet_opportunity_score >= 55 ? fleet.recommended_action : record.recommended_next_action
    };
  });
}

function predictionEtaBucketHours(v = {}) {
  const predicted = parseScheduleTime(v.predicted_arrival_time || v.eta || v.eta_candidate || v.pilot_time || v.movement_time);
  if (!predicted) return null;
  return Math.round(((predicted.getTime() - Date.now()) / 36e5) * 10) / 10;
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
    if (record.is_anchorage_waiting || hasAnchorageSignal(record) || Number(record.anchorage_hours || 0) > 0) current.anchorage += 1;
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
    context.futureCongestionScore = Math.min(100, Math.round(
      context.avgCongestion * 0.35 +
      Math.min(28, context.anchorage * 5) +
      Math.min(20, context.staying * 3) +
      Math.min(18, context.inboundPilot * 6) -
      Math.min(12, context.outboundPilot * 4) +
      Math.min(14, context.berthOccupied * 4)
    ));
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
    const routePatternConfidence = Number(record.route_pattern_confidence || 0);
    const predictionError = Number(record.prediction_error_hours);
    const feedbackBoost = Number.isFinite(predictionError)
      ? predictionError <= 12 ? 10 : predictionError <= 24 ? 5 : predictionError >= 72 ? -15 : -5
      : 0;
    const predictedCongestionScore = boundedScore(Math.max(
      Number(record.predicted_congestion_score || record.predicted_congestion || 0),
      Number(context.futureCongestionScore || 0)
    ) + (etaHours !== null && etaHours >= 0 && etaHours <= 72 ? 5 : 0));
    const anchorageProbability = boundedScore(Math.max(Number(record.anchorage_probability || 0), (
      predictedCongestionScore * 0.45 +
      Math.min(20, Number(context.avgWaitingHours || 0) / 4) +
      (commercialType ? 12 : 4) +
      (gt >= 80000 ? 12 : gt >= 30000 ? 9 : gt >= COMMERCIAL_GT_THRESHOLD ? 5 : 0)
    )));
    const predictedWorkWindowHours = Number(record.predicted_work_window_hours || 0) ||
      (record.etd && !record.atd ? Math.max(0, Math.round(hoursBetween(new Date().toISOString(), record.etd) || 0)) : 0) ||
      (String(record.pilot_direction || record.movement_type || "").toLowerCase() === "outbound" ? 0 : Math.min(96, Math.max(12, Number(context.avgStayHours || context.avgWaitingHours || record.stay_hours || 0) / 2)));
    const etaProximityScore = etaHours === null ? 0 : etaHours >= 0 && etaHours <= 24 ? 30 : etaHours <= 72 ? 24 : etaHours <= 168 ? 14 : 0;
    const arrivalOpportunityScore = boundedScore(Math.max(Number(record.arrival_opportunity_score || 0), (
      etaProximityScore +
      (gt >= 80000 ? 18 : gt >= 30000 ? 14 : gt >= COMMERCIAL_GT_THRESHOLD ? 9 : 0) +
      (commercialType ? 14 : 5) +
      Math.round(predictedCongestionScore * 0.16) +
      Math.round(anchorageProbability * 0.12) +
      Math.min(12, Number(record.route_bonus || 0)) +
      (record.operator_name || record.operator ? 4 : 0)
    )));
    const predictedPipeline = Boolean(
      record.predicted_arrival_pipeline ||
      record.status_bucket === "arriving_soon" ||
      (etaHours !== null && etaHours >= 0 && etaHours <= 168 && arrivalOpportunityScore >= 35)
    );
    const confidence = boundedScore(Math.max(Number(record.arrival_prediction_confidence || 0), 25) + Math.round(routePatternConfidence * 0.15) + (record.pilot_schedule_matched ? 15 : 0) + feedbackBoost);
    return {
      ...record,
      predicted_congestion_score: predictedCongestionScore,
      congestion_forecast_band: forecastBand(predictedCongestionScore),
      anchorage_probability: anchorageProbability,
      predicted_work_window_hours: predictedWorkWindowHours,
      work_window_confidence: boundedScore(Number(record.work_window_confidence || 0) || (predictedWorkWindowHours > 0 ? 45 : 15) + (record.pilot_schedule_matched ? 15 : 0)),
      arrival_opportunity_score: arrivalOpportunityScore,
      arrival_prediction_confidence: confidence,
      predicted_arrival_window_hours: etaHours,
      predicted_arrival_pipeline: predictedPipeline,
      route_pattern_confidence: boundedScore(routePatternConfidence + feedbackBoost),
      route_pattern_confidence_adjustment: feedbackBoost,
      prediction_feedback_status: Number.isFinite(predictionError) ? predictionError <= 24 ? "accurate" : "needs_calibration" : "pending_actual_arrival"
    };
  });
}

function buildPredictedArrivals(records = []) {
  return sortCommercialPriority(records.filter(hasArrivalPipelineSignal))
    .sort((a, b) =>
      Number(b.arrival_opportunity_score || 0) - Number(a.arrival_opportunity_score || 0) ||
      Number(b.anchorage_probability || 0) - Number(a.anchorage_probability || 0) ||
      Number(b.predicted_congestion_score || 0) - Number(a.predicted_congestion_score || 0) ||
      Number(b.arrival_prediction_confidence || 0) - Number(a.arrival_prediction_confidence || 0)
    )
    .slice(0, 200)
    .map(v => ({
      ...v,
      destination_port: v.destination_port || v.destination || v.next_port || v.port_name || v.port,
      eta: v.eta || v.eta_candidate || v.predicted_arrival_time || v.arrival_time || "",
      etb: v.etb || v.etb_candidate || "",
      predicted_arrival_time: v.predicted_arrival_time || v.eta || v.eta_candidate || "",
      congestion_forecast_band: v.congestion_forecast_band || forecastBand(v.predicted_congestion_score || v.predicted_congestion || 0),
      biofouling_exposure_band: v.biofouling_exposure_band || biofoulingExposureBand(v.biofouling_exposure_score),
      biofouling_exposure_reasons: v.biofouling_exposure_reasons || [],
      arrival_window_bucket: Number(v.predicted_arrival_window_hours) <= 24 ? "ETA_LT_24H" : Number(v.predicted_arrival_window_hours) <= 72 ? "ETA_LT_72H" : Number(v.predicted_arrival_window_hours) <= 168 ? "ETA_LT_7D" : "ETA_UNKNOWN",
      source_names: displaySources(v),
      confidence_score: firstFiniteNumber(v.arrival_prediction_confidence, v.data_confidence_score, v.confidence_score, 0),
      reason_summary: v.reason_summary || arrivalPipelineReason(v),
      recommended_action: v.recommended_action || "입항 예정 시간과 대리점 연락 가능 여부를 확인하세요.",
      vessel_display: vesselDisplay({ ...v, priority_label: v.priority_label || salesPriorityBand(salesPriorityScore(v)) })
    }));
}

function buildAnchorageWaiting(records = []) {
  return sortCommercialPriority(records.filter(hasAnchorageWaitingSignal))
    .slice(0, 500)
    .map(v => {
      const waitingHours = firstFiniteNumber(v.waiting_hours, v.anchorage_hours, v.estimated_waiting_time, v.stay_hours, v.current_call_stay_hours, v.cumulative_stay_hours, 0);
      return {
        ...v,
        port: v.port_name || v.port || v.destination_port || v.destination || "",
        anchorage_area: firstNonEmpty(v.anchorage_area, v.anchorage_name, v.anchorage_zone, v.berth_name, v.berth, v.location_area, v.area_name),
        waiting_hours: waitingHours,
        stay_hours: firstFiniteNumber(v.stay_hours, v.current_call_stay_hours, v.cumulative_stay_hours, waitingHours, 0),
        reason_summary: v.reason_summary || anchorageWaitingReason(v),
        confidence_score: firstFiniteNumber(v.data_confidence_score, v.confidence_score, v.candidate_confidence, 0),
        vessel_display: vesselDisplay({ ...v, priority_label: v.priority_label || salesPriorityBand(salesPriorityScore(v)) })
      };
    });
}

function buildPredictedCleaningOpportunities(records = []) {
  return sortCommercialPriority(records
    .filter(v => hasUsefulVesselIdentity(v) && (Number(v.predicted_cleaning_opportunity_score || 0) >= 35 || Number(v.commercial_value_score || 0) >= 50))
    .sort((a, b) =>
      Number(b.predicted_cleaning_opportunity_score || 0) - Number(a.predicted_cleaning_opportunity_score || 0) ||
      Number(b.work_feasibility_score || 0) - Number(a.work_feasibility_score || 0) ||
      Number(b.commercial_value_score || 0) - Number(a.commercial_value_score || 0)
    )
    .slice(0, 10)
    .map(v => ({
      ...v,
      cleaning_opportunity_band: v.cleaning_opportunity_band || cleaningOpportunityBand(v.predicted_cleaning_opportunity_score),
      opportunity_summary: v.opportunity_summary || buildOpportunitySummary(v)
    })));
}

function hasValue(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === "number") return Number.isFinite(value) && value > 0;
  return String(value).trim() !== "";
}

function hasUsefulVesselIdentity(v = {}) {
  const name = String(v.vessel_name || v.name || "").trim();
  const port = String(v.port_name || v.port || v.port_code || "").trim();
  const identity = String(v.call_sign || v.imo || v.mmsi || v.hybrid_entity_key || v.port_call_identity || "").trim();
  if (!name && !identity) return false;
  if (/^korea$/i.test(port) && !name && !identity) return false;
  return true;
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

  const companyContactAvailable = hasValue(v.operator_website || v.operator_url || v.agent_website || v.agent_url || v.operator_email || v.agent_email || v.operator_phone || v.agent_phone || v.contact_email || v.contact_phone || v.general_email || v.operations_email || v.chartering_email || v.purchasing_email || v.technical_email);
  const repeatSignal = Number(v.repeat_operator_score || v.repeat_caller_score || 0) > 0 ? 5 : 0;
  const contactPathAvailable = Boolean(operatorName || currentAgent || companyContactAvailable);
  const contactIntelligenceScore = (operatorName ? 3 : 0) + (currentAgent ? 2 : 0) + (contactPathAvailable ? 3 : 0);
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
    contact_path_status: deriveContactPathStatus({
      ...v,
      operator_name: operatorName,
      agent_name: currentAgent,
      operator_confidence: operatorConfidence,
      contact_path_available: contactPathAvailable
    }),
    contact_priority: deriveContactPriority({
      ...v,
      operator_name: operatorName,
      agent_name: currentAgent,
      operator_confidence: operatorConfidence,
      contact_path_available: contactPathAvailable
    }),
    contact_path_label_ko: contactPathLabelKo({
      ...v,
      operator_name: operatorName,
      agent_name: currentAgent,
      operator_confidence: operatorConfidence,
      contact_path_available: contactPathAvailable
    }),
    contact_intelligence_score: contactIntelligenceScore,
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
  const meaningfulWaitingDays = Math.max(0, commercialWaitingDays(v, metrics) - 3);
  const biofoulingRiskScore = Math.min(15, Math.round(Math.min(5, stayDays * 0.55) + Math.min(5, anchorageDays * 0.9) + (isBulkTankerPctc ? 2 : isCommercialType ? 1 : 0) + Math.min(2, routeProfile.biosecurity_exposure_score / 35) + (isVeryHighGt ? 1 : 0)));
  const performanceProxyScore = Math.min(10, Math.round(Math.min(3, meaningfulWaitingDays * 0.8) + (Number(v.speed || 0) > 0 && Number(v.speed || 0) < 1.5 ? 2 : 0) + (isHighGt ? 2 : meetsCommercialGtThreshold ? 1 : 0) + (isBulkTankerPctc ? 1 : 0) + Math.min(2, routeProfile.fuel_efficiency_sensitivity_score / 35)));
  const congestionExposureScore = Math.min(10, Math.round((minimumCongestionScore / 100) * 10));
  const openWindow = Number(metrics.work_window_hours || 0);
  const unknownOrFarEtd = !v.etd || openWindow >= 24 || v.work_window_status === "open_or_ongoing";
  const cleaningWindowScore = Math.min(20, Math.max(0, Math.round(
    Math.min(8, openWindow / 5) +
    (isStayingWithoutDeparture ? 4 : 0) +
    (unknownOrFarEtd ? 2 : 0) +
    ((isAnchorageWaiting || v.berth_class === "anchorage") ? 3 : 0) +
    (v.berth || v.berth_name ? 1 : 0) +
    (enrichmentMatched ? 1 : 0) +
    (pilotMatched && !outboundPilotSoon ? 1 : 0) -
    (outboundPilotSoon ? 4 : 0) -
    (terminalActive ? 3 : 0)
  )));
  const compliancePressureScore = Math.min(10, Math.round(Math.round(routeProfile.biosecurity_exposure_score / 25) + Math.round(routeProfile.esg_sensitivity_score / 40) + (isHighGt ? 2 : meetsCommercialGtThreshold ? 1 : 0) + (isBulkTankerPctc ? 1 : 0)));
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
  const gtBonus = gt >= 150000 ? 10 : gt >= 80000 ? 8 : gt >= 30000 ? 5 : meetsCommercialGtThreshold ? 2 : 0;
  const typeBonus = /lng|lpg/.test(type) ? 4 : isBulkTankerPctc || /container|cruise/.test(type) ? 5 : /general|cargo|일반화물/.test(type) ? 2 : 0;
  const vesselValueScore = Math.min(20, Math.max(0, Math.round(gtBonus + typeBonus + Math.min(3, configuredCommercialFit) - (isExcludedType ? 10 : 0))));
  const contactIntelligenceScore = Number(v.contact_intelligence_score ?? ((v.operator ? 3 : 0) + (v.agent ? 2 : 0) + (v.contact_path_available ? 3 : 0)));
  const salesAccessibilityScore = Math.min(5, Math.round(contactIntelligenceScore));
  const dataCompletenessAssistScore = Math.min(10, Math.round(Number(v.vessel_basic_info_completeness_score || v.data_confidence_score || 0) / 10));
  const total = vesselValueScore + cleaningWindowScore + biofoulingRiskScore + congestionExposureScore + performanceProxyScore + compliancePressureScore + salesAccessibilityScore + dataCompletenessAssistScore;
  const reasonCodes = [];
  if (anchorageDays >= 3) reasonCodes.push("LONG_ANCHORAGE_WAIT");
  if (congestionExposureScore >= 10) reasonCodes.push("PORT_CONGESTION_HIGH");
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
  reasonCodes.push(...(predictiveSignals.biofouling_exposure_reasons || []));
  if (predictiveSignals.repeat_caller_score >= 60) reasonCodes.push("REPEAT_CALLER_SIGNAL");
  if (Number(predictiveSignals.repeat_call_count || 0) >= 3) reasonCodes.push("REPEAT_CALLER");
  if (Number(predictiveSignals.repeat_operator_count || 0) >= 3) reasonCodes.push("REPEAT_OPERATOR_CALL");
  reasonCodes.push(...routeProfile.route_reason_codes);
  if (Number(metrics.work_window_hours || 0) >= 24) reasonCodes.push("BERTH_WINDOW_AVAILABLE");
  return {
    vessel_value_score: vesselValueScore,
    biofouling_risk_score: biofoulingRiskScore,
    performance_proxy_score: performanceProxyScore,
    congestion_exposure_score: congestionExposureScore,
    congestion_score: minimumCongestionScore,
    cleaning_window_score: cleaningWindowScore,
    compliance_pressure_score: compliancePressureScore,
    sales_accessibility_score: salesAccessibilityScore,
    contact_intelligence_score: contactIntelligenceScore,
    data_completeness_assist_score: dataCompletenessAssistScore,
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
    Number(scoreParts.cleaning_window_score || 0) +
    Number(scoreParts.biofouling_risk_score || 0) +
    Number(scoreParts.congestion_exposure_score || 0) +
    Number(scoreParts.performance_proxy_score || 0) +
    Number(scoreParts.compliance_pressure_score || 0) +
    Number(scoreParts.sales_accessibility_score || 0) +
    Number(scoreParts.data_completeness_assist_score || 0)
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
  if (leadPriorityScore >= IMMEDIATE_TARGET_THRESHOLD && (v.contact_path_available || ["contact_available", "high_confidence_contact"].includes(v.contact_path_status) || Number(v.contact_readiness_score || 0) >= 50)) return "contact_ready";
  if (Number(v.commercial_value_score || v.total_sales_priority_score || 0) >= IMMEDIATE_TARGET_THRESHOLD) return "new_lead";
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
  const stayHours = Number(metrics.stay_hours ?? v.stay_hours ?? 0);
  const anchorageHours = Number(metrics.anchorage_hours ?? v.anchorage_hours ?? 0);
  const workWindowHours = Number(metrics.work_window_hours ?? v.work_window_hours ?? 0);
  const gt = Number(v.gt || v.grtg || v.intrlGrtg || 0);
  const score = Number(v.commercial_value_score || v.total_sales_priority_score || 0);
  const congestion = Number(v.congestion_score || v.port_congestion_score || v.congestion_exposure_score || 0);
  const workFeasibility = Number(v.work_feasibility_score || v.cleaning_window_score || 0);
  const routeProfile = deriveRouteCommercialProfile(v);
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
  if (routeProfile.high_regulation_route) signals.push(`${routeProfile.route_region} 항로 민감도가 있습니다`);
  if (v.agent_name || v.agent || v.operator_name || v.operator) signals.push("연락 경로 단서가 있습니다");
  if (score >= 75) signals.push("상업 가치 점수가 즉시 검토권입니다");
  return `${location}에서 ${duration}인 ${vesselValue}으로, ${signals.slice(0, 3).join(" · ") || "상업 신호 보강이 필요합니다"}.`;
}

function deriveRecommendedNextAction(v = {}, leadPriorityScore = 0) {
  const outboundSoon = String(v.pilot_direction || v.movement_type || "").toLowerCase() === "outbound" || (v.etd && !v.atd && Number(v.work_window_hours || 0) <= 12);
  const score = Number(v.commercial_value_score || v.total_sales_priority_score || 0);
  const contactReadiness = Number(v.contact_readiness_score || 0);
  const workFeasibility = Number(v.work_feasibility_score || v.cleaning_window_score || 0);
  const arrivalWindow = Number(v.predicted_arrival_window_hours);
  const hasAgent = Boolean(v.agent_name || v.agent);
  const hasOperator = Boolean(v.operator_name || v.operator);
  if (outboundSoon) return "도선/출항 전 재확인";
  if (Number.isFinite(arrivalWindow) && arrivalWindow > 0 && arrivalWindow <= 48) return "ETA 48h 전 연락";
  if (!hasAgent) return "대리점 확인";
  if (!hasOperator) return "운영선사 확인";
  if (score >= IMMEDIATE_TARGET_THRESHOLD && contactReadiness >= 60 && workFeasibility >= 50) return "견적 발송";
  if (leadPriorityScore >= IMMEDIATE_TARGET_THRESHOLD || score >= IMMEDIATE_TARGET_THRESHOLD) return "대리점 확인 후 견적 제안";
  if (score >= SALES_CANDIDATE_THRESHOLD) return "선박 스케줄 확인 후 영업 검토";
  return "선박 스케줄 확인";
}

function deriveActionPriority(v = {}, action = "") {
  const score = Number(v.commercial_value_score || v.total_sales_priority_score || 0);
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
  const now = Date.now();
  const arrivalWindow = Number(v.predicted_arrival_window_hours);
  const workWindow = Number(v.work_window_hours || v.predicted_work_window_hours || 0);
  const action = v.recommended_action || v.recommended_next_action || "";
  const days = /출항 전|견적 발송/.test(action) || workWindow > 0
    ? 1
    : Number.isFinite(arrivalWindow) && arrivalWindow > 48
      ? Math.max(1, Math.min(5, Math.floor((arrivalWindow - 48) / 24)))
      : Number(v.commercial_value_score || v.total_sales_priority_score || 0) >= IMMEDIATE_TARGET_THRESHOLD
        ? 1
        : 3;
  return new Date(now + days * 86400000).toISOString().slice(0, 10);
}

function deriveRecommendedEmailDraft(v = {}) {
  const vessel = v.vessel_name || "해당 선박";
  const port = v.port_name || v.port || "한국 항만";
  const why = v.why_now || deriveWhyNow(v);
  const action = v.recommended_action || v.recommended_next_action || "선박 스케줄 확인";
  const contactPath = v.recommended_contact_path || deriveRecommendedContactPath(v);
  return `안녕하세요.\n\n${vessel} 관련하여 ${port} 기항 중 수중 선체관리 가능성을 검토하고 있습니다.\n${why}\n\n권장 다음 단계: ${action}\n연락 경로: ${contactPath}\n\n가능하시면 현재 작업/출항 일정과 선체관리 검토 가능 여부를 확인 부탁드립니다.`;
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
  const commercialValueScore = Number(v.commercial_value_score || v.total_sales_priority_score || 0);
  const leadPriorityScore = boundedScore(
    commercialValueScore * 0.5 +
    Number(v.contact_readiness_score || 0) * 0.25 +
    workFeasibilityScore * 0.25
  );
  const autoLeadCreated = commercialValueScore >= IMMEDIATE_TARGET_THRESHOLD;
  const recommendedAction = deriveRecommendedNextAction(v, leadPriorityScore);
  const copilotContext = { ...v, recommended_action: recommendedAction, recommended_next_action: recommendedAction };
  const recommendedContactPath = deriveRecommendedContactPath(copilotContext);
  return {
    work_feasibility_score: workFeasibilityScore,
    lead_priority_score: leadPriorityScore,
    lead_status: deriveLeadStatus(v, leadPriorityScore),
    auto_lead_created: autoLeadCreated,
    lead_created_reason: autoLeadCreated ? "commercial_value_score_75_plus" : "",
    why_now: deriveWhyNow(v, metrics),
    candidate_summary_ko: deriveCandidateSummaryKo(v),
    sales_angle: deriveSalesAngle(v, metrics),
    recommended_next_action: recommendedAction,
    recommended_action: recommendedAction,
    action_priority: deriveActionPriority(v, recommendedAction),
    recommended_contact_path: recommendedContactPath,
    recommended_department: deriveRecommendedDepartment(copilotContext),
    recommended_email_draft: deriveRecommendedEmailDraft({ ...copilotContext, recommended_contact_path: recommendedContactPath }),
    recommended_followup_date: deriveRecommendedFollowupDate(copilotContext),
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

function deriveDataQualityScore(v = {}) {
  const vesselType = String(v.vessel_type_group || v.vessel_type || v.vsslKndNm || "").toLowerCase();
  const hasVesselType = Boolean(vesselType && vesselType !== "unknown");
  const hasGt = Number(v.gt || v.grtg || v.intrlGrtg || 0) > 0;
  const hasBerthFacility = Boolean(v.berth_name || v.berth || v.anchorage_name || v.anchorage_zone || v.laidupFcltyNm || v.facility_name_raw);
  const hasSchedule = Boolean(v.ata || v.atd || v.etd);
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
  const bounded = Math.min(100, score);
  return {
    data_quality_score: bounded,
    data_quality_band: bounded >= 80 ? "high" : bounded >= 60 ? "medium" : bounded >= 40 ? "low" : "needs_cleanup",
    data_quality_inputs: {
      gt_available: hasGt,
      imo_available: Boolean(v.imo),
      call_sign_available: Boolean(v.call_sign),
      vessel_type_available: hasVesselType,
      ata_available: Boolean(v.ata),
      atd_or_etd_available: Boolean(v.atd || v.etd),
      berth_or_facility_available: hasBerthFacility,
      operator_known: Boolean(v.operator_name || v.operator),
      agent_known: Boolean(v.agent_name || v.agent || v.satmntEntrpsNm || v.entrpsCdNm),
      schedule_available: hasSchedule
    }
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
  if ((facilityType === "anchorage" || hasAnchorageWaitingSignal(v) || (metrics.anchorage_hours || 0) > 0) && !atd) return "anchorage_waiting";
  if ((facilityType === "berth" || /berth|moored|alongside/.test(status) || v.berth || v.berth_name || v.atb) && !atd) return "berthed";
  if (ata && !atd) return "arrived_staying";
  if ((eta && !ata && eta.getTime() >= now.getTime()) || hasArrivalPipelineSignal(v)) return "arriving_soon";
  if (/departed|departure_completed|출항 완료/i.test(status)) return "departed";
  if (etdCandidate && !atd) return "arrived_staying";
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

function commercialWaitingDays(v = {}, metrics = {}) {
  const anchorageHours = Number(metrics.anchorage_hours ?? v.anchorage_hours ?? 0);
  const stayHours = Number(metrics.stay_hours ?? v.stay_hours ?? v.current_call_stay_hours ?? v.cumulative_stay_hours ?? 0);
  return Math.max(anchorageHours, stayHours) / 24;
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
  if (gt >= COMMERCIAL_GT_THRESHOLD) return 1;
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

function deriveCongestionScore(v = {}, metrics = {}) {
  const anchorageHours = Number(metrics.anchorage_hours ?? v.anchorage_hours ?? 0);
  const stayHours = Number(metrics.stay_hours ?? v.stay_hours ?? v.current_call_stay_hours ?? v.cumulative_stay_hours ?? 0);
  const waitingDays = Math.max(anchorageHours, stayHours) / 24;
  const durationSignal = waitingDurationSignal(waitingDays);
  const combinedSignal = durationSignal * commercialGtWeight(v) * commercialTypeWeight(v) * portRelevanceWeight(v);
  const externalPortSignal = Math.min(15, Number(v.port_congestion_score || 0) * 0.15);
  const densitySignal = Math.min(10, Number(v.anchorage_density_score || 0) * 0.1);
  return Math.min(100, Math.round(Math.max(0, combinedSignal + externalPortSignal + densitySignal)));
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
  if (!hasUsefulVesselIdentity(v) || isDepartedRecord(v) || isExplicitlyExcluded(v)) return false;
  return ["target_vessel", "unknown_gt_review"].includes(v.commercial_relevance_status) || score >= REVIEW_TARGET_THRESHOLD || hasSalesRelevantSignal(v);
}

function isExplicitlyExcluded(v = {}) {
  const gt = Number(v.gt || v.grtg || v.intrlGrtg || 0);
  const score = Number(v.commercial_value_score || v.total_sales_priority_score || v.cleaning_candidate_score || 0);
  return (v.commercial_relevance_status === "excluded_non_commercial_type" && score < SALES_CANDIDATE_THRESHOLD) ||
    (v.commercial_relevance_status === "excluded_departure_only" && score < SALES_CANDIDATE_THRESHOLD) ||
    (v.commercial_relevance_status === "non_target_small_vessel" && gt > 0 && gt < COMMERCIAL_GT_THRESHOLD && score < SALES_CANDIDATE_THRESHOLD) ||
    v.excluded_from_commercial_targets === true;
}

function isSyntheticSample(v = {}) {
  const text = [v.vessel_name, v.name, v.source, v.source_name, v.data_mode].filter(Boolean).join(" ").toLowerCase();
  return /sample|demo|yeosu target|mv hf zhoushan|maersk demo/.test(text);
}

function isHardCandidateExcluded(v = {}) {
  const score = Number(v.commercial_value_score || v.total_sales_priority_score || v.cleaning_candidate_score || 0);
  if (isDepartedRecord(v)) return true;
  return (v.commercial_relevance_status === "excluded_non_commercial_type" && score < SALES_CANDIDATE_THRESHOLD) ||
    v.excluded_from_commercial_targets === true ||
    isSyntheticSample(v);
}

function hasPortSignal(v = {}) {
  return hasValue(v.port_code || v.port_name || v.port || v.destination_port || v.destination || v.berth_name || v.berth || v.anchorage_name || v.sub_port);
}

function hasScheduleSignal(v = {}) {
  return hasValue(v.eta || v.etb || v.ata || v.atb || v.etd || v.atd || v.predicted_arrival_time || v.last_seen_at || v.collected_at);
}

function hasDurationSignal(v = {}) {
  return Number(v.stay_hours || v.current_call_stay_hours || v.cumulative_stay_hours || v.anchorage_hours || v.berth_hours || 0) > 0 ||
    Boolean(v.is_anchorage_waiting || v.long_stay || v.long_anchorage_wait);
}

function hasScoreSignal(v = {}) {
  return Number(v.commercial_value_score || v.total_sales_priority_score || v.cleaning_candidate_score || v.opportunity_score || v.sales_score || 0) >= REVIEW_TARGET_THRESHOLD;
}

function hasRiskSignal(v = {}) {
  return Number(v.risk_score || v.biofouling_exposure_score || v.biofouling_risk_score || v.biofouling_score || v.operational_risk_score || 0) >= 50;
}

function hasSalesRelevantSignal(v = {}) {
  if (!hasUsefulVesselIdentity(v) || isHardCandidateExcluded(v)) return false;
  const gt = Number(v.gt || v.grtg || v.intrlGrtg || 0);
  const commercialStatus = v.commercial_relevance_status || "";
  return hasScoreSignal(v) ||
    hasRiskSignal(v) ||
    hasDurationSignal(v) ||
    hasAnchorageWaitingSignal(v) ||
    hasArrivalPipelineSignal(v) ||
    regulatedRouteSignal(v) ||
    Boolean(v.predicted_arrival_pipeline || v.contact_path_available || v.agent || v.agent_name || v.operator || v.operator_name) ||
    (hasPortSignal(v) && hasScheduleSignal(v) && (gt >= COMMERCIAL_GT_THRESHOLD || commercialStatus === "unknown_gt_review" || commercialStatus === "target_vessel"));
}

function isSalesCandidate(v = {}) {
  const score = Number(v.commercial_value_score || v.total_sales_priority_score || v.cleaning_candidate_score || 0);
  return !isDepartedRecord(v) &&
    !isHardCandidateExcluded(v) &&
    hasUsefulVesselIdentity(v) &&
    (score >= SALES_CANDIDATE_THRESHOLD || hasSalesRelevantSignal(v));
}

function isImmediateTarget(v = {}) {
  const score = Number(v.commercial_value_score || v.total_sales_priority_score || v.cleaning_candidate_score || 0);
  const risk = Number(v.risk_score || v.biofouling_exposure_score || v.biofouling_risk_score || v.biofouling_score || v.operational_risk_score || 0);
  const stayHours = Number(v.stay_hours || v.current_call_stay_hours || v.cumulative_stay_hours || v.anchorage_hours || 0);
  const gt = Number(v.gt || v.grtg || v.intrlGrtg || 0);
  const typeText = String(v.vessel_type || v.vessel_type_group || v.commercial_segment || "").toLowerCase();
  const priorityLabel = String(v.priority_label || v.sales_priority_band || "").toUpperCase();
  const strongTrigger =
    priorityLabel === "HOT" ||
    score >= IMMEDIATE_TARGET_THRESHOLD ||
    risk >= 70 ||
    stayHours >= 72 ||
    (hasAnchorageWaitingSignal(v) && score >= 50) ||
    (hasArrivalPipelineSignal(v) && score >= 50) ||
    (gt >= 30000 && score >= 45) ||
    (/bulk|tanker|container|cargo|carrier|pctc|ro-ro|lng|lpg/.test(typeText) && score >= 45) ||
    (regulatedRouteSignal(v) && score >= 45) ||
    (Boolean(v.operator || v.operator_name || v.owner || v.owner_name || v.manager || v.manager_name) && score >= 55) ||
    (Number(v.korea_call_count || v.repeat_korea_call_count || v.visit_count || 0) >= 2 && score >= 50);
  return !isDepartedRecord(v) &&
    !isHardCandidateExcluded(v) &&
    hasUsefulVesselIdentity(v) &&
    strongTrigger &&
    (hasCurrentOrNearTermWorkFeasibility(v) || hasAnchorageWaitingSignal(v) || hasArrivalPipelineSignal(v) || stayHours >= 72 || score >= IMMEDIATE_TARGET_THRESHOLD) &&
    v.commercial_relevance_status !== "excluded_departure_only";
}

function isWatchlistVessel(v = {}) {
  const score = Number(v.commercial_value_score || v.total_sales_priority_score || v.cleaning_candidate_score || 0);
  return !isDepartedRecord(v) && !isHardCandidateExcluded(v) && score >= 50 && score < SALES_CANDIDATE_THRESHOLD;
}

function annotateTargetClassification(records = []) {
  annotateCommercialRanks(records);
  for (const vessel of records) {
    const score = Number(vessel.commercial_value_score || vessel.total_sales_priority_score || vessel.cleaning_candidate_score || 0);
    const priorityScore = salesPriorityScore(vessel);
    const salesCandidateFlag = isSalesCandidate(vessel) || hasSalesRelevantSignal(vessel) || isMainCommercialVessel(vessel);
    const immediateFlag = isImmediateTarget(vessel);
    vessel.is_cleaning_candidate = salesCandidateFlag;
    vessel.is_immediate_candidate = immediateFlag;
    vessel.is_operating_candidate = vessel.is_cleaning_candidate;
    vessel.is_operating_immediate_candidate = vessel.is_immediate_candidate;
    vessel.candidate_band = immediateFlag && score >= CRITICAL_TARGET_THRESHOLD
      ? "critical"
      : immediateFlag
        ? "immediate_target"
        : salesCandidateFlag
          ? "sales_target"
          : isWatchlistVessel(vessel)
            ? "watchlist"
            : "general";
    vessel.priority_label = salesPriorityBand(priorityScore);
    vessel.sales_priority_band = vessel.priority_label;
    vessel.vessel_display = vesselDisplay(vessel);
  }
  return records;
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
    ...arrivalPrediction,
    ...predictiveSignals
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
let rawArchiveIndex = { status: "not_indexed" };
let vessels = [];
let collectedRows = [];
let collectorDiagnosticsAfterCollection = {};
let vesselMasterCacheDiagnostics = {};
let startupConfigDiagnostics = configDiagnostics();
let runtimeConfigAudit = buildRuntimeConfigAudit();

function ensureDirs() {
  fs.mkdirSync("dashboard/api", { recursive: true });
  fs.mkdirSync(DEBUG_API_DIR, { recursive: true });
  fs.mkdirSync("data/cache", { recursive: true });
  fs.mkdirSync("data/history", { recursive: true });
  fs.mkdirSync("data/reports", { recursive: true });
  fs.mkdirSync("public", { recursive: true });
}

function shouldWriteDebugApiOutputs(report = {}) {
  const dataMode = String(report?.data_mode || report?.data_mode_detail?.mode || "").toLowerCase();
  const recordCount = Number(report?.record_count || 0);
  const allVesselsCount = Number(report?.all_collected_vessel_count || report?.all_vessels_count || 0);
  const supabaseStorageStatus = String(report?.storage_status?.supabase?.status || report?.supabase_write?.status || "").toLowerCase();
  const productionStorageNotCompleted = VALIDATION_MODE === "production" &&
    ["failed", "syncing", "pending", "unknown", "not_configured", ""].includes(supabaseStorageStatus);
  const productionFallbackActive = VALIDATION_MODE === "production" && report?.fallback_used === true;
  return dataMode === "no_live_data" ||
    dataMode === "degraded_sample_only" ||
    recordCount <= 0 ||
    allVesselsCount <= 0 ||
    productionStorageNotCompleted ||
    productionFallbackActive;
}

function routeApiOutputPath(filePath, report = {}) {
  const normalized = String(filePath || "").replace(/\\/g, "/");
  if (!shouldWriteDebugApiOutputs(report) || !normalized.startsWith("dashboard/api/")) return normalized;
  return `${DEBUG_API_DIR}/${normalized.slice("dashboard/api/".length)}`;
}

function writeApiJson(filePath, payload, report = {}) {
  const target = routeApiOutputPath(filePath, report);
  fs.mkdirSync(target.split("/").slice(0, -1).join("/"), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(payload, null, 2));
  const normalized = String(filePath || "").replace(/\\/g, "/");
  const existingPayload = target !== normalized && normalized.startsWith("dashboard/api/") && fs.existsSync(normalized)
    ? readJsonSafe(normalized, null)
    : null;
  const shouldBackfillEmptyStatic = existingPayload &&
    contractDataMode(existingPayload.data_mode) !== "live" &&
    rowCountFromPayload(existingPayload) === 0 &&
    rowCountFromPayload(payload) > 0;
  const shouldRefreshNonLiveStatic = existingPayload &&
    contractDataMode(existingPayload.data_mode) !== "live" &&
    contractDataMode(payload?.data_mode, report) !== "live" &&
    rowCountFromPayload(payload) > 0 &&
    String(payload?.generated_at || "") > String(existingPayload?.generated_at || "");
  if (target !== normalized && normalized.startsWith("dashboard/api/") && (!fs.existsSync(normalized) || shouldBackfillEmptyStatic || shouldRefreshNonLiveStatic)) {
    fs.mkdirSync(normalized.split("/").slice(0, -1).join("/"), { recursive: true });
    fs.writeFileSync(normalized, JSON.stringify(payload, null, 2));
  }
  return target;
}

function readJsonSafe(filePath, fallback = null) {
  try {
    return fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, "utf8")) : fallback;
  } catch {
    return fallback;
  }
}

function rowCountFromPayload(payload) {
  if (Array.isArray(payload)) return payload.length;
  if (Array.isArray(payload?.data)) return payload.data.length;
  if (Array.isArray(payload?.items)) return payload.items.length;
  if (Array.isArray(payload?.vessels)) return payload.vessels.length;
  if (Array.isArray(payload?.candidates)) return payload.candidates.length;
  if (Array.isArray(payload?.opportunities)) return payload.opportunities.length;
  if (payload && typeof payload === "object") {
    return Number(payload.all_vessels_count || payload.all_collected_vessel_count || payload.record_count || payload.target_vessels_count || payload.candidate_count || 0);
  }
  return 0;
}

function loadSuccessfulDatasetManifest() {
  return readJsonSafe(SUCCESSFUL_DATASET_MANIFEST, null);
}

function saveSuccessfulDatasetBundle({ report = {}, dashboardSummary = {}, healthPayload = {}, outputs = {}, generatedAt = new Date().toISOString() } = {}) {
  const rows = Number(report.all_collected_vessel_count || rowCountFromPayload(outputs["dashboard/api/all-collected-vessels.json"]) || 0);
  const promotionBlockers = Array.isArray(report.promotion_blockers) ? report.promotion_blockers.filter(Boolean) : [];
  const promotionStatus = String(report.promotion_status || "").toLowerCase();
  const promotionSuccessful = !promotionStatus || ["promoted", "completed", "not_needed"].includes(promotionStatus);
  const storedSuccessfully = isSupabaseWriteCompleted(report.supabase_write?.status) && promotionSuccessful && promotionBlockers.length === 0;
  if (rows <= 0 || !storedSuccessfully || report.fallback_used === true || shouldWriteDebugApiOutputs(report)) {
    return {
      status: "skipped",
      reason: rows <= 0 ? "empty_dataset" : report.fallback_used ? "fallback_run" : promotionBlockers.length ? `promotion_blocked:${promotionBlockers.join(",")}` : "not_successful_dataset",
      rows
    };
  }

  const snapshotId = report.run_id || `snapshot_${generatedAt.replace(/[:.]/g, "")}`;
  const dir = `${SUCCESSFUL_DATASET_DIR}/${snapshotId}`;
  fs.mkdirSync(dir, { recursive: true });
  const files = {
    "dashboard/api/dashboard-summary.json": dashboardSummary,
    "dashboard/api/status.json": report,
    "dashboard/api/health.json": healthPayload,
    ...outputs
  };
  const fileManifest = [];
  for (const [filePath, payload] of Object.entries(files)) {
    const normalized = String(filePath).replace(/\\/g, "/");
    const target = `${dir}/${normalized}`;
    fs.mkdirSync(target.split("/").slice(0, -1).join("/"), { recursive: true });
    fs.writeFileSync(target, JSON.stringify(payload, null, 2));
    fileManifest.push({
      path: normalized,
      rows: rowCountFromPayload(payload),
      bytes: Buffer.byteLength(JSON.stringify(payload))
    });
  }
  const manifest = {
    status: "saved",
    snapshot_id: snapshotId,
    run_id: report.run_id || null,
    generated_at: generatedAt,
    source: "successful_dataset_bundle",
    rows,
    target_vessels_count: Number(report.target_vessel_count || rowCountFromPayload(outputs["dashboard/api/target-vessels.json"]) || 0),
    sales_candidate_count: Number(report.sales_candidate_count || 0),
    immediate_target_count: Number(report.immediate_target_count || 0),
    storage_status: {
      supabase: report.supabase_write?.status || report.storage_status?.supabase?.status || "unknown",
      promotion: report.promotion_status || "unknown"
    },
    files: fileManifest
  };
  fs.writeFileSync(`${dir}/manifest.json`, JSON.stringify(manifest, null, 2));
  fs.mkdirSync(SUCCESSFUL_DATASET_DIR, { recursive: true });
  fs.writeFileSync(SUCCESSFUL_DATASET_MANIFEST, JSON.stringify(manifest, null, 2));
  return manifest;
}

function restoreSuccessfulDatasetBundle({ report = {}, outputs = {} } = {}) {
  const manifest = loadSuccessfulDatasetManifest();
  if (!manifest?.snapshot_id) {
    return {
      status: "unavailable",
      reason: "no_successful_dataset_manifest",
      rows: 0
    };
  }
  const restored = [];
  const skipped = [];
  const dir = `${SUCCESSFUL_DATASET_DIR}/${manifest.snapshot_id}`;
  const promotionBlockers = Array.isArray(report.promotion_blockers) ? report.promotion_blockers.filter(Boolean) : [];
  const forceRestore = promotionBlockers.length > 0 ||
    String(report.promotion_status || "").toLowerCase() === "not_promoted" ||
    !isSupabaseWriteCompleted(report.supabase_write?.status);
  for (const [filePath] of Object.entries(outputs)) {
    const normalized = String(filePath).replace(/\\/g, "/");
    const source = `${dir}/${normalized}`;
    if (!fs.existsSync(source)) {
      skipped.push({ path: normalized, reason: "missing_in_bundle" });
      continue;
    }
    const current = readJsonSafe(normalized, null);
    if (!forceRestore && rowCountFromPayload(current) > 0) {
      skipped.push({ path: normalized, reason: "current_output_has_rows" });
      continue;
    }
    fs.mkdirSync(normalized.split("/").slice(0, -1).join("/"), { recursive: true });
    fs.copyFileSync(source, normalized);
    restored.push(normalized);
  }
  return {
    status: restored.length ? "restored" : "not_needed",
    reason: restored.length ? "latest_successful_dataset_bundle" : "no_empty_outputs_to_restore",
    manifest_snapshot_id: manifest.snapshot_id,
    manifest_run_id: manifest.run_id || null,
    manifest_generated_at: manifest.generated_at || null,
    rows: Number(manifest.rows || 0),
    restored,
    skipped
  };
}

function buildDataContinuityReport({ report = {}, dashboardSummary = {}, healthPayload = {}, successfulDataset = {}, restoreResult = {}, generatedAt = new Date().toISOString() } = {}) {
  const manifest = loadSuccessfulDatasetManifest();
  const currentRows = Number(report.all_collected_vessel_count || report.all_vessels_count || report.record_count || 0);
  const fallbackOrder = [
    { step: 1, source: "active_dataset_pointer", status: report.active_run_id && currentRows > 0 ? "available" : "unavailable", rows: currentRows },
    { step: 2, source: "latest_successful_dataset_bundle", status: manifest?.rows > 0 ? "available" : "unavailable", rows: Number(manifest?.rows || 0), run_id: manifest?.run_id || null },
    { step: 3, source: "latest_successful_dataset", status: report.latest_successful_fallback?.latest_successful_snapshot_available ? "available" : "unavailable", rows: Number(report.latest_successful_fallback?.latest_successful_fallback_rows || 0) },
    { step: 4, source: "latest_snapshot", status: report.latest_successful_fallback?.latest_successful_fallback_source ? "available" : "unavailable", rows: Number(report.latest_successful_fallback?.latest_successful_fallback_rows || 0) },
    { step: 5, source: "static_backup", status: rowCountFromPayload(readJsonSafe("data/latest-lite.json", [])) > 0 ? "available" : "unavailable", rows: rowCountFromPayload(readJsonSafe("data/latest-lite.json", [])) },
    { step: 6, source: "sample_mode", status: "available_final_fallback", rows: 3 }
  ];
  const blocking = currentRows <= 0 || report.fallback_used === true || String(report.data_mode || "").toLowerCase() === "no_live_data";
  return {
    schema_version: PUBLIC_API_SCHEMA_VERSION,
    generated_at: generatedAt,
    status: blocking ? "fallback_active" : "healthy",
    record_count: currentRows,
    source_table: "active_dataset_pointer,latest_successful_dataset_bundle,static_dashboard_snapshot",
    objective: "Dashboard must never become empty when collection or storage fails.",
    current_run: {
      run_id: report.run_id || null,
      data_mode: report.data_mode || null,
      data_status: report.data_status || null,
      rows: currentRows,
      target_vessels_count: Number(report.target_vessel_count || 0),
      fallback_used: Boolean(report.fallback_used),
      fallback_reason: report.fallback_reason || null
    },
    storage_verification: {
      supabase_write_status: report.supabase_write?.status || report.storage_status?.supabase?.status || "unknown",
      post_write_verification_status: report.supabase_write?.post_write_verification?.status || "unknown",
      promotion_status: report.promotion_status || "unknown",
      rows_written_by_table: report.rows_written_by_table || {},
      successful_dataset_bundle_status: successfulDataset.status || "unknown",
      successful_dataset_rows: Number(successfulDataset.rows || manifest?.rows || 0),
      restore_status: restoreResult.status || "not_run"
    },
    health: {
      api_health_status: healthPayload.status || report.status || "unknown",
      summary_generated_at: dashboardSummary.generated_at || null,
      last_success_at: healthPayload.last_success_at || dashboardSummary.last_success_at || null,
      production_ready: Boolean(dashboardSummary.production_ready || report.production_ready)
    },
    fallback_order: fallbackOrder,
    operator_message_ko: blocking
      ? "현재 실행은 운영 데이터로 승격되지 않았습니다. 마지막 성공 데이터 또는 샘플 최종 fallback으로 화면을 유지합니다."
      : "현재 실행 데이터가 정상이며, 성공 데이터 묶음 저장 대상입니다."
  };
}

function withRunOrigin(payload = {}, origin = {}) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return payload;
  const runId = payload.run_id || origin.run_id || null;
  const statusRunId = payload.status_run_id || origin.status_run_id || payload.active_run_id || origin.active_run_id || runId;
  const activeRunId = payload.active_run_id || origin.active_run_id || statusRunId;
  const staleDiagnostic = Boolean(statusRunId && runId && String(statusRunId) !== String(runId));
  return {
    ...origin,
    ...payload,
    run_id: runId,
    generated_at: payload.generated_at || origin.generated_at || new Date().toISOString(),
    status_run_id: statusRunId || null,
    active_run_id: activeRunId || null,
    stale_diagnostic: payload.stale_diagnostic ?? staleDiagnostic,
    placeholder: payload.placeholder === true,
    validation_mode: payload.validation_mode || origin.validation_mode,
    serving_mode: payload.serving_mode || origin.serving_mode,
    generated_by: payload.generated_by || origin.generated_by,
    is_github_actions: payload.is_github_actions ?? origin.is_github_actions,
    GITHUB_RUN_ID: payload.GITHUB_RUN_ID || origin.GITHUB_RUN_ID || null,
    GITHUB_WORKFLOW: payload.GITHUB_WORKFLOW || origin.GITHUB_WORKFLOW || null
  };
}

function writeRuntimeDiagnosticJson(filePath, payload, origin = {}) {
  const normalized = String(filePath || "").replace(/\\/g, "/");
  const body = withRunOrigin(payload, origin);
  fs.mkdirSync(normalized.split("/").slice(0, -1).join("/"), { recursive: true });
  fs.writeFileSync(normalized, JSON.stringify(body, null, 2));
  if (normalized.startsWith("dashboard/api/")) {
    const debugPath = `${DEBUG_API_DIR}/${normalized.slice("dashboard/api/".length)}`;
    fs.mkdirSync(debugPath.split("/").slice(0, -1).join("/"), { recursive: true });
    fs.writeFileSync(debugPath, JSON.stringify(body, null, 2));
  }
  return normalized;
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
  return normalizePort(port).port_code || "UNKNOWN";
}

function normalizedPortInfo(record = {}) {
  const normalized = normalizeRecordPort(record);
  if (normalized.missing) return { port_code: "UNKNOWN", port_name: "미확인 항만", display_name: "미확인 항만", raw: null };
  return {
    port_code: normalized.port.port_code || "UNKNOWN",
    port_name: normalized.port.port_name || "미확인 항만",
    display_name: normalized.port.display_name || normalized.port.port_name || "미확인 항만",
    raw: normalized.raw
  };
}
function buildPortIntelligence(records) {
  const byPort = new Map();
  const inferSubPort = v => {
    const text = [v.sub_port, v.terminal_name, v.berth_name, v.anchorage_name, v.laidupFcltyNm, v.facility_name_raw, v.port, v.port_name].filter(Boolean).join(" ").normalize("NFKC").toLowerCase();
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
    return String(v.sub_port || "").trim();
  };
  for (const v of records) {
    const portInfo = normalizedPortInfo(v);
    const portName = portInfo.display_name;
    const portCode = portInfo.port_code;
    const subPort = inferSubPort(v);
    const key = `${portCode || portName}|${subPort}`;
    const current = byPort.get(key) || {
      port_code: portCode,
      port_name: subPort || portName,
      port_group: portName,
      sub_port: subPort,
      display_name: subPort || portName,
      display_scope: subPort ? "sub_port" : "representative_port",
      vessel_count: 0,
      scored_count: 0,
      candidate_count: 0,
      immediate_target_count: 0,
      high_value_vessels: 0,
      anchorage_waiting: 0,
      work_window_hours_total: 0,
      work_window_count: 0,
      operator_known_count: 0,
      agent_known_count: 0,
      port_opportunity_score: 0,
      operator_quality: 0,
      work_window_hours: 0,
      all_vessels: [],
      scored_vessels: [],
      sales_candidates: [],
      immediate_targets: [],
      berths: [],
      raw_aliases: new Set()
    };
    current.vessel_count += 1;
    if (portInfo.raw) current.raw_aliases.add(String(portInfo.raw).trim());
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
    const score = Number(v.commercial_value_score || v.total_sales_priority_score || v.cleaning_candidate_score || 0);
    if (score >= 75 || Number(v.gt || 0) >= 30000 || v.high_value_target) current.high_value_vessels += 1;
    if (v.is_anchorage_waiting || Number(v.anchorage_hours || 0) > 0 || String(v.status_bucket || "").includes("anchorage")) current.anchorage_waiting += 1;
    if (Number(v.work_window_hours || v.predicted_work_window_hours || 0) > 0) {
      current.work_window_hours_total += Number(v.work_window_hours || v.predicted_work_window_hours || 0);
      current.work_window_count += 1;
    }
    if (v.operator_name || v.operator) current.operator_known_count += 1;
    if (v.agent_name || v.agent || v.satmntEntrpsNm || v.entrpsCdNm) current.agent_known_count += 1;
    if (v.berth) current.berths.push({ berth_name: v.berth, vessel_name: v.vessel_name, status: v.status, eta: v.eta, etd: v.etd });
    byPort.set(key, current);
  }
  return [...byPort.values()].map(port => ({
    ...port,
    work_window_hours: port.work_window_count ? Math.round((port.work_window_hours_total / port.work_window_count) * 10) / 10 : 0,
    average_work_window_hours: port.work_window_count ? Math.round((port.work_window_hours_total / port.work_window_count) * 10) / 10 : 0,
    operator_quality: port.vessel_count ? Math.round(((port.operator_known_count * 0.65 + port.agent_known_count * 0.35) / port.vessel_count) * 100) : 0,
    port_opportunity_score: Math.min(100, Math.round(
      Math.min(35, port.high_value_vessels * 7) +
      Math.min(25, port.anchorage_waiting * 6) +
      Math.min(20, (port.work_window_count ? port.work_window_hours_total / port.work_window_count : 0) * 0.8) +
      Math.min(15, (port.vessel_count ? ((port.operator_known_count * 0.65 + port.agent_known_count * 0.35) / port.vessel_count) * 100 : 0) * 0.15) +
      Math.min(10, port.immediate_target_count * 5)
    )),
    all_vessels: sortCommercialPriority(port.all_vessels),
    scored_vessels: sortCommercialPriority(port.scored_vessels),
    sales_candidates: sortCommercialPriority(dedupeCandidateRows(port.sales_candidates)),
    immediate_targets: sortCommercialPriority(dedupeCandidateRows(port.immediate_targets)),
    berths: port.berths.slice(0, 100),
    raw_aliases: [...port.raw_aliases].sort((left, right) => left.localeCompare(right, "ko")),
    raw_alias_count: port.raw_aliases.size
  })).sort((a, b) => b.immediate_target_count - a.immediate_target_count || b.candidate_count - a.candidate_count || b.vessel_count - a.vessel_count);
}

function buildPortOpportunityRanking(records = []) {
  return buildPortIntelligence(records)
    .map(({ all_vessels, scored_vessels, sales_candidates, immediate_targets, berths, ...port }) => port)
    .sort((a, b) =>
      b.port_opportunity_score - a.port_opportunity_score ||
      b.immediate_target_count - a.immediate_target_count ||
      b.high_value_vessels - a.high_value_vessels ||
      b.anchorage_waiting - a.anchorage_waiting ||
      b.candidate_count - a.candidate_count
    );
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
    const portInfo = normalizedPortInfo(v);
    const port = portInfo.display_name;
    const current = summary.get(port) || {
      port,
      port_code: portInfo.port_code,
      port_name: portInfo.display_name,
      display_name: portInfo.display_name,
      total: 0,
      critical: 0,
      high_risk: 0,
      avg_risk: 0,
      waiting: 0,
      at_berth: 0,
      opportunity_usd: 0,
      raw_aliases: new Set()
    };
    if (portInfo.raw) current.raw_aliases.add(String(portInfo.raw).trim());
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
    .map(p => ({ ...p, raw_aliases: [...p.raw_aliases].sort((left, right) => left.localeCompare(right, "ko")), avg_risk: p.total ? Math.round(p.avg_risk / p.total) : 0 }))
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
    Object.assign(enriched, deriveDataQualityScore(enriched));
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
    if (enriched.high_value_target && (deriveCongestionScore(enriched, scheduleMetrics) >= 20 || (scheduleMetrics.stay_hours || 0) >= 120 || (enriched.cleaning_window_score || 0) >= 18)) {
      enriched.total_sales_priority_score = Math.max(enriched.total_sales_priority_score || 0, SALES_CANDIDATE_THRESHOLD);
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
    enriched.recommended_action = enriched.recommended_next_action || enriched.recommended_action || enriched.candidate_next_action || recommendedAction(enriched);
    enriched.opportunity_usd = estimateOpportunity(enriched);
    return enriched;
  });
}

function sortCommercialPriority(records) {
  return records.slice().sort((a, b) =>
    (b.total_sales_priority_score || 0) - (a.total_sales_priority_score || 0) ||
    (b.work_feasibility_score || b.cleaning_window_score || 0) - (a.work_feasibility_score || a.cleaning_window_score || 0) ||
    (b.congestion_score || b.port_congestion_score || 0) - (a.congestion_score || a.port_congestion_score || 0) ||
    (b.data_confidence_score || 0) - (a.data_confidence_score || 0) ||
    (b.biofouling_score || 0) - (a.biofouling_score || 0) ||
    (b.work_window_hours || 0) - (a.work_window_hours || 0)
  );
}

function buildContactReadyVessels(records = []) {
  return sortCommercialPriority(dedupeCandidateRows(records.filter(v =>
    Number(v.contact_readiness_score || 0) >= 60 ||
    ["contact_available", "high_confidence_contact"].includes(v.contact_path_status) ||
    (v.contact_path_available && Number(v.commercial_value_score || v.total_sales_priority_score || 0) >= SALES_CANDIDATE_THRESHOLD)
  )))
    .sort((a, b) =>
      Number(b.contact_readiness_score || 0) - Number(a.contact_readiness_score || 0) ||
      Number(b.commercial_value_score || b.total_sales_priority_score || 0) - Number(a.commercial_value_score || a.total_sales_priority_score || 0) ||
      Number(b.lead_priority_score || 0) - Number(a.lead_priority_score || 0)
    )
    .map(v => ({
      vessel_name: v.vessel_name,
      port: v.port,
      port_code: v.port_code,
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
      lead_status: v.lead_status || "monitor",
      lead_priority_score: Number(v.lead_priority_score || 0),
      commercial_value_score: Number(v.commercial_value_score || v.total_sales_priority_score || 0),
      recommended_action: v.recommended_action || v.recommended_next_action || recommendedAction(v),
      why_now: v.why_now || "",
      reason_codes: v.reason_codes || []
    }));
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

function hasCurrentOrNearTermWorkFeasibility(v = {}) {
  return Number(v.work_feasibility_score || 0) >= 25 ||
    Number(v.cleaning_window_score || 0) >= 12 ||
    Number(v.work_window_hours || 0) > 0 ||
    ["arrived_staying", "berthed", "anchorage_waiting"].includes(v.status_bucket) ||
    Boolean(v.is_anchorage_waiting);
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

function candidateBandFromScore(value = 0) {
  const score = Number(value || 0);
  if (score >= CRITICAL_TARGET_THRESHOLD) return "critical";
  if (score >= IMMEDIATE_TARGET_THRESHOLD) return "immediate_target";
  if (score >= SALES_CANDIDATE_THRESHOLD) return "sales_target";
  if (score >= 50) return "watchlist";
  return "general";
}

function ensureOutputContractFields(records = [], { runId = "", generatedAt = "", dataSourceUsed = "static_json_snapshot" } = {}) {
  return records.map((record = {}, index) => {
    const portCode = String(record.port_code || portCodeFromName(record.port || record.port_name) || "unknown");
    const vesselName = record.vessel_name || record.name || record.ship_name || record.normalized_vessel_name || "UNKNOWN";
    const commercialValueScore = Number(record.commercial_value_score ?? record.total_sales_priority_score ?? record.cleaning_candidate_score ?? 0);
    const fallbackPortCallId = normalizeIdentityToken(candidateDedupeKey({ ...record, port_code: portCode, vessel_name: vesselName }) || `ROW-${index}`);
    const masterVesselId = record.master_vessel_id || record.hybrid_entity_key || record.vessel_id || record.imo || record.mmsi || record.call_sign || normalizeIdentityToken(vesselName);
    return {
      ...record,
      run_id: record.run_id || runId,
      generated_at: record.generated_at || record.collected_at || generatedAt,
      data_source_used: record.data_source_used || record.source_name || record.source || dataSourceUsed,
      port_call_id: record.port_call_id || fallbackPortCallId,
      master_vessel_id: masterVesselId,
      vessel_name: vesselName,
      port_code: portCode,
      port_name: record.port_name || record.port || portCode,
      candidate_band: record.candidate_band || record.sales_priority_band || candidateBandFromScore(commercialValueScore),
      commercial_value_score: commercialValueScore,
      data_confidence_score: Number(record.data_confidence_score ?? record.confidence_score ?? 0)
    };
  });
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

function vesselDatasetDedupeKey(v = {}) {
  const normalizedName = normalizeVesselName(v.normalized_vessel_name || v.vessel_name || v.name || v.ship_name);
  const vesselType = normalizeIdentityToken(v.vessel_type_group || v.vessel_type || "");
  if (hasValue(v.imo)) return `IMO|${normalizeIdentityToken(v.imo)}`;
  if (hasValue(v.mmsi)) return `MMSI|${normalizeIdentityToken(v.mmsi)}`;
  if (normalizedName) return `NAME_TYPE|${normalizedName}|${vesselType}`;
  if (hasValue(v.call_sign)) return `CALL|${normalizeIdentityToken(v.call_sign)}`;
  return `FALLBACK|${normalizeIdentityToken(v.master_vessel_id || v.hybrid_entity_key || v.vessel_id || "")}`;
}

function isBetterDatasetVessel(next = {}, current = {}) {
  const nextHasIdentity = Number(Boolean(next.imo)) + Number(Boolean(next.mmsi)) + Number(Boolean(next.call_sign));
  const currentHasIdentity = Number(Boolean(current.imo)) + Number(Boolean(current.mmsi)) + Number(Boolean(current.call_sign));
  const nextScore = Number(next.commercial_value_score || next.total_sales_priority_score || next.cleaning_candidate_score || 0);
  const currentScore = Number(current.commercial_value_score || current.total_sales_priority_score || current.cleaning_candidate_score || 0);
  const nextStay = Number(next.stay_hours || next.current_call_stay_hours || next.cumulative_stay_hours || 0);
  const currentStay = Number(current.stay_hours || current.current_call_stay_hours || current.cumulative_stay_hours || 0);
  return nextHasIdentity > currentHasIdentity ||
    (nextHasIdentity === currentHasIdentity && nextScore > currentScore) ||
    (nextHasIdentity === currentHasIdentity && nextScore === currentScore && Number(next.data_confidence_score || 0) > Number(current.data_confidence_score || 0)) ||
    (nextHasIdentity === currentHasIdentity && nextScore === currentScore && Number(next.data_confidence_score || 0) === Number(current.data_confidence_score || 0) && nextStay > currentStay) ||
    (nextHasIdentity === currentHasIdentity && nextScore === currentScore && Number(next.data_confidence_score || 0) === Number(current.data_confidence_score || 0) && nextStay === currentStay && candidateTimestamp(next) > candidateTimestamp(current));
}

function dedupeVesselDataset(records = []) {
  const byKey = new Map();
  const passthrough = [];
  for (const record of records) {
    const key = vesselDatasetDedupeKey(record);
    if (!key || key === "FALLBACK|") {
      passthrough.push(record);
      continue;
    }
    const current = byKey.get(key);
    if (!current || isBetterDatasetVessel(record, current)) byKey.set(key, record);
  }
  return [...byKey.values(), ...passthrough];
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
    focus_question: "지금 어떤 선박에 연락해야 하며, 그 이유는 무엇인가?",
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

function confidenceBand(score = 0) {
  const value = Number(score || 0);
  if (value >= 80) return "HIGH";
  if (value >= 60) return "MEDIUM";
  if (value >= 40) return "LOW";
  return "UNMATCHED";
}

function buildMatchingDiagnostics(records = []) {
  const sourceRows = records.filter(v => v.enrichment_source || v.pilot_source_url || v.berth_data_source || v.pnc_source_url || v.ulsan_source || v.secondary_enrichment_source);
  const matchedRows = records.filter(v => v.pilot_schedule_matched || v.secondary_enrichment_matched || Number(v.match_score || v.pilot_match_score || v.berth_match_confidence || v.enrichment_confidence || 0) >= 40);
  const sourceMatched = pattern => matchedRows.filter(v => pattern.test(String([v.enrichment_source, v.pilot_source_url, v.berth_data_source, v.pnc_source_url, v.ulsan_source, v.secondary_enrichment_source, v.source].filter(Boolean).join(" ")).toLowerCase()));
  const sourceCollected = pattern => sourceRows.filter(v => pattern.test(String([v.enrichment_source, v.pilot_source_url, v.berth_data_source, v.pnc_source_url, v.ulsan_source, v.secondary_enrichment_source, v.source].filter(Boolean).join(" ")).toLowerCase()));
  const matchScores = matchedRows.map(v => Number(v.match_score || v.pilot_match_score || v.berth_match_confidence || v.enrichment_confidence || 0));
  const scoreAvg = values => values.length ? Math.round(values.reduce((sum, value) => sum + Number(value || 0), 0) / values.length) : 0;
  const rate = (matched, total) => total ? Math.round((matched / total) * 100) : 0;
  const pilotRows = sourceCollected(/pilot|도선/);
  const pncRows = sourceCollected(/pnc|pnit|newport|busan/);
  const ulsanRows = sourceCollected(/ulsan|울산/);
  const berthRows = sourceCollected(/berth|terminal|facility|선석|터미널/);
  const pilotMatched = sourceMatched(/pilot|도선/);
  const pncMatched = sourceMatched(/pnc|pnit|newport|busan/);
  const ulsanMatched = sourceMatched(/ulsan|울산/);
  const berthMatched = sourceMatched(/berth|terminal|facility|선석|터미널/);
  return {
    source_rows_collected: sourceRows.length,
    source_rows_matched: matchedRows.length,
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
    match_score_avg: scoreAvg(matchScores),
    match_memory_ready: true,
    matching_memory_table: "enrichment_match_candidates",
    alias_memory_sources: ["berth_aliases.csv", "terminal_aliases.csv", "enrichment_match_candidates"]
  };
}

function buildPredictionDiagnostics(records = []) {
  const predicted = records.filter(v => v.predicted_arrival_time || v.predicted_arrival_pipeline || Number(v.arrival_opportunity_score || 0) > 0);
  const matched = predicted.filter(v => v.actual_arrival_time || v.ata);
  const errors = matched
    .map(v => Number(v.prediction_error_hours ?? derivePredictionAccuracy(v).prediction_error_hours))
    .filter(Number.isFinite);
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
    .map(v => {
      const portInfo = normalizedPortInfo(v);
      return {
        vessel_name: v.vessel_name,
        port: portInfo.display_name,
        port_code: portInfo.port_code,
        raw_port: portInfo.raw || v.port || v.port_name || v.port_code || null,
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
      };
    });
}

function buildAgentFollowupQueue(records = []) {
  return sortCommercialPriority(records)
    .filter(v => {
      const score = Number(v.commercial_value_score || v.total_sales_priority_score || v.cleaning_candidate_score || 0);
      const hasAgent = Boolean(v.agent || v.agent_name || v.satmntEntrpsNm || v.entrpsCdNm);
      const missingDecisionPath = !v.operator || !v.imo || (v.data_confidence_score || 0) < 70;
      const commerciallyRelevant = score >= REVIEW_TARGET_THRESHOLD || v.is_cleaning_candidate || v.is_immediate_candidate;
      return commerciallyRelevant && (hasAgent || missingDecisionPath);
    })
    .map(v => ({
      vessel_name: v.vessel_name,
      port: v.port,
      port_code: v.port_code,
      agent: v.agent || v.agent_name || v.satmntEntrpsNm || v.entrpsCdNm || "",
      operator: v.operator || "",
      company: v.operator || v.operator_name || v.agent || v.agent_name || "",
      imo: v.imo || "",
      call_sign: v.call_sign || "",
      commercial_value_score: v.commercial_value_score || 0,
      data_confidence_score: v.data_confidence_score || 0,
      urgency: salesPriorityBand(salesPriorityScore(v)),
      reason: v.why_now || v.candidate_summary_ko || salesPriorityReasonCodes(v).join(", ") || "Commercially relevant candidate needs contact path confirmation.",
      recommended_message_angle: regulatedRouteSignal(v)
        ? "Biofouling compliance and pre-departure cleaning readiness."
        : Number(v.stay_hours || v.anchorage_hours || 0) >= 72
          ? "Long-stay hull performance and fuel-efficiency opportunity."
          : "Work-window confirmation and HullWiper Korea service fit.",
      next_action: v.agent || v.agent_name
        ? "Confirm IMO/operator and cleaning decision path via local agent."
        : "Identify local agent or operator contact before outreach.",
      reason_codes: v.reason_codes || []
    }));
}

function hasContactValue(value) {
  const text = String(value ?? "").trim();
  return Boolean(text) && text !== "-" && !/^(unknown|n\/a|null|undefined|확인 필요|미확인)$/i.test(text);
}

function missingContactFields(record = {}) {
  const fields = [];
  if (!hasContactValue(firstNonEmpty(record.operator, record.operator_name, record.operator_normalized))) fields.push("operator");
  if (!hasContactValue(firstNonEmpty(record.owner, record.owner_name, record.ship_owner, record.registered_owner))) fields.push("owner");
  if (!hasContactValue(firstNonEmpty(record.manager, record.manager_name, record.ship_manager, record.technical_manager))) fields.push("manager");
  if (!hasContactValue(firstNonEmpty(record.agent, record.agent_name, record.local_agent, record.satmntEntrpsNm, record.entrpsCdNm))) fields.push("local_agent");
  if (!hasContactValue(firstNonEmpty(record.superintendent, record.technical_superintendent, record.contact_person, record.contact_name, record.email, record.phone))) fields.push("contact_person");
  return fields;
}

function verificationTypeForMissingFields(fields = []) {
  if (fields.includes("operator")) return "OPERATOR";
  if (fields.includes("owner")) return "OWNER";
  if (fields.includes("manager")) return "MANAGER";
  if (fields.includes("local_agent")) return "LOCAL_AGENT";
  return "CONTACT_PERSON";
}

function knownCompanyForVerification(record = {}) {
  return firstNonEmpty(
    record.company,
    record.company_name,
    record.shipping_company,
    record.operator,
    record.operator_name,
    record.owner,
    record.owner_name,
    record.manager,
    record.manager_name,
    record.agent,
    record.agent_name,
    record.satmntEntrpsNm,
    record.entrpsCdNm
  ) || "";
}

function buildVerificationQueue(records = []) {
  return sortCommercialPriority(records)
    .map(record => {
      const missing = missingContactFields(record);
      return { record, missing, priorityScore: salesPriorityScore(record), priorityLabel: salesPriorityBand(salesPriorityScore(record)) };
    })
    .filter(({ record, missing, priorityScore, priorityLabel }) => {
      const commerciallyRelevant = priorityScore >= 55 || record.is_cleaning_candidate || record.is_immediate_candidate || Number(record.commercial_value_score || record.total_sales_priority_score || 0) >= REVIEW_TARGET_THRESHOLD;
      const priorityContactGap = ["HOT", "WARM"].includes(priorityLabel) && (missing.includes("operator") || missing.includes("local_agent"));
      return commerciallyRelevant && missing.length && (priorityContactGap || missing.length >= 2);
    })
    .map(({ record, missing, priorityScore, priorityLabel }, index) => withVesselDisplay({
      rank: index + 1,
      vessel_name: record.vessel_name,
      port: firstNonEmpty(record.port_name, record.port, record.destination_port, record.destination),
      port_code: record.port_code,
      imo: record.imo || "",
      call_sign: firstNonEmpty(record.call_sign, record.callsign, record.clsgn),
      operator: firstNonEmpty(record.operator, record.operator_name, record.operator_normalized),
      company: knownCompanyForVerification(record),
      owner: firstNonEmpty(record.owner, record.owner_name, record.ship_owner, record.registered_owner),
      manager: firstNonEmpty(record.manager, record.manager_name, record.ship_manager, record.technical_manager),
      agent: firstNonEmpty(record.agent, record.agent_name, record.local_agent, record.satmntEntrpsNm, record.entrpsCdNm),
      verification_type: verificationTypeForMissingFields(missing),
      known_company: knownCompanyForVerification(record),
      missing_fields: missing,
      confidence_score: Number(record.contact_readiness_score || record.data_confidence_score || record.confidence_score || 0),
      priority_label: priorityLabel,
      commercial_value_score: Number(record.commercial_value_score || record.total_sales_priority_score || priorityScore || 0),
      opportunity_score: Number(record.opportunity_score || record.commercial_value_score || record.total_sales_priority_score || priorityScore || 0),
      reason_summary: missing.includes("operator") || missing.includes("local_agent")
        ? "영업 후보이나 선사/대리점 연락 경로 확인이 필요합니다."
        : "영업 연락 준비를 위해 회사/담당자 정보 보강이 필요합니다.",
      recommended_action: "선사/에이전트 확인 후 영업 연락 준비",
      source_names: displaySources(record),
      data_sources: displaySources(record),
      next_action: "선사/에이전트 확인 후 영업 연락 준비",
      reason_codes: [...new Set([...(record.reason_codes || []), "VERIFY_AGENT"])].slice(0, 12)
    }));
}

const TARGET_CATEGORY_DEFINITIONS = [
  { code: "CONTACT_NOW", label: "즉시 연락 대상", short_label: "즉시 연락", kpi_key: "contact_now_count" },
  { code: "PRE_ARRIVAL", label: "입항 전 선제 연락 대상", short_label: "입항 전", kpi_key: "pre_arrival_target_count" },
  { code: "ANCHORAGE_OPPORTUNITY", label: "묘박/정박 중 작업 가능 대상", short_label: "묘박/정박", kpi_key: "anchorage_opportunity_count" },
  { code: "LONG_STAY_RISK", label: "장기 체류 고위험 대상", short_label: "장기 체류", kpi_key: "long_stay_risk_count" },
  { code: "BIOFOULING_COMPLIANCE", label: "Biofouling Compliance 대상", short_label: "Compliance", kpi_key: "compliance_target_count" },
  { code: "REPEAT_CALLER", label: "반복 입항 선박", short_label: "반복 입항", kpi_key: "repeat_caller_count" },
  { code: "FLEET_EXPANSION", label: "선사/선대 확장 대상", short_label: "선대 확장", kpi_key: "fleet_expansion_count" },
  { code: "VERIFY_CONTACT", label: "연락처 확인 필요", short_label: "연락처 확인", kpi_key: "verify_contact_count" },
  { code: "MONITOR", label: "모니터링 대상", short_label: "모니터링", kpi_key: "monitor_count" },
  { code: "HOLD", label: "보류/제외", short_label: "보류", kpi_key: "hold_count" }
];
const TARGET_CATEGORY_BY_CODE = Object.fromEntries(TARGET_CATEGORY_DEFINITIONS.map(category => [category.code, category]));

function categoryConfidence(...scores) {
  const value = firstFiniteNumber(...scores, 50) || 0;
  return Math.max(0, Math.min(1, Math.round((Number(value) / 100) * 100) / 100));
}

function targetCategoryScore(record = {}) {
  const values = [
    record.opportunity_score,
    record.sales_priority_score,
    record.commercial_value_score,
    record.total_sales_priority_score,
    record.cleaning_candidate_score,
    salesPriorityScore(record)
  ].map(value => Number(value)).filter(Number.isFinite);
  return values.length ? Math.max(...values) : 0;
}

function targetCategoryRisk(record = {}) {
  return recordRiskScore(record);
}

function targetCategoryConfidence(record = {}) {
  return firstFiniteNumber(record.confidence_score, record.contact_readiness_score, record.data_confidence_score, record.candidate_confidence, record.arrival_prediction_confidence, 50) || 0;
}

function hasCurrentKoreaWorkSignal(record = {}) {
  return hasPortSignal(record) || hasAnchorageWaitingSignal(record) || hasValue(firstNonEmpty(record.current_port, record.port_name, record.port, record.anchorage_name, record.berth_name));
}

function isBerthedOrArrived(record = {}) {
  const status = String(firstNonEmpty(record.status_bucket, record.status, record.port_call_status, record.operational_status)).toLowerCase();
  return Boolean(record.atb || record.berth_name || record.berth || /berthed|moored|alongside|접안/.test(status));
}

function lastSeenAgeHours(record = {}, generatedAt = new Date().toISOString()) {
  const value = firstNonEmpty(record.last_seen_at, record.collected_at, record.updated_at, record.generated_at, record.ata, record.eta);
  const seen = parseScheduleTime(value);
  const base = parseScheduleTime(generatedAt) || new Date();
  if (!seen || !base || Number.isNaN(seen.getTime()) || Number.isNaN(base.getTime())) return null;
  return Math.round(((base.getTime() - seen.getTime()) / 3600000) * 10) / 10;
}

function targetCategoryItem(code, confidence, reason, recommendedAction) {
  const definition = TARGET_CATEGORY_BY_CODE[code] || { code, label: code };
  return {
    code,
    label: definition.label,
    confidence: categoryConfidence(confidence),
    reason,
    recommended_action: recommendedAction
  };
}

function categoryHoldReason(record = {}, generatedAt = new Date().toISOString()) {
  if (!hasUsefulVesselIdentity(record)) return "유효한 선박 식별자 또는 선명이 부족합니다.";
  const ageHours = lastSeenAgeHours(record, generatedAt);
  if (ageHours !== null && ageHours > 168 && targetCategoryScore(record) < 55) return `마지막 확인 후 ${Math.round(ageHours / 24)}일 이상 경과했습니다.`;
  if (targetCategoryConfidence(record) < 20 && targetCategoryScore(record) < 35) return "신뢰도와 상업 신호가 모두 낮습니다.";
  if (record.excluded_from_commercial_targets === true || isHardCandidateExcluded(record)) return commercialExclusionReason(record) || "상업 후보 제외 조건에 해당합니다.";
  return "";
}

function buildTargetCategoriesForRecord(record = {}, { generatedAt = new Date().toISOString() } = {}) {
  const categories = [];
  const opportunity = targetCategoryScore(record);
  const risk = targetCategoryRisk(record);
  const confidence = targetCategoryConfidence(record);
  const priority = String(firstNonEmpty(record.priority_label, record.sales_priority_band, salesPriorityBand(opportunity || risk))).toUpperCase();
  const stayHours = firstFiniteNumber(record.stay_hours, record.current_call_stay_hours, record.cumulative_stay_hours, record.anchorage_hours, 0) || 0;
  const visits90 = repeatCallerVisitCount(record, 90);
  const repeatScore = firstFiniteNumber(record.repeat_caller_score, 0) || 0;
  const operatorVesselCount = firstFiniteNumber(record.operator_vessel_count, record.repeat_operator_count, record.operator_call_count, 0) || 0;
  const missingContact = missingContactFields(record);
  const complianceSignal = regulatedRouteSignal(record) || complianceCountry(record) || record.compliance_watch || record.compliance_tag || String(record.compliance_band || "").toLowerCase().includes("biosecurity");
  const holdReason = categoryHoldReason(record, generatedAt);
  if (holdReason && priority !== "HOT" && opportunity < 75) {
    return [targetCategoryItem("HOLD", confidence, holdReason, "데이터 보강 후 다시 검토")];
  }
  if ((priority === "HOT" || isImmediateTarget(record) || opportunity >= IMMEDIATE_TARGET_THRESHOLD) && hasCurrentKoreaWorkSignal(record) && confidence >= 25) {
    categories.push(targetCategoryItem("CONTACT_NOW", Math.max(confidence, opportunity), "HOT/고점수 신호와 현재 한국 항만 또는 묘박 작업 가능성이 함께 확인됩니다.", "기술감독 또는 에이전트에 즉시 연락"));
  }
  if (hasArrivalPipelineSignal(record) && !isBerthedOrArrived(record)) {
    categories.push(targetCategoryItem("PRE_ARRIVAL", firstFiniteNumber(record.arrival_prediction_confidence, confidence, opportunity, 50), arrivalPipelineReason(record), "입항 전 선사/대리점에 작업 가능 시간과 담당자를 선제 확인"));
  }
  if (hasAnchorageWaitingSignal(record)) {
    categories.push(targetCategoryItem("ANCHORAGE_OPPORTUNITY", Math.max(confidence, firstFiniteNumber(record.anchorage_probability, 50) || 50), anchorageWaitingReason(record), "묘박/정박 상태와 작업 가능 시간을 확인"));
  }
  if (stayHours >= 72 && risk >= 50) {
    categories.push(targetCategoryItem("LONG_STAY_RISK", Math.max(risk, confidence), `체류 ${Math.round((stayHours / 24) * 10) / 10}일 및 리스크 ${Math.round(risk)}점 신호가 있습니다.`, "장기 체류 원인과 선저 리스크를 함께 확인"));
  }
  if (complianceSignal && risk >= 45) {
    categories.push(targetCategoryItem("BIOFOULING_COMPLIANCE", Math.max(risk, opportunity), "규제 목적지/항로 또는 compliance 태그와 biofouling 리스크가 함께 확인됩니다.", "Brazil/Australia/NZ 등 목적지와 biofouling 대응 필요 여부 확인"));
  }
  if (visits90 >= 2 || repeatScore >= 45) {
    categories.push(targetCategoryItem("REPEAT_CALLER", Math.max(repeatScore, confidence), `최근 90일 반복 입항 ${visits90}회 또는 반복 기항 점수 ${Math.round(repeatScore)}점 신호가 있습니다.`, "반복 입항 이력을 근거로 선사/대리점 접점을 확인"));
  }
  if (operatorVesselCount >= 2 || firstFiniteNumber(record.operator_opportunity_score, record.fleet_opportunity_score, 0) >= 55) {
    categories.push(targetCategoryItem("FLEET_EXPANSION", firstFiniteNumber(record.operator_opportunity_score, record.fleet_opportunity_score, opportunity, 50), "동일 운영사/선대의 한국 기항 선박이 복수 확인됩니다.", "선사 단위로 추가 선박 기회를 함께 검토"));
  }
  if (["HOT", "WARM"].includes(priority) && missingContact.length) {
    categories.push(targetCategoryItem("VERIFY_CONTACT", confidence, `영업 후보이나 ${missingContact.join(", ")} 정보 확인이 필요합니다.`, "선사/에이전트 확인 후 영업 연락 준비"));
  }
  if (!categories.length) {
    categories.push(targetCategoryItem("MONITOR", confidence, priority === "LOW" ? "상업 신호는 있으나 즉시 연락 긴급도는 낮습니다." : "후보 신호는 있으나 우선순위 카테고리 조건은 제한적입니다.", "다음 업데이트까지 모니터링"));
  } else if (["LOW", "WARM"].includes(priority) && !categories.some(category => ["CONTACT_NOW", "PRE_ARRIVAL", "ANCHORAGE_OPPORTUNITY"].includes(category.code))) {
    categories.push(targetCategoryItem("MONITOR", confidence, "즉시 실행 조건은 아니지만 추적 가치가 있습니다.", "다음 업데이트까지 모니터링"));
  }
  return categories.filter(category => !(category.code === "HOLD" && categories.some(other => other.code === "CONTACT_NOW")));
}

function annotateTargetCategories(record = {}, options = {}) {
  const opportunityScore = targetCategoryScore(record);
  const riskScore = targetCategoryRisk(record);
  const confidenceScore = targetCategoryConfidence(record);
  const priorityLabel = String(firstNonEmpty(record.priority_label, record.sales_priority_band, salesPriorityBand(opportunityScore || riskScore))).toUpperCase();
  const targetCategories = buildTargetCategoriesForRecord(record, options);
  const primary = targetCategories[0] || targetCategoryItem("MONITOR", confidenceScore, "모니터링 대상입니다.", "다음 업데이트까지 모니터링");
  return withVesselDisplay({
    ...record,
    priority_label: priorityLabel,
    sales_priority_band: priorityLabel,
    opportunity_score: opportunityScore,
    risk_score: riskScore,
    confidence_score: confidenceScore,
    primary_category: primary,
    primary_category_code: primary.code,
    primary_category_label: primary.label,
    target_categories: targetCategories
  });
}

function buildTargetCategorySummary(records = [], { generatedAt = new Date().toISOString() } = {}) {
  const items = sortCommercialPriority(dedupeCandidateRows(records)).map(record => annotateTargetCategories(record, { generatedAt }));
  const categories = TARGET_CATEGORY_DEFINITIONS.map(definition => {
    const categoryItems = items.filter(item => (item.target_categories || []).some(category => category.code === definition.code));
    return {
      code: definition.code,
      label: definition.label,
      short_label: definition.short_label,
      count: categoryItems.length,
      items: categoryItems
    };
  });
  const counts = Object.fromEntries(categories.map(category => [category.code, category.count]));
  const kpis = Object.fromEntries(TARGET_CATEGORY_DEFINITIONS.map(definition => [definition.kpi_key, counts[definition.code] || 0]));
  const overlap_matrix = {};
  for (const left of TARGET_CATEGORY_DEFINITIONS) {
    overlap_matrix[left.code] = {};
    for (const right of TARGET_CATEGORY_DEFINITIONS) {
      overlap_matrix[left.code][right.code] = items.filter(item => {
        const codes = new Set((item.target_categories || []).map(category => category.code));
        return codes.has(left.code) && codes.has(right.code);
      }).length;
    }
  }
  const hold_reasons = {};
  for (const item of items.filter(row => (row.target_categories || []).some(category => category.code === "HOLD"))) {
    const reason = (item.target_categories || []).find(category => category.code === "HOLD")?.reason || "unknown";
    hold_reasons[reason] = (hold_reasons[reason] || 0) + 1;
  }
  return { items, categories, counts, kpis, overlap_matrix, hold_reasons };
}

function buildTargetCategoriesPayload({ summary = {}, generatedAt = new Date().toISOString(), dataMode = "live", report = {} } = {}) {
  const itemLimit = 50;
  return {
    schema_version: PUBLIC_API_SCHEMA_VERSION,
    generated_at: generatedAt,
    data_mode: contractDataMode(dataMode, report),
    record_count: Array.isArray(summary.items) ? summary.items.length : 0,
    source_table: "sales_candidates_current,opportunity_master,risk_history,rule_evaluations,explainability_snapshots,agent-followup-queue,arrival-pipeline,anchorage-waiting,staying-vessels",
    item_limit: itemLimit,
    categories: (summary.categories || []).map(category => ({
      code: category.code,
      label: category.label,
      short_label: category.short_label,
      count: category.count,
      returned_count: Math.min((category.items || []).length, itemLimit),
      items_limited: (category.items || []).length > itemLimit,
      items: (category.items || []).slice(0, itemLimit).map(withVesselDisplay)
    }))
  };
}

function buildSalesActionsPayload({ summary = {}, generatedAt = new Date().toISOString(), dataMode = "live", report = {} } = {}) {
  const items = (summary.items || [])
    .filter(item => item.primary_category_code !== "HOLD")
    .map((item, index) => ({
      rank: index + 1,
      vessel_display: item.vessel_display || vesselDisplay(item),
      vessel_name: item.vessel_name,
      imo: item.imo || "",
      port: firstNonEmpty(item.port_name, item.port, item.current_port, item.destination_port),
      action_type: item.primary_category_code,
      action_label: item.primary_category_label,
      priority_label: item.priority_label,
      opportunity_score: item.opportunity_score,
      risk_score: item.risk_score,
      confidence_score: item.confidence_score,
      reason_summary: item.primary_category?.reason || item.reason_summary || item.why_now || "",
      recommended_action: item.primary_category?.recommended_action || item.recommended_action || "영업 연락 가능 여부 확인",
      target_categories: item.target_categories || []
    }));
  return publicItemsEnvelope({
    generatedAt,
    dataMode,
    report,
    sourceTable: "targets/categories,sales_candidates_current,sales/actions",
    items: items.slice(0, 300),
    extra: {
      total_count: items.length,
      returned_count: Math.min(items.length, 300),
      ...(items.length ? {} : { status: "empty", reason: "영업 액션으로 변환할 카테고리 대상이 없습니다." })
    }
  });
}

const LEAD_CONVERSION_STAGES = [
  "NEW_TARGET",
  "CONTACT_PLANNED",
  "CONTACTED",
  "QUOTE_REQUESTED",
  "QUOTE_SENT",
  "NEGOTIATION",
  "WON",
  "LOST",
  "ARCHIVED"
];

function normalizeLeadConversionStage(value) {
  const text = String(value || "").normalize("NFKC").trim().toLowerCase();
  if (!text) return null;
  if (/archive|archived|hold|excluded|보류|제외/.test(text)) return "ARCHIVED";
  if (/lost|loss|failed|fail|실패|실주/.test(text)) return "LOST";
  if (/won|win|closed_won|수주|성공/.test(text)) return "WON";
  if (/negotiat|협상|조율/.test(text)) return "NEGOTIATION";
  if (/quote_sent|quoted|quotation_sent|proposal_sent|견적.?발송|견적.?전달/.test(text)) return "QUOTE_SENT";
  if (/quote_requested|quote_request|quotation_requested|quotation_request|rfq|견적.?요청/.test(text)) return "QUOTE_REQUESTED";
  if (/contacted|contact_complete|last_contact|연락.?완료|접촉.?완료/.test(text)) return "CONTACTED";
  if (/contact_planned|contact_ready|planned|scheduled|follow.?up|verify_contact|contact_now|연락.?예정|연락.?준비/.test(text)) return "CONTACT_PLANNED";
  if (/new_target|new_lead|identified|qualified|candidate|target|monitor|new|신규|대상/.test(text)) return "NEW_TARGET";
  return null;
}

function leadConversionStage(record = {}) {
  const values = [
    record.current_stage,
    record.pipeline_stage,
    record.sales_stage,
    record.lead_stage,
    record.opportunity_stage,
    record.lead_status,
    record.opportunity_state,
    record.quote_status,
    record.action_type,
    record.primary_category_code,
    record.contact_path_status
  ];
  for (const value of values) {
    const stage = normalizeLeadConversionStage(value);
    if (["ARCHIVED", "LOST", "WON", "NEGOTIATION", "QUOTE_SENT", "QUOTE_REQUESTED", "CONTACTED"].includes(stage)) return stage;
  }
  for (const value of values) {
    const stage = normalizeLeadConversionStage(value);
    if (stage) return stage;
  }
  const contact = contactHistoryCounts(record);
  if (contact.previous_wins > 0) return "WON";
  if (contact.previous_quotes > 0) return "QUOTE_SENT";
  if (contact.previous_contacts > 0) return "CONTACTED";
  if (firstNonEmpty(record.agent, record.agent_name, record.operator, record.operator_name) || Number(record.contact_readiness_score || 0) >= 50) return "CONTACT_PLANNED";
  return "NEW_TARGET";
}

function previousLeadConversionStage(record = {}, currentStage = "NEW_TARGET") {
  const explicit = normalizeLeadConversionStage(firstNonEmpty(
    record.previous_stage,
    record.previous_pipeline_stage,
    record.previous_sales_stage,
    record.previous_lead_status,
    record.previous_opportunity_state
  ));
  if (explicit) return explicit;
  const index = LEAD_CONVERSION_STAGES.indexOf(currentStage);
  if (index > 0 && !["LOST", "ARCHIVED"].includes(currentStage)) return LEAD_CONVERSION_STAGES[index - 1];
  return null;
}

function leadConversionStageUpdatedAt(record = {}, currentStage = "NEW_TARGET", generatedAt = new Date().toISOString()) {
  const stageSpecific = currentStage === "QUOTE_SENT"
    ? firstNonEmpty(record.quote_sent_at, record.quoted_at)
    : currentStage === "QUOTE_REQUESTED"
      ? firstNonEmpty(record.quote_requested_at, record.rfq_at)
      : currentStage === "CONTACTED"
        ? firstNonEmpty(record.contacted_at, record.last_contacted_at, record.last_contact_at)
        : currentStage === "WON"
          ? firstNonEmpty(record.won_at, record.closed_at)
          : currentStage === "LOST"
            ? firstNonEmpty(record.lost_at, record.closed_at)
            : null;
  return firstNonEmpty(
    stageSpecific,
    record.stage_updated_at,
    record.pipeline_stage_updated_at,
    record.lead_status_updated_at,
    record.opportunity_state_updated_at,
    record.updated_at,
    record.last_seen_at,
    record.collected_at,
    generatedAt
  );
}

function leadConversionNextAction(stage, record = {}) {
  const existing = firstNonEmpty(record.recommended_next_action, record.recommended_action, record.next_action);
  if (existing) return existing;
  const byStage = {
    NEW_TARGET: "영업 대상 여부와 연락 경로를 확인",
    CONTACT_PLANNED: "담당자/대리점에 연락 일정을 확정",
    CONTACTED: "요청사항을 확인하고 견적 필요 여부를 추적",
    QUOTE_REQUESTED: "작업 범위와 선박 스펙을 확인해 견적 준비",
    QUOTE_SENT: "견적 후속 확인 및 의사결정자 응답 추적",
    NEGOTIATION: "가격/작업창 조건을 조율하고 다음 액션 확정",
    WON: "작업 일정과 사후 기록 업데이트",
    LOST: "실패 사유 기록 후 재접촉 가능 시점 보관",
    ARCHIVED: "보류 사유 확인 후 필요 시 재활성화"
  };
  return byStage[stage] || byStage.NEW_TARGET;
}

function buildLeadConversionPipelinePayload({ summary = {}, generatedAt = new Date().toISOString(), dataMode = "live", report = {} } = {}) {
  const summaryItems = Array.isArray(summary.items) ? summary.items : [];
  const seedItems = summaryItems.length ? summaryItems : [
    ...compactItems(readJsonSafe("dashboard/api/sales/actions.json", null)),
    ...compactItems(readJsonSafe("dashboard/api/targets/current.json", null)),
    ...compactItems(readJsonSafe("dashboard/api/candidates/top.json", null)),
    ...compactItems(readJsonSafe("dashboard/api/intelligence/opportunity-memory.json", null))
  ];
  const byIdentity = new Map();
  for (const record of seedItems) {
    const stage = leadConversionStage(record);
    if (record.primary_category_code === "HOLD" && !["ARCHIVED", "LOST", "WON"].includes(stage)) continue;
    const key = opportunityMemoryIdentityKey(record);
    const current = byIdentity.get(key);
    const currentScore = salesPriorityScore(current || {});
    const score = salesPriorityScore(record);
    const stageRank = LEAD_CONVERSION_STAGES.indexOf(stage);
    const currentStageRank = current ? LEAD_CONVERSION_STAGES.indexOf(leadConversionStage(current)) : -1;
    if (!current || score > currentScore || (score === currentScore && stageRank > currentStageRank)) byIdentity.set(key, record);
  }
  const items = [...byIdentity.values()]
    .map((record, index) => {
      const currentStage = leadConversionStage(record);
      const previousStage = previousLeadConversionStage(record, currentStage);
      const stageUpdatedAt = leadConversionStageUpdatedAt(record, currentStage, generatedAt);
      const daysInStage = daysSinceValue(stageUpdatedAt, generatedAt) ?? 0;
      const opportunityScore = salesPriorityScore(record);
      const priorityLabel = String(firstNonEmpty(record.priority_label, record.sales_priority_band, salesPriorityBand(opportunityScore))).toUpperCase();
      return withVesselDisplay({
        rank: index + 1,
        vessel_display: record.vessel_display || vesselDisplay(record),
        vessel_name: firstNonEmpty(record.vessel_name, record.name, record.ship_name, record.vessel_display?.vessel_name),
        imo: firstNonEmpty(record.imo, record.imo_no, record.vessel_display?.imo) || null,
        mmsi: firstNonEmpty(record.mmsi, record.vessel_display?.mmsi) || null,
        operator_name: operatorFleetName(record),
        port: firstNonEmpty(record.port_name, record.port, record.current_port, record.destination_port),
        opportunity_score: opportunityScore,
        priority_label: priorityLabel,
        current_stage: currentStage,
        previous_stage: previousStage,
        stage_updated_at: stageUpdatedAt,
        days_in_stage: daysInStage,
        recommended_next_action: leadConversionNextAction(currentStage, record),
        recommended_action: leadConversionNextAction(currentStage, record),
        reason_summary: firstNonEmpty(
          record.reason_summary,
          record.why_now,
          `${currentStage} 단계: ${priorityLabel} 후보, 기회점수 ${Math.round(Number(opportunityScore || 0))}`
        )
      });
    })
    .sort((a, b) => {
      const terminalRank = stage => ["WON", "LOST", "ARCHIVED"].includes(stage) ? 1 : 0;
      const priorityRank = label => ({ HOT: 0, WARM: 1, LOW: 2 }[String(label || "").toUpperCase()] ?? 3);
      return terminalRank(a.current_stage) - terminalRank(b.current_stage) ||
        priorityRank(a.priority_label) - priorityRank(b.priority_label) ||
        Number(b.opportunity_score || 0) - Number(a.opportunity_score || 0) ||
        LEAD_CONVERSION_STAGES.indexOf(a.current_stage) - LEAD_CONVERSION_STAGES.indexOf(b.current_stage) ||
        Number(b.days_in_stage || 0) - Number(a.days_in_stage || 0);
    })
    .map((item, index) => ({ ...item, rank: index + 1 }));
  const stage_counts = Object.fromEntries(LEAD_CONVERSION_STAGES.map(stage => [stage, items.filter(item => item.current_stage === stage).length]));
  return publicItemsEnvelope({
    generatedAt,
    dataMode,
    report,
    sourceTable: "sales-pipeline,sales/actions,operator_contact_history,commercial_leads,relationship-intelligence,opportunity-memory",
    items: items.slice(0, 300),
    extra: {
      total_count: items.length,
      returned_count: Math.min(items.length, 300),
      stage_counts,
      pipeline_stages: LEAD_CONVERSION_STAGES,
      ...(items.length ? {} : { status: "empty", reason: "전환 파이프라인에 표시할 영업 대상이 없습니다." })
    }
  });
}

const PRIVATE_ACTIVITY_TYPES = [
  "contact_attempt",
  "quote_sent",
  "quote_value",
  "quote_result",
  "won",
  "lost",
  "loss_reason",
  "operation_completed",
  "customer_feedback"
];

const PRIVATE_ACTIVITY_LABELS = {
  contact_attempt: "연락 시도",
  quote_sent: "견적 발송",
  quote_value: "견적 금액 기록",
  quote_result: "견적 결과 기록",
  won: "수주",
  lost: "실주",
  loss_reason: "실패 사유 기록",
  operation_completed: "작업 완료",
  customer_feedback: "고객 피드백 기록"
};

function privateActivitySignal(record = {}, type) {
  const leadStatus = String(firstNonEmpty(record.lead_status, record.opportunity_state, record.current_stage, "")).toLowerCase();
  const quoteStatus = String(record.quote_status || "").toLowerCase();
  const present = value => value !== null && value !== undefined && String(value).trim() !== "" && !["false", "0", "no", "none", "null", "undefined"].includes(String(value).trim().toLowerCase());
  if (type === "contact_attempt") return present(record.contact_attempt) || present(record.contact_attempt_at) || present(record.contacted_at) || present(record.last_contacted_at);
  if (type === "quote_sent") return present(record.quote_sent) || present(record.quote_sent_at) || ["quote_sent", "quoted", "sent"].includes(quoteStatus) || leadStatus === "quoted";
  if (type === "quote_value") return present(record.quote_value);
  if (type === "quote_result") return present(record.quote_result);
  if (type === "won") return present(record.won) || present(record.won_at) || leadStatus === "won";
  if (type === "lost") return present(record.lost) || present(record.lost_at) || leadStatus === "lost";
  if (type === "loss_reason") return present(record.loss_reason);
  if (type === "operation_completed") return present(record.operation_completed) || present(record.operation_completed_at);
  if (type === "customer_feedback") return present(record.customer_feedback) || present(record.customer_feedback_summary);
  return false;
}

function privateActivityCount(record = {}, type) {
  const directKeys = [
    `${type}_count`,
    `${type}s_count`,
    `${type}_total`
  ];
  if (type === "contact_attempt") directKeys.push("contact_attempts", "contact_attempt_count", "previous_contacts");
  if (type === "quote_sent") directKeys.push("quotes_sent", "previous_quotes");
  for (const key of directKeys) {
    const value = Number(record[key]);
    if (Number.isFinite(value) && value > 0) return Math.round(value);
  }
  return privateActivitySignal(record, type) ? 1 : 0;
}

function privateActivityTimestamp(record = {}, type) {
  const value = {
    contact_attempt: firstNonEmpty(record.contact_attempt_at, record.contacted_at, record.last_contacted_at),
    quote_sent: firstNonEmpty(record.quote_sent_at, record.quoted_at),
    quote_value: firstNonEmpty(record.quote_value_at, record.quote_sent_at, record.quoted_at),
    quote_result: firstNonEmpty(record.quote_result_at, record.quote_decided_at),
    won: firstNonEmpty(record.won_at, record.closed_at),
    lost: firstNonEmpty(record.lost_at, record.closed_at),
    loss_reason: firstNonEmpty(record.lost_at, record.closed_at),
    operation_completed: record.operation_completed_at,
    customer_feedback: firstNonEmpty(record.customer_feedback_at, record.feedback_at)
  }[type] || firstNonEmpty(record.private_activity_at, record.updated_at, record.collected_at, record.last_seen_at);
  const parsed = parseScheduleTime(value);
  return parsed ? parsed.toISOString() : null;
}

function buildPrivateActivitySummaryPayload({ records = [], generatedAt = new Date().toISOString(), dataMode = "live", report = {} } = {}) {
  const latestByType = Object.fromEntries(PRIVATE_ACTIVITY_TYPES.map(type => [type, null]));
  const counts = Object.fromEntries(PRIVATE_ACTIVITY_TYPES.map(type => [type, 0]));
  for (const record of records) {
    for (const type of PRIVATE_ACTIVITY_TYPES) {
      const count = privateActivityCount(record, type);
      if (count <= 0) continue;
      counts[type] += count;
      const timestamp = privateActivityTimestamp(record, type);
      if (timestamp && (!latestByType[type] || timestamp > latestByType[type])) latestByType[type] = timestamp;
    }
  }
  const items = PRIVATE_ACTIVITY_TYPES.map(type => ({
    activity_type: type,
    label: PRIVATE_ACTIVITY_LABELS[type],
    count: counts[type],
    latest_activity_at: latestByType[type]
  }));
  const total = Object.values(counts).reduce((sum, count) => sum + Number(count || 0), 0);
  return {
    schema_version: PUBLIC_API_SCHEMA_VERSION,
    generated_at: generatedAt || report?.generated_at || report?.completed_at || new Date().toISOString(),
    data_mode: contractDataMode(dataMode, report),
    record_count: total,
    source_table: "private_sales_activity,commercial_leads,operator_contact_history,sales-pipeline,relationship-intelligence",
    items,
    total_private_activity_count: total,
    sensitive_details_exposed: false,
    totals: Object.fromEntries(PRIVATE_ACTIVITY_TYPES.map(type => [`${type}_count`, counts[type]])),
    privacy: {
      public_snapshot: "aggregated_counts_only",
      sensitive_storage: "Supabase private tables only"
    },
    ...(total ? {} : { status: "empty", reason: "비공개 영업 활동 원천기록이 아직 집계되지 않았습니다." })
  };
}

function regulatedRouteSignal(v = {}) {
  const route = [v.destination, v.destination_port, v.next_port, v.previous_port, v.route_region].filter(Boolean).join(" ").toLowerCase();
  return /australia|port hedland|new zealand|brazil|ponta da madeira|santos|호주|뉴질랜드|브라질/.test(route);
}

function salesPriorityScore(v = {}) {
  const commercial = Number(v.commercial_value_score || v.total_sales_priority_score || v.cleaning_candidate_score || 0);
  const biofouling = Number(v.biofouling_exposure_score || v.biofouling_score || v.risk_score || 0);
  const stayHours = Number(v.stay_hours || v.current_call_stay_hours || v.cumulative_stay_hours || v.anchorage_hours || 0);
  const staySignal = Math.min(100, Math.round(stayHours / 2));
  const workWindow = Number(v.work_feasibility_score || v.cleaning_window_score || 0);
  const confidence = Number(v.data_confidence_score || v.candidate_confidence || 0);
  const contact = Number(v.contact_readiness_score || 0);
  const regulated = regulatedRouteSignal(v) ? 100 : 0;
  const arrival = v.predicted_arrival_pipeline || v.status_bucket === "arriving_soon" ? Number(v.arrival_opportunity_score || 65) : 0;
  return Math.min(100, Math.round(
    commercial * 0.34 +
    biofouling * 0.18 +
    staySignal * 0.15 +
    regulated * 0.13 +
    Math.max(workWindow, arrival) * 0.10 +
    confidence * 0.06 +
    contact * 0.04
  ));
}

function salesPriorityBand(score = 0) {
  const value = Number(score || 0);
  if (value >= 80) return "HOT";
  if (value >= 60) return "WARM";
  return "LOW";
}

function assignSalesPriorityTiers(records = []) {
  const rows = sortCommercialPriority(records);
  if (!rows.length) return rows;
  const hotLimit = Math.max(1, Math.ceil(rows.length * 0.08));
  const warmLimit = Math.max(hotLimit, Math.ceil(rows.length * 0.35));
  rows.forEach((record, index) => {
    const label = index < hotLimit ? "HOT" : index < warmLimit ? "WARM" : "LOW";
    record.priority_label = label;
    record.sales_priority_band = label;
    record.candidate_band = record.is_immediate_candidate || label === "HOT"
      ? "immediate_target"
      : label === "WARM"
        ? "sales_target"
        : record.candidate_band || "sales_target";
  });
  return rows;
}

function salesPriorityReasonCodes(v = {}) {
  const reasons = [];
  if (Number(v.commercial_value_score || v.total_sales_priority_score || 0) >= IMMEDIATE_TARGET_THRESHOLD) reasons.push("HIGH_COMMERCIAL_SCORE");
  if (Number(v.biofouling_exposure_score || v.biofouling_score || v.risk_score || 0) >= 65) reasons.push("BIOFOULING_RISK");
  if (Number(v.stay_hours || v.current_call_stay_hours || v.cumulative_stay_hours || v.anchorage_hours || 0) >= 72) reasons.push("LONG_STAY_72H_PLUS");
  if (regulatedRouteSignal(v)) reasons.push("BRAZIL_AU_NZ_COMPLIANCE_ROUTE");
  if (v.predicted_arrival_pipeline || v.status_bucket === "arriving_soon") reasons.push("ARRIVAL_PIPELINE");
  if (v.contact_path_available || v.agent || v.agent_name || v.operator || v.operator_name) reasons.push("CONTACT_PATH_AVAILABLE");
  return [...new Set([...(v.reason_codes || []), ...reasons])].slice(0, 8);
}

const PUBLIC_API_SCHEMA_VERSION = "1.0";
const VERIFICATION_QUEUE_OUTPUT_LIMIT = 200;

function contractDataMode(mode = "", report = {}) {
  const value = String(mode || report?.data_mode || report?.data_source_used || "").toLowerCase();
  if (/sample/.test(value)) return "sample";
  if (report?.fallback_used === true || /fallback|no_live|diagnostic|degraded|sample_mode_final/.test(value)) return "fallback";
  return "live";
}

function vesselDisplay(record = {}) {
  const stayHours = firstFiniteNumber(record.stay_hours, record.current_call_stay_hours, record.cumulative_stay_hours, record.anchorage_hours, record.berth_hours);
  const opportunityScore = firstFiniteNumber(
    record.opportunity_score,
    record.sales_priority_score,
    record.commercial_value_score,
    record.total_sales_priority_score,
    record.cleaning_candidate_score,
    record.sales_score
  );
  const riskScore = firstFiniteNumber(
    record.risk_score,
    record.biofouling_exposure_score,
    record.biofouling_risk_score,
    record.biofouling_score,
    record.operational_risk_score
  );
  const confidenceScore = firstFiniteNumber(record.data_confidence_score, record.confidence_score, record.candidate_confidence, record.identity_confidence, record.match_score);
  return {
    vessel_name: displayText(firstNonEmpty(record.vessel_name, record.name, record.ship_name, "선명 확인 필요")),
    imo: displayText(firstNonEmpty(record.imo, record.imo_no)),
    mmsi: displayText(firstNonEmpty(record.mmsi)),
    call_sign: displayText(firstNonEmpty(record.call_sign, record.callsign, record.clsgn)),
    flag: displayText(firstNonEmpty(record.flag, record.vsslNltyNm, record.vsslNltyCd, record.nationality)),
    vessel_type: displayText(firstNonEmpty(record.vessel_type, record.vsslKndNm, record.vessel_type_group, record.commercial_segment)),
    gt: displayNumber(firstFiniteNumber(record.gt, record.grtg, record.intrlGrtg, record.gross_tonnage, record.grossTonnage)),
    dwt: displayNumber(firstFiniteNumber(record.dwt, record.deadweight, record.deadweight_tonnage)),
    operator: displayText(firstNonEmpty(record.operator_name, record.operator, record.operator_normalized)),
    company: displayText(firstNonEmpty(record.company, record.company_name, record.shipping_company, record.operator_name, record.operator, record.agent_name, record.agent)),
    owner: displayText(firstNonEmpty(record.owner_name, record.owner, record.ship_owner, record.registered_owner)),
    manager: displayText(firstNonEmpty(record.manager_name, record.manager, record.ship_manager, record.technical_manager)),
    technical_manager: displayText(firstNonEmpty(record.technical_manager, record.ship_manager, record.manager_name, record.manager)),
    current_port: displayText(firstNonEmpty(record.port_name, record.port, record.destination_port, record.destination)),
    eta: displayText(firstNonEmpty(record.eta, record.predicted_arrival_time)),
    etb: displayText(firstNonEmpty(record.etb)),
    ata: displayText(firstNonEmpty(record.ata)),
    atb: displayText(firstNonEmpty(record.atb)),
    stay_days: Number.isFinite(Number(stayHours)) ? Math.round((Number(stayHours) / 24) * 10) / 10 : "-",
    last_seen_at: displayText(firstNonEmpty(record.last_seen_at, record.updated_at, record.collected_at, record.first_seen_at, record.generated_at)),
    data_source: displayText(firstNonEmpty(record.source_label, record.data_source_used, record.source, record.source_mode, record.agent_source)),
    confidence_score: displayNumber(confidenceScore),
    opportunity_score: displayNumber(opportunityScore),
    risk_score: displayNumber(riskScore),
    contact_readiness_score: displayNumber(firstFiniteNumber(record.contact_readiness_score, record.sales_accessibility_score)),
    priority_label: displayText(firstNonEmpty(record.priority_label, record.sales_priority_band, salesPriorityBand(opportunityScore || riskScore || 0))),
    reason_summary: compactReasonSummary(record),
    recommended_action: compactRecommendedAction(record),
    data_sources: displaySources(record)
  };
}

const PUBLIC_VESSEL_ITEM_FIELDS = [
  "rank",
  "vessel_id",
  "master_vessel_id",
  "port_call_id",
  "hybrid_entity_key",
  "vessel_name",
  "name",
  "imo",
  "mmsi",
  "call_sign",
  "callsign",
  "clsgn",
  "vessel_type",
  "vessel_type_group",
  "gt",
  "dwt",
  "flag",
  "vsslNltyNm",
  "vsslNltyCd",
  "nationality",
  "operator_name",
  "operator",
  "company",
  "company_name",
  "shipping_company",
  "owner_name",
  "owner",
  "ship_owner",
  "registered_owner",
  "manager_name",
  "manager",
  "ship_manager",
  "technical_manager",
  "contact_readiness_score",
  "agent_name",
  "agent",
  "port",
  "port_code",
  "port_name",
  "sub_port",
  "berth",
  "berth_name",
  "anchorage_name",
  "status",
  "status_bucket",
  "eta",
  "etb",
  "ata",
  "atb",
  "etd",
  "atd",
  "stay_hours",
  "stay_days",
  "current_call_stay_hours",
  "cumulative_stay_hours",
  "anchorage_hours",
  "berth_hours",
  "arrival_port",
  "average_stay_days",
  "visit_count_30d",
  "visit_count_90d",
  "visit_count_365d",
  "visits_last_12_months",
  "ports_visited",
  "repeat_caller_score",
  "repeat_caller_count",
  "last_visit",
  "next_eta",
  "drydock_probability",
  "vessel_age",
  "build_year",
  "year_built",
  "built_year",
  "window_score",
  "window_type",
  "waiting_hours",
  "risk_level",
  "biofouling_risk_score",
  "hull_cleaning_opportunity_score",
  "departure_prediction_eta",
  "departure_prediction_confidence",
  "departure_prediction_source",
  "port_congestion_index",
  "hot_prospect_rank",
  "loitering_detected",
  "loitering_hours",
  "loitering_reason",
  "hourly_ais_bucket",
  "hourly_ais_duplicate_count",
  "sst_anomaly_z_score",
  "pilot_event_suppressed",
  "pilot_suppression_reason",
  "alert_dedupe_window_hours",
  "hull_cleaning_candidate_score",
  "hotspot_score",
  "sst_anomaly",
  "ais_dwell_hours",
  "salinity_proxy",
  "norm_sst_anomaly",
  "norm_dwell_time",
  "norm_salinity",
  "model_version",
  "formula",
  "factors",
  "compliance_score",
  "destination",
  "destination_port",
  "next_port",
  "destination_country",
  "exposure_tags",
  "route_signal",
  "commercial_compliance_signal",
  "fleet_score",
  "korea_presence_score",
  "superintendent_probability",
  "contact_confidence",
  "relationship_score",
  "repeat_interactions",
  "opportunity_value",
  "opportunity_value_currency",
  "ports_served",
  "operators_served",
  "entity_type",
  "entity_name",
  "related_vessels_count",
  "hot_targets_count",
  "previous_contacts",
  "previous_quotes",
  "previous_wins",
  "last_contacted_at",
  "customer_type",
  "customer_name",
  "contact_attempts",
  "quote_history_count",
  "quote_value_record_count",
  "quote_result_count",
  "won_projects",
  "lost_projects",
  "operation_completed_count",
  "customer_feedback_count",
  "fleet_history",
  "customer_memory_score",
  "sensitive_details_exposed",
  "latest_contact_at",
  "latest_quote_at",
  "latest_feedback_at",
  "targeted_vessels",
  "won_vessels",
  "captured_vessels",
  "penetration_rate",
  "opportunity_gap",
  "estimated_remaining_revenue",
  "vessels_seen",
  "previous_targets",
  "previous_hot_candidates",
  "ports_used",
  "last_seen",
  "demand_score",
  "fleet_size_korea",
  "vessel_count",
  "hot_count",
  "warm_count",
  "sales_target_count",
  "high_risk_count",
  "compliance_exposure_count",
  "service_opportunity_counts",
  "services",
  "growth_trend",
  "known_korea_vessels",
  "total_operator_vessels",
  "high_opportunity_vessels",
  "unseen_vessels",
  "fleet_expansion_score",
  "fleet_dna",
  "fleet_profile",
  "preferred_ports",
  "repeat_visit_frequency",
  "common_vessel_types",
  "compliance_exposure_tags",
  "congestion_exposure",
  "commercial_tendency",
  "recommended_sales_strategy",
  "estimated_revenue",
  "revenue_opportunity",
  "portfolio",
  "conservative_revenue",
  "expected_revenue",
  "aggressive_revenue",
  "average_opportunity_score",
  "average_risk_score",
  "average_congestion_score",
  "average_waiting_hours",
  "opportunity_index",
  "dominant_vessel_types",
  "top_operators",
  "commercial_density",
  "port_personality",
  "first_seen",
  "visit_history",
  "risk_history",
  "opportunity_history",
  "top_ports",
  "top_vessels",
  "recommended_sales_angle",
  "estimated_revenue_low",
  "estimated_revenue_high",
  "target_count",
  "total_targets",
  "hot_targets",
  "warm_targets",
  "low_targets",
  "sections",
  "by_port",
  "by_operator",
  "by_category",
  "agent_name",
  "ports_served",
  "operators_served",
  "missing_contact_count",
  "hot_count_30d",
  "hot_count_90d",
  "warm_count_90d",
  "target_count_90d",
  "previous_priority_labels",
  "last_hot_at",
  "repeat_target_score",
  "current_stage",
  "previous_stage",
  "stage_updated_at",
  "days_in_stage",
  "hot_vessels_90d",
  "target_vessels_90d",
  "repeat_target_count",
  "repeat_opportunity_score",
  "days_since_first_hot",
  "decay_score",
  "urgency_score",
  "days_visible",
  "contact_count",
  "missed_opportunity_score",
  "win_probability",
  "actionability_score",
  "monthly_opportunity_trend",
  "seasonality_score",
  "peak_months",
  "low_months",
  "revenue_score",
  "heatmap_score",
  "opportunity_score",
  "sales_priority_score",
  "commercial_value_score",
  "total_sales_priority_score",
  "cleaning_candidate_score",
  "biofouling_exposure_score",
  "biofouling_score",
  "risk_score",
  "data_confidence_score",
  "confidence_score",
  "candidate_band",
  "sales_priority_band",
  "priority_label",
  "watch_type",
  "watch_name",
  "priority",
  "current_status",
  "current_port",
  "change_events",
  "primary_category",
  "primary_category_code",
  "primary_category_label",
  "target_categories",
  "action_type",
  "action_label",
  "reason_codes",
  "commercial_signal_flags",
  "top_factors",
  "reason_summary",
  "why_now",
  "recommended_action",
  "recommended_next_action",
  "reason",
  "recommended_message_angle",
  "urgency",
  "next_action",
  "verification_type",
  "known_company",
  "missing_fields",
  "source_names",
  "data_sources",
  "source_label",
  "data_source_used",
  "source_mode",
  "agent_source",
  "operator_source",
  "enrichment_source",
  "enrichment_sources",
  "last_seen_at",
  "updated_at",
  "collected_at",
  "source",
  "source_table",
  "destination",
  "destination_port",
  "next_port"
];

function isVesselLikeRecord(record = {}) {
  return hasValue(record.vessel_name || record.name || record.imo || record.mmsi || record.call_sign || record.port_name || record.port || record.opportunity_score || record.commercial_value_score || record.risk_score);
}

function withVesselDisplay(record = {}) {
  if (!record || typeof record !== "object" || Array.isArray(record)) return record;
  if (!isVesselLikeRecord(record)) return record;
  const compact = {};
  for (const field of PUBLIC_VESSEL_ITEM_FIELDS) {
    const value = record[field];
    if (value !== undefined && value !== null && value !== "") compact[field] = value;
  }
  compact.vessel_display = record.vessel_display || vesselDisplay(record);
  return compact;
}

function publicItemsEnvelope({ generatedAt, dataMode, report = {}, sourceTable = "derived_dataset", items = [], extra = {} } = {}) {
  const rows = Array.isArray(items) ? items.filter(item => item !== null && item !== undefined) : [];
  return {
    schema_version: PUBLIC_API_SCHEMA_VERSION,
    generated_at: generatedAt || report?.generated_at || report?.completed_at || new Date().toISOString(),
    data_mode: contractDataMode(dataMode, report),
    record_count: rows.length,
    source_table: sourceTable,
    items: rows.map(withVesselDisplay),
    ...extra
  };
}

function buildPaginatedVesselOutputs({ records = [], generatedAt = new Date().toISOString(), dataMode = "live", pageSize = 30 } = {}) {
  const rows = Array.isArray(records) ? records.map(row => ({
    vessel_id: firstNonEmpty(row.vessel_id, row.master_vessel_id, row.hybrid_entity_key, row.port_call_id),
    master_vessel_id: firstNonEmpty(row.master_vessel_id, row.hybrid_entity_key),
    port_call_id: row.port_call_id || "",
    vessel_name: row.vessel_name || row.name || "",
    imo: row.imo || "",
    mmsi: row.mmsi || "",
    call_sign: row.call_sign || row.callsign || row.clsgn || "",
    port_code: row.port_code || "",
    port_name: row.port_name || row.port || "",
    vessel_display: vesselDisplay(row)
  })) : [];
  const safePageSize = Math.max(1, Number(pageSize || 30));
  const totalPages = rows.length ? Math.ceil(rows.length / safePageSize) : 0;
  const pages = Array.from({ length: totalPages }, (_, index) => `page-${index + 1}.json`);
  const outputs = {
    "dashboard/api/vessels/index.json": {
      schema_version: PUBLIC_API_SCHEMA_VERSION,
      generated_at: generatedAt,
      data_mode: contractDataMode(dataMode),
      total_count: rows.length,
      page_size: safePageSize,
      total_pages: totalPages,
      pages
    }
  };
  for (let index = 0; index < totalPages; index += 1) {
    const page = index + 1;
    outputs[`dashboard/api/vessels/page-${page}.json`] = {
      schema_version: PUBLIC_API_SCHEMA_VERSION,
      generated_at: generatedAt,
      data_mode: contractDataMode(dataMode),
      page,
      page_size: safePageSize,
      total_count: rows.length,
      total_pages: totalPages,
      items: rows.slice(index * safePageSize, (index + 1) * safePageSize)
    };
  }
  return outputs;
}

function cleanupStalePaginatedVesselFiles(expectedOutputs = {}, report = {}) {
  const indexPath = routeApiOutputPath("dashboard/api/vessels/index.json", report);
  const dir = indexPath.split("/").slice(0, -1).join("/");
  if (!fs.existsSync(dir)) return { removed: [] };
  const expected = new Set(Object.keys(expectedOutputs)
    .filter(filePath => /dashboard\/api\/vessels\/page-\d+\.json$/.test(filePath))
    .map(filePath => filePath.split("/").pop()));
  const removed = [];
  for (const file of fs.readdirSync(dir)) {
    if (!/^page-\d+\.json$/.test(file) || expected.has(file)) continue;
    fs.unlinkSync(`${dir}/${file}`);
    removed.push(file);
  }
  return { removed };
}

function compactItems(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.items)) return value.items;
  if (Array.isArray(value?.opportunities)) return value.opportunities;
  if (Array.isArray(value?.alerts)) return value.alerts;
  if (Array.isArray(value?.data)) return value.data;
  return [];
}

function compactBootstrapVesselItem(item = {}, index = 0) {
  const display = item.vessel_display || vesselDisplay(item);
  return {
    rank: Number(item.rank || index + 1),
    vessel_name: display.vessel_name || item.vessel_name || "선명 확인 필요",
    imo: display.imo || item.imo || "-",
    mmsi: display.mmsi || item.mmsi || "-",
    port: item.port || item.port_name || display.current_port || "-",
    opportunity_score: firstFiniteNumber(item.opportunity_score, item.sales_priority_score, item.commercial_value_score, display.opportunity_score, 0),
    risk_score: firstFiniteNumber(item.risk_score, item.biofouling_exposure_score, item.biofouling_score, display.risk_score, 0),
    confidence_score: firstFiniteNumber(item.confidence_score, item.data_confidence_score, display.confidence_score, 0),
    priority_label: item.priority_label || item.sales_priority_band || display.priority_label || "LOW",
    reason_summary: item.reason_summary || display.reason_summary || compactReasonSummary(item),
    recommended_action: item.recommended_action || display.recommended_action || compactRecommendedAction(item),
    data_sources: displaySources(item).slice(0, 4),
    last_seen_at: item.last_seen_at || item.collected_at || display.last_seen_at || null
  };
}

function buildBootstrapSnapshot({
  dashboardSummary = {},
  report = {},
  portStatistics = {},
  topCandidates = {},
  salesPriority = {},
  alerts = {},
  previousKpiReference = {},
  generatedAt = new Date().toISOString(),
  dataMode = "live"
} = {}) {
  const topItems = compactItems(topCandidates.items || topCandidates.opportunities || topCandidates).slice(0, 10).map(compactBootstrapVesselItem);
  const priorityItems = compactItems(salesPriority.items || salesPriority).slice(0, 10).map(compactBootstrapVesselItem);
  const alertItems = compactItems(alerts.items || alerts.alerts || alerts).slice(0, 10);
  const ports = compactItems(portStatistics.ports || dashboardSummary.ports).slice(0, 20).map(port => ({
    port_code: port.port_code || null,
    port_name: port.port_name || port.display_name || port.port || "미확인 항만",
    display_name: port.display_name || port.port_name || port.port || "미확인 항만",
    vessel_count: Number(port.vessel_count || port.total_vessels || 0),
    target_count: Number(port.target_count || port.sales_target_count || port.candidate_count || port.target_vessels || port.sales_candidates || port.sales_targets || 0),
    hot_count: Number(port.hot_count || port.hot_candidate_count || port.immediate_target_count || port.immediate_targets || 0),
    avg_opportunity_score: firstFiniteNumber(port.avg_opportunity_score, port.average_opportunity_score, port.port_opportunity_score, port.opportunity_index) ?? null
  }));
  const kpis = {
    total_vessels: Number(dashboardSummary.total_vessels || dashboardSummary.all_vessels_count || report.all_collected_vessel_count || 0),
    sales_target_count: Number(dashboardSummary.sales_target_count || 0),
    immediate_target_count: Number(dashboardSummary.immediate_target_count || 0),
    hot_count: topItems.filter(item => String(item.priority_label || item.sales_priority_band || "").toUpperCase() === "HOT").length,
    warm_count: topItems.filter(item => String(item.priority_label || item.sales_priority_band || "").toUpperCase() === "WARM").length,
    port_count: Number(dashboardSummary.port_count || ports.length || 0),
    arrival_pipeline_count: Number(dashboardSummary.arrival_pipeline_count || 0),
    staying_vessels_count: Number(dashboardSummary.staying_vessels_count || dashboardSummary.staying_vessel_count || 0),
    anchorage_waiting_count: Number(dashboardSummary.anchorage_waiting_count || 0),
    high_risk_count: Number(dashboardSummary.high_risk_count || 0),
    contact_now_count: Number(dashboardSummary.contact_now_count || 0),
    pre_arrival_target_count: Number(dashboardSummary.pre_arrival_target_count || 0),
    anchorage_opportunity_count: Number(dashboardSummary.anchorage_opportunity_count || 0),
    long_stay_risk_count: Number(dashboardSummary.long_stay_risk_count || 0),
    compliance_target_count: Number(dashboardSummary.compliance_target_count || 0),
    repeat_caller_count: Number(dashboardSummary.repeat_caller_count || 0),
    fleet_expansion_count: Number(dashboardSummary.fleet_expansion_count || 0),
    verify_contact_count: Number(dashboardSummary.verify_contact_count || 0),
    monitor_count: Number(dashboardSummary.monitor_count || 0),
    hold_count: Number(dashboardSummary.hold_count || 0)
  };
  const kpiTrends = buildKpiTrends(kpis, previousKpiReference);
  return {
    schema_version: PUBLIC_API_SCHEMA_VERSION,
    generated_at: generatedAt,
    data_mode: contractDataMode(dataMode, report),
    fallback_used: Boolean(report.fallback_used || dashboardSummary.fallback_used),
    record_count: Number(dashboardSummary.record_count || report.record_count || dashboardSummary.all_vessels_count || 0),
    kpis,
    kpi_trends: kpiTrends,
    trend_metrics: buildGrowthMetrics(kpiTrends),
    ports,
    top_candidates: topItems,
    sales_priority: priorityItems,
    alerts: alertItems,
    data_health: {
      status: report.data_mode === "sample_mode" ? "sample" : report.fallback_used ? "degraded" : "healthy",
      latest_successful_run_id: dashboardSummary.latest_successful_run_id || report.latest_successful_run_id || null,
      last_success_at: dashboardSummary.last_success_at || report.last_success_at || generatedAt,
      source_status: {
        source_rows_collected: Number(report.source_rows_collected || report.raw_collected_vessel_count || 0),
        normalized_rows: Number(report.normalized_rows || report.all_collected_vessel_count || 0),
        ports_attempted_count: Number(report.ports_attempted_count || 0)
      },
      db_status: {
        supabase_write_status: report.supabase_write?.status || report.storage_status?.supabase?.status || "unknown",
        promotion_status: report.promotion_status || "unknown",
        rows_written_by_table: report.rows_written_by_table ? {
          vessel_snapshots: Number(report.rows_written_by_table.vessel_snapshots || 0),
          opportunity_master: Number(report.rows_written_by_table.opportunity_master || 0),
          dashboard_summary_snapshots: Number(report.rows_written_by_table.dashboard_summary_snapshots || 0)
        } : {}
      },
      json_status: {
        output_mode: report.output_mode || "static_json"
      }
    }
  };
}

function buildContinuityEnvelope(dataContinuity = {}, report = {}, generatedAt = new Date().toISOString()) {
  return publicItemsEnvelope({
    generatedAt,
    dataMode: report.data_mode,
    report,
    sourceTable: "active_dataset_pointer,latest_successful_dataset",
    items: [{
      status: dataContinuity.status || "unknown",
      fallback_order: dataContinuity.fallback_order || [],
      storage_verification: dataContinuity.storage_verification || {},
      operator_message_ko: dataContinuity.operator_message_ko || null
    }],
    extra: dataContinuity
  });
}

function buildTopCandidatesPayload({ candidateList = [], immediateTargets = [], salesCandidates = [], hotVessels = [], generatedAt = new Date().toISOString(), dataMode = "live" } = {}) {
  const opportunities = dedupeCandidateRows([
    ...candidateList,
    ...immediateTargets,
    ...salesCandidates,
    ...hotVessels
  ])
    .map(v => {
      const priorityScore = salesPriorityScore(v);
      const stayHours = Number(v.stay_hours || v.current_call_stay_hours || v.cumulative_stay_hours || v.anchorage_hours || 0);
      const reasonSummary = v.reason_summary || v.why_now || v.candidate_summary_ko || [
        priorityScore >= 80 ? "오늘 연락 우선순위가 높은 후보입니다." : null,
        regulatedRouteSignal(v) ? "Brazil/Australia/New Zealand 규제 항로 가능성이 있습니다." : null,
        stayHours >= 72 ? "장기 체류 또는 묘박 신호가 있습니다." : null,
        Number(v.biofouling_exposure_score || v.biofouling_score || v.risk_score || 0) >= 65 ? "Biofouling 위험 신호가 높습니다." : null
      ].filter(Boolean).join(" ") || "상업 점수와 항만 체류 신호를 확인하세요.";
      return {
        ...v,
        port: v.port_name || v.port,
        vessel_type: firstNonEmpty(v.vessel_type, v.vsslKndNm, v.vessel_type_group, v.commercial_segment) || null,
        stay_hours: stayHours,
        stay_days: Math.round((stayHours / 24) * 10) / 10,
        opportunity_score: priorityScore,
        sales_priority_score: priorityScore,
        priority_label: String(v.priority_label || v.sales_priority_band || "").toUpperCase() || salesPriorityBand(priorityScore),
        sales_priority_band: String(v.sales_priority_band || v.priority_label || "").toUpperCase() || salesPriorityBand(priorityScore),
        reason_codes: salesPriorityReasonCodes(v),
        reason_summary: reasonSummary,
        recommended_action: v.recommended_action || v.recommended_next_action || v.candidate_next_action || "Confirm contact path and work window.",
        why_now: v.why_now || reasonSummary
      };
    })
    .sort((a, b) =>
      Number(b.sales_priority_score || 0) - Number(a.sales_priority_score || 0) ||
      Number(b.commercial_value_score || b.total_sales_priority_score || 0) - Number(a.commercial_value_score || a.total_sales_priority_score || 0) ||
      Number(b.stay_hours || b.cumulative_stay_hours || 0) - Number(a.stay_hours || a.cumulative_stay_hours || 0)
    )
    .slice(0, 50)
    .map((v, index) => ({ ...v, rank: index + 1 }));
  const decoratedOpportunities = opportunities.map(withVesselDisplay);
  return {
    schema_version: PUBLIC_API_SCHEMA_VERSION,
    generated_at: generatedAt,
    data_mode: contractDataMode(dataMode),
    record_count: decoratedOpportunities.length,
    source_table: "opportunity_master",
    items: decoratedOpportunities,
    focus_question: "Which vessel should HullWiper Korea contact next and why?",
    ranking_model: "sales_priority_v3",
    immediate_targets: decoratedOpportunities.filter(v => v.sales_priority_band === "HOT" || v.is_immediate_candidate || Number(v.commercial_value_score || v.total_sales_priority_score || 0) >= IMMEDIATE_TARGET_THRESHOLD).slice(0, 10),
    opportunities: decoratedOpportunities,
    operating_rule: "Sales priority blends commercial score, biofouling risk, long stay, Brazil/Australia/New Zealand compliance route, work window, confidence, and contact readiness."
  };
}

const INTELLIGENCE_SCHEMA_VERSION = PUBLIC_API_SCHEMA_VERSION;

function firstNonEmpty(...values) {
  return values.find(value => value !== undefined && value !== null && String(value).trim() !== "") ?? "";
}

function displayText(value) {
  return value !== undefined && value !== null && String(value).trim() !== "" ? value : "-";
}

function displayNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : "-";
}

function displaySources(record = {}) {
  const raw = [
    record.data_sources,
    record.enrichment_sources,
    record.source_label,
    record.data_source_used,
    record.source,
    record.source_name,
    record.source_mode,
    record.agent_source,
    record.operator_source,
    record.enrichment_source,
    record.gt_source,
    record.eta_source
  ].flatMap(value => Array.isArray(value) ? value : value ? [value] : []);
  return [...new Set(raw.map(value => String(value).trim()).filter(Boolean))];
}

function firstFiniteNumber(...values) {
  for (const value of values) {
    if (value === undefined || value === null || String(value).trim() === "") continue;
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

const KPI_TREND_ALIASES = {
  total_vessels: ["total_vessels", "all_vessels_count", "all_collected_vessel_count", "record_count"],
  sales_target_count: ["sales_target_count", "target_count", "sales_candidate_count"],
  immediate_target_count: ["immediate_target_count", "immediate_candidate_count"],
  hot_count: ["hot_count", "hot_vessel_count", "immediate_target_count"],
  warm_count: ["warm_count"],
  port_count: ["port_count"],
  arrival_pipeline_count: ["arrival_pipeline_count"],
  staying_vessels_count: ["staying_vessels_count", "staying_vessel_count"],
  anchorage_waiting_count: ["anchorage_waiting_count", "anchorage_detected_count"],
  high_risk_count: ["high_risk_count"],
  compliance_target_count: ["compliance_target_count"],
  contact_now_count: ["contact_now_count"],
  pre_arrival_target_count: ["pre_arrival_target_count"],
  anchorage_opportunity_count: ["anchorage_opportunity_count"],
  long_stay_risk_count: ["long_stay_risk_count"],
  repeat_caller_count: ["repeat_caller_count"],
  fleet_expansion_count: ["fleet_expansion_count"],
  verify_contact_count: ["verify_contact_count"],
  monitor_count: ["monitor_count"],
  hold_count: ["hold_count"]
};

function trendNumber(value) {
  if (value === undefined || value === null || String(value).trim() === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function previousKpiValue(previous = {}, key) {
  const aliases = KPI_TREND_ALIASES[key] || [key];
  const sources = [previous?.kpis, previous];
  for (const source of sources) {
    if (!source || typeof source !== "object") continue;
    for (const alias of aliases) {
      const value = trendNumber(source[alias]);
      if (value !== null) return value;
    }
  }
  return null;
}

function kpiTrend(currentValue, previousValue) {
  const current = trendNumber(currentValue);
  const previous = trendNumber(previousValue);
  const delta = current !== null && previous !== null ? current - previous : null;
  let deltaPercent = null;
  if (delta !== null) {
    if (previous === 0) deltaPercent = current === 0 ? 0 : null;
    else deltaPercent = Math.round((delta / Math.abs(previous)) * 1000) / 10;
  }
  return {
    current_value: current,
    previous_value: previous,
    delta,
    delta_percent: deltaPercent,
    direction: delta === null ? "unknown" : delta > 0 ? "up" : delta < 0 ? "down" : "flat"
  };
}

function loadPreviousKpiTrendReference() {
  const bootstrap = readJsonSafe("dashboard/api/bootstrap.json", null);
  const summary = readJsonSafe("dashboard/api/dashboard-summary.json", null);
  return bootstrap?.kpis ? bootstrap : summary || bootstrap || {};
}

function buildKpiTrends(currentKpis = {}, previousReference = {}) {
  const keys = [...new Set([
    ...Object.keys(currentKpis || {}),
    ...Object.keys(KPI_TREND_ALIASES)
  ])];
  return Object.fromEntries(keys.map(key => [
    key,
    kpiTrend(currentKpis[key], previousKpiValue(previousReference, key))
  ]));
}

function buildGrowthMetrics(kpiTrends = {}) {
  return {
    vessel_growth: { metric_key: "total_vessels", ...(kpiTrends.total_vessels || {}) },
    target_growth: { metric_key: "sales_target_count", ...(kpiTrends.sales_target_count || {}) },
    port_growth: { metric_key: "port_count", ...(kpiTrends.port_count || {}) },
    risk_growth: { metric_key: "high_risk_count", ...(kpiTrends.high_risk_count || {}) },
    compliance_growth: { metric_key: "compliance_target_count", ...(kpiTrends.compliance_target_count || {}) }
  };
}

function compactInsightFactors(record = {}) {
  const values = [
    record.reason_codes,
    record.score_reasons,
    record.commercial_signal_flags,
    record.biofouling_exposure_reasons,
    record.operational_risk_flags,
    record.fleet_alerts,
    record.rule_hits,
    record.rule_versions
  ].flatMap(value => Array.isArray(value) ? value : value ? [value] : []);
  return [...new Set(values.map(value => String(value).trim()).filter(Boolean))].slice(0, 5);
}

function compactReasonSummary(record = {}) {
  return firstNonEmpty(
    record.reason_summary,
    record.why_scored_high,
    record.why_now,
    record.candidate_summary_ko,
    record.opportunity_summary,
    record.sales_reason,
    compactInsightFactors(record).join(", ")
  ) || "점수 구성 요소를 확인하세요.";
}

function compactRecommendedAction(record = {}) {
  return firstNonEmpty(
    record.recommended_action,
    record.recommended_next_action,
    record.candidate_next_action,
    record.next_action
  ) || "상위 신호와 연락 가능 시간을 확인하세요.";
}

function compactVesselInsight(record = {}, index = 0, extra = {}) {
  const opportunityScore = firstFiniteNumber(
    record.opportunity_score,
    record.sales_priority_score,
    record.commercial_value_score,
    record.total_sales_priority_score,
    record.cleaning_candidate_score
  );
  const riskScore = firstFiniteNumber(
    record.risk_score,
    record.biofouling_exposure_score,
    record.biofouling_risk_score,
    record.biofouling_score,
    record.operational_risk_score
  );
  return {
    rank: index + 1,
    vessel_name: firstNonEmpty(record.vessel_name, record.name, record.ship_name, "선명 확인 필요"),
    imo: firstNonEmpty(record.imo, record.imo_no) || null,
    mmsi: firstNonEmpty(record.mmsi) || null,
    port: firstNonEmpty(record.port_name, record.port, record.destination_port, record.destination) || null,
    opportunity_score: opportunityScore,
    risk_score: riskScore,
    reason_summary: compactReasonSummary(record),
    top_factors: compactInsightFactors(record),
    recommended_action: compactRecommendedAction(record),
    source_id: firstNonEmpty(record.port_call_id, record.opportunity_id, record.snapshot_id, record.master_vessel_id, record.hybrid_entity_key) || null,
    ...extra
  };
}

function repeatCallerVisitCount(record = {}, windowDays = 365) {
  if (windowDays <= 30) {
    return firstFiniteNumber(record.visit_count_30d, record.visits_last_30d, record.calls_last_30d, record.calls_last_1m, record.repeat_call_count_30d, 0) || 0;
  }
  if (windowDays <= 90) {
    return firstFiniteNumber(record.visit_count_90d, record.visits_last_90d, record.calls_last_90d, record.calls_last_3m, record.repeat_call_count_90d, 0) || 0;
  }
  return firstFiniteNumber(record.visit_count_365d, record.visits_last_365d, record.visits_last_12_months, record.calls_last_12m, record.repeat_call_count, record.observation_count, 0) || 0;
}

function repeatCallerAverageStayDays(record = {}) {
  const hours = firstFiniteNumber(record.average_stay_hours, record.avg_stay_hours, record.historical_avg_stay_hours, record.stay_hours, record.current_call_stay_hours, record.cumulative_stay_hours, 0) || 0;
  return Math.round((Number(hours || 0) / 24) * 10) / 10;
}

function repeatCallerPorts(record = {}) {
  const raw = Array.isArray(record.ports_visited)
    ? record.ports_visited
    : [record.port_name, record.port, record.destination_port, record.destination, record.next_port];
  return [...new Set(raw.map(value => String(value || "").trim()).filter(Boolean))].slice(0, 6);
}

function repeatCallerPriorityScore(record = {}) {
  const visits90 = repeatCallerVisitCount(record, 90);
  const visits365 = repeatCallerVisitCount(record, 365);
  const ports = repeatCallerPorts(record);
  const priority = String(firstNonEmpty(record.priority_label, record.sales_priority_band, record.candidate_band, "")).toUpperCase();
  return (
    (visits90 >= 2 ? 1000 : 0) +
    (ports.length === 1 && visits365 >= 2 ? 250 : 0) +
    (priority === "HOT" ? 200 : priority === "WARM" ? 80 : 0) +
    (Number(record.repeat_caller_score || 0) * 3) +
    salesPriorityScore(record)
  );
}

function repeatCallerReasonSummary(record = {}) {
  const visits90 = repeatCallerVisitCount(record, 90);
  const visits365 = repeatCallerVisitCount(record, 365);
  const ports = repeatCallerPorts(record);
  const operator = firstNonEmpty(record.operator_name, record.operator, record.operator_normalized, record.company, record.shipping_company);
  const pieces = [];
  if (visits90 >= 2) pieces.push(`최근 90일 ${visits90}회 한국 항만 방문 신호`);
  else if (visits365 > 0) pieces.push(`최근 12개월 ${visits365}회 방문 신호`);
  if (ports.length === 1 && visits365 >= 2) pieces.push(`${ports[0]} 반복 이용`);
  else if (ports.length > 1) pieces.push(`${ports.slice(0, 3).join(", ")} 등 복수 항만 방문`);
  if (operator) pieces.push(`${operator} 운항/관리 단서`);
  if (String(firstNonEmpty(record.priority_label, record.sales_priority_band, record.candidate_band, "")).toUpperCase() === "HOT") pieces.push("기존 HOT 후보");
  return pieces.length ? pieces.join(" · ") : compactReasonSummary(record);
}

function repeatCallerRecommendedAction(record = {}) {
  const visits90 = repeatCallerVisitCount(record, 90);
  const priority = String(firstNonEmpty(record.priority_label, record.sales_priority_band, record.candidate_band, "")).toUpperCase();
  if (priority === "HOT") return "반복 입항 이력과 현재 HOT 사유를 묶어 선사 담당자에게 우선 연락";
  if (visits90 >= 2) return "최근 반복 입항 패턴을 근거로 정기 세척/점검 수요를 확인";
  return "이전 방문 항만과 운항사를 확인해 다음 입항 전 영업 타이밍을 점검";
}

function intelligenceEnvelope({ generatedAt, dataMode, sourceTable, items = [], summary = {}, extra = {} } = {}) {
  const capped = items.filter(item => item && typeof item === "object").slice(0, 10);
  return {
    generated_at: generatedAt || new Date().toISOString(),
    schema_version: INTELLIGENCE_SCHEMA_VERSION,
    data_mode: contractDataMode(dataMode),
    record_count: capped.length,
    source_table: sourceTable,
    items: capped.map(withVesselDisplay),
    ...extra,
    summary
  };
}

function buildRiskIntelligenceSummary({ records = [], scoringDiagnostics = {}, generatedAt, dataMode } = {}) {
  const items = records
    .map((record, index) => {
      const riskScore = firstFiniteNumber(
        record.risk_score,
        record.biofouling_exposure_score,
        record.biofouling_risk_score,
        record.biofouling_score,
        record.operational_risk_score,
        record.congestion_score
      ) || 0;
      return { record, riskScore, index };
    })
    .filter(row => row.riskScore > 0 || compactInsightFactors(row.record).some(factor => /risk|bio|congestion|long|anchor/i.test(factor)))
    .sort((a, b) => b.riskScore - a.riskScore || salesPriorityScore(b.record) - salesPriorityScore(a.record))
    .slice(0, 10)
    .map((row, index) => compactVesselInsight(row.record, index, {
      risk_score: row.riskScore,
      risk_band: firstNonEmpty(row.record.biofouling_exposure_band, row.record.risk_band, row.record.operational_risk_band) || null
    }));
  return intelligenceEnvelope({
    generatedAt,
    dataMode,
    sourceTable: "risk_history",
    items,
    summary: {
      high_risk_count: Number(scoringDiagnostics?.biofouling_high_risk_count || scoringDiagnostics?.high_risk_count || items.filter(item => Number(item.risk_score || 0) >= 65).length || 0),
      source_hint: "biofouling_exposure_score / operational_risk_score"
    }
  });
}

function buildExplainabilityIntelligenceSummary({ topCandidates = {}, candidateList = [], salesCandidates = [], immediateTargets = [], generatedAt, dataMode } = {}) {
  const source = dedupeCandidateRows([
    ...(topCandidates.opportunities || []),
    ...candidateList,
    ...immediateTargets,
    ...salesCandidates
  ]);
  const items = sortCommercialPriority(source)
    .filter(record => salesPriorityScore(record) > 0 || compactInsightFactors(record).length || compactReasonSummary(record))
    .slice(0, 10)
    .map((record, index) => compactVesselInsight(record, index, {
      opportunity_score: salesPriorityScore(record),
      priority_label: record.priority_label || record.sales_priority_band || salesPriorityBand(salesPriorityScore(record))
    }));
  return intelligenceEnvelope({
    generatedAt,
    dataMode,
    sourceTable: "explainability_snapshots,rule_evaluations",
    items,
    summary: {
      explainability_rule_version: "explainability_ko_v2026_05_31",
      source_hint: "why_now / reason_codes / score_reasons"
    }
  });
}

function buildPredictionIntelligenceSummary({ arrivalPipeline = [], predictedCleaningOpportunities = [], predictionDiagnostics = {}, generatedAt, dataMode } = {}) {
  const arrivalItems = arrivalPipeline.slice(0, 10).map((record, index) => compactVesselInsight(record, index, {
    item_type: "arrival",
    predicted_at: firstNonEmpty(record.predicted_arrival_time, record.eta, record.eta_candidate) || null,
    prediction_confidence: firstFiniteNumber(record.arrival_prediction_confidence, record.prediction_confidence, record.route_pattern_confidence),
    opportunity_score: firstFiniteNumber(record.arrival_opportunity_score, record.commercial_value_score, record.total_sales_priority_score)
  }));
  const cleaningItems = predictedCleaningOpportunities.slice(0, 10).map((record, index) => compactVesselInsight(record, index, {
    item_type: "cleaning",
    prediction_confidence: firstFiniteNumber(record.work_window_confidence, record.arrival_prediction_confidence, record.prediction_confidence),
    opportunity_score: firstFiniteNumber(record.predicted_cleaning_opportunity_score, record.commercial_value_score, record.total_sales_priority_score),
    reason_summary: firstNonEmpty(record.opportunity_summary, compactReasonSummary(record))
  }));
  const items = [...arrivalItems, ...cleaningItems]
    .sort((a, b) => Number(b.opportunity_score || 0) - Number(a.opportunity_score || 0))
    .slice(0, 10)
    .map((item, index) => ({ ...item, rank: index + 1 }));
  return intelligenceEnvelope({
    generatedAt,
    dataMode,
    sourceTable: "predicted_arrivals,model_training_rows",
    items,
    extra: { disclaimer: "예측 신호 / 실험 기능" },
    summary: {
      prediction_accuracy_band: predictionDiagnostics?.prediction_accuracy_band || "insufficient_data",
      predictions_matched_to_actual_count: Number(predictionDiagnostics?.predictions_matched_to_actual_count || 0)
    }
  });
}

function buildOperatorIntelligenceSummary({ fleetOpportunities = [], operatorDiagnostics = {}, generatedAt, dataMode } = {}) {
  const items = fleetOpportunities
    .slice()
    .sort((a, b) => Number(b.fleet_opportunity_score || 0) - Number(a.fleet_opportunity_score || 0))
    .slice(0, 10)
    .map((record, index) => ({
      rank: index + 1,
      operator_name: firstNonEmpty(record.operator_name, record.operator_normalized, "운영사 확인 필요"),
      opportunity_score: firstFiniteNumber(record.fleet_opportunity_score, record.average_commercial_value),
      vessel_count: firstFiniteNumber(record.current_vessel_count, record.operator_vessel_count, record.target_vessel_count) || 0,
      target_vessel_count: firstFiniteNumber(record.target_vessel_count) || 0,
      immediate_target_count: firstFiniteNumber(record.immediate_target_count) || 0,
      reason_summary: compactReasonSummary(record),
      top_factors: compactInsightFactors(record),
      recommended_action: compactRecommendedAction(record),
      top_vessels: Array.isArray(record.top_vessels) ? record.top_vessels.slice(0, 3) : []
    }));
  return intelligenceEnvelope({
    generatedAt,
    dataMode,
    sourceTable: "operator_snapshot_daily",
    items,
    summary: {
      operator_count: Number(operatorDiagnostics?.operator_count || fleetOpportunities.length || 0),
      source_hint: "fleet_opportunities / operator_snapshot_daily"
    }
  });
}

function buildAgentIntelligenceSummary({ records = [], generatedAt, dataMode } = {}) {
  const items = sortCommercialPriority(records)
    .filter(record => firstNonEmpty(record.agent_name, record.agent, record.satmntEntrpsNm, record.entrpsCdNm))
    .map((record, index) => ({
      ...compactVesselInsight(record, index, {
        vessel: firstNonEmpty(record.vessel_name, record.name, record.ship_name, "선명 확인 필요"),
        port: firstNonEmpty(record.port_name, record.port, record.destination_port, record.destination) || null,
        agent: firstNonEmpty(record.agent_name, record.agent, record.satmntEntrpsNm, record.entrpsCdNm),
        confidence: firstFiniteNumber(record.agent_confidence, record.operator_confidence, record.contact_readiness_score, record.data_confidence_score, record.confidence_score, 0),
        contact_readiness_score: firstFiniteNumber(record.contact_readiness_score, record.sales_accessibility_score, 0),
        data_sources: displaySources(record)
      })
    }));
  return intelligenceEnvelope({
    generatedAt,
    dataMode,
    sourceTable: "agent_master,agent_operator_links,vessel_snapshots",
    items,
    summary: {
      agent_known_count: records.filter(record => firstNonEmpty(record.agent_name, record.agent, record.satmntEntrpsNm, record.entrpsCdNm)).length,
      source_hint: "agent_name / satmntEntrpsNm / contact_readiness_score"
    }
  });
}

function agentDisplayName(record = {}) {
  return firstNonEmpty(record.local_agent, record.agent_name, record.agent, record.satmntEntrpsNm, record.entrpsCdNm, "미확인 에이전트");
}

function buildAgentChannelIntelligenceSummary({ records = [], generatedAt, dataMode } = {}) {
  const byAgent = new Map();
  for (const record of records) {
    const agentName = agentDisplayName(record);
    const current = byAgent.get(agentName) || {
      agent_name: agentName,
      vessel_count: 0,
      hot_count: 0,
      warm_count: 0,
      target_count: 0,
      ports: new Set(),
      operators: new Set(),
      score_total: 0,
      missing_contact_count: 0,
      top_record: null
    };
    const score = salesPriorityScore(record);
    const priority = salesPriorityBand(score);
    current.vessel_count += 1;
    current.hot_count += priority === "HOT" ? 1 : 0;
    current.warm_count += priority === "WARM" ? 1 : 0;
    current.target_count += score >= 50 || isSalesCandidate(record) ? 1 : 0;
    current.score_total += score;
    current.ports.add(recordPortName(record));
    current.operators.add(operatorFleetName(record));
    if (missingContactFields(record).length) current.missing_contact_count += 1;
    if (!current.top_record || score > salesPriorityScore(current.top_record)) current.top_record = record;
    byAgent.set(agentName, current);
  }
  const items = [...byAgent.values()]
    .map(row => ({
      agent_name: row.agent_name,
      vessel_count: row.vessel_count,
      hot_count: row.hot_count,
      warm_count: row.warm_count,
      target_count: row.target_count,
      ports_served: [...row.ports].filter(Boolean).slice(0, 8),
      operators_served: [...row.operators].filter(Boolean).slice(0, 8),
      average_opportunity_score: row.vessel_count ? Math.round(row.score_total / row.vessel_count) : 0,
      missing_contact_count: row.missing_contact_count,
      opportunity_score: Math.min(100, Math.round((row.vessel_count ? row.score_total / row.vessel_count : 0) * 0.55 + row.hot_count * 8 + row.target_count * 2)),
      reason_summary: `${row.agent_name}: 후보 ${row.target_count}척, HOT ${row.hot_count}척, 담당 항만 ${row.ports.size}곳`,
      recommended_action: row.agent_name === "미확인 에이전트"
        ? "대리점 미확인 선박은 연락처 확인 큐에서 우선 확인"
        : "해당 대리점 기준으로 HOT/WARM 선박과 항만별 작업 가능 시간을 묶어 확인",
      vessel_display: row.top_record ? vesselDisplay(row.top_record) : undefined
    }))
    .sort((a, b) => Number(b.opportunity_score || 0) - Number(a.opportunity_score || 0) || Number(b.hot_count || 0) - Number(a.hot_count || 0))
    .slice(0, 20)
    .map((item, index) => ({ ...item, rank: index + 1 }));
  return intelligenceEnvelope({
    generatedAt,
    dataMode,
    sourceTable: "agent,local_agent,operator_contact_history,commercial_leads,agent-followup-queue,verification-queue,sales/actions",
    items
  });
}

function buildAgentRelationshipIntelligenceSummary({ records = [], generatedAt, dataMode } = {}) {
  const relationshipByAgent = new Map(
    buildRelationshipRows(records, "AGENT").map(row => [row.entity_name, row])
  );
  const byAgent = new Map();
  for (const record of records) {
    const agentName = agentDisplayName(record);
    const current = byAgent.get(agentName) || {
      agent_name: agentName,
      vesselKeys: new Set(),
      hot_count: 0,
      warm_count: 0,
      target_count: 0,
      repeat_interactions: 0,
      score_total: 0,
      ports: new Map(),
      operators: new Set(),
      top_record: null
    };
    const score = salesPriorityScore(record);
    const priority = salesPriorityBand(score);
    const contact = contactHistoryCounts(record);
    const repeatSignal = repeatCallerVisitCount(record, 365) >= 2 || Number(record.repeat_caller_score || 0) > 0 ? 1 : 0;
    current.vesselKeys.add(opportunityMemoryIdentityKey(record));
    current.hot_count += priority === "HOT" || score >= 75 ? 1 : 0;
    current.warm_count += priority === "WARM" || (score >= 50 && score < 75) ? 1 : 0;
    current.target_count += score >= 50 || isSalesCandidate(record) ? 1 : 0;
    current.repeat_interactions += Math.max(
      repeatSignal,
      contact.previous_contacts,
      contact.previous_quotes,
      contact.previous_wins,
      privateActivityCount(record, "contact_attempt"),
      privateActivityCount(record, "quote_sent"),
      privateActivityCount(record, "won")
    );
    current.score_total += score;
    current.ports.set(recordPortName(record), (current.ports.get(recordPortName(record)) || 0) + 1);
    current.operators.add(operatorFleetName(record));
    if (!current.top_record || score > salesPriorityScore(current.top_record)) current.top_record = record;
    byAgent.set(agentName, current);
  }
  const items = [...byAgent.values()]
    .map(row => {
      const vesselCount = row.vesselKeys.size;
      const averageOpportunity = vesselCount ? Math.round(row.score_total / vesselCount) : 0;
      const relationship = relationshipByAgent.get(row.agent_name);
      const opportunityValue = Math.round(row.hot_count * 28000 + row.warm_count * 16000 + Math.max(0, row.target_count - row.hot_count - row.warm_count) * 9000);
      const relationshipScore = Math.min(100, Math.round(
        firstFiniteNumber(relationship?.relationship_score, 0) * 0.45 +
        averageOpportunity * 0.25 +
        Math.min(100, row.repeat_interactions * 12) * 0.18 +
        Math.min(100, vesselCount * 8 + row.hot_count * 10) * 0.12
      ));
      const portsServed = [...row.ports.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([port_name, count]) => ({ port_name, count }));
      return withVesselDisplay({
        agent_name: row.agent_name,
        relationship_score: relationshipScore,
        vessel_count: vesselCount,
        hot_count: row.hot_count,
        warm_count: row.warm_count,
        target_count: row.target_count,
        repeat_interactions: row.repeat_interactions,
        opportunity_value: opportunityValue,
        opportunity_value_currency: "USD",
        average_opportunity_score: averageOpportunity,
        ports_served: portsServed,
        operators_served: [...row.operators].filter(Boolean).slice(0, 6),
        opportunity_score: Math.max(relationshipScore, averageOpportunity),
        vessel_display: row.top_record ? vesselDisplay(row.top_record) : undefined,
        reason_summary: `${row.agent_name}: 관련 선박 ${vesselCount}척, HOT ${row.hot_count}척, 반복/접촉 신호 ${row.repeat_interactions}건`,
        recommended_action: row.agent_name === "미확인 에이전트"
          ? "미확인 에이전트 선박은 연락처 확인 큐에서 담당 대리점부터 확인"
          : row.hot_count > 0
            ? "HOT 후보와 예상 기회 금액을 묶어 대리점 접점 우선순위를 확인"
            : row.repeat_interactions > 0
              ? "반복 접점 이력을 바탕으로 다음 입항/체류 선박 후속 연락"
              : "담당 항만과 운영사별 후보를 묶어 최초 접점 가능성을 확인",
        data_sources: ["agent-intelligence", "operator_contact_history", "commercial_leads", "relationship-intelligence"]
      });
    })
    .filter(item => Number(item.relationship_score || 0) > 0 || Number(item.vessel_count || 0) > 0)
    .sort((a, b) =>
      Number(b.relationship_score || 0) - Number(a.relationship_score || 0) ||
      Number(b.hot_count || 0) - Number(a.hot_count || 0) ||
      Number(b.opportunity_value || 0) - Number(a.opportunity_value || 0)
    )
    .slice(0, 20)
    .map((item, index) => ({ ...item, rank: index + 1 }));
  return intelligenceEnvelope({
    generatedAt,
    dataMode,
    sourceTable: "agent-intelligence,operator_contact_history,commercial_leads,relationship-intelligence",
    items,
    summary: {
      agent_relationship_count: items.length,
      opportunity_value_currency: "USD",
      source_hint: "agent-intelligence + relationship-intelligence + commercial contact signals"
    }
  });
}

function buildAgentFollowupPriority({ records = [], generatedAt, dataMode, report = {} } = {}) {
  const items = sortCommercialPriority(records)
    .filter(record => salesPriorityScore(record) >= 50 || isSalesCandidate(record) || missingContactFields(record).includes("local_agent"))
    .map((record, index) => {
      const agentName = agentDisplayName(record);
      const score = salesPriorityScore(record);
      const missing = missingContactFields(record);
      return withVesselDisplay({
        rank: index + 1,
        agent_name: agentName,
        vessel_name: firstNonEmpty(record.vessel_name, record.name, "선명 확인 필요"),
        vessel_display: vesselDisplay(record),
        priority_label: salesPriorityBand(score),
        opportunity_score: score,
        reason_summary: agentName === "미확인 에이전트"
          ? `대리점 미확인: ${missing.join(", ") || "local_agent"} 확인 필요`
          : `${agentName} 경유 가능 후보: ${compactReasonSummary(record)}`,
        recommended_message_angle: regulatedRouteSignal(record)
          ? "Compliance / 출항 전 작업 가능성 확인"
          : Number(record.stay_hours || record.anchorage_hours || 0) >= 72
            ? "장기 체류와 작업 가능 시간 확인"
            : "입항/체류 중 선저 관리 수요 확인",
        confidence_score: firstFiniteNumber(record.contact_readiness_score, record.data_confidence_score, record.confidence_score, 0) || 0
      });
    })
    .slice(0, 50);
  return publicItemsEnvelope({
    generatedAt,
    dataMode,
    report,
    sourceTable: "agent-followup-queue,verification-queue,sales/actions",
    items,
    extra: items.length ? {} : { status: "empty", reason: "에이전트 후속 우선순위 대상이 없습니다." }
  });
}

function buildRepeatCallerIntelligenceSummary({ records = [], generatedAt, dataMode } = {}) {
  const items = sortCommercialPriority(records)
    .filter(record => repeatCallerVisitCount(record, 90) >= 2 || repeatCallerVisitCount(record, 365) > 1 || Number(record.repeat_caller_score || 0) > 0)
    .sort((a, b) => repeatCallerPriorityScore(b) - repeatCallerPriorityScore(a) || String(firstNonEmpty(a.vessel_name, a.name, "")).localeCompare(String(firstNonEmpty(b.vessel_name, b.name, "")), "ko"))
    .map((record, index) => {
      const visitCount30d = repeatCallerVisitCount(record, 30);
      const visitCount90d = repeatCallerVisitCount(record, 90);
      const visitCount365d = repeatCallerVisitCount(record, 365);
      const ports = repeatCallerPorts(record);
      return compactVesselInsight(record, index, {
        vessel: firstNonEmpty(record.vessel_name, record.name, record.ship_name, "선명 확인 필요"),
        visit_count_30d: visitCount30d,
        visit_count_90d: visitCount90d,
        visit_count_365d: visitCount365d,
        visits_last_12_months: visitCount365d,
        ports_visited: ports,
        average_stay_days: repeatCallerAverageStayDays(record),
        last_visit: firstNonEmpty(record.last_visit, record.last_seen_at, record.updated_at, record.collected_at, record.generated_at) || "-",
        next_eta: firstNonEmpty(record.next_eta, record.eta, record.etb, record.predicted_arrival_time, record.arrival_time) || "-",
        operator: firstNonEmpty(record.operator_name, record.operator, record.operator_normalized, record.company, record.shipping_company) || "-",
        opportunity_score: firstFiniteNumber(record.opportunity_score, record.commercial_value_score, record.total_sales_priority_score, record.cleaning_candidate_score, record.repeat_caller_score, 0),
        repeat_caller_score: firstFiniteNumber(record.repeat_caller_score, repeatCallerPriorityScore(record), 0),
        reason_summary: repeatCallerReasonSummary(record),
        recommended_action: repeatCallerRecommendedAction(record),
        data_sources: displaySources(record).length ? displaySources(record) : ["vessel_snapshots", "port_call_master", "route_snapshot_daily"]
      });
    });
  return intelligenceEnvelope({
    generatedAt,
    dataMode,
    sourceTable: "vessel_visits,port_call_master,vessel_snapshot_daily,route_snapshot_daily",
    items,
    summary: {
      repeat_caller_count: items.length,
      repeat_90d_2plus_count: items.filter(item => Number(item.visit_count_90d || 0) >= 2).length,
      source_hint: "calls_last_3m / calls_last_12m / repeat_call_count / repeat_caller_score"
    }
  });
}

function operatorFleetName(record = {}) {
  return firstNonEmpty(record.operator_name, record.operator, record.operator_normalized, record.company, record.shipping_company, record.manager_name, record.manager, "미확인 운영사");
}

function fleetDnaTags(row = {}) {
  const tags = [];
  if (Number(row.hot_count || 0) >= 2) tags.push("HOT 후보 집중");
  if (Number(row.warm_count || 0) >= 3) tags.push("WARM 후보 풀");
  if (Number(row.repeat_caller_count || 0) >= 2) tags.push("반복입항형");
  if (Number(row.compliance_exposure_count || 0) > 0) tags.push("Compliance 노출형");
  if (Number(row.high_risk_count || 0) > 0) tags.push("고위험 선박 포함");
  if (Number(row.congestion_exposure || 0) >= 50 || Number(row.staying_count || 0) > 0) tags.push("장기체류형");
  if ((row.top_ports || []).length >= 3) tags.push("다항만 활동");
  if ((row.common_vessel_types || []).some(type => /bulk|tanker|container|lng|lpg|carrier/i.test(String(type)))) tags.push("대형선 중심");
  if (Number(row.average_opportunity_score || 0) >= 60) tags.push("고기회 선대");
  if (row.operator_name === "미확인 운영사" || Number(row.missing_contact_count || 0) > 0) tags.push("에이전트 확인 필요");
  return tags.length ? [...new Set(tags)].slice(0, 6) : ["관계 형성 후보"];
}

function buildFleetDnaObject(row = {}) {
  const tags = fleetDnaTags(row);
  return {
    preferred_ports: (row.top_ports || []).slice(0, 5),
    average_stay_days: row.average_stay_days || 0,
    repeat_visit_frequency: row.repeat_visit_frequency || 0,
    common_vessel_types: row.common_vessel_types || [],
    compliance_exposure_tags: row.compliance_exposure_tags || [],
    relationship_status: row.relationship_status || (row.operator_name === "미확인 운영사" ? "contact_verification_needed" : row.repeat_caller_count > 0 ? "repeat_relationship_signal" : "new_or_light_relationship"),
    commercial_tendency: tags
  };
}

function buildFleetIntelligenceSummary({ records = [], fleetOpportunities = [], generatedAt, dataMode } = {}) {
  const revenueEstimate = row => {
    const hot = Number(row.hot_count || 0);
    const warm = Number(row.warm_count || 0);
    const compliance = Number(row.compliance_exposure_count || 0);
    const repeat = Number(row.repeat_caller_count || 0);
    return {
      currency: "USD",
      estimated_revenue_low: hot * 9000 + warm * 5000 + compliance * 3000 + repeat * 1500,
      estimated_revenue_high: hot * 28000 + warm * 16000 + compliance * 9000 + repeat * 4500,
      basis: "HOT/WARM targets, compliance exposure, repeat caller signals"
    };
  };
  const byOperator = new Map();
  for (const record of records) {
    const operator = operatorFleetName(record);
    const current = byOperator.get(operator) || {
      operator,
      vessel_count: 0,
      hot_count: 0,
      warm_count: 0,
      repeat_caller_count: 0,
      compliance_exposure_count: 0,
      staying_count: 0,
      arrival_count: 0,
      high_risk_count: 0,
      ports: new Map(),
      vessel_types: new Map(),
      top_vessels: [],
      compliance_tags: new Set(),
      stay_days_total: 0,
      repeat_frequency_total: 0,
      missing_contact_count: 0,
      score_total: 0,
      risk_total: 0,
      congestion_total: 0
    };
    const score = salesPriorityScore(record);
    const risk = recordRiskScore(record);
    const stayDays = dwellDays(record);
    const repeatFrequency = repeatCallerVisitCount(record, 90) || repeatCallerVisitCount(record, 365);
    current.vessel_count += 1;
    current.score_total += score;
    current.risk_total += risk;
    current.stay_days_total += stayDays;
    current.repeat_frequency_total += repeatFrequency;
    if (String(firstNonEmpty(record.priority_label, record.sales_priority_band, record.candidate_band)).toUpperCase() === "HOT" || score >= 75) current.hot_count += 1;
    if (String(firstNonEmpty(record.priority_label, record.sales_priority_band, record.candidate_band)).toUpperCase() === "WARM" || (score >= 50 && score < 75)) current.warm_count += 1;
    if (repeatCallerVisitCount(record, 365) >= 2 || Number(record.repeat_caller_score || 0) > 0) current.repeat_caller_count += 1;
    const compliance = complianceCountry(record);
    if (regulatedRouteSignal(record) || compliance || record.compliance_watch) {
      current.compliance_exposure_count += 1;
      current.compliance_tags.add(compliance || "compliance_route_signal");
    }
    if (risk >= 70) current.high_risk_count += 1;
    if (Number(record.stay_hours || record.current_call_stay_hours || record.cumulative_stay_hours || record.anchorage_hours || 0) >= 72 || record.is_staying_without_departure) current.staying_count += 1;
    if (record.predicted_arrival_pipeline || record.eta || record.etb || record.arrival_time || String(record.status_bucket || "").includes("arriving")) current.arrival_count += 1;
    current.congestion_total += Number(firstFiniteNumber(record.congestion_score, record.port_congestion_score, record.congestion_exposure_score, 0) || 0);
    const port = recordPortName(record);
    current.ports.set(port, (current.ports.get(port) || 0) + 1);
    const vesselType = firstNonEmpty(record.vessel_type_group, record.vessel_type, record.ship_type, "미확인 선종");
    current.vessel_types.set(vesselType, (current.vessel_types.get(vesselType) || 0) + 1);
    if (missingContactFields(record).includes("local_agent") || missingContactFields(record).includes("operator")) current.missing_contact_count += 1;
    current.top_vessels.push({ record, score, risk });
    byOperator.set(operator, current);
  }
  for (const row of fleetOpportunities) {
    const operator = operatorFleetName(row);
    const current = byOperator.get(operator) || { operator, vessel_count: 0, hot_count: 0, warm_count: 0, repeat_caller_count: 0, compliance_exposure_count: 0, staying_count: 0, arrival_count: 0, high_risk_count: 0, ports: new Map(), vessel_types: new Map(), top_vessels: [], compliance_tags: new Set(), stay_days_total: 0, repeat_frequency_total: 0, missing_contact_count: 0, score_total: 0, risk_total: 0, congestion_total: 0 };
    current.vessel_count = Math.max(current.vessel_count, Number(row.current_vessel_count || row.operator_vessel_count || row.vessel_count || 0));
    current.hot_count = Math.max(current.hot_count, Number(row.immediate_target_count || row.hot_count || 0));
    current.warm_count = Math.max(current.warm_count, Number(row.warm_count || row.target_vessel_count || 0) - current.hot_count);
    current.repeat_caller_count = Math.max(current.repeat_caller_count, Number(row.repeat_caller_count || row.repeated_vessels || 0));
    current.compliance_exposure_count = Math.max(current.compliance_exposure_count, Number(row.compliance_exposure_count || row.route_concentration_count || 0));
    current.opportunity_score = firstFiniteNumber(row.fleet_opportunity_score, row.average_commercial_value, current.opportunity_score, 0);
    current.reason_summary = compactReasonSummary(row);
    current.recommended_action = compactRecommendedAction(row);
    if (Array.isArray(row.top_ports)) {
      for (const port of row.top_ports) {
        const name = port.port_name || port.port || port.name;
        if (name) current.ports.set(name, Math.max(Number(port.count || 0), current.ports.get(name) || 0));
      }
    }
    byOperator.set(operator, current);
  }
  const items = [...byOperator.values()]
    .map(row => {
      const topPorts = [...(row.ports || new Map()).entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([port_name, count]) => ({ port_name, count }));
      const averageOpportunity = firstFiniteNumber(row.opportunity_score, row.vessel_count ? Math.round(row.score_total / row.vessel_count) : 0, 0);
      const koreaPresenceScore = Math.min(100, Math.round(row.vessel_count * 8 + row.repeat_caller_count * 12 + topPorts.length * 5));
      const commonVesselTypes = [...(row.vessel_types || new Map()).entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([vessel_type, count]) => ({ vessel_type, count }));
      const topVessels = (row.top_vessels || [])
        .sort((a, b) => Number(b.score || 0) - Number(a.score || 0) || Number(b.risk || 0) - Number(a.risk || 0))
        .slice(0, 5)
        .map(({ record, score, risk }) => ({
          vessel_name: firstNonEmpty(record.vessel_name, record.name, "선명 확인 필요"),
          imo: firstNonEmpty(record.imo, record.imo_no) || null,
          mmsi: firstNonEmpty(record.mmsi) || null,
          port: recordPortName(record),
          opportunity_score: score,
          risk_score: risk,
          priority_label: salesPriorityBand(score)
        }));
      const enriched = {
        operator: row.operator,
        operator_name: row.operator || "미확인 운영사",
        fleet_size_korea: row.vessel_count,
        vessel_count: row.vessel_count,
        hot_count: row.hot_count,
        warm_count: row.warm_count,
        repeat_caller_count: row.repeat_caller_count,
        compliance_exposure_count: row.compliance_exposure_count,
        high_risk_count: row.high_risk_count,
        staying_count: row.staying_count,
        arrival_count: row.arrival_count,
        average_opportunity_score: averageOpportunity,
        korea_presence_score: koreaPresenceScore,
        average_stay_days: row.vessel_count ? Math.round((row.stay_days_total / row.vessel_count) * 10) / 10 : 0,
        repeat_visit_frequency: row.vessel_count ? Math.round((row.repeat_frequency_total / row.vessel_count) * 10) / 10 : 0,
        common_vessel_types: commonVesselTypes,
        compliance_exposure_tags: [...row.compliance_tags].filter(Boolean).slice(0, 6),
        congestion_exposure: row.vessel_count ? Math.round(row.congestion_total / row.vessel_count) : 0,
        missing_contact_count: row.missing_contact_count,
        top_ports: topPorts,
        top_vessels: topVessels,
        opportunity_score: Math.min(100, Math.round(Number(averageOpportunity || 0) * 0.5 + koreaPresenceScore * 0.3 + row.hot_count * 4 + row.compliance_exposure_count * 2))
      };
      const estimatedRevenue = revenueEstimate(enriched);
      const dna = buildFleetDnaObject(enriched);
      const dnaTags = fleetDnaTags({ ...enriched, fleet_dna: dna });
      return {
        ...enriched,
        estimated_revenue: estimatedRevenue,
        estimated_revenue_low: estimatedRevenue.estimated_revenue_low,
        estimated_revenue_high: estimatedRevenue.estimated_revenue_high,
        fleet_dna: dna,
        fleet_profile: dnaTags.join(", "),
        commercial_tendency: dnaTags[0] || "관계 형성 후보",
        top_factors: dnaTags,
        recommended_sales_angle: row.hot_count
          ? "HOT 후보를 중심으로 선대 단위 제안"
          : row.compliance_exposure_count
            ? "Compliance 노출 선박을 묶어 사전 점검 제안"
            : row.repeat_caller_count
              ? "반복 입항 이력을 근거로 관계 구축"
              : "한국 항만 활동 선박을 기준으로 담당 창구 확인",
        reason_summary: row.reason_summary || `${row.operator} 관련 ${row.vessel_count}척, HOT ${row.hot_count}척, 반복입항 ${row.repeat_caller_count}척, Compliance ${row.compliance_exposure_count}척`,
        recommended_action: row.recommended_action || "운영사 단위로 후보 선박, 주요 항만, 연락 경로를 함께 확인하세요."
      };
    })
    .sort((a, b) => Number(b.opportunity_score || 0) - Number(a.opportunity_score || 0) || Number(b.hot_count || 0) - Number(a.hot_count || 0) || Number(b.vessel_count || 0) - Number(a.vessel_count || 0))
    .slice(0, 20)
    .map((item, index) => ({ ...item, rank: index + 1 }));
  return intelligenceEnvelope({
    generatedAt,
    dataMode,
    sourceTable: "operator_snapshot_daily,fleet-memory,operator-opportunities,vessel_visits,repeat-callers,commercial_opportunity_daily",
    items,
    summary: {
      operator_count: items.length,
      source_hint: "operator_snapshot_daily / fleet-memory / operator-opportunities / repeat-callers"
    }
  });
}

function buildRouteIntelligenceSummary({ records = [], generatedAt, dataMode } = {}) {
  const routes = new Map();
  for (const record of records) {
    const from = firstNonEmpty(record.previous_port, record.departure_port, record.last_port, record.origin_port);
    const to = firstNonEmpty(record.destination_port, record.destination, record.next_port, record.port_name, record.port);
    if (!from && !to) continue;
    const key = `${from || "미확인 출발지"} -> ${to || "미확인 목적지"}`;
    const route = routes.get(key) || {
      route_name: key,
      previous_port: from || null,
      destination_port: to || null,
      vessel_count: 0,
      opportunity_total: 0,
      risk_total: 0,
      top_vessel: null
    };
    route.vessel_count += 1;
    route.opportunity_total += salesPriorityScore(record);
    route.risk_total += firstFiniteNumber(record.biofouling_exposure_score, record.biofouling_score, record.risk_score) || 0;
    if (!route.top_vessel || salesPriorityScore(record) > salesPriorityScore(route.top_vessel)) route.top_vessel = record;
    routes.set(key, route);
  }
  const items = [...routes.values()]
    .map(route => ({
      ...route,
      avg_opportunity_score: route.vessel_count ? Math.round(route.opportunity_total / route.vessel_count) : 0,
      avg_risk_score: route.vessel_count ? Math.round(route.risk_total / route.vessel_count) : 0
    }))
    .sort((a, b) => Number(b.avg_opportunity_score || 0) - Number(a.avg_opportunity_score || 0) || Number(b.vessel_count || 0) - Number(a.vessel_count || 0))
    .slice(0, 10)
    .map((route, index) => ({
      rank: index + 1,
      route_name: route.route_name,
      previous_port: route.previous_port,
      destination_port: route.destination_port,
      vessel_count: route.vessel_count,
      opportunity_score: route.avg_opportunity_score,
      risk_score: route.avg_risk_score,
      reason_summary: route.top_vessel ? compactReasonSummary(route.top_vessel) : "항로별 후보 분포를 확인하세요.",
      top_factors: route.top_vessel ? compactInsightFactors(route.top_vessel) : [],
      recommended_action: route.top_vessel ? compactRecommendedAction(route.top_vessel) : "항로별 반복 입항 여부를 확인하세요."
    }));
  return intelligenceEnvelope({
    generatedAt,
    dataMode,
    sourceTable: "route_snapshot_daily",
    items,
    summary: {
      route_count: routes.size,
      source_hint: "previous_port / destination_port fields"
    }
  });
}

function buildCommercialIntelligenceSummary({ topCandidates = {}, commercialCommandCenter = {}, candidateList = [], generatedAt, dataMode } = {}) {
  const source = dedupeCandidateRows([
    ...(topCandidates.opportunities || []),
    ...(commercialCommandCenter.immediate_targets || []),
    ...(commercialCommandCenter.high_value_targets || []),
    ...candidateList
  ]);
  const items = sortCommercialPriority(source)
    .slice(0, 10)
    .map((record, index) => compactVesselInsight(record, index, {
      opportunity_score: salesPriorityScore(record),
      priority_label: record.priority_label || record.sales_priority_band || salesPriorityBand(salesPriorityScore(record)),
      opportunity_status: firstNonEmpty(record.opportunity_status, record.opportunity_state, record.candidate_band) || null
    }));
  return intelligenceEnvelope({
    generatedAt,
    dataMode,
    sourceTable: "opportunity_master,commercial_opportunity_daily",
    items,
    summary: {
      hot_count: Number(commercialCommandCenter.hot_count || items.filter(item => item.priority_label === "HOT").length || 0),
      source_hint: "opportunity_master / candidates/top"
    }
  });
}

function salesPriorityIdentityKey(record = {}) {
  const imo = firstNonEmpty(record.imo, record.imo_no);
  const mmsi = firstNonEmpty(record.mmsi);
  if (imo) return `IMO|${imo}`;
  if (mmsi) return `MMSI|${mmsi}`;
  const name = normalizeVesselName(firstNonEmpty(record.vessel_name, record.name, record.ship_name));
  const vesselType = normalizeIdentityToken(firstNonEmpty(record.vessel_type_group, record.vessel_type, record.ship_type));
  if (name) return `NAME|${name}|${vesselType}`;
  return `VESSEL|${firstNonEmpty(record.master_vessel_id, record.hybrid_entity_key, record.vessel_id)}`;
}

function salesPriorityDataSources(record = {}) {
  const sources = new Set();
  if (salesPriorityScore(record) > 0 || firstNonEmpty(record.opportunity_id, record.opportunity_status, record.opportunity_state)) sources.add("opportunity_master");
  if (firstFiniteNumber(record.risk_score, record.biofouling_exposure_score, record.biofouling_risk_score, record.operational_risk_score)) sources.add("risk_history");
  if (compactReasonSummary(record) || compactInsightFactors(record).length) {
    sources.add("explainability_snapshots");
    sources.add("rule_evaluations");
  }
  if (firstNonEmpty(record.commercial_opportunity_id, record.lead_status, record.why_now) || salesPriorityScore(record) > 0) sources.add("commercial_opportunity_daily");
  if (firstNonEmpty(record.previous_port, record.departure_port, record.destination_port, record.destination, record.next_port)) sources.add("route_snapshot_daily");
  if (firstNonEmpty(record.operator_name, record.operator, record.operator_normalized)) sources.add("operator_snapshot_daily");
  return [...sources];
}

function buildSalesPriorityIntelligenceSummary({
  records = [],
  candidateList = [],
  salesCandidates = [],
  immediateTargets = [],
  topCandidates = {},
  commercialCommandCenter = {},
  generatedAt,
  dataMode
} = {}) {
  const source = [
    ...(topCandidates.opportunities || []),
    ...(commercialCommandCenter.immediate_targets || []),
    ...(commercialCommandCenter.high_value_targets || []),
    ...candidateList,
    ...immediateTargets,
    ...salesCandidates,
    ...records
  ];
  const byIdentity = new Map();
  for (const record of source) {
    const opportunityScore = firstFiniteNumber(
      record.opportunity_score,
      record.sales_score,
      record.commercial_value_score,
      record.total_sales_priority_score,
      record.cleaning_candidate_score,
      record.predicted_cleaning_opportunity_score
    );
    const riskScore = firstFiniteNumber(
      record.risk_score,
      record.biofouling_exposure_score,
      record.biofouling_risk_score,
      record.biofouling_score,
      record.operational_risk_score,
      record.congestion_score
    );
    if (!Number.isFinite(Number(opportunityScore)) && !Number.isFinite(Number(riskScore))) continue;
    const identity = salesPriorityIdentityKey(record);
    if (!identity || identity === "VESSEL||") continue;
    const reasonSummary = compactReasonSummary(record);
    const topFactors = compactInsightFactors(record);
    const item = {
      rank: 0,
      master_vessel_id: firstNonEmpty(record.master_vessel_id, record.hybrid_entity_key, record.vessel_id) || null,
      source_id: firstNonEmpty(record.opportunity_id, record.port_call_id, record.snapshot_id, record.master_vessel_id, record.hybrid_entity_key) || null,
      vessel_name: firstNonEmpty(record.vessel_name, record.name, record.ship_name, "선명 확인 필요"),
      imo: firstNonEmpty(record.imo, record.imo_no) || null,
      mmsi: firstNonEmpty(record.mmsi) || null,
      port: firstNonEmpty(record.port_name, record.port, record.destination_port, record.destination) || null,
      opportunity_score: Number.isFinite(Number(opportunityScore)) ? Number(opportunityScore) : null,
      risk_score: Number.isFinite(Number(riskScore)) ? Number(riskScore) : null,
      confidence_score: firstFiniteNumber(record.data_confidence_score, record.source_confidence_score, record.confidence, record.confidence_score) ?? null,
      reason_summary: reasonSummary || (topFactors.length ? topFactors.join(", ") : "점수 근거가 있는 기존 인텔리전스 항목입니다."),
      recommended_action: compactRecommendedAction(record),
      data_sources: salesPriorityDataSources(record),
      last_seen_at: firstNonEmpty(record.last_seen_at, record.last_seen, record.updated_at, record.collected_at, record.generated_at) || generatedAt || null,
      top_factors: topFactors.slice(0, 4)
    };
    if (!item.reason_summary) item.reason_summary = "추천 사유 확인 필요";
    if (!item.recommended_action) item.recommended_action = "선사 또는 대리점 연락 가능 여부를 확인하세요.";
    if (!item.data_sources.length) item.data_sources = ["opportunity_master"];
    const existing = byIdentity.get(identity);
    const itemSortScore = Number(item.opportunity_score ?? item.risk_score ?? 0);
    const existingSortScore = Number(existing?.opportunity_score ?? existing?.risk_score ?? 0);
    if (!existing || itemSortScore > existingSortScore || (itemSortScore === existingSortScore && Number(item.confidence_score || 0) > Number(existing.confidence_score || 0))) {
      byIdentity.set(identity, item);
    }
  }
  const items = [...byIdentity.values()]
    .sort((a, b) =>
      Number(b.opportunity_score ?? b.risk_score ?? 0) - Number(a.opportunity_score ?? a.risk_score ?? 0) ||
      Number(b.risk_score ?? 0) - Number(a.risk_score ?? 0) ||
      String(a.vessel_name || "").localeCompare(String(b.vessel_name || ""), "ko")
    )
    .slice(0, 10)
    .map((item, index) => ({ ...item, rank: index + 1 }));
  return intelligenceEnvelope({
    generatedAt,
    dataMode,
    sourceTable: "opportunity_master,explainability_snapshots,risk_history,commercial_opportunity_daily,route_snapshot_daily,operator_snapshot_daily",
    items,
    summary: {
      focus_question: "오늘 어떤 선박에 먼저 연락해야 하는가?",
      sort_rule: "opportunity_score desc, fallback risk_score",
      max_items: 10
    }
  });
}

function operatorDisplayName(record = {}) {
  return firstNonEmpty(record.operator_name, record.operator, record.operator_normalized, record.company, record.shipping_company, record.manager_name, record.manager, "운영사 확인 필요");
}

function recordPortName(record = {}) {
  const raw = firstNonEmpty(record.port_name, record.port, record.destination_port, record.destination, record.current_port);
  if (!raw) return "미확인 항만";
  const normalized = normalizePort(raw);
  return normalized.port_name || raw || "미확인 항만";
}

function recordRiskScore(record = {}) {
  return firstFiniteNumber(record.risk_score, record.biofouling_exposure_score, record.biofouling_score, record.biofouling_risk_score, record.operational_risk_score, record.idle_risk_score, 0) || 0;
}

function operationalBiofoulingRiskScore(record = {}) {
  return Math.max(recordRiskScore(record), Number(record.biofouling_exposure_score || 0), Number(record.biofouling_score || 0), Number(record.biofouling_risk_score || 0), Number(record.operational_risk_score || 0), Number(record.idle_risk_score || 0));
}

function operationalRiskLevel(score = 0) {
  const value = Number(score || 0);
  if (value >= 70) return "HIGH";
  if (value >= 40) return "MEDIUM";
  return "LOW";
}

function dwellDays(record = {}) {
  const hours = firstFiniteNumber(record.stay_hours, record.current_call_stay_hours, record.cumulative_stay_hours, record.anchorage_hours, 0) || 0;
  return Math.round((Number(hours || 0) / 24) * 10) / 10;
}

function biofoulingFactors(record = {}) {
  const stay = Number(firstFiniteNumber(record.stay_hours, record.current_call_stay_hours, record.cumulative_stay_hours, 0) || 0);
  const anchorage = Number(firstFiniteNumber(record.anchorage_hours, record.waiting_hours, 0) || 0);
  const repeat = repeatCallerVisitCount(record, 365);
  const type = String(firstNonEmpty(record.vessel_type_group, record.vessel_type, record.ship_type, "")).toLowerCase();
  const factors = [];
  if (stay >= 168) factors.push("LONG_PORT_STAY");
  else if (stay >= 72) factors.push("PORT_DWELL_TIME");
  if (anchorage >= 72) factors.push("LONG_ANCHORAGE");
  else if (anchorage >= 24) factors.push("ANCHORAGE_WAIT");
  if (Number(record.idle_risk_score || record.idle_exposure || 0) >= 40) factors.push("REPEATED_INACTIVITY");
  if (/tanker|bulk|cargo|container|lng|lpg|chemical/.test(type)) factors.push("VESSEL_TYPE_EXPOSURE");
  if (repeat >= 2) factors.push("PREVIOUS_VISIT_PATTERN");
  for (const code of compactInsightFactors(record)) {
    if (/LONG|ANCHOR|IDLE|BIO|RISK|REPEAT/i.test(code) && !factors.includes(code)) factors.push(code);
  }
  return factors.slice(0, 8);
}

function buildBiofoulingRiskIntelligenceSummary({ records = [], generatedAt, dataMode } = {}) {
  const items = records
    .map((record, index) => {
      const riskScore = operationalBiofoulingRiskScore(record);
      return compactVesselInsight(record, index, {
        risk_score: riskScore,
        risk_level: operationalRiskLevel(riskScore),
        factors: biofoulingFactors(record),
        reason_summary: biofoulingFactors(record).length ? `${biofoulingFactors(record).join(", ")} 기반 운영 리스크 신호` : compactReasonSummary(record),
        recommended_action: riskScore >= 70 ? "체류/묘박 이력과 선종을 근거로 선저 상태 확인을 우선 제안" : "입항/체류 이력 변화 시점에 맞춰 리스크를 재확인",
        data_sources: displaySources(record).length ? displaySources(record) : ["risk_history", "feature_store", "opportunity_master"]
      });
    })
    .filter(item => Number(item.risk_score || 0) > 0 || item.factors.length)
    .sort((a, b) => Number(b.risk_score || 0) - Number(a.risk_score || 0) || Number(b.opportunity_score || 0) - Number(a.opportunity_score || 0))
    .slice(0, 10)
    .map((item, index) => ({ ...item, rank: index + 1 }));
  return intelligenceEnvelope({
    generatedAt,
    dataMode,
    sourceTable: "risk_history,feature_store,opportunity_master,explainability_snapshots,commercial_opportunity_daily",
    items,
    summary: {
      high_risk_count: items.filter(item => item.risk_level === "HIGH").length,
      disclaimer: "운항 신호 기반 상대 리스크입니다. 과학적 부착량 판정이 아닙니다."
    }
  });
}

const BIOFOULING_MODEL_VERSION = "biofouling_sst_dwell_salinity_v1";
const BIOFOULING_SST_CACHE_FILE = "data/cache/noaa-sst-daily.json";
const BIOFOULING_AIS_UPDATE_INTERVAL_HOURS = 6;
const BIOFOULING_PORT_ENVIRONMENT = [
  { port_code: "020", port_name: "부산", lat: 35.10, lon: 129.04, sst_anomaly: 0.8, salinity_proxy: 0.90 },
  { port_code: "820", port_name: "울산", lat: 35.50, lon: 129.39, sst_anomaly: 0.7, salinity_proxy: 0.91 },
  { port_code: "620-YEOSU", port_name: "여수", lat: 34.74, lon: 127.74, sst_anomaly: 0.9, salinity_proxy: 0.88 },
  { port_code: "620-GWANGYANG", port_name: "광양", lat: 34.90, lon: 127.70, sst_anomaly: 0.9, salinity_proxy: 0.87 },
  { port_code: "030", port_name: "인천", lat: 37.45, lon: 126.60, sst_anomaly: 0.6, salinity_proxy: 0.82 },
  { port_code: "031", port_name: "평택·당진", lat: 36.98, lon: 126.84, sst_anomaly: 0.6, salinity_proxy: 0.81 },
  { port_code: "810", port_name: "포항", lat: 36.03, lon: 129.40, sst_anomaly: 0.7, salinity_proxy: 0.91 },
  { port_code: "622", port_name: "마산/창원", lat: 35.18, lon: 128.57, sst_anomaly: 0.8, salinity_proxy: 0.86 },
  { port_code: "070", port_name: "목포", lat: 34.79, lon: 126.39, sst_anomaly: 0.7, salinity_proxy: 0.83 },
  { port_code: "080", port_name: "군산", lat: 35.98, lon: 126.63, sst_anomaly: 0.6, salinity_proxy: 0.82 },
  { port_code: "621", port_name: "대산", lat: 37.01, lon: 126.35, sst_anomaly: 0.6, salinity_proxy: 0.82 },
  { port_code: "120", port_name: "동해/묵호", lat: 37.49, lon: 129.13, sst_anomaly: 0.6, salinity_proxy: 0.90 },
  { port_code: "940", port_name: "제주", lat: 33.52, lon: 126.54, sst_anomaly: 0.7, salinity_proxy: 0.88 },
  { port_code: "UNKNOWN", port_name: "미확인 항만", lat: 35.50, lon: 128.30, sst_anomaly: 0.7, salinity_proxy: 0.86 }
];
const BIOFOULING_PORT_ENV_BY_CODE = new Map(BIOFOULING_PORT_ENVIRONMENT.map(port => [port.port_code, port]));

function clamp01(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(1, number));
}

function normalizeBiofoulingAnomaly(value) {
  const anomaly = Number(value);
  if (!Number.isFinite(anomaly)) return 0;
  return clamp01(Math.max(0, anomaly) / 4);
}

function normalizeBiofoulingDwellHours(value) {
  const hours = Number(value);
  if (!Number.isFinite(hours)) return 0;
  return clamp01(Math.max(0, hours) / 168);
}

function normalizeSalinityProxy(value) {
  const salinity = Number(value);
  if (!Number.isFinite(salinity)) return 0.86;
  if (salinity > 2) return clamp01(salinity / 35);
  return clamp01(salinity);
}

function biofoulingPortEnvironment(recordOrPort = {}) {
  const normalized = typeof recordOrPort === "string"
    ? normalizePort(recordOrPort)
    : normalizeRecordPort(recordOrPort).port || normalizePort(recordPortName(recordOrPort));
  const byCode = BIOFOULING_PORT_ENV_BY_CODE.get(normalized.port_code || "UNKNOWN");
  if (byCode) return { ...byCode, port_code: normalized.port_code || byCode.port_code, port_name: normalized.port_name || byCode.port_name };
  const name = String(normalized.port_name || recordPortName(recordOrPort) || "").toLowerCase();
  const found = BIOFOULING_PORT_ENVIRONMENT.find(port => String(port.port_name || "").toLowerCase() === name);
  return found ? { ...found, port_code: normalized.port_code || found.port_code, port_name: normalized.port_name || found.port_name } : { ...BIOFOULING_PORT_ENV_BY_CODE.get("UNKNOWN") };
}

function noaaNumber(row = {}, names = []) {
  for (const name of names) {
    const direct = row[name];
    const lower = row[String(name).toLowerCase()];
    const value = direct !== undefined ? direct : lower;
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function noaaText(row = {}, names = []) {
  for (const name of names) {
    const direct = row[name];
    const lower = row[String(name).toLowerCase()];
    const value = direct !== undefined ? direct : lower;
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
  }
  return "";
}

function noaaTableRows(payload = {}) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.items)) return payload.items;
  if (Array.isArray(payload.data)) return payload.data;
  if (payload.table && Array.isArray(payload.table.columnNames) && Array.isArray(payload.table.rows)) {
    return payload.table.rows.map(row => Object.fromEntries(payload.table.columnNames.map((column, index) => [column, row[index]])));
  }
  return [];
}

function portDistanceScore(port = {}, row = {}) {
  const lat = noaaNumber(row, ["lat", "latitude", "y"]);
  const lon = noaaNumber(row, ["lon", "longitude", "x"]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return Infinity;
  return Math.abs(Number(port.lat) - lat) + Math.abs(Number(port.lon) - lon);
}

function normalizeNoaaSstPayload(payload = {}) {
  const byPort = {};
  const rows = noaaTableRows(payload);
  if (payload.ports && typeof payload.ports === "object") {
    for (const [name, row] of Object.entries(payload.ports)) {
      const port = biofoulingPortEnvironment(name);
      byPort[port.port_code] = {
        sst_anomaly: noaaNumber(row, ["sst_anomaly", "anomaly", "sst_anom", "sea_surface_temperature_anomaly"]) ?? port.sst_anomaly,
        salinity_proxy: normalizeSalinityProxy(noaaNumber(row, ["salinity_proxy", "salinity", "sss"]) ?? port.salinity_proxy),
        source_label: "NOAA SST"
      };
    }
  }
  for (const row of rows) {
    const portName = noaaText(row, ["port", "port_name", "station", "name"]);
    const port = portName
      ? biofoulingPortEnvironment(portName)
      : BIOFOULING_PORT_ENVIRONMENT
        .map(candidate => ({ candidate, distance: portDistanceScore(candidate, row) }))
        .sort((a, b) => a.distance - b.distance)[0]?.candidate;
    if (!port || !port.port_code) continue;
    byPort[port.port_code] = {
      sst_anomaly: noaaNumber(row, ["sst_anomaly", "anomaly", "sst_anom", "sea_surface_temperature_anomaly"]) ?? port.sst_anomaly,
      salinity_proxy: normalizeSalinityProxy(noaaNumber(row, ["salinity_proxy", "salinity", "sss"]) ?? port.salinity_proxy),
      source_label: "NOAA SST"
    };
  }
  return byPort;
}

async function fetchNoaaSstPayload(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(process.env.NOAA_SST_TIMEOUT_MS || 8000));
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { accept: "application/json" } });
    if (!response.ok) throw new Error(`NOAA SST request failed: HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function loadDailyNoaaSstContext(generatedAt = new Date().toISOString()) {
  const date = String(generatedAt || new Date().toISOString()).slice(0, 10);
  const sourceUrl = process.env.NOAA_SST_URL || process.env.NOAA_SST_JSON_URL || "";
  const cached = readJsonSafe(BIOFOULING_SST_CACHE_FILE, null);
  if (cached?.cache_date === date && cached?.ports) return cached;
  const base = {
    cache_date: date,
    generated_at: generatedAt,
    source_name: "NOAA SST",
    source_url: sourceUrl || null,
    status: sourceUrl ? "fetch_pending" : "proxy",
    ports: Object.fromEntries(BIOFOULING_PORT_ENVIRONMENT.map(port => [port.port_code, {
      sst_anomaly: port.sst_anomaly,
      salinity_proxy: port.salinity_proxy,
      source_label: sourceUrl ? "NOAA fallback proxy" : "Korea port climate proxy"
    }]))
  };
  if (sourceUrl) {
    try {
      const payload = await fetchNoaaSstPayload(sourceUrl);
      const noaaPorts = normalizeNoaaSstPayload(payload);
      base.ports = { ...base.ports, ...noaaPorts };
      base.status = Object.keys(noaaPorts).length ? "completed" : "proxy";
      base.raw_row_count = noaaTableRows(payload).length;
    } catch (error) {
      base.status = "failed_proxy";
      base.error = error?.message || String(error);
    }
  }
  fs.mkdirSync("data/cache", { recursive: true });
  fs.writeFileSync(BIOFOULING_SST_CACHE_FILE, JSON.stringify(base, null, 2));
  return base;
}

function biofoulingDwellHours(record = {}) {
  return firstFiniteNumber(
    record.ais_dwell_hours,
    record.dwell_hours,
    record.cumulative_stay_hours,
    record.current_call_stay_hours,
    record.stay_hours,
    record.anchorage_hours,
    record.waiting_hours,
    0
  ) || 0;
}

function biofoulingEnvironmentalInput(record = {}, sstContext = {}) {
  const env = biofoulingPortEnvironment(record);
  const noaa = sstContext?.ports?.[env.port_code] || {};
  const sstAnomaly = firstFiniteNumber(record.sst_anomaly, record.noaa_sst_anomaly, noaa.sst_anomaly, env.sst_anomaly, 0) || 0;
  const salinityProxy = normalizeSalinityProxy(firstFiniteNumber(record.salinity_proxy, record.salinity, noaa.salinity_proxy, env.salinity_proxy, 0.86));
  const dwellHours = biofoulingDwellHours(record);
  const normSstAnomaly = normalizeBiofoulingAnomaly(sstAnomaly);
  const normDwellTime = normalizeBiofoulingDwellHours(dwellHours);
  const normSalinity = normalizeSalinityProxy(salinityProxy);
  const risk = clamp01(0.5 * normSstAnomaly + 0.4 * normDwellTime + 0.1 * (1 - normSalinity));
  return {
    port: env,
    sst_anomaly: Math.round(Number(sstAnomaly || 0) * 100) / 100,
    salinity_proxy: Math.round(normSalinity * 1000) / 1000,
    dwell_hours: Math.round(Number(dwellHours || 0) * 10) / 10,
    norm_sst_anomaly: Math.round(normSstAnomaly * 1000) / 1000,
    norm_dwell_time: Math.round(normDwellTime * 1000) / 1000,
    norm_salinity: Math.round(normSalinity * 1000) / 1000,
    formula_risk: risk,
    biofouling_risk_score: Math.round(risk * 100),
    source_label: noaa.source_label || "Korea port climate proxy"
  };
}

function biofoulingRiskLevel(score = 0) {
  const value = Number(score || 0);
  if (value >= 70) return "HIGH";
  if (value >= 40) return "MEDIUM";
  return "LOW";
}

function biofoulingVesselRiskItem(record = {}, index = 0, sstContext = {}) {
  const env = biofoulingEnvironmentalInput(record, sstContext);
  const opportunityScore = salesPriorityScore(record);
  const routeRegions = complianceExposureRegions(record);
  const complianceScore = Math.min(100, Math.round(env.biofouling_risk_score + Math.min(25, routeRegions.length * 15) + (regulatedRouteSignal(record) ? 10 : 0)));
  const hullCleaningCandidateScore = Math.min(100, Math.round(
    env.biofouling_risk_score * 0.55 +
    opportunityScore * 0.30 +
    Number(record.cleaning_window_score || record.window_score || 0) * 0.15
  ));
  const factors = [
    `SST ${env.sst_anomaly}`,
    `Dwell ${Math.round(env.dwell_hours)}h`,
    `Salinity ${env.salinity_proxy}`,
    ...biofoulingFactors(record).slice(0, 4)
  ];
  return compactVesselInsight(record, index, {
    port: env.port.port_name,
    port_code: env.port.port_code,
    current_port: env.port.port_name,
    destination: firstNonEmpty(record.destination, record.destination_port, record.next_port) || null,
    destination_port: firstNonEmpty(record.destination_port, record.destination, record.next_port) || null,
    next_port: firstNonEmpty(record.next_port) || null,
    risk_score: env.biofouling_risk_score,
    biofouling_risk_score: env.biofouling_risk_score,
    risk_level: biofoulingRiskLevel(env.biofouling_risk_score),
    hull_cleaning_candidate_score: hullCleaningCandidateScore,
    compliance_score: complianceScore,
    sst_anomaly: env.sst_anomaly,
    ais_dwell_hours: env.dwell_hours,
    salinity_proxy: env.salinity_proxy,
    norm_sst_anomaly: env.norm_sst_anomaly,
    norm_dwell_time: env.norm_dwell_time,
    norm_salinity: env.norm_salinity,
    model_version: BIOFOULING_MODEL_VERSION,
    formula: "0.5 * norm_sst_anomaly + 0.4 * norm_dwell_time + 0.1 * (1 - norm_salinity)",
    top_factors: factors,
    reason_summary: `SST anomaly ${env.sst_anomaly}, AIS dwell ${Math.round(env.dwell_hours)}h, salinity proxy ${env.salinity_proxy} 기반 상대 biofouling 리스크`,
    recommended_action: env.biofouling_risk_score >= 70 ? "출항 전 선저 상태 확인과 Hull Cleaning 제안을 우선 검토" : "체류 시간이 늘어나면 선저 상태 확인 메시지를 준비",
    data_sources: ["NOAA SST", "AIS dwell time", "salinity proxy", "opportunity_master"],
    sst_source_status: sstContext.status || "proxy"
  });
}

function featureCollection(features = [], properties = {}) {
  return {
    type: "FeatureCollection",
    generated_at: properties.generated_at || new Date().toISOString(),
    properties,
    features
  };
}

function buildBiofoulingModuleOutputs({ records = [], portStatistics = {}, sstContext = {}, generatedAt, dataMode } = {}) {
  const vesselItems = dedupeCandidateRows(records)
    .map((record, index) => biofoulingVesselRiskItem(record, index, sstContext))
    .filter(item => Number(item.biofouling_risk_score || item.risk_score || 0) > 0)
    .sort((a, b) =>
      Number(b.biofouling_risk_score || b.risk_score || 0) - Number(a.biofouling_risk_score || a.risk_score || 0) ||
      Number(b.hull_cleaning_candidate_score || 0) - Number(a.hull_cleaning_candidate_score || 0)
    )
    .map((item, index) => ({ ...item, rank: index + 1 }));
  const byPort = new Map();
  const ensurePort = env => {
    const key = env.port_code || env.port_name || "UNKNOWN";
    if (!byPort.has(key)) {
      byPort.set(key, {
        port_code: env.port_code || "UNKNOWN",
        port_name: env.port_name || "미확인 항만",
        display_name: env.port_name || "미확인 항만",
        lat: env.lat,
        lon: env.lon,
        vessel_count: 0,
        high_risk_count: 0,
        hot_candidate_count: 0,
        risk_total: 0,
        sst_anomaly_total: 0,
        salinity_total: 0,
        environment_seeded: false,
        observed: false,
        source_status: "environment_proxy",
        proxy_sst_anomaly: null,
        proxy_salinity_proxy: null
      });
    }
    return byPort.get(key);
  };
  for (const item of vesselItems) {
    const env = biofoulingPortEnvironment(item);
    const row = ensurePort(env);
    row.observed = true;
    row.source_status = "observed_vessels";
    row.vessel_count += 1;
    row.high_risk_count += Number(item.biofouling_risk_score || 0) >= 70 ? 1 : 0;
    row.hot_candidate_count += Number(item.hull_cleaning_candidate_score || 0) >= 70 ? 1 : 0;
    row.risk_total += Number(item.biofouling_risk_score || 0);
    row.sst_anomaly_total += Number(item.sst_anomaly || 0);
    row.salinity_total += Number(item.salinity_proxy || 0);
  }
  for (const port of (portStatistics.ports || [])) {
    const env = biofoulingPortEnvironment(port);
    const row = ensurePort(env);
    row.vessel_count = Math.max(row.vessel_count, Number(port.vessel_count || 0));
    row.hot_candidate_count = Math.max(row.hot_candidate_count, Number(port.hot_candidate_count || port.hot_count || 0));
    if (row.vessel_count > 0 || row.hot_candidate_count > 0) {
      row.observed = true;
      row.source_status = "port_summary_current";
    }
  }
  for (const env of BIOFOULING_PORT_ENVIRONMENT) {
    if (!env.port_code || env.port_code === "UNKNOWN") continue;
    const row = ensurePort(env);
    const noaa = sstContext?.ports?.[env.port_code] || {};
    row.environment_seeded = true;
    row.proxy_sst_anomaly = firstFiniteNumber(noaa.sst_anomaly, env.sst_anomaly, 0) || 0;
    row.proxy_salinity_proxy = normalizeSalinityProxy(firstFiniteNumber(noaa.salinity_proxy, env.salinity_proxy, 0.86));
  }
  const portItems = [...byPort.values()]
    .map(row => {
      const env = BIOFOULING_PORT_ENV_BY_CODE.get(row.port_code) || biofoulingPortEnvironment(row);
      const noaa = sstContext?.ports?.[row.port_code] || {};
      const proxySst = firstFiniteNumber(noaa.sst_anomaly, row.proxy_sst_anomaly, env.sst_anomaly, 0) || 0;
      const proxySalinity = normalizeSalinityProxy(firstFiniteNumber(noaa.salinity_proxy, row.proxy_salinity_proxy, env.salinity_proxy, 0.86));
      const proxyRisk = Math.round(clamp01(
        0.5 * normalizeBiofoulingAnomaly(proxySst) +
        0.1 * (1 - proxySalinity)
      ) * 100);
      const averageRisk = row.vessel_count ? Math.round(row.risk_total / row.vessel_count) : proxyRisk;
      const averageSst = row.vessel_count ? Math.round((row.sst_anomaly_total / row.vessel_count) * 100) / 100 : Math.round(proxySst * 100) / 100;
      const averageSalinity = row.vessel_count ? Math.round((row.salinity_total / row.vessel_count) * 1000) / 1000 : Math.round(proxySalinity * 1000) / 1000;
      const hotspotScore = row.vessel_count
        ? Math.min(100, Math.round(averageRisk * 0.65 + row.high_risk_count * 7 + row.hot_candidate_count * 4))
        : Math.min(100, Math.round(averageRisk * 0.65));
      const mapStatus = row.observed ? "observed" : "environment_proxy";
      return {
        port_code: row.port_code,
        port_name: row.port_name,
        display_name: row.display_name,
        lat: row.lat,
        lon: row.lon,
        vessel_count: row.vessel_count,
        high_risk_count: row.high_risk_count,
        hot_candidate_count: row.hot_candidate_count,
        average_biofouling_risk_score: averageRisk,
        average_sst_anomaly: averageSst,
        average_salinity_proxy: averageSalinity,
        hotspot_score: hotspotScore,
        risk_level: biofoulingRiskLevel(hotspotScore),
        opportunity_score: hotspotScore,
        map_status: mapStatus,
        source_status: row.source_status,
        data_sources: row.observed ? ["NOAA SST", "AIS dwell time", "port_summary_current"] : ["NOAA SST proxy", "Korea port climate proxy"],
        reason_summary: row.observed
          ? `${row.port_name}: 평균 리스크 ${averageRisk}점, 고위험 ${row.high_risk_count}척, Hull Cleaning 후보 ${row.hot_candidate_count}척`
          : `${row.port_name}: 현재 선박 관측 0척, SST/salinity proxy 기반 기본 리스크 ${averageRisk}점`,
        recommended_action: row.observed && hotspotScore >= 70
          ? "상위 리스크 선박과 항만 대기 시간을 묶어 당일 영업 우선순위를 점검"
          : row.observed
            ? "항만 체류/수온 신호를 모니터링"
            : "해당 항만 관측 데이터가 들어오면 선박별 리스크와 함께 재평가"
      };
    })
    .sort((a, b) => Number(b.hotspot_score || 0) - Number(a.hotspot_score || 0) || Number(b.vessel_count || 0) - Number(a.vessel_count || 0))
    .map((item, index) => ({ ...item, rank: index + 1 }));
  const hotspots = portItems.filter(item => Number(item.hotspot_score || 0) >= 55 || Number(item.high_risk_count || 0) > 0).slice(0, 20);
  const topHullCleaning = vesselItems
    .slice()
    .sort((a, b) => Number(b.hull_cleaning_candidate_score || 0) - Number(a.hull_cleaning_candidate_score || 0) || Number(b.biofouling_risk_score || 0) - Number(a.biofouling_risk_score || 0))
    .slice(0, 10)
    .map((item, index) => ({ ...item, rank: index + 1 }));
  const brazilCompliance = vesselItems
    .filter(item => /brazil|brasil|브라질/i.test(String([
      item.destination_country,
      item.destination,
      item.destination_port,
      item.vessel_display?.destination,
      item.reason_summary,
      item.top_factors
    ].flat().join(" "))) || complianceCountry(item) === "Brazil" || Number(item.compliance_score || 0) >= 65)
    .sort((a, b) => Number(b.compliance_score || 0) - Number(a.compliance_score || 0) || Number(b.biofouling_risk_score || 0) - Number(a.biofouling_risk_score || 0))
    .slice(0, 20)
    .map((item, index) => ({
      ...item,
      rank: index + 1,
      destination_country: "Brazil",
      commercial_compliance_signal: "Commercial compliance signal",
      reason_summary: `${item.reason_summary}; Brazil compliance route/risk watch`,
      recommended_action: "Brazil 항로 가능성과 biofouling documentation 필요 여부를 선제 확인"
    }));
  const portFeatures = portItems.map(item => ({
    type: "Feature",
    geometry: { type: "Point", coordinates: [Number(item.lon || 0), Number(item.lat || 0)] },
    properties: { ...item }
  }));
  const hotspotFeatures = hotspots.map(item => ({
    type: "Feature",
    geometry: { type: "Point", coordinates: [Number(item.lon || 0), Number(item.lat || 0)] },
    properties: { ...item }
  }));
  const commonExtra = {
    summary: {
      model_version: BIOFOULING_MODEL_VERSION,
      formula: "risk = 0.5 * norm_sst_anomaly + 0.4 * norm_dwell_time + 0.1 * (1 - norm_salinity)",
      sst_cache_status: sstContext.status || "proxy",
      sst_cache_date: sstContext.cache_date || null,
      ais_update_interval_hours: BIOFOULING_AIS_UPDATE_INTERVAL_HOURS,
      disclaimer: "Relative operational risk signal. Not a biological measurement or legal finding."
    }
  };
  return {
    summary: {
      model_version: BIOFOULING_MODEL_VERSION,
      sst_cache_status: sstContext.status || "proxy",
      sst_cache_date: sstContext.cache_date || null,
      vessel_risk_count: vesselItems.length,
      hotspot_count: hotspots.length,
      top_hull_cleaning_count: topHullCleaning.length,
      brazil_compliance_count: brazilCompliance.length
    },
    outputs: {
      "dashboard/api/biofouling/port-risk-map.json": publicItemsEnvelope({ generatedAt, dataMode, sourceTable: "NOAA_SST,AIS_dwell_time,salinity_proxy,port_summary_current", items: portItems.slice(0, 30), extra: commonExtra }),
      "dashboard/api/biofouling/vessel-risk-scores.json": publicItemsEnvelope({ generatedAt, dataMode, sourceTable: "NOAA_SST,AIS_dwell_time,salinity_proxy,risk_history,opportunity_master", items: vesselItems.slice(0, 100), extra: commonExtra }),
      "dashboard/api/biofouling/hotspots.json": publicItemsEnvelope({ generatedAt, dataMode, sourceTable: "NOAA_SST,AIS_dwell_time,salinity_proxy,port_summary_current", items: hotspots, extra: commonExtra }),
      "dashboard/api/biofouling/top-hull-cleaning-candidates.json": publicItemsEnvelope({ generatedAt, dataMode, sourceTable: "NOAA_SST,AIS_dwell_time,salinity_proxy,opportunity_master", items: topHullCleaning, extra: commonExtra }),
      "dashboard/api/biofouling/brazil-compliance-risk.json": publicItemsEnvelope({ generatedAt, dataMode, sourceTable: "NOAA_SST,AIS_dwell_time,salinity_proxy,route_snapshot_daily,compliance-exposure", items: brazilCompliance, extra: commonExtra }),
      "dashboard/api/biofouling/port-risk-map.geojson": featureCollection(portFeatures, { generated_at: generatedAt, model_version: BIOFOULING_MODEL_VERSION, layer: "port_biofouling_risk_map" }),
      "dashboard/api/biofouling/hotspots.geojson": featureCollection(hotspotFeatures, { generated_at: generatedAt, model_version: BIOFOULING_MODEL_VERSION, layer: "biofouling_hotspots" })
    }
  };
}

const HULL_CLEANING_ENGINE_MODEL_VERSION = "hull_cleaning_engine_v1";
const HULL_CLEANING_ALERT_DEDUPE_HOURS = 72;

function isoOrNull(value) {
  const date = parseScheduleTime(value);
  return date ? date.toISOString() : null;
}

function addHoursIso(value, hours) {
  const date = parseScheduleTime(value);
  const number = Number(hours);
  if (!date || !Number.isFinite(number)) return null;
  return new Date(date.getTime() + number * 36e5).toISOString();
}

function hullCleaningIdentityKey(record = {}) {
  const imo = firstNonEmpty(record.imo, record.imo_no, record.vessel_display?.imo);
  if (imo && imo !== "-") return `imo:${String(imo).toUpperCase()}`;
  const mmsi = firstNonEmpty(record.mmsi, record.vessel_display?.mmsi);
  if (mmsi && mmsi !== "-") return `mmsi:${String(mmsi).toUpperCase()}`;
  const name = firstNonEmpty(record.vessel_name, record.name, record.ship_name, record.vessel_display?.vessel_name, "unknown");
  const port = recordPortName(record);
  return `name:${String(name).toUpperCase().replace(/\s+/g, " ").trim()}|port:${String(port).toUpperCase()}`;
}

function hullCleaningObservationTime(record = {}, generatedAt = new Date().toISOString()) {
  return firstNonEmpty(
    record.ais_timestamp,
    record.position_timestamp,
    record.last_position_at,
    record.last_seen_at,
    record.updated_at,
    record.collected_at,
    record.ata,
    record.atb,
    record.eta,
    generatedAt
  ) || generatedAt;
}

function hullCleaningHourBucket(record = {}, generatedAt = new Date().toISOString()) {
  const date = parseScheduleTime(hullCleaningObservationTime(record, generatedAt)) || new Date(generatedAt);
  if (Number.isNaN(date.getTime())) return String(generatedAt).slice(0, 13);
  date.setMinutes(0, 0, 0);
  return date.toISOString();
}

function hullCleaningAisObservations(records = [], generatedAt = new Date().toISOString()) {
  const observations = [];
  for (const record of records) {
    const tracks = [
      record.ais_tracks,
      record.ais_track,
      record.track_points,
      record.position_history
    ].find(Array.isArray);
    if (Array.isArray(tracks) && tracks.length) {
      for (const point of tracks) {
        if (!point || typeof point !== "object") continue;
        observations.push({
          ...record,
          ...point,
          ais_timestamp: firstNonEmpty(point.timestamp, point.ts, point.collected_at, point.position_time, record.ais_timestamp, record.last_seen_at, generatedAt),
          ais_track_source: true
        });
      }
    } else {
      observations.push(record);
    }
  }
  return observations;
}

function buildHourlyAisDeduplication(records = [], generatedAt = new Date().toISOString()) {
  const observations = hullCleaningAisObservations(records, generatedAt);
  const buckets = new Map();
  const duplicateByIdentity = new Map();
  for (const observation of observations) {
    const identity = hullCleaningIdentityKey(observation);
    const hour = hullCleaningHourBucket(observation, generatedAt);
    const key = `${identity}|${hour}`;
    const current = buckets.get(key);
    const nextTime = parseScheduleTime(hullCleaningObservationTime(observation, generatedAt))?.getTime() || 0;
    const nextScore = salesPriorityScore(observation) + recordRiskScore(observation);
    if (!current) {
      buckets.set(key, { record: observation, identity, hour, score: nextScore, time: nextTime, count: 1 });
    } else {
      current.count += 1;
      duplicateByIdentity.set(identity, (duplicateByIdentity.get(identity) || 0) + 1);
      if (nextScore > current.score || (nextScore === current.score && nextTime > current.time)) {
        current.record = observation;
        current.score = nextScore;
        current.time = nextTime;
      }
    }
  }
  const dedupedRecords = [...buckets.values()].map(bucket => ({
    ...bucket.record,
    hourly_ais_bucket: bucket.hour,
    hourly_ais_duplicate_count: Math.max(0, bucket.count - 1)
  }));
  return {
    raw_rows: observations.length,
    deduped_rows: dedupedRecords.length,
    duplicate_rows_removed: Math.max(0, observations.length - dedupedRecords.length),
    bucket_count: buckets.size,
    duplicate_by_identity: Object.fromEntries(duplicateByIdentity.entries()),
    dedupedRecords
  };
}

function hullCleaningSpeedKnots(record = {}) {
  return firstFiniteNumber(record.speed_knots, record.sog, record.speed, record.ais_speed, record.avg_speed, record.average_speed);
}

function detectHullCleaningLoitering(record = {}) {
  const speed = hullCleaningSpeedKnots(record);
  const dwellHours = firstFiniteNumber(
    record.low_speed_hours,
    record.loitering_hours,
    record.ais_dwell_hours,
    record.dwell_hours,
    record.anchorage_hours,
    record.waiting_hours,
    record.current_call_stay_hours,
    record.stay_hours,
    0
  ) || 0;
  const statusText = [
    record.status_bucket,
    record.status,
    record.operational_status,
    record.movement_status,
    record.port_call_status,
    record.anchorage_name,
    record.anchorage_area,
    record.location_area
  ].filter(Boolean).join(" ");
  const lowSpeed = speed !== null && speed < 2;
  const repeatedSameArea = Number(record.same_area_sightings || record.observation_count || record.sighting_count || record.snapshot_count || 0) >= 2 && dwellHours >= 6;
  const anchorageSignal = hasAnchorageWaitingSignal(record) || /loiter|idle|drifting|anchor|anchorage|waiting|묘박|정박|대기/i.test(statusText);
  const detected = Boolean(
    (lowSpeed && dwellHours >= 6) ||
    Number(record.low_speed_hours || 0) >= 6 ||
    (anchorageSignal && dwellHours >= 6) ||
    repeatedSameArea
  );
  const hours = detected
    ? Math.round(Math.max(Number(record.low_speed_hours || 0), Number(record.loitering_hours || 0), Number(dwellHours || 0)) * 10) / 10
    : 0;
  const reason = lowSpeed && dwellHours >= 6
    ? "<2kn 저속 상태가 6시간 이상 지속된 신호"
    : Number(record.low_speed_hours || 0) >= 6
      ? "AIS 저속 누적 시간이 6시간 이상"
      : anchorageSignal && dwellHours >= 6
        ? "묘박/대기 상태와 장시간 체류 신호"
        : repeatedSameArea
          ? "동일 항만/해역 반복 관측 신호"
          : "loitering 신호 없음";
  return {
    loitering_detected: detected,
    loitering_hours: hours,
    loitering_reason: reason
  };
}

function buildSstZScoreContext(records = [], sstContext = {}) {
  const values = records.map(record => biofoulingEnvironmentalInput(record, sstContext).sst_anomaly).filter(value => Number.isFinite(Number(value)));
  const mean = values.length ? values.reduce((sum, value) => sum + Number(value), 0) / values.length : 0;
  const variance = values.length ? values.reduce((sum, value) => sum + (Number(value) - mean) ** 2, 0) / values.length : 0;
  const stddev = Math.sqrt(variance) || 0;
  const byIdentity = new Map();
  for (const record of records) {
    const env = biofoulingEnvironmentalInput(record, sstContext);
    const z = stddev ? (Number(env.sst_anomaly || 0) - mean) / stddev : 0;
    byIdentity.set(hullCleaningIdentityKey(record), Math.round(z * 100) / 100);
  }
  return {
    mean: Math.round(mean * 100) / 100,
    stddev: Math.round(stddev * 100) / 100,
    byIdentity
  };
}

function deriveHullDeparturePrediction(record = {}, generatedAt = new Date().toISOString()) {
  const atd = isoOrNull(record.atd || record.departure_time);
  if (atd) return { departure_prediction_eta: atd, departure_prediction_confidence: 98, departure_prediction_source: "ATD_CONFIRMED" };
  const pilotDirection = String(record.pilot_direction || record.movement_type || "").toLowerCase();
  const pilotTime = firstNonEmpty(record.pilot_time, record.movement_time, record.pilot_event_time);
  if (pilotDirection === "outbound" && pilotTime) {
    return { departure_prediction_eta: isoOrNull(pilotTime), departure_prediction_confidence: 86, departure_prediction_source: "PORT_MIS_OUTBOUND_PILOT" };
  }
  const etd = firstNonEmpty(record.etd, record.etd_candidate, record.predicted_departure_time);
  if (etd) return { departure_prediction_eta: isoOrNull(etd), departure_prediction_confidence: record.pilot_schedule_matched ? 82 : 72, departure_prediction_source: "ETD" };
  const metrics = deriveScheduleMetrics(record);
  if (Number(metrics.work_window_hours || 0) > 0) {
    return { departure_prediction_eta: addHoursIso(generatedAt, metrics.work_window_hours), departure_prediction_confidence: 58, departure_prediction_source: "WORK_WINDOW" };
  }
  const anchorOrStay = firstFiniteNumber(record.anchorage_hours, record.waiting_hours, record.stay_hours, record.current_call_stay_hours, 0) || 0;
  if (anchorOrStay >= 72 && !isDepartedRecord(record)) {
    return { departure_prediction_eta: addHoursIso(generatedAt, 24), departure_prediction_confidence: 36, departure_prediction_source: "LONG_STAY_HEURISTIC" };
  }
  return { departure_prediction_eta: null, departure_prediction_confidence: 0, departure_prediction_source: "UNKNOWN" };
}

function derivePilotEventSuppression(record = {}, departure = {}) {
  const pilotDirection = String(record.pilot_direction || record.movement_type || "").toLowerCase();
  const departureTime = parseScheduleTime(departure.departure_prediction_eta);
  const hoursToDeparture = departureTime ? (departureTime.getTime() - Date.now()) / 36e5 : null;
  if (isDepartedRecord(record) || firstNonEmpty(record.atd, record.departure_time)) {
    return { pilot_event_suppressed: true, pilot_suppression_reason: "ATD/출항 완료 신호", score_penalty: 45 };
  }
  if (record.outbound_pilot_scheduled || pilotDirection === "outbound") {
    const penalty = hoursToDeparture !== null && hoursToDeparture <= 12 ? 35 : hoursToDeparture !== null && hoursToDeparture <= 24 ? 25 : 18;
    return { pilot_event_suppressed: true, pilot_suppression_reason: "출항 도선 일정으로 작업 가능 창 축소", score_penalty: penalty };
  }
  return { pilot_event_suppressed: false, pilot_suppression_reason: "", score_penalty: 0 };
}

function hullCleaningVesselProfileScore(record = {}) {
  const age = firstFiniteNumber(record.vessel_age, record.age);
  const builtYear = firstFiniteNumber(record.build_year, record.year_built, record.built_year);
  const currentYear = new Date().getUTCFullYear();
  const resolvedAge = Number.isFinite(age) ? age : Number.isFinite(builtYear) ? currentYear - builtYear : 0;
  const type = String([record.vessel_type, record.vessel_type_group, record.commercial_segment].filter(Boolean).join(" ")).toLowerCase();
  let score = 0;
  if (resolvedAge >= 15) score += 35;
  else if (resolvedAge >= 8) score += 22;
  else if (resolvedAge >= 3) score += 10;
  if (/bulk|bulker|tanker|vlcc|lng|lpg|container|pctc|cruise|cargo|carrier/.test(type)) score += 45;
  else if (/general|chemical|product/.test(type)) score += 25;
  return boundedScore(score);
}

function deriveHullCleaningOpportunityScore(record = {}, context = {}) {
  const metrics = deriveScheduleMetrics(record);
  const baseCleaning = firstFiniteNumber(
    record.predicted_cleaning_opportunity_score,
    record.hull_cleaning_candidate_score,
    record.cleaning_candidate_score,
    record.cleaning_window_score,
    0
  ) || 0;
  const opportunity = salesPriorityScore(record);
  const bio = firstFiniteNumber(context.biofoulingRiskScore, record.biofouling_risk_score, record.biofouling_exposure_score, record.biofouling_score, recordRiskScore(record), 0) || 0;
  const loiteringScore = context.loitering?.loitering_detected ? Math.min(100, Number(context.loitering.loitering_hours || 0) * 8) : 0;
  const congestion = firstFiniteNumber(context.portCongestionIndex, record.port_congestion_score, record.congestion_score, deriveCongestionScore(record, metrics), 0) || 0;
  const vesselProfile = hullCleaningVesselProfileScore(record);
  const sstBoost = Math.max(0, Number(context.sstAnomalyZScore || 0)) * 4;
  const penalty = Number(context.pilotSuppression?.score_penalty || 0);
  return boundedScore(
    baseCleaning * 0.32 +
    opportunity * 0.22 +
    bio * 0.20 +
    loiteringScore * 0.10 +
    congestion * 0.08 +
    vesselProfile * 0.05 +
    sstBoost -
    penalty
  );
}

function hullCleaningReason(record = {}, item = {}) {
  const reasons = [];
  if (item.loitering_detected) reasons.push(`loitering ${item.loitering_hours}h`);
  if (Number(item.biofouling_risk_score || 0) >= 60) reasons.push(`biofouling ${item.biofouling_risk_score}점`);
  if (Number(item.port_congestion_index || 0) >= 50) reasons.push(`항만 혼잡 ${item.port_congestion_index}점`);
  if (Number(item.sst_anomaly_z_score || 0) > 0.5) reasons.push(`SST z-score ${item.sst_anomaly_z_score}`);
  if (item.departure_prediction_eta) reasons.push(`출항 예측 ${String(item.departure_prediction_eta).slice(0, 16)}`);
  if (item.pilot_event_suppressed) reasons.push("출항 도선 일정으로 점수 억제");
  if (!reasons.length) reasons.push(compactReasonSummary(record));
  return reasons.slice(0, 5).join(" · ");
}

function dedupeHullCleaningAlerts72h(items = [], generatedAt = new Date().toISOString()) {
  const windowMs = HULL_CLEANING_ALERT_DEDUPE_HOURS * 36e5;
  const map = new Map();
  for (const item of items) {
    const eventTime = parseScheduleTime(item.last_seen_at || item.departure_prediction_eta || generatedAt)?.getTime() || Date.parse(generatedAt) || Date.now();
    const bucket = Math.floor(eventTime / windowMs);
    const key = `${hullCleaningIdentityKey(item)}|HULL_CLEANING_OPPORTUNITY|${bucket}`;
    const current = map.get(key);
    if (!current || Number(item.hull_cleaning_opportunity_score || 0) > Number(current.hull_cleaning_opportunity_score || 0)) {
      map.set(key, item);
    }
  }
  return [...map.values()];
}

function buildHullCleaningPortPayloads(items = [], { generatedAt, dataMode } = {}) {
  const map = new Map();
  for (const item of items) {
    const normalized = normalizePort(item.port || item.port_name || item.current_port || item.vessel_display?.current_port || "UNKNOWN");
    const key = normalized.port_code || "UNKNOWN";
    const row = map.get(key) || {
      port_code: key,
      port_name: normalized.port_name || "미확인 항만",
      display_name: normalized.port_name || "미확인 항만",
      vessel_count: 0,
      hot_prospect_count: 0,
      loitering_count: 0,
      pilot_suppressed_count: 0,
      opportunity_total: 0,
      bio_total: 0,
      congestion_total: 0,
      items: []
    };
    row.vessel_count += 1;
    row.hot_prospect_count += Number(item.hull_cleaning_opportunity_score || 0) >= 70 ? 1 : 0;
    row.loitering_count += item.loitering_detected ? 1 : 0;
    row.pilot_suppressed_count += item.pilot_event_suppressed ? 1 : 0;
    row.opportunity_total += Number(item.hull_cleaning_opportunity_score || 0);
    row.bio_total += Number(item.biofouling_risk_score || 0);
    row.congestion_total += Number(item.port_congestion_index || 0);
    row.items.push(item);
    map.set(key, row);
  }
  const summaries = [...map.values()].map(row => ({
    port_code: row.port_code,
    port_name: row.port_name,
    display_name: row.display_name,
    vessel_count: row.vessel_count,
    hot_prospect_count: row.hot_prospect_count,
    loitering_count: row.loitering_count,
    pilot_suppressed_count: row.pilot_suppressed_count,
    average_hull_cleaning_opportunity_score: row.vessel_count ? Math.round(row.opportunity_total / row.vessel_count) : 0,
    average_biofouling_risk_score: row.vessel_count ? Math.round(row.bio_total / row.vessel_count) : 0,
    port_congestion_index: row.vessel_count ? Math.round(row.congestion_total / row.vessel_count) : 0,
    reason_summary: `${row.display_name}: Hull Cleaning 후보 ${row.hot_prospect_count}척, loitering ${row.loitering_count}척`,
    recommended_action: row.hot_prospect_count ? "상위 후보 선박의 출항 전 작업 가능 창을 확인" : "항만 체류/혼잡 변화를 모니터링"
  })).sort((a, b) => b.hot_prospect_count - a.hot_prospect_count || b.average_hull_cleaning_opportunity_score - a.average_hull_cleaning_opportunity_score);
  const payloads = {};
  for (const row of map.values()) {
    payloads[row.port_code] = publicItemsEnvelope({
      generatedAt,
      dataMode,
      sourceTable: "AIS_vessel_tracks,Port-MIS_pilot_events,VTS_operations,NOAA_SST,opportunity_master",
      items: row.items.sort((a, b) => Number(b.hull_cleaning_opportunity_score || 0) - Number(a.hull_cleaning_opportunity_score || 0)).slice(0, 20),
      extra: {
        summary: summaries.find(summary => summary.port_code === row.port_code) || null,
        status: row.items.length ? "active" : "empty"
      }
    });
  }
  return { summaries, payloads };
}

function buildHullCleaningIntelligenceEngine({ records = [], portStatistics = {}, sstContext = {}, generatedAt, dataMode } = {}) {
  const aisDedup = buildHourlyAisDeduplication(records, generatedAt);
  const sourceRecords = dedupeCandidateRows(aisDedup.dedupedRecords)
    .filter(record => !isSyntheticSample(record) && hasUsefulVesselIdentity(record));
  const zScores = buildSstZScoreContext(sourceRecords, sstContext);
  const items = sourceRecords
    .map((record, index) => {
      const env = biofoulingEnvironmentalInput(record, sstContext);
      const loitering = detectHullCleaningLoitering(record);
      const departure = deriveHullDeparturePrediction(record, generatedAt);
      const pilotSuppression = derivePilotEventSuppression(record, departure);
      const metrics = deriveScheduleMetrics(record);
      const portCongestionIndex = boundedScore(firstFiniteNumber(record.port_congestion_index, record.port_congestion_score, record.congestion_score, deriveCongestionScore(record, metrics), 0) || 0);
      const biofoulingRiskScore = Math.max(env.biofouling_risk_score, recordRiskScore(record));
      const sstAnomalyZScore = zScores.byIdentity.get(hullCleaningIdentityKey(record)) || 0;
      const hullCleaningOpportunityScore = deriveHullCleaningOpportunityScore(record, {
        biofoulingRiskScore,
        loitering,
        portCongestionIndex,
        sstAnomalyZScore,
        pilotSuppression
      });
      return compactVesselInsight(record, index, {
        hull_cleaning_opportunity_score: hullCleaningOpportunityScore,
        opportunity_score: hullCleaningOpportunityScore,
        biofouling_risk_score: boundedScore(biofoulingRiskScore),
        risk_score: boundedScore(biofoulingRiskScore),
        departure_prediction_eta: departure.departure_prediction_eta,
        departure_prediction_confidence: departure.departure_prediction_confidence,
        departure_prediction_source: departure.departure_prediction_source,
        port_congestion_index: portCongestionIndex,
        sst_anomaly: env.sst_anomaly,
        sst_anomaly_z_score: sstAnomalyZScore,
        ais_dwell_hours: env.dwell_hours,
        loitering_detected: loitering.loitering_detected,
        loitering_hours: loitering.loitering_hours,
        loitering_reason: loitering.loitering_reason,
        hourly_ais_bucket: record.hourly_ais_bucket || hullCleaningHourBucket(record, generatedAt),
        hourly_ais_duplicate_count: Number(record.hourly_ais_duplicate_count || 0),
        pilot_event_suppressed: pilotSuppression.pilot_event_suppressed,
        pilot_suppression_reason: pilotSuppression.pilot_suppression_reason,
        alert_dedupe_window_hours: HULL_CLEANING_ALERT_DEDUPE_HOURS,
        priority_label: salesPriorityBand(hullCleaningOpportunityScore),
        model_version: HULL_CLEANING_ENGINE_MODEL_VERSION,
        formula: "Existing commercial opportunity + biofouling + loitering + congestion + vessel profile - outbound pilot suppression",
        top_factors: [
          `Hull ${hullCleaningOpportunityScore}`,
          `Biofouling ${boundedScore(biofoulingRiskScore)}`,
          `Congestion ${portCongestionIndex}`,
          loitering.loitering_detected ? `Loitering ${loitering.loitering_hours}h` : null,
          sstAnomalyZScore ? `SST z ${sstAnomalyZScore}` : null,
          pilotSuppression.pilot_event_suppressed ? "Pilot suppressed" : null
        ].filter(Boolean),
        reason_summary: hullCleaningReason(record, {
          hull_cleaning_opportunity_score: hullCleaningOpportunityScore,
          biofouling_risk_score: boundedScore(biofoulingRiskScore),
          port_congestion_index: portCongestionIndex,
          sst_anomaly_z_score: sstAnomalyZScore,
          departure_prediction_eta: departure.departure_prediction_eta,
          loitering_detected: loitering.loitering_detected,
          loitering_hours: loitering.loitering_hours,
          pilot_event_suppressed: pilotSuppression.pilot_event_suppressed
        }),
        recommended_action: hullCleaningOpportunityScore >= 75
          ? "출항 전 작업 가능 시간과 에이전트/운영사 연락 경로를 즉시 확인"
          : hullCleaningOpportunityScore >= 55
            ? "체류·도선 일정 변화를 보며 선저 상태 확인 메시지를 준비"
            : "다음 AIS/입항 업데이트에서 기회 신호를 재확인",
        data_sources: [...new Set([...displaySources(record), "AIS vessel tracks", "ETA/ETB/ATB/ATD", "Port-MIS pilot events", "VTS operations", "NOAA SST"])],
        last_seen_at: hullCleaningObservationTime(record, generatedAt)
      });
    })
    .filter(item => Number(item.hull_cleaning_opportunity_score || 0) >= 35 || Number(item.biofouling_risk_score || 0) >= 40 || item.loitering_detected)
    .sort((a, b) =>
      Number(b.hull_cleaning_opportunity_score || 0) - Number(a.hull_cleaning_opportunity_score || 0) ||
      Number(b.biofouling_risk_score || 0) - Number(a.biofouling_risk_score || 0) ||
      Number(b.port_congestion_index || 0) - Number(a.port_congestion_index || 0)
    );
  const dedupedAlerts = dedupeHullCleaningAlerts72h(items, generatedAt)
    .slice(0, 10)
    .map((item, index) => ({ ...item, rank: index + 1, hot_prospect_rank: index + 1 }));
  const portEngine = buildHullCleaningPortPayloads(dedupedAlerts, { generatedAt, dataMode });
  const summary = {
    model_version: HULL_CLEANING_ENGINE_MODEL_VERSION,
    hourly_ais_deduplication: {
      raw_rows: aisDedup.raw_rows,
      deduped_rows: aisDedup.deduped_rows,
      duplicate_rows_removed: aisDedup.duplicate_rows_removed,
      bucket_count: aisDedup.bucket_count
    },
    loitering_vessels_count: dedupedAlerts.filter(item => item.loitering_detected).length,
    pilot_suppressed_count: dedupedAlerts.filter(item => item.pilot_event_suppressed).length,
    sst_anomaly_z_score: {
      mean: zScores.mean,
      stddev: zScores.stddev
    },
    alert_dedupe_window_hours: HULL_CLEANING_ALERT_DEDUPE_HOURS,
    average_hull_cleaning_opportunity_score: dedupedAlerts.length ? Math.round(dedupedAlerts.reduce((sum, item) => sum + Number(item.hull_cleaning_opportunity_score || 0), 0) / dedupedAlerts.length) : 0,
    average_biofouling_risk_score: dedupedAlerts.length ? Math.round(dedupedAlerts.reduce((sum, item) => sum + Number(item.biofouling_risk_score || 0), 0) / dedupedAlerts.length) : 0,
    average_port_congestion_index: dedupedAlerts.length ? Math.round(dedupedAlerts.reduce((sum, item) => sum + Number(item.port_congestion_index || 0), 0) / dedupedAlerts.length) : 0,
    port_count: portEngine.summaries.length,
    port_summary: portEngine.summaries.slice(0, 20)
  };
  return {
    summary,
    portPayloads: portEngine.payloads,
    payload: publicItemsEnvelope({
      generatedAt,
      dataMode,
      sourceTable: "AIS_vessel_tracks,ETA_ETB_ATB_ATD,Port-MIS_pilot_events,VTS_operations,NOAA_SST,vessel_master,opportunity_master",
      items: dedupedAlerts,
      extra: {
        summary,
        by_port: portEngine.summaries.slice(0, 20),
        status: dedupedAlerts.length ? "active" : "empty",
        reason: dedupedAlerts.length ? null : "Hull Cleaning 엔진 조건을 통과한 후보가 없습니다."
      }
    })
  };
}

function buildCleaningWindowIntelligenceSummary({ records = [], generatedAt, dataMode } = {}) {
  const items = records
    .map((record, index) => {
      const stay = dwellDays(record);
      const riskScore = recordRiskScore(record);
      const opportunityScore = salesPriorityScore(record);
      const waitingHours = firstFiniteNumber(record.waiting_hours, record.anchorage_hours, record.estimated_waiting_time, record.current_call_stay_hours, record.stay_hours, 0) || 0;
      const repeatScore = Math.min(20, repeatCallerVisitCount(record, 365) * 5);
      const hasArrival = hasArrivalPipelineSignal(record);
      const hasAnchorage = hasAnchorageWaitingSignal(record);
      const windowType = hasAnchorage
        ? "ANCHORAGE"
        : stay >= 3
          ? "LONG_STAY"
          : hasArrival
            ? "PRE_ARRIVAL"
            : repeatCallerVisitCount(record, 90) >= 2 || Number(record.repeat_caller_score || 0) > 0
              ? "REPEAT_CALLER"
              : riskScore >= 60
                ? "HIGH_RISK"
                : "LONG_STAY";
      const windowScore = Math.min(100, Math.round(
        Math.min(35, stay * 4) +
        Math.min(25, Number(waitingHours || 0) / 4) +
        (hasArrival ? 8 : 0) +
        (hasAnchorage ? 12 : 0) +
        Math.min(25, riskScore * 0.25) +
        Math.min(25, opportunityScore * 0.25) +
        repeatScore
      ));
      return compactVesselInsight(record, index, {
        opportunity_score: opportunityScore,
        window_type: windowType,
        stay_days: stay,
        waiting_hours: waitingHours,
        arrival_port: recordPortName(record),
        next_eta: firstNonEmpty(record.next_eta, record.eta, record.etb, record.predicted_arrival_time, record.arrival_time) || null,
        risk_score: riskScore,
        window_score: windowScore,
        confidence_score: firstFiniteNumber(record.contact_readiness_score, record.data_confidence_score, record.confidence_score, hasAnchorage || hasArrival ? 65 : 45, 0) || 0,
        reason_summary: `체류 ${stay}일, 대기 ${Math.round(waitingHours)}시간, 리스크 ${riskScore}점, 기회 ${opportunityScore}점 기반 클리닝 적기 신호`,
        recommended_action: windowScore >= 70 ? "출항 전 작업 가능 시간과 대리점 연락 경로를 즉시 확인" : "체류가 길어지는지 모니터링 후 작업 가능성을 재확인",
        data_sources: displaySources(record).length ? displaySources(record) : ["opportunity_master", "vessel_snapshot_daily", "commercial_opportunity_daily"]
      });
    })
    .filter(item => Number(item.window_score || 0) >= 35 || Number(item.opportunity_score || 0) >= 65 || Number(item.risk_score || 0) >= 60 || Number(item.waiting_hours || 0) > 0)
    .sort((a, b) => Number(b.window_score || 0) - Number(a.window_score || 0) || Number(b.opportunity_score || 0) - Number(a.opportunity_score || 0))
    .slice(0, 10)
    .map((item, index) => ({ ...item, rank: index + 1 }));
  return intelligenceEnvelope({ generatedAt, dataMode, sourceTable: "vessel_visits,route_snapshot_daily,commercial_opportunity_daily,vessel_snapshot_daily,opportunity_master,risk_history", items });
}

function aggregateOperators(records = [], fleetOpportunities = []) {
  const map = new Map();
  for (const record of records) {
    const operator = operatorDisplayName(record);
    if (!operator || operator === "운영사 확인 필요") continue;
    const current = map.get(operator) || {
      operator_name: operator,
      vessel_count: 0,
      hot_count: 0,
      warm_count: 0,
      high_risk_count: 0,
      repeat_caller_count: 0,
      compliance_exposure_count: 0,
      score_total: 0,
      risk_total: 0,
      ports: new Map(),
      last_seen: null
    };
    const score = salesPriorityScore(record);
    const risk = recordRiskScore(record);
    const label = String(firstNonEmpty(record.priority_label, record.sales_priority_band, record.candidate_band, salesPriorityBand(score))).toUpperCase();
    current.vessel_count += 1;
    current.hot_count += label === "HOT" || score >= 75 ? 1 : 0;
    current.warm_count += label === "WARM" || (score >= 50 && score < 75) ? 1 : 0;
    current.high_risk_count += risk >= 70 ? 1 : 0;
    current.repeat_caller_count += repeatCallerVisitCount(record, 365) >= 2 || Number(record.repeat_caller_score || 0) > 0 ? 1 : 0;
    current.compliance_exposure_count += regulatedRouteSignal(record) || complianceCountry(record) || record.compliance_watch ? 1 : 0;
    current.score_total += score;
    current.risk_total += risk;
    const port = recordPortName(record);
    current.ports.set(port, (current.ports.get(port) || 0) + 1);
    const seen = firstNonEmpty(record.last_seen_at, record.updated_at, record.collected_at, record.generated_at);
    if (seen && (!current.last_seen || String(seen) > String(current.last_seen))) current.last_seen = seen;
    map.set(operator, current);
  }
  for (const row of fleetOpportunities) {
    const operator = operatorDisplayName(row);
    if (!operator || operator === "운영사 확인 필요") continue;
    const current = map.get(operator) || { operator_name: operator, vessel_count: 0, hot_count: 0, warm_count: 0, high_risk_count: 0, repeat_caller_count: 0, compliance_exposure_count: 0, score_total: 0, risk_total: 0, ports: new Map(), last_seen: null };
    current.vessel_count = Math.max(current.vessel_count, Number(row.current_vessel_count || row.operator_vessel_count || row.vessel_count || 0));
    current.hot_count = Math.max(current.hot_count, Number(row.hot_count || row.immediate_target_count || 0));
    current.score_total = Math.max(current.score_total, Number(row.fleet_opportunity_score || row.average_commercial_value || 0) * Math.max(1, current.vessel_count));
    map.set(operator, current);
  }
  return [...map.values()].map(row => {
    const topPorts = [...row.ports.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([port_name, count]) => ({ port_name, count }));
    const averageOpportunity = row.vessel_count ? Math.round(row.score_total / row.vessel_count) : 0;
    const averageRisk = row.vessel_count ? Math.round(row.risk_total / row.vessel_count) : 0;
    const koreaPresenceScore = Math.min(100, Math.round(row.vessel_count * 8 + row.repeat_caller_count * 12 + topPorts.length * 5));
    return {
      ...row,
      top_ports: topPorts,
      average_opportunity_score: averageOpportunity,
      average_risk_score: averageRisk,
      korea_presence_score: koreaPresenceScore,
      Korea_presence_score: koreaPresenceScore,
      opportunity_index: Math.min(100, Math.round(averageOpportunity * 0.55 + averageRisk * 0.2 + koreaPresenceScore * 0.25)),
      relationship_score: Math.min(100, Math.round(koreaPresenceScore * 0.6 + row.repeat_caller_count * 8 + row.hot_count * 5))
    };
  });
}

function buildOperatorOpportunitiesIntelligenceSummary({ records = [], fleetOpportunities = [], generatedAt, dataMode } = {}) {
  const items = aggregateOperators(records, fleetOpportunities)
    .sort((a, b) => Number(b.opportunity_index || 0) - Number(a.opportunity_index || 0))
    .slice(0, 10)
    .map((row, index) => ({
      rank: index + 1,
      operator_name: row.operator_name,
      vessel_count: row.vessel_count,
      hot_count: row.hot_count,
      warm_count: row.warm_count,
      high_risk_count: row.high_risk_count,
      repeat_caller_count: row.repeat_caller_count,
      average_opportunity_score: row.average_opportunity_score,
      Korea_presence_score: row.Korea_presence_score,
      korea_presence_score: row.korea_presence_score,
      top_ports: row.top_ports,
      opportunity_score: row.opportunity_index,
      recommended_sales_angle: row.hot_count ? "HOT 후보를 중심으로 선대 단위 제안" : "반복 입항/항만 체류 패턴 기반 관계 구축",
      reason_summary: `${row.operator_name} 관련 ${row.vessel_count}척, HOT ${row.hot_count}척, 반복입항 ${row.repeat_caller_count}척`,
      recommended_action: row.hot_count ? "선사 담당자에게 HOT 후보와 항만별 작업 가능성을 함께 제시" : "한국 입항 패턴을 근거로 담당 창구를 확인"
    }));
  return intelligenceEnvelope({ generatedAt, dataMode, sourceTable: "operator_snapshot_daily,operator_contact_history,commercial_leads,vessel_master,vessel_visits", items });
}

function buildFleetMemoryIntelligenceSummary({ records = [], fleetOpportunities = [], generatedAt, dataMode } = {}) {
  const items = aggregateOperators(records, fleetOpportunities)
    .sort((a, b) => Number(b.relationship_score || 0) - Number(a.relationship_score || 0))
    .slice(0, 10)
    .map((row, index) => ({
      rank: index + 1,
      operator_name: row.operator_name,
      vessels_seen: row.vessel_count,
      previous_targets: row.hot_count + row.warm_count,
      previous_hot_candidates: row.hot_count,
      repeat_callers: row.repeat_caller_count,
      ports_used: row.top_ports.map(port => port.port_name),
      last_seen: row.last_seen,
      relationship_score: row.relationship_score,
      opportunity_score: row.opportunity_index,
      reason_summary: `${row.operator_name} 관계 신호: 선박 ${row.vessel_count}척, 반복입항 ${row.repeat_caller_count}척, 사용 항만 ${row.top_ports.length}곳`,
      recommended_next_action: row.relationship_score >= 70 ? "기존 접점/대리점 단서를 확인해 선대 단위 후속 연락" : "운영사 담당자와 항만별 접점을 먼저 확인",
      recommended_action: row.relationship_score >= 70 ? "기존 접점/대리점 단서를 확인해 선대 단위 후속 연락" : "운영사 담당자와 항만별 접점을 먼저 확인"
    }));
  return intelligenceEnvelope({ generatedAt, dataMode, sourceTable: "operator_contact_history,commercial_leads,operator_snapshot_daily,commercial_opportunity_daily", items });
}

function buildPortOpportunitiesIntelligenceSummary({ records = [], portStatistics = {}, generatedAt, dataMode } = {}) {
  const byPort = new Map();
  for (const record of records) {
    const port = recordPortName(record);
    const current = byPort.get(port) || { port_name: port, vessel_count: 0, sales_target_count: 0, hot_count: 0, repeat_caller_count: 0, score_total: 0, risk_total: 0 };
    const score = salesPriorityScore(record);
    const risk = recordRiskScore(record);
    current.vessel_count += 1;
    current.sales_target_count += score >= 50 ? 1 : 0;
    current.hot_count += score >= 75 ? 1 : 0;
    current.repeat_caller_count += repeatCallerVisitCount(record, 365) >= 2 || Number(record.repeat_caller_score || 0) > 0 ? 1 : 0;
    current.score_total += score;
    current.risk_total += risk;
    byPort.set(port, current);
  }
  for (const port of (portStatistics.ports || [])) {
    const name = port.display_name || port.port_name || port.port || "미확인 항만";
    const current = byPort.get(name) || { port_name: name, vessel_count: 0, sales_target_count: 0, hot_count: 0, repeat_caller_count: 0, score_total: 0, risk_total: 0 };
    current.vessel_count = Math.max(current.vessel_count, Number(port.vessel_count || port.total_vessels || 0));
    current.sales_target_count = Math.max(current.sales_target_count, Number(port.target_count || port.candidate_count || port.sales_candidates || 0));
    current.hot_count = Math.max(current.hot_count, Number(port.hot_count || port.hot_candidate_count || port.immediate_target_count || 0));
    byPort.set(name, current);
  }
  const items = [...byPort.values()]
    .map(row => {
      const averageOpportunity = row.vessel_count ? Math.round(row.score_total / row.vessel_count) : 0;
      const averageRisk = row.vessel_count ? Math.round(row.risk_total / row.vessel_count) : 0;
      const opportunityIndex = Math.min(100, Math.round(averageOpportunity * 0.45 + averageRisk * 0.2 + row.hot_count * 8 + row.repeat_caller_count * 3 + row.sales_target_count * 1.5));
      return {
        port_name: row.port_name,
        vessel_count: row.vessel_count,
        sales_target_count: row.sales_target_count,
        hot_count: row.hot_count,
        repeat_caller_count: row.repeat_caller_count,
        average_opportunity_score: averageOpportunity,
        average_risk_score: averageRisk,
        opportunity_index: opportunityIndex,
        opportunity_score: opportunityIndex,
        reason_summary: `${row.port_name} 영업대상 ${row.sales_target_count}척, HOT ${row.hot_count}척`,
        recommended_action: "항만별 상위 후보와 대리점 연락 가능 시간을 확인"
      };
    })
    .sort((a, b) => Number(b.opportunity_index || 0) - Number(a.opportunity_index || 0))
    .slice(0, 10)
    .map((item, index) => ({ ...item, rank: index + 1 }));
  return intelligenceEnvelope({ generatedAt, dataMode, sourceTable: "port_summary_current,port_snapshot_daily,port_congestion_snapshots,opportunity_master,commercial_opportunity_daily", items });
}

const PORT_DEMAND_SERVICES = [
  { key: "hull_cleaning", name: "Hull Cleaning" },
  { key: "uwi", name: "UWI" },
  { key: "bunker", name: "Bunker" },
  { key: "crew_change", name: "Crew Change" },
  { key: "waste_disposal", name: "Waste Disposal" },
  { key: "repair", name: "Repair" },
  { key: "diving", name: "Diving" }
];

function serviceText(record = {}) {
  return String([
    record.service_type,
    record.opportunity_type,
    record.recommended_action,
    record.reason_summary,
    record.why_now,
    record.status,
    record.status_bucket,
    record.vessel_type,
    record.commercial_signal_flags,
    record.operational_risk_flags
  ].flat().filter(Boolean).join(" ")).toLowerCase();
}

function serviceDemandFlags(record = {}) {
  const text = serviceText(record);
  const score = salesPriorityScore(record);
  const risk = recordRiskScore(record);
  const stayDays = dwellDays(record);
  const anchorageHours = Number(record.anchorage_hours || record.waiting_hours || record.stay_hours || record.current_call_stay_hours || 0);
  const gt = Number(record.gt || record.grt || record.grtg || record.gross_tonnage || 0);
  const dwt = Number(record.dwt || record.deadweight || 0);
  const largeVessel = gt >= 10000 || dwt >= 15000;
  const anchoredOrWaiting = anchorageHours >= 12 || /anchor|anchorage|waiting|묘박|정박|대기/.test(text);
  const longStay = stayDays >= 3 || anchorageHours >= 72;
  const arrivalSignal = Boolean(firstNonEmpty(record.eta, record.etb, record.arrival_time, record.predicted_arrival_time)) || /arrival|inbound|입항|예정/.test(text);
  const repairSignal = /repair|maintenance|drydock|yard|정비|수리|드라이독/.test(text) || Number(record.predicted_cleaning_opportunity_score || 0) >= 65;
  const biofoulingSignal = risk >= 55 || Number(record.biofouling_exposure_score || record.biofouling_score || record.biofouling_risk_score || 0) >= 55;
  return {
    hull_cleaning: score >= 50 || biofoulingSignal || longStay || record.is_cleaning_candidate === true,
    uwi: risk >= 60 || longStay || repairSignal || /inspection|uwi|underwater|검사|점검/.test(text),
    bunker: arrivalSignal || largeVessel || /bunker|fuel|급유/.test(text),
    crew_change: longStay || arrivalSignal || /crew|seafarer|선원|교대/.test(text),
    waste_disposal: longStay || anchoredOrWaiting || largeVessel || /waste|sludge|garbage|폐기|오염/.test(text),
    repair: repairSignal || risk >= 65 || /defect|damage|고장|손상/.test(text),
    diving: anchoredOrWaiting || risk >= 60 || /diving|underwater|잠수/.test(text)
  };
}

const SERVICE_BUNDLE_SERVICES = [
  "Hull Cleaning",
  "UWI",
  "Propeller Polish",
  "Biofouling Report",
  "Performance Report",
  "Pre-docking Inspection"
];

function serviceBundleSignals(record = {}) {
  const text = serviceText(record);
  const demand = serviceDemandFlags(record);
  const opportunity = salesPriorityScore(record);
  const risk = recordRiskScore(record);
  const stay = dwellDays(record);
  const waitingHours = firstFiniteNumber(record.waiting_hours, record.anchorage_hours, record.estimated_waiting_time, record.current_call_stay_hours, record.stay_hours, 0) || 0;
  const gt = Number(record.gt || record.grt || record.grtg || record.gross_tonnage || 0);
  const dwt = Number(record.dwt || record.deadweight || 0);
  const largeVessel = gt >= 10000 || dwt >= 15000;
  const complianceSignal = regulatedRouteSignal(record) || complianceExposureRegions(record).length > 0 || /compliance|biosecurity|biofouling|brazil|australia|new zealand|california|canada/i.test(text);
  const performanceSignal = /fuel|performance|cii|efficiency|speed|consumption|연료|효율|성능/i.test(text) || opportunity >= 65 || largeVessel;
  const dockingSignal = /drydock|dock|yard|repair|inspection|정비|수리|드라이독|도크/i.test(text) || risk >= 70 || Number(record.predicted_cleaning_opportunity_score || 0) >= 65;
  const cleaningWindowSignal = Number(record.window_score || record.cleaning_window_score || 0) >= 55 || stay >= 3 || waitingHours >= 24 || hasAnchorageWaitingSignal(record);
  return {
    opportunity,
    risk,
    stay,
    waitingHours,
    largeVessel,
    complianceSignal,
    performanceSignal,
    dockingSignal,
    cleaningWindowSignal,
    demand
  };
}

function serviceBundleRecommendation(record = {}) {
  const signals = serviceBundleSignals(record);
  const services = [];
  const reasons = [];
  const add = (service, reason) => {
    if (!services.includes(service)) services.push(service);
    if (reason) reasons.push(reason);
  };

  if (signals.demand.hull_cleaning || signals.opportunity >= 55 || signals.risk >= 55 || signals.cleaningWindowSignal) {
    add("Hull Cleaning", `기회 ${signals.opportunity}점 / 리스크 ${signals.risk}점`);
  }
  if (signals.demand.uwi || signals.risk >= 60 || signals.dockingSignal || signals.waitingHours >= 24) {
    add("UWI", "리스크/대기/점검 신호");
  }
  if (signals.performanceSignal && (signals.largeVessel || signals.opportunity >= 65 || signals.risk >= 50)) {
    add("Propeller Polish", "대형선 또는 성능/연료 효율 개선 신호");
  }
  if (signals.complianceSignal || signals.risk >= 60) {
    add("Biofouling Report", "Compliance 또는 biofouling 리스크 신호");
  }
  if (signals.performanceSignal || signals.opportunity >= 70) {
    add("Performance Report", "연료 효율/CII/운항 성능 제안 신호");
  }
  if (signals.dockingSignal || signals.stay >= 5 || signals.risk >= 70) {
    add("Pre-docking Inspection", "드라이독/정비 전 점검 신호");
  }

  if (!services.length && signals.opportunity >= 45) {
    add("Hull Cleaning", "기본 상업 기회 신호");
    if (signals.risk >= 40) add("Biofouling Report", "보조 리스크 설명 자료 필요");
  }

  const bundleScore = Math.min(100, Math.round(
    signals.opportunity * 0.38 +
    signals.risk * 0.22 +
    Math.min(18, services.length * 4) +
    (signals.cleaningWindowSignal ? 10 : 0) +
    (signals.complianceSignal ? 8 : 0) +
    (signals.performanceSignal ? 6 : 0) +
    (signals.dockingSignal ? 6 : 0)
  ));

  return {
    services: services.slice(0, 6),
    reasons: [...new Set(reasons)].slice(0, 5),
    bundle_score: bundleScore
  };
}

function serviceBundleValueBand(bundleScore = 0, serviceCount = 0) {
  const score = Number(bundleScore || 0);
  if (score >= 80 || serviceCount >= 5) return "HIGH";
  if (score >= 60 || serviceCount >= 3) return "MEDIUM";
  return "LOW";
}

function buildServiceBundleIntelligenceSummary({ records = [], generatedAt, dataMode } = {}) {
  const items = sortCommercialPriority(records)
    .map((record, index) => {
      const recommendation = serviceBundleRecommendation(record);
      const services = recommendation.services;
      const serviceTextValue = services.join(" + ");
      const estimatedValueBand = serviceBundleValueBand(recommendation.bundle_score, services.length);
      return compactVesselInsight(record, index, {
        recommended_bundle: services,
        bundle_score: recommendation.bundle_score,
        opportunity_score: salesPriorityScore(record),
        risk_score: recordRiskScore(record),
        estimated_value_band: estimatedValueBand,
        top_factors: services,
        reason_summary: services.length
          ? `${serviceTextValue} 번들 제안 가능: ${recommendation.reasons.join(", ") || compactReasonSummary(record)}`
          : compactReasonSummary(record),
        recommended_action: services.length
          ? `${serviceTextValue} 묶음 제안서 준비 후 작업 가능 시간과 연락 경로를 확인`
          : "서비스 번들 가능성을 모니터링",
        data_sources: displaySources(record).length ? displaySources(record) : ["opportunity_master", "risk_history", "compliance-exposure", "cleaning-window", "sales/actions"]
      });
    })
    .filter(item => item.recommended_bundle.length >= 2 && Number(item.bundle_score || 0) >= 45)
    .sort((a, b) => Number(b.bundle_score || 0) - Number(a.bundle_score || 0) || Number(b.opportunity_score || 0) - Number(a.opportunity_score || 0))
    .slice(0, 20)
    .map((item, index) => ({ ...item, rank: index + 1 }));
  const bundle_counts = Object.fromEntries(SERVICE_BUNDLE_SERVICES.map(service => [service, items.filter(item => item.recommended_bundle.includes(service)).length]));
  return intelligenceEnvelope({
    generatedAt,
    dataMode,
    sourceTable: "opportunity_master,risk_history,compliance-exposure,cleaning-window,sales/actions",
    items,
    summary: {
      bundle_counts,
      service_catalog: SERVICE_BUNDLE_SERVICES
    },
    extra: { bundle_counts }
  });
}

function previousPortDemandReference() {
  const demand = readJsonSafe("dashboard/api/intelligence/port-demand-radar.json", null);
  const opportunities = readJsonSafe("dashboard/api/intelligence/port-opportunities.json", null);
  const ports = readJsonSafe("dashboard/api/ports.json", null);
  return [
    ...compactItems(demand).map(item => ({ port_name: item.port_name, vessel_count: item.vessel_count })),
    ...compactItems(opportunities).map(item => ({ port_name: item.port_name, vessel_count: item.vessel_count })),
    ...compactItems(ports).map(item => ({ port_name: item.port_name || item.display_name || item.port, vessel_count: item.vessel_count || item.total_vessels }))
  ];
}

function portGrowthTrend(portName, currentValue, previousRows = []) {
  const normalizedName = String(portName || "").trim().toLowerCase();
  const previous = previousRows.find(row => String(row.port_name || row.display_name || row.port || "").trim().toLowerCase() === normalizedName);
  return kpiTrend(currentValue, previous?.vessel_count);
}

function emptyServiceCounts() {
  return Object.fromEntries(PORT_DEMAND_SERVICES.map(service => [service.name, 0]));
}

function buildPortDemandRadarIntelligenceSummary({ records = [], portStatistics = {}, generatedAt, dataMode } = {}) {
  const previousRows = previousPortDemandReference();
  const byPort = new Map();
  const ensurePort = name => {
    const portName = name || "미확인 항만";
    if (!byPort.has(portName)) {
      byPort.set(portName, {
        port_name: portName,
        vessel_count: 0,
        sales_target_count: 0,
        hot_count: 0,
        risk_total: 0,
        score_total: 0,
        congestion_total: 0,
        service_opportunity_counts: emptyServiceCounts()
      });
    }
    return byPort.get(portName);
  };
  for (const record of records) {
    const row = ensurePort(recordPortName(record));
    const score = salesPriorityScore(record);
    const risk = recordRiskScore(record);
    row.vessel_count += 1;
    row.sales_target_count += score >= 50 ? 1 : 0;
    row.hot_count += score >= 75 ? 1 : 0;
    row.risk_total += risk;
    row.score_total += score;
    row.congestion_total += Number(record.port_congestion_score || record.congestion_score || record.congestion_exposure_score || 0);
    const flags = serviceDemandFlags(record);
    for (const service of PORT_DEMAND_SERVICES) {
      if (flags[service.key]) row.service_opportunity_counts[service.name] += 1;
    }
  }
  for (const port of (portStatistics.ports || [])) {
    const name = port.display_name || port.port_name || port.port || "미확인 항만";
    const row = ensurePort(name);
    row.vessel_count = Math.max(row.vessel_count, Number(port.vessel_count || port.total_vessels || 0));
    row.sales_target_count = Math.max(row.sales_target_count, Number(port.target_count || port.candidate_count || port.sales_candidates || 0));
    row.hot_count = Math.max(row.hot_count, Number(port.hot_count || port.hot_candidate_count || port.immediate_target_count || 0));
  }
  const items = [...byPort.values()]
    .map(row => {
      const serviceTotal = Object.values(row.service_opportunity_counts).reduce((sum, value) => sum + Number(value || 0), 0);
      const averageOpportunity = row.vessel_count ? Math.round(row.score_total / row.vessel_count) : 0;
      const averageRisk = row.vessel_count ? Math.round(row.risk_total / row.vessel_count) : 0;
      const averageCongestion = row.vessel_count ? Math.round(row.congestion_total / row.vessel_count) : 0;
      const demandScore = Math.min(100, Math.round(
        Math.min(35, row.vessel_count * 0.08) +
        Math.min(25, row.sales_target_count * 0.35) +
        Math.min(20, row.hot_count * 1.2) +
        averageOpportunity * 0.12 +
        averageRisk * 0.1 +
        averageCongestion * 0.08 +
        Math.min(15, serviceTotal * 0.05)
      ));
      const services = PORT_DEMAND_SERVICES
        .map(service => ({ service_name: service.name, count: row.service_opportunity_counts[service.name] || 0 }))
        .sort((a, b) => Number(b.count || 0) - Number(a.count || 0));
      const growthTrend = portGrowthTrend(row.port_name, row.vessel_count, previousRows);
      const trendDelta = Number(growthTrend.delta_percent);
      const trendFactor = Number.isFinite(trendDelta)
        ? `추세 ${trendDelta > 0 ? `↑ +${trendDelta}%` : trendDelta < 0 ? `↓ ${trendDelta}%` : "→ 0%"}`
        : null;
      return {
        port_name: row.port_name,
        demand_score: demandScore,
        opportunity_score: demandScore,
        vessel_count: row.vessel_count,
        service_opportunity_counts: row.service_opportunity_counts,
        services,
        growth_trend: growthTrend,
        top_factors: [...services.slice(0, 3).map(service => `${service.service_name} ${service.count}`), trendFactor].filter(Boolean),
        average_opportunity_score: averageOpportunity,
        average_risk_score: averageRisk,
        average_congestion_score: averageCongestion,
        reason_summary: `${row.port_name}: 선박 ${row.vessel_count}척, 서비스 신호 ${serviceTotal}건, HOT ${row.hot_count}척`,
        recommended_action: "수요 점수가 높은 항만부터 대리점/운영사 접촉 가능성과 작업 자원 배치를 확인"
      };
    })
    .sort((a, b) => Number(b.demand_score || 0) - Number(a.demand_score || 0) || Number(b.vessel_count || 0) - Number(a.vessel_count || 0))
    .slice(0, 20)
    .map((item, index) => ({ ...item, rank: index + 1 }));
  return intelligenceEnvelope({ generatedAt, dataMode, sourceTable: "port_summary_current,port_snapshot_daily,port_congestion_snapshots,commercial_opportunity_daily,opportunity_master", items });
}

function buildPortDnaIntelligenceSummary({ records = [], portStatistics = {}, generatedAt, dataMode } = {}) {
  const byPort = new Map();
  const increment = (map, key, amount = 1) => {
    const label = firstNonEmpty(key, "-");
    map.set(label, Number(map.get(label) || 0) + amount);
  };
  const topFromMap = (map, labelKey, limit = 5) => [...map.entries()]
    .sort((a, b) => Number(b[1] || 0) - Number(a[1] || 0) || String(a[0]).localeCompare(String(b[0]), "ko"))
    .slice(0, limit)
    .map(([label, count]) => ({ [labelKey]: label, count }));
  const ensurePort = portInfo => {
    const info = portInfo || { port_code: "UNKNOWN", display_name: "미확인 항만", port_name: "미확인 항만" };
    const key = info.port_code || info.display_name || info.port_name || "UNKNOWN";
    if (!byPort.has(key)) {
      byPort.set(key, {
        port_code: info.port_code || "UNKNOWN",
        port_name: info.display_name || info.port_name || "미확인 항만",
        vessel_count: 0,
        sales_target_count: 0,
        hot_count: 0,
        repeat_caller_count: 0,
        compliance_exposure_count: 0,
        score_total: 0,
        risk_total: 0,
        stay_days_total: 0,
        waiting_hours_total: 0,
        large_vessel_count: 0,
        missing_operator_count: 0,
        vessel_types: new Map(),
        operators: new Map()
      });
    }
    return byPort.get(key);
  };

  for (const record of records) {
    const portInfo = normalizedPortInfo(record);
    const row = ensurePort(portInfo);
    const score = salesPriorityScore(record);
    const risk = recordRiskScore(record);
    const stayDays = dwellDays(record);
    const waitingHours = firstFiniteNumber(
      record.waiting_hours,
      record.anchorage_hours,
      record.current_waiting_hours,
      record.berth_waiting_hours,
      hasAnchorageSignal(record) ? firstFiniteNumber(record.stay_hours, record.current_call_stay_hours, 0) : 0,
      0
    ) || 0;
    const operator = operatorFleetName(record);
    const vesselType = firstNonEmpty(record.vessel_type_group, record.vessel_type, record.ship_type, record.type, "미확인 선종");
    const gt = firstFiniteNumber(record.gt, record.grtg, record.intrlGrtg, record.gross_tonnage, 0) || 0;
    const dwt = firstFiniteNumber(record.dwt, record.deadweight, 0) || 0;

    row.vessel_count += 1;
    row.score_total += score;
    row.risk_total += risk;
    row.stay_days_total += stayDays;
    row.waiting_hours_total += Number(waitingHours || 0);
    if (isSalesCandidate(record) || score >= 50) row.sales_target_count += 1;
    if (String(firstNonEmpty(record.priority_label, record.sales_priority_band, record.candidate_band)).toUpperCase() === "HOT" || score >= 75) row.hot_count += 1;
    if (repeatCallerVisitCount(record, 90) >= 2 || repeatCallerVisitCount(record, 365) >= 2 || Number(record.repeat_caller_score || 0) > 0) row.repeat_caller_count += 1;
    if (regulatedRouteSignal(record) || complianceCountry(record) || record.compliance_watch || Number(record.compliance_score || 0) >= 50) row.compliance_exposure_count += 1;
    if (gt >= 30000 || dwt >= 50000 || /bulk|tanker|container|lng|lpg|carrier/i.test(String(vesselType))) row.large_vessel_count += 1;
    if (operator === "미확인 운영사" || operator === "운영사 확인 필요") row.missing_operator_count += 1;
    increment(row.vessel_types, vesselType);
    increment(row.operators, operator);
  }

  for (const port of (portStatistics.ports || [])) {
    const normalized = normalizePort(firstNonEmpty(port.display_name, port.port_name, port.port, port.name));
    const row = ensurePort({
      port_code: firstNonEmpty(port.port_code, normalized.port_code, "UNKNOWN"),
      port_name: firstNonEmpty(normalized.display_name, normalized.port_name, port.display_name, port.port_name, "미확인 항만"),
      display_name: firstNonEmpty(normalized.display_name, normalized.port_name, port.display_name, port.port_name, "미확인 항만")
    });
    row.vessel_count = Math.max(row.vessel_count, Number(port.vessel_count || port.total_vessels || 0));
    row.sales_target_count = Math.max(row.sales_target_count, Number(port.target_count || port.candidate_count || port.sales_candidates || port.sales_target_count || 0));
    row.hot_count = Math.max(row.hot_count, Number(port.hot_count || port.hot_candidate_count || port.immediate_target_count || 0));
  }
  const seedPortRows = [
    ...compactItems(readJsonSafe("dashboard/api/intelligence/port-opportunities.json", null)),
    ...compactItems(readJsonSafe("dashboard/api/intelligence/port-demand-radar.json", null)),
    ...compactItems(readJsonSafe("dashboard/api/congestion-watchlist.json", null)),
    ...(readJsonSafe("dashboard/api/bootstrap.json", {})?.ports || [])
  ];
  for (const port of seedPortRows) {
    const normalized = normalizePort(firstNonEmpty(port.display_name, port.port_name, port.port, port.name));
    const row = ensurePort({
      port_code: firstNonEmpty(port.port_code, normalized.port_code, "UNKNOWN"),
      port_name: firstNonEmpty(normalized.display_name, normalized.port_name, port.display_name, port.port_name, port.port, "미확인 항만"),
      display_name: firstNonEmpty(normalized.display_name, normalized.port_name, port.display_name, port.port_name, port.port, "미확인 항만")
    });
    row.vessel_count = Math.max(row.vessel_count, Number(port.vessel_count || port.total_vessels || 0));
    row.sales_target_count = Math.max(row.sales_target_count, Number(port.sales_target_count || port.target_count || port.candidate_count || port.sales_candidates || 0));
    row.hot_count = Math.max(row.hot_count, Number(port.hot_count || port.hot_candidate_count || port.immediate_target_count || 0));
    row.repeat_caller_count = Math.max(row.repeat_caller_count, Number(port.repeat_caller_count || 0));
    row.compliance_exposure_count = Math.max(row.compliance_exposure_count, Number(port.compliance_exposure_count || 0));
    const averageOpportunity = firstFiniteNumber(port.average_opportunity_score, port.avg_opportunity_score, port.opportunity_index, port.demand_score, port.opportunity_score);
    const averageRisk = firstFiniteNumber(port.average_risk_score, port.avg_risk, port.risk_score);
    if (averageOpportunity !== undefined && averageOpportunity !== null) row.score_total = Math.max(row.score_total, Number(averageOpportunity || 0) * Math.max(1, row.vessel_count));
    if (averageRisk !== undefined && averageRisk !== null) row.risk_total = Math.max(row.risk_total, Number(averageRisk || 0) * Math.max(1, row.vessel_count));
    if (port.average_stay_days) row.stay_days_total = Math.max(row.stay_days_total, Number(port.average_stay_days || 0) * Math.max(1, row.vessel_count));
    if (port.average_waiting_hours) row.waiting_hours_total = Math.max(row.waiting_hours_total, Number(port.average_waiting_hours || 0) * Math.max(1, row.vessel_count));
    for (const item of (port.dominant_vessel_types || port.common_vessel_types || [])) increment(row.vessel_types, firstNonEmpty(item.vessel_type, item.name, item.label), Number(item.count || 1));
    for (const item of (port.top_operators || port.operators || [])) increment(row.operators, firstNonEmpty(item.operator_name, item.operator, item.name, item.label), Number(item.count || 1));
  }

  const items = [...byPort.values()]
    .map(row => {
      const averageStayDays = row.vessel_count ? Math.round((row.stay_days_total / row.vessel_count) * 10) / 10 : 0;
      const averageWaitingHours = row.vessel_count ? Math.round((row.waiting_hours_total / row.vessel_count) * 10) / 10 : 0;
      const averageOpportunity = row.vessel_count ? Math.round(row.score_total / row.vessel_count) : 0;
      const averageRisk = row.vessel_count ? Math.round(row.risk_total / row.vessel_count) : 0;
      const targetRatio = row.vessel_count ? row.sales_target_count / row.vessel_count : 0;
      const hotRatio = row.vessel_count ? row.hot_count / row.vessel_count : 0;
      const repeatRatio = row.vessel_count ? row.repeat_caller_count / row.vessel_count : 0;
      const complianceRatio = row.vessel_count ? row.compliance_exposure_count / row.vessel_count : 0;
      const missingOperatorRatio = row.vessel_count ? row.missing_operator_count / row.vessel_count : 0;
      const largeRatio = row.vessel_count ? row.large_vessel_count / row.vessel_count : 0;
      const commercialDensity = Math.min(100, Math.round(
        averageOpportunity * 0.35 +
        averageRisk * 0.1 +
        targetRatio * 30 +
        hotRatio * 20 +
        repeatRatio * 15 +
        complianceRatio * 15 +
        Math.min(10, averageStayDays * 1.2) +
        Math.min(8, averageWaitingHours * 0.12)
      ));
      let portPersonality = "영업 기회 관찰 항만";
      if (missingOperatorRatio >= 0.5 && row.sales_target_count > 0) portPersonality = "에이전트 확인 필요 항만";
      else if (complianceRatio >= 0.15 || row.compliance_exposure_count >= 2) portPersonality = "Compliance 노출 항만";
      else if (averageStayDays >= 3 || averageWaitingHours >= 24) portPersonality = "장기체류형 항만";
      else if (repeatRatio >= 0.2 || row.repeat_caller_count >= 2) portPersonality = "반복입항 강한 항만";
      else if (largeRatio >= 0.3 || row.large_vessel_count >= 3) portPersonality = "대형선 중심 항만";
      const recommendedSalesStrategy = portPersonality === "에이전트 확인 필요 항만"
        ? "HOT/WARM 선박의 현지 에이전트와 운영사 확인을 우선 처리"
        : portPersonality === "Compliance 노출 항만"
          ? "출항 전 목적지와 biofouling compliance 확인 메시지를 준비"
          : portPersonality === "장기체류형 항만"
            ? "체류/대기 시간이 긴 선박부터 작업 가능 시간과 서비스 가능성을 확인"
            : portPersonality === "반복입항 강한 항만"
              ? "반복 입항 이력을 근거로 운영사 단위 정기 제안을 준비"
              : portPersonality === "대형선 중심 항만"
                ? "대형선 운영사와 대리점 중심으로 작업 리드타임을 선점"
                : "항만별 상위 후보와 수요 레이더를 함께 확인";
      return {
        port_code: row.port_code,
        port_name: row.port_name,
        vessel_count: row.vessel_count,
        sales_target_count: row.sales_target_count,
        hot_count: row.hot_count,
        average_stay_days: averageStayDays,
        average_waiting_hours: averageWaitingHours,
        dominant_vessel_types: topFromMap(row.vessel_types, "vessel_type", 5),
        top_operators: topFromMap(row.operators, "operator_name", 5),
        repeat_caller_count: row.repeat_caller_count,
        compliance_exposure_count: row.compliance_exposure_count,
        average_opportunity_score: averageOpportunity,
        average_risk_score: averageRisk,
        commercial_density: commercialDensity,
        opportunity_score: commercialDensity,
        port_personality: portPersonality,
        recommended_sales_strategy: recommendedSalesStrategy,
        reason_summary: `${row.port_name}: ${portPersonality}, 영업대상 ${row.sales_target_count}척, HOT ${row.hot_count}척, 평균체류 ${averageStayDays}일`,
        recommended_action: recommendedSalesStrategy
      };
    })
    .sort((a, b) => Number(b.commercial_density || 0) - Number(a.commercial_density || 0) || Number(b.hot_count || 0) - Number(a.hot_count || 0) || Number(b.vessel_count || 0) - Number(a.vessel_count || 0))
    .slice(0, 20)
    .map((item, index) => ({ ...item, rank: index + 1 }));
  return intelligenceEnvelope({ generatedAt, dataMode, sourceTable: "port_summary_current,port_snapshot_daily,port_congestion_snapshots,opportunity_master,commercial_opportunity_daily,port-opportunities,port-demand-radar,congestion-watchlist", items });
}

function buildSuperintendentTargetsIntelligenceSummary({ records = [], generatedAt, dataMode } = {}) {
  const items = sortCommercialPriority(records)
    .filter(record => salesPriorityScore(record) >= 50)
    .map((record, index) => {
      const operatorKnown = operatorDisplayName(record) !== "운영사 확인 필요";
      const repeat = repeatCallerVisitCount(record, 365) >= 2 || Number(record.repeat_caller_score || 0) > 0;
      const contactConfidence = firstFiniteNumber(record.contact_readiness_score, record.data_confidence_score, record.confidence_score, operatorKnown ? 55 : 25, 0);
      const fleetScore = Math.min(100, Math.round((operatorKnown ? 35 : 0) + (repeat ? 25 : 0) + salesPriorityScore(record) * 0.4));
      const koreaPresenceScore = Math.min(100, Math.round((repeat ? 55 : 20) + dwellDays(record) * 3));
      const probability = Math.min(100, Math.round(fleetScore * 0.45 + koreaPresenceScore * 0.25 + Number(contactConfidence || 0) * 0.3));
      return compactVesselInsight(record, index, {
        operator_name: operatorKnown ? operatorDisplayName(record) : null,
        manager_name: firstNonEmpty(record.manager_name, record.manager, record.ship_manager, record.technical_manager) || null,
        superintendent_probability: probability,
        contact_confidence: contactConfidence,
        fleet_score: fleetScore,
        korea_presence_score: koreaPresenceScore,
        opportunity_score: salesPriorityScore(record),
        recommended_message_angle: repeat ? "반복 입항과 현재 체류/리스크 신호를 묶어 기술 담당자에게 확인" : "현재 항만 체류와 작업 가능 시간을 중심으로 기술 담당자 확인",
        recommended_next_action: "운영사/관리사 기술감독 또는 대리점 담당자 확인",
        recommended_action: "운영사/관리사 기술감독 또는 대리점 담당자 확인"
      });
    })
    .sort((a, b) => Number(b.superintendent_probability || 0) - Number(a.superintendent_probability || 0) || Number(b.opportunity_score || 0) - Number(a.opportunity_score || 0))
    .slice(0, 10)
    .map((item, index) => ({ ...item, rank: index + 1 }));
  return intelligenceEnvelope({ generatedAt, dataMode, sourceTable: "operator_contact_history,commercial_leads,operator_snapshot_daily,verification-queue,vessel_display,commercial_opportunity_daily", items });
}

function complianceCountry(record = {}) {
  const text = String(firstNonEmpty(record.destination_country, record.destination, record.destination_port, record.next_port, record.route_region, "")).toLowerCase();
  if (/brazil|brasil|브라질/.test(text)) return "Brazil";
  if (/australia|australian|호주/.test(text)) return "Australia";
  if (/new zealand|nz|뉴질랜드/.test(text)) return "New Zealand";
  if (/california|los angeles|long beach|oakland|캘리포니아/.test(text)) return "California";
  if (/canada|vancouver|montreal|캐나다/.test(text)) return "Canada";
  return null;
}

function buildComplianceOpportunitiesIntelligenceSummary({ records = [], generatedAt, dataMode } = {}) {
  const items = records
    .map((record, index) => {
      const country = complianceCountry(record);
      const risk = recordRiskScore(record);
      const score = Math.min(100, Math.round((country ? 45 : 0) + risk * 0.35 + Math.min(20, dwellDays(record) * 2) + Math.min(15, repeatCallerVisitCount(record, 365) * 5)));
      return { record, index, country, score, risk };
    })
    .filter(row => row.country || row.score >= 55)
    .sort((a, b) => b.score - a.score || b.risk - a.risk)
    .slice(0, 10)
    .map((row, index) => compactVesselInsight(row.record, index, {
      destination_country: row.country || "확인 필요",
      compliance_score: row.score,
      risk_score: row.risk,
      risk_level: operationalRiskLevel(row.risk),
      urgency: row.score >= 75 ? "HIGH" : row.score >= 50 ? "MEDIUM" : "LOW",
      reason_summary: `${row.country || "규제 목적지 확인 필요"} 목적지/체류/리스크 신호 기반 compliance opportunity`,
      recommended_action: "목적지와 선저 상태 확인 필요 여부를 출항 전 점검",
      data_sources: displaySources(row.record).length ? displaySources(row.record) : ["risk_history", "route_snapshot_daily", "vessel_visits", "explainability_snapshots"]
    }));
  return intelligenceEnvelope({ generatedAt, dataMode, sourceTable: "risk_history,biofouling,opportunity_master,route_snapshot_daily,vessel_visits,explainability_snapshots", items });
}

function vesselAgeSignal(record = {}, generatedAt = new Date().toISOString()) {
  const explicitAge = firstFiniteNumber(record.vessel_age, record.age, record.ship_age);
  if (explicitAge !== undefined && explicitAge !== null) return Math.max(0, Number(explicitAge));
  const builtYear = firstFiniteNumber(record.build_year, record.year_built, record.built_year, record.delivery_year);
  if (builtYear === undefined || builtYear === null) return null;
  const currentYear = Number(String(generatedAt || "").slice(0, 4)) || new Date().getFullYear();
  if (builtYear < 1900 || builtYear > currentYear) return null;
  return Math.max(0, currentYear - Number(builtYear));
}

function drydockSignalScore(record = {}, generatedAt = new Date().toISOString()) {
  const visits365 = repeatCallerVisitCount(record, 365);
  const visits90 = repeatCallerVisitCount(record, 90);
  const stayDays = dwellDays(record);
  const anchorageHours = Number(firstFiniteNumber(record.anchorage_hours, record.waiting_hours, 0) || 0);
  const opportunity = salesPriorityScore(record);
  const risk = recordRiskScore(record);
  const idle = Number(firstFiniteNumber(record.idle_risk_score, record.idle_exposure, record.operational_risk_score, 0) || 0);
  const age = vesselAgeSignal(record, generatedAt);
  const routePattern = firstNonEmpty(record.route_pattern_id, record.route_pattern_confidence, record.previous_port, record.destination_port, record.next_port) ? 1 : 0;
  const ageScore = age === null ? 0 : age >= 20 ? 18 : age >= 15 ? 14 : age >= 10 ? 9 : age >= 5 ? 4 : 0;
  return Math.min(100, Math.round(
    Math.min(22, visits365 * 4 + visits90 * 3) +
    Math.min(18, stayDays * 2.5) +
    Math.min(14, anchorageHours / 8) +
    Math.min(20, opportunity * 0.2) +
    Math.min(16, Math.max(risk, idle) * 0.16) +
    (routePattern ? 10 : 0) +
    ageScore
  ));
}

function drydockReason(record = {}, probability = 0, generatedAt = new Date().toISOString()) {
  const reasons = [];
  const visits365 = repeatCallerVisitCount(record, 365);
  const stayDays = dwellDays(record);
  const age = vesselAgeSignal(record, generatedAt);
  if (visits365 >= 2) reasons.push(`최근 12개월 반복 입항 ${visits365}회`);
  if (stayDays >= 3) reasons.push(`장기 체류 ${stayDays}일`);
  if (recordRiskScore(record) >= 55) reasons.push(`운영/선저 리스크 ${recordRiskScore(record)}점`);
  if (salesPriorityScore(record) >= 60) reasons.push(`영업 기회 점수 ${salesPriorityScore(record)}점`);
  if (age !== null && age >= 10) reasons.push(`선령 약 ${Math.round(age)}년`);
  if (firstNonEmpty(record.previous_port, record.destination_port, record.next_port, record.route_pattern_id)) reasons.push("항로/방문 패턴 신호");
  return reasons.length
    ? `${reasons.slice(0, 4).join(", ")} 기반 드라이독 planning window 실험 신호`
    : `운영 신호 기반 드라이독 planning window 가능성 ${probability}점`;
}

function buildDrydockPredictionIntelligenceSummary({ records = [], generatedAt, dataMode } = {}) {
  const items = records
    .map((record, index) => {
      const probability = drydockSignalScore(record, generatedAt);
      const confidence = Math.min(100, Math.round(
        (firstFiniteNumber(record.data_confidence_score, record.confidence_score, 0) || 0) * 0.45 +
        (repeatCallerVisitCount(record, 365) >= 2 ? 22 : 0) +
        (firstNonEmpty(record.imo, record.mmsi) ? 12 : 0) +
        (firstNonEmpty(record.previous_port, record.destination_port, record.next_port) ? 12 : 0) +
        (vesselAgeSignal(record, generatedAt) !== null ? 9 : 0)
      ));
      return { record, index, probability, confidence };
    })
    .filter(row => row.probability >= 35 || salesPriorityScore(row.record) >= 65 || repeatCallerVisitCount(row.record, 365) >= 2)
    .sort((a, b) =>
      b.probability - a.probability ||
      b.confidence - a.confidence ||
      salesPriorityScore(b.record) - salesPriorityScore(a.record)
    )
    .slice(0, 10)
    .map((row, index) => compactVesselInsight(row.record, index, {
      drydock_probability: row.probability,
      confidence_score: row.confidence,
      opportunity_score: salesPriorityScore(row.record),
      vessel_age: vesselAgeSignal(row.record, generatedAt),
      reason_summary: drydockReason(row.record, row.probability, generatedAt),
      recommended_action: "실험 신호입니다. 선령, 최근 정비 이력, 다음 항차와 체류 가능 시간을 확인하세요.",
      data_sources: displaySources(row.record).length ? displaySources(row.record) : ["vessel_visits", "route_snapshot_daily", "opportunity_master", "risk_history"]
    }));
  return intelligenceEnvelope({
    generatedAt,
    dataMode,
    sourceTable: "vessel_visits,route_snapshot_daily,vessel_history,opportunity_master,risk_history",
    items,
    extra: { disclaimer: "Experimental / 실험 기능: 운영 신호 기반 드라이독 planning window 추정입니다." }
  });
}

function koreaPresenceScore(record = {}) {
  const visits30 = repeatCallerVisitCount(record, 30);
  const visits90 = repeatCallerVisitCount(record, 90);
  const visits365 = repeatCallerVisitCount(record, 365);
  const stayDays = dwellDays(record);
  const ports = repeatCallerPorts(record);
  const repeatScore = Number(firstFiniteNumber(record.repeat_caller_score, 0) || 0);
  return Math.min(100, Math.round(
    Math.min(34, visits365 * 5 + visits90 * 4 + visits30 * 3) +
    Math.min(24, stayDays * 2) +
    Math.min(18, ports.length * 6) +
    Math.min(24, repeatScore * 0.24)
  ));
}

function buildKoreaPresenceIntelligenceSummary({ records = [], generatedAt, dataMode } = {}) {
  const items = records
    .map((record, index) => {
      const score = koreaPresenceScore(record);
      return { record, index, score };
    })
    .filter(row => row.score > 0 || repeatCallerVisitCount(row.record, 365) > 0)
    .sort((a, b) => b.score - a.score || salesPriorityScore(b.record) - salesPriorityScore(a.record))
    .slice(0, 10)
    .map((row, index) => compactVesselInsight(row.record, index, {
      korea_presence_score: row.score,
      visit_count_30d: repeatCallerVisitCount(row.record, 30),
      visit_count_90d: repeatCallerVisitCount(row.record, 90),
      visit_count_365d: repeatCallerVisitCount(row.record, 365),
      ports_visited: repeatCallerPorts(row.record),
      stay_days: dwellDays(row.record),
      opportunity_score: salesPriorityScore(row.record),
      reason_summary: `한국 기항 영향도 ${row.score}점: 반복 기항, 체류, 항만 다양성 신호 기반`,
      recommended_action: row.score >= 70 ? "반복 기항 이력을 근거로 선사/대리점 접점을 우선 확인" : "다음 입항 전 한국 기항 이력과 연락 가능성을 점검",
      data_sources: displaySources(row.record).length ? displaySources(row.record) : ["vessel_visits", "repeat-callers", "route_snapshot_daily"]
    }));
  return intelligenceEnvelope({ generatedAt, dataMode, sourceTable: "vessel_visits,repeat-callers,route_snapshot_daily", items });
}

function buildVesselTimelineIntelligenceSummary({ records = [], generatedAt, dataMode } = {}) {
  const byVessel = new Map();
  for (const record of records) {
    const key = candidateDedupeKey(record);
    if (!key) continue;
    const current = byVessel.get(key) || {
      record,
      first_seen: null,
      last_seen: null,
      ports: new Set(),
      visit_history: [],
      risk_history: [],
      opportunity_history: []
    };
    const seenAt = firstNonEmpty(record.first_seen, record.first_seen_at, record.last_seen_at, record.updated_at, record.collected_at, record.generated_at, generatedAt);
    if (seenAt && (!current.first_seen || String(seenAt) < String(current.first_seen))) current.first_seen = seenAt;
    if (seenAt && (!current.last_seen || String(seenAt) > String(current.last_seen))) current.last_seen = seenAt;
    const port = recordPortName(record);
    if (port) current.ports.add(port);
    current.visit_history.push({
      seen_at: seenAt || null,
      port,
      status: firstNonEmpty(record.status_bucket, record.status) || null,
      eta: firstNonEmpty(record.eta, record.etb, record.arrival_time) || null
    });
    current.risk_history.push({
      seen_at: seenAt || null,
      risk_score: recordRiskScore(record)
    });
    current.opportunity_history.push({
      seen_at: seenAt || null,
      opportunity_score: salesPriorityScore(record),
      priority_label: salesPriorityBand(salesPriorityScore(record))
    });
    if (salesPriorityScore(record) > salesPriorityScore(current.record)) current.record = record;
    byVessel.set(key, current);
  }
  const items = [...byVessel.values()]
    .map((row, index) => compactVesselInsight(row.record, index, {
      first_seen: row.first_seen || "-",
      last_seen: row.last_seen || "-",
      ports_visited: [...row.ports].slice(0, 8),
      visit_history: row.visit_history.slice(-6),
      risk_history: row.risk_history.slice(-6),
      opportunity_history: row.opportunity_history.slice(-6),
      opportunity_score: salesPriorityScore(row.record),
      risk_score: recordRiskScore(row.record),
      reason_summary: `${firstNonEmpty(row.record.vessel_name, row.record.name, "선박")} 이력: 항만 ${row.ports.size}곳, 방문 신호 ${row.visit_history.length}건`,
      recommended_action: "방문 이력, 리스크 변화, 기회 점수 추이를 함께 확인"
    }))
    .sort((a, b) => Number(b.opportunity_score || 0) - Number(a.opportunity_score || 0) || Number(b.risk_score || 0) - Number(a.risk_score || 0))
    .slice(0, 10);
  return intelligenceEnvelope({ generatedAt, dataMode, sourceTable: "vessel_visits,vessel_snapshot_daily,route_snapshot_daily,risk_history,opportunity_master", items });
}

function buildFleetExpansionIntelligenceSummary({ records = [], fleetOpportunities = [], generatedAt, dataMode } = {}) {
  const operatorRows = aggregateOperators(records, fleetOpportunities);
  const byOperator = new Map();
  for (const record of records) {
    const operator = operatorDisplayName(record);
    if (!operator || operator === "운영사 확인 필요") continue;
    const current = byOperator.get(operator) || { total_operator_vessels: 0, vessel_keys: new Set(), high_opportunity_vessels: 0 };
    current.vessel_keys.add(candidateDedupeKey(record));
    current.high_opportunity_vessels += salesPriorityScore(record) >= 50 ? 1 : 0;
    current.total_operator_vessels = Math.max(
      current.total_operator_vessels,
      Number(firstFiniteNumber(record.total_operator_vessels, record.operator_vessel_count, record.current_vessel_count, record.fleet_vessel_count, 0) || 0)
    );
    byOperator.set(operator, current);
  }
  const items = operatorRows
    .map((row, index) => {
      const details = byOperator.get(row.operator_name) || { vessel_keys: new Set(), high_opportunity_vessels: row.hot_count + row.warm_count, total_operator_vessels: row.vessel_count };
      const known = Math.max(row.vessel_count, details.vessel_keys.size);
      const total = Math.max(known, Number(details.total_operator_vessels || 0));
      const highOpportunity = Math.max(row.hot_count + row.warm_count, details.high_opportunity_vessels || 0);
      const unseen = Math.max(0, total - known);
      const score = Math.min(100, Math.round(row.opportunity_index * 0.45 + row.relationship_score * 0.25 + highOpportunity * 3 + unseen * 2 + row.repeat_caller_count * 4));
      return {
        rank: index + 1,
        operator_name: row.operator_name,
        known_korea_vessels: known,
        total_operator_vessels: total,
        high_opportunity_vessels: highOpportunity,
        unseen_vessels: unseen,
        fleet_expansion_score: score,
        opportunity_score: score,
        reason_summary: `${row.operator_name}: 한국 기항 ${known}척, 고기회 ${highOpportunity}척, 미확인 선대 ${unseen}척`,
        recommended_action: unseen > 0 ? "기존 HOT/WARM 선박 담당자를 통해 같은 선대의 추가 입항/정비 계획을 확인" : "현재 확인된 한국 기항 선대를 중심으로 반복 기회와 연락 경로를 확장"
      };
    })
    .filter(item => item.high_opportunity_vessels > 0 || item.unseen_vessels > 0)
    .sort((a, b) => Number(b.fleet_expansion_score || 0) - Number(a.fleet_expansion_score || 0))
    .slice(0, 10)
    .map((item, index) => ({ ...item, rank: index + 1 }));
  return intelligenceEnvelope({ generatedAt, dataMode, sourceTable: "vessel_master,vessel_visits,operator_snapshot_daily,fleet-memory,repeat-callers,operator-opportunities", items });
}

function buildFleetClusterIntelligenceSummary({ records = [], fleetOpportunities = [], generatedAt, dataMode } = {}) {
  const items = aggregateOperators(records, fleetOpportunities)
    .map((row, index) => {
      const targetCount = row.hot_count + row.warm_count;
      const revenueLow = targetCount * 5000 + row.hot_count * 4000;
      const revenueHigh = targetCount * 24000 + row.hot_count * 4000;
      return {
        rank: index + 1,
        operator_name: row.operator_name,
        vessel_count: row.vessel_count,
        hot_count: row.hot_count,
        repeat_caller_count: row.repeat_caller_count,
        revenue_opportunity: {
          estimated_revenue_low: revenueLow,
          estimated_revenue_high: revenueHigh
        },
        opportunity_score: row.opportunity_index,
        reason_summary: `${row.operator_name}: 선박 ${row.vessel_count}척, HOT ${row.hot_count}척, 반복입항 ${row.repeat_caller_count}척`,
        recommended_action: "선대 단위로 HOT 후보, 반복 입항, 예상 매출 범위를 묶어 검토"
      };
    })
    .sort((a, b) => Number(b.opportunity_score || 0) - Number(a.opportunity_score || 0) || Number(b.hot_count || 0) - Number(a.hot_count || 0))
    .slice(0, 10)
    .map((item, index) => ({ ...item, rank: index + 1 }));
  return intelligenceEnvelope({ generatedAt, dataMode, sourceTable: "operator-opportunities,fleet-memory,operator_snapshot_daily", items });
}

function estimateRevenueRange(count = 0, level = "WARM") {
  const lowUnit = level === "HOT" ? 9000 : 5000;
  const highUnit = level === "HOT" ? 28000 : 16000;
  return {
    target_count: count,
    estimated_revenue_low: count * lowUnit,
    estimated_revenue_high: count * highUnit
  };
}

function revenueAssumptions() {
  const averageCleaningPrice = Number(process.env.AVERAGE_CLEANING_PRICE_USD || process.env.REVENUE_AVERAGE_CLEANING_PRICE_USD || 18000);
  const conservativeConversionRate = Number(process.env.CONSERVATIVE_CONVERSION_RATE || process.env.REVENUE_CONSERVATIVE_CONVERSION_RATE || 0.08);
  const expectedConversionRate = Number(process.env.EXPECTED_CONVERSION_RATE || process.env.REVENUE_EXPECTED_CONVERSION_RATE || 0.16);
  const aggressiveConversionRate = Number(process.env.AGGRESSIVE_CONVERSION_RATE || process.env.REVENUE_AGGRESSIVE_CONVERSION_RATE || 0.28);
  return {
    currency: "USD",
    average_cleaning_price: Number.isFinite(averageCleaningPrice) && averageCleaningPrice > 0 ? averageCleaningPrice : 18000,
    conservative_conversion_rate: Number.isFinite(conservativeConversionRate) && conservativeConversionRate > 0 ? conservativeConversionRate : 0.08,
    expected_conversion_rate: Number.isFinite(expectedConversionRate) && expectedConversionRate > 0 ? expectedConversionRate : 0.16,
    aggressive_conversion_rate: Number.isFinite(aggressiveConversionRate) && aggressiveConversionRate > 0 ? aggressiveConversionRate : 0.28,
    note: "Estimated Opportunity Only - guaranteed revenue가 아닙니다."
  };
}

function revenueValue(targetCount = 0, conversionRate = 0, assumptions = revenueAssumptions()) {
  return Math.round(Number(targetCount || 0) * assumptions.average_cleaning_price * Number(conversionRate || 0));
}

function buildRevenueForecastIntelligenceSummary({ records = [], fleetOpportunities = [], portStatistics = {}, generatedAt, dataMode } = {}) {
  const assumptions = revenueAssumptions();
  const targets = records.filter(record => salesPriorityScore(record) >= 50 || isSalesCandidate(record));
  const hot = targets.filter(record => salesPriorityScore(record) >= 75 || salesPriorityBand(salesPriorityScore(record)) === "HOT").length;
  const warm = targets.filter(record => salesPriorityScore(record) >= 50 && salesPriorityScore(record) < 75).length;
  const low = Math.max(0, targets.length - hot - warm);
  const portfolio = {
    total_targets: targets.length,
    hot_targets: hot,
    warm_targets: warm,
    low_targets: low,
    conservative_revenue: revenueValue(targets.length, assumptions.conservative_conversion_rate, assumptions),
    expected_revenue: revenueValue(targets.length, assumptions.expected_conversion_rate, assumptions),
    aggressive_revenue: revenueValue(targets.length, assumptions.aggressive_conversion_rate, assumptions)
  };
  const byOperator = aggregateOperators(targets, fleetOpportunities)
    .sort((a, b) => b.opportunity_index - a.opportunity_index)
    .slice(0, 10)
    .map(row => {
      const targetCount = row.hot_count + row.warm_count || row.vessel_count;
      return {
        operator_name: row.operator_name,
        target_count: targetCount,
        hot_count: row.hot_count,
        expected_revenue: revenueValue(targetCount, assumptions.expected_conversion_rate, assumptions),
        recommended_sales_angle: row.hot_count ? "HOT 선박 중심 선대 단위 제안" : "반복 입항/한국 항만 활동 기반 관계 구축"
      };
    });
  const byPortMap = new Map();
  for (const record of targets) {
    const port = recordPortName(record);
    const current = byPortMap.get(port) || { port_name: port, target_count: 0, hot_count: 0 };
    current.target_count += 1;
    if (salesPriorityScore(record) >= 75 || salesPriorityBand(salesPriorityScore(record)) === "HOT") current.hot_count += 1;
    byPortMap.set(port, current);
  }
  const byPort = [...byPortMap.values()]
    .map(row => ({
      ...row,
      expected_revenue: revenueValue(row.target_count, assumptions.expected_conversion_rate, assumptions)
    }))
    .sort((a, b) => Number(b.expected_revenue || 0) - Number(a.expected_revenue || 0) || Number(b.hot_count || 0) - Number(a.hot_count || 0))
    .slice(0, 10);
  const byCategoryMap = new Map();
  for (const record of targets) {
    const category = firstNonEmpty(record.primary_category_code, record.primary_category?.code, record.primary_category, record.primary_category_label, "MONITOR");
    const label = firstNonEmpty(record.primary_category_label, record.primary_category?.label, category);
    const current = byCategoryMap.get(category) || { category_code: category, category_label: label, target_count: 0 };
    current.target_count += 1;
    byCategoryMap.set(category, current);
  }
  const byCategory = [...byCategoryMap.values()]
    .map(row => ({ ...row, expected_revenue: revenueValue(row.target_count, assumptions.expected_conversion_rate, assumptions) }))
    .sort((a, b) => Number(b.expected_revenue || 0) - Number(a.expected_revenue || 0))
    .slice(0, 10);
  const sections = {
    HOT: estimateRevenueRange(hot, "HOT"),
    WARM: estimateRevenueRange(warm, "WARM"),
    portfolio,
    by_port: byPort,
    by_operator: byOperator,
    by_category: byCategory,
    assumptions,
    disclaimer: "Estimated Opportunity Only"
  };
  return intelligenceEnvelope({
    generatedAt,
    dataMode,
    sourceTable: "commercial_opportunity_daily,opportunity_master,sales/actions,sales-pipeline,operator_snapshot_daily",
    items: [
      {
        rank: 1,
        operator_name: "전체 영업 퍼널",
        target_count: targets.length,
        total_targets: targets.length,
        hot_targets: hot,
        warm_targets: warm,
        low_targets: low,
        conservative_revenue: portfolio.conservative_revenue,
        expected_revenue: portfolio.expected_revenue,
        aggressive_revenue: portfolio.aggressive_revenue,
        estimated_revenue_low: portfolio.conservative_revenue,
        estimated_revenue_high: portfolio.aggressive_revenue,
        portfolio,
        by_operator: byOperator,
        by_port: byPort,
        by_category: byCategory,
        sections,
        reason_summary: `Estimated Opportunity Only: HOT ${hot}척, WARM ${warm}척, LOW ${low}척 기준의 예상 영업 기회`,
        recommended_action: "보장 매출이 아니라 영업 우선순위 산정용입니다. HOT 후보부터 연락 가능성과 작업 가능 시간을 확인하세요."
      }
    ],
    summary: sections,
    extra: { sections, portfolio, by_operator: byOperator, by_port: byPort, by_category: byCategory, assumptions, disclaimer: "Estimated Opportunity Only" }
  });
}

function fleetPenetrationTargetSignal(record = {}) {
  const score = salesPriorityScore(record);
  const stage = leadConversionStage(record);
  return isSalesCandidate(record) ||
    score >= 50 ||
    ["CONTACT_PLANNED", "CONTACTED", "QUOTE_REQUESTED", "QUOTE_SENT", "NEGOTIATION", "WON"].includes(stage) ||
    privateActivityCount(record, "contact_attempt") > 0 ||
    privateActivityCount(record, "quote_sent") > 0 ||
    privateActivityCount(record, "won") > 0;
}

function fleetPenetrationWonSignal(record = {}) {
  const contact = contactHistoryCounts(record);
  return leadConversionStage(record) === "WON" ||
    privateActivityCount(record, "won") > 0 ||
    contact.previous_wins > 0 ||
    /won|closed_won|수주/i.test(String(firstNonEmpty(record.lead_status, record.opportunity_state, record.quote_result, record.quote_status, "")));
}

function buildFleetPenetrationIntelligenceSummary({ records = [], fleetOpportunities = [], generatedAt, dataMode } = {}) {
  const assumptions = revenueAssumptions();
  const operatorSignals = new Map(aggregateOperators(records, fleetOpportunities).map(row => [row.operator_name, row]));
  const byOperator = new Map();
  const ensure = operator => {
    const current = byOperator.get(operator) || {
      operator_name: operator,
      vesselKeys: new Set(),
      targetedKeys: new Set(),
      wonKeys: new Set(),
      totalFleetHint: 0,
      targetedHint: 0,
      score_total: 0,
      risk_total: 0,
      ports: new Map(),
      top_vessels: []
    };
    byOperator.set(operator, current);
    return current;
  };
  for (const record of records) {
    const operator = operatorDisplayName(record);
    if (!operator || operator === "운영사 확인 필요" || operator === "미확인 운영사") continue;
    const current = ensure(operator);
    const key = opportunityMemoryIdentityKey(record);
    const score = salesPriorityScore(record);
    current.vesselKeys.add(key);
    if (fleetPenetrationTargetSignal(record)) current.targetedKeys.add(key);
    if (fleetPenetrationWonSignal(record)) current.wonKeys.add(key);
    current.score_total += score;
    current.risk_total += recordRiskScore(record);
    const port = recordPortName(record);
    current.ports.set(port, (current.ports.get(port) || 0) + 1);
    current.top_vessels.push({
      vessel_name: firstNonEmpty(record.vessel_name, record.name, record.ship_name, record.vessel_display?.vessel_name, "선명 확인 필요"),
      imo: firstNonEmpty(record.imo, record.imo_no, record.vessel_display?.imo, "-"),
      port,
      opportunity_score: score,
      priority_label: firstNonEmpty(record.priority_label, record.sales_priority_band, salesPriorityBand(score))
    });
  }
  for (const row of fleetOpportunities) {
    const operator = operatorDisplayName(row);
    if (!operator || operator === "운영사 확인 필요" || operator === "미확인 운영사") continue;
    const current = ensure(operator);
    current.totalFleetHint = Math.max(
      current.totalFleetHint,
      firstFiniteNumber(row.total_operator_vessels, row.operator_vessel_count, row.current_vessel_count, row.fleet_size_korea, row.vessel_count, 0) || 0
    );
    const hintedTargets = Number(row.hot_count || 0) + Number(row.warm_count || 0);
    current.targetedHint = Math.max(
      current.targetedHint,
      firstFiniteNumber(row.target_vessel_count, row.target_vessels, row.sales_target_count, hintedTargets, row.immediate_target_count, 0) || 0
    );
  }
  const items = [...byOperator.values()]
    .map(row => {
      const signal = operatorSignals.get(row.operator_name);
      const fleetSize = Math.max(row.vesselKeys.size, row.totalFleetHint, Number(signal?.vessel_count || 0), Number(signal?.fleet_size_korea || 0));
      const wonVessels = row.wonKeys.size;
      const targetedVessels = Math.max(row.targetedKeys.size, row.targetedHint, wonVessels);
      const capturedVessels = wonVessels;
      const penetrationRate = fleetSize > 0 ? Math.round((capturedVessels / fleetSize) * 1000) / 10 : 0;
      const opportunityGap = Math.max(0, fleetSize - capturedVessels);
      const estimatedRemainingRevenue = revenueValue(opportunityGap, assumptions.expected_conversion_rate, assumptions);
      const topPorts = [...row.ports.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([port_name, count]) => ({ port_name, count }));
      const averageOpportunity = fleetSize ? Math.round(row.score_total / Math.max(1, row.vesselKeys.size)) : Number(signal?.average_opportunity_score || 0);
      return {
        operator_name: row.operator_name,
        fleet_size_korea: fleetSize,
        targeted_vessels: targetedVessels,
        won_vessels: wonVessels,
        captured_vessels: capturedVessels,
        penetration_rate: penetrationRate,
        opportunity_gap: opportunityGap,
        estimated_remaining_revenue: estimatedRemainingRevenue,
        currency: assumptions.currency,
        average_opportunity_score: averageOpportunity,
        opportunity_score: Math.min(100, Math.round((100 - penetrationRate) * 0.25 + averageOpportunity * 0.35 + opportunityGap * 3 + targetedVessels * 2 + wonVessels * 6)),
        top_ports: topPorts,
        top_vessels: row.top_vessels
          .sort((a, b) => Number(b.opportunity_score || 0) - Number(a.opportunity_score || 0))
          .slice(0, 5),
        reason_summary: `${row.operator_name}: 한국 확인 선대 ${fleetSize}척 중 수주/작업 포착 ${capturedVessels}척, 침투율 ${penetrationRate}%`,
        recommended_action: opportunityGap > 0
          ? "미포착 선박을 확인해 선대 단위 후속 제안과 관계 확장을 준비"
          : "포착 선박의 수주/재방문 이력을 유지하며 반복 기회를 추적",
        data_sources: ["fleet-intelligence", "vessel_visits", "operator_snapshot_daily", "commercial_leads"]
      };
    })
    .filter(item => item.fleet_size_korea > 0)
    .sort((a, b) =>
      Number(b.estimated_remaining_revenue || 0) - Number(a.estimated_remaining_revenue || 0) ||
      Number(b.opportunity_gap || 0) - Number(a.opportunity_gap || 0) ||
      Number(b.opportunity_score || 0) - Number(a.opportunity_score || 0)
    )
    .slice(0, 20)
    .map((item, index) => ({ ...item, rank: index + 1 }));
  return intelligenceEnvelope({
    generatedAt,
    dataMode,
    sourceTable: "fleet-intelligence,vessel_visits,operator_snapshot_daily,commercial_leads",
    items,
    summary: {
      operator_count: items.length,
      assumptions,
      definition: "penetration_rate = won_vessels / fleet_size_korea; targeted_vessels는 파이프라인 커버리지입니다."
    }
  });
}

function opportunityMemoryIdentityKey(record = {}) {
  const imo = firstNonEmpty(record.imo, record.imo_no);
  const mmsi = firstNonEmpty(record.mmsi);
  if (imo) return `IMO|${imo}`;
  if (mmsi) return `MMSI|${mmsi}`;
  return `NAME_OPERATOR_PORT|${normalizeVesselName(firstNonEmpty(record.vessel_name, record.name, record.ship_name))}|${normalizeVesselName(operatorFleetName(record))}|${normalizeVesselName(recordPortName(record))}`;
}

function opportunityMemoryCounts(record = {}) {
  const score = salesPriorityScore(record);
  const label = salesPriorityBand(score);
  const visits30 = repeatCallerVisitCount(record, 30);
  const visits90 = repeatCallerVisitCount(record, 90);
  const targetSignal90 = firstFiniteNumber(record.target_count_90d, record.sales_target_count_90d, record.opportunity_count_90d, record.visit_count_90d, visits90, 0) || 0;
  const hotCount90 = firstFiniteNumber(record.hot_count_90d, record.hot_opportunity_count_90d);
  const warmCount90 = firstFiniteNumber(record.warm_count_90d, record.warm_opportunity_count_90d);
  return {
    hot_count_30d: firstFiniteNumber(record.hot_count_30d, record.hot_opportunity_count_30d, label === "HOT" ? Math.max(1, visits30 ? 1 : 0) : 0, 0) || 0,
    hot_count_90d: hotCount90 ?? (label === "HOT" ? Math.max(1, visits90 ? 1 : 0) : 0),
    warm_count_90d: warmCount90 ?? (label === "WARM" ? Math.max(1, visits90 ? 1 : 0) : 0),
    target_count_90d: Math.max(label === "HOT" || label === "WARM" || score >= 50 ? 1 : 0, Number(targetSignal90 || 0))
  };
}

function opportunityMemoryLastHotAt(record = {}, generatedAt = new Date().toISOString()) {
  if (salesPriorityBand(salesPriorityScore(record)) !== "HOT") return firstNonEmpty(record.last_hot_at, record.hot_last_seen_at) || null;
  return firstNonEmpty(record.last_hot_at, record.hot_last_seen_at, record.last_seen_at, record.updated_at, record.collected_at, generatedAt) || generatedAt;
}

function buildOpportunityMemoryIntelligenceSummary({ records = [], generatedAt, dataMode } = {}) {
  const byVessel = new Map();
  for (const record of records) {
    const score = salesPriorityScore(record);
    if (score < 45 && !isSalesCandidate(record) && repeatCallerVisitCount(record, 90) < 1) continue;
    const key = opportunityMemoryIdentityKey(record);
    const counts = opportunityMemoryCounts(record);
    const current = byVessel.get(key) || {
      key,
      record,
      labels: new Set(),
      hot_count_30d: 0,
      hot_count_90d: 0,
      warm_count_90d: 0,
      target_count_90d: 0,
      last_hot_at: null,
      best_score: 0
    };
    current.hot_count_30d = Math.max(current.hot_count_30d, counts.hot_count_30d);
    current.hot_count_90d = Math.max(current.hot_count_90d, counts.hot_count_90d);
    current.warm_count_90d = Math.max(current.warm_count_90d, counts.warm_count_90d);
    current.target_count_90d = Math.max(current.target_count_90d, counts.target_count_90d);
    current.labels.add(salesPriorityBand(score));
    for (const label of (Array.isArray(record.previous_priority_labels) ? record.previous_priority_labels : [])) current.labels.add(label);
    const lastHot = opportunityMemoryLastHotAt(record, generatedAt);
    if (lastHot && (!current.last_hot_at || String(lastHot) > String(current.last_hot_at))) current.last_hot_at = lastHot;
    if (score > current.best_score) {
      current.best_score = score;
      current.record = record;
    }
    byVessel.set(key, current);
  }
  const vesselItems = [...byVessel.values()]
    .map(row => {
      const repeatTargetScore = Math.min(100, Math.round(row.best_score * 0.55 + row.hot_count_90d * 14 + row.warm_count_90d * 7 + row.target_count_90d * 4 + repeatCallerVisitCount(row.record, 90) * 5));
      return compactVesselInsight(row.record, 0, {
        hot_count_30d: row.hot_count_30d,
        hot_count_90d: row.hot_count_90d,
        warm_count_90d: row.warm_count_90d,
        target_count_90d: row.target_count_90d,
        previous_priority_labels: [...row.labels].filter(Boolean),
        last_hot_at: row.last_hot_at,
        repeat_target_score: repeatTargetScore,
        opportunity_score: row.best_score,
        reason_summary: `최근 90일 대상 신호 ${row.target_count_90d}회, HOT ${row.hot_count_90d}회, WARM ${row.warm_count_90d}회`,
        recommended_action: repeatTargetScore >= 70 ? "반복 영업 기회로 보고 선사/대리점 접점을 우선 재확인" : "다음 입항과 연락 가능성을 모니터링"
      });
    })
    .sort((a, b) => Number(b.repeat_target_score || 0) - Number(a.repeat_target_score || 0) || Number(b.opportunity_score || 0) - Number(a.opportunity_score || 0))
    .slice(0, 10)
    .map((item, index) => ({ ...item, rank: index + 1 }));
  const byOperator = new Map();
  for (const item of vesselItems) {
    const operator = operatorFleetName({ ...item, ...(item.vessel_display || {}) });
    const current = byOperator.get(operator) || { operator_name: operator, hot_vessels_90d: 0, target_vessels_90d: 0, repeat_target_count: 0, score_total: 0 };
    current.hot_vessels_90d += Number(item.hot_count_90d || 0) > 0 ? 1 : 0;
    current.target_vessels_90d += Number(item.target_count_90d || 0) > 0 ? 1 : 0;
    current.repeat_target_count += Number(item.target_count_90d || 0) >= 2 || Number(item.hot_count_90d || 0) > 0 ? 1 : 0;
    current.score_total += Number(item.repeat_target_score || 0);
    byOperator.set(operator, current);
  }
  const operatorItems = [...byOperator.values()]
    .map(row => ({
      operator_name: row.operator_name,
      hot_vessels_90d: row.hot_vessels_90d,
      target_vessels_90d: row.target_vessels_90d,
      repeat_target_count: row.repeat_target_count,
      repeat_opportunity_score: row.target_vessels_90d ? Math.round(row.score_total / row.target_vessels_90d) : 0,
      recommended_sales_angle: row.hot_vessels_90d ? "반복 HOT 선박을 묶어 선대 단위 후속 연락" : "반복 대상 선박의 다음 입항 전 연락 경로 확인"
    }))
    .sort((a, b) => Number(b.repeat_opportunity_score || 0) - Number(a.repeat_opportunity_score || 0))
    .slice(0, 10);
  return intelligenceEnvelope({
    generatedAt,
    dataMode,
    sourceTable: "opportunity_master,commercial_opportunity_daily,sales_candidates_current,immediate_targets_current,risk_history,vessel_snapshot_daily,vessel_visits",
    items: vesselItems,
    summary: {
      vessels: vesselItems,
      operators: operatorItems,
      operator_count: operatorItems.length
    },
    extra: { operators: operatorItems }
  });
}

function buildFleetDnaIntelligenceSummary({ records = [], fleetOpportunities = [], generatedAt, dataMode } = {}) {
  const fleet = buildFleetIntelligenceSummary({ records, fleetOpportunities, generatedAt, dataMode }).items;
  const items = fleet.map((row, index) => {
    const dna = row.fleet_dna || buildFleetDnaObject(row);
    const tendency = Array.isArray(dna.commercial_tendency) ? dna.commercial_tendency[0] : firstNonEmpty(row.commercial_tendency, "관계 형성 후보");
    return {
      rank: index + 1,
      operator_name: row.operator_name,
      fleet_profile: row.fleet_profile || (Array.isArray(dna.commercial_tendency) ? dna.commercial_tendency.join(", ") : tendency),
      preferred_ports: dna.preferred_ports || row.top_ports || [],
      average_stay_days: dna.average_stay_days || row.average_stay_days || 0,
      repeat_visit_frequency: dna.repeat_visit_frequency || row.repeat_visit_frequency || 0,
      common_vessel_types: dna.common_vessel_types || row.common_vessel_types || [],
      compliance_exposure_tags: dna.compliance_exposure_tags || row.compliance_exposure_tags || [],
      congestion_exposure: row.congestion_exposure || 0,
      commercial_tendency: tendency,
      opportunity_score: row.opportunity_score,
      recommended_sales_strategy: tendency === "장기체류형"
        ? "체류/작업 가능 시간 중심으로 항만 대리점 접촉"
        : tendency === "반복입항형"
          ? "반복 입항 이력을 근거로 정기 점검/세척 제안"
          : tendency === "Compliance 노출형"
            ? "Biofouling compliance 각도로 선제 확인"
            : tendency === "에이전트 확인 필요"
              ? "에이전트/운영사 확인 큐를 먼저 처리"
              : "선대별 상위 후보와 항만 패턴을 묶어 관계 구축",
      reason_summary: `${row.operator_name}: ${row.fleet_profile || tendency}`,
      recommended_action: "선대 DNA에 맞춰 메시지 각도와 접촉 우선순위를 조정"
    };
  });
  return intelligenceEnvelope({ generatedAt, dataMode, sourceTable: "fleet-intelligence,operator_snapshot_daily,vessel_visits,route_snapshot_daily,operator-opportunities", items });
}

const COMPLIANCE_EXPOSURE_REGIONS = [
  { name: "Brazil", pattern: /brazil|brasil|브라질/i },
  { name: "Australia", pattern: /australia|australian|호주/i },
  { name: "New Zealand", pattern: /new zealand|\bnz\b|뉴질랜드/i },
  { name: "California", pattern: /california|los angeles|long beach|oakland|캘리포니아/i },
  { name: "Canada", pattern: /canada|vancouver|montreal|캐나다/i }
];

function complianceExposureText(record = {}) {
  return [
    record.destination_country,
    record.destination,
    record.destination_port,
    record.next_port,
    record.previous_port,
    record.route_region,
    record.route_name,
    record.route_pattern,
    record.route_summary,
    record.trade_pattern,
    record.compliance_tag,
    record.compliance_tags,
    record.compliance_band,
    record.reason_summary,
    record.why_now,
    record.recommended_action,
    record.data_sources
  ].flat().filter(Boolean).join(" ");
}

function complianceExposureRegions(record = {}) {
  const text = complianceExposureText(record);
  const country = complianceCountry(record);
  const regions = new Set(country ? [country] : []);
  for (const region of COMPLIANCE_EXPOSURE_REGIONS) {
    if (region.pattern.test(text)) regions.add(region.name);
  }
  return [...regions];
}

function complianceRouteSignal(record = {}) {
  const regions = complianceExposureRegions(record);
  if (regions.length) return `${regions.join(", ")} route/destination signal`;
  if (regulatedRouteSignal(record) || record.compliance_watch || /biosecurity|biofouling|compliance/i.test(complianceExposureText(record))) return "biofouling compliance route/history signal";
  return "route signal not confirmed";
}

function buildComplianceExposureIntelligenceSummary({ records = [], generatedAt, dataMode } = {}) {
  const items = records
    .map((record, index) => {
      const regions = complianceExposureRegions(record);
      const risk = recordRiskScore(record);
      const opportunity = salesPriorityScore(record);
      const pressure = firstFiniteNumber(record.compliance_pressure_score, record.compliance_score, regions.length ? 45 : 0, 0) || 0;
      const complianceScore = Math.min(100, Math.round(
        Math.min(45, regions.length * 22) +
        Math.min(20, pressure) +
        Math.min(20, risk * 0.25) +
        Math.min(15, opportunity * 0.15) +
        Math.min(10, dwellDays(record) * 1.5) +
        (regulatedRouteSignal(record) || record.compliance_watch ? 10 : 0)
      ));
      return compactVesselInsight(record, index, {
        exposure_tags: regions.length ? regions : ["Biofouling commercial watch"],
        compliance_score: complianceScore,
        risk_score: risk,
        risk_level: operationalRiskLevel(Math.max(risk, complianceScore)),
        route_signal: complianceRouteSignal(record),
        commercial_compliance_signal: "Commercial compliance signal",
        confidence_score: firstFiniteNumber(record.data_confidence_score, record.confidence_score, record.contact_readiness_score, regions.length ? 70 : 45, 0) || 0,
        reason_summary: `${regions.length ? regions.join(", ") : "Biofouling"} 항로/목적지/이력 신호 기반 상업 compliance 노출도입니다. 법률 위반 판단이 아닙니다.`,
        recommended_action: "목적지와 출항 전 선저관리 필요 여부를 상업 기회 관점에서 확인",
        data_sources: displaySources(record).length ? displaySources(record) : ["risk_history", "route_snapshot_daily", "opportunity_master", "explainability_snapshots"]
      });
    })
    .filter(item => Number(item.compliance_score || 0) >= 45 || (item.exposure_tags || []).some(tag => COMPLIANCE_EXPOSURE_REGIONS.some(region => region.name === tag)))
    .sort((a, b) => Number(b.compliance_score || 0) - Number(a.compliance_score || 0) || Number(b.risk_score || 0) - Number(a.risk_score || 0))
    .slice(0, 20)
    .map((item, index) => ({ ...item, rank: index + 1 }));
  return intelligenceEnvelope({
    generatedAt,
    dataMode,
    sourceTable: "compliance-opportunities,biofouling-risk,risk_history,route_snapshot_daily,opportunity_master,explainability_snapshots",
    items,
    summary: { disclaimer: "Commercial compliance signal only. Not legal advice and not a violation finding." }
  });
}

function contactHistoryCounts(record = {}) {
  return {
    previous_contacts: firstFiniteNumber(record.previous_contacts, record.contact_count, record.outreach_count, record.followup_count, record.sales_action_count, 0) || 0,
    previous_quotes: firstFiniteNumber(record.previous_quotes, record.quote_count, record.quoted_count, 0) || 0,
    previous_wins: firstFiniteNumber(record.previous_wins, record.win_count, record.won_count, 0) || 0,
    last_contacted_at: firstNonEmpty(record.last_contacted_at, record.last_contact_at, record.follow_up_due, record.contacted_at) || null
  };
}

function relationshipEntityName(record = {}, type = "OPERATOR") {
  if (type === "AGENT") return firstNonEmpty(record.local_agent, record.agent_name, record.agent, record.satmntEntrpsNm, record.entrpsCdNm, "미확인 에이전트");
  if (type === "VESSEL") return firstNonEmpty(record.vessel_name, record.name, record.ship_name, "선명 확인 필요");
  return operatorFleetName(record);
}

function buildRelationshipRows(records = [], type = "OPERATOR") {
  const byEntity = new Map();
  for (const record of records) {
    const entityName = relationshipEntityName(record, type);
    const key = `${type}|${entityName}`;
    const current = byEntity.get(key) || {
      entity_type: type,
      entity_name: entityName,
      vesselKeys: new Set(),
      hot_targets_count: 0,
      previous_contacts: 0,
      previous_quotes: 0,
      previous_wins: 0,
      last_contacted_at: null,
      score_total: 0,
      risk_total: 0,
      top_record: null
    };
    const score = salesPriorityScore(record);
    const risk = recordRiskScore(record);
    const contact = contactHistoryCounts(record);
    current.vesselKeys.add(opportunityMemoryIdentityKey(record));
    current.hot_targets_count += salesPriorityBand(score) === "HOT" || score >= 75 ? 1 : 0;
    current.previous_contacts += contact.previous_contacts;
    current.previous_quotes += contact.previous_quotes;
    current.previous_wins += contact.previous_wins;
    if (contact.last_contacted_at && (!current.last_contacted_at || String(contact.last_contacted_at) > String(current.last_contacted_at))) current.last_contacted_at = contact.last_contacted_at;
    current.score_total += score;
    current.risk_total += risk;
    if (!current.top_record || score > salesPriorityScore(current.top_record)) current.top_record = record;
    byEntity.set(key, current);
  }
  return [...byEntity.values()].map(row => {
    const relatedCount = row.vesselKeys.size;
    const averageScore = relatedCount ? Math.round(row.score_total / relatedCount) : 0;
    const relationshipScore = Math.min(100, Math.round(
      averageScore * 0.45 +
      row.hot_targets_count * 10 +
      relatedCount * 4 +
      row.previous_contacts * 8 +
      row.previous_quotes * 12 +
      row.previous_wins * 20
    ));
    return withVesselDisplay({
      entity_type: row.entity_type,
      entity_name: row.entity_name,
      related_vessels_count: relatedCount,
      hot_targets_count: row.hot_targets_count,
      previous_contacts: row.previous_contacts,
      previous_quotes: row.previous_quotes,
      previous_wins: row.previous_wins,
      last_contacted_at: row.last_contacted_at,
      relationship_score: relationshipScore,
      opportunity_score: averageScore,
      vessel_display: row.top_record ? vesselDisplay(row.top_record) : undefined,
      reason_summary: `${row.entity_name}: 관련 선박 ${relatedCount}척, HOT ${row.hot_targets_count}척, 기존 접촉 ${row.previous_contacts}건`,
      recommended_next_action: row.previous_contacts > 0 ? "기존 접점 이력을 확인하고 HOT/WARM 후보 후속 연락" : "연락 이력은 없지만 현재 기회 신호 기준으로 접점 확인",
      recommended_action: row.previous_contacts > 0 ? "기존 접점 이력을 확인하고 HOT/WARM 후보 후속 연락" : "연락 이력은 없지만 현재 기회 신호 기준으로 접점 확인"
    });
  });
}

function buildRelationshipIntelligenceSummary({ records = [], generatedAt, dataMode } = {}) {
  const items = [
    ...buildRelationshipRows(records, "OPERATOR"),
    ...buildRelationshipRows(records, "AGENT"),
    ...buildRelationshipRows(sortCommercialPriority(records).slice(0, 100), "VESSEL")
  ]
    .filter(item => Number(item.relationship_score || 0) > 0 || Number(item.hot_targets_count || 0) > 0)
    .sort((a, b) => Number(b.relationship_score || 0) - Number(a.relationship_score || 0) || Number(b.hot_targets_count || 0) - Number(a.hot_targets_count || 0))
    .slice(0, 20)
    .map((item, index) => ({ ...item, rank: index + 1 }));
  return intelligenceEnvelope({ generatedAt, dataMode, sourceTable: "operator_contact_history,commercial_leads,sales-pipeline,sales/actions,agent-followup-queue,fleet-memory", items });
}

function buildCustomerMemoryIntelligenceSummary({ records = [], fleetOpportunities = [], generatedAt, dataMode } = {}) {
  const operatorSignals = new Map(aggregateOperators(records, fleetOpportunities).map(row => [row.operator_name, row]));
  const byCustomer = new Map();
  for (const record of records) {
    const operator = operatorFleetName(record);
    const agent = firstNonEmpty(record.local_agent, record.agent_name, record.agent, record.satmntEntrpsNm, record.entrpsCdNm);
    const customerName = operator && operator !== "미확인 운영사" ? operator : firstNonEmpty(agent, "미확인 고객");
    const customerType = operator && operator !== "미확인 운영사" ? "OPERATOR" : agent ? "AGENT" : "UNKNOWN";
    const key = `${customerType}|${customerName}`;
    const current = byCustomer.get(key) || {
      customer_type: customerType,
      customer_name: customerName,
      operator_name: operator && operator !== "미확인 운영사" ? operator : null,
      agent_name: agent || null,
      vesselKeys: new Set(),
      ports: new Map(),
      contact_attempts: 0,
      quote_history_count: 0,
      quote_value_record_count: 0,
      quote_result_count: 0,
      won_projects: 0,
      lost_projects: 0,
      operation_completed_count: 0,
      customer_feedback_count: 0,
      repeat_caller_count: 0,
      hot_count: 0,
      warm_count: 0,
      score_total: 0,
      risk_total: 0,
      latest_contact_at: null,
      latest_quote_at: null,
      latest_feedback_at: null,
      last_seen: null,
      top_record: null,
      top_vessels: []
    };
    const contact = contactHistoryCounts(record);
    const stage = leadConversionStage(record);
    const score = salesPriorityScore(record);
    const risk = recordRiskScore(record);
    const priority = String(firstNonEmpty(record.priority_label, record.sales_priority_band, salesPriorityBand(score))).toUpperCase();
    const contactAttemptCount = Math.max(privateActivityCount(record, "contact_attempt"), contact.previous_contacts);
    const quoteSentCount = Math.max(privateActivityCount(record, "quote_sent"), contact.previous_quotes);
    const quoteValueCount = privateActivityCount(record, "quote_value");
    const quoteResultCount = privateActivityCount(record, "quote_result");
    const wonCount = Math.max(privateActivityCount(record, "won"), contact.previous_wins, stage === "WON" ? 1 : 0);
    const lostCount = Math.max(privateActivityCount(record, "lost"), stage === "LOST" ? 1 : 0);
    const operationCompletedCount = privateActivityCount(record, "operation_completed");
    const feedbackCount = privateActivityCount(record, "customer_feedback");
    current.vesselKeys.add(opportunityMemoryIdentityKey(record));
    current.contact_attempts += contactAttemptCount;
    current.quote_history_count += quoteSentCount;
    current.quote_value_record_count += quoteValueCount;
    current.quote_result_count += quoteResultCount;
    current.won_projects += wonCount;
    current.lost_projects += lostCount;
    current.operation_completed_count += operationCompletedCount;
    current.customer_feedback_count += feedbackCount;
    current.repeat_caller_count += repeatCallerVisitCount(record, 365) >= 2 || Number(record.repeat_caller_score || 0) > 0 ? 1 : 0;
    current.hot_count += priority === "HOT" || score >= 75 ? 1 : 0;
    current.warm_count += priority === "WARM" || (score >= 50 && score < 75) ? 1 : 0;
    current.score_total += score;
    current.risk_total += risk;
    const port = recordPortName(record);
    current.ports.set(port, (current.ports.get(port) || 0) + 1);
    for (const [field, target, count] of [
      ["contact_attempt", "latest_contact_at", contactAttemptCount],
      ["quote_sent", "latest_quote_at", quoteSentCount + quoteValueCount + quoteResultCount],
      ["customer_feedback", "latest_feedback_at", feedbackCount]
    ]) {
      if (count <= 0) continue;
      const timestamp = privateActivityTimestamp(record, field);
      if (timestamp && (!current[target] || timestamp > current[target])) current[target] = timestamp;
    }
    const seen = firstNonEmpty(record.last_seen_at, record.updated_at, record.collected_at, record.generated_at);
    if (seen && (!current.last_seen || String(seen) > String(current.last_seen))) current.last_seen = seen;
    if (!current.top_record || score > salesPriorityScore(current.top_record)) current.top_record = record;
    current.top_vessels.push({
      vessel_name: firstNonEmpty(record.vessel_name, record.name, record.ship_name, record.vessel_display?.vessel_name, "선명 확인 필요"),
      imo: firstNonEmpty(record.imo, record.imo_no, record.vessel_display?.imo, "-"),
      port,
      opportunity_score: score,
      priority_label: priority || salesPriorityBand(score)
    });
    byCustomer.set(key, current);
  }
  const items = [...byCustomer.values()]
    .map(row => {
      const vesselsSeen = row.vesselKeys.size;
      const averageOpportunity = vesselsSeen ? Math.round(row.score_total / vesselsSeen) : 0;
      const averageRisk = vesselsSeen ? Math.round(row.risk_total / vesselsSeen) : 0;
      const existingOperator = row.operator_name ? operatorSignals.get(row.operator_name) : null;
      const relationshipScore = existingOperator?.relationship_score || Math.min(100, Math.round(
        row.contact_attempts * 6 +
        row.quote_history_count * 10 +
        row.won_projects * 22 +
        row.customer_feedback_count * 8 +
        row.repeat_caller_count * 6 +
        row.hot_count * 5 +
        vesselsSeen * 3
      ));
      const memoryScore = Math.min(100, Math.round(
        averageOpportunity * 0.26 +
        averageRisk * 0.10 +
        relationshipScore * 0.32 +
        Math.min(100, row.contact_attempts * 7 + row.quote_history_count * 10 + row.won_projects * 20 + row.customer_feedback_count * 8) * 0.22 +
        Math.min(100, vesselsSeen * 6 + row.repeat_caller_count * 10) * 0.10
      ));
      const portsUsed = [...row.ports.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([port_name, count]) => ({ port_name, count }));
      return withVesselDisplay({
        customer_type: row.customer_type,
        customer_name: row.customer_name,
        operator_name: row.operator_name || row.customer_name,
        agent_name: row.agent_name,
        contact_attempts: row.contact_attempts,
        quote_history_count: row.quote_history_count,
        quote_value_record_count: row.quote_value_record_count,
        quote_result_count: row.quote_result_count,
        won_projects: row.won_projects,
        lost_projects: row.lost_projects,
        operation_completed_count: row.operation_completed_count,
        customer_feedback_count: row.customer_feedback_count,
        fleet_history: {
          vessels_seen: vesselsSeen,
          repeat_callers: row.repeat_caller_count,
          hot_count: row.hot_count,
          warm_count: row.warm_count,
          ports_used: portsUsed.map(port => port.port_name),
          last_seen: row.last_seen
        },
        vessels_seen: vesselsSeen,
        repeat_caller_count: row.repeat_caller_count,
        hot_count: row.hot_count,
        warm_count: row.warm_count,
        ports_used: portsUsed,
        top_vessels: row.top_vessels
          .sort((a, b) => Number(b.opportunity_score || 0) - Number(a.opportunity_score || 0))
          .slice(0, 5),
        latest_contact_at: row.latest_contact_at,
        latest_quote_at: row.latest_quote_at,
        latest_feedback_at: row.latest_feedback_at,
        last_seen: row.last_seen,
        relationship_score: relationshipScore,
        average_opportunity_score: averageOpportunity,
        average_risk_score: averageRisk,
        customer_memory_score: memoryScore,
        opportunity_score: Math.max(memoryScore, averageOpportunity),
        sensitive_details_exposed: false,
        vessel_display: row.top_record ? vesselDisplay(row.top_record) : undefined,
        reason_summary: `${row.customer_name}: 선대 ${vesselsSeen}척, 연락 ${row.contact_attempts}건, 견적 ${row.quote_history_count}건, 수주 ${row.won_projects}건, 실주 ${row.lost_projects}건`,
        recommended_action: row.won_projects > 0
          ? "기존 수주 이력을 바탕으로 반복 입항/선대 확장 제안을 준비"
          : row.quote_history_count > 0
            ? "견적 이력과 현재 HOT/WARM 후보를 묶어 후속 연락"
            : row.contact_attempts > 0
              ? "기존 접촉 이력을 확인하고 현재 기회 선박으로 재접촉"
              : "현재 기회 신호를 기반으로 최초 고객 접점과 담당 창구를 확인",
        data_sources: ["commercial_leads", "operator_contact_history", "sales-pipeline", "relationship-intelligence", "fleet-memory"]
      });
    })
    .filter(item => Number(item.customer_memory_score || 0) > 0 || Number(item.vessels_seen || 0) > 0)
    .sort((a, b) =>
      Number(b.customer_memory_score || 0) - Number(a.customer_memory_score || 0) ||
      Number(b.won_projects || 0) - Number(a.won_projects || 0) ||
      Number(b.quote_history_count || 0) - Number(a.quote_history_count || 0) ||
      Number(b.vessels_seen || 0) - Number(a.vessels_seen || 0)
    )
    .slice(0, 20)
    .map((item, index) => ({ ...item, rank: index + 1 }));
  return intelligenceEnvelope({
    generatedAt,
    dataMode,
    sourceTable: "commercial_leads,operator_contact_history,sales-pipeline,relationship-intelligence,fleet-memory",
    items,
    summary: {
      proprietary_commercial_memory: true,
      sensitive_details_exposed: false,
      public_snapshot: "aggregated customer memory only",
      tracked_signals: ["contact_attempts", "quote_history", "won_projects", "lost_projects", "customer_feedback", "fleet_history"]
    }
  });
}

function daysSinceValue(value, generatedAt = new Date().toISOString()) {
  const date = parseScheduleTime(value);
  const base = parseScheduleTime(generatedAt) || new Date();
  if (!date || Number.isNaN(date.getTime()) || !base || Number.isNaN(base.getTime())) return null;
  return Math.max(0, Math.round(((base.getTime() - date.getTime()) / 86400000) * 10) / 10);
}

function firstOpportunitySeenAt(record = {}) {
  return firstNonEmpty(record.first_hot_at, record.hot_first_seen_at, record.first_target_at, record.first_seen_at, record.ata, record.eta, record.collected_at, record.last_seen_at, record.updated_at, record.generated_at);
}

function buildOpportunityDecayIntelligenceSummary({ records = [], generatedAt, dataMode } = {}) {
  const items = sortCommercialPriority(records)
    .filter(record => salesPriorityScore(record) >= 50 || isSalesCandidate(record))
    .map((record, index) => {
      const opportunity = salesPriorityScore(record);
      const daysSinceFirstHot = daysSinceValue(firstOpportunitySeenAt(record), generatedAt) ?? 0;
      const contact = contactHistoryCounts(record);
      const decayScore = Math.max(0, Math.min(100, Math.round(daysSinceFirstHot * 6 + (opportunity >= 75 ? 18 : 8) - contact.previous_contacts * 12)));
      const urgencyScore = Math.min(100, Math.round(opportunity * 0.55 + decayScore * 0.45));
      return compactVesselInsight(record, index, {
        opportunity_score: opportunity,
        days_since_first_hot: daysSinceFirstHot,
        decay_score: decayScore,
        urgency_score: urgencyScore,
        recommended_action: urgencyScore >= 75 ? "기회 소멸 전에 오늘 연락 경로와 작업 가능 시간을 확인" : "다음 업데이트 전까지 우선순위를 재확인"
      });
    })
    .filter(item => Number(item.decay_score || 0) > 0)
    .sort((a, b) => Number(b.urgency_score || 0) - Number(a.urgency_score || 0) || Number(b.decay_score || 0) - Number(a.decay_score || 0))
    .slice(0, 20)
    .map((item, index) => ({ ...item, rank: index + 1 }));
  return intelligenceEnvelope({ generatedAt, dataMode, sourceTable: "opportunity-memory,sales/actions,sales-pipeline,opportunity_master", items });
}

function buildMissedOpportunityIntelligenceSummary({ records = [], generatedAt, dataMode } = {}) {
  const items = sortCommercialPriority(records)
    .map((record, index) => {
      const counts = opportunityMemoryCounts(record);
      const opportunity = salesPriorityScore(record);
      const contact = contactHistoryCounts(record);
      const daysVisible = daysSinceValue(firstNonEmpty(record.first_seen_at, record.first_target_at, record.collected_at, record.eta, record.ata), generatedAt) ?? 0;
      const hotCount = Math.max(counts.hot_count_90d || 0, salesPriorityBand(opportunity) === "HOT" ? 1 : 0);
      const missedScore = Math.max(0, Math.min(100, Math.round(hotCount * 22 + daysVisible * 4 + opportunity * 0.35 - contact.previous_contacts * 16)));
      return compactVesselInsight(record, index, {
        hot_count: hotCount,
        days_visible: daysVisible,
        contact_count: contact.previous_contacts,
        missed_opportunity_score: missedScore,
        opportunity_score: opportunity,
        reason_summary: `HOT 신호 ${hotCount}회, 노출 ${daysVisible}일, 접촉 ${contact.previous_contacts}건 기준 놓친 기회 위험`,
        recommended_action: missedScore >= 65 ? "놓친 기회 후보로 즉시 연락 이력과 현재 위치를 재확인" : "다음 접촉 우선순위 후보로 유지"
      });
    })
    .filter(item => Number(item.missed_opportunity_score || 0) >= 35)
    .sort((a, b) => Number(b.missed_opportunity_score || 0) - Number(a.missed_opportunity_score || 0) || Number(b.opportunity_score || 0) - Number(a.opportunity_score || 0))
    .slice(0, 20)
    .map((item, index) => ({ ...item, rank: index + 1 }));
  return intelligenceEnvelope({ generatedAt, dataMode, sourceTable: "opportunity-memory,sales-pipeline,relationship-intelligence", items });
}

const LOST_OPPORTUNITY_REASON_LABELS = {
  NO_CONTACT_INFO: "연락 정보 부족",
  TIMING_MISSED: "타이밍 지연",
  LOW_CONFIDENCE: "낮은 신뢰도",
  WRONG_PORT: "항만 불일치",
  VESSEL_DEPARTED: "선박 출항",
  NO_RESPONSE: "무응답",
  PRICE_REJECTED: "가격 거절",
  COMPETITOR_USED: "경쟁사 이용",
  INTERNAL_CAPACITY: "내부 작업 여력 부족"
};

function hasContactIdentity(record = {}) {
  return Boolean(firstNonEmpty(
    record.operator,
    record.operator_name,
    record.owner,
    record.owner_name,
    record.manager,
    record.manager_name,
    record.technical_manager,
    record.agent,
    record.agent_name,
    record.local_agent,
    record.call_sign,
    record.callsign
  ));
}

function lossReasonText(record = {}) {
  return [
    record.loss_reason,
    record.lost_reason,
    record.close_reason,
    record.quote_result,
    record.quote_status,
    record.lead_status,
    record.opportunity_state,
    record.reason_summary,
    record.why_now,
    record.recommended_action,
    record.recommended_next_action,
    record.notes
  ].filter(Boolean).join(" ").toLowerCase();
}

function classifyLostOpportunityReason(record = {}, generatedAt = new Date().toISOString()) {
  const evidence = [];
  const text = lossReasonText(record);
  const opportunity = salesPriorityScore(record);
  const priority = salesPriorityBand(opportunity);
  const contact = contactHistoryCounts(record);
  const daysVisible = daysSinceValue(firstOpportunitySeenAt(record), generatedAt) ?? 0;
  const daysSinceContact = daysSinceValue(contact.last_contacted_at, generatedAt);
  const confidence = firstFiniteNumber(record.data_confidence_score, record.confidence_score, record.candidate_confidence, record.contact_readiness_score, 0) || 0;
  const currentPort = firstNonEmpty(record.port_name, record.port, record.current_port, record.destination_port);
  const expectedPort = firstNonEmpty(record.expected_port, record.target_port, record.recommended_port);

  if (/competitor|competition|other vendor|타사|경쟁/i.test(text)) {
    evidence.push("실패/메모 텍스트에 경쟁사 이용 신호가 있습니다.");
    return { reason: "COMPETITOR_USED", evidence };
  }
  if (/price|cost|expensive|too high|가격|비싸|견적.*거절/i.test(text)) {
    evidence.push("견적/실패 텍스트에 가격 거절 신호가 있습니다.");
    return { reason: "PRICE_REJECTED", evidence };
  }
  if (/capacity|resource|crew unavailable|internal|작업\s*불가|여력|인력|장비/i.test(text)) {
    evidence.push("메모 텍스트에 내부 여력/작업 가능성 부족 신호가 있습니다.");
    return { reason: "INTERNAL_CAPACITY", evidence };
  }
  if (isDepartedRecord(record) || firstNonEmpty(record.atd, record.departure_time, record.departed_at)) {
    evidence.push("출항 상태 또는 ATD/출항 시각이 확인됩니다.");
    return { reason: "VESSEL_DEPARTED", evidence };
  }
  if (expectedPort && currentPort && normalizeVesselName(expectedPort) !== normalizeVesselName(currentPort) && /wrong_port|port_mismatch|항만.*불일치|다른\s*항만/i.test(text)) {
    evidence.push(`기대 항만(${expectedPort})과 현재 항만(${currentPort})이 다릅니다.`);
    return { reason: "WRONG_PORT", evidence };
  }
  if (!hasContactIdentity(record) || Number(record.contact_readiness_score || 0) < 35) {
    evidence.push("운항사/소유주/관리사/대리점/콜사인 등 연락 경로 정보가 부족합니다.");
    return { reason: "NO_CONTACT_INFO", evidence };
  }
  if (/no response|unresponsive|no_reply|무응답|응답\s*없/i.test(text) || (contact.previous_contacts > 0 && daysSinceContact !== null && daysSinceContact >= 3 && !["won", "quoted", "scheduled"].includes(String(record.lead_status || "").toLowerCase()))) {
    evidence.push(`기존 접촉 ${contact.previous_contacts}건 이후 응답/진전 신호가 약합니다.`);
    return { reason: "NO_RESPONSE", evidence };
  }
  if (confidence > 0 && confidence < 45) {
    evidence.push(`데이터 신뢰도 ${Math.round(confidence)}점으로 낮습니다.`);
    return { reason: "LOW_CONFIDENCE", evidence };
  }
  if (daysVisible >= 3 || Number(record.decay_score || 0) >= 60 || Number(record.missed_opportunity_score || 0) >= 60) {
    evidence.push(`${priority} 후보가 ${daysVisible}일 동안 노출되어 영업 타이밍 지연 가능성이 있습니다.`);
    return { reason: "TIMING_MISSED", evidence };
  }
  evidence.push("HOT/WARM 후보이나 명확한 실주 원인이 없어 우선 신뢰도와 연락 경로를 확인해야 합니다.");
  return { reason: confidence < 55 ? "LOW_CONFIDENCE" : "TIMING_MISSED", evidence };
}

function lostOpportunityPrevention(reason) {
  return {
    NO_CONTACT_INFO: "연락처 확인 큐에 올리고 운항사/대리점/기술감독 정보를 먼저 보강",
    TIMING_MISSED: "HOT/WARM 전환 후 당일 연락 SLA와 출항 전 알림을 강화",
    LOW_CONFIDENCE: "IMO/MMSI/항만/ETA 필드를 보강한 뒤 재분류",
    WRONG_PORT: "항만 정규화와 현재항/목적항 검증 후 담당 항만을 재배정",
    VESSEL_DEPARTED: "출항 전 작업 가능 시간 알림과 장기체류/묘박 신호 우선순위를 높임",
    NO_RESPONSE: "대체 연락 경로와 에이전트 follow-up을 병행",
    PRICE_REJECTED: "서비스 범위와 ROI 근거를 보강한 대안 견적을 준비",
    COMPETITOR_USED: "경쟁사 사용 선박을 관계 이력에 저장하고 다음 입항 전 선제 제안",
    INTERNAL_CAPACITY: "작업 리소스 가능 시간과 항만별 대응 여력을 먼저 확인"
  }[reason] || "원인 필드를 확인하고 다음 후보의 예방 액션을 기록";
}

function buildLostOpportunityReasonIntelligenceSummary({ records = [], generatedAt, dataMode } = {}) {
  const source = sortCommercialPriority(records)
    .filter(record => {
      const score = salesPriorityScore(record);
      const label = salesPriorityBand(score);
      const text = lossReasonText(record);
      return ["HOT", "WARM"].includes(label) ||
        isSalesCandidate(record) ||
        /lost|closed|no response|price|competitor|capacity|실주|무응답|거절|경쟁/i.test(text);
    });
  const items = source
    .map((record, index) => {
      const opportunity = salesPriorityScore(record);
      const classified = classifyLostOpportunityReason(record, generatedAt);
      return compactVesselInsight(record, index, {
        opportunity_score: opportunity,
        priority_label: salesPriorityBand(opportunity),
        lost_reason: classified.reason,
        lost_reason_label: LOST_OPPORTUNITY_REASON_LABELS[classified.reason] || classified.reason,
        evidence: classified.evidence,
        reason_summary: `${LOST_OPPORTUNITY_REASON_LABELS[classified.reason] || classified.reason}: ${classified.evidence.join(" ")}`,
        recommended_prevention: lostOpportunityPrevention(classified.reason),
        recommended_action: lostOpportunityPrevention(classified.reason),
        data_sources: displaySources(record).length ? displaySources(record) : ["missed-opportunities", "opportunity-decay", "sales-pipeline", "opportunity-memory"]
      });
    })
    .filter(item => Number(item.opportunity_score || 0) >= 50 || ["NO_RESPONSE", "PRICE_REJECTED", "COMPETITOR_USED", "INTERNAL_CAPACITY", "VESSEL_DEPARTED"].includes(item.lost_reason))
    .sort((a, b) => Number(b.opportunity_score || 0) - Number(a.opportunity_score || 0) || String(a.lost_reason || "").localeCompare(String(b.lost_reason || "")))
    .slice(0, 20)
    .map((item, index) => ({ ...item, rank: index + 1 }));
  const reason_counts = Object.fromEntries(Object.keys(LOST_OPPORTUNITY_REASON_LABELS).map(reason => [reason, items.filter(item => item.lost_reason === reason).length]));
  return intelligenceEnvelope({
    generatedAt,
    dataMode,
    sourceTable: "missed-opportunities,opportunity-decay,sales-pipeline,opportunity-memory",
    items,
    summary: { reason_counts },
    extra: { reason_counts }
  });
}

function buildWinProbabilityIntelligenceSummary({ records = [], fleetOpportunities = [], portStatistics = {}, generatedAt, dataMode } = {}) {
  const relationshipItems = buildRelationshipIntelligenceSummary({ records, generatedAt, dataMode }).items || [];
  const revenueSummary = buildRevenueForecastIntelligenceSummary({ records, fleetOpportunities, portStatistics, generatedAt, dataMode });
  const revenueRows = revenueSummary?.by_operator || revenueSummary?.extra?.by_operator || [];
  const maxRevenue = Math.max(1, ...revenueRows.map(row => Number(row.expected_revenue || 0)));
  const revenueByOperator = new Map(revenueRows.map(row => [String(row.operator_name || "").toLowerCase(), row]));
  const relationshipByEntity = new Map();
  for (const item of relationshipItems) {
    const key = String(item.entity_name || item.operator_name || item.vessel_name || "").toLowerCase();
    if (key && (!relationshipByEntity.has(key) || Number(item.relationship_score || 0) > Number(relationshipByEntity.get(key)?.relationship_score || 0))) {
      relationshipByEntity.set(key, item);
    }
  }

  const source = dedupeCandidateRows(sortCommercialPriority(records).filter(record => salesPriorityScore(record) >= 45 || isSalesCandidate(record)));
  const items = source
    .map((record, index) => {
      const operatorName = operatorFleetName(record);
      const vesselName = firstNonEmpty(record.vessel_name, record.name, record.ship_name);
      const relationshipRow = relationshipByEntity.get(String(operatorName || "").toLowerCase()) || relationshipByEntity.get(String(vesselName || "").toLowerCase());
      const revenueRow = revenueByOperator.get(String(operatorName || "").toLowerCase());
      const opportunityScore = salesPriorityScore(record);
      const contact = contactHistoryCounts(record);
      const memory = opportunityMemoryCounts(record);
      const confidenceScore = firstFiniteNumber(record.contact_readiness_score, record.data_confidence_score, record.confidence_score, record.candidate_confidence, 45, 0) || 0;
      const relationshipScore = firstFiniteNumber(
        relationshipRow?.relationship_score,
        record.relationship_score,
        Math.min(100, contact.previous_contacts * 12 + contact.previous_quotes * 18 + contact.previous_wins * 25 + repeatCallerVisitCount(record, 90) * 8),
        0
      ) || 0;
      const revenueScore = revenueRow ? Math.round((Number(revenueRow.expected_revenue || 0) / maxRevenue) * 100) : 0;
      const hasPort = Boolean(firstNonEmpty(record.port_name, record.port, record.current_port, record.destination_port));
      const hasEta = Boolean(firstNonEmpty(record.eta, record.etb, record.arrival_time, record.expected_arrival_at));
      const hasContactPath = Boolean(firstNonEmpty(record.operator, record.owner, record.manager, record.local_agent, record.agent_name, record.call_sign));
      const priorityBoost = salesPriorityBand(opportunityScore) === "HOT" ? 20 : salesPriorityBand(opportunityScore) === "WARM" ? 10 : 0;
      const actionabilityScore = Math.min(100, Math.round(
        (hasPort ? 22 : 0) +
        (hasEta ? 14 : 0) +
        (hasContactPath ? 22 : 0) +
        Math.min(22, Number(record.contact_readiness_score || 0) * 0.22) +
        priorityBoost +
        Math.min(20, repeatCallerVisitCount(record, 90) * 5)
      ));
      const repeatScore = Math.min(100, (memory.hot_count_90d || 0) * 22 + (memory.warm_count_90d || 0) * 10 + (memory.target_count_90d || 0) * 6);
      const winProbability = Math.min(95, Math.max(5, Math.round(
        opportunityScore * 0.36 +
        relationshipScore * 0.22 +
        actionabilityScore * 0.18 +
        confidenceScore * 0.12 +
        revenueScore * 0.07 +
        repeatScore * 0.05
      )));
      return compactVesselInsight(record, index, {
        win_probability: winProbability,
        confidence_score: Math.round(confidenceScore),
        relationship_score: Math.round(relationshipScore),
        opportunity_score: opportunityScore,
        actionability_score: actionabilityScore,
        reason_summary: `기회 ${opportunityScore}점, 관계 ${Math.round(relationshipScore)}점, 실행가능성 ${actionabilityScore}점 기준 Experimental 수주 가능성`,
        recommended_action: winProbability >= 70 ? "수주 가능성 상위 후보로 연락 경로와 제안 각도를 즉시 확인" : "관계/연락처 보강 후 후속 영업 후보로 관리"
      });
    })
    .filter(item => Number(item.win_probability || 0) >= 20)
    .sort((a, b) => Number(b.win_probability || 0) - Number(a.win_probability || 0) || Number(b.opportunity_score || 0) - Number(a.opportunity_score || 0))
    .slice(0, 20)
    .map((item, index) => ({ ...item, rank: index + 1 }));
  return intelligenceEnvelope({
    generatedAt,
    dataMode,
    sourceTable: "relationship-intelligence,sales-pipeline,revenue-forecast,opportunity-memory,opportunity_master",
    items,
    summary: { label: "Experimental", disclaimer: "Operational sales probability signal only. Not a guaranteed win forecast." }
  });
}

function recordMonthIndex(record = {}, generatedAt = new Date().toISOString()) {
  const value = firstNonEmpty(record.snapshot_date, record.visit_date, record.collected_at, record.generated_at, record.eta, record.ata, generatedAt);
  const date = parseScheduleTime(value);
  return date && !Number.isNaN(date.getTime()) ? date.getMonth() : (new Date(generatedAt).getMonth() || 0);
}

function buildPortSeasonalityIntelligenceSummary({ records = [], generatedAt, dataMode } = {}) {
  const byPort = new Map();
  for (const record of records) {
    const port = recordPortName(record);
    const month = recordMonthIndex(record, generatedAt);
    const current = byPort.get(port) || {
      port_name: port,
      months: Array.from({ length: 12 }, (_, index) => ({ month: index + 1, opportunity_count: 0, score_total: 0 }))
    };
    const score = salesPriorityScore(record);
    if (score >= 45 || isSalesCandidate(record)) {
      current.months[month].opportunity_count += 1;
      current.months[month].score_total += score;
    }
    byPort.set(port, current);
  }
  const items = [...byPort.values()]
    .map(row => {
      const monthlyTrend = row.months.map(month => ({
        month: month.month,
        opportunity_count: month.opportunity_count,
        average_opportunity_score: month.opportunity_count ? Math.round(month.score_total / month.opportunity_count) : 0
      }));
      const active = monthlyTrend.filter(month => month.opportunity_count > 0);
      const max = active.length ? Math.max(...active.map(month => month.opportunity_count)) : 0;
      const min = active.length > 1 ? Math.min(...active.map(month => month.opportunity_count)) : 0;
      const seasonalityScore = active.length > 1 && max ? Math.min(100, Math.round(((max - min) / Math.max(1, max)) * 100)) : 0;
      return {
        port_name: row.port_name,
        monthly_opportunity_trend: monthlyTrend,
        seasonality_score: seasonalityScore,
        opportunity_score: seasonalityScore,
        peak_months: monthlyTrend.filter(month => month.opportunity_count === max && max > 0).map(month => month.month),
        low_months: monthlyTrend.filter(month => active.length > 1 && month.opportunity_count === min).map(month => month.month),
        reason_summary: active.length > 1
          ? `${row.port_name}: 월별 기회 피크 ${max}건, 계절성 점수 ${seasonalityScore}점`
          : `${row.port_name}: 현재 월 기회 ${max}건, 계절성 판단에는 추가 이력이 필요합니다.`,
        recommended_action: "피크 월 전 선사/대리점 접촉 계획과 항만별 작업 리소스를 준비"
      };
    })
    .filter(item => item.peak_months.length)
    .sort((a, b) => Number(b.seasonality_score || 0) - Number(a.seasonality_score || 0) || Number(b.monthly_opportunity_trend?.reduce((sum, month) => sum + month.opportunity_count, 0) || 0) - Number(a.monthly_opportunity_trend?.reduce((sum, month) => sum + month.opportunity_count, 0) || 0))
    .slice(0, 20)
    .map((item, index) => ({ ...item, rank: index + 1 }));
  return intelligenceEnvelope({ generatedAt, dataMode, sourceTable: "vessel_visits,port_snapshot_daily,opportunity_master", items });
}

function buildFleetHeatmapIntelligenceSummary({ records = [], fleetOpportunities = [], portStatistics = {}, generatedAt, dataMode } = {}) {
  const fleetRows = buildFleetIntelligenceSummary({ records, fleetOpportunities, generatedAt, dataMode }).items;
  const revenueRows = buildRevenueForecastIntelligenceSummary({ records, fleetOpportunities, portStatistics, generatedAt, dataMode })?.extra?.by_operator || [];
  const maxRevenue = Math.max(1, ...revenueRows.map(row => Number(row.expected_revenue || 0)));
  const revenueByOperator = new Map(revenueRows.map(row => [String(row.operator_name || "").toLowerCase(), row]));
  const items = fleetRows.map((row, index) => {
    const revenue = revenueByOperator.get(String(row.operator_name || "").toLowerCase());
    const revenueScore = revenue ? Math.round((Number(revenue.expected_revenue || 0) / maxRevenue) * 100) : Math.min(100, Number(row.hot_count || 0) * 18 + Number(row.warm_count || 0) * 8);
    const relationshipScore = firstFiniteNumber(row.relationship_score, row.fleet_dna?.relationship_score, Math.min(100, Number(row.repeat_caller_count || 0) * 12 + Number(row.fleet_size_korea || row.vessel_count || 0) * 4), 0) || 0;
    const heatScore = Math.min(100, Math.round(
      Number(row.opportunity_score || row.average_opportunity_score || 0) * 0.35 +
      revenueScore * 0.2 +
      Number(row.repeat_caller_count || 0) * 5 +
      Number(row.compliance_exposure_count || 0) * 5 +
      relationshipScore * 0.2
    ));
    return {
      rank: index + 1,
      operator_name: row.operator_name,
      opportunity_score: Math.round(Number(row.opportunity_score || row.average_opportunity_score || 0)),
      revenue_score: revenueScore,
      repeat_caller_score: Math.min(100, Number(row.repeat_caller_count || 0) * 12),
      compliance_score: Math.min(100, Number(row.compliance_exposure_count || 0) * 15),
      relationship_score: relationshipScore,
      heatmap_score: heatScore,
      reason_summary: `${row.operator_name}: 기회 ${Math.round(Number(row.opportunity_score || 0))}, 매출 ${revenueScore}, 반복 ${Number(row.repeat_caller_count || 0)}, compliance ${Number(row.compliance_exposure_count || 0)}`,
      recommended_action: heatScore >= 70 ? "선대 단위 핵심 영업 대상으로 우선 접촉" : "선대 기회 신호를 모니터링하며 상위 선박부터 접촉"
    };
  })
    .sort((a, b) => Number(b.heatmap_score || 0) - Number(a.heatmap_score || 0))
    .slice(0, 20)
    .map((item, index) => ({ ...item, rank: index + 1 }));
  return intelligenceEnvelope({ generatedAt, dataMode, sourceTable: "fleet-intelligence,revenue-forecast,operator-opportunities", items });
}

function buildIntelligenceSummaries({
  records = [],
  candidateList = [],
  salesCandidates = [],
  immediateTargets = [],
  topCandidates = {},
  arrivalPipeline = [],
  predictedCleaningOpportunities = [],
  fleetOpportunities = [],
  commercialCommandCenter = {},
  scoringDiagnostics = {},
  operatorDiagnostics = {},
  predictionDiagnostics = {},
  portStatistics = {},
  generatedAt = new Date().toISOString(),
  dataMode = "unknown"
} = {}) {
  return {
    "risk-summary": buildRiskIntelligenceSummary({ records, scoringDiagnostics, generatedAt, dataMode }),
    "biofouling-risk": buildBiofoulingRiskIntelligenceSummary({ records, generatedAt, dataMode }),
    "explainability": buildExplainabilityIntelligenceSummary({ topCandidates, candidateList, salesCandidates, immediateTargets, generatedAt, dataMode }),
    "prediction-summary": buildPredictionIntelligenceSummary({ arrivalPipeline, predictedCleaningOpportunities, predictionDiagnostics, generatedAt, dataMode }),
    "operator-summary": buildOperatorIntelligenceSummary({ fleetOpportunities, operatorDiagnostics, generatedAt, dataMode }),
    "operator-opportunities": buildOperatorOpportunitiesIntelligenceSummary({ records, fleetOpportunities, generatedAt, dataMode }),
    "agent-summary": buildAgentIntelligenceSummary({ records, generatedAt, dataMode }),
    "agent-intelligence": buildAgentChannelIntelligenceSummary({ records, generatedAt, dataMode }),
    "agent-relationship": buildAgentRelationshipIntelligenceSummary({ records, generatedAt, dataMode }),
    "repeat-callers": buildRepeatCallerIntelligenceSummary({ records, generatedAt, dataMode }),
    "fleet-summary": buildFleetIntelligenceSummary({ records, fleetOpportunities, generatedAt, dataMode }),
    "fleet-intelligence": buildFleetIntelligenceSummary({ records, fleetOpportunities, generatedAt, dataMode }),
    "fleet-dna": buildFleetDnaIntelligenceSummary({ records, fleetOpportunities, generatedAt, dataMode }),
    "fleet-memory": buildFleetMemoryIntelligenceSummary({ records, fleetOpportunities, generatedAt, dataMode }),
    "fleet-penetration": buildFleetPenetrationIntelligenceSummary({ records, fleetOpportunities, generatedAt, dataMode }),
    "fleet-expansion": buildFleetExpansionIntelligenceSummary({ records, fleetOpportunities, generatedAt, dataMode }),
    "fleet-clusters": buildFleetClusterIntelligenceSummary({ records, fleetOpportunities, generatedAt, dataMode }),
    "opportunity-memory": buildOpportunityMemoryIntelligenceSummary({ records, generatedAt, dataMode }),
    "route-summary": buildRouteIntelligenceSummary({ records, generatedAt, dataMode }),
    "vessel-timeline": buildVesselTimelineIntelligenceSummary({ records, generatedAt, dataMode }),
    "korea-presence": buildKoreaPresenceIntelligenceSummary({ records, generatedAt, dataMode }),
    "cleaning-window": buildCleaningWindowIntelligenceSummary({ records, generatedAt, dataMode }),
    "service-bundles": buildServiceBundleIntelligenceSummary({ records, generatedAt, dataMode }),
    "compliance-exposure": buildComplianceExposureIntelligenceSummary({ records, generatedAt, dataMode }),
    "relationship-intelligence": buildRelationshipIntelligenceSummary({ records, generatedAt, dataMode }),
    "customer-memory": buildCustomerMemoryIntelligenceSummary({ records, fleetOpportunities, generatedAt, dataMode }),
    "opportunity-decay": buildOpportunityDecayIntelligenceSummary({ records, generatedAt, dataMode }),
    "missed-opportunities": buildMissedOpportunityIntelligenceSummary({ records, generatedAt, dataMode }),
    "lost-opportunity-reasons": buildLostOpportunityReasonIntelligenceSummary({ records, generatedAt, dataMode }),
    "win-probability": buildWinProbabilityIntelligenceSummary({ records, fleetOpportunities, portStatistics, generatedAt, dataMode }),
    "port-seasonality": buildPortSeasonalityIntelligenceSummary({ records, generatedAt, dataMode }),
    "fleet-heatmap": buildFleetHeatmapIntelligenceSummary({ records, fleetOpportunities, portStatistics, generatedAt, dataMode }),
    "port-opportunities": buildPortOpportunitiesIntelligenceSummary({ records, portStatistics, generatedAt, dataMode }),
    "port-demand-radar": buildPortDemandRadarIntelligenceSummary({ records, portStatistics, generatedAt, dataMode }),
    "port-dna": buildPortDnaIntelligenceSummary({ records, portStatistics, generatedAt, dataMode }),
    "superintendent-targets": buildSuperintendentTargetsIntelligenceSummary({ records, generatedAt, dataMode }),
    "compliance-opportunities": buildComplianceOpportunitiesIntelligenceSummary({ records, generatedAt, dataMode }),
    "drydock-prediction": buildDrydockPredictionIntelligenceSummary({ records, generatedAt, dataMode }),
    "revenue-forecast": buildRevenueForecastIntelligenceSummary({ records, fleetOpportunities, portStatistics, generatedAt, dataMode }),
    "commercial-summary": buildCommercialIntelligenceSummary({ topCandidates, commercialCommandCenter, candidateList, generatedAt, dataMode }),
    "sales-priority": buildSalesPriorityIntelligenceSummary({ records, candidateList, salesCandidates, immediateTargets, topCandidates, commercialCommandCenter, generatedAt, dataMode })
  };
}

function watchlistEvent(eventType, eventTime, eventSummary) {
  return {
    event_type: eventType,
    event_time: eventTime,
    event_summary: eventSummary
  };
}

function watchlistLastSeen(record = {}, generatedAt = new Date().toISOString()) {
  return firstNonEmpty(record.last_seen_at, record.updated_at, record.collected_at, record.ata, record.etb, record.eta, record.generated_at, generatedAt) || generatedAt;
}

function watchlistComplianceScore(record = {}) {
  const regions = complianceExposureRegions(record);
  const risk = recordRiskScore(record);
  const pressure = firstFiniteNumber(record.compliance_pressure_score, record.compliance_score, regions.length ? 45 : 0, 0) || 0;
  return Math.min(100, Math.round(
    Math.min(45, regions.length * 22) +
    Math.min(20, pressure) +
    Math.min(20, risk * 0.25) +
    (regulatedRouteSignal(record) || record.compliance_watch ? 15 : 0)
  ));
}

function watchlistChangeEvents(record = {}, generatedAt = new Date().toISOString()) {
  const eventTime = watchlistLastSeen(record, generatedAt);
  const events = [];
  const port = recordPortName(record);
  const score = salesPriorityScore(record);
  const band = salesPriorityBand(score);
  const operator = operatorFleetName(record);
  const complianceScore = watchlistComplianceScore(record);
  const congestionScore = firstFiniteNumber(record.congestion_score, record.port_congestion_score, record.congestion_exposure_score, 0) || 0;
  const windowScore = firstFiniteNumber(record.cleaning_window_score, record.work_feasibility_score, record.window_score, 0) || 0;
  if (hasPortSignal(record)) events.push(watchlistEvent("ENTERED_KOREA", eventTime, `${port} 권역에서 확인되었습니다.`));
  if (["berthed", "arrived_staying"].includes(String(record.status_bucket || "")) || firstNonEmpty(record.ata, record.atb)) {
    events.push(watchlistEvent("ARRIVED_PORT", eventTime, `${port} 도착/접안 신호가 있습니다.`));
  }
  if (isDepartedRecord(record) || firstNonEmpty(record.atd, record.departure_time)) {
    events.push(watchlistEvent("DEPARTED_PORT", eventTime, `${port} 출항 신호가 있습니다.`));
  }
  if (band === "HOT") events.push(watchlistEvent("BECAME_HOT", eventTime, `영업 우선순위가 HOT입니다. 기회점수 ${score}점.`));
  else if (band === "WARM") events.push(watchlistEvent("BECAME_WARM", eventTime, `영업 우선순위가 WARM입니다. 기회점수 ${score}점.`));
  if (complianceScore >= 45 || complianceExposureRegions(record).length) {
    events.push(watchlistEvent("COMPLIANCE_EXPOSURE_CHANGED", eventTime, complianceRouteSignal(record) || "Compliance 노출 신호가 있습니다."));
  }
  if (record.operator_changed || (firstNonEmpty(record.previous_operator, record.last_operator) && firstNonEmpty(record.previous_operator, record.last_operator) !== operator)) {
    events.push(watchlistEvent("OPERATOR_CHANGED", eventTime, `${operator} 운영사/관리사 단서가 변경되었습니다.`));
  }
  if (congestionScore >= 70) events.push(watchlistEvent("HIGH_CONGESTION_DETECTED", eventTime, `${port} 체선/혼잡 신호가 높습니다.`));
  if (windowScore >= 60 || hasAnchorageWaitingSignal(record) || dwellDays(record) >= 3) {
    events.push(watchlistEvent("CLEANING_WINDOW_OPENED", eventTime, "묘박/장기체류/작업 가능 창 신호가 열렸습니다."));
  }
  return events.slice(0, 6);
}

function watchlistPriority({ opportunityScore = 0, riskScore = 0, complianceScore = 0, changeEvents = [] } = {}) {
  if (opportunityScore >= 75 || riskScore >= 75 || complianceScore >= 70 || changeEvents.some(event => ["BECAME_HOT", "CLEANING_WINDOW_OPENED"].includes(event.event_type))) return "HIGH";
  if (opportunityScore >= 55 || riskScore >= 55 || complianceScore >= 45 || changeEvents.length) return "MEDIUM";
  return "LOW";
}

function buildWatchlistVesselItems(records = [], generatedAt = new Date().toISOString()) {
  return sortCommercialPriority(dedupeCandidateRows(records.filter(record => {
    const score = salesPriorityScore(record);
    return !isSyntheticSample(record) &&
      !isHardCandidateExcluded(record) &&
      (isWatchlistVessel(record) ||
        isSalesCandidate(record) ||
        score >= 55 ||
        recordRiskScore(record) >= 60 ||
        watchlistComplianceScore(record) >= 45 ||
        hasAnchorageWaitingSignal(record) ||
        hasArrivalPipelineSignal(record));
  })))
    .map((record, index) => {
      const display = vesselDisplay(record);
      const opportunityScore = salesPriorityScore(record);
      const riskScore = recordRiskScore(record);
      const complianceScore = watchlistComplianceScore(record);
      const changeEvents = watchlistChangeEvents(record, generatedAt);
      const band = salesPriorityBand(opportunityScore);
      return {
        rank: index + 1,
        watch_type: "VESSEL",
        watch_name: display.vessel_name,
        vessel_display: display,
        operator: display.operator,
        priority: watchlistPriority({ opportunityScore, riskScore, complianceScore, changeEvents }),
        current_status: `${band} · ${firstNonEmpty(record.status_bucket, record.status, "상태 확인")}`,
        current_port: display.current_port,
        opportunity_score: opportunityScore,
        risk_score: riskScore,
        compliance_score: complianceScore,
        last_seen_at: watchlistLastSeen(record, generatedAt),
        change_events: changeEvents,
        reason_summary: compactReasonSummary(record),
        recommended_action: compactRecommendedAction(record)
      };
    })
    .sort((a, b) =>
      (b.priority === "HIGH") - (a.priority === "HIGH") ||
      Number(b.opportunity_score || 0) - Number(a.opportunity_score || 0) ||
      Number(b.risk_score || 0) - Number(a.risk_score || 0) ||
      Number(b.compliance_score || 0) - Number(a.compliance_score || 0)
    )
    .slice(0, 12)
    .map((item, index) => ({ ...item, rank: index + 1 }));
}

function buildWatchlistOperatorGroups(records = []) {
  const groups = new Map();
  for (const record of records) {
    const operator = operatorFleetName(record);
    if (!operator || operator === "운영사 확인 필요") continue;
    const current = groups.get(operator) || {
      operator,
      vessel_count: 0,
      hot_count: 0,
      warm_count: 0,
      score_total: 0,
      risk_total: 0,
      compliance_total: 0,
      ports: new Map(),
      last_seen_at: null
    };
    const score = salesPriorityScore(record);
    const band = salesPriorityBand(score);
    current.vessel_count += 1;
    current.hot_count += band === "HOT" ? 1 : 0;
    current.warm_count += band === "WARM" ? 1 : 0;
    current.score_total += score;
    current.risk_total += recordRiskScore(record);
    current.compliance_total += watchlistComplianceScore(record);
    const port = recordPortName(record);
    current.ports.set(port, (current.ports.get(port) || 0) + 1);
    const seen = watchlistLastSeen(record, "");
    if (seen && (!current.last_seen_at || String(seen) > String(current.last_seen_at))) current.last_seen_at = seen;
    groups.set(operator, current);
  }
  return [...groups.values()].map(group => {
    const topPort = [...group.ports.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "미확인 항만";
    const opportunityScore = Math.round(group.score_total / Math.max(1, group.vessel_count));
    const riskScore = Math.round(group.risk_total / Math.max(1, group.vessel_count));
    const complianceScore = Math.round(group.compliance_total / Math.max(1, group.vessel_count));
    const events = [];
    if (group.hot_count) events.push(watchlistEvent("BECAME_HOT", group.last_seen_at, `${group.hot_count}척 HOT 후보가 있습니다.`));
    if (complianceScore >= 45) events.push(watchlistEvent("COMPLIANCE_EXPOSURE_CHANGED", group.last_seen_at, "선대 내 compliance 노출 신호가 있습니다."));
    return { ...group, topPort, opportunityScore, riskScore, complianceScore, events };
  });
}

function buildWatchlistAggregateItems(records = [], portStatistics = {}, generatedAt = new Date().toISOString()) {
  const operators = buildWatchlistOperatorGroups(records)
    .sort((a, b) => b.hot_count - a.hot_count || b.opportunityScore - a.opportunityScore || b.vessel_count - a.vessel_count);
  const operatorItems = operators.slice(0, 3).map((group, index) => ({
    rank: index + 1,
    watch_type: "OPERATOR",
    watch_name: group.operator,
    priority: watchlistPriority({ opportunityScore: group.opportunityScore, riskScore: group.riskScore, complianceScore: group.complianceScore, changeEvents: group.events }),
    current_status: `${group.hot_count} HOT / ${group.warm_count} WARM`,
    current_port: group.topPort,
    opportunity_score: group.opportunityScore,
    risk_score: group.riskScore,
    compliance_score: group.complianceScore,
    last_seen_at: group.last_seen_at || generatedAt,
    change_events: group.events,
    reason_summary: `${group.vessel_count}척 한국 항만 신호, HOT ${group.hot_count}척`,
    recommended_action: "운영사 단위로 담당자와 반복 입항/작업 가능 선박을 확인"
  }));
  const fleetItems = operators.filter(group => group.vessel_count >= 2).slice(0, 3).map((group, index) => ({
    rank: index + 1,
    watch_type: "FLEET",
    watch_name: group.operator,
    priority: watchlistPriority({ opportunityScore: group.opportunityScore, riskScore: group.riskScore, complianceScore: group.complianceScore, changeEvents: group.events }),
    current_status: `${group.vessel_count}척 선대 감시`,
    current_port: group.topPort,
    opportunity_score: group.opportunityScore,
    risk_score: group.riskScore,
    compliance_score: group.complianceScore,
    last_seen_at: group.last_seen_at || generatedAt,
    change_events: group.events,
    reason_summary: "같은 운영사/선대에서 복수 선박 기회가 관측되었습니다.",
    recommended_action: "선대 단위 제안 가능성을 점검"
  }));
  const portRows = Array.isArray(portStatistics?.ports) ? portStatistics.ports : Array.isArray(portStatistics) ? portStatistics : [];
  const portItems = portRows
    .map(port => {
      const opportunityScore = firstFiniteNumber(port.avg_opportunity_score, port.average_opportunity_score, port.opportunity_index, port.port_opportunity_score, 0) || 0;
      const hot = firstFiniteNumber(port.hot_candidate_count, port.hot_count, port.immediate_target_count, 0) || 0;
      const vesselCount = firstFiniteNumber(port.vessel_count, port.total_vessels, port.all_vessels_count, 0) || 0;
      const changeEvents = hot ? [watchlistEvent("BECAME_HOT", generatedAt, `${hot}척 HOT 후보가 있는 항만입니다.`)] : [];
      if (firstFiniteNumber(port.congestion_score, port.avg_congestion_score, 0) >= 70) {
        changeEvents.push(watchlistEvent("HIGH_CONGESTION_DETECTED", generatedAt, "항만 혼잡/체선 신호가 높습니다."));
      }
      return {
        watch_type: "PORT",
        watch_name: port.display_name || port.port_name || port.port_code || "미확인 항만",
        priority: watchlistPriority({ opportunityScore, riskScore: 0, complianceScore: 0, changeEvents }),
        current_status: `${vesselCount}척 / HOT ${hot}척`,
        current_port: port.display_name || port.port_name || port.port_code || "미확인 항만",
        opportunity_score: Math.round(opportunityScore),
        risk_score: 0,
        compliance_score: 0,
        last_seen_at: port.last_seen_at || generatedAt,
        change_events: changeEvents,
        reason_summary: "항만 단위 영업 기회 밀도를 감시합니다.",
        recommended_action: "항만별 HOT/대기/입항 후보를 함께 확인"
      };
    })
    .sort((a, b) => Number(b.opportunity_score || 0) - Number(a.opportunity_score || 0))
    .slice(0, 2)
    .map((item, index) => ({ ...item, rank: index + 1 }));
  return [...operatorItems, ...fleetItems, ...portItems];
}

function buildWatchlistPayload({ records = [], portStatistics = {}, generatedAt, dataMode, report = {} } = {}) {
  const vesselItems = buildWatchlistVesselItems(records, generatedAt);
  const aggregateItems = buildWatchlistAggregateItems(records, portStatistics, generatedAt);
  const items = [...vesselItems, ...aggregateItems]
    .sort((a, b) =>
      (b.priority === "HIGH") - (a.priority === "HIGH") ||
      (b.priority === "MEDIUM") - (a.priority === "MEDIUM") ||
      Number(b.opportunity_score || 0) - Number(a.opportunity_score || 0) ||
      Number(b.risk_score || 0) - Number(a.risk_score || 0)
    )
    .slice(0, 20)
    .map((item, index) => ({ ...item, rank: index + 1 }));
  return publicItemsEnvelope({
    generatedAt,
    dataMode,
    report,
    sourceTable: "vessel_display,opportunity_memory,sales/actions,relationship-intelligence,fleet-intelligence,alerts/latest,compliance-exposure",
    items,
    extra: {
      status: items.length ? "active" : "empty",
      reason: items.length ? null : "감시 조건에 맞는 선박/운영사/항만이 없습니다.",
      summary: {
        watchlist_count: items.length,
        active_watchlist_count: items.filter(item => item.priority !== "LOW").length,
        vessels_with_changes: items.filter(item => item.watch_type === "VESSEL" && Array.isArray(item.change_events) && item.change_events.length).length,
        operator_watchlist_count: items.filter(item => item.watch_type === "OPERATOR").length,
        fleet_watchlist_count: items.filter(item => item.watch_type === "FLEET").length,
        port_watchlist_count: items.filter(item => item.watch_type === "PORT").length
      }
    }
  });
}

function buildCandidateChangesPayload(candidateChanges = {}, generatedAt = new Date().toISOString()) {
  return {
    generated_at: generatedAt,
    new_immediate_targets: candidateChanges.new_immediate_targets || candidateChanges.new_hot_candidates || [],
    new_sales_candidates: candidateChanges.new_sales_candidates || candidateChanges.added_candidates || [],
    removed_targets: candidateChanges.removed_targets || candidateChanges.removed_candidates || [],
    changed_ports: candidateChanges.changed_ports || [],
    changed_operators: candidateChanges.changed_operators || [],
    source: "snapshot_candidate_changes"
  };
}

function buildSalesAlertsPayload({ topCandidates = {}, dataContinuity = {}, report = {}, generatedAt = new Date().toISOString(), dataMode = report.data_mode } = {}) {
  const opportunities = topCandidates.opportunities || [];
  const alertDate = String(generatedAt || new Date().toISOString()).slice(0, 10);
  const hot = opportunities.filter(v => v.sales_priority_band === "HOT").slice(0, 10);
  const compliance = opportunities.filter(regulatedRouteSignal).slice(0, 10);
  const longStay = opportunities
    .filter(v => Number(v.stay_hours || v.current_call_stay_hours || v.cumulative_stay_hours || v.anchorage_hours || 0) >= 72)
    .slice(0, 10);
  const alerts = [];
  if (dataContinuity.status === "fallback_active") {
    alerts.push({
      alert_key: `DATA_FALLBACK_ACTIVE|platform|all|${alertDate}`,
      severity: "warning",
      type: "DATA_FALLBACK_ACTIVE",
      title: "데이터 fallback 사용 중",
      message: dataContinuity.operator_message_ko,
      next_action: "Collector/Supabase 설정과 마지막 성공 데이터 묶음 상태를 확인하세요."
    });
  }
  if (hot.length) {
    alerts.push({
      alert_key: `HOT_SALES_QUEUE|platform|all|${alertDate}`,
      severity: "high",
      type: "HOT_SALES_QUEUE",
      title: `${hot.length}척 HOT 영업 후보`,
      message: "오늘 연락 우선순위가 높은 후보가 있습니다.",
      next_action: "상위 10척의 대리점/선사 연락 경로를 확인하세요."
    });
  }
  if (compliance.length) {
    alerts.push({
      alert_key: `COMPLIANCE_ROUTE|platform|all|${alertDate}`,
      severity: "medium",
      type: "COMPLIANCE_ROUTE",
      title: `${compliance.length}척 규제 항로 후보`,
      message: "Brazil, Australia 또는 New Zealand biofouling compliance 각도로 접근할 수 있습니다.",
      next_action: "목적지와 출항 전 작업 가능 시간을 확인하세요."
    });
  }
  if (longStay.length) {
    alerts.push({
      alert_key: `LONG_STAY|platform|all|${alertDate}`,
      severity: "medium",
      type: "LONG_STAY",
      title: `${longStay.length}척 장기 체류 후보`,
      message: "장기 묘박/체류로 hull performance와 fuel efficiency 기회가 커질 수 있습니다.",
      next_action: "체류 원인과 작업 가능 창을 확인하세요."
    });
  }
  return {
    schema_version: PUBLIC_API_SCHEMA_VERSION,
    generated_at: generatedAt,
    data_mode: contractDataMode(dataMode, report),
    record_count: alerts.length,
    source_table: "opportunity_master,data_continuity",
    items: alerts,
    automation_status: "static_report_ready",
    delivery_channels: {
      dashboard_json: true,
      email: false,
      webhook: false,
      reason: "Email/webhook credentials are not configured in this local run."
    },
    alert_count: alerts.length,
    alerts,
    hot_queue: hot,
    compliance_queue: compliance,
    long_stay_queue: longStay,
    storage_status: {
      supabase_write_status: report.supabase_write?.status || report.storage_status?.supabase?.status || "unknown",
      promotion_status: report.promotion_status || "unknown"
    }
  };
}

function buildDailySalesReportPayload({ topCandidates = {}, dataContinuity = {}, report = {}, dashboardSummary = {}, generatedAt = new Date().toISOString() } = {}) {
  const opportunities = topCandidates.opportunities || [];
  const hot = opportunities.filter(v => v.sales_priority_band === "HOT");
  const warm = opportunities.filter(v => v.sales_priority_band === "WARM");
  const compliance = opportunities.filter(regulatedRouteSignal);
  return {
    generated_at: generatedAt,
    report_type: "daily_sales_intelligence",
    title: "HWK Daily Sales Intelligence Report",
    executive_summary_ko: dataContinuity.status === "fallback_active"
      ? "현재 실행은 운영 데이터로 승격되지 않았습니다. 영업 판단 전 데이터 상태를 먼저 확인하세요."
      : `${hot.length}척 HOT 후보와 ${warm.length}척 WARM 후보가 선별되었습니다.`,
    kpis: {
      total_vessels: Number(dashboardSummary.all_vessels_count || report.all_collected_vessel_count || 0),
      hot_candidates: hot.length,
      warm_candidates: warm.length,
      compliance_candidates: compliance.length,
      fallback_active: dataContinuity.status === "fallback_active"
    },
    contact_today: opportunities.slice(0, 10).map((v, index) => ({
      rank: index + 1,
      vessel_name: v.vessel_name,
      port: v.port_name || v.port,
      score: v.sales_priority_score || v.commercial_value_score || v.total_sales_priority_score || 0,
      band: v.sales_priority_band || "LOW",
      why_now: v.why_now || "",
      next_action: v.recommended_action || v.recommended_next_action || v.candidate_next_action || "Confirm contact path and work window.",
      reason_codes: (v.reason_codes || []).slice(0, 6)
    })),
    data_continuity: {
      status: dataContinuity.status,
      fallback_order: dataContinuity.fallback_order,
      storage_verification: dataContinuity.storage_verification
    },
    automation_next_step: "Configure email/webhook secrets to deliver this JSON as a scheduled alert."
  };
}

function buildExecutiveWeeklyReportPayload({
  dashboardSummary = {},
  revenueForecast = {},
  operatorOpportunities = {},
  portOpportunities = {},
  complianceOpportunities = {},
  repeatCallers = {},
  fleetExpansion = {},
  dataContinuity = {},
  report = {},
  generatedAt = new Date().toISOString()
} = {}) {
  const revenue = revenueForecast.summary || revenueForecast.sections || revenueForecast.items?.[0]?.sections || {};
  const operators = (operatorOpportunities.items || []).slice(0, 5);
  const ports = (portOpportunities.items || dashboardSummary.ports || []).slice(0, 5);
  const complianceItems = complianceOpportunities.items || [];
  const complianceCount = country => complianceItems.filter(item => String(item.destination_country || "").toLowerCase().includes(country)).length;
  const risks = [];
  const targetRatio = Number(dashboardSummary.all_vessels_count || dashboardSummary.record_count || 0)
    ? Number(dashboardSummary.sales_target_count || 0) / Number(dashboardSummary.all_vessels_count || dashboardSummary.record_count || 1)
    : 0;
  if (dataContinuity.status === "fallback_active" || dashboardSummary.fallback_used) risks.push("fallback snapshot 사용 중");
  if (targetRatio > 0 && targetRatio < 0.2) risks.push("영업대상 비율 낮음");
  if (report.missing_required_config?.length) risks.push(`필수 설정 누락: ${report.missing_required_config.join(", ")}`);
  if (report.source_failures?.length) risks.push("일부 데이터 소스 실패");
  return {
    schema_version: PUBLIC_API_SCHEMA_VERSION,
    generated_at: generatedAt,
    data_mode: contractDataMode(dashboardSummary.data_mode || report.data_mode, report),
    report_type: "executive_weekly_intelligence",
    title: "주간 경영 브리핑",
    source_table: "daily-sales,sales-priority,revenue-forecast,operator-opportunities,compliance-opportunities,fleet-memory",
    sections: {
      executive_summary: {
        total_vessels: Number(dashboardSummary.all_vessels_count || dashboardSummary.total_vessels || dashboardSummary.record_count || 0),
        hot_targets: Number(revenue.HOT?.target_count || dashboardSummary.hot_count || 0),
        top_operators: operators.map(row => ({ operator_name: row.operator_name, opportunity_score: row.opportunity_score || row.opportunity_index || row.average_opportunity_score || 0 })),
        top_ports: ports.map(row => ({ port_name: row.port_name || row.display_name, opportunity_index: row.opportunity_index || row.average_opportunity_score || row.vessel_count || 0 }))
      },
      revenue_opportunities: {
        estimated_pipeline: revenueForecast.items?.[0]?.estimated_revenue_high || revenue.WARM?.estimated_revenue_high || 0,
        hot_opportunity_value: revenue.HOT || { target_count: 0, estimated_revenue_low: 0, estimated_revenue_high: 0 },
        funnel: {
          HOT: revenue.HOT || {},
          WARM: revenue.WARM || {}
        },
        by_port: revenue.by_port || [],
        by_operator: revenue.by_operator || []
      },
      compliance_opportunities: {
        Brazil: complianceCount("brazil"),
        Australia: complianceCount("australia"),
        NZ: complianceItems.filter(item => /new zealand|nz/i.test(String(item.destination_country || ""))).length,
        items: complianceItems.slice(0, 5)
      },
      repeat_caller_insights: (repeatCallers.items || []).slice(0, 5),
      fleet_expansion_opportunities: (fleetExpansion.items || []).slice(0, 5),
      risks: {
        missing_data: risks.filter(risk => /누락|missing/i.test(risk)),
        degraded_sources: risks.filter(risk => /fallback|실패/i.test(risk)),
        low_target_ratio: targetRatio > 0 && targetRatio < 0.2,
        warnings: risks
      }
    },
    record_count: 1,
    items: [{
      title: "주간 경영 브리핑",
      total_vessels: Number(dashboardSummary.all_vessels_count || dashboardSummary.total_vessels || dashboardSummary.record_count || 0),
      hot_targets: Number(revenue.HOT?.target_count || dashboardSummary.hot_count || 0),
      estimated_pipeline_high: revenueForecast.items?.[0]?.estimated_revenue_high || 0,
      risk_count: risks.length,
      recommended_action: risks.length ? "데이터 품질 리스크를 먼저 확인한 뒤 HOT/반복입항 선사 중심으로 주간 영업 우선순위를 조정" : "HOT 후보와 상위 선사/항만 기회를 기준으로 주간 영업 활동을 배정"
    }]
  };
}

function buildExecutiveMorningBriefPayload({
  dashboardSummary = {},
  dailySales = {},
  revenueForecast = {},
  salesActions = {},
  complianceExposure = {},
  fleetIntelligence = {},
  portOpportunities = {},
  dataContinuity = {},
  report = {},
  generatedAt = new Date().toISOString()
} = {}) {
  const revenue = revenueForecast.summary || revenueForecast.sections || revenueForecast.items?.[0]?.sections || {};
  const revenueItem = revenueForecast.items?.[0] || {};
  const actions = compactItems(salesActions).slice(0, 10);
  const dailyHot = Number(dailySales.kpis?.hot_candidates || 0);
  const hotCount = Number(dashboardSummary.hot_count || dashboardSummary.immediate_target_count || revenue.HOT?.target_count || dailyHot || 0);
  const fleetRows = (fleetIntelligence.items || []);
  const topFleets = (fleetRows.filter(row => !/미확인|unknown|확인 필요/i.test(String(row.operator_name || ""))).length
    ? fleetRows.filter(row => !/미확인|unknown|확인 필요/i.test(String(row.operator_name || "")))
    : fleetRows)
    .slice(0, 5)
    .map(row => ({
      operator_name: row.operator_name,
      fleet_size_korea: row.fleet_size_korea || row.vessel_count || 0,
      hot_count: row.hot_count || 0,
      average_opportunity_score: row.average_opportunity_score || row.opportunity_score || 0,
      recommended_sales_angle: row.recommended_sales_angle || row.recommended_action || ""
    }));
  const portRows = (portOpportunities.items || []).length ? portOpportunities.items : (dashboardSummary.ports || []);
  const topPorts = (portRows.filter(row => !/미확인|unknown/i.test(String(row.port_name || row.display_name || row.port_code || ""))).length
    ? portRows.filter(row => !/미확인|unknown/i.test(String(row.port_name || row.display_name || row.port_code || "")))
    : portRows)
    .slice(0, 5)
    .map(row => ({
      port_name: row.port_name || row.display_name || row.port_code || "미확인 항만",
      vessel_count: row.vessel_count || 0,
      sales_target_count: row.sales_target_count || row.target_count || row.hot_candidate_count || 0,
      opportunity_index: row.opportunity_index || row.average_opportunity_score || row.avg_opportunity_score || 0
    }));
  const complianceItems = (complianceExposure.items || []).slice(0, 10);
  const warnings = [];
  const totalVessels = Number(dashboardSummary.all_vessels_count || dashboardSummary.total_vessels || dashboardSummary.record_count || 0);
  const targetCount = Number(dashboardSummary.sales_target_count || dashboardSummary.target_count || dashboardSummary.kpis?.sales_target_count || 0);
  const targetRatio = totalVessels > 0 ? targetCount / totalVessels : null;
  if (dataContinuity.status === "fallback_active" || dashboardSummary.fallback_used) warnings.push({ severity: "WARNING", feature: "snapshot", message: "fallback snapshot 사용 중" });
  if (targetRatio !== null && targetRatio < 0.2) warnings.push({ severity: "WARNING", feature: "sales_target_ratio", message: "영업대상 비율이 낮습니다.", observed_value: Math.round(targetRatio * 1000) / 10, expected_value: "20% 이상 또는 명확한 제외 사유" });
  if (report.missing_required_config?.length) warnings.push({ severity: "CRITICAL", feature: "config", message: `필수 설정 누락: ${report.missing_required_config.join(", ")}` });
  if (report.source_failures?.length) warnings.push({ severity: "WARNING", feature: "sources", message: "일부 데이터 소스 실패", observed_value: report.source_failures.length });
  const storage = dataContinuity.storage_verification || {};
  if (storage.supabase_write_status && storage.supabase_write_status !== "completed") warnings.push({ severity: "CRITICAL", feature: "supabase", message: "Supabase 저장 상태 확인 필요", observed_value: storage.supabase_write_status });
  if (storage.promotion_status && !/promoted|active_dataset_available/i.test(String(storage.promotion_status))) warnings.push({ severity: "CRITICAL", feature: "promotion", message: "데이터 승격 상태 확인 필요", observed_value: storage.promotion_status });
  const expectedRevenue = Number(
    revenueItem.expected_revenue ||
    revenueItem.portfolio?.expected_revenue ||
    revenue.portfolio?.expected_revenue ||
    revenueForecast.portfolio?.expected_revenue ||
    0
  );
  const highRevenue = Number(
    revenueItem.aggressive_revenue ||
    revenueItem.estimated_revenue_high ||
    revenueItem.portfolio?.aggressive_revenue ||
    revenue.portfolio?.aggressive_revenue ||
    0
  );
  return {
    schema_version: PUBLIC_API_SCHEMA_VERSION,
    generated_at: generatedAt,
    data_mode: contractDataMode(dashboardSummary.data_mode || report.data_mode, report),
    report_type: "executive_morning_brief",
    title: "오늘의 브리핑",
    source_table: "daily-sales,revenue-forecast,sales/actions,compliance-exposure,fleet-intelligence",
    record_count: 1,
    hot_count: hotCount,
    immediate_actions: actions,
    expected_revenue: expectedRevenue,
    estimated_revenue_high: highRevenue,
    top_fleets: topFleets,
    top_ports: topPorts,
    compliance_opportunities: complianceItems,
    warnings,
    sections: {
      executive_summary: {
        total_vessels: totalVessels,
        sales_target_count: targetCount,
        hot_count: hotCount,
        expected_revenue: expectedRevenue,
        warning_count: warnings.length,
        last_successful_update: dashboardSummary.generated_at || report.completed_at || generatedAt
      },
      immediate_actions: actions,
      revenue: {
        expected_revenue: expectedRevenue,
        estimated_revenue_high: highRevenue,
        disclaimer: "Estimated Opportunity Only"
      },
      top_fleets: topFleets,
      top_ports: topPorts,
      compliance_opportunities: complianceItems,
      warnings
    },
    items: [{
      title: "오늘의 브리핑",
      hot_count: hotCount,
      immediate_action_count: actions.length,
      expected_revenue: expectedRevenue,
      top_fleet: topFleets[0]?.operator_name || null,
      top_port: topPorts[0]?.port_name || null,
      compliance_count: complianceItems.length,
      warning_count: warnings.length,
      reason_summary: `HOT ${hotCount}건, 즉시 액션 ${actions.length}건, 예상 기회 ${expectedRevenue} ${revenueForecast.summary?.assumptions?.currency || revenueItem.portfolio?.currency || "USD"}`,
      recommended_action: actions[0]?.recommended_action || actions[0]?.next_action || "HOT 후보, 상위 선대, Compliance 노출 선박 순으로 오늘의 연락 우선순위를 배정"
    }]
  };
}

function buildScoringDiagnostics(records = []) {
  const buckets = {
    score_0_20: 0,
    score_20_35: 0,
    score_35_50: 0,
    score_50_65: 0,
    score_65_75: 0,
    score_75_90: 0,
    score_90_plus: 0
  };
  for (const v of records) {
    const score = Number(v.commercial_value_score || v.total_sales_priority_score || v.cleaning_candidate_score || 0);
    if (score < 20) buckets.score_0_20 += 1;
    else if (score < REVIEW_TARGET_THRESHOLD) buckets.score_20_35 += 1;
    else if (score < 50) buckets.score_35_50 += 1;
    else if (score < SALES_CANDIDATE_THRESHOLD) buckets.score_50_65 += 1;
    else if (score < IMMEDIATE_TARGET_THRESHOLD) buckets.score_65_75 += 1;
    else if (score < CRITICAL_TARGET_THRESHOLD) buckets.score_75_90 += 1;
    else buckets.score_90_plus += 1;
  }
  buckets.score_35_60 = buckets.score_35_50 + buckets.score_50_65;
  buckets.score_60_80 = buckets.score_65_75 + buckets.score_75_90;
  buckets.score_80_90 = buckets.score_75_90;
  buckets.score_50_75 = buckets.score_50_65 + buckets.score_65_75;
  buckets.score_75_plus = buckets.score_75_90 + buckets.score_90_plus;
  const highScoreRows = records.filter(v => Number(v.commercial_value_score || v.total_sales_priority_score || 0) >= SALES_CANDIDATE_THRESHOLD);
  const exclusionReasonCounts = {};
  for (const v of highScoreRows) {
    if (isSalesCandidate(v)) continue;
    const reason = commercialExclusionReason(v) || v.exclusion_reason || "unknown";
    exclusionReasonCounts[reason] = (exclusionReasonCounts[reason] || 0) + 1;
  }
  const congestionScores = records.map(v => deriveCongestionScore(v, v));
  const workScores = records.map(v => Number(v.work_feasibility_score || 0) || Number(v.cleaning_window_score || 0));
  const waitingDays = records.map(v => commercialWaitingDays(v, v));
  const salesTargetCount = records.filter(isSalesCandidate).length;
  const immediateTargetCount = records.filter(isImmediateTarget).length;
  const percentileRankPresentCount = records.filter(hasCommercialRank).length;
  const percentileRankMissingCount = records.length - percentileRankPresentCount;
  const thresholdOnlySalesTargetCount = records.filter(v => {
    const score = Number(v.commercial_value_score || v.total_sales_priority_score || v.cleaning_candidate_score || 0);
    return !isDepartedRecord(v) && !isHardCandidateExcluded(v) && score >= SALES_CANDIDATE_THRESHOLD;
  }).length;
  const candidateGenerationRows = records.filter(v => {
    const score = Number(v.commercial_value_score || v.total_sales_priority_score || v.cleaning_candidate_score || 0);
    return score >= 50 && !isDepartedRecord(v) && !isHardCandidateExcluded(v);
  });
  const promotedCandidateRows = records.filter(v => isSalesCandidate(v) || isImmediateTarget(v));
  const excludedCandidateRows = candidateGenerationRows
    .filter(v => Number(v.commercial_value_score || v.total_sales_priority_score || v.cleaning_candidate_score || 0) >= SALES_CANDIDATE_THRESHOLD && !isSalesCandidate(v))
    .map((v, index) => ({
      candidate_id: v.snapshot_id || v.port_call_id || v.port_call_identity || v.hybrid_entity_key || v.vessel_id || `excluded-${index}`,
      vessel_name: v.vessel_name || v.name || "",
      port_call_id: v.port_call_id || v.port_call_identity || "",
      commercial_value_score: Number(v.commercial_value_score || v.total_sales_priority_score || v.cleaning_candidate_score || 0),
      candidate_band: v.candidate_band || v.sales_priority_band || (Number(v.commercial_value_score || v.total_sales_priority_score || v.cleaning_candidate_score || 0) >= 75 ? "immediate_target_score_only" : "sales_target_score_only"),
      exclusion_reason: commercialExclusionReason(v) || (!withinCommercialPercentile(v, 20) ? "outside_sales_top_20_percentile" : "not_promoted")
    }));
  const candidateExclusionReasonCounts = excludedCandidateRows.reduce((acc, row) => {
    acc[row.exclusion_reason] = (acc[row.exclusion_reason] || 0) + 1;
    return acc;
  }, {});
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
  const scores = records.map(v => Number(v.commercial_value_score || v.total_sales_priority_score || v.cleaning_candidate_score || 0));
  const scoreRangeCount = (min, max = Infinity) => scores.filter(score => score >= min && score <= max).length;
  return {
    valid_vessels_count: records.length,
    all_vessels_count: records.length,
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
    total_collected: records.length,
    target_vessels_5000gt_plus: records.filter(v => Number(v.gt || v.grtg || v.intrlGrtg || 0) >= COMMERCIAL_GT_THRESHOLD).length,
    candidate_generation_count: candidateGenerationRows.length,
    candidate_promotion_count: promotedCandidateRows.length,
    candidate_excluded_count: excludedCandidateRows.length,
    excluded_candidates: excludedCandidateRows,
    excluded_candidate_samples: excludedCandidateRows.slice(0, 50),
    ...buckets,
    review_target_threshold: REVIEW_TARGET_THRESHOLD,
    sales_candidate_threshold: SALES_CANDIDATE_THRESHOLD,
    immediate_target_threshold: IMMEDIATE_TARGET_THRESHOLD,
    candidate_threshold_used: {
      watchlist: "commercial_value_score 50-64",
      sales_target: "commercial_value_score >= 65 AND global_percentile <= 20 OR port_percentile <= 20",
      immediate_target: "commercial_value_score >= 75 AND global_percentile <= 10 OR port_percentile <= 10 AND current/near-term work feasibility"
    },
    commercial_score_bands: {
      critical: "90+",
      immediate_target: "75-89",
      sales_target: "65-74",
      watchlist: "50-64",
      general_vessel: "0-49"
    },
    high_score_not_promoted_count: highScoreRows.filter(v => !isSalesCandidate(v)).length,
    candidate_promotion_error: highScoreRows.some(v => !isSalesCandidate(v) && !commercialExclusionReason(v) && !v.exclusion_reason),
    exclusion_reason_counts: { ...exclusionReasonCounts, ...candidateExclusionReasonCounts },
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
    congestion_score_avg: avg(congestionScores),
    congestion_score_nonzero_count: congestionScores.filter(value => value > 0).length,
    congestion_score_calculated_count: congestionScores.filter(value => value > 0).length,
    congestion_score_zero_but_stay_exists_count: records.filter(v => commercialWaitingDays(v, v) >= 3 && deriveCongestionScore(v, v) <= 0).length,
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
      watchlist: "score 50-64, excluding sales/immediate targets",
      percentile_fallback: "if rank fields are missing, percentile guard fails so target ratio cannot inflate"
    },
    watchlist_count: records.filter(v => !isSalesCandidate(v) && isWatchlistVessel(v)).length,
    immediate_target_count: immediateTargetCount,
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
    contact_available_count: records.filter(v => ["contact_available", "high_confidence_contact"].includes(v.contact_path_status) || hasValue(v.operator_email || v.agent_email || v.operator_website || v.agent_website || v.operator_phone || v.agent_phone)).length,
    operator_confidence_avg: known.length ? Math.round(known.reduce((sum, v) => sum + Number(v.operator_confidence || 0), 0) / known.length) : 0,
    operator_source_breakdown: sourceBreakdown,
    candidates_with_operator_count: salesCandidates.filter(v => hasValue(v.operator_name || v.operator)).length,
    candidates_with_agent_count: salesCandidates.filter(v => hasValue(v.agent_name || v.agent)).length,
    immediate_targets_with_contact_path_count: immediateTargets.filter(v => v.contact_path_available || hasValue(v.operator_name || v.operator) || hasValue(v.agent_name || v.agent)).length,
    contact_ready_count: records.filter(v => Number(v.contact_readiness_score || 0) >= 50 || v.contact_path_available).length,
    candidates_contact_ready_count: salesCandidates.filter(v => Number(v.contact_readiness_score || 0) >= 50 || v.contact_path_available).length,
    repeat_caller_count: records.filter(v => Number(v.repeat_call_count || 0) >= 3 || Number(v.repeat_caller_score || 0) >= 20).length,
    repeat_operator_count: records.filter(v => Number(v.operator_vessel_count || v.repeat_operator_count || 0) >= 3 || Number(v.repeat_operator_score || 0) >= 20).length,
    fleet_opportunity_count: buildFleetOpportunityRows(records).filter(row => Number(row.fleet_opportunity_score || 0) >= 35).length,
    operators_with_multiple_targets: buildFleetOpportunityRows(records).filter(row => Number(row.target_vessel_count || 0) >= 2).length,
    operators_with_multiple_immediate_targets: buildFleetOpportunityRows(records).filter(row => Number(row.immediate_target_count || 0) >= 2).length
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

function buildDataQualityLayerDiagnostics(records = [], matchingDiagnostics = buildMatchingDiagnostics(records)) {
  const avg = values => values.length ? Math.round(values.reduce((sum, value) => sum + Number(value || 0), 0) / values.length) : 0;
  const scores = records.map(v => Number(v.data_quality_score || deriveDataQualityScore(v).data_quality_score || 0));
  const parseMs = value => {
    const date = parseScheduleTime(value);
    return date ? date.getTime() : null;
  };
  const gtValues = records.map(v => Number(v.gt || v.grtg || v.intrlGrtg || 0));
  const sourceConfidenceValues = records.map(v => Number(v.source_confidence_score || v.data_confidence_score || v.data_quality_score || deriveDataQualityScore(v).data_quality_score || 0));
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
    high_quality_count: records.filter(v => Number(v.data_quality_score || 0) >= 80).length,
    medium_quality_count: records.filter(v => Number(v.data_quality_score || 0) >= 60 && Number(v.data_quality_score || 0) < 80).length,
    low_quality_count: records.filter(v => Number(v.data_quality_score || 0) >= 40 && Number(v.data_quality_score || 0) < 60).length,
    needs_cleanup_count: records.filter(v => Number(v.data_quality_score || 0) < 40).length,
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
      high: records.filter(v => Number(v.data_quality_score || deriveDataQualityScore(v).data_quality_score || 0) >= 80).length,
      medium: records.filter(v => Number(v.data_quality_score || deriveDataQualityScore(v).data_quality_score || 0) >= 60 && Number(v.data_quality_score || deriveDataQualityScore(v).data_quality_score || 0) < 80).length,
      low: records.filter(v => Number(v.data_quality_score || deriveDataQualityScore(v).data_quality_score || 0) >= 40 && Number(v.data_quality_score || deriveDataQualityScore(v).data_quality_score || 0) < 60).length,
      needs_cleanup: records.filter(v => Number(v.data_quality_score || deriveDataQualityScore(v).data_quality_score || 0) < 40).length
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

function readJsonFile(path, fallback = null) {
  try {
    return fs.existsSync(path) ? JSON.parse(fs.readFileSync(path, "utf8")) : fallback;
  } catch {
    return fallback;
  }
}

function countJsonRows(value) {
  if (Array.isArray(value)) return value.length;
  if (Array.isArray(value?.data)) return value.data.length;
  if (Array.isArray(value?.items)) return value.items.length;
  if (Array.isArray(value?.vessels)) return value.vessels.length;
  if (Array.isArray(value?.candidates)) return value.candidates.length;
  if (value && typeof value === "object") {
    return Number(value.record_count || value.all_vessels_count || value.target_vessels_count || value.candidate_count || 0);
  }
  return 0;
}

function normalizeServingMode(mode, fallback = "static_json") {
  const value = String(mode || "").trim().toLowerCase();
  if (["worker_supabase", "static_json", "local_diagnostics"].includes(value)) return value;
  if (value === "production_api") return "static_json";
  if (value === "debug_diagnostics_only" || value === "diagnostics_only") return "local_diagnostics";
  if (value === "mixed") return "worker_supabase";
  return fallback;
}

function isSupabaseWriteCompleted(status) {
  return ["completed", "synced"].includes(String(status || "").toLowerCase());
}

function isSupabaseWriteFinal(status) {
  return ["completed", "failed"].includes(String(status || "").toLowerCase());
}

async function saveFinalDashboardDatasetToSupabase(records, { runId, startedAt, status }) {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { status: "not_configured" };
  }
  const result = await saveToSupabase(records, {
    runId,
    startedAt,
    diagnostics: getCollectorDiagnostics(),
    status
  });
  const finalized = result?.post_write_verification?.status === "completed";
  return {
    status: finalized ? "completed" : "failed",
    legacy_status: finalized ? "synced" : null,
    storage_finalization_status: result?.post_write_verification?.status || "unknown",
    ...result,
    promotion_blockers: result?.promotion?.promotion_blockers || result?.post_write_verification?.promotion_blockers || [],
    post_write_verification: result?.post_write_verification || {
      status: "failed",
      errors: ["missing_post_write_verification"]
    },
    failure_behavior: finalized ? null : {
      fail_production_run: true,
      preserve_previous_successful_static_outputs: true,
      dashboard_banner: "최신 수집은 완료됐지만 DB 저장이 완료되지 않아 마지막 정상 데이터를 표시 중입니다."
    }
  };
}

function promotionRequiredInProduction() {
  return String(process.env.REQUIRE_PROMOTION_IN_PRODUCTION || "true").toLowerCase() !== "false";
}

function classifySupabasePersistenceIssue(supabaseWrite = {}) {
  const status = String(supabaseWrite?.status || "").toLowerCase();
  const verification = supabaseWrite?.post_write_verification || {};
  if (!isSupabaseWriteCompleted(status)) return "db_write_failed";
  if (verification.status && verification.status !== "completed") return "post_write_verification_failed";
  if (verification.promotion_errors?.includes("active_dataset_pointer_run_id_mismatch")) return "active_dataset_pointer_not_updated";
  if (verification.promotion_errors?.includes("active_dataset_pointer_not_promoted") || supabaseWrite.promoted === false) return "promotion_blocked";
  return null;
}

function baseDatasetEmptyFields({ dataMode = "", recordCount = 0, allCollectedCount = 0, vesselCount = 0 } = {}) {
  const mode = String(dataMode || "").toLowerCase();
  const baseRows = Math.max(Number(recordCount || 0), Number(allCollectedCount || 0), Number(vesselCount || 0));
  const empty = baseRows <= 0 || mode === "no_live_data" || mode === "degraded_sample_only";
  return {
    base_dataset_empty: empty,
    derived_from_empty_dataset: empty,
    source_vessel_dataset_count: baseRows,
    base_dataset_empty_reasons: [
      baseRows <= 0 ? "base_dataset_rows_zero" : null,
      Number(recordCount || 0) <= 0 ? "record_count_zero" : null,
      Number(allCollectedCount || 0) <= 0 ? "all_collected_vessels_zero" : null,
      mode === "no_live_data" ? "no_live_data" : null,
      mode === "degraded_sample_only" ? "degraded_sample_only" : null
    ].filter(Boolean)
  };
}

function buildStaticApiPayload(path, payload, report = {}) {
  const normalizedPath = String(path || "").replace(/\\/g, "/");
  if (!normalizedPath.startsWith("dashboard/api/") || !Array.isArray(payload)) return payload;
  const servingMode = normalizeServingMode(report.serving_mode || report.output_mode || (shouldWriteDebugApiOutputs(report) ? "local_diagnostics" : "static_json"));
  return {
    serving_mode: servingMode,
    data_source_used: report.data_source_used || (servingMode === "local_diagnostics" ? "diagnostics_only_no_live_data" : "static_json_snapshot"),
    fallback_used: Boolean(report.fallback_used),
    fallback_reason: report.fallback_reason || null,
    run_id: report.run_id || null,
    active_run_id: report.active_run_id || report.run_id || null,
    generated_at: report.generated_at || report.completed_at || new Date().toISOString(),
    data_freshness: report.data_freshness || {
      active_collected_at: report.completed_at || report.generated_at || null
    },
    record_count: payload.length,
    data: payload
  };
}

function writeStaticDatasetJson(path, payload, report = {}, manifest = {}) {
  const outputPath = routeApiOutputPath(path, report);
  const outputPayload = buildStaticApiPayload(path, payload, report);
  if (outputPath !== path) {
    const incomingRows = countJsonRows(outputPayload);
    fs.mkdirSync(outputPath.split("/").slice(0, -1).join("/"), { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify(outputPayload, null, 2));
    const rootOutputCreated = !fs.existsSync(path);
    if (rootOutputCreated) {
      fs.mkdirSync(path.split("/").slice(0, -1).join("/"), { recursive: true });
      fs.writeFileSync(path, JSON.stringify(outputPayload, null, 2));
    }
    manifest[path] = {
      status: "written_to_debug_only",
      output_path: outputPath,
      root_output_created_if_missing: rootOutputCreated,
      rows: incomingRows,
      reason: "no_live_data_must_not_overwrite_production_api_files"
    };
    return manifest[path];
  }
  const existingPayload = readJsonFile(path, null);
  const existingRows = countJsonRows(existingPayload);
  const incomingRows = countJsonRows(outputPayload);
  const shouldPreserve = shouldWriteDebugApiOutputs(report) && existingRows > 0;
  fs.mkdirSync(path.split("/").slice(0, -1).join("/"), { recursive: true });
  if (shouldPreserve) {
    manifest[path] = {
      status: "preserved_previous_successful_static_output",
      rows: existingRows,
      incoming_rows: incomingRows,
      reason: "last_successful_dataset_lock_prevented_overwrite"
    };
    return manifest[path];
  }
  fs.writeFileSync(path, JSON.stringify(outputPayload, null, 2));
  manifest[path] = {
    status: "written",
    rows: incomingRows,
    previous_rows: existingRows
  };
  return manifest[path];
}

function buildReadinessGateReport({ report = {}, vessels = [], generatedAt = new Date().toISOString() } = {}) {
  const statusRunId = report.run_id || report.active_run_id || report.summary_run_id || null;
  const vesselRunIds = [...new Set(vessels.map(v => v.run_id).filter(Boolean))];
  const inferredRunId = vesselRunIds.length === 1 ? vesselRunIds[0] : statusRunId;
  const staleReadinessGate = Boolean(statusRunId && inferredRunId && String(statusRunId) !== String(inferredRunId));
  const dataMode = String(report.data_mode || report.data_mode_detail?.mode || "").toLowerCase();
  const total = vessels.length;
  const recordCount = Number(report.record_count || 0);
  const baseDatasetState = baseDatasetEmptyFields({
    dataMode,
    recordCount,
    allCollectedCount: report.all_collected_vessel_count || 0,
    vesselCount: total
  });
  const emptyDataset = baseDatasetState.base_dataset_empty || total === 0 || recordCount === 0;
  const noLiveData = dataMode === "no_live_data";
  const productionReady = !staleReadinessGate && !emptyDataset && !noLiveData;
  return {
    version: VERSION,
    run_id: statusRunId,
    status_run_id: statusRunId,
    vessels_run_id: inferredRunId,
    active_run_id: statusRunId,
    generated_at: generatedAt,
    status_generated_at: report.completed_at || report.generated_at || null,
    ...baseDatasetState,
    total,
    salesReady: vessels.filter(v => v.commercial_use_status === "sales_review_ready").length,
    blockedSample: vessels.filter(v => v.commercial_use_status === "do_not_use_for_outreach").length,
    sampleImmediateBlocked: vessels.filter(v => v.commercial_use_status === "do_not_use_for_outreach" && v.is_immediate_candidate).length,
    operatingImmediate: vessels.filter(v => v.is_operating_immediate_candidate).length,
    readiness_status: emptyDataset || noLiveData ? "empty_dataset" : staleReadinessGate ? "stale" : "ready",
    empty_dataset_reasons: [
      total === 0 ? "total_is_zero" : null,
      recordCount === 0 ? "record_count_is_zero" : null,
      noLiveData ? "no_live_data" : null
    ].filter(Boolean),
    data_mode: report.data_mode || null,
    record_count: recordCount,
    production_ready: productionReady,
    validation_mode: process.env.VALIDATION_MODE || (process.env.CI === "true" ? "production" : "local"),
    stale_readiness_gate: staleReadinessGate,
    stale_reasons: [
      staleReadinessGate ? "vessels.json run_id does not match status.json run_id" : null
    ].filter(Boolean),
    status_run_id_match: !staleReadinessGate,
    ok: productionReady && vessels.every(v => !String(v.source_mode || "").includes("sample") || v.commercial_use_status === "do_not_use_for_outreach"),
    note: "Generated by scripts/update.js for the current status.json run_id so validation never reuses stale readiness output."
  };
}

function buildSnapshotGuardRuntimeReport({ report = {}, dashboardSummary = {}, allCollectedVessels = [], targetVessels = [], vessels = [], candidateList = [], generatedAt = new Date().toISOString() } = {}) {
  const fileRows = {
    "dashboard/api/vessels.json": vessels.length,
    "dashboard/api/all-collected-vessels.json": allCollectedVessels.length,
    "dashboard/api/target-vessels.json": targetVessels.length,
    "dashboard/api/candidates.json": candidateList.length,
    "dashboard/api/dashboard-summary.json": Number(dashboardSummary.record_count || 0)
  };
  const recordCount = Number(report.record_count || 0);
  const vesselsJsonRows = Number(fileRows["dashboard/api/vessels.json"] || 0);
  const allCollectedRows = Number(report.all_collected_vessel_count || allCollectedVessels.length || 0);
  const targetVesselsRows = Number(fileRows["dashboard/api/target-vessels.json"] || 0);
  const dashboardSummaryRecordCount = Number(dashboardSummary.record_count || 0);
  const dataMode = String(report.data_mode || report.data_mode_detail?.mode || "").toLowerCase();
  const baseDatasetState = baseDatasetEmptyFields({
    dataMode,
    recordCount,
    allCollectedCount: allCollectedRows,
    vesselCount: vesselsJsonRows
  });
  const emptyDataset = baseDatasetState.base_dataset_empty || recordCount === 0 || vesselsJsonRows === 0 || allCollectedRows === 0 || dashboardSummaryRecordCount === 0;
  const localNoLiveData = VALIDATION_MODE === "local" && dataMode === "no_live_data";
  const statusRunId = report.run_id || report.active_run_id || runId;
  const diagnosticRunId = report.run_id || runId;
  const staleDiagnostic = Boolean(statusRunId && diagnosticRunId && String(statusRunId) !== String(diagnosticRunId));
  const ok = !emptyDataset && !staleDiagnostic;
  return {
    version: VERSION,
    run_id: diagnosticRunId,
    status_run_id: statusRunId,
    active_run_id: report.active_run_id || statusRunId,
    generated_at: generatedAt,
    stale_diagnostic: staleDiagnostic,
    ...baseDatasetState,
    validation_mode: VALIDATION_MODE,
    data_mode: dataMode || "unknown",
    record_count: recordCount,
    dashboard_summary_record_count: dashboardSummaryRecordCount,
    vessels_json_count: vesselsJsonRows,
    all_collected_vessels_count: allCollectedRows,
    target_vessels_count: targetVesselsRows,
    required: Object.keys(fileRows),
    missing: [],
    empty: Object.entries(fileRows).filter(([, rows]) => Number(rows || 0) === 0).map(([file]) => file),
    file_rows: fileRows,
    row_count_validation: {
      "dashboard/api/vessels.json": {
        rows: vesselsJsonRows,
        ok: vesselsJsonRows > 0
      },
      "dashboard/api/all-collected-vessels.json": {
        rows: allCollectedRows,
        ok: allCollectedRows > 0
      },
      "dashboard/api/target-vessels.json": {
        rows: targetVesselsRows,
        ok: targetVesselsRows > 0,
        severity: targetVesselsRows > 0 ? "ready" : "warning"
      },
      "dashboard/api/dashboard-summary.json": {
        record_count: dashboardSummaryRecordCount,
        ok: dashboardSummaryRecordCount > 0
      }
    },
    status: emptyDataset ? "empty_dataset" : "ready",
    guard_severity: emptyDataset ? localNoLiveData ? "diagnostics_only" : "fatal" : "ready",
    ok,
    production_ready: ok && VALIDATION_MODE === "production",
    diagnostics_only: localNoLiveData && emptyDataset,
    warning: localNoLiveData && emptyDataset
      ? "local/no-secret no_live_data snapshot has no rows and is diagnostics-only"
      : targetVesselsRows === 0
        ? "target-vessels.json has zero rows; validate candidate generation separately"
        : staleDiagnostic
          ? "snapshot-guard run_id does not match status.json run_id"
          : null
  };
}

function buildCollectorPlanRuntimeReport({ report = {}, collectorDiagnostics = {}, generatedAt = new Date().toISOString() } = {}) {
  const plan = collectorDiagnostics.port_operation_collection_plan || {};
  const preflight = collectorDiagnostics.preflight || {};
  const coverage = collectorDiagnostics.coverage || {};
  const baseDatasetState = baseDatasetEmptyFields({
    dataMode: report.data_mode || report.data_mode_detail?.mode,
    recordCount: report.record_count,
    allCollectedCount: report.all_collected_vessel_count,
    vesselCount: report.target_vessel_count
  });
  return {
    version: VERSION,
    run_id: report.run_id || runId,
    active_run_id: report.active_run_id || report.run_id || runId,
    generated_at: generatedAt,
    status: baseDatasetState.base_dataset_empty ? "empty_dataset" : report.data_mode === "no_live_data" ? "blocked" : "ready",
    ...baseDatasetState,
    ok: !baseDatasetState.base_dataset_empty,
    validation_mode: VALIDATION_MODE,
    sequence: ["config_preflight", "source_health", "port_operation", "normalization", "candidate_engine", "snapshot_guard"],
    target: "safe port-operation collection and current-run diagnostics",
    port_operation_collector_enabled: Boolean(plan.port_operation_collector_enabled || preflight.port_operation_collector_enabled),
    port_operation_service_key_present: Boolean(plan.port_operation_secret_present || preflight.port_operation_secret_present),
    port_operation_api_url_present: Boolean(plan.port_operation_api_url_present || preflight.port_operation_api_url_present),
    port_operation_api_url_effective: Boolean(plan.port_operation_api_url_effective || preflight.port_operation_api_url_effective),
    port_operation_api_url_default_used: Boolean(plan.port_operation_api_url_default_used || preflight.port_operation_api_url_default_used),
    enabled_ports_loaded_count: Number(plan.enabled_ports_loaded_count || preflight.enabled_ports_loaded_count || 0),
    enabled_ports_passed_to_collector_count: Number(plan.enabled_ports_passed_to_collector_count || preflight.enabled_ports_passed_to_collector_count || 0),
    ports_attempted_count: Number(coverage.ports_attempted_count || collectorDiagnostics.ports_attempted_count || 0),
    preflight_status: collectorDiagnostics.preflight_status || (preflight.ok === false ? "failed" : null),
    preflight_failure_reason: collectorDiagnostics.preflight_failure_reason || preflight.preflight_failure_reason || null,
    collector_not_attempted: Number(coverage.ports_attempted_count || collectorDiagnostics.ports_attempted_count || 0) === 0,
    collector_not_attempted_reason: report.collector_not_attempted_reason || collectorDiagnostics.collector_not_attempted_reason || null,
    first_5_ports_to_attempt: plan.first_5_ports_to_attempt || preflight.first_5_ports_to_attempt || []
  };
}

function buildSourceHealthRuntimeReport({ report = {}, collectorDiagnostics = {}, generatedAt = new Date().toISOString() } = {}) {
  const sources = Array.isArray(collectorDiagnostics.sources) ? collectorDiagnostics.sources : [];
  const plan = collectorDiagnostics.port_operation_collection_plan || {};
  const coverage = collectorDiagnostics.coverage || {};
  const runtimeAudit = report.runtime_config_audit || runtimeConfigAudit;
  const attemptedCollectors = sources.filter(source => source.attempted).map(source => source.key || source.source_name);
  const baseDatasetState = baseDatasetEmptyFields({
    dataMode: report.data_mode || report.data_mode_detail?.mode,
    recordCount: report.record_count,
    allCollectedCount: report.all_collected_vessel_count,
    vesselCount: report.target_vessel_count
  });
  const skippedCollectors = sources.filter(source => source.skipped).map(source => ({
    source_name: source.key || source.source_name || source.label || "unknown_source",
    reason: source.skip_reason || source.reason || source.error_message || source.status || "unknown_error",
    raw_reason: source.raw_skip_reason || source.reason || source.error_message || source.status || null
  }));
  return {
    version: VERSION,
    run_id: report.run_id || runId,
    status_run_id: report.run_id || runId,
    generated_at: generatedAt,
    validation_mode: VALIDATION_MODE,
    serving_mode: normalizeServingMode(report.output_mode || (shouldWriteDebugApiOutputs(report) ? "local_diagnostics" : "static_json")),
    ...baseDatasetState,
    ok: !baseDatasetState.base_dataset_empty,
    update_mode: process.env.UPDATE_MODE || null,
    process_env_CI: process.env.CI || null,
    is_github_actions: process.env.GITHUB_ACTIONS === "true",
    is_local_build: process.env.GITHUB_ACTIONS !== "true",
    collection_mode: report.data_mode === "no_live_data" ? "no_live_data" : "collection_result",
    status_generated_at: report.completed_at || report.generated_at || null,
    stale_source_health: false,
    secrets_present: runtimeAudit.canonical_env_present || {},
    runtime_config_audit: runtimeAudit,
    expected_env_names: runtimeAudit.expected_env_names || [],
    accepted_fallback_env_names: runtimeAudit.accepted_fallback_env_names || {},
    missing_required_env_names: runtimeAudit.missing_required_env_names || [],
    enabled_collectors: [...new Set(sources.map(source => source.key || source.source_name).filter(Boolean))],
    attempted_collectors: attemptedCollectors,
    skipped_collectors: skippedCollectors,
    port_operation: {
      collector_enabled: Boolean(plan.port_operation_collector_enabled),
      secret_present: Boolean(plan.port_operation_secret_present),
      canonical_service_key_present: Boolean(runtimeAudit.canonical_env_present?.PORT_OPERATION_SERVICE_KEY),
      api_url_present: Boolean(plan.port_operation_api_url_present),
      api_url_effective: Boolean(plan.port_operation_api_url_effective),
      api_url_default_used: Boolean(plan.port_operation_api_url_default_used),
      enabled_ports_loaded_count: Number(plan.enabled_ports_loaded_count || 0),
      enabled_ports_passed_to_collector_count: Number(plan.enabled_ports_passed_to_collector_count || 0),
      ports_attempted_count: Number(coverage.ports_attempted_count || collectorDiagnostics.ports_attempted_count || 0),
      collector_not_attempted: Number(coverage.ports_attempted_count || collectorDiagnostics.ports_attempted_count || 0) === 0,
      collector_not_attempted_reason: report.collector_not_attempted_reason || collectorDiagnostics.collector_not_attempted_reason || null,
      ports_skipped_reason: plan.ports_skipped_reason || collectorDiagnostics.skip_reason || null,
      first_5_ports_to_attempt: plan.first_5_ports_to_attempt || [],
      smoke_test_status: collectorDiagnostics.smoke_test_status || collectorDiagnostics.port_operation_smoke_test?.smoke_test_status || null,
      smoke_test_failure_reason: collectorDiagnostics.smoke_test_failure_reason || collectorDiagnostics.port_operation_smoke_test?.smoke_test_failure_reason || null
    },
    preflight: collectorDiagnostics.preflight || null,
    preflight_status: collectorDiagnostics.preflight_status || null,
    preflight_failure_reason: collectorDiagnostics.preflight_failure_reason || collectorDiagnostics.preflight?.preflight_failure_reason || null,
    collector_not_attempted: report.collector_not_attempted,
    collector_not_attempted_reason: report.collector_not_attempted_reason,
    realDataReady: Number(report.record_count || 0) > 0
  };
}

function buildDatasetGenerationAudit({
  report = {},
  collectedRows = [],
  allCollectedVessels = [],
  targetVessels = [],
  salesCandidates = [],
  immediateTargets = [],
  candidateList = [],
  collectorDiagnostics = {},
  supabaseWrite = {}
} = {}) {
  const sourceRowsCollected = Number(collectedRows.length || collectorDiagnostics.raw_row_count || collectorDiagnostics.actionable_row_count || 0);
  const normalizedRows = Number(allCollectedVessels.length || 0);
  const allVesselsGenerated = normalizedRows;
  const portOperationPlan = collectorDiagnostics.port_operation_collection_plan || {};
  const coverage = collectorDiagnostics.coverage || {};
  const portOperationSources = Array.isArray(collectorDiagnostics.sources)
    ? collectorDiagnostics.sources.filter(source => String(source.key || source.source_name || "").startsWith("port_operation_"))
    : [];
  const portOperationAttempted = portOperationSources.filter(source => source.attempted);
  const enabledPortsCount = Number(portOperationPlan.enabled_ports_loaded_count || coverage.enabled_ports_count || collectorDiagnostics.enabled_ports_count || 0);
  const portsAttemptedCount = Number(
    coverage.ports_attempted_count ||
    collectorDiagnostics.ports_attempted_count ||
    new Set(portOperationAttempted.map(source => source.prtAgCd).filter(Boolean)).size
  );
  const portOperationRowsCollected = portOperationAttempted.reduce((sum, source) => sum + Number(source.rows_collected || source.row_count || 0), 0);
  const preflight = collectorDiagnostics.preflight || {};
  const missingConfig = missingPortOperationRequiredConfig();
  const collectorNotAttempted = portsAttemptedCount === 0;
  const collectorNotAttemptedReason = collectorNotAttempted
    ? missingConfig.includes("PORT_OPERATION_SERVICE_KEY") && missingConfig.includes("PORT_OPERATION_API_URL")
      ? "missing_service_key_and_api_url"
      : collectorDiagnostics.preflight_failure_reason || preflight.preflight_failure_reason || portOperationPlan.ports_skipped_reason || collectorDiagnostics.skip_reason || "unknown_error"
    : null;
  const watchlistGenerated = allCollectedVessels.filter(v => !isSalesCandidate(v) && isWatchlistVessel(v)).length;
  const salesTargetsGenerated = Number(salesCandidates.length || 0);
  const immediateTargetsGenerated = Number(immediateTargets.length || 0);
  const vesselsJsonRows = Number(targetVessels.length || 0);
  const allCollectedJsonRows = Number(allCollectedVessels.length || 0);
  const targetJsonRows = Number(targetVessels.length || 0);
  const candidatesJsonRows = Number(candidateList.length || 0);
  const baseDatasetState = baseDatasetEmptyFields({
    dataMode: report?.data_mode || report?.data_mode_detail?.mode,
    recordCount: report?.record_count,
    allCollectedCount: allCollectedJsonRows,
    vesselCount: vesselsJsonRows
  });
  const requiredSecretsMissing = detectSecrets()
    .filter(item => item.status !== "enabled" && Array.isArray(item.missing) && item.missing.length)
    .flatMap(item => item.missing);
  const skippedSources = Array.isArray(collectorDiagnostics?.sources)
    ? collectorDiagnostics.sources.filter(source => source.skipped || String(source.status || "").toLowerCase() === "skipped")
    : [];
  const previousSuccessfulDatasetAvailable = [
    "dashboard/api/vessels.json",
    "dashboard/api/all-collected-vessels.json",
    "dashboard/api/target-vessels.json",
    "dashboard/api/candidates.json"
  ].some(path => countJsonRows(readJsonFile(path, [])) > 0);
  const gateAudit = {
    ports_registry_gate: enabledPortsCount > 0 ? "pass" : "blocked",
    port_operation_attempt_gate: portsAttemptedCount > 0 ? "pass" : "blocked",
    collection_gate: sourceRowsCollected > 0 ? "pass" : "blocked",
    normalization_gate: sourceRowsCollected > 0 ? (normalizedRows > 0 ? "pass" : "blocked") : "not_reached",
    all_vessels_gate: normalizedRows > 0 ? "pass" : "blocked",
    candidate_generation_gate: normalizedRows > 0 ? "pass" : "not_reached",
    supabase_promotion_gate: isSupabaseWriteCompleted(supabaseWrite?.status) ? "pass" : "not_promoted",
    static_export_gate: vesselsJsonRows > 0 || report?.data_mode === "no_live_data" ? "completed" : "empty_export"
  };
  let failedStage = null;
  let rootCause = "dataset_generation_completed";
  if (sourceRowsCollected === 0) {
    failedStage = preflight.ok === false ? "collector_preflight" : portsAttemptedCount === 0 ? "source_collection_not_attempted" : "source_collection";
    rootCause = portsAttemptedCount === 0
      ? (collectorNotAttemptedReason || collectorDiagnostics.preflight_failure_reason || preflight.preflight_failure_reason || portOperationPlan.ports_skipped_reason || (!portOperationPlan.port_operation_secret_present ? "missing_PORT_OPERATION_SERVICE_KEY" : !portOperationPlan.port_operation_api_url_present ? "missing_PORT_OPERATION_API_URL" : "port_operation_collector_not_attempted"))
      : report?.data_mode === "no_live_data"
        ? "local_static_no_live_data_export_without_required_secrets"
        : "source_collection_returned_zero_rows";
  } else if (normalizedRows === 0) {
    failedStage = "normalization";
    rootCause = "source_rows_collected_but_no_valid_normalized_vessels";
  } else if (!allVesselsGenerated) {
    failedStage = "all_vessels_generation";
    rootCause = "normalized_rows_exist_but_all_vessels_generation_empty";
  } else if (!vesselsJsonRows && report?.record_count !== 0) {
    failedStage = "api_export";
    rootCause = "active_dataset_exists_but_vessels_json_export_empty";
  }
  const gateBlockReasons = [];
  if (preflight.ok === false) gateBlockReasons.push(`Collector preflight failed: ${preflight.preflight_failure_reason || collectorDiagnostics.preflight_failure_reason || "unknown"}.`);
  if (!portsAttemptedCount) gateBlockReasons.push("No enabled Port Operation ports were attempted.");
  if (!sourceRowsCollected) gateBlockReasons.push("No source rows were collected in this local/static run.");
  if (report?.data_mode === "no_live_data") gateBlockReasons.push("data_mode is no_live_data, so generated JSON intentionally contains zero vessels/candidates.");
  if (report?.supabase_status === "not_configured") gateBlockReasons.push("Supabase is not configured for this run; production must use Worker/Supabase active_dataset_pointer instead of static fallback JSON.");
  if (collectorDiagnostics?.fallback_used) gateBlockReasons.push("Collector fallback/no-live-data guard was used.");
  if (supabaseWrite?.status && !isSupabaseWriteCompleted(supabaseWrite.status)) gateBlockReasons.push(`Supabase write status: ${supabaseWrite.status}.`);
  return {
    generated_at: new Date().toISOString(),
    audit_type: "dataset_generation",
    ...baseDatasetState,
    ok: !baseDatasetState.base_dataset_empty,
    root_cause: rootCause,
    failed_stage: failedStage,
    counts_by_stage: {
      enabled_ports_count: enabledPortsCount,
      ports_attempted_count: portsAttemptedCount,
      source_rows_collected: sourceRowsCollected,
      port_operation_source_rows_collected: portOperationRowsCollected,
      normalized_rows: normalizedRows,
      all_vessels_generated: allVesselsGenerated,
      port_call_master_count: Number(report?.port_call_master_count || report?.port_call_id_count || allCollectedVessels.filter(v => v.port_call_id).length || 0),
      watchlist_generated: watchlistGenerated,
      sales_targets_generated: salesTargetsGenerated,
      immediate_targets_generated: immediateTargetsGenerated,
      static_all_collected_rows: allCollectedJsonRows,
      static_target_rows: targetJsonRows,
      vessels_json_rows: vesselsJsonRows,
      candidates_json_rows: candidatesJsonRows
    },
    enabled_ports_count: enabledPortsCount,
    preflight_status: collectorDiagnostics.preflight_status || (preflight.ok === false ? "failed" : null),
    preflight_failure_reason: collectorDiagnostics.preflight_failure_reason || preflight.preflight_failure_reason || null,
    skip_reason: collectorDiagnostics.skip_reason || collectorDiagnostics.preflight_failure_reason || preflight.preflight_failure_reason || null,
    smoke_test_status: collectorDiagnostics.smoke_test_status || collectorDiagnostics.port_operation_smoke_test?.smoke_test_status || null,
    smoke_test_failure_reason: collectorDiagnostics.smoke_test_failure_reason || collectorDiagnostics.port_operation_smoke_test?.smoke_test_failure_reason || null,
    port_operation_smoke_test: collectorDiagnostics.port_operation_smoke_test || null,
    preflight_failures: preflight.failures || [],
    enabled_ports_loaded_count: Number(portOperationPlan.enabled_ports_loaded_count || enabledPortsCount),
    enabled_ports_passed_to_collector_count: Number(portOperationPlan.enabled_ports_passed_to_collector_count || 0),
    ports_attempted_count: portsAttemptedCount,
    collector_not_attempted: collectorNotAttempted,
    collector_not_attempted_reason: collectorNotAttemptedReason,
    port_operation_collector_enabled: Boolean(portOperationPlan.port_operation_collector_enabled || enabledPortsCount > 0),
    port_operation_secret_present: Boolean(portOperationPlan.port_operation_secret_present),
    port_operation_api_url_present: Boolean(portOperationPlan.port_operation_api_url_present),
    ports_skipped_reason: portOperationPlan.ports_skipped_reason || collectorDiagnostics.skip_reason || null,
    first_5_ports_to_attempt: portOperationPlan.first_5_ports_to_attempt || [],
    source_rows_collected: sourceRowsCollected,
    normalized_rows: normalizedRows,
    all_vessels_generated: allVesselsGenerated,
    port_call_master_count: Number(report?.port_call_master_count || report?.port_call_id_count || allCollectedVessels.filter(v => v.port_call_id).length || 0),
    watchlist_generated: watchlistGenerated,
    sales_targets_generated: salesTargetsGenerated,
    immediate_targets_generated: immediateTargetsGenerated,
    target_vessels_generated: targetVessels.length,
    static_all_collected_rows: allCollectedJsonRows,
    static_target_rows: targetJsonRows,
    vessels_json_rows: vesselsJsonRows,
    candidates_json_rows: candidatesJsonRows,
    active_dataset_audit: {
      status_json_run_id: report?.run_id || null,
      latest_successful_run: report?.latest_successful_summary_run_id || report?.summary_run_id || null,
      current_run: report?.run_id || null,
      status_json_generated_at: report?.completed_at || report?.generated_at || null,
      vessels_json_basis: "dashboard/api/vessels.json is a static export of targetVessels from this run",
      candidates_json_basis: "dashboard/api/candidates.json is a static export of candidateList from this run",
      production_serving_rule: "Worker APIs should read Supabase active_dataset_pointer and latest successful summary snapshots; local no_live_data JSON must not be treated as production data."
    },
    required_secrets_missing: requiredSecretsMissing,
    collectors_skipped: skippedSources.map(source => ({
      source_name: source.key || source.source_name || source.label || "unknown_source",
      reason: source.reason || source.error_message || source.status || "skipped"
    })),
    static_outputs_generated: {
      "dashboard/api/vessels.json": vesselsJsonRows,
      "dashboard/api/all-collected-vessels.json": allVesselsGenerated,
      "dashboard/api/target-vessels.json": targetVessels.length,
      "dashboard/api/candidates.json": candidatesJsonRows,
      "dashboard/api/dashboard-summary.json": report?.record_count || 0
    },
    production_promotion_blocked: report?.data_mode === "no_live_data" ||
      Boolean(supabaseWrite?.promotion?.no_live_data_not_promotable) ||
      Boolean(supabaseWrite?.status && !isSupabaseWriteCompleted(supabaseWrite.status)),
    previous_successful_dataset_available: previousSuccessfulDatasetAvailable,
    gate_audit: gateAudit,
    gate_block_reasons: gateBlockReasons,
    recommended_fix: [
      "Do not use stale dashboard/api/*.json files as the production dataset when Supabase/Worker active dataset is available.",
      "Keep Cloudflare upload skip rules for generated dashboard/api JSON assets.",
      "Use /api/dashboard-summary.json and /api/vessels?group=all from the Worker to verify the live active dataset.",
      "If source_rows_collected is zero in GitHub Actions, check required secrets and source collector logs before debugging scoring."
    ]
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
    const portInfo = normalizedPortInfo(v);
    const port = portInfo.display_name;
    const current = ports.get(port) || {
      port,
      port_code: portInfo.port_code,
      port_name: portInfo.display_name,
      display_name: portInfo.display_name,
      total: 0,
      waiting: 0,
      anchorage_vessels: 0,
      long_stay: 0,
      long_idle_vessels: 0,
      high_biofouling: 0,
      immediate: 0,
      score: 0,
      waiting_hours_total: 0,
      berth_hours_total: 0,
      raw_aliases: new Set()
    };
    if (portInfo.raw) current.raw_aliases.add(String(portInfo.raw).trim());
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
      raw_aliases: [...p.raw_aliases].sort((left, right) => left.localeCompare(right, "ko")),
      average_waiting_time: p.waiting ? Math.round((p.waiting_hours_total / p.waiting) * 10) / 10 : 0,
      berth_occupancy: p.total ? Math.min(100, Math.round((p.berth_hours_total / Math.max(1, p.total * 24)) * 100)) : 0,
      anchorage_density: p.total ? Math.min(100, Math.round((p.anchorage_vessels / p.total) * 100)) : 0,
      congestion_score: p.total ? Math.min(100, Math.round(p.score / p.total + p.waiting * 4 + p.long_stay * 5 + p.immediate * 8)) : 0
    }))
    .sort((a, b) => b.congestion_score - a.congestion_score || b.immediate - a.immediate || b.high_biofouling - a.high_biofouling);
}

function buildPortAnchorage(records, portCode) {
  const rows = records.filter(v => String(normalizedPortInfo(v).port_code) === String(portCode));
  return sortCommercialPriority(rows.filter(v => v.is_anchorage_waiting || (v.anchorage_hours || 0) > 0 || /waiting|anchorage|anchor|idle|drifting/i.test(v.status || "")))
    .map(v => ({
      vessel_id: v.vessel_id,
      vessel_name: v.vessel_name,
      port_code: normalizedPortInfo(v).port_code || portCode,
      port_name: normalizedPortInfo(v).display_name,
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
  const liveReady = !fallbackUsed && enabledSources.length > 0 && sampleRows < records.length && isSupabaseWriteCompleted(supabaseStatus);
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
  startupConfigDiagnostics = validateRequiredConfig({ throwOnMissing: false });
  runtimeConfigAudit = buildRuntimeConfigAudit();
  console.log("[HWK] config diagnostics", JSON.stringify({
    required_config_ok: startupConfigDiagnostics.required_config_ok,
    missing_required_config: startupConfigDiagnostics.missing_required_config,
    enabled_sources: startupConfigDiagnostics.enabled_sources,
    enabled_ports_count: startupConfigDiagnostics.enabled_ports_count,
    active_runtime_limits: startupConfigDiagnostics.active_runtime_limits
  }));
  printRuntimeConfigAudit(runtimeConfigAudit);
  const apiSources = detectSecrets();
  console.log(`[HWK] API groups enabled: ${apiSources.filter(s => s.enabled).map(s => s.key).join(", ") || "none"}`);
  const dictionaries = loadReferenceDictionaries();
  collectedRows = await collectKoreaData({ apiSources });
  collectorDiagnosticsAfterCollection = getCollectorDiagnostics();
  const referenceEnrichedRows = enrichWithReferenceDictionaries(collectedRows, dictionaries);
  const cacheResult = await enrichWithVesselMasterCache(referenceEnrichedRows);
  vesselMasterCacheDiagnostics = cacheResult.diagnostics;
  vessels = dedupeVesselDataset(
    enhancePredictiveArrivalIntelligence(annotateFleetIntelligence(enrichSalesSignals(annotateRepeatCallerIntelligence(cacheResult.records))))
  );
  vessels = dedupeVesselDataset(
    ensureOutputContractFields(activeRecordsOnly(vessels), {
      runId,
      generatedAt: new Date().toISOString(),
      dataSourceUsed: "supabase_normalized_snapshot"
    })
  );
  annotateTargetClassification(vessels);
  vessels.sort((a, b) => (b.cleaning_candidate_score || 0) - (a.cleaning_candidate_score || 0) || (b.risk_score || 0) - (a.risk_score || 0));

  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    supabaseWrite = {
      status: "pending_final_snapshot",
      note: "Supabase write is deferred until the merged dashboard snapshot is classified."
    };
    supabaseStatus = supabaseWrite.status;
  }
} catch (error) {
  status = "failed";
  errorMessage = error?.message || String(error);
  if (supabaseWrite?.status === "syncing") {
    supabaseWrite = {
      status: "failed",
      error: errorMessage,
      failed_stage: "supabase_write",
      failure_type: error?.failure_type || error?.persistence_failure_type || "db_write_failed",
      post_write_verification: error?.postWriteVerification || {
        status: "failed",
        errors: ["supabase_write_threw_before_finalization"]
      },
      failure_behavior: {
        fail_production_run: true,
        preserve_previous_successful_static_outputs: true,
        dashboard_banner: "최신 수집은 완료됐지만 DB 저장이 완료되지 않아 마지막 정상 데이터를 표시 중입니다."
      },
      note: "Supabase write started but did not complete successfully."
    };
    supabaseStatus = "failed";
  }
  collectorDiagnosticsAfterCollection = getCollectorDiagnostics();
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
  const dataModeDetail = buildDataMode(vessels, detectSecrets(), supabaseStatus);
  const dataMode = dataModeDetail.mode;
  const isFallbackDataset = dataMode === "no_live_data" || dataMode === "degraded_sample_only" || vessels.length === 0;
  const portOperationMissingConfig = missingPortOperationRequiredConfig();
  const portOperationApiUrl = portOperationApiUrlInfo();
  const portsAttemptedCount = Number(collectorDiagnostics.coverage?.ports_attempted_count || collectorDiagnostics.ports_attempted_count || 0);
  const collectorNotAttempted = portsAttemptedCount === 0;
  const collectorNotAttemptedReason = collectorNotAttempted ? portOperationCollectorNotAttemptedReason(collectorDiagnostics) : null;
  const runtimeModeDiagnostics = {
    process_env_CI: process.env.CI || null,
    VALIDATION_MODE: process.env.VALIDATION_MODE || null,
    resolved_validation_mode: VALIDATION_MODE,
    UPDATE_MODE: process.env.UPDATE_MODE || null,
    serving_mode: normalizeServingMode(process.env.SERVING_MODE || "static_json"),
    is_github_actions: process.env.GITHUB_ACTIONS === "true",
    is_local_build: process.env.GITHUB_ACTIONS !== "true",
    generated_by: process.env.GITHUB_ACTIONS === "true" ? "github_actions" : "local",
    GITHUB_RUN_ID: process.env.GITHUB_RUN_ID || null,
    GITHUB_WORKFLOW: process.env.GITHUB_WORKFLOW || null,
    port_operation_service_key_present_effective: portOperationServiceKeyPresent(),
    port_operation_api_url_present: Boolean(process.env.PORT_OPERATION_API_URL),
    port_operation_api_url_effective: portOperationApiUrl.effective_present,
    port_operation_api_url_default_used: portOperationApiUrl.default_used,
    collection_mode: collectorNotAttempted ? "collector_not_attempted" : isFallbackDataset ? "no_live_data" : "source_collection"
  };
  const baseReport = {
    ...buildRunOrigin({ runId, validationMode: VALIDATION_MODE, servingMode: isFallbackDataset ? "local_diagnostics" : "static_json" }),
    version: VERSION,
    build_name: BUILD_NAME,
    status,
    run_id: runId,
    active_run_id: runId,
    generated_at: completedAt,
    last_success_at: completedAt,
    started_at: startedAt,
    completed_at: completedAt,
    data_source_used: isFallbackDataset ? "diagnostics_only_no_live_data" : "static_json_snapshot",
    fallback_used: isFallbackDataset,
    fallback_reason: isFallbackDataset ? "local_or_failed_run_without_live_source_rows" : null,
    validation_mode: VALIDATION_MODE,
    runtime_mode_diagnostics: runtimeModeDiagnostics,
    runtime_config_audit: runtimeConfigAudit,
    expected_env_names: runtimeConfigAudit.expected_env_names,
    accepted_fallback_env_names: runtimeConfigAudit.accepted_fallback_env_names,
    missing_required_env_names: runtimeConfigAudit.missing_required_env_names,
    missing_required_config: portOperationMissingConfig,
    collector_not_attempted: collectorNotAttempted,
    collector_not_attempted_reason: collectorNotAttemptedReason,
    data_status: isFallbackDataset ? "diagnostics_only" : "ready",
    user_message: isFallbackDataset
      ? "운영 데이터가 수집되지 않았습니다. Port Operation API 설정 또는 GitHub Secrets를 확인하세요."
      : "운영 데이터가 정상 수집되었습니다.",
    data_freshness: {
      active_collected_at: completedAt,
      data_age_minutes: 0,
      is_stale: false,
      freshness_policy: {
        port_operation_hours: 24,
        pilot_hours: 6,
        berth_pnc_ulsan_hours: 12,
        ais_vts_hours: 1,
        operator_agent_days: 30
      }
    },
    record_count: vessels.length,
    actionable_rows: actionableRows,
    critical_count: vessels.filter(v => operationalBiofoulingRiskScore(v) >= 85).length,
    high_risk_count: vessels.filter(v => operationalBiofoulingRiskScore(v) >= 70).length,
    compliance_watch_count: vessels.filter(v => v.compliance_watch).length,
    opportunity_usd: vessels.reduce((sum, v) => sum + (v.opportunity_usd || 0), 0),
    candidate_summary: buildCandidateSummary(vessels),
    immediate_candidate_count: vessels.filter(v => v.is_immediate_candidate).length,
    cleaning_candidate_count: vessels.filter(v => v.is_cleaning_candidate).length,
    ports: [...new Set(vessels.map(v => normalizedPortInfo(v).display_name))],
    port_summary: portSummary,
    supabase_status: supabaseStatus,
    supabase_write: supabaseWrite,
    gdrive_archive: gdriveArchive,
    frontend_poll_interval_seconds: 900,
    preflight_status: collectorDiagnostics.preflight_status || null,
    preflight_failure_reason: collectorDiagnostics.preflight_failure_reason || collectorDiagnostics.preflight?.preflight_failure_reason || null,
    collection_schedule: {
      github_actions_cron: "0 */4 * * *",
      meaning: "GitHub Actions collects public data every 4 hours or when manually triggered. The dashboard reads the latest successful Supabase snapshot first and does not collect source APIs in the browser.",
      expected_collection_runtime_minutes: "3-12",
      per_source_timeout_seconds: Math.round(Number(process.env.SOURCE_TIMEOUT_MS || 25000) / 1000)
    },
    data_mode: dataMode,
    data_mode_detail: dataModeDetail,
    collection: {
      real_rows: dataModeDetail.real_rows,
      actionable_rows: actionableRows,
      source_rows_collected: Number(collectorDiagnostics.raw_row_count || collectedRows.length || 0),
      normalized_rows: vessels.length,
      ports_attempted_count: portsAttemptedCount
    },
    api_sources: detectSecrets(),
    config_diagnostics: startupConfigDiagnostics,
    api_registry_version: "korea-port-secret-registry-v12-backend-stability",
    rule_versioning: {
      commercial_rule_version: COMMERCIAL_RULE_VERSION,
      candidate_rule_version: CANDIDATE_RULE_VERSION,
      explainability_rule_version: EXPLAINABILITY_RULE_VERSION,
      candidate_thresholds: {
        watchlist_min_score: 50,
        sales_candidate_threshold: SALES_CANDIDATE_THRESHOLD,
        immediate_target_threshold: IMMEDIATE_TARGET_THRESHOLD,
        critical_target_threshold: CRITICAL_TARGET_THRESHOLD
      }
    },
    data_strategy: buildDataStrategy(detectSecrets()),
    collector_diagnostics: {
      ...collectorDiagnostics,
      actionable_row_count: collectorDiagnostics.actionable_row_count ?? actionableRows,
      collector_not_attempted: collectorNotAttempted,
      collector_not_attempted_reason: collectorNotAttemptedReason,
      missing_required_config: portOperationMissingConfig,
      runtime_mode_diagnostics: runtimeModeDiagnostics,
      runtime_config_audit: runtimeConfigAudit
    },
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
  const runOrigin = buildRunOrigin({
    runId,
    validationMode: VALIDATION_MODE,
    servingMode: shouldWriteDebugApiOutputs(baseReport) ? "local_diagnostics" : "static_json"
  });
  baseReport.next_development_plan = buildNextDevelopmentPlan(baseReport, detectSecrets());
  const snapshotOutputs = writeSnapshotOutputs({
    records: vessels,
    report: baseReport,
    version: VERSION,
    buildName: BUILD_NAME,
    apiSources: detectSecrets(),
    supabaseStatus,
    diagnosticsOnly: shouldWriteDebugApiOutputs(baseReport),
    debugDir: DEBUG_API_DIR,
    runOrigin
  });
  const allCollectedVessels = dedupeVesselDataset(
    ensureOutputContractFields(
      activeRecordsOnly(snapshotOutputs.merged),
      {
        runId: baseReport.run_id,
        generatedAt: baseReport.generated_at || baseReport.completed_at || new Date().toISOString(),
        dataSourceUsed: baseReport.data_source_used || "static_json_snapshot"
      }
    )
  );
  const targetVesselsRaw = allCollectedVessels.filter(v => isMainCommercialVessel(v) || isSalesCandidate(v) || hasSalesRelevantSignal(v));
  annotateTargetClassification(targetVesselsRaw);
  const targetVessels = targetVesselsRaw.slice(0, MAX_TARGET_VESSELS);
  const anchorageWaiting = buildAnchorageWaiting(allCollectedVessels);
  const stayingVessels = sortCommercialPriority(dedupeCandidateRows(allCollectedVessels.filter(v =>
    ["arrived_staying", "berthed", "anchorage_waiting"].includes(v.status_bucket) ||
    Boolean(v.ata && !v.atd) ||
    Number(v.stay_hours || v.current_call_stay_hours || v.cumulative_stay_hours || 0) >= 12 ||
    hasAnchorageWaitingSignal(v)
  ))).slice(0, 500);
  const arrivalPipeline = buildPredictedArrivals(allCollectedVessels);
  vessels = targetVessels;
  const mergedActionableRows = vessels.filter(v => v.actionable_source_row && !String(v.source_mode || "").includes("sample")).length;
  const hotVessels = buildHotVessels(vessels);
  const commercialCommandCenter = buildCommercialCommandCenter(vessels);
  const portCongestionHeatmap = buildPortCongestionHeatmap(vessels);
  const biofoulingTimeline = buildBiofoulingTimeline(vessels);
  const portIntelligence = buildPortIntelligence(allCollectedVessels);
  const portStatistics = buildPortStatistics(allCollectedVessels, completedAt);
  const biofoulingSstContext = await loadDailyNoaaSstContext(completedAt);
  const portOpportunities = buildPortOpportunityRanking(vessels);
  const contactReadyVessels = buildContactReadyVessels(vessels);
  const fleetOpportunities = buildFleetOpportunityRows(vessels);
  const predictedCleaningOpportunities = buildPredictedCleaningOpportunities(vessels);
  const candidateList = buildCandidateList(vessels).slice(0, MAX_CANDIDATES);

  const scoredVessels = vessels.filter(v => typeof v.commercial_value_score === "number");
  let salesCandidates = assignSalesPriorityTiers(sortCommercialPriority(dedupeCandidateRows(vessels.filter(v => v.is_cleaning_candidate || isSalesCandidate(v) || hasSalesRelevantSignal(v)))));
  const immediateTargets = sortCommercialPriority(dedupeCandidateRows(vessels.filter(isImmediateTarget)));
  const targetCategorySummary = buildTargetCategorySummary(salesCandidates, { generatedAt: completedAt });
  salesCandidates = targetCategorySummary.items;

  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY && status !== "failed") {
    try {
      supabaseWrite = { status: "syncing" };
      supabaseWrite = await saveFinalDashboardDatasetToSupabase(allCollectedVessels, {
        runId,
        startedAt,
        status
      });
      supabaseStatus = supabaseWrite.status;
    } catch (error) {
      status = "failed";
      errorMessage = error?.message || String(error);
      supabaseWrite = {
        status: "failed",
        error: errorMessage,
        failed_stage: "supabase_write",
        failure_type: error?.failure_type || error?.persistence_failure_type || "db_write_failed",
        post_write_verification: error?.postWriteVerification || {
          status: "failed",
          errors: ["supabase_write_threw_before_finalization"]
        },
        failure_behavior: {
          fail_production_run: true,
          preserve_previous_successful_static_outputs: true,
          dashboard_banner: "최신 수집은 완료됐지만 DB 저장이 완료되지 않아 마지막 정상 데이터를 표시 중입니다."
        },
        note: "Supabase write started but did not complete successfully."
      };
      supabaseStatus = "failed";
    }
    baseReport.supabase_status = supabaseStatus;
    baseReport.status = status;
    baseReport.error = errorMessage;
    baseReport.data_mode_detail = buildDataMode(allCollectedVessels, detectSecrets(), supabaseStatus);
    baseReport.data_mode = baseReport.data_mode_detail.mode;
    baseReport.cloud_master_db = buildCloudMasterDbStrategy(allCollectedVessels, detectSecrets(), supabaseStatus);
  }

  const scoringDiagnostics = buildScoringDiagnostics(allCollectedVessels);
  const operatorDiagnostics = buildOperatorDiagnostics(vessels, salesCandidates, immediateTargets);
  const matchingDiagnostics = buildMatchingDiagnostics(allCollectedVessels);
  const predictionDiagnostics = buildPredictionDiagnostics(allCollectedVessels);
  const dataQualityLayer = buildDataQualityLayerDiagnostics(allCollectedVessels, matchingDiagnostics);
  const countFunnel = buildCountFunnel({
    rawRecords: collectedRows,
    allCollected: allCollectedVessels,
    targetVessels,
    salesCandidates,
    immediateTargets,
    collectorDiagnostics: collectorDiagnosticsAfterCollection
  });
  const datasetGenerationAudit = buildDatasetGenerationAudit({
    report: baseReport,
    collectedRows,
    allCollectedVessels,
    targetVessels,
    salesCandidates,
    immediateTargets,
    candidateList,
    collectorDiagnostics: collectorDiagnosticsAfterCollection,
    supabaseWrite
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
    anchorage_waiting_count: anchorageWaiting.length,
    arrival_pipeline_count: arrivalPipeline.length,
    predicted_arrivals_count: arrivalPipeline.length,
    scored_vessel_count: scoredVessels.length,
    sales_candidate_count: salesCandidates.length,
    immediate_target_count: immediateTargets.length,
    scoring_diagnostics: scoringDiagnostics,
    operator_diagnostics: operatorDiagnostics,
    matching_diagnostics: matchingDiagnostics,
    prediction_diagnostics: predictionDiagnostics,
    data_quality_layer: dataQualityLayer,
    dataset_generation_audit: datasetGenerationAudit,
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
    target_category_counts: targetCategorySummary.counts,
    target_category_kpis: targetCategorySummary.kpis,
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
    contact_ready_vessels: contactReadyVessels.slice(0, 10),
    fleet_opportunities: fleetOpportunities.slice(0, 20),
    predicted_cleaning_opportunities: predictedCleaningOpportunities.slice(0, 10),
    predicted_arrivals: arrivalPipeline.slice(0, 10),
    hot_vessel_count: hotVessels.length,
    port_opportunities: portOpportunities.slice(0, 10),
    today_port_opportunities: portOpportunities.slice(0, 5),
    port_intelligence: portIntelligence.map(({ all_vessels, scored_vessels, sales_candidates, immediate_targets, berths, ...port }) => port),
    port_congestion_heatmap: portCongestionHeatmap,
    biofouling_timeline: biofoulingTimeline,
    biofouling_environmental_source: {
      model_version: BIOFOULING_MODEL_VERSION,
      sst_cache_status: biofoulingSstContext.status || "proxy",
      sst_cache_date: biofoulingSstContext.cache_date || null,
      ais_update_interval_hours: BIOFOULING_AIS_UPDATE_INTERVAL_HOURS,
      source_url: biofoulingSstContext.source_url || null
    },
    deployment_readiness: buildDeploymentReadiness(baseReport, vessels, detectSecrets())
  };
  report.backend_architecture = {
    pipeline_stages: PIPELINE_STAGES,
    source_of_truth_tables: sourceOfTruthTables,
    config_management: configDiagnostics(),
    production_serving_rule: "Dashboard APIs read the latest active dataset via active_dataset_pointer; generated no_live_data JSON must not replace promoted production data."
  };
  const readinessGateReport = buildReadinessGateReport({ report, vessels, generatedAt: completedAt });

  try {
    const rawArchivePayload = buildRawArchivePayload({
      runId,
      generatedAt: completedAt,
      rawRecords: collectedRows,
      normalizedRecords: allCollectedVessels,
      targetRecords: targetVessels,
      report,
      collectorDiagnostics: getCollectorDiagnostics(),
      supabaseWrite
    });
    gdriveArchive = await archiveRawToGDrive(rawArchivePayload, { namePrefix: "hwk-port-raw" });
    rawArchiveIndex = await recordRawArchiveIndex({
      runId,
      archive: gdriveArchive,
      generatedAt: completedAt,
      counts: {
        raw_records: collectedRows.length,
        normalized_records: allCollectedVessels.length,
        target_records: targetVessels.length
      }
    });
  } catch (archiveError) {
    gdriveArchive = { status: "failed", error: archiveError?.message || String(archiveError) };
    rawArchiveIndex = { status: "skipped", reason: "archive_failed" };
  }
  if (isSupabaseWriteCompleted(supabaseWrite?.status)) {
    supabaseWrite = {
      ...supabaseWrite,
      raw_payload_archive_status: gdriveArchive.status,
      raw_archive_index_status: rawArchiveIndex.status,
      raw_payloads_archived_to_gdrive: gdriveArchive.status === "uploaded" ? collectedRows.length : 0,
      raw_payloads_db_insert_blocked: collectedRows.length
    };
    report.supabase_write = supabaseWrite;
  }
  report.gdrive_archive = gdriveArchive;
  report.raw_archive_index = rawArchiveIndex;
  report.storage_status = {
    supabase: supabaseWrite,
    gdrive: gdriveArchive,
    raw_archive_index: rawArchiveIndex
  };
  report.storage = report.storage_status;
  report.rows_written_by_table = supabaseWrite?.db_rows_written_by_table || {};
  report.active_run_id = supabaseWrite?.active_run_id || report.active_run_id || runId;
  report.latest_successful_run_id = supabaseWrite?.latest_successful_run_id || supabaseWrite?.latest_successful_summary_run_id || null;
  report.promotion_status = supabaseWrite?.post_write_verification?.promotion_status || (supabaseWrite?.promoted ? "promoted" : "not_promoted");
  report.promotion_blockers = supabaseWrite?.promotion_blockers || supabaseWrite?.promotion?.promotion_blockers || supabaseWrite?.post_write_verification?.promotion_blockers || [];
  report.post_write_verification_errors = supabaseWrite?.post_write_verification?.errors || [];
  report.post_write_verification_all_errors = supabaseWrite?.post_write_verification?.all_errors || report.post_write_verification_errors;
  report.supabase_write_failure_type = classifySupabasePersistenceIssue(supabaseWrite);
  const currentRunDbWriteCompleted = isSupabaseWriteCompleted(supabaseWrite?.status) &&
    supabaseWrite?.post_write_verification?.status === "completed";
  const currentRunStoredSuccessfully = currentRunDbWriteCompleted &&
    (!promotionRequiredInProduction() || supabaseWrite?.promoted === true);
  const latestSuccessfulFallback = latestSuccessfulFallbackState();
  if (VALIDATION_MODE === "production" && !currentRunStoredSuccessfully) {
    report.status = "failed";
    report.data_status = currentRunDbWriteCompleted ? "promotion_blocked" : "storage_failed";
    report.data_source_used = "last_successful_snapshot_fallback";
    report.fallback_used = true;
    report.fallback_reason = report.supabase_write_failure_type || "supabase_persistence_not_available";
    report.error = report.error || (currentRunDbWriteCompleted
      ? "Supabase write completed but dataset promotion was blocked."
      : "Supabase write did not finalize.");
    report.user_message = currentRunDbWriteCompleted
      ? "최신 수집과 DB 저장은 완료됐지만 운영 데이터 승격이 차단되어 마지막 정상 데이터를 표시 중입니다."
      : "최신 수집은 완료됐지만 DB 저장이 완료되지 않아 마지막 정상 데이터를 표시 중입니다.";
  }
  report.latest_successful_fallback = latestSuccessfulFallback;
  const summaryStatusRunId = report?.status_run_id || report?.run_id || runId;
  const summaryRunId = report?.summary_run_id || report?.run_id || runId;
  const summaryActiveRunId = report?.active_run_id || report?.source_runtime?.active_run_id || summaryStatusRunId;
  const latestSuccessfulRunId = currentRunStoredSuccessfully
    ? (report?.supabase_write?.latest_successful_run_id ||
      report?.supabase_write?.latest_successful_summary_run_id ||
      report?.storage_status?.supabase?.latest_successful_run_id ||
      report?.storage_status?.supabase?.latest_successful_summary_run_id ||
      summaryRunId)
    : (report?.supabase_write?.latest_successful_run_id ||
      report?.storage_status?.supabase?.latest_successful_run_id ||
      null);
  const summaryRunMismatch = Boolean(summaryStatusRunId && summaryRunId && String(summaryStatusRunId) !== String(summaryRunId));
  const summaryRunWarnings = summaryRunMismatch ? ["status_run_id !== summary_run_id"] : [];
  const dashboardSummary = {
    run_id: report?.run_id || runId,
    status_run_id: summaryStatusRunId,
    summary_run_id: summaryRunId,
    active_run_id: summaryActiveRunId,
    latest_successful_run_id: latestSuccessfulRunId,
    latest_successful_summary_run_id: latestSuccessfulRunId,
    run_context_mismatch: summaryRunMismatch,
    run_context_warning: summaryRunMismatch ? "status_run_id !== summary_run_id" : null,
    warnings: summaryRunWarnings,
    generated_at: completedAt,
    last_success_at: report?.last_success_at || completedAt,
    data_freshness: {
      active_collected_at: report?.completed_at || completedAt,
      update_interval_label_ko: "4시간마다 자동 업데이트"
    },
    data_health: {
      label: "데이터 상태",
      last_successful_update: latestSuccessfulRunId ? report?.completed_at || completedAt : null,
      current_run_status: report?.status || status,
      vessel_record_count: report?.all_collected_vessel_count || allCollectedVessels.length,
      supabase_storage_status: report?.supabase_write?.status || report?.storage_status?.supabase?.status || "unknown",
      dataset_promotion_status: report?.promotion_status || "unknown"
    },
    data_source_used: report?.data_source_used || (report?.data_mode === "no_live_data" ? "diagnostics_only_no_live_data" : "static_json_snapshot"),
    fallback_used: Boolean(report?.fallback_used || report?.data_mode === "no_live_data"),
    fallback_reason: report?.fallback_reason || (report?.data_mode === "no_live_data" ? "local_or_failed_run_without_live_source_rows" : null),
    data_status: report?.data_status || (report?.data_mode === "no_live_data" ? "diagnostics_only" : "ready"),
    user_message: report?.user_message || (report?.data_mode === "no_live_data"
      ? "운영 데이터가 수집되지 않았습니다. Port Operation API 설정 또는 GitHub Secrets를 확인하세요."
      : "운영 데이터가 정상 수집되었습니다."),
    missing_required_config: portOperationMissingConfig,
    latest_successful_snapshot_available: latestSuccessfulFallback.latest_successful_snapshot_available,
    latest_successful_fallback: latestSuccessfulFallback,
    collector_not_attempted: collectorNotAttempted,
    collector_not_attempted_reason: collectorNotAttemptedReason,
    runtime_mode_diagnostics: runtimeModeDiagnostics,
    production_ready: currentRunStoredSuccessfully,
    record_count: report?.record_count || 0,
    storage: report.storage_status,
    storage_status: report.storage_status,
    rows_written_by_table: report.rows_written_by_table,
    promotion_status: report.promotion_status,
    all_vessels_count: report?.all_collected_vessel_count || allCollectedVessels.length,
    target_vessels_count: report?.target_vessel_count || targetVessels.length,
    target_count: salesCandidates.length,
    sales_target_count: salesCandidates.length,
    immediate_target_count: immediateTargets.length,
    contact_now_count: targetCategorySummary.kpis.contact_now_count || 0,
    pre_arrival_target_count: targetCategorySummary.kpis.pre_arrival_target_count || 0,
    anchorage_opportunity_count: targetCategorySummary.kpis.anchorage_opportunity_count || 0,
    long_stay_risk_count: targetCategorySummary.kpis.long_stay_risk_count || 0,
    compliance_target_count: targetCategorySummary.kpis.compliance_target_count || 0,
    repeat_caller_count: targetCategorySummary.kpis.repeat_caller_count || 0,
    fleet_expansion_count: targetCategorySummary.kpis.fleet_expansion_count || 0,
    verify_contact_count: targetCategorySummary.kpis.verify_contact_count || 0,
    monitor_count: targetCategorySummary.kpis.monitor_count || 0,
    hold_count: targetCategorySummary.kpis.hold_count || 0,
    anchorage_waiting_count: anchorageWaiting.length,
    arrival_pipeline_count: arrivalPipeline.length,
    staying_vessels_count: stayingVessels.length,
    high_risk_count: vessels.filter(v => operationalBiofoulingRiskScore(v) >= 70).length,
    opportunity_count: candidateList.length,
    watchlist_count: report?.scoring_diagnostics?.watchlist_count || 0,
    port_count: portStatistics.port_count,
    ports: portStatistics.ports,
    port_statistics_generated_at: portStatistics.port_statistics_generated_at,
    port_statistics_status: portStatistics.port_statistics_status,
    port_statistics_error: portStatistics.port_statistics_error,
    unknown_port_count: portStatistics.unknown_port_count,
    vessels_missing_port_field: portStatistics.vessels_missing_port_field,
    port_field_names_found: portStatistics.port_field_names_found,
    status: {
      run_id: summaryStatusRunId,
      status_run_id: summaryStatusRunId,
      summary_run_id: summaryRunId,
      active_run_id: summaryActiveRunId,
      latest_successful_run_id: latestSuccessfulRunId,
      latest_successful_summary_run_id: latestSuccessfulRunId,
      run_context_mismatch: summaryRunMismatch,
      run_context_warning: summaryRunMismatch ? "status_run_id !== summary_run_id" : null,
      generated_at: completedAt,
      last_success_at: report?.last_success_at || completedAt,
      data_mode: report?.data_mode,
      record_count: report?.record_count || 0,
      storage: report.storage_status,
      storage_status: report.storage_status,
      rows_written_by_table: report.rows_written_by_table,
      promotion_status: report.promotion_status,
      data_status: report?.data_status || (report?.data_mode === "no_live_data" ? "diagnostics_only" : "ready"),
      user_message: report?.user_message || (report?.data_mode === "no_live_data"
        ? "운영 데이터가 수집되지 않았습니다. Port Operation API 설정 또는 GitHub Secrets를 확인하세요."
        : "운영 데이터가 정상 수집되었습니다."),
      missing_required_config: portOperationMissingConfig,
      collector_not_attempted: collectorNotAttempted,
      collector_not_attempted_reason: collectorNotAttemptedReason,
      all_collected_vessel_count: report?.all_collected_vessel_count || allCollectedVessels.length,
      target_vessel_count: report?.target_vessel_count || targetVessels.length,
      sales_candidate_count: salesCandidates.length,
      immediate_target_count: immediateTargets.length,
      anchorage_waiting_count: anchorageWaiting.length,
      arrival_pipeline_count: arrivalPipeline.length,
      staying_vessels_count: stayingVessels.length
    },
    port_summary: portIntelligence.map(({ all_vessels, scored_vessels, sales_candidates, immediate_targets, berths, ...port }) => port),
    candidate_summary: buildCandidateSummary(vessels),
    congestion_summary: portCongestionHeatmap,
    data_quality_summary: dataQualityLayer,
    source_health_summary: collectorDiagnosticsAfterCollection
  };
  const staticOutputManifest = {};
  report.static_output_write_status = staticOutputManifest;
  const lastSuccessfulDatasetLocked = shouldWriteDebugApiOutputs(report);
  report.last_successful_dataset_lock = {
    locked: lastSuccessfulDatasetLocked,
    reason: lastSuccessfulDatasetLocked
      ? report.fallback_reason === "supabase_write_did_not_finalize"
        ? "supabase_write_did_not_finalize"
        : String(report.data_mode || report.data_mode_detail?.mode || "").toLowerCase() === "degraded_sample_only"
        ? "degraded_sample_only"
        : Number(report.record_count || 0) <= 0 || Number(report.all_collected_vessel_count || 0) <= 0
          ? "empty_dataset"
          : String(report.data_mode || "").toLowerCase() || "dataset_not_successful"
      : null,
    action: lastSuccessfulDatasetLocked
      ? "keep_serving_last_successful_dataset"
      : "write_current_successful_dataset"
  };
  report.output_mode = lastSuccessfulDatasetLocked ? "local_diagnostics" : "static_json";
  report.production_api_write_protected = lastSuccessfulDatasetLocked;
  report.debug_api_dir = lastSuccessfulDatasetLocked ? DEBUG_API_DIR : null;
  report.dataset_generation_audit.static_outputs_generated = {
    ...report.dataset_generation_audit.static_outputs_generated,
    "dashboard/api/dashboard-summary.json": dashboardSummary.record_count
  };
  const finalRunOrigin = buildRunOrigin({
    runId,
    validationMode: VALIDATION_MODE,
    servingMode: normalizeServingMode(report.output_mode || (lastSuccessfulDatasetLocked ? "local_diagnostics" : "static_json"))
  });
  Object.assign(report, withRunOrigin(report, finalRunOrigin));
  Object.assign(dashboardSummary, withRunOrigin(dashboardSummary, finalRunOrigin));
  const currentReadinessGateReport = withRunOrigin(readinessGateReport, finalRunOrigin);
  const snapshotGuardRuntimeReport = buildSnapshotGuardRuntimeReport({
    report,
    dashboardSummary,
    allCollectedVessels,
    targetVessels,
    vessels,
    candidateList,
    generatedAt: completedAt
  });
  const collectorPlanRuntimeReport = buildCollectorPlanRuntimeReport({
    report,
    collectorDiagnostics: collectorDiagnosticsAfterCollection,
    generatedAt: completedAt
  });
  const sourceHealthRuntimeReport = buildSourceHealthRuntimeReport({
    report,
    collectorDiagnostics: collectorDiagnosticsAfterCollection,
    generatedAt: completedAt
  });
  const healthPayload = withRunOrigin({
    run_id: report.run_id || runId,
    status_run_id: summaryStatusRunId,
    active_run_id: summaryActiveRunId,
    generated_at: completedAt,
    last_success_at: report.last_success_at || completedAt,
    data_source_used: report.data_source_used,
    serving_mode: normalizeServingMode(report.output_mode || (lastSuccessfulDatasetLocked ? "local_diagnostics" : "static_json")),
    fallback_used: Boolean(report.fallback_used),
    fallback_reason: report.fallback_reason || null,
    data_freshness: report.data_freshness || dashboardSummary.data_freshness,
    record_count: report.record_count || 0,
    all_vessels_count: report.all_collected_vessel_count || allCollectedVessels.length,
    data_status: report.data_status || (report.data_mode === "no_live_data" ? "diagnostics_only" : "ready"),
    user_message: report.user_message || null,
    supabase_write_status: report.supabase_write?.status || report.storage_status?.supabase?.status || "unknown",
    promotion_status: report.promotion_status || "unknown",
    latest_successful_run_id: latestSuccessfulRunId,
    status: report.status || status
  }, finalRunOrigin);
  const topCandidatesPayload = buildTopCandidatesPayload({
    candidateList,
    immediateTargets,
    salesCandidates,
    hotVessels,
    generatedAt: completedAt,
    dataMode: report.data_mode || dashboardSummary.data_mode || "static_json"
  });
  const intelligenceSummaries = buildIntelligenceSummaries({
    records: vessels,
    candidateList,
    salesCandidates,
    immediateTargets,
    topCandidates: topCandidatesPayload,
    arrivalPipeline,
    predictedCleaningOpportunities,
    fleetOpportunities,
    commercialCommandCenter,
    scoringDiagnostics,
    operatorDiagnostics,
    predictionDiagnostics,
    portStatistics,
    generatedAt: completedAt,
    dataMode: report.data_mode || dashboardSummary.data_mode || "static_json"
  });
  const biofoulingModule = buildBiofoulingModuleOutputs({
    records: allCollectedVessels,
    portStatistics,
    sstContext: biofoulingSstContext,
    generatedAt: completedAt,
    dataMode: report.data_mode || dashboardSummary.data_mode || "static_json"
  });
  const hullCleaningEngine = buildHullCleaningIntelligenceEngine({
    records: allCollectedVessels,
    portStatistics,
    sstContext: biofoulingSstContext,
    generatedAt: completedAt,
    dataMode: report.data_mode || dashboardSummary.data_mode || "static_json"
  });
  intelligenceSummaries["hull-cleaning-engine"] = hullCleaningEngine.payload;
  report.biofouling_intelligence = biofoulingModule.summary;
  dashboardSummary.biofouling_intelligence = biofoulingModule.summary;
  report.hull_cleaning_intelligence = hullCleaningEngine.summary;
  dashboardSummary.hull_cleaning_intelligence = hullCleaningEngine.summary;
  const watchlistPayload = buildWatchlistPayload({
    records: allCollectedVessels,
    portStatistics,
    generatedAt: completedAt,
    dataMode: report.data_mode || dashboardSummary.data_mode || "static_json",
    report
  });
  const previousKpiReference = loadPreviousKpiTrendReference();
  const bootstrapPayload = buildBootstrapSnapshot({
    dashboardSummary,
    report,
    portStatistics,
    topCandidates: topCandidatesPayload,
    salesPriority: intelligenceSummaries["sales-priority"],
    previousKpiReference,
    generatedAt: completedAt,
    dataMode: report.data_mode || dashboardSummary.data_mode || "static_json"
  });
  dashboardSummary.kpis = bootstrapPayload.kpis;
  dashboardSummary.kpi_trends = bootstrapPayload.kpi_trends;
  dashboardSummary.trend_metrics = bootstrapPayload.trend_metrics;
  const paginatedVesselOutputs = buildPaginatedVesselOutputs({
    records: allCollectedVessels,
    generatedAt: completedAt,
    dataMode: report.data_mode || dashboardSummary.data_mode || "static_json",
    pageSize: Number(process.env.VESSEL_STATIC_PAGE_SIZE || 30)
  });
  const candidateChangesPayload = buildCandidateChangesPayload(snapshotOutputs.candidateChanges, completedAt);
  const candidateSummaryPayload = buildCandidateSummary(vessels);
  const agentFollowupQueue = buildAgentFollowupQueue(vessels);
  const verificationQueue = buildVerificationQueue(vessels);
  const agentFollowupPriorityPayload = buildAgentFollowupPriority({
    records: vessels,
    generatedAt: completedAt,
    dataMode: report.data_mode,
    report
  });
  const congestionWatchlist = buildCongestionWatchlist(vessels);
  const stayingVesselsPayload = publicItemsEnvelope({
    generatedAt: completedAt,
    dataMode: report.data_mode,
    report,
    sourceTable: "vessel_snapshots",
    items: stayingVessels,
    extra: stayingVessels.length ? {} : { status: "empty", reason: "체류/접안/묘박 조건에 맞는 선박이 없습니다." }
  });
  const anchorageWaitingPayload = publicItemsEnvelope({
    generatedAt: completedAt,
    dataMode: report.data_mode,
    report,
    sourceTable: "vessel_snapshots",
    items: anchorageWaiting,
    extra: anchorageWaiting.length ? {} : { status: "empty", reason: "묘박/대기 신호가 있는 선박이 없습니다." }
  });
  const arrivalPipelinePayload = publicItemsEnvelope({
    generatedAt: completedAt,
    dataMode: report.data_mode,
    report,
    sourceTable: "vessel_snapshots",
    items: arrivalPipeline,
    extra: arrivalPipeline.length ? {} : { status: "empty", reason: "입항 예정 신호가 있는 선박이 없습니다." }
  });
  const congestionWatchlistPayload = publicItemsEnvelope({
    generatedAt: completedAt,
    dataMode: report.data_mode,
    report,
    sourceTable: "port_summary_current,vessel_snapshots",
    items: congestionWatchlist
  });
  const agentFollowupQueuePayload = publicItemsEnvelope({
    generatedAt: completedAt,
    dataMode: report.data_mode,
    report,
    sourceTable: "sales_candidates_current,opportunity_master",
    items: agentFollowupQueue,
    extra: agentFollowupQueue.length ? {} : { status: "empty", reason: "후속 연락 큐에 들어갈 후보가 없습니다." }
  });
  const verificationQueuePayload = publicItemsEnvelope({
    generatedAt: completedAt,
    dataMode: report.data_mode,
    report,
    sourceTable: "operator_contact_history,commercial_leads,agent-followup-queue,sales_candidates_current,opportunity_master",
    items: verificationQueue.slice(0, VERIFICATION_QUEUE_OUTPUT_LIMIT),
    extra: {
      record_count: verificationQueue.length,
      total_count: verificationQueue.length,
      returned_count: Math.min(verificationQueue.length, VERIFICATION_QUEUE_OUTPUT_LIMIT),
      ...(verificationQueue.length ? {} : { status: "empty", reason: "연락처 확인이 필요한 영업 후보가 없습니다." })
    }
  });
  const targetCategoriesPayload = buildTargetCategoriesPayload({
    summary: targetCategorySummary,
    generatedAt: completedAt,
    dataMode: report.data_mode,
    report
  });
  const salesActionsPayload = buildSalesActionsPayload({
    summary: targetCategorySummary,
    generatedAt: completedAt,
    dataMode: report.data_mode,
    report
  });
  const conversionPipelinePayload = buildLeadConversionPipelinePayload({
    summary: targetCategorySummary,
    generatedAt: completedAt,
    dataMode: report.data_mode,
    report
  });
  const privateActivitySummaryPayload = buildPrivateActivitySummaryPayload({
    records: vessels,
    generatedAt: completedAt,
    dataMode: report.data_mode,
    report
  });
  const currentTargetsPayload = publicItemsEnvelope({
    generatedAt: completedAt,
    dataMode: report.data_mode,
    report,
    sourceTable: "sales_candidates_current",
    items: salesCandidates,
    extra: {
      all_vessels_count: allCollectedVessels.length,
      sales_target_count: salesCandidates.length,
      immediate_target_count: immediateTargets.length,
      target_ratio: allCollectedVessels.length ? Math.round((salesCandidates.length / allCollectedVessels.length) * 1000) / 10 : 0,
      target_ratio_warning: allCollectedVessels.length && salesCandidates.length / allCollectedVessels.length < 0.2 ? "영업대상 비율이 비정상적으로 낮음" : null,
      target_category_counts: targetCategorySummary.counts,
      ...targetCategorySummary.kpis,
      ...(salesCandidates.length ? {} : { status: "empty", reason: "영업 후보 조건을 통과한 선박이 없습니다." })
    }
  });
  const staticTargetsPayload = publicItemsEnvelope({
    generatedAt: completedAt,
    dataMode: report.data_mode,
    report,
    sourceTable: "vessel_snapshots",
    items: targetVessels
  });
  const contactQueuePayload = candidateList.slice(0, 50).map((v, index) => ({
    rank: index + 1,
    vessel_name: v.vessel_name,
    port: v.port,
    port_code: v.port_code,
    operator: v.operator || null,
    agent: v.agent || null,
    score: v.total_sales_priority_score || 0,
    commercial_value_score: v.commercial_value_score || v.total_sales_priority_score || 0,
    sales_priority_score: salesPriorityScore(v),
    band: salesPriorityBand(salesPriorityScore(v)),
    contact_window: v.contact_window,
    next_action: v.candidate_next_action || v.recommended_action,
    reason_codes: salesPriorityReasonCodes(v)
  }));
  const successfulBundleOutputs = {
    "dashboard/api/all-collected-vessels.json": allCollectedVessels,
    "dashboard/api/target-vessels.json": targetVessels,
    "dashboard/api/vessels.json": vessels,
    "dashboard/api/bootstrap.json": bootstrapPayload,
    "dashboard/api/candidates.json": candidateList,
    "dashboard/api/candidates/top.json": topCandidatesPayload,
    "dashboard/api/contact-queue.json": contactQueuePayload,
    "dashboard/api/agent-followup-queue.json": agentFollowupQueuePayload,
    "dashboard/api/sales/verification-queue.json": verificationQueuePayload,
    "dashboard/api/sales/agent-followup-priority.json": agentFollowupPriorityPayload,
    "dashboard/api/sales/actions.json": salesActionsPayload,
    "dashboard/api/sales/conversion-pipeline.json": conversionPipelinePayload,
    "dashboard/api/sales/private-activity-summary.json": privateActivitySummaryPayload,
    "dashboard/api/watchlist/current.json": watchlistPayload,
    "dashboard/api/targets/current.json": currentTargetsPayload,
    "dashboard/api/targets/categories.json": targetCategoriesPayload,
    "dashboard/api/targets/static.json": staticTargetsPayload,
    "dashboard/api/ports.json": portStatistics.ports,
    "dashboard/api/arrival-pipeline.json": arrivalPipelinePayload,
    "dashboard/api/anchorage-waiting.json": anchorageWaitingPayload,
    "dashboard/api/staying-vessels.json": stayingVesselsPayload,
    "dashboard/api/congestion-watchlist.json": congestionWatchlistPayload,
    "dashboard/api/intelligence/risk-summary.json": intelligenceSummaries["risk-summary"],
    "dashboard/api/intelligence/biofouling-risk.json": intelligenceSummaries["biofouling-risk"],
    "dashboard/api/intelligence/hull-cleaning-engine.json": intelligenceSummaries["hull-cleaning-engine"],
    "dashboard/api/intelligence/explainability.json": intelligenceSummaries.explainability,
    "dashboard/api/intelligence/prediction-summary.json": intelligenceSummaries["prediction-summary"],
    "dashboard/api/intelligence/operator-summary.json": intelligenceSummaries["operator-summary"],
    "dashboard/api/intelligence/operator-opportunities.json": intelligenceSummaries["operator-opportunities"],
    "dashboard/api/intelligence/agent-summary.json": intelligenceSummaries["agent-summary"],
    "dashboard/api/intelligence/agent-intelligence.json": intelligenceSummaries["agent-intelligence"],
    "dashboard/api/intelligence/agent-relationship.json": intelligenceSummaries["agent-relationship"],
    "dashboard/api/intelligence/repeat-callers.json": intelligenceSummaries["repeat-callers"],
    "dashboard/api/intelligence/fleet-summary.json": intelligenceSummaries["fleet-summary"],
    "dashboard/api/intelligence/fleet-intelligence.json": intelligenceSummaries["fleet-intelligence"],
    "dashboard/api/intelligence/fleet-dna.json": intelligenceSummaries["fleet-dna"],
    "dashboard/api/intelligence/fleet-memory.json": intelligenceSummaries["fleet-memory"],
    "dashboard/api/intelligence/fleet-penetration.json": intelligenceSummaries["fleet-penetration"],
    "dashboard/api/intelligence/fleet-expansion.json": intelligenceSummaries["fleet-expansion"],
    "dashboard/api/intelligence/fleet-clusters.json": intelligenceSummaries["fleet-clusters"],
    "dashboard/api/intelligence/route-summary.json": intelligenceSummaries["route-summary"],
    "dashboard/api/intelligence/vessel-timeline.json": intelligenceSummaries["vessel-timeline"],
    "dashboard/api/intelligence/korea-presence.json": intelligenceSummaries["korea-presence"],
    "dashboard/api/intelligence/cleaning-window.json": intelligenceSummaries["cleaning-window"],
    "dashboard/api/intelligence/service-bundles.json": intelligenceSummaries["service-bundles"],
    "dashboard/api/intelligence/compliance-exposure.json": intelligenceSummaries["compliance-exposure"],
    "dashboard/api/intelligence/relationship-intelligence.json": intelligenceSummaries["relationship-intelligence"],
    "dashboard/api/intelligence/customer-memory.json": intelligenceSummaries["customer-memory"],
    "dashboard/api/intelligence/opportunity-decay.json": intelligenceSummaries["opportunity-decay"],
    "dashboard/api/intelligence/missed-opportunities.json": intelligenceSummaries["missed-opportunities"],
    "dashboard/api/intelligence/lost-opportunity-reasons.json": intelligenceSummaries["lost-opportunity-reasons"],
    "dashboard/api/intelligence/win-probability.json": intelligenceSummaries["win-probability"],
    "dashboard/api/intelligence/port-seasonality.json": intelligenceSummaries["port-seasonality"],
    "dashboard/api/intelligence/fleet-heatmap.json": intelligenceSummaries["fleet-heatmap"],
    "dashboard/api/intelligence/port-opportunities.json": intelligenceSummaries["port-opportunities"],
    "dashboard/api/intelligence/port-demand-radar.json": intelligenceSummaries["port-demand-radar"],
    "dashboard/api/intelligence/port-dna.json": intelligenceSummaries["port-dna"],
    "dashboard/api/intelligence/superintendent-targets.json": intelligenceSummaries["superintendent-targets"],
    "dashboard/api/intelligence/compliance-opportunities.json": intelligenceSummaries["compliance-opportunities"],
    "dashboard/api/intelligence/drydock-prediction.json": intelligenceSummaries["drydock-prediction"],
    "dashboard/api/intelligence/opportunity-memory.json": intelligenceSummaries["opportunity-memory"],
    "dashboard/api/intelligence/revenue-forecast.json": intelligenceSummaries["revenue-forecast"],
    "dashboard/api/intelligence/commercial-summary.json": intelligenceSummaries["commercial-summary"],
    "dashboard/api/intelligence/sales-priority.json": intelligenceSummaries["sales-priority"],
    ...biofoulingModule.outputs,
    ...paginatedVesselOutputs
  };
  const successfulDatasetBundle = saveSuccessfulDatasetBundle({
    report,
    dashboardSummary,
    healthPayload,
    outputs: successfulBundleOutputs,
    generatedAt: completedAt
  });
  const restoreResult = lastSuccessfulDatasetLocked
    ? restoreSuccessfulDatasetBundle({ report, outputs: successfulBundleOutputs })
    : { status: "not_needed", reason: "current_run_not_locked" };
  const dataContinuityReport = buildDataContinuityReport({
    report,
    dashboardSummary,
    healthPayload,
    successfulDataset: successfulDatasetBundle,
    restoreResult,
    generatedAt: completedAt
  });
  const salesAlertsPayload = buildSalesAlertsPayload({
    topCandidates: topCandidatesPayload,
    dataContinuity: dataContinuityReport,
    report,
    generatedAt: completedAt,
    dataMode: report.data_mode || dashboardSummary.data_mode || "static_json"
  });
  const continuityPayload = buildContinuityEnvelope(dataContinuityReport, report, completedAt);
  const dailySalesReportPayload = buildDailySalesReportPayload({
    topCandidates: topCandidatesPayload,
    dataContinuity: dataContinuityReport,
    report,
    dashboardSummary,
    generatedAt: completedAt
  });
  const executiveWeeklyReportPayload = buildExecutiveWeeklyReportPayload({
    dashboardSummary,
    revenueForecast: intelligenceSummaries["revenue-forecast"],
    operatorOpportunities: intelligenceSummaries["operator-opportunities"],
    portOpportunities: intelligenceSummaries["port-opportunities"],
    complianceOpportunities: intelligenceSummaries["compliance-opportunities"],
    repeatCallers: intelligenceSummaries["repeat-callers"],
    fleetExpansion: intelligenceSummaries["fleet-expansion"],
    dataContinuity: dataContinuityReport,
    report,
    generatedAt: completedAt
  });
  const morningBriefPayload = buildExecutiveMorningBriefPayload({
    dashboardSummary,
    dailySales: dailySalesReportPayload,
    revenueForecast: intelligenceSummaries["revenue-forecast"],
    salesActions: salesActionsPayload,
    complianceExposure: intelligenceSummaries["compliance-exposure"],
    fleetIntelligence: intelligenceSummaries["fleet-intelligence"],
    portOpportunities: intelligenceSummaries["port-opportunities"],
    dataContinuity: dataContinuityReport,
    report,
    generatedAt: completedAt
  });
  report.successful_dataset_bundle = successfulDatasetBundle;
  report.successful_dataset_restore = restoreResult;
  report.data_continuity = dataContinuityReport;
  dashboardSummary.data_continuity = {
    status: dataContinuityReport.status,
    fallback_order: dataContinuityReport.fallback_order,
    storage_verification: dataContinuityReport.storage_verification
  };
  report.backend_ops = withRunOrigin(report.backend_ops || snapshotOutputs.backendOps, finalRunOrigin);
  writeRuntimeDiagnosticJson("dashboard/api/status.json", report, finalRunOrigin);
  writeRuntimeDiagnosticJson("dashboard/api/health.json", healthPayload, finalRunOrigin);
  writeApiJson("dashboard/api/health/pipeline.json", healthPayload, report);
  writeRuntimeDiagnosticJson("dashboard/api/data-continuity.json", dataContinuityReport, finalRunOrigin);
  writeApiJson("dashboard/api/continuity.json", continuityPayload, report);
  writeRuntimeDiagnosticJson("dashboard/api/alerts/sales-alerts.json", salesAlertsPayload, finalRunOrigin);
  writeRuntimeDiagnosticJson("dashboard/api/alerts/latest.json", salesAlertsPayload, finalRunOrigin);
  writeRuntimeDiagnosticJson("dashboard/api/reports/daily-sales-report.json", dailySalesReportPayload, finalRunOrigin);
  writeRuntimeDiagnosticJson("dashboard/api/reports/daily-summary.json", dailySalesReportPayload, finalRunOrigin);
  writeRuntimeDiagnosticJson("dashboard/api/reports/executive-weekly.json", executiveWeeklyReportPayload, finalRunOrigin);
  writeRuntimeDiagnosticJson("dashboard/api/reports/morning-brief.json", morningBriefPayload, finalRunOrigin);
  writeRuntimeDiagnosticJson("dashboard/api/backend-ops.json", report.backend_ops, finalRunOrigin);
  writeRuntimeDiagnosticJson("dashboard/api/readiness-gate.json", currentReadinessGateReport, finalRunOrigin);
  writeRuntimeDiagnosticJson("dashboard/api/readiness-gate-runtime.json", currentReadinessGateReport, finalRunOrigin);
  writeRuntimeDiagnosticJson("dashboard/api/snapshot-guard.json", snapshotGuardRuntimeReport, finalRunOrigin);
  writeRuntimeDiagnosticJson("dashboard/api/collector-plan-runtime.json", collectorPlanRuntimeReport, finalRunOrigin);
  writeRuntimeDiagnosticJson("dashboard/api/source-health-runtime.json", sourceHealthRuntimeReport, finalRunOrigin);

  writeStaticDatasetJson("dashboard/api/all-collected-vessels.json", allCollectedVessels, report, staticOutputManifest);
  writeStaticDatasetJson("dashboard/api/target-vessels.json", targetVessels, report, staticOutputManifest);
  writeApiJson("dashboard/api/bootstrap.json", bootstrapPayload, report);
  writeApiJson("dashboard/api/staying-vessels.json", stayingVesselsPayload, report);
  writeApiJson("dashboard/api/anchorage-waiting.json", anchorageWaitingPayload, report);
  writeApiJson("dashboard/api/arrival-pipeline.json", arrivalPipelinePayload, report);
  writeApiJson("dashboard/api/imo-recovery-queue.json", buildImoRecoveryQueue(vessels), report);
  writeApiJson("dashboard/api/imo-recovery-priority.json", buildImoRecoveryQueue(vessels), report);
  writeApiJson("dashboard/api/high-value-targets.json", buildHighValueTargets(vessels), report);
  writeApiJson("dashboard/api/unknown-gt-review.json", buildUnknownGtReview(vessels), report);
  writeApiJson("dashboard/api/high-value-low-confidence.json", buildHighValueLowConfidence(vessels), report);
  writeApiJson("dashboard/api/congestion-watchlist.json", congestionWatchlistPayload, report);
  writeApiJson("dashboard/api/agent-followup-queue.json", agentFollowupQueuePayload, report);
  writeApiJson("dashboard/api/sales/verification-queue.json", verificationQueuePayload, report);
  writeApiJson("dashboard/api/sales/agent-followup-priority.json", agentFollowupPriorityPayload, report);
  writeApiJson("dashboard/api/sales/actions.json", salesActionsPayload, report);
  writeApiJson("dashboard/api/sales/conversion-pipeline.json", conversionPipelinePayload, report);
  writeApiJson("dashboard/api/sales/private-activity-summary.json", privateActivitySummaryPayload, report);
  writeApiJson("dashboard/api/watchlist/current.json", watchlistPayload, report);
  writeApiJson("dashboard/api/targets/current.json", currentTargetsPayload, report);
  writeApiJson("dashboard/api/targets/categories.json", targetCategoriesPayload, report);
  writeApiJson("dashboard/api/targets/static.json", staticTargetsPayload, report);
  fs.mkdirSync(routeApiOutputPath("dashboard/api/quality/basic-info-coverage.json", report).split("/").slice(0, -1).join("/"), { recursive: true });
  fs.mkdirSync(routeApiOutputPath("dashboard/api/review/basic-info-missing.json", report).split("/").slice(0, -1).join("/"), { recursive: true });
  writeApiJson("dashboard/api/quality/basic-info-coverage.json", buildBasicInfoCoverage(vessels), report);
  writeApiJson("dashboard/api/quality/scoring-diagnostics.json", scoringDiagnostics, report);
  writeApiJson("dashboard/api/quality/matching-diagnostics.json", matchingDiagnostics, report);
  writeApiJson("dashboard/api/quality/dataset-generation-audit.json", report.dataset_generation_audit, report);
  writeApiJson("dashboard/api/quality/imo-recovery.json", buildImoRecoveryKpis(vessels), report);
  writeApiJson("dashboard/api/quality/prediction-feedback.json", predictionDiagnostics, report);
  writeApiJson("dashboard/api/quality/data-quality.json", dataQualityLayer, report);
  writeApiJson("dashboard/api/review/basic-info-missing.json", buildBasicInfoMissingReview(vessels), report);
  writeApiJson("dashboard/api/predicted-arrivals.json", arrivalPipeline, report);
  writeStaticDatasetJson("dashboard/api/vessels.json", vessels, report, staticOutputManifest);
  cleanupStalePaginatedVesselFiles(paginatedVesselOutputs, report);
  for (const [filePath, payload] of Object.entries(paginatedVesselOutputs)) {
    writeApiJson(filePath, payload, report);
  }
  writeStaticDatasetJson("data/latest-lite.json", vessels, report, staticOutputManifest);
  writeStaticDatasetJson("dashboard/api/candidates.json", candidateList, report, staticOutputManifest);
  writeApiJson("dashboard/api/candidates/top.json", topCandidatesPayload, report);
  writeApiJson("dashboard/api/changes.json", candidateChangesPayload, report);
  writeApiJson("dashboard/api/contact-ready-vessels.json", contactReadyVessels, report);
  writeApiJson("dashboard/api/fleet-opportunities.json", fleetOpportunities, report);
  writeApiJson("dashboard/api/predicted-cleaning-opportunities.json", predictedCleaningOpportunities, report);
  writeApiJson("dashboard/api/candidate-summary.json", candidateSummaryPayload, report);
  writeApiJson("dashboard/api/contact-queue.json", contactQueuePayload, report);
  writeApiJson("dashboard/api/hot-candidates.json", candidateList.filter(v => v.is_immediate_candidate || (v.total_sales_priority_score || 0) >= IMMEDIATE_TARGET_THRESHOLD).slice(0, 40), report);
  writeApiJson("dashboard/api/hot-vessels.json", hotVessels, report);
  for (const [name, payload] of Object.entries(intelligenceSummaries)) {
    writeApiJson(`dashboard/api/intelligence/${name}.json`, payload, report);
  }
  for (const [filePath, payload] of Object.entries(biofoulingModule.outputs)) {
    writeApiJson(filePath, payload, report);
  }
  writeStaticDatasetJson("dashboard/api/ports.json", portStatistics.ports, report, staticOutputManifest);
  writeStaticDatasetJson("dashboard/api/dashboard-summary.json", dashboardSummary, report, staticOutputManifest);
  writeApiJson("dashboard/api/port-opportunities.json", portOpportunities, report);
  writeApiJson("dashboard/api/coverage-registry.json", {
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
  }, report);
  for (const port of portIntelligence) {
    const dir = routeApiOutputPath(`dashboard/api/ports/${port.port_code}/vessels.json`, report).split("/").slice(0, -1).join("/");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(`${dir}/vessels.json`, JSON.stringify(port.all_vessels, null, 2));
    fs.writeFileSync(`${dir}/candidates.json`, JSON.stringify(port.sales_candidates, null, 2));
    fs.writeFileSync(`${dir}/berths.json`, JSON.stringify(port.berths, null, 2));
    fs.writeFileSync(`${dir}/congestion.json`, JSON.stringify(portCongestionHeatmap.find(p => String(p.port_code) === String(port.port_code) || p.port === port.port_name) || null, null, 2));
    fs.writeFileSync(`${dir}/anchorage.json`, JSON.stringify(buildPortAnchorage(allCollectedVessels, port.port_code), null, 2));
    fs.writeFileSync(`${dir}/hull-cleaning.json`, JSON.stringify(hullCleaningEngine.portPayloads[String(port.port_code)] || publicItemsEnvelope({
      generatedAt: completedAt,
      dataMode: report.data_mode,
      report,
      sourceTable: "AIS_vessel_tracks,Port-MIS_pilot_events,VTS_operations,NOAA_SST,opportunity_master",
      items: [],
      extra: { status: "empty", reason: "해당 항만 Hull Cleaning 후보가 없습니다." }
    }), null, 2));
  }
  writeApiJson("dashboard/api/commercial-command-center.json", commercialCommandCenter, report);
  writeApiJson("dashboard/api/port-congestion-heatmap.json", portCongestionHeatmap, report);
  writeApiJson("dashboard/api/biofouling-timeline.json", biofoulingTimeline, report);
  writeApiJson("dashboard/api/status.json", report, report);
  writeApiJson("dashboard/api/readiness-gate.json", currentReadinessGateReport, report);
  writeApiJson("dashboard/api/readiness-gate-runtime.json", currentReadinessGateReport, report);
  writeRuntimeDiagnosticJson("dashboard/api/status.json", report, finalRunOrigin);
  writeRuntimeDiagnosticJson("dashboard/api/backend-ops.json", report.backend_ops, finalRunOrigin);
  writeRuntimeDiagnosticJson("dashboard/api/readiness-gate.json", currentReadinessGateReport, finalRunOrigin);
  writeRuntimeDiagnosticJson("dashboard/api/readiness-gate-runtime.json", currentReadinessGateReport, finalRunOrigin);
  writeRuntimeDiagnosticJson("dashboard/api/snapshot-guard.json", snapshotGuardRuntimeReport, finalRunOrigin);
  writeRuntimeDiagnosticJson("dashboard/api/collector-plan-runtime.json", collectorPlanRuntimeReport, finalRunOrigin);
  writeRuntimeDiagnosticJson("dashboard/api/source-health-runtime.json", sourceHealthRuntimeReport, finalRunOrigin);
  fs.writeFileSync("data/pipeline-report.json", JSON.stringify(report, null, 2));
  fs.writeFileSync(`data/reports/${today}.json`, JSON.stringify(report, null, 2));
  fs.copyFileSync("dashboard/index.html", "public/index.html");
  const collectionSummary = {
    validation_mode: VALIDATION_MODE,
    serving_mode: normalizeServingMode(report.output_mode || (lastSuccessfulDatasetLocked ? "local_diagnostics" : "static_json")),
    required_secrets_present: Object.entries(startupConfigDiagnostics.secrets_present || {})
      .filter(([, present]) => present)
      .map(([key]) => key),
    required_secrets_missing: startupConfigDiagnostics.missing_required_config || [],
    enabled_ports_count: report.dataset_generation_audit?.enabled_ports_count || collectorDiagnosticsAfterCollection.port_operation_collection_plan?.enabled_ports_count || 0,
    ports_attempted_count: report.dataset_generation_audit?.ports_attempted_count || collectorDiagnosticsAfterCollection.coverage?.ports_attempted_count || 0,
    source_rows_collected: report.dataset_generation_audit?.source_rows_collected || 0,
    normalized_rows: report.dataset_generation_audit?.normalized_rows || 0,
    all_vessels_count: report.all_collected_vessel_count || report.dataset_generation_audit?.all_vessels_generated || 0,
    target_vessels_count: report.target_vessel_count || report.dataset_generation_audit?.target_vessels_generated || 0,
    supabase_write_status: report.supabase_write?.status || report.storage_status?.supabase?.status || "unknown",
    supabase_promoted: report.supabase_write?.promoted ?? report.storage_status?.supabase?.promoted ?? null,
    supabase_promotion_blockers: report.promotion_blockers || report.supabase_write?.promotion_blockers || report.supabase_write?.promotion?.promotion_blockers || report.storage_status?.supabase?.promotion?.promotion_blockers || [],
    post_write_verification: report.supabase_write?.post_write_verification?.status || "unknown",
    db_rows_written_by_table: JSON.stringify(report.rows_written_by_table || report.supabase_write?.db_rows_written_by_table || {}),
    active_run_id: report.active_run_id || null,
    latest_successful_run_id: report.latest_successful_run_id || null,
    promotion_status: report.promotion_status || null,
    promotion_blockers: report.promotion_blockers || [],
    post_write_verification_errors: report.post_write_verification_all_errors || report.post_write_verification_errors || [],
    supabase_write_failure_type: report.supabase_write_failure_type || null,
    schema_compatibility_stripped: Object.entries(report.supabase_write?.schema_compatibility || {})
      .flatMap(([table, value]) => (value?.stripped_optional_columns || []).map(column => `${table}.${column}`)),
    failed_stage: report.dataset_generation_audit?.failed_stage || null,
    root_cause: report.dataset_generation_audit?.root_cause || null,
    error: report.error || report.supabase_write?.error || null
  };
  console.log("=== Collection Summary ===");
  for (const [key, value] of Object.entries(collectionSummary)) {
    console.log(`${key}=${Array.isArray(value) ? value.join(",") : value}`);
  }
  if (VALIDATION_MODE === "production" && runtimeConfigAudit.missing_required_env_names?.length) {
    console.error(`[HWK] Production config missing required env: ${runtimeConfigAudit.missing_required_env_names.join(",")}`);
    process.exitCode = 1;
  }
  if (VALIDATION_MODE === "production" && report.data_mode === "no_live_data") {
    process.exitCode = 1;
  }
  if (VALIDATION_MODE === "production" && report.status === "failed") {
    console.error(`[HWK] Production update failed: ${report.supabase_write_failure_type || report.error || "unknown_error"}`);
    process.exitCode = 1;
  }
  if (VALIDATION_MODE === "production" && !isSupabaseWriteFinal(report.supabase_write?.status)) {
    console.error("[HWK] Supabase write did not finalize.");
    process.exitCode = 1;
  }
  if (VALIDATION_MODE === "production" && report.supabase_write?.status !== "completed") {
    console.error(`[HWK] Production Supabase write did not complete: ${report.supabase_write?.status || "unknown"} (${report.supabase_write_failure_type || "db_write_failed"})`);
    process.exitCode = 1;
  }
  if (VALIDATION_MODE === "production" && report.supabase_write?.post_write_verification?.status !== "completed") {
    console.error(`[HWK] Production post-write verification failed: ${(report.supabase_write?.post_write_verification?.errors || []).join(",") || "unknown"}`);
    process.exitCode = 1;
  }
  if (VALIDATION_MODE === "production" && promotionRequiredInProduction() && report.supabase_write?.status === "completed" && report.supabase_write?.promoted !== true) {
    console.error(`[HWK] Production promotion blocked: ${(report.promotion_blockers || []).join(",") || report.supabase_write_failure_type || "active_dataset_pointer_not_updated"}`);
    process.exitCode = 1;
  }
}

console.log(`[HWK] v${VERSION} ${BUILD_NAME} dashboard data generated`);

// Supabase's realtime/websocket transport can keep the Node event loop open in CI
// even after all synchronous snapshot writes are complete. End the scheduled run
// explicitly so GitHub Actions does not cancel a successful refresh at timeout.
if (process.env.CI === "true") {
  process.exit(process.exitCode || 0);
}
