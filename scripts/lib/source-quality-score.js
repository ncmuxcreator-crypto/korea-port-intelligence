import { normalizeSourceCollectionStatusPayload } from "./source-activation.js";

export const SOURCE_QUALITY_KEYS = [
  "source_csv",
  "pilot_sources",
  "berth_sources",
  "vessel_spec",
  "mof_ais_info",
  "mof_ais_dynamic",
  "port_operation"
];

const DEFAULT_FIELDS_BY_SOURCE = {
  source_csv: ["imo", "mmsi", "call_sign", "operator", "owner", "manager", "vessel_type", "gt", "dwt", "flag"],
  pilot_sources: ["vessel_name", "call_sign", "port", "pilot_time", "pilot_direction"],
  berth_sources: ["vessel_name", "berth", "terminal", "etb", "atb"],
  vessel_spec: ["imo", "mmsi", "call_sign", "vessel_type", "gt", "dwt", "flag"],
  mof_ais_info: ["imo", "mmsi", "call_sign", "vessel_name", "vessel_type"],
  mof_ais_dynamic: ["mmsi", "lat", "lon", "speed", "course", "last_seen_at"],
  port_operation: ["vessel_name", "port", "eta", "ata", "etd", "atd", "berth"]
};

const FIELD_COUNT_MAP = [
  ["rows_with_imo", "imo"],
  ["rows_with_mmsi", "mmsi"],
  ["rows_with_call_sign", "call_sign"],
  ["rows_with_gt", "gt"],
  ["rows_with_dwt", "dwt"],
  ["rows_with_flag", "flag"],
  ["rows_with_vessel_type", "vessel_type"],
  ["pilot_rows_with_vessel_name", "vessel_name"],
  ["pilot_rows_with_call_sign", "call_sign"],
  ["pilot_rows_with_port", "port"],
  ["pilot_rows_with_pilot_date", "pilot_date"],
  ["pilot_rows_with_pilot_time", "pilot_time"],
  ["pilot_rows_with_pilot_station", "pilot_station"],
  ["pilot_rows_with_pilot_direction", "pilot_direction"]
];

function clamp(value, min = 0, max = 100) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.max(min, Math.min(max, number));
}

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean).map(value => String(value).trim()).filter(Boolean))];
}

function statusIsFetchSuccess(item = {}) {
  if (["FETCH_FAILED", "PARSE_FAILED", "SOURCE_TOO_LARGE", "NOT_CONFIGURED", "SKIPPED"].includes(String(item.status || ""))) {
    return false;
  }
  if (number(item.rows_collected) > 0) return true;
  return (item.diagnostics || []).some(diagnostic => diagnostic?.success === true || Number(diagnostic?.http_status || 0) >= 200 && Number(diagnostic?.http_status || 0) < 400);
}

function configured(item = {}) {
  if (item.configured === true) return true;
  const missing = Array.isArray(item.missing_env) ? item.missing_env : [];
  const present = Array.isArray(item.present_env) ? item.present_env : [];
  return present.length > 0 && missing.length === 0;
}

function fieldsFromDiagnostics(sourceKey = "", diagnostics = [], rowsNormalized = 0) {
  const fields = [];
  for (const diagnostic of diagnostics || []) {
    for (const [countKey, field] of FIELD_COUNT_MAP) {
      if (number(diagnostic?.[countKey]) > 0) fields.push(field);
    }
    const aliases = diagnostic?.expected_field_aliases_matched || {};
    for (const [field, matched] of Object.entries(aliases)) {
      if (matched === true) fields.push(field);
    }
  }
  if (!fields.length && rowsNormalized > 0) {
    fields.push(...(DEFAULT_FIELDS_BY_SOURCE[sourceKey] || []));
  }
  return unique(fields).slice(0, 20);
}

function sourceRowsMatchedToVessels({ sourceKey, item, matchingDiagnostics = {}, bootstrapKpis = {}, report = {} }) {
  const explicit = number(item.rows_matched_to_vessels ?? item.rows_matched ?? item.actionable_count, NaN);
  if (Number.isFinite(explicit)) return explicit;
  if (sourceKey === "pilot_sources") {
    return number(
      bootstrapKpis.pilotage_detected_count ??
      report.pilotage_detected_count ??
      report.pilotage_enrichment?.matched_vessels ??
      report.pilotage_enrichment?.applied_to_records ??
      matchingDiagnostics.pilot_rows_matched,
      0
    );
  }
  if (sourceKey === "berth_sources") {
    return number(
      bootstrapKpis.berth_info_detected_count ??
      report.berth_info_detected_count ??
      matchingDiagnostics.pnc_rows_matched ??
      matchingDiagnostics.berth_rows_matched,
      0
    );
  }
  if (sourceKey === "port_operation") {
    const explicitMatch = number(report.source_rows_matched ?? matchingDiagnostics.source_rows_matched, 0);
    return explicitMatch > 0 ? explicitMatch : number(item.rows_normalized, 0);
  }
  if (["mof_ais_info", "mof_ais_dynamic", "vessel_spec"].includes(sourceKey)) {
    return number(item.rows_normalized, 0);
  }
  return 0;
}

function freshnessMinutes(generatedAt, referenceTime) {
  const generated = Date.parse(generatedAt || "");
  const reference = Date.parse(referenceTime || generatedAt || "");
  if (!Number.isFinite(generated) || !Number.isFinite(reference)) return null;
  return Math.max(0, Math.round((reference - generated) / 60000));
}

function freshnessScore(minutes) {
  if (minutes === null) return 0;
  if (minutes <= 360) return 5;
  if (minutes <= 1440) return 3;
  if (minutes <= 2880) return 1;
  return 0;
}

function blockerReason({ item, rowsCollected, rowsNormalized, rowsMatched, fieldsContributed, minutes }) {
  if (item.status === "SOURCE_TOO_LARGE") return item.skip_reason || item.exact_fix_instruction || "source_response_too_large";
  if (["FETCH_FAILED", "PARSE_FAILED", "NOT_CONFIGURED", "SKIPPED"].includes(String(item.status || ""))) {
    return item.skip_reason || item.exact_fix_instruction || item.status;
  }
  if (!configured(item)) return `missing_env:${(item.missing_env || []).join(",") || "unknown"}`;
  if (!item.collector_attempted) return item.skip_reason || "collector_not_attempted";
  if (rowsCollected <= 0) return item.skip_reason || "no_rows_collected";
  if (rowsNormalized <= 0) return item.utilization_note || "rows_not_normalized";
  if (rowsMatched <= 0) return "no_vessel_match_or_signal";
  if (!fieldsContributed.length) return "no_useful_fields_detected";
  if (minutes !== null && minutes > 2880) return "source_snapshot_stale";
  return "";
}

function recommendedFix({ item, sourceKey, blocker, rowsNormalized, rowsMatched }) {
  if (!blocker) return "No action required.";
  if (sourceKey === "source_csv" && item.status === "SOURCE_TOO_LARGE") {
    return "SOURCE_CSV_URL still points to the large raw CSV. Point it to the lightweight verified vessel reference CSV.";
  }
  if (sourceKey === "vessel_spec" && number(item.rows_collected) > 0 && rowsNormalized === 0) {
    return "Add/adjust vessel_spec parser aliases using sanitized raw sample keys.";
  }
  if (["pilot_sources", "berth_sources"].includes(sourceKey) && rowsNormalized > 0 && rowsMatched === 0) {
    return "Improve exact call sign/name plus normalized port matching before applying weak matches.";
  }
  if (["mof_ais_info", "mof_ais_dynamic"].includes(sourceKey) && number(item.rows_collected) <= 10) {
    return "Expand enrichment gradually: sales targets first, then detail eligible top 100.";
  }
  return item.exact_fix_instruction || item.fix_hint || blocker;
}

function qualityLabel(score, item = {}) {
  if (["FETCH_FAILED", "PARSE_FAILED", "SOURCE_TOO_LARGE", "NOT_CONFIGURED"].includes(String(item.status || "")) && score < 35) return "FAILED";
  if (score >= 75) return "HIGH";
  if (score >= 50) return "MEDIUM";
  if (score >= 25) return "LOW";
  return "FAILED";
}

function scoreSource({ item, sourceKey, sourceCollectionStatus, matchingDiagnostics, bootstrapKpis, report, referenceTime }) {
  const rowsCollected = number(item.rows_collected);
  const rowsNormalized = number(item.rows_normalized);
  const rowsMatched = sourceRowsMatchedToVessels({ sourceKey, item, matchingDiagnostics, bootstrapKpis, report });
  const fieldsContributed = fieldsFromDiagnostics(sourceKey, item.diagnostics || [], rowsNormalized);
  const totalVessels = number(bootstrapKpis.total_vessels || bootstrapKpis.detail_eligible_vessel_count || report.total_vessels || report.record_count);
  const smokeLevel = ["mof_ais_info", "mof_ais_dynamic"].includes(sourceKey) && rowsCollected <= 10 && totalVessels > 100;
  const minutes = freshnessMinutes(sourceCollectionStatus.generated_at || item.generated_at, referenceTime || sourceCollectionStatus.generated_at);
  const envScore = configured(item) ? 15 : 0;
  const attemptScore = item.collector_attempted ? 10 : 0;
  const fetchScore = statusIsFetchSuccess(item) ? 15 : 0;
  const parseScore = rowsNormalized > 0 ? 15 : 0;
  const normalizedScore = rowsNormalized > 0 ? clamp(5 + Math.min(rowsNormalized, 50) / 50 * 10, 0, 15) : 0;
  const matchedScore = rowsMatched > 0 ? clamp(5 + Math.min(rowsMatched, 50) / 50 * 10, 0, 15) : 0;
  const fieldsScore = clamp(fieldsContributed.length * 2, 0, 10);
  const freshScore = freshnessScore(minutes);
  const utilizationScore = Math.round(clamp(envScore + attemptScore + fetchScore + parseScore + normalizedScore + matchedScore + fieldsScore + freshScore));
  const blocker = blockerReason({ item, rowsCollected, rowsNormalized, rowsMatched, fieldsContributed, minutes });
  const quality = qualityLabel(utilizationScore, item);
  return {
    source_key: sourceKey,
    configured: configured(item),
    attempted: Boolean(item.collector_attempted),
    rows_collected: rowsCollected,
    rows_normalized: rowsNormalized,
    rows_matched_to_vessels: rowsMatched,
    fields_contributed: fieldsContributed,
    freshness_minutes: minutes,
    utilization_score: utilizationScore,
    quality_label: quality,
    coverage_label: smokeLevel ? "SMOKE_LEVEL" : quality,
    coverage_note: smokeLevel
      ? "Fetch and parse work, but current coverage is smoke-level compared with the vessel universe."
      : "",
    blocker_reason: blocker,
    recommended_fix: smokeLevel
      ? "Expand enrichment gradually: sales targets first, then contact_now vessels, then detail eligible top 100."
      : recommendedFix({ item, sourceKey, blocker, rowsNormalized, rowsMatched }),
    score_breakdown: {
      env_present: envScore,
      fetch_attempted: attemptScore,
      fetch_success: fetchScore,
      parse_success: parseScore,
      normalized_rows: Math.round(normalizedScore),
      matched_vessels: Math.round(matchedScore),
      useful_fields: fieldsScore,
      freshness: freshScore
    }
  };
}

export function buildSourceQualityScorePayload({
  sourceCollectionStatus = {},
  matchingDiagnostics = {},
  bootstrapKpis = {},
  report = {},
  generatedAt = new Date().toISOString(),
  dataMode = "static_snapshot",
  referenceTime = generatedAt
} = {}) {
  const normalizedStatus = normalizeSourceCollectionStatusPayload(sourceCollectionStatus?.items ? sourceCollectionStatus : { ...sourceCollectionStatus, items: [] });
  const byKey = new Map((normalizedStatus.items || []).map(item => [item.source_key, item]));
  const items = SOURCE_QUALITY_KEYS.map(sourceKey => {
    const item = byKey.get(sourceKey) || {
      source_key: sourceKey,
      status: "NOT_CONFIGURED",
      missing_env: [],
      present_env: [],
      rows_collected: 0,
      rows_normalized: 0,
      collector_attempted: false,
      diagnostics: []
    };
    return scoreSource({
      item,
      sourceKey,
      sourceCollectionStatus: normalizedStatus,
      matchingDiagnostics,
      bootstrapKpis,
      report,
      referenceTime
    });
  });
  const labelCounts = items.reduce((acc, item) => {
    acc[item.quality_label] = (acc[item.quality_label] || 0) + 1;
    return acc;
  }, {});
  const averageScore = items.length
    ? Math.round(items.reduce((sum, item) => sum + item.utilization_score, 0) / items.length)
    : 0;
  return {
    schema_version: "1.0",
    generated_at: generatedAt,
    data_mode: dataMode,
    source_run_id: normalizedStatus.run_id || report.run_id || null,
    record_count: items.length,
    item_count: items.length,
    average_utilization_score: averageScore,
    quality_counts: labelCounts,
    items
  };
}
