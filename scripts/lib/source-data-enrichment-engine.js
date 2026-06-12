import crypto from "node:crypto";

const SOURCE_PRIORITIES = {
  identity: ["source_csv", "vessel_spec", "mof_ais_info", "port_operation", "fuzzy_inference"],
  specification: ["source_csv", "vessel_spec", "mof_ais_info", "port_operation"],
  operator: ["source_csv", "berth_sources", "vessel_spec", "inferred_operator"],
  operational_timing: ["pilot_sources", "berth_sources", "port_operation", "mof_ais_dynamic"],
  berth_terminal: ["berth_sources", "port_operation"],
  risk_compliance: ["port_operation", "mof_ais_dynamic", "opportunity_engine"]
};

const FIELD_RULES = {
  vessel_name: { group: "identity", aliases: ["vessel_name", "name", "ship_name", "vessel_display.vessel_name"], minConfidence: 78 },
  imo: { group: "identity", aliases: ["imo", "imo_no", "vessel_display.imo"], minConfidence: 88 },
  mmsi: { group: "identity", aliases: ["mmsi", "mmsi_no", "vessel_display.mmsi"], minConfidence: 88 },
  call_sign: { group: "identity", aliases: ["call_sign", "callsign", "clsgn", "vessel_display.call_sign"], minConfidence: 84 },
  normalized_vessel_name: { group: "identity", aliases: ["normalized_vessel_name", "vessel_name", "vessel_display.vessel_name"], minConfidence: 78 },
  gt: { group: "specification", aliases: ["gt", "grtg", "gross_tonnage", "tonnage_summary.gt", "vessel_display.gt"], minConfidence: 82 },
  dwt: { group: "specification", aliases: ["dwt", "deadweight", "tonnage_summary.dwt", "vessel_display.dwt"], minConfidence: 82 },
  flag: { group: "specification", aliases: ["flag", "nationality", "vessel_display.flag"], minConfidence: 78 },
  vessel_type: { group: "specification", aliases: ["vessel_type", "ship_type", "vessel_type_group", "vessel_display.vessel_type"], minConfidence: 78 },
  loa: { group: "specification", aliases: ["loa", "length_m", "length_overall", "vessel_display.loa"], minConfidence: 76 },
  beam: { group: "specification", aliases: ["beam", "breadth_m", "vessel_display.beam"], minConfidence: 76 },
  operator_display: { group: "operator", aliases: ["operator_display", "operator", "shipping_company", "company", "company_name", "manager", "owner", "vessel_display.operator_display"], minConfidence: 78 },
  owner: { group: "operator", aliases: ["owner", "owner_name", "registered_owner", "vessel_display.owner"], minConfidence: 78 },
  manager: { group: "operator", aliases: ["manager", "manager_name", "technical_manager", "vessel_display.manager"], minConfidence: 78 },
  fleet_group: { group: "operator", aliases: ["fleet_group", "operator_group", "operator_display", "vessel_display.operator_display"], minConfidence: 72 },
  current_port: { group: "operational_timing", aliases: ["current_port", "port_name", "port", "vessel_display.current_port"], minConfidence: 82 },
  berth: { group: "berth_terminal", aliases: ["berth", "berth_name", "vessel_display.berth"], minConfidence: 80 },
  terminal: { group: "berth_terminal", aliases: ["terminal", "terminal_name", "vessel_display.terminal"], minConfidence: 78 },
  eta: { group: "operational_timing", aliases: ["eta", "estimated_arrival", "vessel_display.eta"], minConfidence: 78 },
  etb: { group: "operational_timing", aliases: ["etb", "estimated_berth", "vessel_display.etb"], minConfidence: 78 },
  ata: { group: "operational_timing", aliases: ["ata", "actual_arrival", "arrival_time", "vessel_display.ata"], minConfidence: 78 },
  atd: { group: "operational_timing", aliases: ["atd", "actual_departure", "departure_time", "vessel_display.atd"], minConfidence: 78 },
  pilotage_signal: { group: "operational_timing", aliases: ["pilotage_signal", "vessel_display.pilotage_signal"], minConfidence: 82 },
  berth_signal: { group: "berth_terminal", aliases: ["berth_signal", "vessel_display.berth_signal"], minConfidence: 80 },
  compliance_route_risk: { group: "risk_compliance", aliases: ["compliance_route_risk", "compliance_score", "vessel_display.compliance_score"], minConfidence: 72 },
  cleaning_window: { group: "risk_compliance", aliases: ["cleaning_window", "window_type", "window_score"], minConfidence: 72 },
  biofouling_risk: { group: "risk_compliance", aliases: ["biofouling_risk", "biofouling_score", "biofouling_risk_score", "vessel_display.biofouling_score"], minConfidence: 72 },
  commercial_data_confidence: { group: "risk_compliance", aliases: ["commercial_data_confidence", "vessel_display.commercial_data_confidence"], minConfidence: 72 }
};

const SOURCE_FIELD_ALLOWLIST = {
  port_operation: ["vessel_name", "call_sign", "normalized_vessel_name", "gt", "vessel_type", "current_port", "eta", "etb", "ata", "atd", "berth", "operator_display"],
  source_csv: ["imo", "mmsi", "call_sign", "normalized_vessel_name", "operator_display", "owner", "manager", "fleet_group", "vessel_type", "gt", "dwt", "flag"],
  pilot_sources: ["pilotage_signal", "eta", "etb", "ata"],
  berth_sources: ["berth", "terminal", "etb", "ata", "berth_signal", "operator_display"],
  mof_ais_info: ["imo", "mmsi", "call_sign", "normalized_vessel_name", "vessel_type", "gt", "dwt", "flag"],
  mof_ais_dynamic: ["mmsi", "current_port", "eta", "ata"],
  mof_ais_stat: ["biofouling_risk", "cleaning_window"],
  vessel_spec: ["imo", "mmsi", "call_sign", "normalized_vessel_name", "vessel_type", "gt", "dwt", "flag", "loa", "beam"]
};

function hasValue(value) {
  if (value === undefined || value === null) return false;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "boolean") return value === true;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  const text = String(value).normalize("NFKC").trim();
  return text !== "" && text !== "-";
}

function isEmpty(value) {
  return !hasValue(value);
}

function pathValue(row = {}, path = "") {
  return String(path).split(".").reduce((value, part) => value && value[part], row);
}

function firstValue(row = {}, aliases = []) {
  for (const alias of aliases) {
    const value = pathValue(row, alias);
    if (hasValue(value)) return value;
  }
  return null;
}

function display(row = {}) {
  return row.vessel_display && typeof row.vessel_display === "object"
    ? row.vessel_display
    : {};
}

function merged(row = {}) {
  return { ...display(row), ...row };
}

function normalizeText(value = "") {
  return String(value || "")
    .normalize("NFKC")
    .trim()
    .toUpperCase()
    .replace(/\b(M\/V|MV|M\.V\.|S\/S|SS)\b/g, "")
    .replace(/[^A-Z0-9가-힣]+/g, "");
}

function vesselKey(row = {}) {
  const data = merged(row);
  const identity = [data.imo, data.mmsi, data.call_sign, data.vessel_id, data.master_vessel_id]
    .find(hasValue);
  if (identity) return String(identity).trim();
  return `${normalizeText(data.vessel_name || data.name)}|${normalizeText(data.current_port || data.port_name || data.port || "")}`;
}

function candidateHash(value) {
  return crypto.createHash("sha1").update(JSON.stringify(value)).digest("hex").slice(0, 16);
}

function sourceStatusMap(sourceCollectionStatus = {}, sourceQualityScore = {}) {
  const map = new Map();
  for (const item of sourceCollectionStatus.items || []) {
    map.set(item.source_key || item.key, item);
  }
  for (const item of sourceQualityScore.items || []) {
    map.set(item.source_key || item.key, { ...(map.get(item.source_key || item.key) || {}), ...item });
  }
  return map;
}

function recordSources(row = {}) {
  const data = merged(row);
  const sources = [
    ...(Array.isArray(data.data_sources) ? data.data_sources : []),
    ...(Array.isArray(data.enrichment_sources) ? data.enrichment_sources : []),
    data.source,
    data.source_name,
    data.source_key,
    data.data_source,
    data.data_source_used,
    data.identity_source,
    data.operator_source,
    data.berth_source,
    data.pilotage_source
  ].filter(hasValue).map(value => String(value).toLowerCase());

  const detected = new Set();
  if (sources.some(source => /source_csv|verified_csv|csv/.test(source))) detected.add("source_csv");
  if (sources.some(source => /vessel_spec|specification/.test(source))) detected.add("vessel_spec");
  if (sources.some(source => /mof_ais_info|ais_info/.test(source))) detected.add("mof_ais_info");
  if (sources.some(source => /mof_ais_dynamic|ais_dynamic/.test(source))) detected.add("mof_ais_dynamic");
  if (sources.some(source => /mof_ais_stat|ais_stat/.test(source))) detected.add("mof_ais_stat");
  if (sources.some(source => /pilot|pilotage/.test(source)) || data.pilotage_signal?.has_pilotage) detected.add("pilot_sources");
  if (sources.some(source => /berth|pnc|terminal/.test(source)) || data.berth_signal?.has_berth_info || hasValue(data.berth)) detected.add("berth_sources");
  if (sources.some(source => /port_operation|port-mis|port_mis|merged port operation/.test(source))) detected.add("port_operation");
  if (!detected.size && (hasValue(data.current_port) || hasValue(data.eta) || hasValue(data.ata))) detected.add("port_operation");
  return [...detected];
}

function sourcePriorityScore(sourceKey = "", fieldName = "") {
  const rule = FIELD_RULES[fieldName] || {};
  const list = SOURCE_PRIORITIES[rule.group] || [];
  const index = list.indexOf(sourceKey);
  if (index < 0) return 65;
  return Math.max(60, 98 - index * 8);
}

function inferMatchType(row = {}, sourceKey = "") {
  const data = merged(row);
  if (hasValue(data.imo)) return "IMO";
  if (hasValue(data.mmsi)) return "MMSI";
  if (hasValue(data.call_sign)) return "CALL_SIGN";
  if (hasValue(data.vessel_name) && (hasValue(data.current_port) || hasValue(data.port_name)) && (hasValue(data.eta) || hasValue(data.ata) || hasValue(data.etb))) return "VESSEL_NAME_PORT_TIME";
  if (hasValue(data.vessel_name) && sourceKey === "port_operation") return "VESSEL_NAME_PORT_TIME";
  if (hasValue(data.vessel_name)) return "VESSEL_NAME_ONLY";
  return "WEAK";
}

function matchConfidence(row = {}, sourceKey = "", fieldName = "") {
  const base = sourcePriorityScore(sourceKey, fieldName);
  const type = inferMatchType(row, sourceKey);
  const bonus = {
    IMO: 6,
    MMSI: 5,
    CALL_SIGN: 4,
    VESSEL_NAME_PORT_TIME: 0,
    VESSEL_NAME_ONLY: -12,
    WEAK: -25
  }[type] || 0;
  return Math.max(0, Math.min(100, Math.round(base + bonus)));
}

function candidateQuality(row = {}, sourceKey = "", fieldName = "", status = {}) {
  const quality = Number(status.utilization_score ?? 0);
  const baseline = sourcePriorityScore(sourceKey, fieldName);
  const verifiedBonus = row.verified === true || row.source_verified === true || sourceKey === "source_csv" ? 5 : 0;
  return Math.max(0, Math.min(100, Math.round(Math.max(baseline, quality) + verifiedBonus)));
}

function lineageForField(row = {}, fieldName = "") {
  const lineage = row.data_lineage && typeof row.data_lineage === "object" ? row.data_lineage : {};
  const displayLineage = row.vessel_display?.data_lineage && typeof row.vessel_display.data_lineage === "object"
    ? row.vessel_display.data_lineage
    : {};
  const value = lineage[fieldName] || displayLineage[fieldName] || null;
  return value && typeof value === "object" ? value : null;
}

function currentQuality(row = {}, fieldName = "") {
  const lineage = lineageForField(row, fieldName);
  if (lineage?.verified === true) return 95;
  if (Number.isFinite(Number(lineage?.confidence))) return Number(lineage.confidence);
  if (row.verified === true || row.manual === true) return 95;
  if (row.identity_confidence && ["imo", "mmsi", "call_sign"].includes(fieldName)) return Number(row.identity_confidence);
  if (row.operator_confidence && fieldName === "operator_display") return Number(row.operator_confidence);
  return hasValue(firstValue(merged(row), FIELD_RULES[fieldName]?.aliases || [])) ? 65 : 0;
}

function isTrustedCurrent(row = {}, fieldName = "") {
  const lineage = lineageForField(row, fieldName);
  return row.verified === true ||
    row.manual === true ||
    lineage?.verified === true ||
    String(lineage?.source || "").includes("source_csv") ||
    currentQuality(row, fieldName) >= 90;
}

function valuesEqual(a, b) {
  if (typeof a === "object" || typeof b === "object") {
    return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  }
  return String(a ?? "").normalize("NFKC").trim() === String(b ?? "").normalize("NFKC").trim();
}

function compactValue(value) {
  if (value && typeof value === "object") {
    if ("has_pilotage" in value || "has_berth_info" in value || "has_berth" in value) return value;
    return JSON.parse(JSON.stringify(value));
  }
  return value;
}

function candidateReason({ sourceKey, fieldName, matchType, action, currentValue, candidateValue }) {
  if (action === "APPLY" && isEmpty(currentValue)) return `${sourceKey} supplied missing ${fieldName}.`;
  if (action === "APPLY" && valuesEqual(currentValue, candidateValue)) return `${sourceKey} confirmed existing ${fieldName}.`;
  if (action === "APPLY") return `${sourceKey} candidate quality is materially stronger for ${fieldName}.`;
  if (action === "REVIEW") return `Review ${fieldName}: ${sourceKey} matched by ${matchType}, but current value is trusted or conflicting.`;
  return `Rejected ${fieldName}: match confidence or candidate quality is too low.`;
}

function sourceTimestamp(row = {}) {
  const data = merged(row);
  return data.updated_at || data.collected_at || data.last_seen_at || data.generated_at || data.ata || data.eta || null;
}

function sourceRowId(row = {}, sourceKey = "") {
  return row.source_row_id || row.raw_row_id || row.port_call_id || row.vessel_id || `${sourceKey}:${vesselKey(row)}`;
}

function targetVesselSummary(row = {}) {
  const data = merged(row);
  return {
    vessel_key: vesselKey(row),
    vessel_name: compactValue(data.vessel_name || data.name || data.normalized_vessel_name || null),
    imo: compactValue(data.imo || null),
    mmsi: compactValue(data.mmsi || null),
    call_sign: compactValue(data.call_sign || null),
    current_port: compactValue(data.current_port || data.port_name || data.port || null),
    operator_display: compactValue(data.operator_display || data.operator || data.company || data.manager || null)
  };
}

function inferConflictType({ fieldName = "", matchType = "", currentValue = null, candidateValue = null, confidence = 0 } = {}) {
  if (fieldName === "imo" && hasValue(currentValue) && hasValue(candidateValue) && !valuesEqual(currentValue, candidateValue)) return "DIFFERENT_IMO";
  if (fieldName === "mmsi" && hasValue(currentValue) && hasValue(candidateValue) && !valuesEqual(currentValue, candidateValue)) return "DIFFERENT_MMSI";
  if (["operator_display", "owner", "manager", "fleet_group"].includes(fieldName) && hasValue(currentValue) && hasValue(candidateValue) && !valuesEqual(currentValue, candidateValue)) return "OPERATOR_CONFLICT";
  if (matchType === "VESSEL_NAME_ONLY") return "MULTIPLE_VESSEL_NAME_MATCHES";
  if (matchType === "VESSEL_NAME_PORT_TIME" && confidence < 70) return "TIME_WINDOW_MISMATCH";
  if (fieldName === "current_port" && hasValue(currentValue) && hasValue(candidateValue) && !valuesEqual(currentValue, candidateValue)) return "PORT_MISMATCH";
  if (["WEAK", "VESSEL_NAME_ONLY"].includes(matchType) || confidence < 70) return "LOW_CONFIDENCE_FUZZY_MATCH";
  if (hasValue(currentValue) && hasValue(candidateValue) && !valuesEqual(currentValue, candidateValue)) return "OPERATOR_CONFLICT";
  return "LOW_CONFIDENCE_FUZZY_MATCH";
}

function recommendedReviewAction(candidate = {}) {
  if (candidate.conflict_type === "DIFFERENT_IMO" || candidate.conflict_type === "DIFFERENT_MMSI") {
    return "Do not apply automatically. Verify against a high-trust identity source.";
  }
  if (candidate.conflict_type === "MULTIPLE_VESSEL_NAME_MATCHES" || candidate.conflict_type === "LOW_CONFIDENCE_FUZZY_MATCH") {
    return "Keep for manual review; require call sign, IMO, MMSI, or port/time evidence before applying.";
  }
  if (candidate.conflict_type === "TIME_WINDOW_MISMATCH" || candidate.conflict_type === "PORT_MISMATCH") {
    return "Check latest port/timing source before applying.";
  }
  if (candidate.conflict_type === "OPERATOR_CONFLICT") {
    return "Review company/operator evidence and preserve verified or manual values.";
  }
  return "Review source evidence before applying.";
}

function buildCandidate(row = {}, sourceKey = "", fieldName = "", status = {}, generatedAt = new Date().toISOString()) {
  const data = merged(row);
  const rule = FIELD_RULES[fieldName];
  const candidateValue = firstValue(data, rule.aliases);
  if (!hasValue(candidateValue)) return null;
  const currentValue = firstValue(row, [fieldName]) ?? firstValue(display(row), [fieldName]) ?? null;
  const matchType = inferMatchType(row, sourceKey);
  const confidence = matchConfidence(row, sourceKey, fieldName);
  const quality = candidateQuality(row, sourceKey, fieldName, status);
  const trusted = isTrustedCurrent(row, fieldName);
  let action = "REJECT";
  if (confidence >= 85 && (isEmpty(currentValue) || valuesEqual(currentValue, candidateValue) || quality >= currentQuality(row, fieldName) + 20)) {
    action = trusted && !valuesEqual(currentValue, candidateValue) ? "REVIEW" : "APPLY";
  } else if (confidence >= 60 && hasValue(candidateValue)) {
    action = "REVIEW";
  }
  const payload = {
    source_key: sourceKey,
    field_name: fieldName,
    target_vessel_key: vesselKey(row),
    match_type: matchType,
    current_value: compactValue(currentValue),
    candidate_value: compactValue(candidateValue)
  };
  const reason = candidateReason({ sourceKey, fieldName, matchType, action, currentValue, candidateValue });
  return {
    candidate_id: `ec_${candidateHash(payload)}`,
    source_key: sourceKey,
    source_name: status.label || status.source_name || sourceKey,
    target_vessel_key: vesselKey(row),
    match_type: matchType,
    match_confidence: confidence,
    field_name: fieldName,
    current_value: compactValue(currentValue),
    candidate_value: compactValue(candidateValue),
    raw_value: compactValue(candidateValue),
    target_vessel: targetVesselSummary(row),
    candidate_quality: quality,
    action,
    reason,
    source_timestamp: sourceTimestamp(row) || generatedAt,
    lineage: {
      raw_source: sourceKey,
      normalized_field: fieldName,
      source_row_id: sourceRowId(row, sourceKey)
    }
  };
}

function toReviewQueueItem(candidate = {}) {
  const confidence = Number(candidate.match_confidence || 0);
  const conflictType = inferConflictType({
    fieldName: candidate.field_name,
    matchType: candidate.match_type,
    currentValue: candidate.current_value,
    candidateValue: candidate.candidate_value,
    confidence
  });
  const item = {
    candidate_id: candidate.candidate_id,
    source_key: candidate.source_key,
    raw_value: compactValue(candidate.raw_value ?? candidate.candidate_value),
    candidate_value: compactValue(candidate.candidate_value),
    target_vessel: candidate.target_vessel || { vessel_key: candidate.target_vessel_key },
    field_name: candidate.field_name,
    current_value: compactValue(candidate.current_value),
    confidence,
    conflict_type: conflictType,
    recommended_action: recommendedReviewAction({ ...candidate, conflict_type: conflictType }),
    reason: candidate.reason,
    source_name: candidate.source_name,
    target_vessel_key: candidate.target_vessel_key,
    match_type: candidate.match_type,
    match_confidence: confidence,
    candidate_quality: candidate.candidate_quality,
    action: candidate.action,
    source_timestamp: candidate.source_timestamp,
    lineage: candidate.lineage
  };
  return item;
}

function candidateFieldsForSource(sourceKey = "") {
  return SOURCE_FIELD_ALLOWLIST[sourceKey] || [];
}

function setField(row = {}, fieldName = "", value) {
  if (fieldName === "operator_display") {
    row.operator_display = value;
    if (!hasValue(row.operator)) row.operator = value;
    return;
  }
  row[fieldName] = value;
}

function addLineage(row = {}, candidate, generatedAt = new Date().toISOString()) {
  if (!row.data_lineage || typeof row.data_lineage !== "object") row.data_lineage = {};
  row.data_lineage[candidate.field_name] = {
    source: candidate.source_key,
    confidence: candidate.match_confidence,
    updated_at: candidate.source_timestamp || generatedAt,
    verified: candidate.source_key === "source_csv" || candidate.candidate_quality >= 95,
    candidate_id: candidate.candidate_id,
    action: candidate.action
  };
}

function applyCandidate(row = {}, candidate, generatedAt = new Date().toISOString()) {
  if (candidate.action !== "APPLY") return false;
  if (!valuesEqual(candidate.current_value, candidate.candidate_value) || isEmpty(candidate.current_value)) {
    setField(row, candidate.field_name, candidate.candidate_value);
  }
  addLineage(row, candidate, generatedAt);
  return true;
}

function generateCandidates(records = [], sourceStatus = new Map(), generatedAt = new Date().toISOString()) {
  const candidates = [];
  const seen = new Set();
  for (const row of records) {
    if (!row || typeof row !== "object") continue;
    const sources = recordSources(row);
    for (const sourceKey of sources) {
      const status = sourceStatus.get(sourceKey) || { source_key: sourceKey };
      for (const fieldName of candidateFieldsForSource(sourceKey)) {
        const candidate = buildCandidate(row, sourceKey, fieldName, status, generatedAt);
        if (!candidate) continue;
        if (seen.has(candidate.candidate_id)) continue;
        seen.add(candidate.candidate_id);
        candidates.push(candidate);
      }
    }
  }
  return candidates;
}

function summarize(items = []) {
  const summary = {};
  for (const item of items) {
    const sourceKey = item.source_key || "unknown";
    const field = item.field_name || "unknown";
    if (!summary[sourceKey]) {
      summary[sourceKey] = { candidates: 0, auto_applied: 0, needs_review: 0, rejected: 0, fields_enriched: {} };
    }
    summary[sourceKey].candidates += 1;
    if (item.action === "APPLY") summary[sourceKey].auto_applied += 1;
    else if (item.action === "REVIEW") summary[sourceKey].needs_review += 1;
    else summary[sourceKey].rejected += 1;
    if (item.action === "APPLY") {
      summary[sourceKey].fields_enriched[field] = (summary[sourceKey].fields_enriched[field] || 0) + 1;
    }
  }
  return summary;
}

function summarizeByField(items = []) {
  const summary = {};
  for (const item of items) {
    const field = item.field_name || "unknown";
    if (!summary[field]) summary[field] = { candidates: 0, auto_applied: 0, needs_review: 0, rejected: 0 };
    summary[field].candidates += 1;
    if (item.action === "APPLY") summary[field].auto_applied += 1;
    else if (item.action === "REVIEW") summary[field].needs_review += 1;
    else summary[field].rejected += 1;
  }
  return summary;
}

function countDisplaySignals(records = []) {
  let pilotage = 0;
  let berth = 0;
  let lineage = 0;
  for (const row of records || []) {
    const d = merged(row);
    if (d?.pilotage_signal?.has_pilotage === true) pilotage += 1;
    if (d?.berth_signal?.has_berth_info === true || d?.berth_signal?.has_berth === true) berth += 1;
    if (d?.data_lineage && typeof d.data_lineage === "object") lineage += 1;
  }
  return { pilotage, berth, lineage };
}

function conflictCandidates(items = []) {
  return items.filter(item =>
    item.action === "REVIEW" &&
    hasValue(item.current_value) &&
    hasValue(item.candidate_value) &&
    !valuesEqual(item.current_value, item.candidate_value)
  );
}

function envelope({ generatedAt, dataMode, report, items, extra = {} }) {
  return {
    schema_version: "1.0",
    generated_at: generatedAt,
    data_mode: dataMode || report?.data_mode || "static_snapshot",
    record_count: items.length,
    item_count: items.length,
    items,
    ...extra
  };
}

export function buildSourceDataEnrichmentPayloads({
  records = [],
  sourceCollectionStatus = {},
  sourceQualityScore = {},
  generatedAt = new Date().toISOString(),
  dataMode = "static_snapshot",
  report = {}
} = {}) {
  const sourceStatus = sourceStatusMap(sourceCollectionStatus, sourceQualityScore);
  const candidates = generateCandidates(records, sourceStatus, generatedAt);
  const byId = new Map();
  for (const row of records) {
    const key = vesselKey(row);
    if (!byId.has(key)) byId.set(key, []);
    byId.get(key).push(row);
  }
  for (const candidate of candidates) {
    const rows = byId.get(candidate.target_vessel_key) || [];
    for (const row of rows) applyCandidate(row, candidate, generatedAt);
  }
  const applied = candidates.filter(candidate => candidate.action === "APPLY");
  const review = candidates.filter(candidate => candidate.action === "REVIEW").map(toReviewQueueItem);
  const rejected = candidates.filter(candidate => candidate.action === "REJECT");
  const fieldsEnriched = {};
  const vesselsEnriched = new Set();
  for (const candidate of applied) {
    fieldsEnriched[candidate.field_name] = (fieldsEnriched[candidate.field_name] || 0) + 1;
    vesselsEnriched.add(candidate.target_vessel_key);
  }
  const conflicts = conflictCandidates(candidates);
  const displaySignals = countDisplaySignals(records);
  const sourceRowsCollected = (sourceCollectionStatus.items || []).reduce((sum, item) => sum + Number(item.rows_collected || 0), 0);
  const sourceRowsNormalized = (sourceCollectionStatus.items || []).reduce((sum, item) => sum + Number(item.rows_normalized || 0), 0);
  const sourceRowsMatched = (sourceQualityScore.items || []).reduce((sum, item) => sum + Number(item.rows_matched_to_vessels || 0), 0);
  const summary = {
    schema_version: "1.0",
    generated_at: generatedAt,
    data_mode: dataMode || report?.data_mode || "static_snapshot",
    record_count: candidates.length,
    item_count: 0,
    total_candidates: candidates.length,
    auto_applied: applied.length,
    needs_review: review.length,
    rejected: rejected.length,
    source_rows_collected: sourceRowsCollected,
    source_rows_normalized: sourceRowsNormalized,
    source_rows_matched_to_vessels: sourceRowsMatched,
    rows_normalized: sourceRowsNormalized,
    rows_matched_to_vessels: sourceRowsMatched,
    enrichment_candidates_created: candidates.length,
    enrichment_patches_created: applied.length,
    enrichment_patches_applied: applied.length,
    vessel_display_records_updated: displaySignals.pilotage + displaySignals.berth,
    ui_visible_records: records.length,
    pilotage_signal_display_count: displaySignals.pilotage,
    berth_signal_display_count: displaySignals.berth,
    data_lineage_display_count: displaySignals.lineage,
    fields_enriched: fieldsEnriched,
    vessels_enriched: vesselsEnriched.size,
    by_source: summarize(candidates),
    by_field: summarizeByField(candidates),
    conflicts_detected: conflicts.length,
    conflict_examples: conflicts.slice(0, 10)
  };
  return {
    candidatesPayload: envelope({ generatedAt, dataMode, report, items: candidates }),
    appliedPayload: envelope({ generatedAt, dataMode, report, items: applied }),
    reviewQueuePayload: envelope({ generatedAt, dataMode, report, items: review }),
    summaryPayload: summary,
    diagnostics: summary
  };
}
