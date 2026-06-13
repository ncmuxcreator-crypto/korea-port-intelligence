import fs from "node:fs";
import { buildRunOrigin } from "./lib/runtime-config-audit.js";
import { baseDatasetFields, getBaseDatasetState } from "./lib/dataset-state.js";

const required = [
  "dashboard/api/vessels.json",
  "dashboard/api/all-collected-vessels.json",
  "dashboard/api/target-vessels.json",
  "dashboard/api/candidates.json",
  "dashboard/api/dashboard-summary.json",
  "dashboard/api/candidate-summary.json",
  "dashboard/api/contact-queue.json"
];

function readJson(path, fallback = null) {
  try {
    return fs.existsSync(path) ? JSON.parse(fs.readFileSync(path, "utf8")) : fallback;
  } catch {
    return fallback;
  }
}

const validationMode = String(process.env.VALIDATION_MODE || (process.env.CI === "true" ? "production" : "local")).toLowerCase();

function outputPath(path) {
  if (validationMode === "production") return path;
  const debugPath = path.startsWith("dashboard/api/") ? `dashboard/api/debug/${path.slice("dashboard/api/".length)}` : path;
  if (!fs.existsSync(debugPath)) return path;
  if (!fs.existsSync(path)) return debugPath;
  const mainRows = countRows(readJson(path, []));
  const debugRows = countRows(readJson(debugPath, []));
  return mainRows > 0 || debugRows === 0 ? path : debugPath;
}

function countRows(value) {
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

const status = readJson(outputPath("dashboard/api/status.json"), {});
const dashboardSummary = readJson(outputPath("dashboard/api/dashboard-summary.json"), {});
const datasetState = getBaseDatasetState({
  statusPath: outputPath("dashboard/api/status.json"),
  vesselsPath: outputPath("dashboard/api/vessels.json"),
  allCollectedPath: outputPath("dashboard/api/all-collected-vessels.json"),
  summaryPath: outputPath("dashboard/api/dashboard-summary.json")
});
const fileRows = {};
const missing = [];
const empty = [];

for (const file of required) {
  const effectiveFile = outputPath(file);
  if (!fs.existsSync(effectiveFile)) {
    missing.push(file);
    continue;
  }
  const stat = fs.statSync(effectiveFile);
  const rows = stat.size > 0 ? countRows(readJson(effectiveFile, [])) : 0;
  fileRows[file] = rows;
  if (stat.size === 0 || rows === 0) empty.push(file);
}

const dataMode = String(status.data_mode || dashboardSummary.status?.data_mode || "").toLowerCase();
const recordCount = Number(status.record_count || dashboardSummary.record_count || 0);
const vesselsRows = Number(fileRows["dashboard/api/vessels.json"] || 0);
const allCollectedRows = Number(fileRows["dashboard/api/all-collected-vessels.json"] || 0);
const targetVesselsRows = Number(fileRows["dashboard/api/target-vessels.json"] || 0);
const dashboardSummaryRecordCount = Number(dashboardSummary.record_count || 0);
const emptyDataset = datasetState.base_dataset_empty || recordCount === 0 || vesselsRows === 0 || allCollectedRows === 0 || dashboardSummaryRecordCount === 0;
const localNoLiveData = validationMode === "local" && dataMode === "no_live_data";
const ok = missing.length === 0 && !emptyDataset;
const guardSeverity = emptyDataset
  ? localNoLiveData ? "diagnostics_only" : "fatal"
  : missing.length ? "fatal" : "ready";
const runOrigin = buildRunOrigin({
  runId: status.run_id || status.active_run_id || status.summary_run_id || null,
  validationMode,
  servingMode: emptyDataset ? "local_diagnostics" : "static_json"
});
const statusRunId = status.run_id || status.active_run_id || status.summary_run_id || null;
const diagnosticRunId = runOrigin.run_id || null;
const staleDiagnostic = Boolean(statusRunId && diagnosticRunId && String(statusRunId) !== String(diagnosticRunId));

const report = {
  ...runOrigin,
  version: "17.7.0",
  generated_at: new Date().toISOString(),
  status_run_id: statusRunId,
  active_run_id: status.active_run_id || statusRunId,
  stale_diagnostic: staleDiagnostic,
  placeholder: false,
  ...baseDatasetFields(datasetState),
  validation_mode: validationMode,
  serving_mode: emptyDataset ? "local_diagnostics" : "static_json",
  data_source_used: emptyDataset ? "diagnostics_or_last_successful_fallback" : "static_json",
  fallback_used: Boolean(emptyDataset && datasetState.latest_successful_snapshot_available),
  fallback_reason: emptyDataset
    ? datasetState.latest_successful_snapshot_available
      ? "base_dataset_empty_using_latest_successful_fallback"
      : "base_dataset_empty_no_successful_fallback"
    : null,
  data_mode: dataMode || "unknown",
  record_count: recordCount,
  dashboard_summary_record_count: dashboardSummaryRecordCount,
  vessels_json_count: vesselsRows,
  all_collected_vessels_count: allCollectedRows,
  target_vessels_count: targetVesselsRows,
  required,
  missing,
  empty,
  file_rows: fileRows,
  row_count_validation: {
    "dashboard/api/vessels.json": {
      rows: vesselsRows,
      ok: vesselsRows > 0
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
  row_count_validation_passed: vesselsRows > 0 && allCollectedRows > 0 && dashboardSummaryRecordCount > 0,
  status: emptyDataset ? "empty_dataset" : "ready",
  guard_severity: guardSeverity,
  ok: ok && !staleDiagnostic,
  production_ready: ok && !staleDiagnostic && validationMode === "production",
  diagnostics_only: localNoLiveData && emptyDataset,
  warning: localNoLiveData && emptyDataset
    ? "local/no-secret no_live_data snapshot has no rows and is diagnostics-only"
    : targetVesselsRows === 0
      ? "target-vessels.json has zero rows; validate candidate generation separately"
      : staleDiagnostic
        ? "snapshot-guard run_id does not match status.json run_id"
        : null
};

fs.mkdirSync("dashboard/api", { recursive: true });
fs.mkdirSync("dashboard/api/debug", { recursive: true });
fs.writeFileSync("dashboard/api/snapshot-guard.json", JSON.stringify(report, null, 2));
fs.writeFileSync("dashboard/api/debug/snapshot-guard.json", JSON.stringify(report, null, 2));

if (!report.ok && validationMode === "production") {
  console.error("Snapshot guard failed", report);
  process.exit(1);
}

if (!report.ok) console.warn("Snapshot guard warning", report);
else console.log("Snapshot guard passed");
