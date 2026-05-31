import fs from "node:fs";
import { buildRunOrigin } from "./lib/runtime-config-audit.js";

function readJson(path, fallback = {}) {
  try {
    return fs.existsSync(path) ? JSON.parse(fs.readFileSync(path, "utf8")) : fallback;
  } catch {
    return fallback;
  }
}

const status = readJson("dashboard/api/status.json", {});
const validationMode = String(process.env.VALIDATION_MODE || status.validation_mode || (process.env.CI === "true" ? "production" : "local")).toLowerCase();
const statusRunId = status.run_id || status.active_run_id || status.summary_run_id || null;
const runOrigin = buildRunOrigin({
  runId: statusRunId,
  validationMode,
  servingMode: "placeholder_diagnostics"
});
const generatedAt = new Date().toISOString();
const report = {
  ...runOrigin,
  version: "17.7.0",
  generated_at: generatedAt,
  generatedAt,
  status_run_id: statusRunId,
  active_run_id: status.active_run_id || statusRunId,
  stale_diagnostic: false,
  placeholder: true,
  mode: "placeholder_until_history",
  status: "placeholder",
  categories: ["new_candidate","tier_upgraded","score_jump_10plus","port_changed","stale_candidate","candidate_removed"],
  ok: false,
  note: "Placeholder only. Do not use this file as runtime truth until historical snapshot comparison is implemented."
};
fs.mkdirSync("dashboard/api", { recursive: true });
fs.writeFileSync("dashboard/api/snapshot-diff-runtime.json", JSON.stringify(report, null, 2));
console.log("Snapshot diff generated");
