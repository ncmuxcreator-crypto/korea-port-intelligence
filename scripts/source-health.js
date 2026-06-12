import fs from "node:fs";
import { buildRunOrigin, buildRuntimeConfigAudit, portOperationApiUrlInfo, portOperationServiceKeyPresent } from "./lib/runtime-config-audit.js";
import { baseDatasetFields, getBaseDatasetState, markDerivedReport } from "./lib/dataset-state.js";
import { buildSourceCollectionStatus } from "./lib/source-activation.js";

const tracked = [
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_ANON_KEY",
  "MOF_AIS_DYNAMIC_API_URL",
  "MOF_AIS_DYNAMIC_SERVICE_KEY",
  "MOF_VTS_API_BASE",
  "MOF_VTS_SERVICE_KEY",
  "VESSEL_SPEC_SERVICE_KEY",
  "PORT_OPERATION_SERVICE_KEY",
  "PORT_OPERATION_API_KEY",
  "DATA_GO_KR_API_KEY",
  "SERVICE_KEY",
  "SERVICEKEY",
  "YGPA_SERVICE_KEY",
  "PORT_OPERATION_API_URL",
  "PORT_FACILITY_SERVICE_KEY",
  "PILOT_SOURCE_URLS",
  "BERTH_SOURCE_URLS",
  "ULSAN_API_KEY",
  "GDRIVE_SERVICE_ACCOUNT_JSON",
  "GDRIVE_FOLDER_ID",
  "SOURCE_CSV_URL"
];

function readJson(path, fallback = {}) {
  try {
    return fs.existsSync(path) ? JSON.parse(fs.readFileSync(path, "utf8")) : fallback;
  } catch {
    return fallback;
  }
}

function pickCurrentStatus() {
  const debug = readJson("dashboard/api/debug/status.json", null);
  const main = readJson("dashboard/api/status.json", {});
  const validationMode = String(process.env.VALIDATION_MODE || main.validation_mode || debug?.validation_mode || (process.env.CI === "true" ? "production" : "local")).toLowerCase();
  if (validationMode === "production") {
    return { status: main, status_path: "dashboard/api/status.json", diagnostics_only: false };
  }
  if (debug?.run_id && (!main?.run_id || String(debug.run_id) !== String(main.run_id))) {
    return { status: debug, status_path: "dashboard/api/debug/status.json", diagnostics_only: true };
  }
  return { status: main, status_path: "dashboard/api/status.json", diagnostics_only: false };
}

const { status, status_path: statusPath, diagnostics_only: diagnosticsOnly } = pickCurrentStatus();
const datasetState = getBaseDatasetState({ statusPath });
const canonicalRuntimePath = "dashboard/api/source-health-runtime.json";
const canonicalCollectionStatusPath = "dashboard/api/source-collection-status.json";
const registryPath = "dashboard/api/source-health.json";
const localRuntimePath = "dashboard/api/debug/source-health-local.json";
const localCollectionStatusPath = "dashboard/api/debug/source-collection-status-local.json";
const debugRegistryPath = "dashboard/api/debug/source-health.json";
const previousRuntime = readJson(canonicalRuntimePath, null);
const diagnostics = status.collector_diagnostics || {};
const sources = Array.isArray(diagnostics.sources) ? diagnostics.sources : [];
const configured = tracked.filter(key => Boolean(process.env[key]));
const enabledCollectors = [...new Set(sources.map(source => source.key || source.source_name).filter(Boolean))];
const attemptedCollectors = sources.filter(source => source.attempted).map(source => source.key || source.source_name);
const skippedCollectors = sources.filter(source => source.skipped).map(source => ({
  source_name: source.key || source.source_name || source.label || "unknown_source",
  reason: source.skip_reason || source.reason || source.error_message || source.status || "unknown_error",
  raw_reason: source.raw_skip_reason || source.reason || source.error_message || source.status || null
}));
const statusRunId = status.run_id || status.active_run_id || status.summary_run_id || "unknown_current_run";
const previousSourceHealthWasStale = Boolean(previousRuntime?.run_id && statusRunId && String(previousRuntime.run_id) !== String(statusRunId));
const validationMode = String(process.env.VALIDATION_MODE || (process.env.CI === "true" ? "production" : "local")).toLowerCase();
function normalizeServingMode(mode, fallback = "static_json") {
  const value = String(mode || "").trim().toLowerCase();
  if (["worker_supabase", "static_json", "local_diagnostics"].includes(value)) return value;
  if (value === "production_api" || value === "mixed") return "worker_supabase";
  if (value === "debug_diagnostics_only" || value === "diagnostics_only") return "local_diagnostics";
  return fallback;
}

const servingMode = normalizeServingMode(process.env.SERVING_MODE || status.serving_mode || status.output_mode || (diagnosticsOnly ? "local_diagnostics" : "static_json"), diagnosticsOnly ? "local_diagnostics" : "static_json");
const runtimeConfigAudit = buildRuntimeConfigAudit();
const portOperationApiUrl = portOperationApiUrlInfo();
const isGithubActionsRuntime = process.env.GITHUB_ACTIONS === "true" || Boolean(process.env.GITHUB_RUN_ID || process.env.GITHUB_WORKFLOW);
const runtimePath = isGithubActionsRuntime ? canonicalRuntimePath : localRuntimePath;
const collectionStatusPath = isGithubActionsRuntime ? canonicalCollectionStatusPath : localCollectionStatusPath;
const debugRuntimePath = isGithubActionsRuntime ? "dashboard/api/debug/source-health-runtime.json" : localRuntimePath;
const debugCollectionStatusPath = isGithubActionsRuntime ? "dashboard/api/debug/source-collection-status.json" : localCollectionStatusPath;
const missingPortOperationSecret = !portOperationServiceKeyPresent();
const missingPortOperationUrl = !portOperationApiUrl.effective_present;
const portOperationAttemptedCount = Number(diagnostics.coverage?.ports_attempted_count || diagnostics.ports_attempted_count || 0);
const collectorNotAttemptedReason = portOperationAttemptedCount === 0
  ? missingPortOperationSecret && missingPortOperationUrl
    ? "missing_service_key_and_api_url"
    : diagnostics.preflight_failure_reason || diagnostics.preflight?.preflight_failure_reason || diagnostics.skip_reason || "unknown_error"
  : null;
const runOrigin = buildRunOrigin({
  runId: statusRunId,
  validationMode,
  servingMode
});

const report = markDerivedReport({
  ...runOrigin,
  version: "17.7.0",
  run_id: statusRunId,
  status_run_id: statusRunId,
  active_run_id: status.active_run_id || statusRunId,
  stale_diagnostic: false,
  placeholder: false,
  ...baseDatasetFields(datasetState),
  ok: !datasetState.base_dataset_empty,
  status_source_path: statusPath,
  diagnostics_only: diagnosticsOnly,
  validation_mode: validationMode,
  serving_mode: servingMode,
  update_mode: process.env.UPDATE_MODE || status.update_mode || null,
  process_env_CI: process.env.CI || null,
  is_github_actions: isGithubActionsRuntime,
  is_local_build: !isGithubActionsRuntime,
  collection_mode: diagnosticsOnly ? "diagnostics_only" : status.data_mode === "no_live_data" ? "no_live_data" : "collection_result",
  generated_at: new Date().toISOString(),
  status_generated_at: status.completed_at || status.generated_at || null,
  stale_source_health: false,
  previous_source_health_was_stale: previousSourceHealthWasStale,
  previous_source_health_run_id: previousRuntime?.run_id || null,
  tracked: tracked.length,
  configured: configured.length,
  secrets_present: Object.fromEntries(tracked.map(key => [key, Boolean(process.env[key])])),
  runtime_config_audit: runtimeConfigAudit,
  expected_env_names: runtimeConfigAudit.expected_env_names,
  accepted_fallback_env_names: runtimeConfigAudit.accepted_fallback_env_names,
  missing_required_env_names: runtimeConfigAudit.missing_required_env_names,
  missing: tracked.filter(key => !process.env[key]),
  enabled_collectors: enabledCollectors,
  attempted_collectors: attemptedCollectors,
  skipped_collectors: skippedCollectors,
  skip_reasons: skippedCollectors.reduce((acc, source) => {
    acc[source.reason] = (acc[source.reason] || 0) + 1;
    return acc;
  }, {}),
  port_operation: {
    collector_enabled: Boolean(diagnostics.port_operation_collection_plan?.port_operation_collector_enabled),
    secret_present: portOperationServiceKeyPresent(),
    canonical_service_key_present: Boolean(process.env.PORT_OPERATION_SERVICE_KEY),
    api_url_present: Boolean(process.env.PORT_OPERATION_API_URL),
    api_url_effective: portOperationApiUrl.effective_present || Boolean(diagnostics.port_operation_collection_plan?.port_operation_api_url_effective),
    api_url_default_used: portOperationApiUrl.default_used,
    enabled_ports_loaded_count: Number(diagnostics.port_operation_collection_plan?.enabled_ports_loaded_count || 0),
    enabled_ports_passed_to_collector_count: Number(diagnostics.port_operation_collection_plan?.enabled_ports_passed_to_collector_count || 0),
    ports_attempted_count: Number(diagnostics.coverage?.ports_attempted_count || diagnostics.ports_attempted_count || 0),
    collector_not_attempted: portOperationAttemptedCount === 0,
    collector_not_attempted_reason: collectorNotAttemptedReason,
    ports_skipped_reason: diagnostics.port_operation_collection_plan?.ports_skipped_reason || diagnostics.skip_reason || null,
    first_5_ports_to_attempt: diagnostics.port_operation_collection_plan?.first_5_ports_to_attempt || [],
    smoke_test_status: diagnostics.smoke_test_status || diagnostics.port_operation_smoke_test?.smoke_test_status || null,
    smoke_test_failure_reason: diagnostics.smoke_test_failure_reason || diagnostics.port_operation_smoke_test?.smoke_test_failure_reason || null,
    smoke_test: diagnostics.port_operation_smoke_test || null
  },
  preflight: diagnostics.preflight || null,
  preflight_status: diagnostics.preflight_status || null,
  preflight_failure_reason: diagnostics.preflight_failure_reason || diagnostics.preflight?.preflight_failure_reason || null,
  collector_not_attempted: portOperationAttemptedCount === 0,
  collector_not_attempted_reason: collectorNotAttemptedReason,
  realDataReady: Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY && Number(status.record_count || 0) > 0),
  note: "Current-run source health. If run_id differs from status.json, treat this file as stale."
}, datasetState);

report.source_collection_status = buildSourceCollectionStatus({
  report: status,
  collectorDiagnostics: diagnostics,
  generatedAt: report.generated_at
});

fs.mkdirSync("dashboard/api", { recursive: true });
fs.mkdirSync("dashboard/api/debug", { recursive: true });
fs.mkdirSync("data", { recursive: true });
const registryReport = {
  ...runOrigin,
  version: "17.7.0",
  run_id: statusRunId,
  status_run_id: statusRunId,
  active_run_id: status.active_run_id || statusRunId,
  stale_diagnostic: false,
  placeholder: false,
  generated_at: report.generated_at,
  mode: "readiness_registry",
  required_for_real_data: ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"],
  recommended_public_data: ["MOF_AIS_DYNAMIC_SERVICE_KEY", "MOF_VTS_SERVICE_KEY", "PORT_OPERATION_SERVICE_KEY", "VESSEL_SPEC_SERVICE_KEY"],
  optional_enrichment: ["GDRIVE_SERVICE_ACCOUNT_JSON", "GDRIVE_FOLDER_ID", "PILOT_SOURCE_URLS", "BERTH_SOURCE_URLS", "SOURCE_CSV_URL"],
  secret_names_tracked: tracked,
  paid_ais_policy: "MarineTraffic and VesselFinder are not required for the current public-data-first backend."
};
fs.writeFileSync(runtimePath, JSON.stringify(report, null, 2));
fs.writeFileSync(collectionStatusPath, JSON.stringify(report.source_collection_status, null, 2));
fs.writeFileSync(registryPath, JSON.stringify(registryReport, null, 2));
if (debugRuntimePath !== runtimePath) {
  fs.writeFileSync(debugRuntimePath, JSON.stringify(report, null, 2));
}
if (debugCollectionStatusPath !== collectionStatusPath) {
  fs.writeFileSync(debugCollectionStatusPath, JSON.stringify(report.source_collection_status, null, 2));
}
fs.writeFileSync(debugRegistryPath, JSON.stringify(registryReport, null, 2));
fs.writeFileSync("data/source-health.json", JSON.stringify(registryReport, null, 2));
console.log("Source health generated");
