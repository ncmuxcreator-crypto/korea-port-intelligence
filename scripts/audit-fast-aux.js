import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

const REQUIRED_CACHE_FILES = [
  "dashboard/api/aux/latest/index.json",
  "dashboard/api/aux/latest/cache-status.json",
  "dashboard/api/aux/latest/pilotage-summary.json",
  "dashboard/api/aux/latest/berth-summary.json",
  "dashboard/api/aux/latest/ais-info-summary.json",
  "dashboard/api/aux/latest/ais-dynamic-summary.json",
  "dashboard/api/aux/latest/ais-stat-summary.json",
  "dashboard/api/aux/latest/vessel-spec-summary.json",
  "dashboard/api/aux/latest/patch-hints.json"
];

const LEGACY_CACHE_FILES = [
  "dashboard/api/aux/pilotage-summary.json",
  "dashboard/api/aux/berth-summary.json",
  "dashboard/api/aux/ais-info-summary.json",
  "dashboard/api/aux/ais-dynamic-summary.json",
  "dashboard/api/aux/ais-stat-summary.json",
  "dashboard/api/aux/vessel-spec-summary.json"
];

const AUX_SOURCE_KEYS = new Set([
  "pilot_sources",
  "berth_sources",
  "mof_ais_info",
  "mof_ais_dynamic",
  "mof_ais_stat",
  "vessel_spec"
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

function runId(payload = {}) {
  return payload.aux_run_id || payload.run_id || payload.source_run_id || payload.active_run_id || null;
}

function rowsFor(item = {}) {
  return {
    collected: Number(item.rows_collected || 0),
    normalized: Number(item.rows_normalized || 0),
    matched: Number(item.rows_matched_to_vessels || item.matched_vessels || 0)
  };
}

function sourceRowsFromCache(cacheStatus = {}, summaries = {}) {
  const cacheItems = Array.isArray(cacheStatus.items) ? cacheStatus.items : [];
  return [...AUX_SOURCE_KEYS].map(sourceKey => {
    const cacheItem = cacheItems.find(item => item.source_key === sourceKey) || {};
    const summary = summaries[sourceKey] || {};
    const rows = rowsFor({ ...cacheItem, ...summary });
    return {
      source_key: sourceKey,
      status: summary.status || cacheItem.current_attempt_status || "UNKNOWN",
      cache_status: summary.cache_status || cacheItem.cache_status || "UNKNOWN",
      configured: Boolean(summary.configured ?? cacheItem.configured),
      attempted: Boolean(summary.attempted ?? summary.collector_attempted ?? cacheItem.attempted),
      rows_collected: rows.collected,
      rows_normalized: rows.normalized,
      rows_matched_to_vessels: rows.matched,
      using_previous_cache: Boolean(summary.using_previous_cache || cacheItem.using_previous_cache),
      stale_diagnostic: Boolean(summary.stale_diagnostic || cacheItem.stale_diagnostic || cacheItem.cache_stale_warning),
      cache_age_hours: summary.cache_age_hours ?? cacheItem.cache_age_hours ?? null,
      missing_env: summary.missing_env || [],
      blocker_reason: summary.blocker_reason || cacheItem.blocker_reason || "",
      recommended_fix: summary.recommended_fix || summary.fix_hint || cacheItem.recommended_fix || ""
    };
  });
}

function detectCoreAuxFetchGuard() {
  const collector = readText("scripts/collectors/korea.js");
  const runner = readText("scripts/run-update-mode.js");
  const hasCollectorModeGate = /CORE_COLLECTOR_MODES\.has\(COLLECTOR_UPDATE_MODE\)\)\s*return tier === "core"/.test(collector);
  const corePresetKeepsAuxOff = /core:\s*{[\s\S]*UPDATE_MODE:\s*"core"[\s\S]*ENRICHMENT_MODE:\s*"lightweight_apply_cache"/.test(runner);
  return {
    core_fetch_guard_present: hasCollectorModeGate,
    core_preset_cache_only: corePresetKeepsAuxOff,
    core_incorrectly_fetching_aux_apis: !(hasCollectorModeGate && corePresetKeepsAuxOff)
  };
}

const latestIndex = readJson("dashboard/api/aux/latest/index.json");
const cacheStatus = readJson("dashboard/api/aux/latest/cache-status.json", { items: [] });
const patchHints = readJson("dashboard/api/aux/latest/patch-hints.json", { items: [] });
const sourceCollection = readJson("dashboard/api/source-collection-status.json", { items: [] });
const summaries = {
  pilot_sources: readJson("dashboard/api/aux/latest/pilotage-summary.json"),
  berth_sources: readJson("dashboard/api/aux/latest/berth-summary.json"),
  mof_ais_info: readJson("dashboard/api/aux/latest/ais-info-summary.json"),
  mof_ais_dynamic: readJson("dashboard/api/aux/latest/ais-dynamic-summary.json"),
  mof_ais_stat: readJson("dashboard/api/aux/latest/ais-stat-summary.json"),
  vessel_spec: readJson("dashboard/api/aux/latest/vessel-spec-summary.json")
};

const missingCacheFiles = REQUIRED_CACHE_FILES.filter(file => !exists(file));
const missingLegacyFiles = LEGACY_CACHE_FILES.filter(file => !exists(file));
const sourceRows = sourceRowsFromCache(cacheStatus, summaries);
const usingPrevious = sourceRows.filter(item => item.using_previous_cache);
const staleWarnings = sourceRows.filter(item => item.stale_diagnostic);
const missingEnvs = sourceRows
  .flatMap(item => (item.missing_env || []).map(envName => `${item.source_key}:${envName}`));
const blockers = sourceRows
  .filter(item => item.blocker_reason)
  .map(item => `${item.source_key}:${item.blocker_reason}`);
const sourceCollectionAux = (sourceCollection.items || []).filter(item => AUX_SOURCE_KEYS.has(item.source_key));
const guard = detectCoreAuxFetchGuard();
const problems = [];

if (missingCacheFiles.length) problems.push(`missing aux/latest files: ${missingCacheFiles.join(", ")}`);
if (guard.core_incorrectly_fetching_aux_apis) problems.push("core collector aux API guard is missing or not detected");
for (const [sourceKey, summary] of Object.entries(summaries)) {
  if (summary.owner_tier !== "fast_aux") problems.push(`${sourceKey}: owner_tier=${summary.owner_tier || "missing"} expected=fast_aux`);
  if (summary.core_may_update !== false) problems.push(`${sourceKey}: core_may_update=${summary.core_may_update} expected=false`);
}

console.log("Fast auxiliary cache audit");
console.log("==========================");
console.log(`aux_run_id=${runId(latestIndex) || "-"}`);
console.log(`latest_generated_at=${latestIndex.generated_at || "-"}`);
console.log(`cache_files_generated=${REQUIRED_CACHE_FILES.length - missingCacheFiles.length}/${REQUIRED_CACHE_FILES.length}`);
console.log(`legacy_cache_files_generated=${LEGACY_CACHE_FILES.length - missingLegacyFiles.length}/${LEGACY_CACHE_FILES.length}`);
console.log(`source_status_by_source=${JSON.stringify(sourceRows.map(item => ({
  source_key: item.source_key,
  status: item.status,
  cache_status: item.cache_status,
  configured: item.configured,
  attempted: item.attempted
})))}`);
console.log(`rows_by_source=${JSON.stringify(sourceRows.map(item => ({
  source_key: item.source_key,
  rows_collected: item.rows_collected,
  rows_normalized: item.rows_normalized,
  rows_matched_to_vessels: item.rows_matched_to_vessels
})))}`);
console.log(`previous_cache_reuse=${usingPrevious.length ? usingPrevious.map(item => item.source_key).join(",") : "none"}`);
console.log(`stale_warnings=${staleWarnings.length ? staleWarnings.map(item => `${item.source_key}:${item.cache_age_hours}h`).join(",") : "none"}`);
console.log(`missing_envs=${missingEnvs.length ? missingEnvs.join(",") : "none"}`);
console.log(`source_blockers=${blockers.length ? blockers.join("; ") : "none"}`);
console.log(`patch_hints_generated=${Array.isArray(patchHints.items) ? patchHints.items.length : 0}`);
console.log(`source_collection_aux_status=${JSON.stringify(sourceCollectionAux.map(item => ({
  source_key: item.source_key,
  status: item.status,
  rows_collected: item.rows_collected,
  rows_normalized: item.rows_normalized
})))}`);
console.log(`core_fetch_guard_present=${guard.core_fetch_guard_present}`);
console.log(`core_preset_cache_only=${guard.core_preset_cache_only}`);
console.log(`core_incorrectly_fetching_aux_apis=${guard.core_incorrectly_fetching_aux_apis}`);
console.log(`problems=${problems.length ? problems.join("; ") : "none"}`);

if (problems.length) process.exit(1);
