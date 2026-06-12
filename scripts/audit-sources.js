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
const sourceHealthRuntime = readJson("dashboard/api/source-health-runtime.json", null);
const sourceCollectionStatus = readJson("dashboard/api/source-collection-status.json", null);
const sourceHealthLocal = readJson("dashboard/api/debug/source-health-local.json", null);
const sourceCollectionStatusLocal = readJson("dashboard/api/debug/source-collection-status-local.json", null);
const isGithubActionsRuntime = process.env.GITHUB_ACTIONS === "true" || Boolean(process.env.GITHUB_RUN_ID || process.env.GITHUB_WORKFLOW);
const selectedSourceCollectionStatus = !isGithubActionsRuntime && sourceCollectionStatusLocal?.items
  ? sourceCollectionStatusLocal
  : sourceCollectionStatus;
const payload = selectedSourceCollectionStatus?.items
  ? selectedSourceCollectionStatus
  : buildSourceCollectionStatus({
    report: status,
    collectorDiagnostics: status.collector_diagnostics || {},
    generatedAt: new Date().toISOString()
  });
const sourceItems = payload.items || [];
const activeSources = payload.active_sources || sourceItems.filter(item => item.status === "ACTIVE").map(item => item.source_key);
const notConfiguredSources = payload.not_configured_sources || sourceItems.filter(item => item.status === "NOT_CONFIGURED").map(item => item.source_key);
const partialSources = payload.partial_sources || sourceItems.filter(item => item.status === "PARTIAL").map(item => item.source_key);
const failedSources = payload.failed_sources || sourceItems.filter(item => ["FETCH_FAILED", "PARSE_FAILED"].includes(item.status)).map(item => item.source_key);
const rowsCollectedBySource = payload.rows_collected_by_source || Object.fromEntries(sourceItems.map(item => [
  item.source_key,
  Number(item.rows_collected || 0)
]));

console.log("Source Configuration and Activation Audit");
console.log("=========================================");
console.log(`run_id=${payload.run_id || "unknown"}`);
console.log(`generated_at=${payload.generated_at || "unknown"}`);
console.log(`record_count=${payload.record_count || 0}`);
console.log(`status_counts=${JSON.stringify(payload.status_counts || {})}`);
console.log(`active_sources=${activeSources.join(",") || "-"}`);
console.log(`not_configured_sources=${notConfiguredSources.join(",") || "-"}`);
console.log(`partial_sources=${partialSources.join(",") || "-"}`);
console.log(`failed_sources=${failedSources.join(",") || "-"}`);
console.log(`rows_collected_by_source=${JSON.stringify(rowsCollectedBySource)}`);
if (payload.generated_by === "local" || sourceHealthLocal?.generated_by === "local" || sourceHealthLocal?.is_github_actions === false) {
  console.log("WARN: This diagnostic was generated locally and may not reflect GitHub Actions secrets.");
}
if (sourceHealthRuntime?.generated_by === "local" || sourceHealthRuntime?.is_github_actions === false) {
  console.log("WARN: Repo source diagnostics may not reflect GitHub Actions secrets. Check hwk-generated-snapshot artifact.");
}
if (isGithubActionsRuntime) {
  const provenanceProblems = [];
  for (const [label, diagnostic] of [
    ["source-health-runtime.json", sourceHealthRuntime],
    ["source-collection-status.json", sourceCollectionStatus]
  ]) {
    if (!diagnostic || diagnostic.__parse_error) {
      provenanceProblems.push(`${label} missing_or_invalid`);
      continue;
    }
    if (diagnostic.generated_by !== "github_actions") provenanceProblems.push(`${label} generated_by=${diagnostic.generated_by || "missing"}`);
    if (diagnostic.is_github_actions !== true) provenanceProblems.push(`${label} is_github_actions=${diagnostic.is_github_actions}`);
    if (!diagnostic.GITHUB_RUN_ID) provenanceProblems.push(`${label} missing GITHUB_RUN_ID`);
    if (!diagnostic.GITHUB_WORKFLOW) provenanceProblems.push(`${label} missing GITHUB_WORKFLOW`);
  }
  if (provenanceProblems.length) {
    console.error(`ERROR: GitHub Actions source diagnostics provenance invalid: ${provenanceProblems.join("; ")}`);
    process.exitCode = 1;
  }
}
console.log("");
console.log("Source | Status | Env Present | Missing Env | Attempted | Rows | Skip Reason | Fix");
for (const item of sourceItems) {
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
for (const item of sourceItems) {
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

const problemCount = sourceItems.filter(item => !["ACTIVE", "NOT_CONFIGURED"].includes(item.status)).length;
if (problemCount > 0) {
  console.log("");
  console.log(`WARN: ${problemCount} configured or partially configured source(s) need action.`);
}
