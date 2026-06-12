import fs from "node:fs";
import path from "node:path";
import { buildSourceQualityScorePayload } from "./lib/source-quality-score.js";

const ROOT = process.cwd();

function readJson(relativePath, fallback = null) {
  const filePath = path.join(ROOT, relativePath);
  try {
    return fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, "utf8")) : fallback;
  } catch (error) {
    return { __parse_error: error.message };
  }
}

function readDiagnosticJson(relativePath, fallback = null) {
  const main = readJson(relativePath, fallback);
  const debugPath = String(relativePath).replace(/^dashboard\/api\//, "dashboard/api/debug/");
  const debug = debugPath === relativePath ? null : readJson(debugPath, null);
  if (!debug || debug.__parse_error) return main;
  if (!main || main.__parse_error) return debug;
  const debugGenerated = Date.parse(debug.generated_at || "");
  const mainGenerated = Date.parse(main.generated_at || "");
  if (Number.isFinite(debugGenerated) && (!Number.isFinite(mainGenerated) || debugGenerated >= mainGenerated)) return debug;
  return main;
}

const existing = readDiagnosticJson("dashboard/api/source-quality-score.json", null);
const sourceCollectionStatus = readJson("dashboard/api/source-collection-status.json", {}) || {};
const status = readJson("dashboard/api/status.json", {}) || {};
const bootstrap = readJson("dashboard/api/bootstrap.json", {}) || {};
const matchingDiagnostics = readJson("dashboard/api/quality/matching-diagnostics.json", {}) || {};

const payload = existing?.items
  ? existing
  : buildSourceQualityScorePayload({
    sourceCollectionStatus,
    matchingDiagnostics,
    bootstrapKpis: bootstrap.kpis || {},
    report: status,
    generatedAt: sourceCollectionStatus.generated_at || new Date().toISOString(),
    dataMode: sourceCollectionStatus.data_mode || status.data_mode || "static_snapshot",
    referenceTime: new Date().toISOString()
  });

console.log("Source Quality Score Audit");
console.log("==========================");
console.log(`generated_at=${payload.generated_at || "unknown"}`);
console.log(`source_run_id=${payload.source_run_id || payload.run_id || "unknown"}`);
console.log(`record_count=${payload.record_count || 0}`);
console.log(`average_utilization_score=${payload.average_utilization_score ?? 0}`);
console.log(`quality_counts=${JSON.stringify(payload.quality_counts || {})}`);
console.log("");
console.log("Source | Configured | Attempted | Rows | Normalized | Matched | Fields | Freshness(min) | Score | Label | Blocker | Fix");

for (const item of payload.items || []) {
  console.log([
    item.source_key,
    item.configured ? "yes" : "no",
    item.attempted ? "yes" : "no",
    Number(item.rows_collected || 0),
    Number(item.rows_normalized || 0),
    Number(item.rows_matched_to_vessels || 0),
    (item.fields_contributed || []).join(",") || "-",
    item.freshness_minutes ?? "-",
    item.utilization_score ?? 0,
    item.quality_label || "-",
    item.blocker_reason || "-",
    item.recommended_fix || "-"
  ].join(" | "));
}

const failed = (payload.items || []).filter(item => item.quality_label === "FAILED");
const low = (payload.items || []).filter(item => item.quality_label === "LOW");
if (failed.length || low.length) {
  console.log("");
  console.log(`WARN: ${failed.length} failed source(s), ${low.length} low-quality source(s).`);
}

if (!existing?.items) {
  console.log("");
  console.log("WARN: dashboard/api/source-quality-score.json is missing; audit used an in-memory calculation.");
}
