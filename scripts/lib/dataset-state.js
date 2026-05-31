import fs from "node:fs";

export function readJson(path, fallback = null) {
  try {
    return fs.existsSync(path) ? JSON.parse(fs.readFileSync(path, "utf8")) : fallback;
  } catch {
    return fallback;
  }
}

export function rowsFromJson(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.data)) return value.data;
  if (Array.isArray(value?.items)) return value.items;
  if (Array.isArray(value?.vessels)) return value.vessels;
  if (Array.isArray(value?.candidates)) return value.candidates;
  return [];
}

export function countRows(value) {
  const rows = rowsFromJson(value);
  if (rows.length) return rows.length;
  if (value && typeof value === "object") {
    return Number(value.all_vessels_count || value.all_collected_vessel_count || value.record_count || value.target_vessels_count || value.candidate_count || 0);
  }
  return 0;
}

export function getBaseDatasetState({
  statusPath = "dashboard/api/status.json",
  vesselsPath = "dashboard/api/vessels.json",
  allCollectedPath = "dashboard/api/all-collected-vessels.json",
  summaryPath = "dashboard/api/dashboard-summary.json"
} = {}) {
  const status = readJson(statusPath, {});
  const vesselsPayload = readJson(vesselsPath, []);
  const allCollectedPayload = readJson(allCollectedPath, null);
  const summaryPayload = readJson(summaryPath, {});
  const vesselsRows = rowsFromJson(vesselsPayload).length;
  const allCollectedRows = allCollectedPayload === null ? null : rowsFromJson(allCollectedPayload).length;
  const statusBaseCount = Number(
    status.all_collected_vessel_count ||
    status.all_vessels_count ||
    status.record_count ||
    summaryPayload.all_vessels_count ||
    summaryPayload.record_count ||
    0
  );
  const baseDatasetRows = Math.max(statusBaseCount, allCollectedRows ?? 0, vesselsRows);
  const dataMode = String(status.data_mode || status.data_mode_detail?.mode || summaryPayload.status?.data_mode || "").toLowerCase();
  const baseDatasetEmpty = baseDatasetRows <= 0 || dataMode === "no_live_data" || dataMode === "degraded_sample_only";
  return {
    status,
    vessels: rowsFromJson(vesselsPayload),
    allCollected: rowsFromJson(allCollectedPayload),
    summary: summaryPayload,
    data_mode: dataMode || null,
    record_count: Number(status.record_count || summaryPayload.record_count || 0),
    status_base_count: statusBaseCount,
    vessels_json_count: vesselsRows,
    all_collected_vessels_count: allCollectedRows ?? 0,
    base_dataset_rows: baseDatasetRows,
    base_dataset_empty: baseDatasetEmpty,
    derived_from_empty_dataset: baseDatasetEmpty,
    base_dataset_empty_reasons: [
      baseDatasetRows <= 0 ? "base_dataset_rows_zero" : null,
      statusBaseCount <= 0 ? "status_base_count_zero" : null,
      allCollectedRows === 0 ? "all_collected_vessels_zero" : null,
      vesselsRows === 0 ? "vessels_json_zero" : null,
      dataMode === "no_live_data" ? "no_live_data" : null,
      dataMode === "degraded_sample_only" ? "degraded_sample_only" : null
    ].filter(Boolean)
  };
}

export function baseDatasetFields(state = getBaseDatasetState()) {
  return {
    base_dataset_empty: Boolean(state.base_dataset_empty),
    derived_from_empty_dataset: Boolean(state.base_dataset_empty),
    source_vessel_dataset_count: Number(state.base_dataset_rows || 0),
    base_dataset_empty_reasons: state.base_dataset_empty_reasons || []
  };
}

export function markDerivedReport(report = {}, state = getBaseDatasetState()) {
  const fields = baseDatasetFields(state);
  if (!fields.base_dataset_empty) return { ...report, ...fields };
  return {
    ...report,
    ...fields,
    ok: false,
    production_ready: false,
    status: report.status === "ready" || report.status === "pass" ? "empty_dataset" : report.status,
    severity: report.severity === "pass" ? "empty_dataset" : report.severity,
    derived_report_status: "blocked_empty_base_dataset"
  };
}
