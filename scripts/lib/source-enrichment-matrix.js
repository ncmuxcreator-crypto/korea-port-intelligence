const MATRIX_SOURCE_KEYS = [
  "port_operation",
  "source_csv",
  "pilot_sources",
  "berth_sources",
  "PNC_SOURCE_URLS",
  "mof_ais_info",
  "mof_ais_dynamic",
  "mof_ais_stat",
  "vessel_spec",
  "VTS",
  "port_facility"
];

const CAPABILITIES = {
  port_operation: {
    source_name: "Port Operation",
    available_fields: ["vessel_name", "call_sign", "current_port", "eta", "etb", "ata", "atb", "etd", "atd", "berth", "vessel_type", "gt"],
    enrichable_fields: ["vessel_name", "call_sign", "current_port", "current_port_korean", "berth", "eta", "etb", "ata", "atb", "etd", "atd", "stay_hours", "vessel_type", "gt"],
    match_keys: ["call_sign", "vessel_name", "normalized_vessel_name", "port", "eta", "ata", "port_call_id"],
    trust_level: "HIGH",
    update_policy: "TIER_0_CORE_EVERY_UPDATE",
    conflict_policy: "Apply missing operational timing and port fields. Review conflicts with verified identity or manually confirmed values."
  },
  source_csv: {
    source_name: "Verified Vessel Reference CSV",
    available_fields: ["vessel_name", "normalized_vessel_name", "imo", "mmsi", "call_sign", "operator", "owner", "manager", "vessel_type", "gt", "dwt", "flag", "verified"],
    enrichable_fields: ["imo", "mmsi", "call_sign", "operator_display", "owner", "manager", "vessel_type", "gt", "dwt", "flag", "fleet_group"],
    match_keys: ["IMO", "MMSI", "call_sign", "vessel_name", "normalized_vessel_name", "normalized_vessel_name+call_sign", "normalized_vessel_name+gt+vessel_type"],
    trust_level: "HIGH_IF_VERIFIED",
    update_policy: "TIER_2_AUXILIARY_CACHE_USE_LAST_SUCCESS_ON_FAILURE",
    conflict_policy: "Verified rows can fill missing values. Do not overwrite manual or higher-confidence identifiers; send conflicts to review."
  },
  pilot_sources: {
    source_name: "Pilotage Sources",
    available_fields: ["vessel_name", "call_sign", "port", "pilot_time", "pilot_station", "pilot_direction"],
    enrichable_fields: ["pilotage_signal", "pilotage_time", "pilotage_time_text", "pilot_station", "pilotage_direction", "arrival_departure_timing_signal"],
    match_keys: ["call_sign", "vessel_name", "normalized_vessel_name", "port", "pilot_time", "time_window"],
    trust_level: "HIGH_FOR_TIMING",
    update_policy: "TIER_1_HIGH_VALUE_AUXILIARY_EACH_PRIORITY_RUN",
    conflict_policy: "Auto-apply exact call sign or high-confidence name+port+time matches. Send weak name-only matches to review."
  },
  berth_sources: {
    source_name: "Berth Sources",
    available_fields: ["vessel_name", "call_sign", "port", "berth", "terminal", "etb", "atb", "operation_status"],
    enrichable_fields: ["berth_signal", "berth", "terminal", "etb", "atb", "operation_status", "berth_timing_signal"],
    match_keys: ["call_sign", "vessel_name", "normalized_vessel_name", "port", "berth", "time_window"],
    trust_level: "MEDIUM_HIGH",
    update_policy: "TIER_1_HIGH_VALUE_AUXILIARY_EACH_PRIORITY_RUN",
    conflict_policy: "Apply missing berth/terminal fields on high-confidence match. Review conflicts with newer port operation values."
  },
  PNC_SOURCE_URLS: {
    source_name: "PNC Berth / Terminal Sources",
    available_fields: ["vessel_name", "call_sign", "port", "berth", "terminal", "operator", "route", "operation_status"],
    enrichable_fields: ["berth", "terminal", "operator_display", "route", "operation_status", "berth_signal"],
    match_keys: ["call_sign", "vessel_name", "normalized_vessel_name", "port", "time_window", "berth"],
    trust_level: "MEDIUM_HIGH",
    update_policy: "TIER_1_HIGH_VALUE_AUXILIARY_CACHE",
    conflict_policy: "Prefer for berth and terminal. Use operator values as fallback only when current operator_display is missing."
  },
  mof_ais_info: {
    source_name: "MOF AIS Info",
    available_fields: ["imo", "mmsi", "call_sign", "vessel_name", "vessel_type", "flag", "gt", "dwt"],
    enrichable_fields: ["imo", "mmsi", "call_sign", "vessel_name", "vessel_type", "flag", "gt", "dwt"],
    match_keys: ["MMSI", "IMO", "call_sign", "vessel_name"],
    trust_level: "HIGH_FOR_IDENTITY",
    update_policy: "TIER_1_HIGH_VALUE_TARGETED_ENRICHMENT",
    conflict_policy: "Fill missing identifiers on exact key match. Do not overwrite existing non-empty identifiers unless verified confidence is higher."
  },
  mof_ais_dynamic: {
    source_name: "MOF AIS Dynamic",
    available_fields: ["mmsi", "lat", "lon", "speed", "course", "last_seen_at", "destination"],
    enrichable_fields: ["last_seen_at", "lat", "lon", "speed", "course", "destination", "anchorage_signal", "slow_steaming_signal"],
    match_keys: ["MMSI", "call_sign", "vessel_name+time_window"],
    trust_level: "MEDIUM_HIGH_FOR_POSITION",
    update_policy: "TIER_2_TARGETED_SALES_TARGETS_FIRST",
    conflict_policy: "Use as fresh movement signal. Do not override port operation berth/timing without stronger timestamp evidence."
  },
  mof_ais_stat: {
    source_name: "MOF AIS Statistics",
    available_fields: ["mmsi", "port", "visit_count", "dwell_time", "route_history", "movement_statistics"],
    enrichable_fields: ["repeat_caller_signal", "korea_presence_score", "dwell_history", "route_signal", "commercial_frequency_signal"],
    match_keys: ["MMSI", "IMO", "port", "vessel_name"],
    trust_level: "MEDIUM",
    update_policy: "TIER_2_MEDIUM_FREQUENCY_CACHE",
    conflict_policy: "Use for aggregate behavior and repeat-caller signals. Do not overwrite vessel identity fields from statistics alone."
  },
  vessel_spec: {
    source_name: "Vessel Specification",
    available_fields: ["imo", "mmsi", "call_sign", "vessel_name", "vessel_type", "gt", "dwt", "flag", "loa", "beam"],
    enrichable_fields: ["imo", "mmsi", "call_sign", "vessel_type", "gt", "dwt", "flag", "loa", "beam", "tonnage_summary"],
    match_keys: ["IMO", "MMSI", "call_sign", "normalized_vessel_name+gt+vessel_type"],
    trust_level: "HIGH_FOR_SPEC",
    update_policy: "TIER_2_AUXILIARY_TARGETED_CACHE",
    conflict_policy: "Prefer for vessel specification when parser output is normalized. Send inconsistent GT/DWT/identity values to review."
  },
  VTS: {
    source_name: "VTS",
    available_fields: ["mmsi", "call_sign", "vessel_name", "lat", "lon", "speed", "course", "area", "observed_at"],
    enrichable_fields: ["last_seen_at", "anchorage", "anchorage_signal", "waiting_hours", "slow_steaming_hours", "congestion_signal"],
    match_keys: ["MMSI", "call_sign", "vessel_name", "lat_lon_time_window", "port_area"],
    trust_level: "MEDIUM",
    update_policy: "TIER_2_OPTIONAL_CACHE_WHEN_CONFIGURED",
    conflict_policy: "Use for movement and waiting signals only. Review identity enrichment unless MMSI/call_sign is exact."
  },
  port_facility: {
    source_name: "Port Facility",
    available_fields: ["port_code", "port_name", "berth", "terminal", "facility_name", "cargo_type", "capacity"],
    enrichable_fields: ["port_facility_context", "berth_context", "terminal_context", "cargo_context", "port_capacity_signal"],
    match_keys: ["port_code", "port_name", "berth", "terminal", "facility_name"],
    trust_level: "MEDIUM",
    update_policy: "TIER_3_LOW_FREQUENCY_REFERENCE_CACHE",
    conflict_policy: "Use as reference context for port/berth labels. Do not overwrite vessel-level operational fields."
  }
};

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean).map(value => String(value).trim()).filter(Boolean))];
}

function sourceStatusByKey(sourceCollectionStatus = {}) {
  return new Map(asArray(sourceCollectionStatus.items).map(item => [item.source_key, item]));
}

function sourceQualityByKey(sourceQualityScore = {}) {
  return new Map(asArray(sourceQualityScore.items).map(item => [item.source_key, item]));
}

function statusForSource(sourceKey, statusMap, qualityMap) {
  const statusKey = sourceKey === "PNC_SOURCE_URLS" ? "berth_sources" : sourceKey;
  const item = statusMap.get(statusKey) || {};
  const quality = qualityMap.get(statusKey) || {};
  return { statusKey, item, quality };
}

function fallbackBlocker(sourceKey, item = {}, quality = {}) {
  if (quality.blocker_reason) return quality.blocker_reason;
  if (item.skip_reason) return item.skip_reason;
  if (item.status && !["ACTIVE", "OK", "SUCCESS"].includes(item.status)) return item.status;
  if (!item.source_key && !quality.source_key) return "not_configured_or_not_collected";
  return "";
}

function utilizationForSource(sourceKey, item = {}, quality = {}) {
  const rowsCollected = number(quality.rows_collected ?? item.rows_collected);
  const rowsNormalized = number(quality.rows_normalized ?? item.rows_normalized);
  const rowsMatched = number(quality.rows_matched_to_vessels ?? item.rows_matched_to_vessels ?? item.rows_matched);
  return {
    status: item.status || quality.quality_label || "NOT_CONFIGURED",
    configured: Boolean(quality.configured ?? item.configured ?? ((item.present_env || []).length > 0)),
    attempted: Boolean(quality.attempted ?? item.collector_attempted),
    collector_enabled: Boolean(item.collector_enabled ?? item.enabled ?? quality.configured),
    collector_attempted: Boolean(item.collector_attempted ?? quality.attempted),
    rows_collected: rowsCollected,
    rows_normalized: rowsNormalized,
    rows_matched_to_vessels: rowsMatched,
    fields_contributed: unique([...(quality.fields_contributed || []), ...(item.fields_available || [])]),
    freshness_minutes: quality.freshness_minutes ?? item.freshness_minutes ?? null,
    utilization_score: number(quality.utilization_score, 0),
    quality_label: quality.quality_label || "LOW",
    source_layer: item.source_layer || (sourceKey === "port_operation" ? "core" : "auxiliary"),
    core_blocking: Boolean(item.core_blocking),
    missing_env: asArray(item.missing_env),
    present_env_count: asArray(item.present_env).length,
    recommended_fix: quality.recommended_fix || item.exact_fix_instruction || item.fix_hint || ""
  };
}

export function buildSourceEnrichmentMatrixPayload({
  sourceCollectionStatus = {},
  sourceQualityScore = {},
  generatedAt = new Date().toISOString(),
  dataMode = "static_snapshot",
  runId = null
} = {}) {
  const statusMap = sourceStatusByKey(sourceCollectionStatus);
  const qualityMap = sourceQualityByKey(sourceQualityScore);
  const items = MATRIX_SOURCE_KEYS.map(sourceKey => {
    const capability = CAPABILITIES[sourceKey];
    const { item, quality } = statusForSource(sourceKey, statusMap, qualityMap);
    const utilization = utilizationForSource(sourceKey, item, quality);
    const availableFields = unique([
      ...capability.available_fields,
      ...utilization.fields_contributed
    ]);
    return {
      source_key: sourceKey,
      source_name: capability.source_name,
      available_fields: availableFields,
      enrichable_fields: capability.enrichable_fields,
      match_keys: capability.match_keys,
      trust_level: capability.trust_level,
      update_policy: capability.update_policy,
      conflict_policy: capability.conflict_policy,
      current_utilization: utilization,
      blocker_reason: fallbackBlocker(sourceKey, item, quality)
    };
  });
  const activeSources = items.filter(item => item.current_utilization.rows_normalized > 0 || item.current_utilization.rows_matched_to_vessels > 0).length;
  const blockedSources = items.filter(item => item.blocker_reason).length;
  const enrichableFields = unique(items.flatMap(item => item.enrichable_fields));
  return {
    schema_version: "1.0",
    generated_at: generatedAt,
    data_mode: dataMode,
    run_id: runId || sourceCollectionStatus.run_id || sourceQualityScore.run_id || null,
    record_count: items.length,
    item_count: items.length,
    summary: {
      active_sources: activeSources,
      blocked_sources: blockedSources,
      high_trust_sources: items.filter(item => String(item.trust_level).includes("HIGH")).length,
      sources_with_match_keys: items.filter(item => item.match_keys.length > 0).length,
      total_enrichable_fields: enrichableFields.length,
      source_csv_is_auxiliary: true,
      weak_name_only_matching_allowed_for_auto_apply: false
    },
    items
  };
}

export { MATRIX_SOURCE_KEYS };
