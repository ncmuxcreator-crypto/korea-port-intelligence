import {
  buildVesselMatchKeys,
  normalizeBerth,
  normalizeCallSign,
  normalizeDateTime,
  normalizeFlag,
  normalizeNumeric,
  normalizePort,
  normalizeVesselName,
  normalizeVesselType,
  pickAlias
} from "./normalize.js";

const PUBLIC_SCHEMA_VERSION = "1.0";

const VESSEL_SPEC_ALIAS_MAP = {
  imo: ["imo", "imoNo", "IMO_NO", "shipNo", "vesselNo"],
  mmsi: ["mmsi", "MMSI", "MMSI_NO"],
  call_sign: ["callSign", "callsign", "call_sign", "CALL_SIGN"],
  vessel_name: ["vesselName", "shipName", "vslNm", "vsslNm", "vessel_name"],
  gt: ["grossTonnage", "gt", "tonnage", "GT", "grtg"],
  dwt: ["dwt", "deadweight", "deadWeight", "DWT"],
  flag: ["flag", "nationality", "flagState", "flag_state"],
  vessel_type: ["vesselType", "shipType", "vessel_type", "ship_type"],
  loa: ["loa", "length", "lengthOverall", "shipLength"],
  beam: ["beam", "breadth", "width", "shipBreadth"]
};

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function hasValue(value) {
  if (value === undefined || value === null) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "object") return Object.values(value).some(hasValue);
  const text = String(value).trim();
  return text !== "" && text !== "-";
}

function unique(values = []) {
  return [...new Set(values.filter(hasValue).map(value => String(value).trim()))];
}

function display(row = {}) {
  return row.vessel_display && typeof row.vessel_display === "object"
    ? { ...row, ...row.vessel_display }
    : row;
}

function firstNonEmpty(...values) {
  return values.find(hasValue) ?? "";
}

function vesselKey(row = {}) {
  const d = display(row);
  return String(firstNonEmpty(
    d.vessel_key,
    row.vessel_key,
    d.hybrid_entity_key,
    d.master_vessel_id,
    d.vessel_id,
    d.imo,
    d.mmsi,
    d.call_sign,
    d.vessel_name,
    row.vessel_name
  )).trim().toUpperCase();
}

function normalizedPortValue(row = {}) {
  const d = display(row);
  const candidate = d.normalized_port && typeof d.normalized_port === "object"
    ? firstNonEmpty(d.normalized_port.normalized_port, d.normalized_port.port_code, d.normalized_port.port_name, d.normalized_port.display_name)
    : d.normalized_port;
  return normalizePort(firstNonEmpty(candidate, d.current_port, d.port, d.port_name, d.port_code, d.prtAgCd)).normalized_port;
}

function normalizedBerthValue(row = {}) {
  const d = display(row);
  return normalizeBerth(firstNonEmpty(d.berth_key, d.berth, d.berth_name, d.terminal_name, d.terminal)).normalized_berth;
}

function gtValue(row = {}) {
  const d = display(row);
  return normalizeNumeric(firstNonEmpty(d.gt, d.grtg, d.intrlGrtg, d.tonnage_summary?.gt, pickAlias(d, "gt"))) ?? null;
}

function gtBucket(value) {
  const gt = number(value, 0);
  if (gt <= 0) return "";
  if (gt < 5000) return "LT_5K";
  if (gt < 10000) return "5K_10K";
  if (gt < 30000) return "10K_30K";
  if (gt < 60000) return "30K_60K";
  if (gt < 100000) return "60K_100K";
  return "GT_100K";
}

function recordTimes(row = {}) {
  const d = display(row);
  return [
    d.ata,
    d.atb,
    d.eta,
    d.etb,
    d.atd,
    d.etd,
    d.last_arrival_at,
    d.last_departure_estimated_at,
    d.pilot_time,
    d.pilot_timestamp,
    d.movement_time,
    d.berth_time
  ].map(value => normalizeDateTime(value)).filter(item => item.epoch_ms);
}

function latestIso(values = []) {
  const epochs = values.map(value => normalizeDateTime(value).epoch_ms).filter(Boolean);
  if (!epochs.length) return null;
  return new Date(Math.max(...epochs)).toISOString();
}

function nameTokens(name = "") {
  return unique(normalizeVesselName(name).split(/\s+/).filter(token => token.length >= 3));
}

function diceSimilarity(a = "", b = "") {
  const leftValue = normalizeVesselName(a);
  const rightValue = normalizeVesselName(b);
  if (!leftValue || !rightValue) return 0;
  if (leftValue === rightValue) return 1;
  if (leftValue.length < 2 || rightValue.length < 2) return leftValue === rightValue ? 1 : 0;
  const grams = value => {
    const out = new Map();
    for (let index = 0; index < value.length - 1; index += 1) {
      const gram = value.slice(index, index + 2);
      out.set(gram, (out.get(gram) || 0) + 1);
    }
    return out;
  };
  const left = grams(leftValue);
  const right = grams(rightValue);
  let overlap = 0;
  for (const [gram, count] of left) overlap += Math.min(count, right.get(gram) || 0);
  const leftTotal = [...left.values()].reduce((sum, value) => sum + value, 0);
  const rightTotal = [...right.values()].reduce((sum, value) => sum + value, 0);
  return (2 * overlap) / Math.max(1, leftTotal + rightTotal);
}

function addIndex(indexes, name, key, vesselKeyValue) {
  if (!key || !vesselKeyValue) return;
  if (!indexes[name]) indexes[name] = {};
  if (!indexes[name][key]) indexes[name][key] = [];
  if (!indexes[name][key].includes(vesselKeyValue)) indexes[name][key].push(vesselKeyValue);
}

function nodeFromRecord(record = {}, sourceKey = "core") {
  const d = display(record);
  const key = vesselKey(d);
  if (!key) return null;
  const canonicalName = firstNonEmpty(d.vessel_name, d.display_name, d.name);
  const normalizedName = normalizeVesselName(canonicalName || d.normalized_vessel_name);
  const callSign = normalizeCallSign(firstNonEmpty(d.call_sign, d.callsign, d.clsgn));
  const imo = String(firstNonEmpty(d.imo)).replace(/^IMO/i, "").trim();
  const mmsi = String(firstNonEmpty(d.mmsi)).trim();
  const gt = gtValue(d);
  const port = normalizedPortValue(d);
  const berth = normalizedBerthValue(d);
  const vesselType = normalizeVesselType(firstNonEmpty(d.vessel_type, d.vsslKndNm, d.tonnage_summary?.vessel_type));
  const times = recordTimes(d);
  return {
    vessel_key: key,
    canonical_vessel_name: canonicalName || normalizedName || key,
    normalized_vessel_name: normalizedName,
    vessel_name_aliases: unique([canonicalName, d.normalized_vessel_name, normalizedName]),
    call_sign: callSign,
    imo,
    mmsi,
    flag: normalizeFlag(firstNonEmpty(d.flag)),
    gt,
    gt_bucket: gtBucket(gt),
    vessel_type: vesselType,
    current_port: firstNonEmpty(d.current_port, d.port, d.port_name, d.port_display_name),
    normalized_current_port: port,
    recent_ports: unique([port, normalizedPortValue({ port: d.previous_port }), normalizedPortValue({ port: d.next_port })]),
    recent_berths: unique([berth]),
    last_arrival_at: latestIso([d.ata, d.atb, d.eta, d.etb]),
    last_departure_estimated_at: latestIso([d.atd, d.etd]),
    source_keys: unique([sourceKey, ...(Array.isArray(d.data_sources) ? d.data_sources : []), ...(Array.isArray(d.enrichment_sources) ? d.enrichment_sources : []), d.source]),
    confidence: number(d.identity_confidence, sourceKey === "source_csv" ? 75 : 90),
    is_current_vessel: sourceKey !== "source_csv_reference_only",
    time_epochs: times.map(item => item.epoch_ms).filter(Boolean)
  };
}

function mergeNode(target, incoming = {}) {
  target.canonical_vessel_name = target.canonical_vessel_name || incoming.canonical_vessel_name;
  target.normalized_vessel_name = target.normalized_vessel_name || incoming.normalized_vessel_name;
  target.vessel_name_aliases = unique([...(target.vessel_name_aliases || []), ...(incoming.vessel_name_aliases || [])]);
  target.call_sign = target.call_sign || incoming.call_sign || "";
  target.imo = target.imo || incoming.imo || "";
  target.mmsi = target.mmsi || incoming.mmsi || "";
  target.flag = target.flag || incoming.flag || "";
  target.gt = target.gt || incoming.gt || null;
  target.gt_bucket = target.gt_bucket || incoming.gt_bucket || "";
  target.vessel_type = target.vessel_type || incoming.vessel_type || "";
  target.current_port = target.current_port || incoming.current_port || "";
  target.normalized_current_port = target.normalized_current_port || incoming.normalized_current_port || "";
  target.recent_ports = unique([...(target.recent_ports || []), ...(incoming.recent_ports || [])]);
  target.recent_berths = unique([...(target.recent_berths || []), ...(incoming.recent_berths || [])]);
  target.last_arrival_at = latestIso([target.last_arrival_at, incoming.last_arrival_at]);
  target.last_departure_estimated_at = latestIso([target.last_departure_estimated_at, incoming.last_departure_estimated_at]);
  target.source_keys = unique([...(target.source_keys || []), ...(incoming.source_keys || [])]);
  target.confidence = Math.max(number(target.confidence), number(incoming.confidence));
  target.is_current_vessel = target.is_current_vessel !== false || incoming.is_current_vessel !== false;
  target.time_epochs = unique([...(target.time_epochs || []), ...(incoming.time_epochs || [])]).map(Number).filter(Number.isFinite);
  return target;
}

function sourceCsvReferenceRows(cache = {}) {
  if (Array.isArray(cache?.items)) return cache.items;
  if (Array.isArray(cache?.references)) return cache.references;
  return [];
}

function sourceRowKey(row = {}) {
  return String(firstNonEmpty(row.source, row.source_name, row.source_key, row.raw_source, row.source_profile)).toLowerCase();
}

function isPilotRow(row = {}) {
  const key = sourceRowKey(row);
  return key.startsWith("pilot_source_") || key.includes("pilot") || row.source_origin === "pilot_schedule" || row.pilot_source_url;
}

function isBerthRow(row = {}) {
  const key = sourceRowKey(row);
  return key.startsWith("pnc_source_") || key.includes("pnc") || key.includes("berth_source") || row.pnc_source_url || row.source_origin === "berth_schedule";
}

function isAisInfoRow(row = {}) {
  return sourceRowKey(row).includes("mof_ais_info");
}

function isAisDynamicRow(row = {}) {
  return sourceRowKey(row).includes("mof_ais_dynamic");
}

function isVesselSpecRow(row = {}) {
  return sourceRowKey(row).includes("vessel_spec");
}

function matchLookupKeyFromNode(node = {}) {
  const keys = buildVesselMatchKeys(node);
  return {
    imo: keys.imo || "",
    mmsi: keys.mmsi || "",
    call_sign: keys.call_sign || "",
    vessel_name: keys.vessel_name || node.normalized_vessel_name || "",
    vessel_name_gt_type: keys.vessel_name_gt_type || ""
  };
}

export function buildVesselIdentityGraphPayload({
  records = [],
  sourceRows = [],
  sourceCsvReferenceCache = {},
  generatedAt = new Date().toISOString()
} = {}) {
  const nodes = new Map();
  const lookup = {
    by_imo: new Map(),
    by_mmsi: new Map(),
    by_call_sign: new Map(),
    by_normalized_vessel_name: new Map(),
    by_vessel_name_gt_type: new Map()
  };
  const remember = node => {
    if (!node?.vessel_key) return null;
    const existing = nodes.get(node.vessel_key);
    const merged = existing ? mergeNode(existing, node) : node;
    nodes.set(merged.vessel_key, merged);
    const keys = matchLookupKeyFromNode(merged);
    for (const [name, value] of Object.entries(keys)) {
      if (!value) continue;
      const mapName = name === "vessel_name" ? "by_normalized_vessel_name" : `by_${name}`;
      if (!lookup[mapName]) continue;
      if (!lookup[mapName].has(value)) lookup[mapName].set(value, merged.vessel_key);
    }
    return merged;
  };

  for (const record of records || []) remember(nodeFromRecord(record, "core"));

  for (const reference of sourceCsvReferenceRows(sourceCsvReferenceCache)) {
    const refNode = nodeFromRecord(reference, "source_csv_reference_only");
    if (!refNode) continue;
    const keys = matchLookupKeyFromNode(refNode);
    const targetKey = lookup.by_imo.get(keys.imo) ||
      lookup.by_mmsi.get(keys.mmsi) ||
      lookup.by_call_sign.get(keys.call_sign) ||
      lookup.by_vessel_name_gt_type.get(keys.vessel_name_gt_type) ||
      lookup.by_normalized_vessel_name.get(keys.vessel_name);
    if (targetKey && nodes.has(targetKey)) {
      refNode.vessel_key = targetKey;
      refNode.is_current_vessel = true;
      refNode.source_keys = unique([...(refNode.source_keys || []), "source_csv"]);
      remember(refNode);
    } else {
      refNode.vessel_key = `REF-${firstNonEmpty(refNode.call_sign, refNode.imo, refNode.mmsi, refNode.normalized_vessel_name)}`.toUpperCase();
      refNode.is_current_vessel = false;
      refNode.source_keys = unique([...(refNode.source_keys || []), "source_csv"]);
      remember(refNode);
    }
  }

  for (const row of sourceRows || []) {
    if (!isPilotRow(row) && !isBerthRow(row) && !isAisInfoRow(row) && !isVesselSpecRow(row)) continue;
    const aliasNode = nodeFromRecord(row, isPilotRow(row) ? "pilot_sources_candidate" : isBerthRow(row) ? "berth_sources_candidate" : sourceRowKey(row));
    if (!aliasNode) continue;
    const keys = matchLookupKeyFromNode(aliasNode);
    const targetKey = lookup.by_call_sign.get(keys.call_sign) ||
      lookup.by_imo.get(keys.imo) ||
      lookup.by_mmsi.get(keys.mmsi) ||
      lookup.by_normalized_vessel_name.get(keys.vessel_name);
    if (targetKey && nodes.has(targetKey)) {
      aliasNode.vessel_key = targetKey;
      aliasNode.is_current_vessel = true;
      remember(aliasNode);
    }
  }

  const indexes = {
    by_call_sign: {},
    by_normalized_vessel_name: {},
    by_name_prefix: {},
    by_name_tokens: {},
    by_port: {},
    by_recent_port: {},
    by_gt_bucket: {},
    by_vessel_type: {},
    by_imo: {},
    by_mmsi: {}
  };
  const items = [...nodes.values()].map(node => {
    const clean = { ...node };
    delete clean.time_epochs;
    const key = clean.vessel_key;
    addIndex(indexes, "by_call_sign", clean.call_sign, key);
    addIndex(indexes, "by_normalized_vessel_name", clean.normalized_vessel_name, key);
    addIndex(indexes, "by_name_prefix", clean.normalized_vessel_name?.slice(0, 4), key);
    for (const token of nameTokens(clean.normalized_vessel_name)) addIndex(indexes, "by_name_tokens", token, key);
    addIndex(indexes, "by_port", clean.normalized_current_port, key);
    for (const port of clean.recent_ports || []) addIndex(indexes, "by_recent_port", port, key);
    addIndex(indexes, "by_gt_bucket", clean.gt_bucket, key);
    addIndex(indexes, "by_vessel_type", clean.vessel_type, key);
    addIndex(indexes, "by_imo", clean.imo, key);
    addIndex(indexes, "by_mmsi", clean.mmsi, key);
    return clean;
  }).sort((a, b) => String(a.vessel_key).localeCompare(String(b.vessel_key)));

  return {
    schema_version: PUBLIC_SCHEMA_VERSION,
    generated_at: generatedAt,
    owner_tier: "fast_aux",
    core_may_update: false,
    source_layer: "auxiliary",
    load_strategy: "lazy",
    startup_safe: false,
    record_count: items.length,
    item_count: items.length,
    current_vessel_count: items.filter(item => item.is_current_vessel !== false).length,
    reference_only_count: items.filter(item => item.is_current_vessel === false).length,
    matching_booster_available: sourceCsvReferenceRows(sourceCsvReferenceCache).length > 0,
    identity_graph_stats: {
      nodes: items.length,
      current_vessels: items.filter(item => item.is_current_vessel !== false).length,
      source_csv_reference_rows: sourceCsvReferenceRows(sourceCsvReferenceCache).length,
      indexes_built: Object.keys(indexes)
    },
    indexes,
    items
  };
}

function itemByKey(graphPayload = {}) {
  return new Map((graphPayload.items || []).map(item => [item.vessel_key, item]));
}

function candidateKeysForRow(row = {}, graphPayload = {}) {
  const indexes = graphPayload.indexes || {};
  const keys = buildVesselMatchKeys(row);
  const normalizedName = keys.vessel_name || normalizeVesselName(firstNonEmpty(row.vessel_name, row.normalized_vessel_name));
  const port = normalizedPortValue(row);
  const gt = gtValue(row);
  const vesselType = normalizeVesselType(firstNonEmpty(row.vessel_type, row.vsslKndNm));
  const out = new Set();
  const add = list => (Array.isArray(list) ? list : []).forEach(key => out.add(key));
  add(indexes.by_imo?.[keys.imo]);
  add(indexes.by_mmsi?.[keys.mmsi]);
  add(indexes.by_call_sign?.[keys.call_sign]);
  add(indexes.by_normalized_vessel_name?.[normalizedName]);
  add(indexes.by_name_prefix?.[normalizedName.slice(0, 4)]);
  for (const token of nameTokens(normalizedName)) add(indexes.by_name_tokens?.[token]);
  add(indexes.by_port?.[port]);
  add(indexes.by_recent_port?.[port]);
  add(indexes.by_gt_bucket?.[gtBucket(gt)]);
  add(indexes.by_vessel_type?.[vesselType]);
  return [...out].slice(0, 120);
}

function timeEvidence(row = {}, node = {}) {
  const rowTimes = recordTimes(row);
  const nodeTimes = [
    ...(node.time_epochs || []),
    ...[node.last_arrival_at, node.last_departure_estimated_at].map(value => normalizeDateTime(value).epoch_ms).filter(Boolean)
  ];
  if (!rowTimes.length || !nodeTimes.length) return { score: 0, reason: "", hours: null };
  let best = Infinity;
  for (const rowTime of rowTimes) {
    for (const nodeTime of nodeTimes) best = Math.min(best, Math.abs(rowTime.epoch_ms - Number(nodeTime)) / 36e5);
  }
  if (!Number.isFinite(best)) return { score: 0, reason: "", hours: null };
  const rounded = Math.round(best * 10) / 10;
  if (best <= 24) return { score: 10, reason: "time_window_24h", hours: rounded };
  if (best <= 48) return { score: 5, reason: "time_window_48h", hours: rounded };
  return { score: 0, reason: "time_outside_window", hours: rounded };
}

function scoreEvidence(row = {}, node = {}, mode = "pilot") {
  let score = 0;
  const evidence = [];
  const rowKeys = buildVesselMatchKeys(row);
  const rowName = rowKeys.vessel_name || normalizeVesselName(firstNonEmpty(row.vessel_name, row.normalized_vessel_name));
  const rowCall = rowKeys.call_sign || normalizeCallSign(firstNonEmpty(row.call_sign, row.callsign));
  const rowPort = normalizedPortValue(row);
  const rowBerth = normalizedBerthValue(row);
  const rowGtBucket = gtBucket(gtValue(row));
  const rowType = normalizeVesselType(firstNonEmpty(row.vessel_type, row.vsslKndNm));
  const nodeName = node.normalized_vessel_name || "";
  const nameSimilarity = diceSimilarity(rowName, nodeName);

  if (rowCall && node.call_sign && rowCall === node.call_sign) {
    score += 45;
    evidence.push("call_sign_exact");
  }
  if (rowName && nodeName && rowName === nodeName) {
    score += mode === "berth" ? 35 : 30;
    evidence.push("normalized_vessel_name_exact");
  } else if (nameSimilarity >= 0.92) {
    score += mode === "berth" ? 25 : 22;
    evidence.push(`vessel_name_similarity_${Math.round(nameSimilarity * 100)}`);
  }
  if (rowPort && (node.normalized_current_port === rowPort || (node.recent_ports || []).includes(rowPort))) {
    score += mode === "berth" ? 20 : 15;
    evidence.push("same_normalized_port");
  }
  if (mode === "pilot" && rowPort && (node.recent_ports || []).includes(rowPort)) {
    score += 8;
    evidence.push("same_recent_port_booster");
  }
  if (mode === "berth" && rowBerth && (node.recent_berths || []).includes(rowBerth)) {
    score += 15;
    evidence.push("same_berth_or_terminal");
  }
  if (mode === "berth" && rowBerth && !(node.recent_berths || []).includes(rowBerth) && rowPort === "BUSAN") {
    score += 5;
    evidence.push("busan_pnc_context");
  }
  const time = timeEvidence(row, node);
  if (mode === "pilot" && time.score >= 10) {
    score += 10;
    evidence.push(time.reason);
  } else if (mode === "berth" && time.score) {
    score += time.score;
    evidence.push(time.reason);
  }
  if ((rowType && node.vessel_type && rowType === node.vessel_type) || (rowGtBucket && node.gt_bucket && rowGtBucket === node.gt_bucket)) {
    score += 5;
    evidence.push(rowType && rowType === node.vessel_type ? "same_vessel_type" : "same_gt_bucket");
  }
  if (mode === "berth" && hasValue(firstNonEmpty(row.voyage_no, row.voyageNo, row.vslVoyNo))) {
    score += 5;
    evidence.push("voyage_hint_present");
  }
  if (mode === "berth" && hasValue(firstNonEmpty(row.vessel_code, row.vslCd, row.pnc_vessel_code)) && rowName && nodeName) {
    score += 10;
    evidence.push("pnc_vessel_code_with_name");
  }
  return {
    score: Math.max(0, Math.min(100, Math.round(score))),
    evidence: unique(evidence),
    name_similarity: Math.round(nameSimilarity * 1000) / 1000,
    time_diff_hours: time.hours
  };
}

function bestMatchForRow(row = {}, graphPayload = {}, mode = "pilot") {
  const nodes = itemByKey(graphPayload);
  const candidates = candidateKeysForRow(row, graphPayload)
    .map(key => nodes.get(key))
    .filter(node => node && node.is_current_vessel !== false);
  if (!candidates.length) return { candidate: null, score: 0, evidence: [], blocker_reason: "no_identity_graph_candidate" };
  const scored = candidates.map(candidate => ({
    candidate,
    ...scoreEvidence(row, candidate, mode)
  })).sort((a, b) => b.score - a.score);
  const best = scored[0];
  return {
    candidate: best.candidate,
    score: best.score,
    evidence: best.evidence,
    name_similarity: best.name_similarity,
    time_diff_hours: best.time_diff_hours,
    blocker_reason: best.score > 0 ? "" : "candidate_score_zero"
  };
}

function pilotStatus(row = {}) {
  const statusText = String(firstNonEmpty(row.status, row.pilotage_status, row.pilot_status)).toUpperCase();
  const timeInfo = normalizeDateTime(firstNonEmpty(row.pilot_time, row.pilot_time_text, row.movement_time));
  if (timeInfo.time_only_missing_date) return "TIME_ONLY";
  if (/SCHEDULE|PLAN|ETA|EXPECTED|예정/i.test(statusText)) return "SCHEDULED";
  if (hasValue(firstNonEmpty(row.pilot_time, row.pilot_time_text, row.movement_time))) return "DETECTED";
  return "UNKNOWN";
}

function pilotDirection(row = {}) {
  const text = String(firstNonEmpty(row.pilot_direction, row.direction, row.movement_type)).toUpperCase();
  if (/IN|ARR|입항|도착/.test(text)) return "INBOUND";
  if (/OUT|DEP|출항|출발/.test(text)) return "OUTBOUND";
  return "UNKNOWN";
}

function matchAction(score = 0, mode = "pilot") {
  const applyThreshold = mode === "berth" ? 80 : 85;
  if (score >= applyThreshold) return "APPLY";
  if (score >= 60) return "REVIEW";
  return "REJECT";
}

function sourceRowId(row = {}, index = 0) {
  return String(firstNonEmpty(row.raw_row_identity, row.source_row_id, `${sourceRowKey(row)}:${row.vessel_name || row.call_sign || "row"}:${index}`));
}

function matchResultRow(row = {}, graphPayload = {}, mode = "pilot", index = 0) {
  const normalizedPort = normalizedPortValue(row);
  const normalizedName = normalizeVesselName(firstNonEmpty(row.vessel_name, row.normalized_vessel_name));
  const normalizedCall = normalizeCallSign(firstNonEmpty(row.call_sign, row.callsign));
  const match = bestMatchForRow(row, graphPayload, mode);
  const action = matchAction(match.score, mode);
  const blocker = action === "REJECT"
    ? (!normalizedName && !normalizedCall ? "missing_vessel_identity" : match.blocker_reason || "below_apply_or_review_threshold")
    : "";
  const base = {
    source_row_id: sourceRowId(row, index),
    raw_vessel_name: firstNonEmpty(row.vessel_name, row.name),
    normalized_vessel_name: normalizedName,
    raw_call_sign: firstNonEmpty(row.call_sign, row.callsign),
    normalized_call_sign: normalizedCall,
    raw_port: firstNonEmpty(row.raw_port, row.port, row.port_name, row.current_port),
    normalized_port: normalizedPort,
    candidate_vessel_key: match.candidate?.vessel_key || null,
    matched_vessel_name: match.candidate?.canonical_vessel_name || null,
    score: match.score,
    match_type: match.evidence.join("+") || "no_match",
    evidence: match.evidence,
    action,
    blocker_reason: blocker
  };
  if (mode === "berth") {
    return {
      ...base,
      berth: firstNonEmpty(row.berth, row.berth_name),
      terminal: firstNonEmpty(row.terminal, row.terminal_name),
      berth_direction: firstNonEmpty(row.berth_direction, row.operation_type, row.status),
      voyage_no: firstNonEmpty(row.voyage_no, row.voyageNo, row.vslVoyNo),
      operator_hint: firstNonEmpty(row.operator, row.agent, row.agent_name)
    };
  }
  return base;
}

function pilotPatchHint(match = {}, row = {}, generatedAt = new Date().toISOString()) {
  const timeInfo = normalizeDateTime(firstNonEmpty(row.pilot_time, row.pilot_time_text, row.movement_time, row.raw_pilot_time));
  const fieldPatch = {
    has_pilotage: true,
    source: "pilot_sources",
    status: pilotStatus(row),
    pilotage_status: pilotStatus(row),
    pilotage_time: timeInfo.time_only_missing_date ? null : timeInfo.timestamp,
    pilotage_time_text: firstNonEmpty(row.pilot_time_text, timeInfo.time_text, row.raw_pilot_time) || null,
    port: match.normalized_port || normalizedPortValue(row) || null,
    direction: pilotDirection(row),
    pilotage_direction: pilotDirection(row),
    match_type: match.match_type,
    confidence: match.score,
    reason: "Pilotage signal confirmed by evidence-based auxiliary matching.",
    updated_at: generatedAt
  };
  return {
    vessel_key: match.candidate_vessel_key,
    source_key: "pilot_sources",
    signal_type: "pilotage_signal",
    fields: { pilotage_signal: fieldPatch },
    field_patch: fieldPatch,
    confidence: match.score,
    match_type: match.match_type,
    evidence: match.evidence,
    apply_policy: "APPLY",
    source_generated_at: generatedAt
  };
}

function berthPatchHint(match = {}, row = {}, generatedAt = new Date().toISOString()) {
  const fieldPatch = {
    has_berth_info: true,
    has_berth: true,
    source: sourceRowKey(row).includes("pnc") ? "PNC" : "berth_sources",
    terminal: firstNonEmpty(row.terminal, row.terminal_name) || null,
    berth: firstNonEmpty(row.berth, row.berth_name) || null,
    berth_direction: firstNonEmpty(row.berth_direction, row.operation_type, row.status) || null,
    match_type: match.match_type,
    confidence: match.score,
    signal_strength: "AUX_CONFIRMED",
    reason: "Berth or terminal signal confirmed by evidence-based auxiliary matching.",
    updated_at: generatedAt
  };
  return {
    vessel_key: match.candidate_vessel_key,
    source_key: "berth_sources",
    signal_type: "berth_signal",
    fields: { berth_signal: fieldPatch },
    field_patch: fieldPatch,
    confidence: match.score,
    match_type: match.match_type,
    evidence: match.evidence,
    apply_policy: "APPLY",
    source_generated_at: generatedAt
  };
}

function envelope({ generatedAt, sourceKey, items = [], extra = {} }) {
  const actions = items.reduce((acc, item) => {
    acc[item.action] = (acc[item.action] || 0) + 1;
    return acc;
  }, {});
  return {
    schema_version: PUBLIC_SCHEMA_VERSION,
    generated_at: generatedAt,
    owner_tier: "fast_aux",
    core_may_update: false,
    source_key: sourceKey,
    source_layer: "auxiliary",
    load_strategy: "lazy",
    startup_safe: false,
    record_count: items.length,
    item_count: items.length,
    action_counts: actions,
    apply_count: number(actions.APPLY),
    review_count: number(actions.REVIEW),
    reject_count: number(actions.REJECT),
    match_rate: items.length ? Math.round(((number(actions.APPLY) + number(actions.REVIEW)) / items.length) * 1000) / 10 : 0,
    apply_rate: items.length ? Math.round((number(actions.APPLY) / items.length) * 1000) / 10 : 0,
    review_rate: items.length ? Math.round((number(actions.REVIEW) / items.length) * 1000) / 10 : 0,
    ...extra,
    items
  };
}

function patchHintsEnvelope({ generatedAt, items = [], graphPayload = {}, report = {} }) {
  const deduped = [];
  const seen = new Set();
  for (const item of items.sort((a, b) => number(b.confidence) - number(a.confidence))) {
    const key = `${item.vessel_key}:${item.signal_type}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
  }
  const applyPolicyCounts = deduped.reduce((acc, item) => {
    acc[item.apply_policy] = (acc[item.apply_policy] || 0) + 1;
    return acc;
  }, {});
  return {
    schema_version: PUBLIC_SCHEMA_VERSION,
    generated_at: generatedAt,
    aux_run_id: report.run_id || null,
    owner_tier: "fast_aux",
    core_may_update: false,
    source_endpoint: "dashboard/api/enrichment/vessel-identity-graph.json",
    patch_policy: "Evidence-based auxiliary signal hints only; core applies by vessel_key and does not recompute matching.",
    load_strategy: "lazy",
    startup_safe: false,
    matching_booster_available: graphPayload.matching_booster_available === true,
    identity_graph_stats: graphPayload.identity_graph_stats || {},
    record_count: deduped.length,
    item_count: deduped.length,
    patch_hints_created: deduped.length,
    apply_policy_counts: applyPolicyCounts,
    review_count: number(applyPolicyCounts.REVIEW),
    signal_type_counts: deduped.reduce((acc, item) => {
      acc[item.signal_type] = (acc[item.signal_type] || 0) + 1;
      return acc;
    }, {}),
    items: deduped
  };
}

function topBlockers(items = []) {
  const counts = {};
  for (const item of items) {
    const reason = item.blocker_reason || (item.action === "REJECT" ? "below_threshold" : "");
    if (!reason) continue;
    counts[reason] = (counts[reason] || 0) + 1;
  }
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([reason, count]) => ({ reason, count }));
}

function buildVesselSpecParserDiagnostic({ sourceRows = [], sourceCollectionStatus = {}, generatedAt = new Date().toISOString() }) {
  const statusItem = (sourceCollectionStatus.items || []).find(item => item.source_key === "vessel_spec") || {};
  const diagnostics = Array.isArray(statusItem.diagnostics) ? statusItem.diagnostics : [];
  const diag = diagnostics.find(item => item.key === "vessel_spec") || diagnostics[0] || {};
  const rowsCollected = number(statusItem.rows_collected || diag.rows_collected || diag.row_count);
  const rowsNormalized = sourceRows.filter(isVesselSpecRow).length || number(statusItem.rows_normalized || diag.rows_normalized || diag.normalized_count);
  const rawSampleKeys = unique([
    ...(Array.isArray(diag.raw_sample_keys) ? diag.raw_sample_keys : []),
    ...(Array.isArray(diag.sample_keys) ? diag.sample_keys : []),
    ...(Array.isArray(diag.header_row_fields) ? diag.header_row_fields : [])
  ]).slice(0, 80);
  const responseShape = {
    status: statusItem.status || diag.status || "UNKNOWN",
    http_status: diag.http_status || statusItem.http_status || null,
    content_type: diag.content_type || diag.response_content_type || null,
    row_count_estimate: diag.row_count_estimate ?? null,
    raw_sample_key_count: rawSampleKeys.length,
    nested_items_detected: Array.isArray(diag.sanitized_raw_samples) && diag.sanitized_raw_samples.some(sample =>
      sample && typeof sample === "object" && Object.values(sample).some(value => Array.isArray(value) || (value && typeof value === "object"))
    )
  };
  let blocker = "";
  if (String(statusItem.status || "").toUpperCase() === "SKIPPED") blocker = "skipped_by_schedule_or_cache_policy";
  else if (rowsCollected <= 0) blocker = "empty_items";
  else if (!rawSampleKeys.length) blocker = "metadata_only";
  else if (rowsNormalized <= 0 && responseShape.nested_items_detected) blocker = "nested_shape_unsupported";
  else if (rowsNormalized <= 0) blocker = "alias_missing";
  else blocker = "none";
  return {
    schema_version: PUBLIC_SCHEMA_VERSION,
    generated_at: generatedAt,
    owner_tier: "fast_aux",
    core_may_update: false,
    source_key: "vessel_spec",
    source_layer: "auxiliary",
    load_strategy: "lazy",
    startup_safe: false,
    rows_collected: rowsCollected,
    rows_normalized: rowsNormalized,
    raw_sample_keys: rawSampleKeys,
    sanitized_raw_sample_keys: rawSampleKeys,
    response_shape: responseShape,
    alias_map: VESSEL_SPEC_ALIAS_MAP,
    parser_blocker: blocker,
    blocker_reason: blocker === "none" ? "" : blocker,
    record_count: 1,
    item_count: 0
  };
}

function buildAisTargetEnrichment({ sourceRows = [], targetRecords = [], graphPayload = {}, generatedAt = new Date().toISOString(), previous = {} }) {
  const maxTargets = number(process.env.AIS_TARGET_BATCH_SIZE || process.env.MAX_AIS_TARGET_BATCH_SIZE, 50) || 50;
  const targets = [];
  const seen = new Set();
  for (const row of targetRecords || []) {
    const key = vesselKey(row);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    targets.push(row);
    if (targets.length >= maxTargets) break;
  }
  const aisInfoRows = sourceRows.filter(isAisInfoRow);
  const aisDynamicRows = sourceRows.filter(isAisDynamicRow);
  const aisRows = [...aisInfoRows, ...aisDynamicRows];
  const matches = aisRows
    .map((row, index) => ({ row, match: bestMatchForRow(row, graphPayload, "pilot"), index }))
    .filter(item => item.match.score >= 60);
  const infoMatches = matches.filter(item => isAisInfoRow(item.row));
  const dynamicMatches = matches.filter(item => isAisDynamicRow(item.row));
  const positionHints = dynamicMatches.slice(0, 50).map(item => ({
    vessel_key: item.match.candidate?.vessel_key || null,
    lat: normalizeNumeric(firstNonEmpty(item.row.lat, item.row.latitude)),
    lon: normalizeNumeric(firstNonEmpty(item.row.lon, item.row.lng, item.row.longitude)),
    speed: normalizeNumeric(firstNonEmpty(item.row.speed, item.row.sog)),
    course: normalizeNumeric(firstNonEmpty(item.row.course, item.row.cog)),
    source_key: "mof_ais_dynamic"
  })).filter(item => item.vessel_key && item.lat !== null && item.lon !== null);
  const matchedCount = matches.length;
  const coverageLabel = matchedCount > 100 ? "BROAD_PARTIAL" : targets.length > 10 ? "TARGETED_PARTIAL" : "SMOKE_LEVEL";
  return {
    schema_version: PUBLIC_SCHEMA_VERSION,
    generated_at: generatedAt,
    owner_tier: "fast_aux",
    core_may_update: false,
    source_key: "mof_ais_target_enrichment",
    source_layer: "auxiliary",
    load_strategy: "lazy",
    startup_safe: false,
    target_vessels_checked: targets.length,
    ais_info_matches: infoMatches.length,
    ais_dynamic_matches: dynamicMatches.length,
    imo_candidates: unique(matches.map(item => item.row.imo)).slice(0, 100),
    mmsi_candidates: unique(matches.map(item => item.row.mmsi)).slice(0, 100),
    position_hints: positionHints,
    cache_reused: Boolean(previous?.generated_at && !aisRows.length),
    next_cursor: targets.length >= maxTargets ? maxTargets : 0,
    coverage_label: coverageLabel,
    record_count: 1,
    item_count: 0
  };
}

function metricForPayload(payload = {}) {
  const rows = number(payload.record_count || payload.item_count);
  const matched = number(payload.apply_count) + number(payload.review_count);
  return {
    rows,
    matched,
    apply: number(payload.apply_count),
    review: number(payload.review_count),
    reject: number(payload.reject_count),
    match_rate: payload.match_rate || 0,
    apply_rate: payload.apply_rate || 0,
    review_rate: payload.review_rate || 0,
    top_blockers: topBlockers(payload.items || [])
  };
}

export function buildAuxEvidenceMatchingPayloads({
  sourceRows = [],
  graphPayload = {},
  sourceCollectionStatus = {},
  sourceCsvReferenceCache = {},
  targetRecords = [],
  generatedAt = new Date().toISOString(),
  report = {},
  previousAisTarget = {}
} = {}) {
  const pilotRows = (sourceRows || []).filter(isPilotRow);
  const berthRows = (sourceRows || []).filter(isBerthRow);
  const pilotItems = pilotRows.map((row, index) => matchResultRow(row, graphPayload, "pilot", index));
  const berthItems = berthRows.map((row, index) => matchResultRow(row, graphPayload, "berth", index));
  const pilotageMatchResults = envelope({
    generatedAt,
    sourceKey: "pilot_sources",
    items: pilotItems,
    extra: {
      matching_booster_available: sourceCsvReferenceRows(sourceCsvReferenceCache).length > 0,
      top_blockers: topBlockers(pilotItems)
    }
  });
  const berthMatchResults = envelope({
    generatedAt,
    sourceKey: "berth_sources",
    items: berthItems,
    extra: {
      matching_booster_available: sourceCsvReferenceRows(sourceCsvReferenceCache).length > 0,
      top_blockers: topBlockers(berthItems)
    }
  });
  const patchItems = [
    ...pilotItems.filter(item => item.action === "APPLY").map(item => {
      const row = pilotRows.find((candidate, index) => sourceRowId(candidate, index) === item.source_row_id) || {};
      return pilotPatchHint(item, row, generatedAt);
    }),
    ...berthItems.filter(item => item.action === "APPLY").map(item => {
      const row = berthRows.find((candidate, index) => sourceRowId(candidate, index) === item.source_row_id) || {};
      return berthPatchHint(item, row, generatedAt);
    })
  ].filter(item => item.vessel_key);
  const patchHints = patchHintsEnvelope({ generatedAt, items: patchItems, graphPayload, report });
  const vesselSpecParserDiagnostic = buildVesselSpecParserDiagnostic({ sourceRows, sourceCollectionStatus, generatedAt });
  const aisTargetEnrichment = buildAisTargetEnrichment({ sourceRows, targetRecords, graphPayload, generatedAt, previous: previousAisTarget });
  const metrics = {
    matching_booster_available: sourceCsvReferenceRows(sourceCsvReferenceCache).length > 0,
    identity_graph_stats: graphPayload.identity_graph_stats || {},
    match_rate_by_source: {
      pilot_sources: pilotageMatchResults.match_rate,
      berth_sources: berthMatchResults.match_rate
    },
    apply_rate_by_source: {
      pilot_sources: pilotageMatchResults.apply_rate,
      berth_sources: berthMatchResults.apply_rate
    },
    review_rate_by_source: {
      pilot_sources: pilotageMatchResults.review_rate,
      berth_sources: berthMatchResults.review_rate
    },
    top_blockers: {
      pilot_sources: pilotageMatchResults.top_blockers,
      berth_sources: berthMatchResults.top_blockers,
      vessel_spec: vesselSpecParserDiagnostic.blocker_reason ? [{ reason: vesselSpecParserDiagnostic.blocker_reason, count: 1 }] : [],
      mof_ais_info: aisTargetEnrichment.coverage_label === "SMOKE_LEVEL" ? [{ reason: "smoke_level_coverage", count: 1 }] : []
    },
    source_metrics: {
      pilot_sources: metricForPayload(pilotageMatchResults),
      berth_sources: metricForPayload(berthMatchResults),
      vessel_spec: {
        rows: vesselSpecParserDiagnostic.rows_collected,
        matched: vesselSpecParserDiagnostic.rows_normalized,
        apply: 0,
        review: 0,
        reject: Math.max(0, vesselSpecParserDiagnostic.rows_collected - vesselSpecParserDiagnostic.rows_normalized),
        match_rate: vesselSpecParserDiagnostic.rows_collected
          ? Math.round((vesselSpecParserDiagnostic.rows_normalized / vesselSpecParserDiagnostic.rows_collected) * 1000) / 10
          : 0,
        top_blockers: vesselSpecParserDiagnostic.blocker_reason ? [{ reason: vesselSpecParserDiagnostic.blocker_reason, count: 1 }] : []
      },
      mof_ais_info: {
        rows: aisTargetEnrichment.target_vessels_checked,
        matched: aisTargetEnrichment.ais_info_matches,
        apply: 0,
        review: aisTargetEnrichment.ais_info_matches,
        reject: 0,
        match_rate: aisTargetEnrichment.target_vessels_checked
          ? Math.round((aisTargetEnrichment.ais_info_matches / aisTargetEnrichment.target_vessels_checked) * 1000) / 10
          : 0,
        top_blockers: []
      },
      mof_ais_dynamic: {
        rows: aisTargetEnrichment.target_vessels_checked,
        matched: aisTargetEnrichment.ais_dynamic_matches,
        apply: 0,
        review: aisTargetEnrichment.ais_dynamic_matches,
        reject: 0,
        match_rate: aisTargetEnrichment.target_vessels_checked
          ? Math.round((aisTargetEnrichment.ais_dynamic_matches / aisTargetEnrichment.target_vessels_checked) * 1000) / 10
          : 0,
        top_blockers: []
      }
    },
    patch_hints_created: patchHints.patch_hints_created,
    review_queue_size: pilotageMatchResults.review_count + berthMatchResults.review_count
  };
  return {
    pilotageMatchResults,
    berthMatchResults,
    vesselSpecParserDiagnostic,
    aisTargetEnrichment,
    patchHints,
    metrics
  };
}

export function mergeAuxPatchHintsPayloads({ generatedAt = new Date().toISOString(), auxIndex = {}, report = {}, payloads = [], metrics = {} } = {}) {
  const items = payloads.flatMap(payload => Array.isArray(payload?.items) ? payload.items : []);
  const merged = patchHintsEnvelope({
    generatedAt,
    items,
    graphPayload: { matching_booster_available: metrics.matching_booster_available, identity_graph_stats: metrics.identity_graph_stats },
    report
  });
  return {
    ...merged,
    aux_run_id: auxIndex.aux_run_id || auxIndex.run_id || report.run_id || null,
    source_run_id: auxIndex.source_run_id || auxIndex.aux_run_id || auxIndex.run_id || report.run_id || null,
    review_count: items.filter(item => String(item.apply_policy || "").toUpperCase() === "REVIEW").length
  };
}

export function attachAuxEvidenceMetricsToSourceQualityScore(payload = {}, metrics = {}) {
  if (!payload || typeof payload !== "object") return payload;
  const sourceMetrics = metrics.source_metrics || {};
  return {
    ...payload,
    match_rate_by_source: metrics.match_rate_by_source || {},
    apply_rate_by_source: metrics.apply_rate_by_source || {},
    review_rate_by_source: metrics.review_rate_by_source || {},
    top_blockers: metrics.top_blockers || {},
    matching_booster_available: metrics.matching_booster_available === true,
    identity_graph_stats: metrics.identity_graph_stats || {},
    items: Array.isArray(payload.items)
      ? payload.items.map(item => {
        const sourceMetric = sourceMetrics[item.source_key];
        if (!sourceMetric) return item;
        const rowsNormalized = Math.max(number(item.rows_normalized), number(sourceMetric.rows));
        const rowsMatched = Math.max(number(item.rows_matched_to_vessels), number(sourceMetric.matched));
        const patchHintsCreated = Math.max(number(item.patch_hints_created), number(sourceMetric.apply));
        return {
          ...item,
          rows_normalized: rowsNormalized,
          rows_matched_to_vessels: rowsMatched,
          patch_hints_created: patchHintsCreated,
          match_rate: sourceMetric.match_rate,
          apply_rate: sourceMetric.apply_rate,
          review_rate: sourceMetric.review_rate,
          matching_booster_available: metrics.matching_booster_available === true,
          top_blockers: sourceMetric.top_blockers || [],
          blocker_reason: rowsMatched > 0 ? "" : item.blocker_reason,
          match_blockers: rowsMatched > 0 ? [] : item.match_blockers,
          recommended_fix: rowsMatched > 0 ? "No action required." : item.recommended_fix
        };
      })
      : payload.items
  };
}

export function attachAuxEvidenceMetricsToEnrichmentUtilization(payload = {}, metrics = {}) {
  if (!payload || typeof payload !== "object") return payload;
  const sourceMetrics = metrics.source_metrics || {};
  return {
    ...payload,
    match_rate_by_source: metrics.match_rate_by_source || {},
    apply_rate_by_source: metrics.apply_rate_by_source || {},
    review_rate_by_source: metrics.review_rate_by_source || {},
    top_blockers: metrics.top_blockers || {},
    matching_booster_available: metrics.matching_booster_available === true,
    identity_graph_stats: metrics.identity_graph_stats || {},
    patch_hints_created: Math.max(number(payload.patch_hints_created), number(metrics.patch_hints_created)),
    review_queue_size: Math.max(number(payload.review_queue_size), number(metrics.review_queue_size)),
    items: Array.isArray(payload.items)
      ? payload.items.map(item => {
        const sourceMetric = sourceMetrics[item.source_key];
        if (!sourceMetric) return item;
        return {
          ...item,
          matched_vessels: Math.max(number(item.matched_vessels), number(sourceMetric.matched)),
          rows_matched_to_vessels: Math.max(number(item.rows_matched_to_vessels), number(sourceMetric.matched)),
          patch_hints_created: Math.max(number(item.patch_hints_created), number(sourceMetric.apply)),
          match_rate: sourceMetric.match_rate,
          apply_rate: sourceMetric.apply_rate,
          review_rate: sourceMetric.review_rate,
          top_blockers: sourceMetric.top_blockers || [],
          blocker_reason: number(sourceMetric.matched) > 0 ? "" : item.blocker_reason
        };
      })
      : payload.items
  };
}
