import fs from "node:fs";

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

const status = readJson("dashboard/api/status.json", {});
const previousRuntime = readJson("dashboard/api/source-health-runtime.json", null);
const diagnostics = status.collector_diagnostics || {};
const sources = Array.isArray(diagnostics.sources) ? diagnostics.sources : [];
const configured = tracked.filter(key => Boolean(process.env[key]));
const enabledCollectors = [...new Set(sources.map(source => source.key || source.source_name).filter(Boolean))];
const attemptedCollectors = sources.filter(source => source.attempted).map(source => source.key || source.source_name);
const skippedCollectors = sources.filter(source => source.skipped).map(source => ({
  source_name: source.key || source.source_name || source.label || "unknown_source",
  reason: source.reason || source.error_message || source.status || "skipped"
}));
const statusRunId = status.run_id || status.active_run_id || status.summary_run_id || null;
const staleSourceHealth = Boolean(previousRuntime?.run_id && statusRunId && String(previousRuntime.run_id) !== String(statusRunId));

const report = {
  version: "17.7.0",
  run_id: statusRunId,
  status_run_id: statusRunId,
  generated_at: new Date().toISOString(),
  status_generated_at: status.completed_at || status.generated_at || null,
  stale_source_health: staleSourceHealth,
  previous_source_health_run_id: previousRuntime?.run_id || null,
  tracked: tracked.length,
  configured: configured.length,
  secrets_present: Object.fromEntries(tracked.map(key => [key, Boolean(process.env[key])])),
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
    secret_present: Boolean(process.env.PORT_OPERATION_SERVICE_KEY),
    api_url_present: Boolean(process.env.PORT_OPERATION_API_URL),
    api_url_effective: Boolean(diagnostics.port_operation_collection_plan?.port_operation_api_url_effective),
    enabled_ports_loaded_count: Number(diagnostics.port_operation_collection_plan?.enabled_ports_loaded_count || 0),
    enabled_ports_passed_to_collector_count: Number(diagnostics.port_operation_collection_plan?.enabled_ports_passed_to_collector_count || 0),
    ports_attempted_count: Number(diagnostics.coverage?.ports_attempted_count || diagnostics.ports_attempted_count || 0),
    ports_skipped_reason: diagnostics.port_operation_collection_plan?.ports_skipped_reason || null,
    first_5_ports_to_attempt: diagnostics.port_operation_collection_plan?.first_5_ports_to_attempt || []
  },
  realDataReady: Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY && Number(status.record_count || 0) > 0),
  note: "Current-run source health. If run_id differs from status.json, treat this file as stale."
};

fs.mkdirSync("dashboard/api", { recursive: true });
fs.mkdirSync("data", { recursive: true });
const registryReport = {
  version: "17.7.0",
  run_id: statusRunId,
  generated_at: report.generated_at,
  mode: "readiness_registry",
  required_for_real_data: ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"],
  recommended_public_data: ["MOF_AIS_DYNAMIC_SERVICE_KEY", "MOF_VTS_SERVICE_KEY", "PORT_OPERATION_SERVICE_KEY", "VESSEL_SPEC_SERVICE_KEY"],
  optional_enrichment: ["GDRIVE_SERVICE_ACCOUNT_JSON", "GDRIVE_FOLDER_ID", "PILOT_SOURCE_URLS", "BERTH_SOURCE_URLS", "SOURCE_CSV_URL"],
  secret_names_tracked: tracked,
  paid_ais_policy: "MarineTraffic and VesselFinder are not required for the current public-data-first backend."
};
fs.writeFileSync("dashboard/api/source-health-runtime.json", JSON.stringify(report, null, 2));
fs.writeFileSync("dashboard/api/source-health.json", JSON.stringify(registryReport, null, 2));
fs.writeFileSync("data/source-health.json", JSON.stringify(registryReport, null, 2));
console.log("Source health generated");
