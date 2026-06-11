import fs from "node:fs";
import path from "node:path";
import { buildSourceCollectionStatus } from "./lib/source-activation.js";

const ROOT = process.cwd();

function readJson(relativePath, fallback = {}) {
  const filePath = path.join(ROOT, relativePath);
  try {
    return fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, "utf8")) : fallback;
  } catch (error) {
    return { __parse_error: error.message };
  }
}

const status = readJson("dashboard/api/status.json", {});
const sourceCollectionStatus = readJson("dashboard/api/source-collection-status.json", null);
const sourceHealthLocal = readJson("dashboard/api/debug/source-health-local.json", null);
const payload = sourceCollectionStatus?.items
  ? sourceCollectionStatus
  : buildSourceCollectionStatus({
    report: status,
    collectorDiagnostics: status.collector_diagnostics || {},
    generatedAt: new Date().toISOString()
  });

console.log("Source Configuration and Activation Audit");
console.log("=========================================");
console.log(`run_id=${payload.run_id || "unknown"}`);
console.log(`generated_at=${payload.generated_at || "unknown"}`);
console.log(`record_count=${payload.record_count || 0}`);
console.log(`status_counts=${JSON.stringify(payload.status_counts || {})}`);
if (payload.generated_by === "local" || sourceHealthLocal?.generated_by === "local" || sourceHealthLocal?.is_github_actions === false) {
  console.log("WARN: This diagnostic was generated locally and may not reflect GitHub Actions secrets.");
}
console.log("");
console.log("Source | Status | Env Present | Missing Env | Attempted | Rows | Skip Reason | Fix");
for (const item of payload.items || []) {
  console.log([
    item.source_key,
    item.status,
    (item.present_env || []).join(",") || "-",
    (item.missing_env || []).join(",") || "-",
    item.collector_attempted ? "yes" : "no",
    Number(item.rows_collected || 0),
    item.skip_reason || "-",
    item.exact_fix_instruction || item.fix_hint || "-"
  ].join(" | "));
}

console.log("");
console.log("Detailed env diagnostics");
for (const item of payload.items || []) {
  console.log(`\n[${item.source_key}] ${item.source_label}`);
  console.log(`expected_env_names=${(item.expected_env_names || []).join(",") || "-"}`);
  console.log(`present_env=${(item.present_env || []).join(",") || "-"}`);
  console.log(`missing_env=${(item.missing_env || []).join(",") || "-"}`);
  console.log(`value_source=${item.value_source || "unknown"}`);
  console.log(`collector_enabled=${item.collector_enabled ? "yes" : "no"}`);
  console.log(`collector_attempted=${item.collector_attempted ? "yes" : "no"}`);
  console.log(`skip_reason=${item.skip_reason || "-"}`);
  console.log(`business_impact=${item.business_impact || "-"}`);
  console.log(`fix_hint=${item.exact_fix_instruction || item.fix_hint || "-"}`);
}

const problemCount = (payload.items || []).filter(item => !["ACTIVE", "NOT_CONFIGURED"].includes(item.status)).length;
if (problemCount > 0) {
  console.log("");
  console.log(`WARN: ${problemCount} configured or partially configured source(s) need action.`);
}
