import fs from "node:fs";
import path from "node:path";

export const AUXILIARY_SOURCE_CACHE_PATH = "data/cache/auxiliary-source-cache-status.json";
export const AUXILIARY_SOURCE_CACHE_STATUS_PATH = "dashboard/api/aux/cache-status.json";

export const AUXILIARY_CACHE_SOURCE_KEYS = [
  "source_csv",
  "pilot_sources",
  "berth_sources",
  "vessel_spec",
  "mof_ais_info",
  "mof_ais_dynamic"
];

const SUMMARY_PATH_BY_SOURCE = {
  source_csv: "dashboard/api/aux/source-csv-summary.json",
  pilot_sources: "dashboard/api/aux/pilotage-summary.json",
  berth_sources: "dashboard/api/aux/berth-summary.json",
  vessel_spec: "dashboard/api/aux/vessel-spec-summary.json",
  mof_ais_info: "dashboard/api/aux/ais-info-summary.json",
  mof_ais_dynamic: "dashboard/api/aux/ais-dynamic-summary.json"
};

const FAILURE_STATUSES = new Set([
  "FETCH_FAILED",
  "PARSE_FAILED",
  "SOURCE_TOO_LARGE",
  "NOT_CONFIGURED",
  "SKIPPED",
  "NOT_ATTEMPTED"
]);
const CACHE_FORMAT_VERSION = "aux-source-cache-v1.1";

function readJsonSafe(filePath, fallback = null) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJsonSafe(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));
}

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function hoursBetween(later, earlier) {
  const end = Date.parse(later || "");
  const start = Date.parse(earlier || "");
  if (!Number.isFinite(end) || !Number.isFinite(start)) return null;
  return Math.max(0, Math.round(((end - start) / 36_000)) / 100);
}

function sourceItem(sourceCollectionStatus = {}, sourceKey = "") {
  return (sourceCollectionStatus.items || []).find(item => item.source_key === sourceKey) || {};
}

function currentStatus(item = {}, summary = {}) {
  return summary.status || item.status || "NOT_CONFIGURED";
}

function usefulRecordCount(sourceKey, item = {}, summary = {}) {
  if (sourceKey === "source_csv") {
    return number(summary.usable_reference_rows || summary.rows_with_imo || summary.rows_with_mmsi || summary.rows_with_operator, 0);
  }
  if (sourceKey === "pilot_sources") {
    return number(summary.pilotage_signal_count || summary.matched_vessels || summary.normalized_pilot_rows || summary.rows_normalized || item.rows_normalized, 0);
  }
  if (sourceKey === "berth_sources") {
    return number(summary.berth_signal_count || summary.matched_vessels || summary.normalized_rows || summary.rows_normalized || item.rows_normalized, 0);
  }
  if (sourceKey === "vessel_spec") {
    return number(summary.rows_normalized || item.rows_normalized, 0);
  }
  return number(summary.rows_normalized || item.rows_normalized || summary.record_count, 0);
}

function hasUsefulCurrentCache(sourceKey, item = {}, summary = {}) {
  const status = currentStatus(item, summary);
  if (FAILURE_STATUSES.has(status)) return false;
  return usefulRecordCount(sourceKey, item, summary) > 0;
}

function blockerReason(item = {}, summary = {}) {
  return summary.blocker_reason
    || summary.utilization_note
    || summary.skip_reasons?.[0]
    || item.skip_reason
    || item.error_message
    || item.exact_fix_instruction
    || "";
}

function recommendedFix(item = {}, summary = {}) {
  return summary.recommendation
    || summary.fix_hint
    || item.exact_fix_instruction
    || item.fix_hint
    || "";
}

function previousByKey(previousPayload = {}) {
  return new Map((previousPayload.items || [])
    .filter(item => item.cache_format_version === CACHE_FORMAT_VERSION)
    .map(item => [item.source_key, item]));
}

export function readAuxiliarySourceCacheStatus(filePath = AUXILIARY_SOURCE_CACHE_PATH) {
  return readJsonSafe(filePath, {
    schema_version: "1.0",
    generated_at: null,
    record_count: 0,
    item_count: 0,
    items: []
  });
}

export function buildAuxiliarySourceCacheStatusPayload({
  sourceCollectionStatus = {},
  summaries = {},
  previousCache = null,
  generatedAt = new Date().toISOString(),
  dataMode = "static_snapshot",
  report = {}
} = {}) {
  const previous = previousByKey(previousCache || readAuxiliarySourceCacheStatus());
  const items = AUXILIARY_CACHE_SOURCE_KEYS.map(sourceKey => {
    const item = sourceItem(sourceCollectionStatus, sourceKey);
    const summary = summaries[sourceKey] || readJsonSafe(SUMMARY_PATH_BY_SOURCE[sourceKey], {}) || {};
    const status = currentStatus(item, summary);
    const currentUseful = hasUsefulCurrentCache(sourceKey, item, summary);
    const previousItem = previous.get(sourceKey) || {};
    const currentCount = usefulRecordCount(sourceKey, item, summary);
    const previousSuccessAt = previousItem.last_success_at || summary.last_success_at || null;
    const previousSuccessCount = number(previousItem.last_success_record_count || summary.last_success_record_count || summary.usable_reference_rows, 0);
    const lastSuccessAt = currentUseful ? generatedAt : previousSuccessAt;
    const lastSuccessRecordCount = currentUseful ? currentCount : previousSuccessCount;
    const cacheAgeHours = lastSuccessAt ? hoursBetween(generatedAt, lastSuccessAt) : null;
    const usingPreviousCache = !currentUseful && lastSuccessRecordCount > 0;
    const stale = usingPreviousCache && cacheAgeHours !== null && cacheAgeHours > 48;
    const blocker = currentUseful ? "" : blockerReason(item, summary);
    return {
      source_key: sourceKey,
      cache_format_version: CACHE_FORMAT_VERSION,
      current_attempt_status: status,
      configured: Boolean(summary.configured ?? item.configured ?? (item.present_env || []).length),
      attempted: Boolean(summary.collector_attempted ?? item.collector_attempted ?? number(item.rows_collected) > 0),
      rows_collected: number(summary.rows_collected ?? item.rows_collected, 0),
      rows_normalized: number(summary.rows_normalized ?? item.rows_normalized, 0),
      last_success_at: lastSuccessAt,
      last_success_record_count: lastSuccessRecordCount,
      cache_age_hours: cacheAgeHours,
      using_previous_cache: usingPreviousCache,
      cache_stale_warning: stale,
      cache_status: currentUseful
        ? "CURRENT"
        : usingPreviousCache
          ? stale ? "STALE_PREVIOUS" : "PREVIOUS"
          : status === "NOT_CONFIGURED"
            ? "NOT_CONFIGURED"
            : "EMPTY",
      source_layer: "auxiliary",
      core_blocking: false,
      summary_endpoint: SUMMARY_PATH_BY_SOURCE[sourceKey],
      blocker_reason: blocker,
      recommended_fix: currentUseful ? "No action required." : recommendedFix(item, summary)
    };
  });
  const usingPreviousCount = items.filter(item => item.using_previous_cache).length;
  const staleCount = items.filter(item => item.cache_stale_warning).length;
  const currentCount = items.filter(item => item.cache_status === "CURRENT").length;
  return {
    schema_version: "1.0",
    cache_format_version: CACHE_FORMAT_VERSION,
    generated_at: generatedAt,
    data_mode: dataMode,
    source_run_id: sourceCollectionStatus.run_id || report.run_id || null,
    cache_policy: {
      preserve_previous_successful_cache: true,
      core_blocking: false,
      stale_warning_hours: 48,
      note: "Auxiliary source failures do not block the core dashboard; previous useful cache metadata is reused with an explicit warning."
    },
    record_count: items.length,
    item_count: items.length,
    current_cache_count: currentCount,
    using_previous_cache_count: usingPreviousCount,
    stale_cache_warning_count: staleCount,
    items
  };
}

export function writeAuxiliarySourceCacheStatus(payload, filePath = AUXILIARY_SOURCE_CACHE_PATH) {
  writeJsonSafe(filePath, payload);
  return payload;
}
