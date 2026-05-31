import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { buildRunOrigin, buildRuntimeConfigAudit, missingRequiredEnvNames } from "./lib/runtime-config-audit.js";
import { baseDatasetFields, getBaseDatasetState } from "./lib/dataset-state.js";

const requiredFiles = [
  "package.json",
  ".github/workflows/longterm-update.yml",
  "dashboard/api/status.json",
  "dashboard/api/vessels.json",
  "dashboard/api/all-collected-vessels.json",
  "dashboard/api/target-vessels.json",
  "dashboard/api/dashboard-summary.json",
  "dashboard/api/candidates.json",
  "dashboard/api/candidate-summary.json",
  "dashboard/api/coverage-registry.json"
];

const staticDatasetFiles = [
  "dashboard/api/vessels.json",
  "dashboard/api/candidates.json",
  "dashboard/api/all-collected-vessels.json",
  "dashboard/api/target-vessels.json",
  "dashboard/api/dashboard-summary.json"
];

const requiredSecrets = [
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "MOF_AIS_DYNAMIC_API_URL",
  "MOF_AIS_DYNAMIC_SERVICE_KEY",
  "MOF_VTS_API_BASE",
  "MOF_VTS_SERVICE_KEY",
  "VESSEL_SPEC_SERVICE_KEY",
  "PORT_OPERATION_SERVICE_KEY"
];

function readJson(path, fallback) {
  try {
    return fs.existsSync(path) ? JSON.parse(fs.readFileSync(path, "utf8")) : fallback;
  } catch (error) {
    return { __read_error: error?.message || String(error) };
  }
}

function pickCurrentStatus() {
  const debug = readJson("dashboard/api/debug/status.json", null);
  const main = readJson("dashboard/api/status.json", {});
  if (debug?.run_id && (!main?.run_id || String(debug.run_id) !== String(main.run_id))) return debug;
  return main;
}

function isTrackedFile(path) {
  try {
    execFileSync("git", ["ls-files", "--error-unmatch", path], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function rowsFromJson(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.data)) return value.data;
  if (Array.isArray(value?.items)) return value.items;
  if (Array.isArray(value?.vessels)) return value.vessels;
  if (Array.isArray(value?.candidates)) return value.candidates;
  return [];
}

const status = pickCurrentStatus();
const vesselsPayload = readJson("dashboard/api/vessels.json", []);
const allCollectedPayload = readJson("dashboard/api/all-collected-vessels.json", []);
const targetVesselsPayload = readJson("dashboard/api/target-vessels.json", []);
const dashboardSummaryPayload = readJson("dashboard/api/dashboard-summary.json", {});
const candidatesPayload = readJson("dashboard/api/candidates.json", []);
const candidateSummary = readJson("dashboard/api/candidate-summary.json", {});
const runtimeConfigAudit = buildRuntimeConfigAudit();
const datasetState = getBaseDatasetState();
const vessels = rowsFromJson(vesselsPayload);
const allCollectedVessels = rowsFromJson(allCollectedPayload);
const targetVessels = rowsFromJson(targetVesselsPayload);
const candidates = rowsFromJson(candidatesPayload);
const recordCount = Number(status.record_count || vessels.length || 0);
const candidateCount = Number(candidateSummary.candidate_count || candidateSummary.current_candidate_count || candidates.length || 0);
const files = {};
let filesExist = true;

for (const file of requiredFiles) {
  const exists = fs.existsSync(file);
  files[file] = exists ? "ok" : "missing";
  if (!exists) filesExist = false;
}

const filesHaveRows = vessels.length > 0 && recordCount > 0;
const allCollectedVesselsExists = fs.existsSync("dashboard/api/all-collected-vessels.json");
const targetVesselsExists = fs.existsSync("dashboard/api/target-vessels.json");
const dashboardSummaryExists = fs.existsSync("dashboard/api/dashboard-summary.json");
const staticFilesMissingActual = staticDatasetFiles.filter(file => !fs.existsSync(file));
const staticFilesMissingFromPackage = staticDatasetFiles.filter(file => !isTrackedFile(file));
const dataMode = status.data_mode || "unknown";
const dataStatus = filesHaveRows ? "ready" : "empty_dataset";
const missingRequiredConfig = Array.isArray(status.missing_required_config)
  ? status.missing_required_config
  : missingRequiredEnvNames();
const collectorNotAttempted = Boolean(status.collector_not_attempted || status.collector_diagnostics?.collector_not_attempted);
const collectorNotAttemptedReason = status.collector_not_attempted_reason ||
  status.collector_diagnostics?.collector_not_attempted_reason ||
  (missingRequiredConfig.includes("PORT_OPERATION_SERVICE_KEY") && missingRequiredConfig.includes("PORT_OPERATION_API_URL")
    ? "missing_service_key_and_api_url"
    : null);
const requestedServingMode = String(process.env.SERVING_MODE || "").trim().toLowerCase();
const hasWorker = fs.existsSync("src/worker.js") && fs.existsSync("wrangler.jsonc");
const hasStaticJson = fs.existsSync("dashboard/api/status.json") || fs.existsSync("dashboard/api/vessels.json");
const supportedServingModes = ["worker_supabase", "static_json", "local_diagnostics"];
const servingMode = supportedServingModes.includes(requestedServingMode)
  ? requestedServingMode
  : process.env.VALIDATION_MODE === "local"
    ? "local_diagnostics"
    : hasWorker
      ? "worker_supabase"
      : "static_json";
const workerSupabaseRequired = servingMode === "worker_supabase";
const staticOutputsValid = staticFilesMissingActual.length === 0 &&
  allCollectedVesselsExists &&
  targetVesselsExists &&
  dashboardSummaryExists &&
  recordCount > 0 &&
  allCollectedVessels.length > 0 &&
  vessels.length > 0 &&
  !["no_live_data", "degraded_sample_only", "sample_only"].includes(dataMode);
const productionReady = filesExist &&
  filesHaveRows &&
  recordCount > 0 &&
  !["no_live_data", "degraded_sample_only", "sample_only"].includes(dataMode);

const report = {
  ...buildRunOrigin({
    runId: status.run_id || status.active_run_id || null,
    validationMode: status.validation_mode || process.env.VALIDATION_MODE || (process.env.CI === "true" ? "production" : "local"),
    servingMode
  }),
  ok: productionReady,
  checked_at: new Date().toISOString(),
  ...baseDatasetFields(datasetState),
  serving_mode: servingMode,
  supported_serving_modes: supportedServingModes,
  production_data_source: workerSupabaseRequired
    ? "supabase_active_dataset"
    : servingMode === "static_json"
      ? "static_json"
      : "diagnostics_only_no_live_data",
  worker_supabase_required: workerSupabaseRequired,
  static_outputs_valid: staticOutputsValid,
  static_files_missing: servingMode === "static_json" ? staticFilesMissingActual : staticFilesMissingFromPackage,
  files_exist: filesExist,
  files_have_rows: filesHaveRows,
  all_collected_vessels_exists: allCollectedVesselsExists,
  all_collected_vessels_exists_actual: allCollectedVesselsExists,
  all_collected_vessels_in_package: isTrackedFile("dashboard/api/all-collected-vessels.json"),
  all_collected_vessels_count: allCollectedVessels.length,
  target_vessels_exists: targetVesselsExists,
  target_vessels_exists_actual: targetVesselsExists,
  target_vessels_in_package: isTrackedFile("dashboard/api/target-vessels.json"),
  target_vessels_count: targetVessels.length,
  dashboard_summary_exists_actual: dashboardSummaryExists,
  dashboard_summary_in_package: isTrackedFile("dashboard/api/dashboard-summary.json"),
  dashboard_summary_record_count: Number(dashboardSummaryPayload.record_count || dashboardSummaryPayload.all_vessels_count || 0),
  vessels_json_count: vessels.length,
  record_count: recordCount,
  vessel_rows: vessels.length,
  candidate_count: candidateCount,
  candidate_rows: candidates.length,
  data_mode: dataMode,
  data_status: dataStatus,
  validation_mode: status.validation_mode || process.env.VALIDATION_MODE || (process.env.CI === "true" ? "production" : "local"),
  runtime_mode_diagnostics: status.runtime_mode_diagnostics || null,
  runtime_config_audit: runtimeConfigAudit,
  expected_env_names: runtimeConfigAudit.expected_env_names,
  accepted_fallback_env_names: runtimeConfigAudit.accepted_fallback_env_names,
  missing_required_env_names: runtimeConfigAudit.missing_required_env_names,
  missing_required_config: missingRequiredConfig,
  collector_not_attempted: collectorNotAttempted,
  collector_not_attempted_reason: collectorNotAttemptedReason,
  user_message: !filesHaveRows
    ? "운영 데이터가 수집되지 않았습니다. Port Operation API 설정 또는 GitHub Secrets를 확인하세요."
    : "운영 데이터가 확인되었습니다.",
  production_ready: productionReady,
  files,
  secrets: Object.fromEntries(requiredSecrets.map(secret => [secret, process.env[secret] ? "configured" : "missing_or_not_in_ci"])),
  notes: [
    filesHaveRows ? "Vessel rows are present." : "vessels.json/status.json indicate an empty dataset.",
    productionReady ? "Backend static outputs look production-ready." : "Backend is not production-ready from static JSON outputs. Use Worker/Supabase active dataset if available.",
    workerSupabaseRequired ? "Static JSON files are fallback/diagnostics for Worker-Supabase serving mode." : "Static JSON files are the selected serving mode and must contain rows."
  ],
  failure_reasons: [
    !filesExist ? "required_files_missing" : null,
    !filesHaveRows ? "empty_dataset" : null,
    recordCount === 0 ? "status_record_count_zero" : null,
    ["no_live_data", "degraded_sample_only", "sample_only"].includes(dataMode) ? `data_mode_${dataMode}` : null,
    staticFilesMissingActual.length ? `static_files_missing_actual:${staticFilesMissingActual.join(",")}` : null,
    staticFilesMissingFromPackage.length ? `static_files_missing_from_package:${staticFilesMissingFromPackage.join(",")}` : null
  ].filter(Boolean)
};

fs.mkdirSync("dashboard/api", { recursive: true });
fs.writeFileSync("dashboard/api/backend-doctor.json", JSON.stringify(report, null, 2));

if (!report.ok) {
  console.error("Backend doctor failed", report);
  process.exit(1);
}

console.log("Backend doctor passed");
