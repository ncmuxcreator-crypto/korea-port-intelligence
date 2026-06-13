import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const SOURCES = [
  ["vessel_spec", "dashboard/api/aux/latest/vessel-spec-summary.json"],
  ["ulsan_vessel_operation", "dashboard/api/aux/ulsan-summary.json"],
  ["port_facility", "dashboard/api/aux/latest/port-facility-summary.json"]
];

function readJson(relativePath, fallback = {}) {
  try {
    const filePath = path.join(ROOT, relativePath);
    return fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, "utf8")) : fallback;
  } catch (error) {
    return { __parse_error: error.message };
  }
}

function writeJson(relativePath, payload) {
  const filePath = path.join(ROOT, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));
}

function number(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

const sourceQuality = readJson("dashboard/api/source-quality-score.json", { items: [] });
const cacheStatus = readJson("dashboard/api/aux/latest/cache-status.json", readJson("dashboard/api/aux/cache-status.json", { items: [] }));
const patchHints = readJson("dashboard/api/aux/latest/patch-hints.json", { items: [] });
const qualityByKey = new Map((sourceQuality.items || []).map(item => [item.source_key, item]));
const cacheByKey = new Map((cacheStatus.items || []).map(item => [item.source_key, item]));
const patchCounts = (patchHints.items || []).reduce((acc, item) => {
  const key = item.source_key || item.normalized_source_key || "unknown";
  acc[key] = (acc[key] || 0) + 1;
  return acc;
}, {});

const items = SOURCES.map(([sourceKey, summaryPath]) => {
  const summary = readJson(summaryPath, {});
  const quality = qualityByKey.get(sourceKey) || {};
  const cache = cacheByKey.get(sourceKey) || {};
  return {
    source_key: sourceKey,
    summary_endpoint: summaryPath,
    status: summary.status || quality.quality_label || "UNKNOWN",
    configured: Boolean(summary.configured ?? quality.configured),
    attempted: Boolean(summary.attempted ?? summary.collector_attempted ?? quality.attempted),
    rows_collected: number(summary.rows_collected || summary.raw_rows || quality.rows_collected),
    rows_normalized: number(summary.rows_normalized || summary.normalized_rows || quality.rows_normalized),
    rows_matched_to_vessels: number(summary.rows_matched_to_vessels || summary.matched_vessels || quality.rows_matched_to_vessels),
    patch_hints: number(patchCounts[sourceKey]),
    core_blocking: false,
    owner_tier: summary.owner_tier || "fast_aux",
    core_may_update: false,
    fields_contributed: summary.fields_contributed || quality.fields_contributed || [],
    parser_alias_coverage: summary.parser_alias_coverage || {},
    raw_sample_keys: summary.raw_sample_keys || [],
    cache_status: cache.cache_status || summary.cache_status || "UNKNOWN",
    using_previous_cache: Boolean(cache.using_previous_cache || summary.using_previous_cache),
    blocker_reason: summary.blocker_reason || quality.blocker_reason || "",
    recommended_fix: summary.recommended_fix || quality.recommended_fix || ""
  };
});

const report = {
  schema_version: "1.0",
  generated_at: new Date().toISOString(),
  record_count: items.length,
  item_count: items.length,
  core_blocking_count: items.filter(item => item.core_blocking).length,
  total_patch_hints: items.reduce((sum, item) => sum + item.patch_hints, 0),
  items
};

writeJson("dashboard/api/aux/aux-enrichment-sources-audit.json", report);

console.log("Aux Enrichment Sources Audit");
console.log("============================");
for (const item of items) {
  console.log(`${item.source_key} | status=${item.status} | rows=${item.rows_collected}/${item.rows_normalized} | matched=${item.rows_matched_to_vessels} | patch_hints=${item.patch_hints} | core_blocking=${item.core_blocking}`);
}
console.log("audit_report=dashboard/api/aux/aux-enrichment-sources-audit.json");
