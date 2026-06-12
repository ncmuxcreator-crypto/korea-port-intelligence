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
  storageEfficiency: "dashboard/api/storage-efficiency-report.json",
  auxLatest: "dashboard/api/aux/latest/index.json",
  enrichmentLatest: "dashboard/api/enrichment/latest/index.json",
  enrichmentPatches: "dashboard/api/enrichment/latest/patches.json",
  discoveryIndex: "dashboard/api/discovery/index.json",
  endpointManifest: "dashboard/api/endpoint-manifest.json",
  workflow: ".github/workflows/longterm-update.yml"
};

const REQUIRED_LIGHTWEIGHT_OUTPUTS = [
  "dashboard/api/runtime/update-tiers.json",
  "dashboard/api/runtime-budget-report.json",
  "dashboard/api/status-summary.json",
  "dashboard/api/bootstrap.json",
  "dashboard/api/vessel-count-reconciliation.json",
  "dashboard/api/endpoint-manifest.json",
  "dashboard/api/source-quality-score.json",
  "dashboard/api/enrichment-utilization.json",
  "dashboard/api/aux/latest/index.json",
  "dashboard/api/aux/latest/pilotage-summary.json",
  "dashboard/api/aux/latest/berth-summary.json",
  "dashboard/api/aux/latest/ais-info-summary.json",
  "dashboard/api/aux/latest/ais-dynamic-summary.json",
  "dashboard/api/aux/latest/ais-stat-summary.json",
  "dashboard/api/aux/latest/vessel-spec-summary.json",
  "dashboard/api/aux/latest/cache-status.json",
  "dashboard/api/aux/latest/patch-hints.json",
  "dashboard/api/aux/source-csv-summary.json",
  "dashboard/api/aux/pilotage-summary.json",
  "dashboard/api/aux/berth-summary.json",
  "dashboard/api/aux/ais-info-summary.json",
  "dashboard/api/aux/ais-dynamic-summary.json",
  "dashboard/api/aux/vessel-spec-summary.json",
  "dashboard/api/enrichment/latest/index.json",
  "dashboard/api/enrichment/latest/summary.json",
  "dashboard/api/enrichment/latest/patches.json",
  "dashboard/api/enrichment/latest/review-queue.json",
  "dashboard/api/enrichment/summary.json",
  "dashboard/api/enrichment/review-queue.json"
];

const AUX_SOURCE_KEYS = new Set([
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

function readText(relativePath) {
  try {
    return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
  } catch {
    return "";
  }
}

function exists(relativePath) {
  return fs.existsSync(path.join(ROOT, relativePath));
}

function runId(payload = {}, preferred = []) {
  for (const field of preferred) {
    if (payload[field]) return payload[field];
  }
  return payload.active_run_id || payload.run_id || payload.status_run_id || payload.source_run_id || null;
}

function ageHours(generatedAt) {
  if (!generatedAt) return null;
  const parsed = Date.parse(generatedAt);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.round(((Date.now() - parsed) / 36e5) * 10) / 10);
}

function sourceOwner(sourceKey = "") {
  const key = String(sourceKey || "");
  if (key === "port_operation") return "core";
  if (key === "source_csv") return "reference_enrichment";
  if (key === "vessel_spec") return "fast_aux";
  return AUX_SOURCE_KEYS.has(key) ? "fast_aux" : "fast_aux";
}

function sourceItems(payload = {}) {
  return Array.isArray(payload.items) ? payload.items : [];
}

function missingEnvAuxQuality(payload = {}) {
  return sourceItems(payload).filter(item => {
    const key = String(item.source_key || "");
    if (key === "source_csv" || !AUX_SOURCE_KEYS.has(key)) return false;
    const blocker = String(item.blocker_reason || item.recommended_fix || "").toLowerCase();
    const rows = Number(item.rows_collected || 0) + Number(item.rows_normalized || 0) + Number(item.rows_matched_to_vessels || 0);
    return rows <= 0 &&
      item.configured === false &&
      item.attempted === false &&
      String(item.quality_label || "").toUpperCase() === "FAILED" &&
      /missing_env|missing_api|not_configured|set /.test(blocker);
  });
}

function activeAuxSources(payload = {}) {
  return sourceItems(payload).filter(item =>
    AUX_SOURCE_KEYS.has(String(item.source_key || "")) &&
    String(item.status || "").toUpperCase() === "ACTIVE"
  );
}

function sourceQualityOwnerIssues(payload = {}) {
  const issues = [];
  if (payload.owner_tier !== "mixed") {
    issues.push(`top-level owner_tier=${payload.owner_tier || "missing"} expected=mixed`);
  }
  if (payload.core_may_update !== "core_sources_only") {
    issues.push(`top-level core_may_update=${payload.core_may_update} expected=core_sources_only`);
  }
  return [
    ...issues,
    ...sourceItems(payload)
    .map(item => {
      const expected = sourceOwner(item.source_key);
      const actual = item.owner_tier || payload.owner_tier_by_source?.[item.source_key] || "";
      if (actual !== expected) return `${item.source_key}: owner_tier=${actual || "missing"} expected=${expected}`;
      if (expected !== "core" && item.core_may_update !== false) return `${item.source_key}: core_may_update=${item.core_may_update} expected=false`;
      return null;
    })
    .filter(Boolean)
  ];
}

function coreMayUpdateMatches(actual, expected) {
  if (expected === "any") return actual !== undefined && actual !== null;
  if (expected === true) return actual === true;
  if (expected === false) return actual === false;
  return actual === expected;
}

function fileOwnershipIssues(entries = []) {
  return entries.flatMap(({ label, payload, ownerTier, coreMayUpdate, allowCoreUpdatePolicy = false }) => {
    const issues = [];
    if (!payload || typeof payload !== "object" || Object.keys(payload).length === 0) {
      issues.push(`${label}: missing or unreadable`);
      return issues;
    }
    if (payload.owner_tier !== ownerTier) {
      issues.push(`${label}: owner_tier=${payload.owner_tier || "missing"} expected=${ownerTier}`);
    }
    if (!coreMayUpdateMatches(payload.core_may_update, coreMayUpdate)) {
      const policy = payload.core_update_policy || "";
      if (!(allowCoreUpdatePolicy && payload.core_may_update === true && policy)) {
        issues.push(`${label}: core_may_update=${payload.core_may_update} expected=${coreMayUpdate}`);
      }
    }
    if (payload.stale_diagnostic === true && !payload.stale_reason) {
      issues.push(`${label}: stale_diagnostic=true but stale_reason is missing`);
    }
    return issues;
  });
}

function manifestCoverage(manifest = {}) {
  const endpoints = new Set((manifest.endpoints || []).map(entry => String(entry.path || "")));
  return REQUIRED_LIGHTWEIGHT_OUTPUTS.filter(file => !endpoints.has(file));
}

function deployCoverage(workflowText = "") {
  return REQUIRED_LIGHTWEIGHT_OUTPUTS
    .map(file => file.replace(/^dashboard\/api\//, ""))
    .filter(file => !workflowText.includes(file));
}

function listVesselPageFiles() {
  const dir = path.join(ROOT, "dashboard/api/vessels");
  try {
    return fs.readdirSync(dir)
      .filter(name => /^page-\d+\.json$/.test(name))
      .map(name => `dashboard/api/vessels/${name}`);
  } catch {
    return [];
  }
}

function collectRecords(value, out = []) {
  if (!value || typeof value !== "object") return out;
  if (Array.isArray(value)) {
    for (const item of value) collectRecords(item, out);
    return out;
  }
  if (value.vessel_display && typeof value.vessel_display === "object") out.push(value);
  for (const key of ["items", "candidates", "top_candidates", "contact_today", "watchlist", "records"]) {
    if (value[key]) collectRecords(value[key], out);
  }
  return out;
}

function countVisiblePatchApplications() {
  const files = [
    ...listVesselPageFiles(),
    "dashboard/api/sales/actions.json",
    "dashboard/api/targets/current.json",
    "dashboard/api/watchlist/current.json",
    "dashboard/api/bootstrap.json"
  ].filter(exists);
  let cachedMarkers = 0;
  let berthSignals = 0;
  let pilotageSignals = 0;
  const seen = new Set();
  for (const file of files) {
    const records = collectRecords(readJson(file, {}));
    for (const record of records) {
      const display = record.vessel_display || {};
      const key = [
        display.vessel_key,
        record.vessel_key,
        display.imo,
        display.mmsi,
        display.call_sign,
        display.vessel_name
      ].find(Boolean) || `${file}:${seen.size}`;
      const scopedKey = `${file}:${key}`;
      if (seen.has(scopedKey)) continue;
      seen.add(scopedKey);
      if (record.cached_enrichment_patch_applied === true || display.cached_enrichment_patch_applied === true) cachedMarkers += 1;
      if (display.berth_signal?.has_berth_info === true || display.berth_signal?.has_berth === true) berthSignals += 1;
      if (display.pilotage_signal?.has_pilotage === true) pilotageSignals += 1;
    }
  }
  return {
    files_checked: files.length,
    cached_markers: cachedMarkers,
    berth_signal_records: berthSignals,
    pilotage_signal_records: pilotageSignals,
    visible_signal_records: berthSignals + pilotageSignals
  };
}

const statusSummary = readJson(FILES.statusSummary);
const updateTiers = readJson(FILES.updateTiers);
const runtimeBudget = readJson(FILES.runtimeBudget);
const sourceCollection = readJson(FILES.sourceCollection);
const sourceQuality = readJson(FILES.sourceQuality);
const enrichmentUtilization = readJson(FILES.enrichmentUtilization);
const storageEfficiency = readJson(FILES.storageEfficiency);
const auxLatest = readJson(FILES.auxLatest);
const enrichmentLatest = readJson(FILES.enrichmentLatest);
const enrichmentPatches = readJson(FILES.enrichmentPatches, { items: [] });
const discoveryIndex = readJson(FILES.discoveryIndex);
const endpointManifest = readJson(FILES.endpointManifest, { endpoints: [] });
const workflowText = readText(FILES.workflow);

const statusRunId = runId(statusSummary, ["active_run_id", "run_id"]);
const updateCoreRunId = updateTiers.core_run_id || runId(updateTiers, ["active_run_id", "run_id"]);
const auxRunId = runId(auxLatest, ["aux_run_id", "run_id"]);
const enrichmentRunId = runId(enrichmentLatest, ["enrichment_run_id", "run_id"]);
const patches = Array.isArray(enrichmentPatches.items) ? enrichmentPatches.items : [];
const signalPatchCount = patches.filter(item => ["pilotage_signal", "berth_signal"].includes(String(item.field_name || ""))).length;
const localMissingAux = missingEnvAuxQuality(sourceQuality);
const activeAux = activeAuxSources(sourceCollection);
const localOverwroteProductionAux = sourceQuality.generated_by === "local" &&
  localMissingAux.length > 0 &&
  activeAux.length > 0 &&
  sourceQuality.reused_from_cache !== true;
const ownerIssues = sourceQualityOwnerIssues(sourceQuality);
const fileOwnerIssues = fileOwnershipIssues([
  { label: "status-summary", payload: statusSummary, ownerTier: "core", coreMayUpdate: true },
  { label: "runtime/update-tiers", payload: updateTiers, ownerTier: "core", coreMayUpdate: true },
  { label: "runtime-budget-report", payload: runtimeBudget, ownerTier: "core", coreMayUpdate: true },
  { label: "source-collection-status", payload: sourceCollection, ownerTier: "mixed", coreMayUpdate: "core_sources_only" },
  { label: "source-quality-score", payload: sourceQuality, ownerTier: "mixed", coreMayUpdate: "core_sources_only" },
  { label: "enrichment-utilization", payload: enrichmentUtilization, ownerTier: "reference_enrichment", coreMayUpdate: true, allowCoreUpdatePolicy: true },
  { label: "aux/latest/index", payload: auxLatest, ownerTier: "fast_aux", coreMayUpdate: false },
  { label: "enrichment/latest/index", payload: enrichmentLatest, ownerTier: "reference_enrichment", coreMayUpdate: false },
  { label: "storage-efficiency-report", payload: storageEfficiency, ownerTier: "discovery_audit", coreMayUpdate: false },
  { label: "discovery/index", payload: discoveryIndex, ownerTier: "discovery_audit", coreMayUpdate: false }
]);
const missingManifest = manifestCoverage(endpointManifest);
const missingDeploy = deployCoverage(workflowText);
const visiblePatchApplications = countVisiblePatchApplications();

const stale = {
  status_update_core_mismatch: Boolean(statusRunId && updateCoreRunId && statusRunId !== updateCoreRunId),
  source_quality_stale: Boolean(statusRunId && runId(sourceQuality, ["run_id", "core_run_id"]) && runId(sourceQuality, ["run_id", "core_run_id"]) !== statusRunId),
  aux_latest_mixed_tier: Boolean(statusRunId && auxRunId && auxRunId !== statusRunId),
  enrichment_latest_mixed_tier: Boolean(statusRunId && enrichmentRunId && enrichmentRunId !== statusRunId)
};

const problems = [];
if (stale.status_update_core_mismatch) problems.push("status-summary active_run_id does not match update-tiers core_run_id");
if (localOverwroteProductionAux) problems.push(`local source-quality overwrote active aux state: ${localMissingAux.map(item => item.source_key).join(", ")}`);
if (ownerIssues.length) problems.push(`source-quality owner issues: ${ownerIssues.join("; ")}`);
if (fileOwnerIssues.length) problems.push(`file ownership issues: ${fileOwnerIssues.join("; ")}`);
if (missingManifest.length) problems.push(`endpoint-manifest missing lightweight outputs: ${missingManifest.join(", ")}`);
if (missingDeploy.length) problems.push(`deploy whitelist missing lightweight outputs: ${missingDeploy.join(", ")}`);
if (signalPatchCount > 0 && visiblePatchApplications.visible_signal_records === 0) {
  problems.push("cached signal patches exist but no pilotage/berth signal is visible in vessel_display outputs");
}

const recommendedFix = problems.length
  ? "Run npm run update:core after applying the tier consistency patch, then refresh the owning fast_aux/reference_enrichment tier if owner metadata is still missing."
  : "none";

console.log("Tiered consistency audit");
console.log("========================");
console.log(`status_summary_run_id=${statusRunId || "-"}`);
console.log(`update_tiers_core_run_id=${updateCoreRunId || "-"}`);
console.log(`source_collection_run_id=${runId(sourceCollection, ["run_id"]) || "-"}`);
console.log(`source_quality_run_id=${runId(sourceQuality, ["run_id", "core_run_id"]) || "-"}`);
console.log(`runtime_budget_run_id=${runId(runtimeBudget, ["run_id"]) || "-"} generated_by=${runtimeBudget.generated_by || "-"}`);
console.log(`aux_latest_run_id=${auxRunId || "-"} generated_at=${auxLatest.generated_at || "-"} generated_by=${auxLatest.generated_by || "-"} age_hours=${ageHours(auxLatest.generated_at) ?? "-"}`);
console.log(`enrichment_latest_run_id=${enrichmentRunId || "-"} generated_at=${enrichmentLatest.generated_at || "-"} generated_by=${enrichmentLatest.generated_by || "-"} age_hours=${ageHours(enrichmentLatest.generated_at) ?? "-"}`);
console.log(`discovery_run_id=${runId(discoveryIndex, ["run_id"]) || "-"} generated_at=${discoveryIndex.generated_at || "-"} generated_by=${discoveryIndex.generated_by || "-"}`);
console.log(`mixed_tier_status=${Boolean(updateTiers.mixed_tier_status)} note=${updateTiers.mixed_tier_note || "-"}`);
console.log(`source_quality_owner_status=${ownerIssues.length ? ownerIssues.join("; ") : "ok"}`);
console.log(`file_owner_status=${fileOwnerIssues.length ? fileOwnerIssues.join("; ") : "ok"}`);
console.log(`local_run_overwrote_production_aux_state=${localOverwroteProductionAux}`);
console.log(`patch_availability=count:${patches.length} signal_patches:${signalPatchCount}`);
console.log(`vessel_display_patch_application_count=cached_markers:${visiblePatchApplications.cached_markers} visible_signals:${visiblePatchApplications.visible_signal_records} files_checked:${visiblePatchApplications.files_checked}`);
console.log(`deploy_whitelist_coverage=${missingDeploy.length ? `missing:${missingDeploy.join(",")}` : "ok"}`);
console.log(`endpoint_manifest_coverage=${missingManifest.length ? `missing:${missingManifest.join(",")}` : "ok"}`);
console.log(`stale_status=${JSON.stringify(stale)}`);
console.log(`enrichment_count_inconsistency=${Boolean(enrichmentUtilization.count_inconsistency)}`);
console.log(`problems=${problems.length ? problems.join("; ") : "none"}`);
console.log(`recommended_fix=${recommendedFix}`);

if (problems.length) process.exit(1);
