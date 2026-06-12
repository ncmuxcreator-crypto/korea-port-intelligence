import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

const FILES = {
  statusSummary: "dashboard/api/status-summary.json",
  updateTiers: "dashboard/api/runtime/update-tiers.json",
  runtimeBudget: "dashboard/api/runtime-budget-report.json",
  sourceCollection: "dashboard/api/source-collection-status.json",
  sourceQuality: "dashboard/api/source-quality-score.json",
  enrichmentUtilization: "dashboard/api/enrichment-utilization.json",
  auxLatest: "dashboard/api/aux/latest/index.json",
  enrichmentLatest: "dashboard/api/enrichment/latest/index.json"
};

const AUX_SOURCE_KEYS = new Set([
  "source_csv",
  "pilot_sources",
  "berth_sources",
  "vessel_spec",
  "mof_ais_info",
  "mof_ais_dynamic",
  "mof_ais_stat",
  "ulsan_core",
  "ulsan_berth_detail",
  "ulsan_cargo_plan",
  "ulsan_berth_operation",
  "ulsan_terminal_process"
]);

function readJson(relativePath, fallback = {}) {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), "utf8"));
  } catch {
    return fallback;
  }
}

function exists(relativePath) {
  return fs.existsSync(path.join(ROOT, relativePath));
}

function ageHours(generatedAt) {
  if (!generatedAt) return null;
  const age = (Date.now() - Date.parse(generatedAt)) / 36e5;
  return Number.isFinite(age) ? Math.max(0, Math.round(age * 10) / 10) : null;
}

function sourceItems(payload = {}) {
  return Array.isArray(payload.items) ? payload.items : [];
}

function sourceQualityMissingAux(payload = {}) {
  return sourceItems(payload).filter(item => {
    const key = String(item.source_key || "");
    if (!AUX_SOURCE_KEYS.has(key)) return false;
    const blocker = String(item.blocker_reason || item.recommended_fix || "").toLowerCase();
    const rows = Number(item.rows_collected || 0) + Number(item.rows_normalized || 0) + Number(item.rows_matched_to_vessels || 0);
    return rows <= 0 &&
      item.configured === false &&
      item.attempted === false &&
      String(item.quality_label || "").toUpperCase() === "FAILED" &&
      /missing_env|missing_api|not_configured|set /.test(blocker);
  });
}

function sourceCollectionActiveAux(payload = {}) {
  return sourceItems(payload).filter(item => {
    const key = String(item.source_key || "");
    return AUX_SOURCE_KEYS.has(key) && String(item.status || "").toUpperCase() === "ACTIVE";
  });
}

function auxIndexMissingEnv(payload = {}) {
  const status = payload.source_status && typeof payload.source_status === "object" ? payload.source_status : {};
  return Object.entries(status)
    .filter(([key, value]) => AUX_SOURCE_KEYS.has(key) && ["NOT_CONFIGURED", "SKIPPED", "NOT_ATTEMPTED"].includes(String(value || "").toUpperCase()))
    .map(([key]) => key);
}

function enrichmentUtilizationMissingAux(payload = {}) {
  return sourceItems(payload).filter(item => {
    const key = String(item.source_key || "");
    return AUX_SOURCE_KEYS.has(key) &&
      String(item.quality_label || "").toUpperCase() === "FAILED" &&
      Number(item.matched_vessels || 0) <= 0;
  });
}

function fileRunId(payload = {}, preferred = []) {
  for (const field of preferred) {
    if (payload[field]) return payload[field];
  }
  return payload.run_id || payload.status_run_id || payload.source_run_id || null;
}

function ownershipIssue(label, payload, expected) {
  if (!payload || typeof payload !== "object") return `${label}: missing payload`;
  const owner = payload.owner_tier || "";
  if (expected.owners && !expected.owners.includes(owner)) {
    return `${label}: owner_tier=${owner || "missing"} expected=${expected.owners.join("|")}`;
  }
  if (expected.coreMayUpdate !== undefined && payload.core_may_update !== expected.coreMayUpdate) {
    return `${label}: core_may_update=${payload.core_may_update} expected=${expected.coreMayUpdate}`;
  }
  if (expected.allowPolicy && payload.core_may_update === true && !payload.core_update_policy) {
    return `${label}: core_may_update=true requires core_update_policy`;
  }
  return null;
}

const statusSummary = readJson(FILES.statusSummary);
const updateTiers = readJson(FILES.updateTiers);
const runtimeBudget = readJson(FILES.runtimeBudget);
const sourceCollection = readJson(FILES.sourceCollection);
const sourceQuality = readJson(FILES.sourceQuality);
const enrichmentUtilization = readJson(FILES.enrichmentUtilization);
const auxLatest = readJson(FILES.auxLatest);
const enrichmentLatest = readJson(FILES.enrichmentLatest);

const coreRunId = updateTiers.core_run_id || updateTiers.run_id || runtimeBudget.run_id || statusSummary.run_id || null;
const activeUpdateMode = String(updateTiers.update_mode || runtimeBudget.update_mode || statusSummary.update_mode || "").toLowerCase();
const activeRunIsCore = ["core", "core_update"].includes(activeUpdateMode);
const rows = [
  ["core", coreRunId, updateTiers.core_generated_at || updateTiers.generated_at, updateTiers.core_generated_by || updateTiers.generated_by],
  ["status-summary", fileRunId(statusSummary, ["run_id"]), statusSummary.generated_at, statusSummary.generated_by],
  ["source-collection-status", fileRunId(sourceCollection, ["run_id"]), sourceCollection.generated_at, sourceCollection.generated_by],
  ["source-quality-score", fileRunId(sourceQuality, ["run_id"]), sourceQuality.generated_at, sourceQuality.generated_by],
  ["aux/latest/index", fileRunId(auxLatest, ["aux_run_id", "run_id"]), auxLatest.generated_at, auxLatest.generated_by],
  ["enrichment/latest/index", fileRunId(enrichmentLatest, ["enrichment_run_id", "run_id"]), enrichmentLatest.generated_at, enrichmentLatest.generated_by]
];

const stale = {
  status_summary: Boolean(coreRunId && statusSummary.run_id && statusSummary.run_id !== coreRunId),
  source_collection_status: Boolean(coreRunId && sourceCollection.run_id && sourceCollection.run_id !== coreRunId),
  source_quality_score: Boolean(coreRunId && sourceQuality.run_id && sourceQuality.run_id !== coreRunId),
  aux_latest: Boolean(coreRunId && (auxLatest.aux_run_id || auxLatest.run_id) && (auxLatest.aux_run_id || auxLatest.run_id) !== coreRunId),
  enrichment_latest: Boolean(coreRunId && (enrichmentLatest.enrichment_run_id || enrichmentLatest.run_id) && (enrichmentLatest.enrichment_run_id || enrichmentLatest.run_id) !== coreRunId)
};

const activeAux = sourceCollectionActiveAux(sourceCollection);
const missingAuxQuality = sourceQualityMissingAux(sourceQuality);
const missingAuxIndex = auxIndexMissingEnv(auxLatest);
const missingUtilization = enrichmentUtilizationMissingAux(enrichmentUtilization);
const sourceQualityOverwrite = sourceQuality.generated_by === "local" &&
  missingAuxQuality.length > 0 &&
  activeAux.length > 0 &&
  sourceQuality.reused_from_cache !== true;
const auxIndexOverwrite = auxLatest.generated_by === "local" &&
  String(auxLatest.update_mode || "").toLowerCase() === "core" &&
  missingAuxIndex.length > 0 &&
  auxLatest.reused_from_cache !== true;
const utilizationOverwrite = enrichmentUtilization.generated_by === "local" &&
  missingUtilization.length > 0 &&
  enrichmentUtilization.reused_from_cache !== true;

const ownershipIssues = [
  ownershipIssue("status-summary", statusSummary, { owners: ["core"], coreMayUpdate: true }),
  ownershipIssue("runtime/update-tiers", updateTiers, { owners: ["core"], coreMayUpdate: true }),
  ownershipIssue("source-quality-score", sourceQuality, { owners: ["fast_aux", "reference_enrichment"], allowPolicy: true }),
  ownershipIssue("enrichment-utilization", enrichmentUtilization, { owners: ["reference_enrichment"], allowPolicy: true }),
  ownershipIssue("aux/latest/index", auxLatest, { owners: ["fast_aux"], coreMayUpdate: false }),
  ownershipIssue("enrichment/latest/index", enrichmentLatest, { owners: ["reference_enrichment"], coreMayUpdate: false })
].filter(Boolean);

if (exists(FILES.sourceCollection)) {
  const sourceCollectionOwner = sourceCollection.owner_tier || "";
  if (!sourceCollectionOwner) {
    ownershipIssues.push("source-collection-status: owner_tier missing on preserved legacy file");
  }
}

const statusSummaryFresh = activeRunIsCore ? !stale.status_summary : true;
const localCoreLooksPromoted = statusSummary.generated_by === "local" &&
  String(statusSummary.update_mode || updateTiers.update_mode || "").toLowerCase() === "core" &&
  (statusSummary.data_mode !== "local_static" ||
    statusSummary.supabase_write_status !== "skipped_local" ||
    statusSummary.dataset_promotion_status !== "not_promoted");

const problems = [];
if (activeRunIsCore && !statusSummaryFresh) problems.push("status-summary run_id does not match current core run_id");
if (sourceQualityOverwrite) problems.push(`local source-quality overwrite detected for: ${missingAuxQuality.map(item => item.source_key).join(", ")}`);
if (auxIndexOverwrite) problems.push(`local aux/latest overwrite detected for: ${missingAuxIndex.join(", ")}`);
if (utilizationOverwrite) problems.push(`local enrichment-utilization overwrite detected for: ${missingUtilization.map(item => item.source_key).join(", ")}`);
if (localCoreLooksPromoted) problems.push("local core status-summary looks production-promoted");
if (!updateTiers.mixed_tier_note) problems.push("runtime/update-tiers.json missing mixed_tier_note");

const recommendedFix = problems.length
  ? "Run npm run update:core after the tier-preservation patch, then verify aux/enrichment outputs keep reused_from_cache metadata and original tier run ids."
  : ownershipIssues.length
    ? "Refresh the owning tier to backfill ownership metadata on preserved legacy files; core preservation is otherwise effective."
    : "none";

console.log("Tiered update audit");
console.log("===================");
console.log(`active_update_mode=${activeUpdateMode || "-"}`);
for (const [label, id, generatedAt, generatedBy] of rows) {
  console.log(`${label}: run_id=${id || "-"} generated_at=${generatedAt || "-"} generated_by=${generatedBy || "-"} age_hours=${ageHours(generatedAt) ?? "-"}`);
}
console.log("");
console.log(`mixed_tier_status=${Boolean(updateTiers.mixed_tier_status)} note=${updateTiers.mixed_tier_note || "-"}`);
console.log(`status_summary_current=${statusSummaryFresh}`);
console.log(`source_collection_status_stale=${stale.source_collection_status} allowed_mixed_tier=${stale.source_collection_status && updateTiers.mixed_tier_status !== false}`);
console.log(`source_quality_score_stale=${stale.source_quality_score}`);
console.log(`aux_latest_stale=${stale.aux_latest} reused_from_cache=${Boolean(auxLatest.reused_from_cache)}`);
console.log(`enrichment_latest_stale=${stale.enrichment_latest} reused_from_cache=${Boolean(enrichmentLatest.reused_from_cache)}`);
console.log(`local_overwrote_github_aux_state=${Boolean(sourceQualityOverwrite || auxIndexOverwrite || utilizationOverwrite)}`);
console.log(`ownership_issues=${ownershipIssues.length ? ownershipIssues.join("; ") : "none"}`);
console.log(`problems=${problems.length ? problems.join("; ") : "none"}`);
console.log(`recommended_fix=${recommendedFix}`);

if (problems.length) process.exit(1);
