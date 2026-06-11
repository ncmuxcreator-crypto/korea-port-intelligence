import fs from "fs";

const validationMode = String(process.env.VALIDATION_MODE || (process.env.CI === "true" ? "production" : "local")).toLowerCase();
if (!["production", "local"].includes(validationMode)) {
  throw new Error(`Invalid VALIDATION_MODE: ${validationMode}. Use production or local.`);
}
const validationWarnings = [];
const DEBUG_API_DIR = "dashboard/api/debug";

function countRowsInFile(file) {
  try {
    if (!fs.existsSync(file)) return 0;
    const value = JSON.parse(fs.readFileSync(file, "utf8"));
    if (Array.isArray(value)) return value.length;
    if (Array.isArray(value?.data)) return value.data.length;
    if (Array.isArray(value?.items)) return value.items.length;
    if (Array.isArray(value?.vessels)) return value.vessels.length;
    if (Array.isArray(value?.candidates)) return value.candidates.length;
    if (value && typeof value === "object" && (value.run_id || value.status_run_id || value.generated_at)) return 1;
    return Number(value?.record_count || value?.all_vessels_count || value?.target_vessels_count || value?.candidate_count || 0);
  } catch {
    return 0;
  }
}

function outputPath(file) {
  if (validationMode !== "local" || !String(file).startsWith("dashboard/api/")) return file;
  const debugPath = `${DEBUG_API_DIR}/${String(file).slice("dashboard/api/".length)}`;
  if (!fs.existsSync(debugPath)) return file;
  const rootRows = countRowsInFile(file);
  const debugRows = countRowsInFile(debugPath);
  if (fs.existsSync(file) && rootRows > 0 && rootRows >= debugRows) return file;
  return debugPath;
}

function outputExists(file) {
  return fs.existsSync(outputPath(file));
}

function readOutputJson(file) {
  return JSON.parse(fs.readFileSync(outputPath(file), "utf8"));
}

function firstJsonCharacter(text = "") {
  const match = String(text || "").replace(/^\uFEFF/, "").match(/\S/);
  return match ? match[0] : "";
}

function dashboardJsonRootType(value) {
  if (Array.isArray(value)) return "array";
  if (value === null) return "null";
  return typeof value;
}

function usingDebugOutput(file) {
  return outputPath(file).replace(/\\/g, "/").startsWith(`${DEBUG_API_DIR}/`);
}

function canonicalPriorityPort(value) {
  const key = String(value || "")
    .normalize("NFKC")
    .toUpperCase()
    .replace(/[\s._/·-]+/g, "");
  if (/BUSAN|PUSAN|부산/.test(key)) return "Busan";
  if (/ULSAN|울산/.test(key)) return "Ulsan";
  if (/YEOSUGWANGYANG|여수광양/.test(key)) return "Yeosu/Gwangyang";
  if (/YEOSU|여수/.test(key)) return "Yeosu";
  if (/GWANGYANG|광양/.test(key)) return "Gwangyang";
  if (/PYEONGTAEKDANGJIN|PYONGTAEKDANGJIN|평택당진/.test(key)) return "Pyeongtaek-Dangjin";
  if (/POHANG|포항/.test(key)) return "Pohang";
  return String(value || "").trim();
}

function hasPriorityPort(canonicalPorts, required) {
  if (required === "Yeosu/Gwangyang") {
    return canonicalPorts.has("Yeosu/Gwangyang") || (canonicalPorts.has("Yeosu") && canonicalPorts.has("Gwangyang"));
  }
  return canonicalPorts.has(required);
}

function validateRunOrigin(label, payload) {
  for (const marker of ["generated_by", "is_github_actions", "validation_mode", "serving_mode", "run_id"]) {
    if (!(marker in (payload || {}))) throw new Error(`${label} missing run origin field: ${marker}`);
  }
}

function validateRuntimeDiagnostic(label, payload, { allowPlaceholder = false } = {}) {
  try {
    validateRunOrigin(label, payload);
  } catch (error) {
    const localNoLiveDataDiagnostics = validationMode === "local" && String(status?.data_mode || "") === "no_live_data";
    if (allowPlaceholder || localNoLiveDataDiagnostics || (typeof protectedFailedRun !== "undefined" && protectedFailedRun)) {
      validationWarnings.push(`${label} is a legacy/protected diagnostic missing run origin fields: ${error.message}`);
    } else {
      throw error;
    }
  }
  const missingRuntimeMarkers = ["generated_at", "status_run_id", "active_run_id", "stale_diagnostic"]
    .filter(marker => !(marker in (payload || {})));
  if (missingRuntimeMarkers.length) {
    const localNoLiveDataDiagnostics = validationMode === "local" && String(status?.data_mode || "") === "no_live_data";
    if (allowPlaceholder || localNoLiveDataDiagnostics || (typeof protectedFailedRun !== "undefined" && protectedFailedRun)) {
      validationWarnings.push(`${label} is a legacy/protected diagnostic missing runtime markers: ${missingRuntimeMarkers.join(",")}`);
    } else {
      throw new Error(`${label} missing runtime diagnostic field: ${missingRuntimeMarkers[0]}`);
    }
  }
  if (payload.placeholder === true && !allowPlaceholder) {
    throw new Error(`${label} is a placeholder and must not be used as runtime truth`);
  }
  if (status?.run_id && payload?.run_id && String(status.run_id) !== String(payload.run_id) && payload.stale_diagnostic !== true) {
    throw new Error(`${label} must mark stale_diagnostic=true when run_id differs from status.json`);
  }
}

const required = [
  "data/latest-lite.json",
  "data/pipeline-report.json",
  "dashboard/api/vessels.json",
  "dashboard/api/status.json",
  "dashboard/index.html",
  "dashboard/api/hot-vessels.json",
  "dashboard/api/commercial-command-center.json",
  "dashboard/api/port-congestion-heatmap.json",
  "dashboard/api/biofouling-timeline.json",
  "dashboard/api/candidates.json",
  "dashboard/api/dashboard-summary.json",
  "dashboard/api/all-collected-vessels.json",
  "dashboard/api/target-vessels.json",
  "dashboard/api/staying-vessels.json",
  "dashboard/api/arrival-pipeline.json",
  "dashboard/api/imo-recovery-queue.json",
  "dashboard/api/imo-recovery-priority.json",
  "dashboard/api/high-value-targets.json",
  "dashboard/api/unknown-gt-review.json",
  "dashboard/api/high-value-low-confidence.json",
  "dashboard/api/congestion-watchlist.json",
  "dashboard/api/agent-followup-queue.json",
  "dashboard/api/watchlist/current.json",
  "dashboard/api/sales/actions.json",
  "dashboard/api/sales/conversion-pipeline.json",
  "dashboard/api/ocean-conditions.json",
  "dashboard/api/ocean-risk.geojson",
  "dashboard/api/endpoint-manifest.json",
  "dashboard/api/quality/basic-info-coverage.json",
  "dashboard/api/quality/dataset-generation-audit.json",
  "dashboard/api/review/basic-info-missing.json",
  "dashboard/api/candidate-summary.json",
  "dashboard/api/contact-queue.json",
  "dashboard/api/hot-candidates.json",
  "dashboard/api/ports.json",
  "dashboard/api/coverage-registry.json",
  "dashboard/api/readiness-gate.json",
  "dashboard/api/snapshot-guard.json",
  "dashboard/api/source-health-runtime.json",
  "dashboard/api/collector-plan-runtime.json",
  "dashboard/api/backend-ops.json",
  "dashboard/api/candidate-changes.json",
  ".github/workflows/longterm-update.yml",
  ".github/workflows/actions-health-check.yml",
  ".github/workflows/push-smoke-test.yml",
  "wrangler.jsonc",
  "src/worker.js"
];

for (const file of required) {
  if (!outputExists(file)) {
    throw new Error(`Missing required output: ${file}`);
  }
  if (/\.json$/i.test(file)) {
    try {
      readOutputJson(file);
    } catch (error) {
      throw new Error(`Invalid JSON output: ${file}`);
    }
  }
}

const oceanRiskGeoJson = JSON.parse(fs.readFileSync(outputPath("dashboard/api/ocean-risk.geojson"), "utf8"));
if (oceanRiskGeoJson.type !== "FeatureCollection" || !Array.isArray(oceanRiskGeoJson.features)) {
  throw new Error("ocean-risk.geojson must be a GeoJSON FeatureCollection.");
}
for (const feature of oceanRiskGeoJson.features) {
  const coordinates = feature?.geometry?.coordinates || [];
  const score = Number(feature?.properties?.biofouling_risk_score);
  if (feature?.geometry?.type !== "Point" || coordinates.length !== 2) {
    throw new Error("ocean-risk.geojson feature must be a Point with lon/lat coordinates.");
  }
  if (!Number.isFinite(score) || score < 0 || score > 100) {
    throw new Error("ocean-risk.geojson biofouling_risk_score must be 0-100.");
  }
  if (!feature?.properties?.risk_label_ko) {
    throw new Error("ocean-risk.geojson feature missing Korean risk label.");
  }
}

function listDashboardApiJson(dir = "dashboard/api") {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = `${dir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...listDashboardApiJson(fullPath));
    else if (entry.isFile() && entry.name.endsWith(".json")) out.push(fullPath);
  }
  return out;
}

function endpointRows(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.vessels)) return payload.vessels;
  if (Array.isArray(payload?.candidates)) return payload.candidates;
  if (Array.isArray(payload?.opportunities)) return payload.opportunities;
  if (Array.isArray(payload?.contact_today)) return payload.contact_today;
  if (Array.isArray(payload?.ports)) return payload.ports;
  if (Array.isArray(payload?.categories)) return payload.categories;
  if (Array.isArray(payload?.endpoints)) return payload.endpoints;
  return [];
}

function endpointItemCount(payload) {
  return endpointRows(payload).length;
}

function hasEndpointArray(payload) {
  return Array.isArray(payload?.items) ||
    Array.isArray(payload?.data) ||
    Array.isArray(payload?.vessels) ||
    Array.isArray(payload?.candidates) ||
    Array.isArray(payload?.opportunities) ||
    Array.isArray(payload?.contact_today) ||
    Array.isArray(payload?.ports) ||
    Array.isArray(payload?.categories) ||
    Array.isArray(payload?.endpoints) ||
    Array.isArray(payload?.pages);
}

function findUndefinedLikeJsonValue(value, currentPath = "$", found = []) {
  if (found.length > 10) return found;
  if (typeof value === "string" && /^(undefined|nan|infinity|-infinity)$/i.test(value.trim())) {
    found.push(currentPath);
  } else if (Array.isArray(value)) {
    value.forEach((item, index) => findUndefinedLikeJsonValue(item, `${currentPath}[${index}]`, found));
  } else if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) findUndefinedLikeJsonValue(child, `${currentPath}.${key}`, found);
  }
  return found;
}

const criticalDashboardEndpoints = new Set([
  "dashboard/api/bootstrap.json",
  "dashboard/api/status.json",
  "dashboard/api/dashboard-summary.json",
  "dashboard/api/sales/actions.json",
  "dashboard/api/sales/conversion-pipeline.json",
  "dashboard/api/watchlist/current.json",
  "dashboard/api/vessels/index.json",
  "dashboard/api/vessels/page-1.json",
  "dashboard/api/vessel-count-reconciliation.json"
]);

function validateCriticalDashboardEndpoint(file, payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error(`Critical endpoint must be a JSON object: ${file}`);
  }
  for (const field of ["schema_version", "generated_at"]) {
    if (!(field in payload)) throw new Error(`Critical endpoint missing ${field}: ${file}`);
  }
  const numericCount = Number(payload.record_count ?? payload.total_count ?? payload.total_vessels);
  if (!Number.isFinite(numericCount)) throw new Error(`Critical endpoint missing numeric record_count/total_count: ${file}`);
  if (/\/(sales|watchlist)\//.test(file) && !Array.isArray(payload.items)) {
    throw new Error(`Critical endpoint missing items array: ${file}`);
  }
}

for (const file of listDashboardApiJson()) {
  let payload;
  const rawText = fs.readFileSync(file, "utf8");
  const firstChar = firstJsonCharacter(rawText);
  if (firstChar !== "{") {
    throw new Error(`Dashboard API JSON must start with object root: ${file}; first_char=${firstChar || "empty"}`);
  }
  try {
    payload = JSON.parse(rawText);
  } catch (error) {
    throw new Error(`Invalid dashboard API JSON: ${file}: ${error.message}`);
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error(`Dashboard API JSON must be object root: ${file}; root_type=${dashboardJsonRootType(payload)}`);
  }
  const undefinedLike = findUndefinedLikeJsonValue(payload);
  if (undefinedLike.length) {
    throw new Error(`Dashboard API JSON contains undefined-like values: ${file}: ${undefinedLike.slice(0, 3).join(", ")}`);
  }
  if (criticalDashboardEndpoints.has(file)) validateCriticalDashboardEndpoint(file, payload);
  if (file === "dashboard/api/endpoint-manifest.json") {
    if (!Array.isArray(payload.endpoints)) throw new Error("endpoint-manifest.json missing endpoints array");
    const brokenCritical = payload.endpoints.filter(entry =>
      criticalDashboardEndpoints.has(entry.path) &&
      (entry.status === "INVALID_JSON" || entry.status === "MISSING" || entry.schema_valid === false)
    );
    if (brokenCritical.length) {
      throw new Error(`endpoint-manifest.json reports broken critical endpoints: ${brokenCritical.map(entry => entry.path).join(", ")}`);
    }
    for (const entry of payload.endpoints) {
      if (!entry?.path || !fs.existsSync(entry.path)) continue;
      let actualPayload;
      const actualText = fs.readFileSync(entry.path, "utf8");
      const actualFirstChar = firstJsonCharacter(actualText);
      const actualRootType = (() => {
        try {
          const parsed = JSON.parse(actualText);
          return dashboardJsonRootType(parsed);
        } catch {
          return "invalid";
        }
      })();
      try {
        actualPayload = JSON.parse(actualText);
      } catch (error) {
        if (entry.valid_json === true) throw new Error(`endpoint-manifest.json valid_json mismatch: ${entry.path}: ${error.message}`);
        continue;
      }
      if (entry.parsed_from_disk !== true) throw new Error(`endpoint-manifest.json missing parsed_from_disk=true for ${entry.path}`);
      if (!entry.parse_checked_at) throw new Error(`endpoint-manifest.json missing parse_checked_at for ${entry.path}`);
      if ("first_char" in entry && entry.first_char !== actualFirstChar) {
        throw new Error(`endpoint-manifest.json first_char mismatch for ${entry.path}: manifest=${entry.first_char}, actual=${actualFirstChar}`);
      }
      if ("root_type" in entry && entry.root_type !== actualRootType) {
        throw new Error(`endpoint-manifest.json root_type mismatch for ${entry.path}: manifest=${entry.root_type}, actual=${actualRootType}`);
      }
      const actualRecordCount = Number(actualPayload?.record_count ?? actualPayload?.total_count ?? actualPayload?.total_vessels ?? endpointItemCount(actualPayload));
      const actualItemCount = endpointItemCount(actualPayload);
      if (entry.valid_json !== true) throw new Error(`endpoint-manifest.json valid_json=false for parseable endpoint: ${entry.path}`);
      if ("record_count" in entry && Number(entry.record_count) !== actualRecordCount) {
        throw new Error(`endpoint-manifest.json record_count mismatch for ${entry.path}: manifest=${entry.record_count}, actual=${actualRecordCount}`);
      }
      if ("item_count" in entry && Number(entry.item_count) !== actualItemCount) {
        throw new Error(`endpoint-manifest.json item_count mismatch for ${entry.path}: manifest=${entry.item_count}, actual=${actualItemCount}`);
      }
      if (criticalDashboardEndpoints.has(entry.path) && !hasEndpointArray(actualPayload) && /\/(sales|watchlist)\//.test(entry.path)) {
        throw new Error(`Critical endpoint missing items array: ${entry.path}`);
      }
    }
  }
}

const data = JSON.parse(fs.readFileSync("data/latest-lite.json", "utf8"));
const report = JSON.parse(fs.readFileSync("data/pipeline-report.json", "utf8"));
const vessels = readOutputJson("dashboard/api/vessels.json");
const allCollectedVessels = readOutputJson("dashboard/api/all-collected-vessels.json");
const targetVessels = readOutputJson("dashboard/api/target-vessels.json");
const status = readOutputJson("dashboard/api/status.json");
const dashboardSummary = readOutputJson("dashboard/api/dashboard-summary.json");
const health = outputExists("dashboard/api/health.json") ? readOutputJson("dashboard/api/health.json") : null;

if (![status, dashboardSummary, health].some(payload => payload && (payload.last_success_at || payload.generated_at))) {
  throw new Error("status/dashboard-summary/health must expose generated_at or last_success_at for dashboard freshness display.");
}

function jsonRows(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.data)) return value.data;
  if (Array.isArray(value?.items)) return value.items;
  if (Array.isArray(value?.vessels)) return value.vessels;
  if (Array.isArray(value?.candidates)) return value.candidates;
  return [];
}

const vesselRows = jsonRows(vessels);
const allCollectedRows = jsonRows(allCollectedVessels);
const targetRows = jsonRows(targetVessels);

function statusText(value) {
  return String(value || "").toLowerCase();
}

function isProtectedFailedRun() {
  const statusFailed = ["failed", "storage_failed", "storage_finalization_failed", "db_write_failed"].includes(statusText(status.status || report.status || dashboardSummary.status));
  const storageFailed = statusText(status.supabase_write?.status || status.storage?.supabase?.status || report.supabase_write_status) === "failed";
  const postWriteFailed = statusText(status.supabase_write?.post_write_verification?.status || report.post_write_verification) === "failed";
  const protectedOutput = status.fallback_used === true ||
    dashboardSummary.fallback_used === true ||
    status.production_api_write_protected === true ||
    report.production_api_write_protected === true ||
    status.last_successful_dataset_lock?.locked === true ||
    report.last_successful_dataset_lock?.locked === true;
  return validationMode === "production" && (statusFailed || storageFailed || postWriteFailed) && protectedOutput;
}

if (!Array.isArray(data)) {
  throw new Error("Invalid latest-lite.json");
}
if (!Array.isArray(vessels) && vesselRows.length === 0) {
  throw new Error("Invalid vessels.json");
}
if (!Array.isArray(allCollectedVessels) && allCollectedRows.length === 0) {
  throw new Error("Invalid all-collected-vessels.json");
}
if (!Array.isArray(targetVessels) && targetRows.length === 0) {
  throw new Error("Invalid target-vessels.json");
}

if (!report.status || typeof report.record_count !== "number") {
  throw new Error("Invalid pipeline-report.json");
}
const collectorSources = report?.collector_diagnostics?.sources || report?.collector_diagnostics?.source_results || [];
const successfulPortOperationSources = collectorSources.filter(source =>
  String(source.key || source.source_name || "").startsWith("port_operation_") &&
  (source.success === true || String(source.status || "").toLowerCase() === "success") &&
  Number(source.normalized_count || source.rows_normalized || source.row_count || source.rows_collected || 0) > 0
);
const vesselGroupValidation = {
  all_collected_vessels_exists: outputExists("dashboard/api/all-collected-vessels.json"),
  all_collected_vessels_count: allCollectedRows.length,
  target_vessels_exists: outputExists("dashboard/api/target-vessels.json"),
  target_vessels_count: targetRows.length,
  vessels_json_count: vesselRows.length,
  successful_port_operation_source_count: successfulPortOperationSources.length,
  validation_mode: validationMode
};
if (!vesselGroupValidation.all_collected_vessels_exists || !vesselGroupValidation.target_vessels_exists) {
  throw new Error(`Missing vessel group static JSON outputs: ${JSON.stringify(vesselGroupValidation)}`);
}
const protectedFailedRun = isProtectedFailedRun();
if (report.data_mode !== "no_live_data" && report.record_count > 0 && vesselGroupValidation.all_collected_vessels_count === 0 && !protectedFailedRun) {
  throw new Error(`all-collected-vessels.json must contain rows when live record_count > 0: ${JSON.stringify(vesselGroupValidation)}`);
}
if (protectedFailedRun && report.record_count > 0 && vesselGroupValidation.all_collected_vessels_count === 0) {
  validationWarnings.push(`Protected failed production run: static vessel outputs were not replaced by this failed run. ${JSON.stringify(vesselGroupValidation)}`);
}
const productionValidationFailures = [
  report.data_mode === "no_live_data" ? "data_mode_no_live_data" : null,
  Number(report.record_count || 0) <= 0 ? "record_count_zero" : null,
  Number(report.all_collected_vessel_count || report.all_vessels_count || vesselGroupValidation.all_collected_vessels_count || 0) <= 0 ? "all_vessels_count_zero" : null,
  successfulPortOperationSources.length < 1 ? "no_successful_port_operation_source" : null
].filter(Boolean);
if (validationMode === "production" && productionValidationFailures.length) {
  throw new Error(`Production validation failed: ${productionValidationFailures.join(", ")}; ${JSON.stringify(vesselGroupValidation)}`);
}
if (validationMode === "local" && report.data_mode === "no_live_data") {
  validationWarnings.push("Local validation warning: no_live_data snapshot is allowed in local mode only.");
}

for (const item of data) {
  if (!item.vessel_id || !item.vessel_name || !item.port) {
    throw new Error("Missing required vessel fields");
  }
  for (const field of ["eta", "etb", "ata", "atb", "etd", "atd"]) {
    if (!(field in item)) {
      throw new Error(`Missing schedule field ${field} for ${item.vessel_name || item.vessel_id}`);
    }
  }
  for (const field of ["stay_hours", "current_call_stay_hours", "cumulative_stay_hours", "cumulative_stay_days", "berth_hours", "anchorage_hours", "work_window_hours", "biofouling_score", "cii_pressure_score", "total_sales_priority_score", "reason_codes"]) {
    if (!(field in item)) {
      throw new Error(`Missing intelligence field ${field} for ${item.vessel_name || item.vessel_id}`);
    }
  }
  for (const field of ["hybrid_entity_key", "identification_method", "imo_status", "gt_group", "stay_days_group"]) {
    if (!(field in item)) {
      throw new Error(`Missing commercial command-center field ${field} for ${item.vessel_name || item.vessel_id}`);
    }
  }
  for (const field of ["master_vessel_id", "normalized_vessel_name", "identity_match_strategy", "identity_confidence", "identity_confidence_band"]) {
    if (!(field in item)) {
      throw new Error(`Missing vessel identity resolution field ${field} for ${item.vessel_name || item.vessel_id}`);
    }
  }
  for (const field of ["commercial_gt_threshold", "meets_commercial_gt_threshold"]) {
    if (!(field in item)) {
      throw new Error(`Missing commercial GT field ${field} for ${item.vessel_name || item.vessel_id}`);
    }
  }
  for (const field of ["grtg", "intrlGrtg", "gt_source", "gt_status", "status_bucket", "commercial_relevance_status"]) {
    if (!(field in item)) {
      throw new Error(`Missing commercial visibility field ${field} for ${item.vessel_name || item.vessel_id}`);
    }
  }
  for (const field of ["vessel_type_group", "commercial_signal_flags", "commercial_signal_strength", "imo_recovery_score", "imo_recovery_priority"]) {
    if (!(field in item)) {
      throw new Error(`Missing commercial enrichment field ${field} for ${item.vessel_name || item.vessel_id}`);
    }
  }
  for (const field of ["commercial_value_score", "commercial_value_band", "data_confidence_score", "data_confidence_band", "vessel_value_score", "sales_accessibility_score"]) {
    if (!(field in item)) {
      throw new Error(`Missing commercial value field ${field} for ${item.vessel_name || item.vessel_id}`);
    }
  }
  for (const field of ["operator_normalized", "agent_normalized", "destination_port", "vessel_basic_info_completeness_score", "vessel_basic_info_missing_fields", "vessel_spec_enrichment_priority"]) {
    if (!(field in item)) {
      throw new Error(`Missing basic vessel information field ${field} for ${item.vessel_name || item.vessel_id}`);
    }
  }
}

const priorityPorts = report?.data_strategy?.priority_ports || [];
const canonicalPriorityPorts = new Set(priorityPorts.map(canonicalPriorityPort));
const requiredPriorityPorts = ["Busan", "Yeosu/Gwangyang", "Ulsan", "Pyeongtaek-Dangjin", "Pohang"];
for (const port of requiredPriorityPorts) {
  if (!hasPriorityPort(canonicalPriorityPorts, port)) {
    throw new Error(`Missing priority port in data strategy: ${port}`);
  }
}

if (!String(report?.data_strategy?.vts_architecture || "").includes("Integrated VTS")) {
  throw new Error("VTS architecture must be integrated/national, not Yeosu-only");
}

if (["sample_only", "degraded_sample_only"].includes(report.data_mode)) {
  throw new Error("Sample/demo data modes are not allowed in generated outputs");
}
if (report.data_mode === "no_live_data" && (report.record_count !== 0 || report.actionable_rows !== 0 || report?.candidate_ops?.current_candidate_count !== 0)) {
  throw new Error("No-live-data mode must expose zero vessels, zero actionable rows, and zero candidates");
}

for (const vessel of vesselRows) {
  const isSample = String(vessel.source_mode || "").includes("sample");
  if (isSample && vessel.commercial_use_status !== "do_not_use_for_outreach") {
    throw new Error(`Sample vessel is not blocked from outreach: ${vessel.vessel_name || vessel.vessel_id}`);
  }
  if (isSample && (vessel.is_operating_candidate || vessel.is_operating_immediate_candidate)) {
    throw new Error(`Sample vessel is exposed as operating candidate: ${vessel.vessel_name || vessel.vessel_id}`);
  }
}



const commonApiFields = ["run_id", "active_run_id", "generated_at", "serving_mode", "data_source_used", "fallback_used", "fallback_reason", "data_freshness", "record_count"];
const supportedServingModes = new Set(["worker_supabase", "static_json", "local_diagnostics"]);
const vesselRowFields = ["port_call_id", "master_vessel_id", "vessel_name", "port_code", "port_name", "candidate_band", "commercial_value_score", "data_confidence_score"];
function contractIssue(message) {
  if (validationMode === "production" && !protectedFailedRun) throw new Error(message);
  if (validationMode === "production" && protectedFailedRun) {
    validationWarnings.push(`Protected production fallback warning: ${message}`);
    return;
  }
  validationWarnings.push(`Local data-contract warning: ${message}`);
}
function validateApiContract(name, payload, requiredFields = commonApiFields) {
  for (const field of requiredFields) {
    if (!(field in (payload || {}))) contractIssue(`${name} missing required API field: ${field}`);
  }
  if (payload?.serving_mode && !supportedServingModes.has(String(payload.serving_mode))) {
    contractIssue(`${name} has unsupported serving_mode: ${payload.serving_mode}`);
  }
}
function validateEmptyBaseDerivedReport(name, payload) {
  const baseEmpty = Number(status.all_collected_vessel_count || status.all_vessels_count || status.record_count || 0) === 0 ||
    ["no_live_data", "degraded_sample_only"].includes(String(status.data_mode || status.data_mode_detail?.mode || "").toLowerCase());
  if (!baseEmpty || !payload || typeof payload !== "object") return;
  if (payload.base_dataset_empty !== true) contractIssue(`${name} must mark base_dataset_empty=true when source vessel dataset is empty`);
  if (payload.derived_from_empty_dataset !== true) contractIssue(`${name} must mark derived_from_empty_dataset=true when source vessel dataset is empty`);
  if (payload.ok === true) contractIssue(`${name} must not return ok=true when source vessel dataset is empty`);
}
function validateVesselRowContract(name, rows) {
  const sample = rows.find(row => row && typeof row === "object");
  if (!sample) return;
  for (const field of vesselRowFields) {
    if (!(field in sample)) contractIssue(`${name} vessel row missing required field: ${field}`);
  }
}
validateApiContract("dashboard-summary.json", dashboardSummary);
validateApiContract("status.json", status);
for (const [name, path] of [
  ["backend-doctor.json", "dashboard/api/backend-doctor.json"],
  ["readiness-gate.json", "dashboard/api/readiness-gate.json"],
  ["snapshot-guard.json", "dashboard/api/snapshot-guard.json"],
  ["source-health-runtime.json", "dashboard/api/source-health-runtime.json"],
  ["collector-plan-runtime.json", "dashboard/api/collector-plan-runtime.json"],
  ["candidate-audit.json", "dashboard/api/candidate-audit.json"],
  ["candidate-confidence-runtime.json", "dashboard/api/candidate-confidence-runtime.json"],
  ["candidate-dedupe.json", "dashboard/api/candidate-dedupe.json"],
  ["candidate-explanations.json", "dashboard/api/candidate-explanations.json"],
  ["contact-windows.json", "dashboard/api/contact-windows.json"],
  ["daily-candidate-report-runtime.json", "dashboard/api/daily-candidate-report-runtime.json"],
  ["risk-calibration.json", "dashboard/api/risk-calibration.json"],
  ["pipeline-sla-runtime.json", "dashboard/api/pipeline-sla-runtime.json"],
  ["dataset-generation-audit.json", "dashboard/api/quality/dataset-generation-audit.json"]
]) {
  if (outputExists(path)) validateEmptyBaseDerivedReport(name, readOutputJson(path));
}
for (const [name, payload] of [
  ["vessels.json", vessels],
  ["all-collected-vessels.json", allCollectedVessels],
  ["target-vessels.json", targetVessels]
]) {
  if (Array.isArray(payload)) {
    contractIssue(`${name} must use a response envelope with serving_mode/data_source_used/fallback metadata`);
  } else {
    validateApiContract(name, payload);
  }
}
for (const field of ["status_run_id", "summary_run_id", "latest_successful_run_id"]) {
  if (!(field in dashboardSummary)) contractIssue(`dashboard-summary.json missing run-context field: ${field}`);
}
if (
  dashboardSummary.status_run_id &&
  dashboardSummary.summary_run_id &&
  String(dashboardSummary.status_run_id) !== String(dashboardSummary.summary_run_id)
) {
  const warnings = Array.isArray(dashboardSummary.warnings) ? dashboardSummary.warnings : [];
  const hasWarning = dashboardSummary.run_context_mismatch === true ||
    dashboardSummary.run_context_warning === "status_run_id !== summary_run_id" ||
    warnings.includes("status_run_id !== summary_run_id");
  if (!hasWarning) contractIssue("dashboard-summary.json must warn when status_run_id !== summary_run_id");
}
validateRunOrigin("status.json", status);
const statusSupabaseStorage = status.storage?.supabase || status.storage_status?.supabase || status.supabase_write || {};
const statusSupabaseStorageStatus = String(statusSupabaseStorage.status || "").toLowerCase();
if (validationMode === "production" && !protectedFailedRun && ["syncing", "pending", "unknown", "not_configured", ""].includes(statusSupabaseStorageStatus)) {
  throw new Error(`Production status must not treat non-final Supabase storage status as success: ${statusSupabaseStorageStatus}`);
}
if (
  validationMode === "production" &&
  !protectedFailedRun &&
  Number(status.record_count || 0) > 0 &&
  statusSupabaseStorageStatus !== "completed"
) {
  throw new Error(`Production status with vessel rows requires Supabase storage completed, got: ${statusSupabaseStorageStatus || "missing"}`);
}
if (
  validationMode === "production" &&
  !protectedFailedRun &&
  Number(status.record_count || 0) > 0 &&
  statusSupabaseStorage.post_write_verification?.status !== "completed"
) {
  throw new Error("Production status with vessel rows requires completed post_write_verification");
}
if (validationMode === "production") {
  const realDatasetExists = Number(status.record_count || report.record_count || dashboardSummary.record_count || 0) > 0 ||
    Number(status.all_vessels_count || status.all_collected_vessel_count || report.all_vessels_count || report.all_collected_vessel_count || dashboardSummary.all_vessels_count || 0) > 0 ||
    Boolean(status.latest_successful_run_id || status.latest_successful_summary_run_id || dashboardSummary.latest_successful_run_id) ||
    allCollectedRows.length > 0 ||
    vesselRows.length > 0;
  if (!realDatasetExists) {
    throw new Error("Production validation requires at least one real active, fallback, or static dataset.");
  }
  if (status.status === "failed" && status.fallback_used === true && !status.latest_successful_run_id && !dashboardSummary.latest_successful_run_id && !allCollectedRows.length) {
    validationWarnings.push("Failed production run has no latest successful fallback yet; update failure remains the primary production blocker.");
  }
}
validateVesselRowContract("all-collected-vessels.json", allCollectedRows);
validateVesselRowContract("target-vessels.json", targetRows);
validateVesselRowContract("vessels.json", vesselRows);
if (outputExists("dashboard/api/backend-doctor.json")) {
  const doctor = readOutputJson("dashboard/api/backend-doctor.json");
  if ("generated_by" in doctor) validateRunOrigin("backend-doctor.json", doctor);
  if (doctor.files_have_rows === false && doctor.ok === true) {
    throw new Error("Backend doctor must not return ok=true for empty vessel data");
  }
  if (Number(doctor.record_count || 0) === 0 && doctor.production_ready === true) {
    throw new Error("Backend doctor must not mark record_count=0 as production_ready");
  }
  if (Number(doctor.record_count || 0) === 0 && doctor.data_status !== "empty_dataset") {
    throw new Error("Backend doctor must mark record_count=0 as empty_dataset");
  }
  for (const marker of ["serving_mode", "static_outputs_valid", "worker_supabase_required", "production_data_source"]) {
    if (!(marker in doctor)) throw new Error(`Backend doctor missing serving-mode field: ${marker}`);
  }
  for (const marker of ["all_collected_vessels_exists_actual", "target_vessels_exists_actual", "dashboard_summary_exists_actual"]) {
    if (!(marker in doctor)) throw new Error(`Backend doctor missing actual static output field: ${marker}`);
  }
}
if (outputExists("dashboard/api/readiness-gate.json")) {
  const readiness = readOutputJson("dashboard/api/readiness-gate.json");
  validateRuntimeDiagnostic("readiness-gate.json", readiness);
  if (!readiness.run_id || !readiness.generated_at) {
    throw new Error("Readiness gate must include run_id and generated_at");
  }
  if (status.run_id && readiness.run_id && String(status.run_id) !== String(readiness.run_id) && readiness.stale_readiness_gate !== true) {
    throw new Error("Readiness gate must mark stale_readiness_gate=true when run_id differs from status.json");
  }
  if (Number(readiness.total || 0) === 0 && readiness.ok === true) {
    throw new Error("Readiness gate must not return ok=true for an empty dataset");
  }
  if ((Number(readiness.total || 0) === 0 || Number(readiness.record_count || 0) === 0) && readiness.readiness_status !== "empty_dataset") {
    throw new Error("Readiness gate must mark total=0 or record_count=0 as empty_dataset");
  }
  if ((Number(readiness.total || 0) === 0 || Number(readiness.record_count || 0) === 0) && readiness.ok !== false) {
    throw new Error("Readiness gate must not pass total=0 or record_count=0 datasets");
  }
  if ((Number(readiness.total || 0) === 0 || Number(readiness.record_count || 0) === 0) && readiness.production_ready !== false) {
    throw new Error("Readiness gate must not mark total=0 or record_count=0 datasets as production_ready");
  }
  if (String(readiness.data_mode || "") === "no_live_data" && readiness.production_ready === true) {
    throw new Error("Readiness gate must not mark no_live_data as production_ready");
  }
}
if (outputExists("dashboard/api/snapshot-guard.json")) {
  const guard = readOutputJson("dashboard/api/snapshot-guard.json");
  validateRuntimeDiagnostic("snapshot-guard.json", guard);
  if (Number(status.record_count || 0) === 0 && guard.status !== "empty_dataset") {
    throw new Error("Snapshot guard must mark zero-row outputs as empty_dataset");
  }
  if (Number(status.record_count || 0) === 0 && guard.production_ready === true) {
    throw new Error("Snapshot guard must not mark zero-row outputs as production_ready");
  }
  const guardRows = guard.file_rows || {};
  const vesselsJsonRows = Number(guard.vessels_json_count ?? guardRows["dashboard/api/vessels.json"] ?? 0);
  const allCollectedRows = Number(guard.all_collected_vessels_count ?? guardRows["dashboard/api/all-collected-vessels.json"] ?? 0);
  const summaryRecordCount = Number(guard.dashboard_summary_record_count ?? 0);
  if ((vesselsJsonRows === 0 || allCollectedRows === 0 || summaryRecordCount === 0) && guard.status !== "empty_dataset") {
    throw new Error("Snapshot guard must mark zero-row core outputs as empty_dataset");
  }
  if (validationMode === "production" && (vesselsJsonRows === 0 || allCollectedRows === 0 || summaryRecordCount === 0) && guard.ok !== false) {
    throw new Error("Snapshot guard must fail production validation for zero-row core outputs");
  }
}
if (outputExists("dashboard/api/source-health-runtime.json")) {
  const sourceHealth = readOutputJson("dashboard/api/source-health-runtime.json");
  validateRuntimeDiagnostic("source-health-runtime.json", sourceHealth);
  const sourceHealthHasCurrentRunFields = ["run_id", "generated_at", "secrets_present", "enabled_collectors", "attempted_collectors", "skipped_collectors"].every(marker => marker in sourceHealth);
  const localDebugStatusWithStaleMainSourceHealth = validationMode === "local" &&
    String(status.data_mode || "") === "no_live_data" &&
    !usingDebugOutput("dashboard/api/source-health-runtime.json");
  const staleLegacySourceHealth = !sourceHealthHasCurrentRunFields &&
    status.run_id &&
    !usingDebugOutput("dashboard/api/source-health-runtime.json");
  if (status.run_id && sourceHealth.run_id && String(status.run_id) !== String(sourceHealth.run_id) && sourceHealth.stale_source_health !== true && !localDebugStatusWithStaleMainSourceHealth) {
    throw new Error("Source health runtime must mark stale_source_health=true when run_id differs from status.json");
  }
  if (staleLegacySourceHealth) {
    validationWarnings.push("Source health runtime is stale or legacy; run npm run source:health to regenerate current-run diagnostics.");
  } else
  for (const marker of ["run_id", "generated_at", "secrets_present", "enabled_collectors", "attempted_collectors", "skipped_collectors"]) {
    if (!(marker in sourceHealth)) throw new Error(`Source health runtime missing current-run field: ${marker}`);
  }
}
if (outputExists("dashboard/api/collector-plan-runtime.json")) {
  validateRuntimeDiagnostic("collector-plan-runtime.json", readOutputJson("dashboard/api/collector-plan-runtime.json"));
}
if (outputExists("dashboard/api/backend-ops.json")) {
  validateRuntimeDiagnostic("backend-ops.json", readOutputJson("dashboard/api/backend-ops.json"));
}
if (outputExists("dashboard/api/snapshot-diff-runtime.json")) {
  const snapshotDiff = readOutputJson("dashboard/api/snapshot-diff-runtime.json");
  validateRuntimeDiagnostic("snapshot-diff-runtime.json", snapshotDiff, { allowPlaceholder: true });
  if (snapshotDiff.placeholder === true && snapshotDiff.ok === true) {
    throw new Error("snapshot-diff-runtime placeholder must not return ok=true");
  }
}
if (!status.candidate_ops || !status.backend_health || !status.seven_pack_summary) {
  throw new Error("Missing stability bundle outputs");
}
if (!status.backend_stability_batch || !status.runtime_budget || !status.master_db_roadmap) {
  throw new Error("Missing v17.7 backend stability batch outputs");
}
if (!status.collector_diagnostics || typeof status.collector_diagnostics.attempted_count !== "number") {
  throw new Error("Missing collector diagnostics");
}
if (!status.collector_diagnostics.preflight || !("preflight_failure_reason" in status.collector_diagnostics.preflight)) {
  throw new Error("Collector diagnostics must include preflight check results");
}
const allowedSkipReasons = new Set([
  "missing_service_key_and_api_url",
  "missing_service_key",
  "missing_api_url",
  "collector_disabled",
  "no_enabled_ports",
  "local_no_secret_mode",
  "validation_mode_blocks_collection",
  "unknown_error"
]);
if (Number(status.collector_diagnostics.attempted_count || 0) === 0 && !status.collector_diagnostics.skip_reason && !status.collector_diagnostics.preflight_failure_reason) {
  throw new Error("Collector diagnostics must not have attempted_count=0 without skip_reason");
}
if (status.collector_diagnostics.skip_reason && !allowedSkipReasons.has(status.collector_diagnostics.skip_reason)) {
  throw new Error(`Collector skip_reason is not standardized: ${status.collector_diagnostics.skip_reason}`);
}
for (const source of status.collector_diagnostics.sources || []) {
  if (source.skipped && (!source.skip_reason || !allowedSkipReasons.has(source.skip_reason))) {
    throw new Error(`Skipped collector missing standardized skip_reason: ${source.key || source.source_name || source.label || "unknown"}`);
  }
}
if (status.data_mode === "no_live_data" && !status.preflight_failure_reason && status.collector_diagnostics.preflight_status === "failed") {
  throw new Error("No-live-data preflight failures must expose preflight_failure_reason");
}
if (status.collector_diagnostics.smoke_test_status === "failed" && !status.collector_diagnostics.smoke_test_failure_reason) {
  throw new Error("Failed Port Operation smoke test must expose smoke_test_failure_reason");
}
if (status.collector_diagnostics.port_operation_smoke_test?.smoke_test_status === "failed" && !status.collector_diagnostics.port_operation_smoke_test?.smoke_test_failure_reason) {
  throw new Error("Port Operation smoke test diagnostics must include exact failure reason");
}
if (!status.commercial_command_center || !Array.isArray(status.port_congestion_heatmap) || !Array.isArray(status.biofouling_timeline)) {
  throw new Error("Missing commercial command-center frontend outputs");
}
if (typeof status.actionable_rows !== "number" || typeof status.collector_diagnostics?.actionable_row_count !== "number") {
  throw new Error("Missing actionable_rows collector metric");
}
if (status.collector_diagnostics?.fallback_used) {
  const preflightFailed = status.collector_diagnostics?.preflight_status === "failed";
  const smokeFailed = status.collector_diagnostics?.smoke_test_status === "failed";
  const allowedStatus = status.status === "degraded_sample_only" || ((preflightFailed || smokeFailed) && status.status === "failed");
  if (status.data_mode !== "no_live_data" || !allowedStatus) {
    throw new Error("Collector fallback must publish no_live_data with degraded_sample_only status, failed preflight status, or failed smoke-test status");
  }
}
for (const forbidden of ["MV HF ZHOUSHAN", "MAERSK DEMO", "YEOSU TARGET", "integrated_vts_sample", "sample_snapshot"]) {
  const haystack = [
    JSON.stringify(vessels),
    outputExists("dashboard/api/status.json") ? fs.readFileSync(outputPath("dashboard/api/status.json"), "utf8") : ""
  ].join("\n");
  if (haystack.includes(forbidden)) throw new Error(`Forbidden sample/demo vessel marker found: ${forbidden}`);
}

const workflow = fs.readFileSync(".github/workflows/longterm-update.yml", "utf8");
if (!/on:\s*[\s\S]*workflow_dispatch:/.test(workflow) || !/schedule:/.test(workflow)) {
  throw new Error("Workflow trigger configuration is incomplete");
}
if (!workflow.includes("runs-on: ubuntu-latest") || workflow.includes("runs-on: self-hosted")) {
  throw new Error("Longterm workflow must use ubuntu-latest and must not use self-hosted runners");
}
if (!workflow.includes("group: ${{ github.workflow }}-${{ github.ref }}") || !workflow.includes("cancel-in-progress: true")) {
  throw new Error("Longterm workflow concurrency must be isolated by workflow and ref");
}
const longtermJobTimeouts = workflow.match(/^\s{4}timeout-minutes:\s*30\s*$/gm) || [];
if (!longtermJobTimeouts.length) {
  throw new Error("Longterm workflow job timeout must be 30 minutes");
}
if (!workflow.includes("MAX_CHILD_ENRICHMENT_ROWS") || !workflow.includes("MAX_SOURCE_ROWS") || !workflow.includes("MAX_OUTPUT_ROWS: 10000") || !workflow.includes("MAX_SOURCE_ROWS: 5000") || !workflow.includes("MAX_PORTS_PER_RUN: 50") || !workflow.includes("MAX_IMO_RECOVERY_CALLS: 100") || !workflow.includes("MAX_API_RESPONSE_BYTES: 25000000") || !workflow.includes("MAX_TARGET_VESSELS: 5000") || !workflow.includes("MAX_CANDIDATES: 1000") || !workflow.includes("MAX_CHILD_ENRICHMENT_ROWS: 100") || !workflow.includes("PORT_OPERATION_NUM_OF_ROWS: 50") || !workflow.includes("PORT_OPERATION_MAX_PAGES: 20") || !workflow.includes('PORT_OPERATION_DEGB_VALUES: "I,O"') || !workflow.includes("ENABLE_SOURCE_CSV") || !workflow.includes("COLLECTOR_DEBUG_VERBOSE") || !workflow.includes("DB_STORAGE_MODE: lean") || !workflow.includes("DB_ANALYTICS_SCOPE: candidate") || !workflow.includes("DB_FOUNDATION_WRITE_MODE: minimal") || !workflow.includes("EVENT_PREVIOUS_SNAPSHOT_LIMIT: 1500") || !workflow.includes("SUPABASE_BATCH_SIZE: 200") || !workflow.includes("DB_RETENTION_CLEANUP") || workflow.includes("COLLECTOR_DEBUG_ONLY: port_operation_busan") || !workflow.includes("SOURCE_TIMEOUT_MS: 30000") || !workflow.includes("COLLECTOR_RUNTIME_BUDGET_MS: 720000") || !workflow.includes("timeout-minutes: 20")) {
  throw new Error("Longterm workflow must bound collector runtime and child enrichment");
}
for (const marker of ["github.run_id", "github.ref", "runner.os", "github.workflow", "timestamp=$(date -u"]) {
  if (!workflow.includes(marker)) throw new Error(`Missing workflow start diagnostic: ${marker}`);
}
if (!workflow.includes("SOURCE_CSV_URL") || !workflow.includes("ULSAN_BERTH_DETAIL_API_KEY") || !workflow.includes("PORT_OPERATION_API_KEY") || !workflow.includes("DATA_GO_KR_API_KEY") || !workflow.includes("YGPA_SERVICE_KEY") || workflow.includes("YGPA_ARRIVAL_API_KEY")) {
  throw new Error("Workflow public API secret coverage is incomplete");
}
const koreaCollector = fs.readFileSync("scripts/collectors/korea.js", "utf8");
const runtimeConfigAuditLib = fs.readFileSync("scripts/lib/runtime-config-audit.js", "utf8");
const sampleCollectorBlockers = [
  /MV HF ZHOUSHAN/.test(koreaCollector) ? "MV HF ZHOUSHAN marker in scripts/collectors/korea.js" : null,
  /MAERSK DEMO/.test(koreaCollector) ? "MAERSK DEMO marker in scripts/collectors/korea.js" : null,
  /YEOSU TARGET/.test(koreaCollector) ? "YEOSU TARGET marker in scripts/collectors/korea.js" : null,
  /function sampleRows/.test(koreaCollector) ? "function sampleRows in scripts/collectors/korea.js" : null,
  fs.existsSync("scripts/collectors/sample.js") ? "scripts/collectors/sample.js still exists" : null,
  fs.existsSync("scripts/collectors/busan.js") ? "scripts/collectors/busan.js still exists" : null
].filter(Boolean);
if (sampleCollectorBlockers.length) {
  throw new Error(`Sample/demo collectors and fallback vessels must be removed: ${sampleCollectorBlockers.join("; ")}`);
}
if (!(koreaCollector.includes("VsslEtrynd5/Info5") || runtimeConfigAuditLib.includes("VsslEtrynd5/Info5")) || !koreaCollector.includes("CargHarborUse2/Info")) {
  throw new Error("Collector must use VsslEtrynd5 parent records and CargHarborUse2 enrichment endpoint");
}
if (!koreaCollector.includes("PORT_OPERATION_API_URL") || !koreaCollector.includes("PORT_FACILITY_API_URL")) {
  throw new Error("Collector must allow env overrides for PORT_OPERATION_API_URL and PORT_FACILITY_API_URL");
}
for (const envMarker of ["PORT_OPERATION_API_KEY", "SERVICEKEY", "YGPA_SERVICE_KEY", "runtimeEnvDiagnostics", "COLLECTOR_DEBUG_ONLY"]) {
  if (!koreaCollector.includes(envMarker)) throw new Error(`Collector must debug env naming mismatch: ${envMarker}`);
}
if (/key:\s*["']port_facility["']/.test(koreaCollector)) {
  throw new Error("CargHarborUse2 must not be used as a standalone port_facility collector");
}
if (!koreaCollector.includes("prtAgCd") || !koreaCollector.includes("etryptYear") || !koreaCollector.includes("etryptCo") || !koreaCollector.includes("clsgn")) {
  throw new Error("CargHarborUse2 enrichment must use prtAgCd, etryptYear, etryptCo and clsgn parent keys");
}
for (const portCode of ["020", "030", "620", "820", "031", "810", "622", "070", "080", "621", "120", "940"]) {
  if (!koreaCollector.includes(`"${portCode}"`)) throw new Error(`Missing Korean port authority code: ${portCode}`);
}
for (const param of ["sde", "ede", "deGb", "numOfRows", "requested_url_without_service_key", "resultCode", "resultMsg", "totalCount", "http_status", "pages_attempted", "page_summaries"]) {
  if (!koreaCollector.includes(param)) throw new Error(`Missing PORT-MIS request/diagnostic field: ${param}`);
}
for (const param of ["raw_response_preview", "service_key_variant", "serviceKeyVariants", "COLLECTOR_DEBUG_VERBOSE"]) {
  if (!koreaCollector.includes(param)) throw new Error(`Missing PORT-MIS debug field: ${param}`);
}
if (!koreaCollector.includes("MAX_CHILD_ENRICHMENT_ROWS") || !koreaCollector.includes("MAX_PORTS_PER_RUN") || !koreaCollector.includes("MAX_API_RESPONSE_BYTES") || !koreaCollector.includes("skipped_by_limit")) {
  throw new Error("Collectors must enforce port, response-size, and child enrichment limits");
}
for (const marker of ["SOURCE_MAX_RETRIES", "isTransientCollectorError", "isPermanentCollectorError", "retry_count", "duration_ms", "rows_matched"]) {
  if (!koreaCollector.includes(marker)) throw new Error(`Collector reliability marker missing: ${marker}`);
}
if (!koreaCollector.includes("MAX_SOURCE_ROWS") || !koreaCollector.includes("COLLECTOR_RUNTIME_BUDGET_MS") || !koreaCollector.includes("ENABLE_SOURCE_CSV")) {
  throw new Error("Collector must bound per-source rows, runtime, and optional CSV ingestion");
}
if (!koreaCollector.includes("PORT_OPERATION_NUM_OF_ROWS") || !koreaCollector.includes('"50"') || !koreaCollector.includes("PORT_OPERATION_MAX_PAGES") || !koreaCollector.includes("PORT_OPERATION_DEGB_VALUES") || !koreaCollector.includes("addDaysCompact(-3)") || !koreaCollector.includes("addDaysCompact(7)") || !koreaCollector.includes("grtg") || !koreaCollector.includes("intrlGrtg")) {
  throw new Error("Port Operation collector must support official-safe 50-row paging");
}
if (!koreaCollector.includes("noTypeParam")) {
  throw new Error("PORT-MIS XML-capable APIs must not force _type=json");
}
const secretsFile = fs.readFileSync("scripts/lib/secrets.js", "utf8");
if (!secretsFile.includes("SOURCE_CSV_URL") || !secretsFile.includes("YGPA_SERVICE_KEY")) {
  throw new Error("Secret catalog must include SOURCE_CSV_URL and the explicitly supported Port Operation aliases");
}
if (/git push origin HEAD:main|git commit -m "auto: refresh/.test(workflow)) {
  throw new Error("Longterm workflow must not auto-commit generated files to main");
}
if (!workflow.includes("npx wrangler deploy") || !workflow.includes("CLOUDFLARE_API_TOKEN") || !workflow.includes("CLOUDFLARE_ACCOUNT_ID")) {
  throw new Error("Workflow must deploy the Cloudflare Worker with Cloudflare GitHub secrets");
}
if (!workflow.includes("./api.cloudflare-upload-full") || !workflow.includes("copy_api_asset") || !workflow.includes("bootstrap.json") || !workflow.includes("vessels/page-*.json")) {
  throw new Error("Cloudflare deploy must include the latest lightweight dashboard snapshot assets");
}
const assetsIgnore = fs.existsSync(".assetsignore") ? fs.readFileSync(".assetsignore", "utf8") : "";
if (assetsIgnore.includes("dashboard/api/**") || assetsIgnore.includes("api/**")) {
  throw new Error("Cloudflare assets ignore must allow selected dashboard API snapshot assets");
}

const wrangler = JSON.parse(fs.readFileSync("wrangler.jsonc", "utf8"));
if (wrangler.assets?.directory !== "./dashboard" || wrangler.assets?.binding !== "ASSETS") {
  throw new Error("Cloudflare Workers assets must point to ./dashboard with ASSETS binding");
}
if (!Array.isArray(wrangler.assets?.run_worker_first) || !wrangler.assets.run_worker_first.includes("/api/*")) {
  throw new Error("Cloudflare Worker must run before static assets for /api/* routes");
}
const worker = fs.readFileSync("src/worker.js", "utf8");
if (!worker.includes("vessel_snapshots") || !worker.includes("SUPABASE_URL") || !worker.includes("env.ASSETS.fetch")) {
  throw new Error("Worker must serve dashboard assets and live Supabase API routes");
}
if (!worker.includes("PORT_REGISTRY_SOURCE") || !worker.includes("data/reference/ports_registry.csv") || !worker.includes("PORT_REGISTRY_GENERATED_FROM_CSV")) {
  throw new Error("Worker port registry must be marked as generated from ports_registry.csv");
}
if (!worker.includes("cumulative_stay_hours") || !worker.includes("CUMULATIVE_STAY_90D_PLUS")) {
  throw new Error("Worker must preserve cumulative stay beyond short port-call windows");
}
for (const route of ["/dashboard-summary.json", "/api/vessels/", "pageRows", "/candidates/top.json", "/ports.json", "/candidates.json", "/hot-candidates.json", "/target-vessels.json", "/staying-vessels.json", "/arrival-pipeline.json", "/predicted-arrivals.json", "/lead-pipeline.json", "/alert-candidates.json", "/imo-recovery-queue.json", "/high-value-targets.json", "/review/unknown-gt.json", "/review/high-value-low-confidence.json", "/review/congestion-watchlist.json", "target-vessels|staying-vessels|arrivals", "/api/ports/", "congestion", "anchorage", "/master/unknown-imo.json", "/api/history/ports.json", "/api/history/operators.json", "/api/history/routes.json", "/api/history/opportunities.json", "/api/health/pipeline.json", "/api/config-status.json", "active_dataset_pointer"]) {
  if (!worker.includes(route)) throw new Error(`Worker missing port-first API route marker: ${route}`);
}
for (const marker of ["/all-collected-vessels.json", "/target-vessels.json", "group\") || \"target\"", "vesselGroupRows(allRecords, group)"]) {
  if (!worker.includes(marker)) throw new Error(`Worker missing vessel group API marker: ${marker}`);
}
for (const marker of ["data_source_used", "supabase_active_dataset", "local_static_snapshot", "diagnostics_only_no_live_data", "fallback_used", "fallback_reason"]) {
  if (!worker.includes(marker)) throw new Error(`Worker missing production data source marker: ${marker}`);
}
if (!workflow.includes("VALIDATION_MODE: production")) {
  throw new Error("Longterm workflow must run validation in production mode");
}
for (const marker of ["buildConfigStatus", "missing_required_config", "enabled_sources", "enabled_ports_count", "active_runtime_limits"]) {
  if (!worker.includes(marker)) throw new Error(`Worker config status missing marker: ${marker}`);
}
for (const marker of ["validation_mode", "serving_mode", "production_data_source", "worker_supabase_available"]) {
  if (!worker.includes(marker)) throw new Error(`Worker config status missing production-readiness marker: ${marker}`);
}
const referenceDictionaries = fs.readFileSync("scripts/lib/reference-dictionaries.js", "utf8");
for (const marker of ["classifyAnchorage", "classifyBerth", "normalizeVesselType", "\\uB0A8\\uC678\\uD56D", "ANCH", "O A", "bulk_carrier", "pctc", "vesselMasterSeed", "berthAliases", "terminalAliases"]) {
  if (!referenceDictionaries.includes(marker)) throw new Error(`Reference dictionary enrichment missing marker: ${marker}`);
}
const gdriveLib = fs.readFileSync("scripts/lib/gdrive.js", "utf8");
if (!gdriveLib.includes("supportsAllDrives=true") || !gdriveLib.includes("normalizeFolderId") || !gdriveLib.includes("Buffer.from(value, \"base64\")") || !gdriveLib.includes("buildRawArchivePayload") || !gdriveLib.includes("external_raw_archive")) {
  throw new Error("Google Drive archive helper must support shared drives, folder URLs, and base64 service account secrets");
}
const dbLib = fs.readFileSync("scripts/lib/db.js", "utf8");
if (!dbLib.includes("SUPABASE_BATCH_SIZE") || !dbLib.includes("batchSize")) {
  throw new Error("Supabase writes must be batched to avoid long single upserts");
}
for (const marker of ["validation_mode", "no_live_data_not_promotable"]) {
  if (!dbLib.includes(marker)) throw new Error(`Supabase promotion validation missing marker: ${marker}`);
}
const updateScript = fs.readFileSync("scripts/update.js", "utf8");
for (const marker of ["PIPELINE_STAGES", "sourceOfTruthTables", "config_diagnostics", "validateRequiredConfig", "candidate_threshold_used", "source_rows_collected", "source_rows_matched", "enrichment_match_rate", "db_rows_written_by_table", "retention_rows_deleted_by_table"]) {
  if (!updateScript.includes(marker) && !dbLib.includes(marker)) throw new Error(`Backend architecture diagnostics missing marker: ${marker}`);
}
const configLib = fs.readFileSync("scripts/lib/config.js", "utf8");
for (const marker of ["REQUIRED_ENV_VARS", "PORT_OPERATION_SERVICE_KEY", "PORT_OPERATION_API_URL", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "loadPortsRegistry", "configDiagnostics", "validateRequiredConfig", "active_runtime_limits", "enabled_enrichment_sources"]) {
  if (!configLib.includes(marker)) throw new Error(`Central config loader missing marker: ${marker}`);
}
for (const marker of ["validation_mode", "serving_mode", "production_data_source"]) {
  if (!configLib.includes(marker)) throw new Error(`Central config diagnostics missing serving-mode marker: ${marker}`);
}
const scoreScript = fs.readFileSync("scripts/score.js", "utf8");
if (!scoreScript.includes("Legacy compatibility shim") || !scoreScript.includes("commercial_value_score")) {
  throw new Error("scripts/score.js must be a legacy shim and must not define a competing scoring engine");
}
for (const moduleFile of ["collection.js", "normalization.js", "enrichment.js", "scoring.js", "prediction.js", "persistence.js", "reporting.js", "index.js"]) {
  if (!fs.existsSync(`scripts/pipeline/${moduleFile}`)) throw new Error(`Missing pipeline module: ${moduleFile}`);
}
if (!dbLib.includes('.from("vessel_snapshots")') || !dbLib.includes('onConflict: "snapshot_uid"') || dbLib.includes("onConflict: \"snapshot_date,vessel_id,port\"")) {
  throw new Error("Supabase vessel_snapshots must use idempotent snapshot_uid upserts, not latest-state overwrite keys");
}
const requiredPersistenceTables = ["vessel_entities", "risk_history", "vessel_events", "data_collection_runs", "active_dataset_pointer", "dashboard_summary_snapshots", "sales_candidates_current", "immediate_targets_current", "port_summary_current", "source_collection_logs", "port_call_master", "opportunity_master", "vessel_snapshot_daily", "port_snapshot_daily", "operator_snapshot_daily", "route_snapshot_daily", "commercial_opportunity_daily", "raw_archive_index", "enrichment_match_candidates", "commercial_leads", "feature_store", "feature_snapshots", "rule_evaluations", "model_training_rows"];
const missingPersistenceTables = requiredPersistenceTables.filter(table => !dbLib.includes(`.from("${table}")`) && !dbLib.includes(`"${table}",`));
if (missingPersistenceTables.length) {
  throw new Error("Supabase persistence must update collection runs, active pointer, vessel_entities, risk_history, and vessel_events");
}
for (const marker of ["PORT_ARRIVAL", "PILOT_INBOUND", "BERTH_ASSIGNED", "ANCHORAGE_START", "ANCHORAGE_END", "LONG_STAY_DETECTED", "CONGESTION_DETECTED", "PILOT_OUTBOUND", "PORT_DEPARTURE"]) {
  if (!dbLib.includes(marker)) throw new Error(`Event intelligence layer missing marker: ${marker}`);
}
const schema = fs.readFileSync("supabase/schema.sql", "utf8");
for (const marker of ["data_collection_runs", "active_dataset_pointer", "dashboard_summary_snapshots", "sales_candidates_current", "immediate_targets_current", "port_summary_current", "is_latest_successful", "source_collection_logs", "source_log_id", "snapshot_uid", "port_call_master", "opportunity_master", "vessel_snapshot_daily", "port_snapshot_daily", "operator_snapshot_daily", "route_snapshot_daily", "commercial_opportunity_daily", "raw_archive_index", "historical_snapshot_generation_status", "daily_snapshot_rows_written", "vessel_snapshot_daily_rows_written", "port_snapshot_daily_rows_written", "operator_snapshot_daily_rows_written", "route_snapshot_daily_rows_written", "commercial_opportunity_daily_rows_written", "duplicate_snapshot_rows_skipped", "raw_payloads_archived_to_gdrive", "raw_payloads_db_insert_blocked", "ais_raw_rows_skipped", "event_rows_written", "event_duplicates_skipped", "estimated_db_growth_per_day", "estimated_db_growth_per_year", "opportunity_state", "identified", "qualified", "contact_ready", "contacted", "quoted", "scheduled", "won", "lost", "vessel_master", "vessel_aliases", "vessel_identity_candidates", "vessel_entities", "vessel_events", "risk_history", "port_congestion_snapshots", "anchorage_clusters", "berth_occupancy_history", "route_patterns", "vessel_route_history", "predicted_arrivals", "enrichment_match_candidates", "commercial_leads", "operator_master", "agent_master", "contact_master", "operator_contact_history", "operator_fleet_opportunities", "agent_operator_links", "berth_aliases", "terminal_aliases", "feature_store", "feature_snapshots", "feature_snapshot_id", "port_call_feature_snapshot_v1", "model_ready_port_call", "operator_score", "route_graph_edges", "operator_graph_edges", "rule_evaluations", "explainability_snapshots", "score_components", "score_reasons", "why_scored_high", "model_training_rows", "event_uid", "port_call_id", "previous_snapshot", "feature_namespace", "feature_version", "rule_id", "rule_version", "rule_versions", "rule_group", "feature_contributions", "leakage_guard", "payload jsonb", "hybrid_entity_key", "run_id", "master_vessel_id", "commercial_value_score", "data_confidence_score", "gt_source", "eta_source", "operator_source", "congestion_source", "score_source", "lead_status", "auto_lead_created", "lead_created_reason", "contact_path_status", "contact_priority", "contact_path_label_ko", "contact_readiness_score", "last_contacted_at", "follow_up_due", "quote_status", "notes", "lead_priority_score", "why_now", "candidate_summary_ko", "recommended_action", "action_priority", "recommended_contact_path", "recommended_department", "recommended_email_draft", "recommended_followup_date", "prediction_error_hours", "alert_candidate", "predicted_congestion_score", "anchorage_probability", "predicted_work_window_hours", "biofouling_exposure_score", "biofouling_exposure_band", "biofouling_exposure_reasons", "predicted_cleaning_opportunity_score", "cleaning_opportunity_band", "opportunity_summary", "repeat_caller_score", "repeat_operator_score", "fleet_opportunity_score", "fleet_cleaning_probability", "fleet_cleaning_probability_band", "forecast_window_days", "fleet_alert", "average_biofouling_exposure", "average_congestion_exposure", "target_vessels_count", "validation_status", "drop constraint if exists vessel_snapshots_snapshot_date_vessel_id_port_key"]) {
  if (!schema.includes(marker)) throw new Error(`Supabase schema missing historical persistence marker: ${marker}`);
}
for (const file of ["data/reference/ports.csv", "data/reference/berths.csv", "data/reference/berth_aliases.csv", "data/reference/terminal_aliases.csv", "data/reference/anchorages.csv", "data/reference/vessel_types.csv", "data/reference/operators.csv", "data/reference/agents.csv", "data/reference/agent_operator_mapping.csv", "data/reference/vessel_master_seed.csv"]) {
  if (!fs.existsSync(file)) throw new Error(`Missing CSV reference dictionary: ${file}`);
}
for (const file of [
  "docs/data-contract.md",
  "docs/data-dictionary.md",
  "docs/platform-safeguards.md",
  "docs/release-checklist.md",
  "docs/runbook.md",
  "docs/troubleshooting.md",
  "migrations/README.md",
  "migrations/20260531_001_foundation_safeguards.sql",
  "migrations/20260531_002_lineage_and_guardrails.sql",
  "tests/regression-tests.js",
  "tests/fixtures/port-operation-sample.json",
  "tests/fixtures/pilot-schedule-sample.json",
  "tests/fixtures/pnc-berth-sample.html",
  "tests/fixtures/ulsan-berth-cargo-sample.json"
]) {
  if (!fs.existsSync(file)) throw new Error(`Missing foundation safeguard file: ${file}`);
}
const dataContract = fs.readFileSync("docs/data-contract.md", "utf8");
for (const marker of ["run_id", "active_run_id", "generated_at", "data_source_used", "fallback_used", "fallback_reason", "data_freshness", "record_count", "port_call_id", "master_vessel_id", "vessel_name", "port_code", "port_name", "candidate_band", "commercial_value_score", "data_confidence_score"]) {
  if (!dataContract.includes(marker)) throw new Error(`Data contract missing required field marker: ${marker}`);
}
const dataDictionary = fs.readFileSync("docs/data-dictionary.md", "utf8");
for (const marker of ["vessel_master", "port_call_master", "vessel_snapshots", "active_dataset_pointer", "gt_source", "eta_source", "operator_source", "congestion_source", "score_source", "fatal", "degraded", "warning", "allowed_missing", "MAX_PORTS_PER_RUN", "MAX_IMO_RECOVERY_CALLS", "MAX_API_RESPONSE_BYTES"]) {
  if (!dataDictionary.includes(marker)) throw new Error(`Data dictionary missing safeguard marker: ${marker}`);
}
const platformSafeguards = fs.readFileSync("docs/platform-safeguards.md", "utf8");
for (const marker of ["Single Source of Truth", "Idempotency", "Run ID Discipline", "Backfill and Reprocess", "Access Control Preparation"]) {
  if (!platformSafeguards.includes(marker)) throw new Error(`Platform safeguards missing section: ${marker}`);
}
const releaseChecklist = fs.readFileSync("docs/release-checklist.md", "utf8");
for (const marker of ["backend-doctor", "all_vessels_count", "target_ratio", "no_live_data", "active_dataset_pointer"]) {
  if (!releaseChecklist.includes(marker)) throw new Error(`Release checklist missing marker: ${marker}`);
}
const troubleshooting = fs.readFileSync("docs/troubleshooting.md", "utf8");
for (const marker of ["Empty Dashboard", "Missing Config", "Target Count Mismatch", "Stale Data", "Export Issues"]) {
  if (!troubleshooting.includes(marker)) throw new Error(`Troubleshooting guide missing marker: ${marker}`);
}
const migrationFiles = fs.readdirSync("migrations").filter(file => /\.sql$/i.test(file));
if (migrationFiles.length < 1) {
  throw new Error("Schema migration discipline requires at least one versioned SQL file in migrations/.");
}
const regressionScript = fs.readFileSync("tests/regression-tests.js", "utf8");
for (const marker of ["all_vessels_count must be > 0", "port_call_id coverage must be > 80%", "Duplicate port_call_id", "target_ratio > 30%", "Summary target count must match target-vessels output count", "backend-doctor must fail empty datasets", "no_live_data must not be treated as production-ready"]) {
  if (!regressionScript.includes(marker)) throw new Error(`Regression test missing marker: ${marker}`);
}
const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));
if (packageJson.scripts?.reprocess !== "node scripts/reprocess.js" || !fs.existsSync("scripts/reprocess.js")) {
  throw new Error("Replay/reprocess mode must be available as npm run reprocess");
}
if (packageJson.scripts?.["test:regression"] !== "node tests/regression-tests.js") {
  throw new Error("Regression tests must be available as npm run test:regression");
}
const auditDataScript = packageJson.scripts?.["audit:data"] || "";
if (!auditDataScript.includes("scripts/audit-data-health.js") || !fs.existsSync("scripts/audit-data-health.js")) {
  throw new Error("Data health audit must be available as npm run audit:data");
}
if (packageJson.scripts?.["gdrive:check"] && !fs.existsSync("scripts/gdrive-check.js")) {
  throw new Error("Google Drive check script is registered but scripts/gdrive-check.js is missing");
}
if (packageJson.scripts?.["daily:enrich"] !== "node scripts/daily-enrichment.js" || !fs.existsSync("scripts/daily-enrichment.js")) {
  throw new Error("Daily enrichment script must be registered as npm run daily:enrich");
}
const dailyEnrichmentScript = fs.readFileSync("scripts/daily-enrichment.js", "utf8");
for (const marker of ["DAILY_ENRICHMENT_LIMIT", "MATCH_TIME_WINDOW_HOURS", "enrichWithVesselMasterCache", "enrichment_match_candidates", "imo_recovery_queue", "vessel_identity_candidates", "daily_critical_info_enrichment", "historical_match_reused"]) {
  if (!dailyEnrichmentScript.includes(marker)) throw new Error(`Daily enrichment script missing marker: ${marker}`);
}
const dailyEnrichmentWorkflow = fs.readFileSync(".github/workflows/daily-enrichment.yml", "utf8");
for (const marker of ["name: Daily Critical Enrichment", "workflow_dispatch", "cron: \"0 15 * * *\"", "runs-on: ubuntu-latest", "timeout-minutes: 15", "npm run daily:enrich", "DAILY_ENRICHMENT_LIMIT", "MATCH_TIME_WINDOW_HOURS"]) {
  if (!dailyEnrichmentWorkflow.includes(marker)) throw new Error(`Daily enrichment workflow missing marker: ${marker}`);
}
const healthWorkflow = fs.readFileSync(".github/workflows/actions-health-check.yml", "utf8");
if (!healthWorkflow.includes("runs-on: ubuntu-latest") || !healthWorkflow.includes("workflow_dispatch") || !healthWorkflow.includes("timeout-minutes: 3")) {
  throw new Error("Actions health-check workflow is incomplete");
}
const pushSmokeWorkflow = fs.readFileSync(".github/workflows/push-smoke-test.yml", "utf8");
if (!pushSmokeWorkflow.includes("name: Push Smoke Test") || !pushSmokeWorkflow.includes("push:") || !pushSmokeWorkflow.includes("runs-on: ubuntu-latest")) {
  throw new Error("Push smoke test workflow is incomplete");
}

for (const warning of validationWarnings) {
  console.warn(`[HWK] ${warning}`);
}
console.log(`[HWK] validation success (${validationMode})`);

