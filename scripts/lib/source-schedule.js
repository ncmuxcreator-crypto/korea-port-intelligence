export const SOURCE_SCHEDULE_PATH = "dashboard/api/aux/source-schedule.json";

export const SOURCE_SCHEDULE_TIERS = [
  {
    source_key: "port_operation",
    source_label: "Port Operation",
    tier: "TIER_0_CORE",
    tier_label: "Core",
    source_layer: "core",
    update_frequency: "every_update",
    frequency_hours: 0
  },
  {
    source_key: "supabase_active_dataset",
    source_label: "Supabase active dataset",
    tier: "TIER_0_CORE",
    tier_label: "Core",
    source_layer: "core",
    update_frequency: "every_update",
    frequency_hours: 0
  },
  {
    source_key: "pilot_sources",
    source_label: "Pilot schedule sources",
    tier: "TIER_1_HIGH_VALUE",
    tier_label: "High value",
    source_layer: "auxiliary",
    update_frequency: "every_6h",
    frequency_hours: 6
  },
  {
    source_key: "berth_sources",
    source_label: "Berth / PNC sources",
    tier: "TIER_1_HIGH_VALUE",
    tier_label: "High value",
    source_layer: "auxiliary",
    update_frequency: "every_6h",
    frequency_hours: 6
  },
  {
    source_key: "mof_ais_info",
    source_label: "MOF AIS info",
    tier: "TIER_1_HIGH_VALUE",
    tier_label: "High value",
    source_layer: "auxiliary",
    update_frequency: "every_6h",
    frequency_hours: 6
  },
  {
    source_key: "ulsan_vessel_operation",
    source_label: "Ulsan vessel operation",
    tier: "TIER_1_HIGH_VALUE",
    tier_label: "High value",
    source_layer: "auxiliary",
    update_frequency: "every_6h",
    frequency_hours: 6
  },
  {
    source_key: "port_facility",
    source_label: "Port facility child enrichment",
    tier: "TIER_1_HIGH_VALUE",
    tier_label: "High value",
    source_layer: "auxiliary",
    update_frequency: "every_6h",
    frequency_hours: 6
  },
  {
    source_key: "mof_ais_dynamic",
    source_label: "MOF AIS dynamic",
    tier: "TIER_2_MEDIUM",
    tier_label: "Medium",
    source_layer: "auxiliary",
    update_frequency: "every_24h",
    frequency_hours: 24
  },
  {
    source_key: "vessel_spec",
    source_label: "Vessel specification",
    tier: "TIER_2_MEDIUM",
    tier_label: "Medium",
    source_layer: "auxiliary",
    update_frequency: "every_24h",
    frequency_hours: 24
  },
  {
    source_key: "source_csv",
    source_label: "Source CSV cache",
    tier: "TIER_2_MEDIUM",
    tier_label: "Medium",
    source_layer: "auxiliary",
    update_frequency: "every_7d",
    frequency_hours: 168
  },
  {
    source_key: "full_diagnostics",
    source_label: "Full diagnostics",
    tier: "TIER_3_LOW_FREQUENCY",
    tier_label: "Low frequency",
    source_layer: "diagnostic",
    update_frequency: "every_24h",
    frequency_hours: 24
  },
  {
    source_key: "storage_audits",
    source_label: "Storage audits",
    tier: "TIER_3_LOW_FREQUENCY",
    tier_label: "Low frequency",
    source_layer: "diagnostic",
    update_frequency: "every_7d",
    frequency_hours: 168
  }
];

const SUCCESS_STATUSES = new Set(["ACTIVE", "OK", "CURRENT", "PROMOTED", "COMPLETED"]);
const NON_RUNNABLE_STATUSES = new Set(["NOT_CONFIGURED"]);

export function sourceScheduleGroupKey(sourceKey = "") {
  const key = String(sourceKey || "");
  if (key.startsWith("pilot_source_")) return "pilot_sources";
  if (key.startsWith("pnc_source_")) return "berth_sources";
  if (key === "source_csv") return "source_csv";
  if (key === "vessel_spec") return "vessel_spec";
  if (key === "ulsan_vessel_operation") return "ulsan_vessel_operation";
  if (key === "port_facility" || key === "port_facility_enrichment") return "port_facility";
  if (key === "mof_ais_info") return "mof_ais_info";
  if (key === "mof_ais_dynamic") return "mof_ais_dynamic";
  if (key.startsWith("port_operation_")) return "port_operation";
  return key;
}

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseTime(value) {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : null;
}

function hoursSince(referenceTime, previousTime) {
  const reference = parseTime(referenceTime);
  const previous = parseTime(previousTime);
  if (reference === null || previous === null) return null;
  return Math.max(0, Math.round(((reference - previous) / 36_000)) / 100);
}

function addHours(isoTime, hours) {
  const parsed = parseTime(isoTime);
  if (parsed === null || !Number.isFinite(Number(hours))) return null;
  return new Date(parsed + Number(hours) * 3_600_000).toISOString();
}

function bySourceKey(items = []) {
  return new Map((Array.isArray(items) ? items : [])
    .filter(item => item?.source_key)
    .map(item => [String(item.source_key), item]));
}

function statusIsSuccess(status = "", rows = 0) {
  const normalized = String(status || "").toUpperCase();
  return SUCCESS_STATUSES.has(normalized) || number(rows) > 0;
}

function sourceStatusItem(sourceCollectionStatus = {}, sourceKey = "") {
  const statusItems = Array.isArray(sourceCollectionStatus.items) ? sourceCollectionStatus.items : [];
  if (sourceKey === "port_operation") {
    const portItems = statusItems.filter(item => String(item.source_key || "").startsWith("port_operation"));
    if (portItems.length) {
      const rowsCollected = portItems.reduce((sum, item) => sum + number(item.rows_collected), 0);
      const rowsNormalized = portItems.reduce((sum, item) => sum + number(item.rows_normalized), 0);
      const attempted = portItems.some(item => item.collector_attempted);
      return {
        source_key: "port_operation",
        status: rowsCollected > 0 || rowsNormalized > 0 ? "ACTIVE" : attempted ? "NO_ROWS" : "NOT_ATTEMPTED",
        configured: true,
        collector_attempted: attempted,
        rows_collected: rowsCollected,
        rows_normalized: rowsNormalized,
        skip_reason: portItems.find(item => item.skip_reason)?.skip_reason || ""
      };
    }
  }
  return statusItems.find(item => item.source_key === sourceKey) || {};
}

function qualityItem(sourceQualityScore = {}, sourceKey = "") {
  return (Array.isArray(sourceQualityScore.items) ? sourceQualityScore.items : [])
    .find(item => item.source_key === sourceKey) || {};
}

function cacheItem(auxiliaryCacheStatus = {}, sourceKey = "") {
  return (Array.isArray(auxiliaryCacheStatus.items) ? auxiliaryCacheStatus.items : [])
    .find(item => item.source_key === sourceKey) || {};
}

function previousScheduleItem(previousSchedule = {}, sourceKey = "") {
  return (Array.isArray(previousSchedule.items) ? previousSchedule.items : [])
    .find(item => item.source_key === sourceKey) || {};
}

function diagnosticGeneratedAt(diagnostics = {}, sourceKey = "") {
  if (sourceKey === "storage_audits") return diagnostics.storageEfficiencyReport?.generated_at || null;
  if (sourceKey === "full_diagnostics") {
    return diagnostics.sourceCollectionStatus?.generated_at
      || diagnostics.sourceHealthRuntime?.generated_at
      || diagnostics.status?.generated_at
      || null;
  }
  return null;
}

function buildScheduleItem({
  spec,
  sourceCollectionStatus = {},
  sourceQualityScore = {},
  auxiliaryCacheStatus = {},
  previousSchedule = {},
  diagnostics = {},
  generatedAt
}) {
  const sourceKey = spec.source_key;
  const sourceStatus = sourceStatusItem(sourceCollectionStatus, sourceKey);
  const quality = qualityItem(sourceQualityScore, sourceKey);
  const cache = cacheItem(auxiliaryCacheStatus, sourceKey);
  const previous = previousScheduleItem(previousSchedule, sourceKey);
  const diagnosticTime = diagnosticGeneratedAt(diagnostics, sourceKey);
  const configured = sourceKey === "supabase_active_dataset"
    ? Boolean(diagnostics.status?.active_run_id || diagnostics.bootstrap?.run_id)
    : sourceKey === "full_diagnostics" || sourceKey === "storage_audits"
      ? true
      : Boolean(sourceStatus.configured ?? quality.configured ?? cache.configured ?? spec.source_layer === "core");
  const attempted = sourceKey === "supabase_active_dataset"
    ? Boolean(diagnostics.status?.generated_at || diagnostics.bootstrap?.generated_at)
    : sourceKey === "full_diagnostics" || sourceKey === "storage_audits"
      ? Boolean(diagnosticTime)
      : Boolean(sourceStatus.collector_attempted ?? quality.attempted ?? cache.attempted);
  const rowsCollected = number(sourceStatus.rows_collected ?? quality.rows_collected ?? cache.rows_collected);
  const rowsNormalized = number(sourceStatus.rows_normalized ?? quality.rows_normalized ?? cache.rows_normalized);
  const status = sourceKey === "supabase_active_dataset"
    ? (configured ? "ACTIVE" : "NOT_CONFIGURED")
    : sourceKey === "full_diagnostics" || sourceKey === "storage_audits"
      ? (diagnosticTime ? "ACTIVE" : "NOT_ATTEMPTED")
      : String(sourceStatus.status || cache.current_attempt_status || quality.quality_label || "UNKNOWN").toUpperCase();
  const currentAttemptAt = attempted
    ? (sourceCollectionStatus.generated_at || diagnosticTime || generatedAt)
    : null;
  const lastAttemptAt = currentAttemptAt || previous.last_attempt_at || null;
  const currentSuccess = statusIsSuccess(status, rowsNormalized || rowsCollected || cache.last_success_record_count);
  const lastSuccessAt = sourceKey === "supabase_active_dataset"
    ? (diagnostics.status?.last_success_at || diagnostics.status?.generated_at || diagnostics.bootstrap?.generated_at || previous.last_success_at || null)
    : sourceKey === "full_diagnostics" || sourceKey === "storage_audits"
      ? (diagnosticTime || previous.last_success_at || null)
      : currentSuccess
        ? (cache.last_success_at || sourceCollectionStatus.generated_at || generatedAt)
        : (cache.last_success_at || previous.last_success_at || null);
  const hoursSinceAttempt = hoursSince(generatedAt, lastAttemptAt);
  const hoursSinceSuccess = hoursSince(generatedAt, lastSuccessAt);
  const next_attempt_at = spec.frequency_hours > 0 && lastAttemptAt
    ? addHours(lastAttemptAt, spec.frequency_hours)
    : null;

  let shouldRunNow = true;
  let skipReason = "";
  if (spec.tier === "TIER_0_CORE") {
    shouldRunNow = true;
    skipReason = "";
  } else if (!configured || NON_RUNNABLE_STATUSES.has(status)) {
    shouldRunNow = false;
    skipReason = "not_configured";
  } else if (spec.frequency_hours > 0 && hoursSinceAttempt !== null && hoursSinceAttempt < spec.frequency_hours) {
    shouldRunNow = false;
    skipReason = `waiting_until_next_window:${next_attempt_at}`;
  } else {
    shouldRunNow = true;
    skipReason = "";
  }

  return {
    source_key: sourceKey,
    source_label: spec.source_label,
    tier: spec.tier,
    tier_label: spec.tier_label,
    source_layer: spec.source_layer,
    update_frequency: spec.update_frequency,
    frequency_hours: spec.frequency_hours,
    status,
    configured,
    attempted,
    rows_collected: rowsCollected,
    rows_normalized: rowsNormalized,
    rows_matched_to_vessels: number(quality.rows_matched_to_vessels ?? cache.last_success_record_count),
    last_attempt_at: lastAttemptAt,
    last_success_at: lastSuccessAt,
    hours_since_last_attempt: hoursSinceAttempt,
    hours_since_last_success: hoursSinceSuccess,
    next_attempt_at,
    should_run_now: shouldRunNow,
    skip_reason: shouldRunNow ? "" : skipReason,
    quality_label: quality.quality_label || null,
    utilization_score: quality.utilization_score ?? null,
    blocker_reason: quality.blocker_reason || cache.blocker_reason || sourceStatus.skip_reason || "",
    recommended_fix: quality.recommended_fix || cache.recommended_fix || sourceStatus.exact_fix_instruction || "",
    core_blocking: spec.source_layer === "core",
    scheduler_note: spec.source_layer === "core"
      ? "Core sources run every update."
      : shouldRunNow
        ? "Eligible for this update window."
        : "Skip this auxiliary source for the current core update window."
  };
}

export function buildSourceSchedulePayload({
  sourceCollectionStatus = {},
  sourceQualityScore = {},
  auxiliaryCacheStatus = {},
  previousSchedule = {},
  diagnostics = {},
  generatedAt = new Date().toISOString(),
  dataMode = "static_snapshot",
  report = {}
} = {}) {
  const items = SOURCE_SCHEDULE_TIERS.map(spec => buildScheduleItem({
    spec,
    sourceCollectionStatus,
    sourceQualityScore,
    auxiliaryCacheStatus,
    previousSchedule,
    diagnostics,
    generatedAt
  }));
  const tierCounts = items.reduce((acc, item) => {
    acc[item.tier] = (acc[item.tier] || 0) + 1;
    return acc;
  }, {});
  const shouldRun = items.filter(item => item.should_run_now).map(item => item.source_key);
  const skipped = items.filter(item => !item.should_run_now).map(item => item.source_key);
  return {
    schema_version: "1.0",
    generated_at: generatedAt,
    data_mode: dataMode,
    source_run_id: sourceCollectionStatus.run_id || report.run_id || null,
    run_id: report.run_id || sourceCollectionStatus.run_id || null,
    scheduler_policy: {
      objective: "Avoid running all auxiliary sources on every core update.",
      core_sources_run_every_update: true,
      auxiliary_sources_use_last_attempt_window: true,
      destructive_action: false
    },
    record_count: items.length,
    item_count: items.length,
    tier_counts: tierCounts,
    should_run_count: shouldRun.length,
    skipped_count: skipped.length,
    should_run_sources: shouldRun,
    skipped_sources: skipped,
    items
  };
}

export function sourceScheduleDecisionForKey(sourceKey = "", schedulePayload = {}) {
  const groupKey = sourceScheduleGroupKey(sourceKey);
  const byKey = bySourceKey(schedulePayload.items || []);
  const item = byKey.get(groupKey);
  if (!item) return null;
  if (item.should_run_now === false && item.next_attempt_at) {
    const now = Date.now();
    const nextAttempt = Date.parse(item.next_attempt_at);
    if (Number.isFinite(nextAttempt) && now >= nextAttempt) {
      return {
        ...item,
        should_run_now: true,
        skip_reason: "",
        scheduler_note: "Eligible at runtime because next_attempt_at has passed."
      };
    }
  }
  return item;
}
