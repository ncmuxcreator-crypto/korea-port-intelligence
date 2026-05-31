import fs from "node:fs";
import { buildRunOrigin } from "./lib/runtime-config-audit.js";

function readJson(path, fallback = {}) {
  try {
    return fs.existsSync(path) ? JSON.parse(fs.readFileSync(path, "utf8")) : fallback;
  } catch {
    return fallback;
  }
}

const mainStatus = readJson("dashboard/api/status.json", {});
const debugStatus = readJson("dashboard/api/debug/status.json", null);
const validationMode = String(process.env.VALIDATION_MODE || mainStatus.validation_mode || debugStatus?.validation_mode || (process.env.CI === "true" ? "production" : "local")).toLowerCase();
const status = validationMode === "production" ? mainStatus : (debugStatus || mainStatus);
const statusRunId = status.run_id || status.active_run_id || status.summary_run_id || null;
const runOrigin = buildRunOrigin({
  runId: statusRunId,
  validationMode,
  servingMode: status.output_mode || status.serving_mode || (status.data_mode === "no_live_data" ? "debug_diagnostics_only" : "production_api")
});
const generatedAt = new Date().toISOString();

const plan = {
  ...runOrigin,
  version: "17.7.0",
  generated_at: generatedAt,
  generatedAt,
  status_run_id: statusRunId,
  active_run_id: status.active_run_id || statusRunId,
  stale_diagnostic: false,
  placeholder: false,
  status: "ready",
  validation_mode: validationMode,
  sequence: ["source_health","vessel_spec","port_operation","mof_ais_dynamic","candidate_engine","snapshot_guard"],
  target: "fast cleaning candidate detection",
  port_operation_collector_enabled: Boolean(status.collector_diagnostics?.port_operation_collection_plan?.port_operation_collector_enabled),
  port_operation_service_key_present: Boolean(status.collector_diagnostics?.port_operation_collection_plan?.port_operation_secret_present),
  port_operation_api_url_present: Boolean(status.collector_diagnostics?.port_operation_collection_plan?.port_operation_api_url_present),
  port_operation_api_url_effective: Boolean(status.collector_diagnostics?.port_operation_collection_plan?.port_operation_api_url_effective),
  enabled_ports_loaded_count: Number(status.collector_diagnostics?.port_operation_collection_plan?.enabled_ports_loaded_count || 0),
  ports_attempted_count: Number(status.collector_diagnostics?.coverage?.ports_attempted_count || status.collector_diagnostics?.ports_attempted_count || 0),
  preflight_failure_reason: status.preflight_failure_reason || status.collector_diagnostics?.preflight_failure_reason || null
};
fs.mkdirSync("dashboard/api",{recursive:true});
fs.writeFileSync("dashboard/api/collector-plan-runtime.json", JSON.stringify(plan,null,2));
console.log("Collector plan generated");
