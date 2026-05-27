import fs from "fs";
import { collectKoreaData, getCollectorDiagnostics } from "./collectors/korea.js";
import { createRunId, saveToSupabase } from "./lib/db.js";
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
const SALES_CANDIDATE_THRESHOLD = Number(process.env.SALES_CANDIDATE_THRESHOLD || 50);
const IMMEDIATE_TARGET_THRESHOLD = Number(process.env.IMMEDIATE_TARGET_THRESHOLD || 75);

function parseScheduleTime(value) {
  if (!value) return null;
  const parsed = new Date(String(value).replace(" ", "T"));
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
  const arrival = v.ata || v.eta;
  const berthStart = v.atb || v.etb;
  const departure = v.atd || v.etd;
  const now = new Date().toISOString();
  const plannedStayHours = hoursBetween(v.eta, v.etd);
  const activeDeparture = v.atd ? v.atd : v.ata ? now : departure;
  const stayHours = hoursBetween(arrival, activeDeparture);
  const berthEnd = v.atd ? v.atd : berthStart ? now : departure;
  const berthHours = hoursBetween(berthStart || arrival, berthEnd);
  const anchorageDetected = hasAnchorageSignal(v);
  const waitingHours = berthStart
    ? hoursBetween(arrival, berthStart)
    : anchorageDetected
      ? (stayHours ?? plannedStayHours ?? 0)
      : 0;
  const workWindowHours = Math.max(0, Math.min(96, berthHours ?? plannedStayHours ?? stayHours ?? 0));

  return {
    stay_hours: stayHours ?? Math.round(Number(v.days_in_korea || 0) * 24),
    planned_stay_hours: plannedStayHours ?? 0,
    current_call_stay_hours: stayHours ?? Math.round(Number(v.days_in_korea || 0) * 24),
    cumulative_stay_hours: Number(v.cumulative_stay_hours || 0),
    cumulative_stay_days: Math.round((Number(v.cumulative_stay_hours || 0) / 24) * 10) / 10,
    berth_hours: berthHours ?? 0,
    anchorage_hours: waitingHours ?? 0,
    work_window_hours: workWindowHours,
    schedule_confidence: [v.eta, v.etb, v.ata, v.atb, v.etd, v.atd].filter(Boolean).length
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
  const route = [v.destination, v.previous_port, v.next_port].join(" ").toLowerCase();
  let score = Math.round(biofoulingScore * 0.42);
  if (Number(v.gt || 0) >= 5000) score += 18;
  if (/container|bulk|bulker|tanker|vlcc|lng|lpg|cruise/.test(type)) score += 12;
  if ((metrics.stay_hours || 0) >= 72) score += 8;
  if (/australia|brazil|usa|california|canada|singapore|china/.test(route)) score += 8;
  return Math.max(0, Math.min(100, score));
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
  const type = String([v.vessel_type, v.vessel_type_group].filter(Boolean).join(" ")).toLowerCase();
  const route = [v.destination, v.previous_port, v.next_port].join(" ").toLowerCase();
  const status = String(v.status || "").toLowerCase();
  const gt = Number(v.gt || v.grtg || v.intrlGrtg || 0);
  const meetsCommercialGtThreshold = gt >= COMMERCIAL_GT_THRESHOLD;
  const anchorageDays = Number(metrics.anchorage_hours || 0) / 24;
  const stayDays = Number(metrics.stay_hours || 0) / 24;
  const isCommercialType = /vlcc|cape|capesize|bulk|bulker|bulk_carrier|tanker|pctc|lng|lpg|cruise|container/.test(type);
  const sensitiveRoute = /australia|brazil|new zealand|california|usa|canada|port hedland|ponta da madeira/.test(route);
  const isAnchorageWaiting = Boolean(v.is_anchorage_waiting) || anchorageDays >= 0.5 || hasAnchorageSignal(v) || /waiting|anchorage|anchor|idle|drifting/.test(status);
  const isLongIdle = stayDays >= 7 || anchorageDays >= 3;
  const isHighGt = gt >= 30000;
  const isVeryHighGt = gt >= 80000;
  const isBulkTankerPctc = /bulk|bulker|bulk_carrier|tanker|vlcc|pctc|car carrier/.test(type);
  const biofoulingRiskScore = Math.min(30, Math.round(Math.min(14, stayDays * 1.4) + Math.min(8, anchorageDays * 2) + (isBulkTankerPctc ? 5 : isCommercialType ? 3 : 0) + (sensitiveRoute ? 4 : 0) + (isVeryHighGt ? 2 : 0)));
  const performanceProxyScore = Math.min(20, Math.round(Math.min(9, anchorageDays * 2) + Math.min(6, stayDays * 0.7) + (Number(v.speed || 0) > 0 && Number(v.speed || 0) < 1.5 ? 3 : 0) + (isHighGt ? 3 : meetsCommercialGtThreshold ? 2 : 0)));
  const congestionExposureScore = Math.min(20, Math.round((isAnchorageWaiting ? 10 : 0) + Math.min(8, anchorageDays * 2) + (isLongIdle ? 4 : 0) + (v.berth_class === "anchorage" ? 2 : 0)));
  const cleaningWindowScore = Math.min(15, Math.round(Math.min(9, Number(metrics.work_window_hours || 0) / 4) + (isAnchorageWaiting ? 4 : 0) + (v.berth || v.berth_name ? 2 : 0)));
  const compliancePressureScore = Math.min(10, Math.round((sensitiveRoute ? 5 : 0) + (isHighGt ? 4 : meetsCommercialGtThreshold ? 3 : 0) + (isBulkTankerPctc ? 2 : isCommercialType ? 1 : 0)));
  const commercialFitScore = Math.min(5, Math.round((isBulkTankerPctc ? 3 : isCommercialType ? 2 : 0) + (isHighGt ? 1 : 0) + (v.operator || v.agent ? 1 : 0) + (v.port_code ? 1 : 0)));
  const total = biofoulingRiskScore + performanceProxyScore + congestionExposureScore + cleaningWindowScore + compliancePressureScore + commercialFitScore;
  const reasonCodes = [];
  if (anchorageDays >= 1) reasonCodes.push("LONG_ANCHORAGE_WAIT");
  if (congestionExposureScore >= 14) reasonCodes.push("PORT_CONGESTION_HIGH");
  if (isLongIdle) reasonCodes.push("EXTENDED_IDLE_PERIOD");
  if (isAnchorageWaiting) reasonCodes.push("LOW_SPEED_CONGESTION_PATTERN");
  if (meetsCommercialGtThreshold) reasonCodes.push("HIGH_GT_VESSEL");
  if (isHighGt) reasonCodes.push("HIGH_VALUE_GT_30000_PLUS");
  if (isBulkTankerPctc) reasonCodes.push(/pctc|car carrier/.test(type) ? "PCTC_HIGH_VALUE_TYPE" : "BULK_OR_TANKER");
  if (v.berth_class === "anchorage") reasonCodes.push("ANCHORAGE_CLASSIFIED");
  if (stayDays >= 7) reasonCodes.push("LONG_PORT_STAY");
  if (/australia|brazil/.test(route)) reasonCodes.push("AUSTRALIA_BRAZIL_EXPOSURE");
  if (Number(metrics.work_window_hours || 0) >= 24) reasonCodes.push("BERTH_WINDOW_AVAILABLE");
  return {
    vessel_value_score: Math.min(20, Math.round((isHighGt ? 8 : meetsCommercialGtThreshold ? 5 : 0) + (isVeryHighGt ? 4 : 0) + (isBulkTankerPctc ? 5 : isCommercialType ? 3 : 0) + (v.operator || v.agent ? 2 : 0) + (sensitiveRoute ? 1 : 0))),
    biofouling_risk_score: biofoulingRiskScore,
    performance_proxy_score: performanceProxyScore,
    congestion_exposure_score: congestionExposureScore,
    cleaning_window_score: cleaningWindowScore,
    compliance_pressure_score: compliancePressureScore,
    sales_accessibility_score: Math.min(5, Math.round((v.agent ? 2 : 0) + (v.operator ? 2 : 0) + (v.operator_normalized || v.agent_normalized ? 1 : 0))),
    commercial_fit_score: commercialFitScore,
    total_sales_priority_score: Math.min(100, total),
    sales_priority_band: total >= IMMEDIATE_TARGET_THRESHOLD ? "immediate_target" : total >= SALES_CANDIDATE_THRESHOLD ? "high_potential" : total >= REVIEW_TARGET_THRESHOLD ? "review_target" : "low_priority",
    commercial_gt_threshold: COMMERCIAL_GT_THRESHOLD,
    meets_commercial_gt_threshold: meetsCommercialGtThreshold,
    review_target: total >= REVIEW_TARGET_THRESHOLD,
    is_anchorage_waiting: isAnchorageWaiting,
    is_long_idle: isLongIdle,
    anchorage_days: Math.round(anchorageDays * 10) / 10,
    estimated_waiting_time: metrics.anchorage_hours || 0,
    port_congestion_score: congestionExposureScore * 5,
    anchorage_density_score: Math.min(100, Math.round(anchorageDays * 12 + (isAnchorageWaiting ? 20 : 0))),
    idle_risk_score: Math.min(100, Math.round(stayDays * 8 + anchorageDays * 10)),
    high_value_target: Boolean(isHighGt && isBulkTankerPctc),
    commercial_signal_strength: Math.min(100, Math.round(total + (isHighGt ? 8 : 0) + (isAnchorageWaiting ? 8 : 0) + (isBulkTankerPctc ? 5 : 0))),
    score_reason_codes: reasonCodes
  };
}

function commercialValueBand(score, gtStatus) {
  if (gtStatus === "unknown_gt_review" && score >= 40) return "unknown_gt_review";
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
    Number(scoreParts.sales_accessibility_score || 0)
  ));
  return {
    commercial_value_score: commercialValueScore,
    commercial_value_band: commercialValueBand(commercialValueScore, v.gt_status),
    total_sales_priority_score: commercialValueScore,
    sales_priority_band: commercialValueScore >= IMMEDIATE_TARGET_THRESHOLD ? "immediate_target" : commercialValueScore >= SALES_CANDIDATE_THRESHOLD ? "high_potential" : commercialValueScore >= REVIEW_TARGET_THRESHOLD ? "review_target" : "low_priority"
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
  const text = String([v.vessel_type_group, v.vessel_type, v.ship_type, v.kind].filter(Boolean).join(" ")).toLowerCase();
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
  const eta = parseScheduleTime(v.eta);
  const ata = parseScheduleTime(v.ata);
  const etd = parseScheduleTime(v.etd);
  const atd = parseScheduleTime(v.atd);
  const status = String(v.status || "").toLowerCase();
  if (atd && atd.getTime() < now.getTime() && !hasAnchorageSignal(v) && !/waiting|anchorage|anchor|berth|moored|alongside|idle/.test(status)) return "completed_departure";
  if (ata && !atd) return "staying_vessels";
  if (hasAnchorageSignal(v) || /waiting|anchorage|anchor|idle|drifting/.test(status) || (metrics.anchorage_hours || 0) > 0) return "staying_vessels";
  if (/berth|moored|alongside/.test(status) || v.berth || v.berth_name || v.atb) return "staying_vessels";
  if (eta && eta.getTime() >= now.getTime()) return "arrival_pipeline";
  if (etd && etd.getTime() >= now.getTime()) return "staying_vessels";
  return "port_call_review";
}

function commercialRelevanceStatus(v = {}) {
  if (v.excluded_commercial_type) return "excluded_non_commercial_type";
  if (v.status_bucket === "completed_departure") return "excluded_departure_only";
  if (v.gt_status === "target_vessel") return "target_vessel";
  if (v.gt_status === "unknown_gt_review") return "unknown_gt_review";
  return "non_target_small_vessel";
}

function isMainCommercialVessel(v = {}) {
  return ["target_vessel", "unknown_gt_review"].includes(v.commercial_relevance_status);
}

function buildCommercialSignals(v = {}, metrics = {}) {
  const gt = Number(v.gt || v.grtg || v.intrlGrtg || 0);
  const typeGroup = String(v.vessel_type_group || v.vessel_type || "").toLowerCase();
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
  return {
    commercial_signal_flags: [...new Set(flags)],
    high_value_target: flags.includes("GT_30000_PLUS") && flags.includes("HIGH_VALUE_VESSEL_TYPE"),
    congestion_exposed_target: flags.includes("ANCHORAGE_WAITING_CLASSIFIED") || flags.includes("CONGESTION_EXPOSED")
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
    if (v.is_cleaning_candidate || (v.total_sales_priority_score || 0) >= SALES_CANDIDATE_THRESHOLD) {
      current.candidate_count += 1;
      current.sales_candidates.push(v);
    }
    if (v.is_immediate_candidate || (v.total_sales_priority_score || 0) >= IMMEDIATE_TARGET_THRESHOLD) {
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
    sales_candidates: sortCommercialPriority(port.sales_candidates),
    immediate_targets: sortCommercialPriority(port.immediate_targets),
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
  return records
    .filter(v => v.actionable_source_row !== false && v.commercial_relevance_status === "target_vessel" && v.meets_commercial_gt_threshold && (v.is_cleaning_candidate || (v.total_sales_priority_score || 0) >= SALES_CANDIDATE_THRESHOLD))
    .slice()
    .sort((a, b) =>
      Number(b.is_immediate_candidate) - Number(a.is_immediate_candidate) ||
      (b.total_sales_priority_score || b.cleaning_candidate_score || b.risk_score || 0) - (a.total_sales_priority_score || a.cleaning_candidate_score || a.risk_score || 0)
    );
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
    const complianceWatch = regulatedDestinations.some(d => destination.includes(d));
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
    const scoringInput = { ...v, vessel_type: normalizedType, vessel_type_group: normalizedTypeGroup, gt: gtProfile.gt, grtg: gtProfile.grtg, intrlGrtg: gtProfile.intrlGrtg };
    const scoreParts = deriveCommercialScoreParts(scoringInput, scheduleMetrics);
    const commercialValue = deriveCommercialValue({ ...scoringInput, gt_status: gtProfile.gt_status }, scoreParts);
    const dataConfidence = deriveDataConfidence({ ...v, ...gtProfile, ...scoreParts });
    const candidateProfile = buildCandidateProfile({ ...v, ...scheduleMetrics, risk_score: biofoulingScore, compliance_watch: complianceWatch });
    const identity = deriveIdentity(v);
    const isSample = String(v.source_mode || "").includes("sample");
    const reasonCodes = [
      ...(v.reason_codes || []),
      ...(scoreParts.score_reason_codes || []),
      ...reasons,
      ...(candidateProfile.candidate_reasons || [])
    ].filter((value, index, arr) => value && arr.indexOf(value) === index);
    const enriched = {
      ...v,
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
      enriched.is_cleaning_candidate = isMainCommercialVessel(enriched) && enriched.commercial_relevance_status === "target_vessel" && enriched.commercial_value_score >= SALES_CANDIDATE_THRESHOLD;
      enriched.is_immediate_candidate = isMainCommercialVessel(enriched) && enriched.commercial_relevance_status === "target_vessel" && enriched.commercial_value_score >= IMMEDIATE_TARGET_THRESHOLD;
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
      enriched.is_cleaning_candidate = enriched.commercial_relevance_status === "target_vessel" && enriched.total_sales_priority_score >= SALES_CANDIDATE_THRESHOLD;
      enriched.is_immediate_candidate = enriched.commercial_relevance_status === "target_vessel" && enriched.total_sales_priority_score >= IMMEDIATE_TARGET_THRESHOLD;
      enriched.is_operating_candidate = enriched.is_cleaning_candidate;
      enriched.is_operating_immediate_candidate = enriched.is_immediate_candidate;
    }
    if (enriched.commercial_signal_flags?.length) {
      enriched.reason_codes = [...new Set([...(enriched.reason_codes || []), ...enriched.commercial_signal_flags])];
      enriched.sales_reason = enriched.reason_codes;
    }
    enriched.operator_fleet_badges = deriveFleetBadges(enriched);
    enriched.recommended_action = enriched.candidate_next_action || recommendedAction(enriched);
    enriched.opportunity_usd = estimateOpportunity(enriched);
    return enriched;
  });
}

function sortCommercialPriority(records) {
  return records.slice().sort((a, b) =>
    Number(b.is_immediate_candidate) - Number(a.is_immediate_candidate) ||
    (b.total_sales_priority_score || 0) - (a.total_sales_priority_score || 0) ||
    (b.biofouling_score || 0) - (a.biofouling_score || 0) ||
    (b.work_window_hours || 0) - (a.work_window_hours || 0)
  );
}

function buildHotVessels(records) {
  return sortCommercialPriority(records)
    .filter(v => isMainCommercialVessel(v) && (v.is_cleaning_candidate || v.status_bucket === "staying_vessels" || v.status_bucket === "arrival_pipeline" || (v.biofouling_score || 0) >= 65 || (v.operational_risk_score || 0) >= 60))
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
      hybrid_entity_key: v.hybrid_entity_key,
      identification_method: v.identification_method,
      imo_status: v.imo_status,
      priority: v.imo_recovery_priority,
      imo_recovery_score: v.imo_recovery_score || 0,
      commercial_score: v.total_sales_priority_score || 0,
      reason_codes: v.reason_codes || []
    }));
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
    score_35_50: 0,
    score_50_75: 0,
    score_75_plus: 0
  };
  for (const v of records) {
    const score = Number(v.commercial_value_score || v.total_sales_priority_score || v.cleaning_candidate_score || 0);
    if (score < 20) buckets.score_0_20 += 1;
    else if (score < REVIEW_TARGET_THRESHOLD) buckets.score_20_35 += 1;
    else if (score < SALES_CANDIDATE_THRESHOLD) buckets.score_35_50 += 1;
    else if (score < IMMEDIATE_TARGET_THRESHOLD) buckets.score_50_75 += 1;
    else buckets.score_75_plus += 1;
  }
  return {
    total_collected: records.length,
    target_vessels_5000gt_plus: records.filter(v => Number(v.gt || v.grtg || v.intrlGrtg || 0) >= COMMERCIAL_GT_THRESHOLD).length,
    ...buckets,
    review_target_threshold: REVIEW_TARGET_THRESHOLD,
    sales_candidate_threshold: SALES_CANDIDATE_THRESHOLD,
    immediate_target_threshold: IMMEDIATE_TARGET_THRESHOLD,
    missing_gt_count: records.filter(v => !Number(v.gt || v.grtg || v.intrlGrtg || 0)).length,
    missing_imo_count: records.filter(v => !v.imo).length,
    anchorage_detected_count: records.filter(v => v.is_anchorage_waiting || hasAnchorageSignal(v) || Number(v.anchorage_hours || 0) > 0).length,
    stay_hours_detected_count: records.filter(v => Number(v.stay_hours || v.current_call_stay_hours || v.planned_stay_hours || 0) > 0).length,
    vessel_type_group_detected_count: records.filter(v => v.vessel_type_group && v.vessel_type_group !== "unknown").length
  };
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
  const collectedRows = await collectKoreaData({ apiSources });
  vessels = enrichSalesSignals(enrichWithReferenceDictionaries(collectedRows, dictionaries));
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
  const targetVessels = allCollectedVessels.filter(isMainCommercialVessel);
  const stayingVessels = targetVessels.filter(v => v.status_bucket === "staying_vessels");
  const arrivalPipeline = targetVessels.filter(v => v.status_bucket === "arrival_pipeline");
  vessels = targetVessels;
  const mergedActionableRows = vessels.filter(v => v.actionable_source_row && !String(v.source_mode || "").includes("sample")).length;
  const hotVessels = buildHotVessels(vessels);
  const commercialCommandCenter = buildCommercialCommandCenter(vessels);
  const portCongestionHeatmap = buildPortCongestionHeatmap(vessels);
  const biofoulingTimeline = buildBiofoulingTimeline(vessels);
  const portIntelligence = buildPortIntelligence(vessels);
  const candidateList = buildCandidateList(vessels);

  const scoredVessels = vessels.filter(v => typeof v.commercial_value_score === "number");
  const salesCandidates = vessels.filter(v => (v.commercial_value_score || 0) >= SALES_CANDIDATE_THRESHOLD && v.commercial_relevance_status === "target_vessel");
  const immediateTargets = vessels.filter(v => (v.commercial_value_score || 0) >= IMMEDIATE_TARGET_THRESHOLD && v.commercial_relevance_status === "target_vessel");
  const scoringDiagnostics = buildScoringDiagnostics(vessels);
  const report = {
    ...baseReport,
    visibility_goal: "commercially_relevant_vessels_not_raw_count",
    target_definition: {
      commercial_gt_threshold: COMMERCIAL_GT_THRESHOLD,
      include: ["grtg >= 5000", "intrlGrtg >= 5000", "unknown GT requiring review", "arriving/calling/staying/berthed/anchorage waiting vessels"],
      exclude_from_main_view: ["GT under 5000", "fishing vessels", "tugs", "government vessels", "workboats", "completed departure-only rows"]
    },
    all_collected_vessel_count: allCollectedVessels.length,
    target_vessel_count: targetVessels.length,
    gt_5000_plus_count: targetVessels.filter(v => v.gt_status === "target_vessel").length,
    staying_vessel_count: stayingVessels.length,
    arrival_pipeline_count: arrivalPipeline.length,
    scored_vessel_count: scoredVessels.length,
    sales_candidate_count: salesCandidates.length,
    immediate_target_count: immediateTargets.length,
    scoring_diagnostics: scoringDiagnostics,
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
    collector_diagnostics: { ...getCollectorDiagnostics(), actionable_row_count: getCollectorDiagnostics().actionable_row_count ?? mergedActionableRows },
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
  fs.writeFileSync("dashboard/api/high-value-targets.json", JSON.stringify(buildHighValueTargets(vessels), null, 2));
  fs.writeFileSync("dashboard/api/unknown-gt-review.json", JSON.stringify(buildUnknownGtReview(vessels), null, 2));
  fs.writeFileSync("dashboard/api/high-value-low-confidence.json", JSON.stringify(buildHighValueLowConfidence(vessels), null, 2));
  fs.writeFileSync("dashboard/api/congestion-watchlist.json", JSON.stringify(buildCongestionWatchlist(vessels), null, 2));
  fs.writeFileSync("dashboard/api/agent-followup-queue.json", JSON.stringify(buildAgentFollowupQueue(vessels), null, 2));
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
