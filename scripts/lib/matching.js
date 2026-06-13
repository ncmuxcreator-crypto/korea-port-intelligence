import {
  buildVesselMatchKeys,
  normalizeBerth,
  normalizeCallSign,
  normalizeDateTime,
  normalizePort,
  normalizeTerminal,
  normalizeVesselName,
  normalizeVesselType
} from "./normalize.js";

export { buildVesselMatchKeys, normalizeCallSign, normalizeVesselName };

const DEFAULT_TIME_WINDOW_HOURS = Number(process.env.MATCH_TIME_WINDOW_HOURS || 48);
const STRONG_TIME_MATCH_HOURS = Number(process.env.STRONG_TIME_MATCH_HOURS || 6);

export function normalizePortName(value = "") {
  return normalizePort(value).normalized_port || String(value || "")
    .normalize("NFKC")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeTerminalName(value = "") {
  return normalizeTerminal(value);
}

export function normalizeBerthName(value = "") {
  return normalizeBerth(value).normalized_berth || normalizeTerminalName(value);
}

function parseTime(value) {
  if (!value) return null;
  const normalized = normalizeDateTime(value);
  return normalized.epoch_ms || null;
}

function recordTimes(record = {}) {
  return [
    record.eta,
    record.etb,
    record.ata,
    record.atb,
    record.etd,
    record.atd,
    record.eta_candidate,
    record.etb_candidate,
    record.etd_candidate,
    record.pilot_time,
    record.movement_time,
    record.berth_time
  ].map(parseTime).filter(Boolean);
}

function diceSimilarity(a = "", b = "") {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return a === b ? 1 : 0;
  const grams = value => {
    const out = new Map();
    for (let i = 0; i < value.length - 1; i += 1) {
      const gram = value.slice(i, i + 2);
      out.set(gram, (out.get(gram) || 0) + 1);
    }
    return out;
  };
  const left = grams(a);
  const right = grams(b);
  let overlap = 0;
  for (const [gram, count] of left) overlap += Math.min(count, right.get(gram) || 0);
  const leftTotal = [...left.values()].reduce((sum, value) => sum + value, 0);
  const rightTotal = [...right.values()].reduce((sum, value) => sum + value, 0);
  return (2 * overlap) / Math.max(1, leftTotal + rightTotal);
}

export function matchConfidenceBand(score = 0) {
  if (score >= 80) return "HIGH";
  if (score >= 60) return "MEDIUM";
  if (score >= 40) return "LOW";
  return "UNMATCHED";
}

function timeProximityScore(left = {}, right = {}, options = {}) {
  const leftTimes = recordTimes(left);
  const rightTimes = recordTimes(right);
  if (!leftTimes.length || !rightTimes.length) return { score: 0, reason: "", hours: null };
  const strongHours = Number(options.strongTimeMatchHours || STRONG_TIME_MATCH_HOURS);
  const windowHours = Number(options.timeWindowHours || DEFAULT_TIME_WINDOW_HOURS);
  let bestHours = Infinity;
  for (const a of leftTimes) {
    for (const b of rightTimes) {
      bestHours = Math.min(bestHours, Math.abs(a - b) / 36e5);
    }
  }
  const rounded = Math.round(bestHours * 10) / 10;
  if (bestHours <= strongHours) return { score: 20, reason: "time_proximity_strong", hours: rounded };
  if (bestHours <= 24) return { score: 16, reason: "time_proximity_24h", hours: rounded };
  if (bestHours <= windowHours) return { score: 10, reason: "time_proximity_48h", hours: rounded };
  return { score: -8, reason: "time_outside_window", hours: rounded };
}

export function explainMatchReasons(result = {}) {
  return result.match_reasons || result.reasons || [];
}

export function scoreMatch(left = {}, right = {}, options = {}) {
  let score = 0;
  const reasons = [];
  const matchedFields = {};
  const leftKeys = buildVesselMatchKeys(left);
  const rightKeys = buildVesselMatchKeys(right);
  const leftCall = leftKeys.call_sign || normalizeCallSign(left.call_sign || left.callsign);
  const rightCall = rightKeys.call_sign || normalizeCallSign(right.call_sign || right.callsign);
  const leftName = leftKeys.vessel_name || normalizeVesselName(left.vessel_name || left.name || left.normalized_vessel_name);
  const rightName = rightKeys.vessel_name || normalizeVesselName(right.vessel_name || right.name || right.normalized_vessel_name);
  const leftPort = String(left.port_code || left.prtAgCd || "").trim() || normalizePortName(left.port_name || left.port);
  const rightPort = String(right.port_code || right.prtAgCd || "").trim() || normalizePortName(right.port_name || right.port);
  const leftBerth = normalizeBerthName(left.berth_key || left.berth_name || left.berth || left.terminal_name || left.laidupFcltyNm || left.pilot_station);
  const rightBerth = normalizeBerthName(right.berth_key || right.berth_name || right.berth || right.terminal_name || right.laidupFcltyNm || right.pilot_station);

  if (leftCall && rightCall && leftCall === rightCall) {
    score += 50;
    reasons.push("call_sign_exact");
    matchedFields.call_sign = leftCall;
  }

  if (leftKeys.call_sign_port && rightKeys.call_sign_port && leftKeys.call_sign_port === rightKeys.call_sign_port) {
    score += 8;
    reasons.push("call_sign_port_exact");
    matchedFields.call_sign_port = leftKeys.call_sign_port;
  }

  if (leftName && rightName && leftName === rightName) {
    score += 30;
    reasons.push("normalized_vessel_name_exact");
    matchedFields.vessel_name = leftName;
  } else if (leftName && rightName) {
    const similarity = diceSimilarity(leftName, rightName);
    if (similarity >= 0.86) {
      score += 20;
      reasons.push("fuzzy_vessel_name_strong");
      matchedFields.name_similarity = Math.round(similarity * 100);
    } else if ((leftName.includes(rightName) || rightName.includes(leftName)) && Math.min(leftName.length, rightName.length) >= 4) {
      score += 14;
      reasons.push("vessel_name_partial");
      matchedFields.name_similarity = Math.round(similarity * 100);
    }
  }

  if (leftKeys.vessel_name_port && rightKeys.vessel_name_port && leftKeys.vessel_name_port === rightKeys.vessel_name_port) {
    score += 8;
    reasons.push("vessel_name_port_exact");
    matchedFields.vessel_name_port = leftKeys.vessel_name_port;
  }

  if (leftKeys.vessel_name_gt_type && rightKeys.vessel_name_gt_type && leftKeys.vessel_name_gt_type === rightKeys.vessel_name_gt_type) {
    score += 10;
    reasons.push("vessel_name_gt_type_exact");
    matchedFields.vessel_name_gt_type = leftKeys.vessel_name_gt_type;
  }

  const time = timeProximityScore(left, right, options);
  if (time.score) {
    score += time.score;
    reasons.push(time.reason);
    matchedFields.time_diff_hours = time.hours;
  }

  if (leftPort && rightPort && leftPort === rightPort) {
    score += 10;
    reasons.push("same_port");
    matchedFields.port = leftPort;
  }

  if (leftBerth && rightBerth && (leftBerth === rightBerth || leftBerth.includes(rightBerth) || rightBerth.includes(leftBerth))) {
    score += 10;
    reasons.push("same_berth_or_terminal");
    matchedFields.berth_terminal = leftBerth;
  }

  const leftType = normalizeVesselType(left.vessel_type_group || left.vessel_type || left.vsslKndNm);
  const rightType = normalizeVesselType(right.vessel_type_group || right.vessel_type || right.vsslKndNm);
  if (leftType && rightType && leftType === rightType) {
    score += 10;
    reasons.push("same_vessel_type");
    matchedFields.vessel_type_group = leftType;
  }

  const leftGt = Number(left.gt || left.grtg || left.intrlGrtg || 0);
  const rightGt = Number(right.gt || right.grtg || right.intrlGrtg || 0);
  if (leftGt > 0 && rightGt > 0) {
    const diffRatio = Math.abs(leftGt - rightGt) / Math.max(leftGt, rightGt);
    if (diffRatio <= 0.05) {
      score += 10;
      reasons.push("gt_similar");
      matchedFields.gt_diff_ratio = Math.round(diffRatio * 100);
    }
  }

  const leftAgent = normalizePortName(left.agent_name || left.agent || left.satmntEntrpsNm || left.entrpsCdNm || left.operator_name || left.operator);
  const rightAgent = normalizePortName(right.agent_name || right.agent || right.satmntEntrpsNm || right.entrpsCdNm || right.operator_name || right.operator);
  if (leftAgent && rightAgent && leftAgent === rightAgent) {
    score += 5;
    reasons.push("same_operator_or_agent");
    matchedFields.operator_or_agent = leftAgent;
  }

  if (left.ais_cluster_confirmed || right.ais_cluster_confirmed || left.vts_cluster_confirmed || right.vts_cluster_confirmed) {
    score += 10;
    reasons.push("ais_vts_cluster_confirmation");
  }

  const clamped = Math.max(0, Math.min(100, Math.round(score)));
  const cleanReasons = [...new Set(reasons)];
  return {
    score: clamped,
    method: cleanReasons.join("+") || "no_match",
    reasons: cleanReasons,
    confidence: matchConfidenceBand(clamped),
    matched_fields: matchedFields
  };
}
