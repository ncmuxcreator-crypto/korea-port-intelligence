import fs from "node:fs";
import path from "node:path";
import { buildSourceEnrichmentMatrixPayload, MATRIX_SOURCE_KEYS } from "./lib/source-enrichment-matrix.js";

const ROOT = process.cwd();

function readJson(relativePath, fallback = null) {
  const filePath = path.join(ROOT, relativePath);
  try {
    return fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, "utf8")) : fallback;
  } catch (error) {
    return { __parse_error: error.message };
  }
}

const existing = readJson("dashboard/api/enrichment/source-capability-matrix.json", null);
const sourceCollectionStatus = readJson("dashboard/api/source-collection-status.json", {}) || {};
const sourceQualityScore = readJson("dashboard/api/source-quality-score.json", {}) || {};

const payload = existing?.items
  ? existing
  : buildSourceEnrichmentMatrixPayload({
    sourceCollectionStatus,
    sourceQualityScore,
    generatedAt: sourceQualityScore.generated_at || sourceCollectionStatus.generated_at || new Date().toISOString(),
    dataMode: sourceQualityScore.data_mode || sourceCollectionStatus.data_mode || "static_snapshot"
  });

console.log("Source Enrichment Capability Matrix Audit");
console.log("=========================================");
console.log(`generated_at=${payload.generated_at || "unknown"}`);
console.log(`run_id=${payload.run_id || "unknown"}`);
console.log(`record_count=${payload.record_count || 0}`);
console.log(`active_sources=${payload.summary?.active_sources ?? 0}`);
console.log(`blocked_sources=${payload.summary?.blocked_sources ?? 0}`);
console.log("");
console.log("Source | Trust | Status | Rows | Normalized | Matched | Available | Enrichable | Match Keys | Blocker");

const missingRequired = [];
const malformed = [];
const byKey = new Map((payload.items || []).map(item => [item.source_key, item]));

for (const sourceKey of MATRIX_SOURCE_KEYS) {
  const item = byKey.get(sourceKey);
  if (!item) {
    missingRequired.push(sourceKey);
    continue;
  }
  const utilization = item.current_utilization || {};
  if (!Array.isArray(item.available_fields) || !Array.isArray(item.enrichable_fields) || !Array.isArray(item.match_keys)) {
    malformed.push(sourceKey);
  }
  console.log([
    item.source_key,
    item.trust_level || "-",
    utilization.status || "-",
    Number(utilization.rows_collected || 0),
    Number(utilization.rows_normalized || 0),
    Number(utilization.rows_matched_to_vessels || 0),
    (item.available_fields || []).join(",") || "-",
    (item.enrichable_fields || []).join(",") || "-",
    (item.match_keys || []).join(",") || "-",
    item.blocker_reason || "-"
  ].join(" | "));
}

let failed = false;
if (missingRequired.length) {
  failed = true;
  console.error(`FAIL: Missing required source(s): ${missingRequired.join(", ")}`);
}
if (malformed.length) {
  failed = true;
  console.error(`FAIL: Malformed matrix entries: ${malformed.join(", ")}`);
}

const sourceCsv = byKey.get("source_csv");
if (sourceCsv?.current_utilization?.status === "SOURCE_TOO_LARGE" && !sourceCsv.blocker_reason) {
  failed = true;
  console.error("FAIL: source_csv is SOURCE_TOO_LARGE but blocker_reason is empty.");
}

if (!existing?.items) {
  console.log("");
  console.log("WARN: dashboard/api/enrichment/source-capability-matrix.json is missing; audit used an in-memory calculation.");
}

if (failed) {
  process.exitCode = 1;
}
