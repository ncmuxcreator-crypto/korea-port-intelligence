import fs from "node:fs";
import path from "node:path";
import {
  buildSourceCsvSummary,
  readSourceCsvReferenceCache,
  SOURCE_CSV_REFERENCE_CACHE_PATH,
  SOURCE_CSV_SUMMARY_PATH
} from "./lib/source-csv-cache.js";
import { buildSourceCollectionStatus } from "./lib/source-activation.js";

const ROOT = process.cwd();

function readJson(relativePath, fallback = null) {
  try {
    const filePath = path.join(ROOT, relativePath);
    return fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, "utf8")) : fallback;
  } catch (error) {
    return { __parse_error: error.message };
  }
}

const status = readJson("dashboard/api/status.json", {});
const sourceCollectionStatus = readJson("dashboard/api/source-collection-status.json", null);
const localSourceCollectionStatus = readJson("dashboard/api/debug/source-collection-status-local.json", null);
const isGithubActionsRuntime = process.env.GITHUB_ACTIONS === "true" || Boolean(process.env.GITHUB_RUN_ID || process.env.GITHUB_WORKFLOW);
const selectedSourceStatus = !isGithubActionsRuntime && localSourceCollectionStatus?.items
  ? localSourceCollectionStatus
  : sourceCollectionStatus;
const sourceStatus = selectedSourceStatus?.items
  ? selectedSourceStatus
  : buildSourceCollectionStatus({
    report: status,
    collectorDiagnostics: status.collector_diagnostics || {},
    generatedAt: new Date().toISOString()
  });
const summaryFile = readJson(SOURCE_CSV_SUMMARY_PATH, null);
const cache = readSourceCsvReferenceCache(SOURCE_CSV_REFERENCE_CACHE_PATH);
const summary = summaryFile && !summaryFile.__parse_error
  ? summaryFile
  : buildSourceCsvSummary({
    sourceCollectionStatus: sourceStatus,
    collectorDiagnostics: status.collector_diagnostics || {},
    cache,
    generatedAt: new Date().toISOString()
  });
const maxAllowedBytes = Number(summary.max_allowed_bytes || process.env.MAX_SOURCE_CSV_BYTES || process.env.MAX_API_RESPONSE_BYTES || 5000000);
const sourceTooLarge = Boolean(summary.source_too_large || summary.status === "SOURCE_TOO_LARGE" || Number(summary.response_size_bytes || 0) > maxAllowedBytes);
const probablyLargeRawCsv = Boolean(summary.is_probably_large_raw_csv || sourceTooLarge);
const probablyLightweightCsv = Boolean(summary.is_probably_lightweight_reference_csv || Number(summary.usable_reference_rows || 0) > 0);
const recommendedFix = sourceTooLarge
  ? "SOURCE_CSV_URL still points to the large raw CSV. Point it to the lightweight verified vessel reference CSV."
  : summary.recommended_fix || summary.recommendation || "Create a smaller verified vessel reference CSV and set SOURCE_CSV_URL to that file.";

console.log("Source CSV Reference Cache Audit");
console.log("================================");
console.log(`configured=${summary.configured ? "yes" : "no"}`);
console.log(`collector_enabled=${summary.collector_enabled ? "yes" : "no"}`);
console.log(`collector_attempted=${summary.collector_attempted ? "yes" : "no"}`);
console.log(`status=${summary.status || "unknown"}`);
console.log(`source_layer=${summary.source_layer || "auxiliary"}`);
console.log(`core_blocking=${summary.core_blocking === false ? "false" : "true"}`);
console.log(`response_size_bytes=${Number(summary.response_size_bytes || 0)}`);
console.log(`max_allowed_bytes=${maxAllowedBytes}`);
console.log(`content_type=${summary.content_type || "-"}`);
console.log(`file_name_hint=${summary.file_name_hint || "-"}`);
console.log(`header_row_fields=${(summary.header_row_fields || []).join(",") || "-"}`);
console.log(`row_count_estimate=${summary.row_count_estimate ?? "-"}`);
console.log(`is_probably_large_raw_csv=${probablyLargeRawCsv ? "yes" : "no"}`);
console.log(`is_probably_lightweight_reference_csv=${probablyLightweightCsv ? "yes" : "no"}`);
console.log(`source_too_large=${sourceTooLarge ? "yes" : "no"}`);
console.log(`previous_cache_available=${summary.previous_cache_available ? "yes" : "no"}`);
console.log(`using_previous_cache=${summary.using_previous_cache ? "yes" : "no"}`);
console.log(`rows_collected=${Number(summary.rows_collected || 0)}`);
console.log(`rows_normalized=${Number(summary.rows_normalized || 0)}`);
console.log(`usable_reference_rows=${Number(summary.usable_reference_rows || 0)}`);
console.log(`rows_with_imo=${Number(summary.rows_with_imo || 0)}`);
console.log(`rows_with_mmsi=${Number(summary.rows_with_mmsi || 0)}`);
console.log(`rows_with_call_sign=${Number(summary.rows_with_call_sign || 0)}`);
console.log(`rows_with_operator=${Number(summary.rows_with_operator || 0)}`);
console.log(`cache_status=${summary.cache_status || cache.status || "unknown"}`);
console.log(`cache_age_hours=${summary.cache_age_hours ?? "-"}`);
console.log(`last_success_at=${summary.last_success_at || "-"}`);
console.log(`fields_available=${(summary.fields_available || []).join(",") || "-"}`);
console.log(`missing_recommended_columns=${(summary.missing_recommended_columns || []).join(",") || "-"}`);
console.log(`reference_indexes_built=${summary.reference_indexes_built ? "yes" : "no"}`);
console.log(`reference_index_keys=${JSON.stringify(summary.reference_index_keys || {})}`);
console.log(`schema_issues=${JSON.stringify(summary.schema_issues || {})}`);
console.log(`duplicate_issues=${JSON.stringify(summary.duplicate_issues || {})}`);
console.log(`summary_endpoint=${SOURCE_CSV_SUMMARY_PATH}`);
console.log(`cache_file=${SOURCE_CSV_REFERENCE_CACHE_PATH}`);
console.log(`recommended_next_action=${recommendedFix}`);

if (sourceTooLarge) {
  console.log("WARN: SOURCE_CSV_URL response exceeds MAX_API_RESPONSE_BYTES; using previous lightweight cache if available.");
}
if (summary.configured && summary.source_too_large && Number(summary.usable_reference_rows || 0) === 0) {
  console.log("WARN: source_csv is configured but no usable lightweight cache is available.");
}
