import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

const REQUIRED_FILES = [
  "dashboard/api/bootstrap.json",
  "dashboard/api/status-summary.json",
  "dashboard/api/runtime/update-tiers.json",
  "dashboard/api/runtime-budget-report.json",
  "dashboard/api/aux/latest/index.json",
  "dashboard/api/enrichment/latest/index.json",
  "dashboard/api/enrichment/latest/patches.json"
];

const DEPLOY_REQUIRED = [
  "aux/latest/index.json",
  "aux/latest/pilotage-summary.json",
  "aux/latest/berth-summary.json",
  "aux/latest/ais-info-summary.json",
  "aux/latest/ais-dynamic-summary.json",
  "aux/latest/vessel-spec-summary.json",
  "aux/latest/cache-status.json",
  "aux/source-csv-summary.json",
  "enrichment/latest/index.json",
  "enrichment/latest/summary.json",
  "enrichment/latest/patches.json",
  "enrichment/latest/review-queue.json",
  "enrichment/summary.json",
  "enrichment/review-queue.json",
  "source-quality-score.json",
  "enrichment-utilization.json",
  "runtime/update-tiers.json",
  "runtime-budget-report.json"
];

function readJson(relativePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), "utf8"));
  } catch {
    return fallback;
  }
}

function ageHours(generatedAt) {
  if (!generatedAt) return null;
  const age = (Date.now() - Date.parse(generatedAt)) / 36e5;
  return Number.isFinite(age) ? Math.max(0, Math.round(age * 10) / 10) : null;
}

function fileStatus(relativePath) {
  const fullPath = path.join(ROOT, relativePath);
  if (!fs.existsSync(fullPath)) return { path: relativePath, exists: false, generated_at: null, age_hours: null };
  const payload = readJson(relativePath, {});
  return {
    path: relativePath,
    exists: true,
    generated_at: payload.generated_at || null,
    age_hours: ageHours(payload.generated_at),
    stale: Boolean(payload.stale_diagnostic),
    record_count: Number(payload.record_count || 0),
    item_count: Number(payload.item_count || 0)
  };
}

function workflowText() {
  const file = path.join(ROOT, ".github", "workflows", "longterm-update.yml");
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
}

const tiers = readJson("dashboard/api/runtime/update-tiers.json", {});
const budget = readJson("dashboard/api/runtime-budget-report.json", {});
const sourceCsv = readJson("dashboard/api/aux/source-csv-summary.json", {});
const auxIndex = readJson("dashboard/api/aux/latest/index.json", {});
const enrichmentIndex = readJson("dashboard/api/enrichment/latest/index.json", {});
const workflow = workflowText();

const statuses = REQUIRED_FILES.map(fileStatus);
const deployMissing = DEPLOY_REQUIRED.filter(file => !workflow.includes(file));
const problems = [];

for (const status of statuses) {
  if (!status.exists) problems.push(`missing ${status.path}`);
}
if (deployMissing.length) problems.push(`deploy whitelist missing: ${deployMissing.join(", ")}`);
if (String(tiers.update_mode || budget.update_mode || "").toLowerCase() === "core" && String(sourceCsv.source_csv_mode || "").toLowerCase() === "refresh") {
  problems.push("core update is configured to refresh source_csv");
}
if (budget.update_mode === "core" && Array.isArray(budget.stages) && budget.stages.some(stage => /full source-data enrichment|storage efficiency audit/i.test(stage.name) && stage.status !== "skipped")) {
  problems.push("heavy optional stages appear to run during core update");
}

console.log("Tiered update audit");
console.log("===================");
console.log(`core: run=${tiers.core_run_id || "-"} generated_at=${tiers.core_generated_at || "-"} age_hours=${ageHours(tiers.core_generated_at) ?? "-"}`);
console.log(`fast_aux: run=${tiers.fast_aux_run_id || "-"} generated_at=${tiers.fast_aux_generated_at || "-"} age_hours=${ageHours(tiers.fast_aux_generated_at) ?? "-"}`);
console.log(`reference_enrichment: run=${tiers.reference_enrichment_run_id || "-"} generated_at=${tiers.reference_enrichment_generated_at || "-"} age_hours=${ageHours(tiers.reference_enrichment_generated_at) ?? "-"}`);
console.log(`discovery_audit: run=${tiers.discovery_audit_run_id || "-"} generated_at=${tiers.discovery_audit_generated_at || "-"} age_hours=${ageHours(tiers.discovery_audit_generated_at) ?? "-"}`);
console.log(`active_aux_cache_available=${Boolean(tiers.active_aux_cache_available || auxIndex.generated_at)}`);
console.log(`active_enrichment_patch_available=${Boolean(tiers.active_enrichment_patch_available || enrichmentIndex.patches_available)}`);
console.log(`source_csv_mode=${sourceCsv.source_csv_mode || process.env.SOURCE_CSV_MODE || "-"}`);
console.log(`runtime_budget: mode=${budget.update_mode || "-"} duration_ms=${budget.duration_ms ?? "-"} timeout_risk=${Boolean(budget.timeout_risk)}`);
console.log("\nFiles:");
for (const status of statuses) {
  console.log(`- ${status.path}: ${status.exists ? "OK" : "MISSING"} generated_at=${status.generated_at || "-"} stale=${status.stale}`);
}
console.log(`\nDeploy whitelist missing: ${deployMissing.length ? deployMissing.join(", ") : "none"}`);
console.log(`Problems: ${problems.length ? problems.join("; ") : "none"}`);

if (problems.length) process.exit(1);
