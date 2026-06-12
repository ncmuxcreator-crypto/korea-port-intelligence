import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

function readJson(relativePath, fallback = {}) {
  try {
    const filePath = path.join(ROOT, relativePath);
    return fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, "utf8")) : fallback;
  } catch (error) {
    return { __parse_error: error.message };
  }
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

const summary = readJson("dashboard/api/aux/source-csv-summary.json", {});
const reference = readJson("dashboard/api/cache/source-csv-reference.json", null);
const index = readJson("dashboard/api/cache/source-csv-index.json", null);
const dryRun = readJson("dashboard/api/enrichment/source-csv-dry-run.json", {});
const sourceQuality = readJson("dashboard/api/source-quality-score.json", {});
const enrichmentSummary = readJson("dashboard/api/enrichment/summary.json", {});
const enrichmentApplied = readJson("dashboard/api/enrichment/applied.json", {});
const enrichmentReview = readJson("dashboard/api/enrichment/review-queue.json", {});

const quality = (sourceQuality.items || []).find(item => item.source_key === "source_csv") || {};
const bySource = enrichmentSummary.by_source?.source_csv || {};
const appliedItems = (enrichmentApplied.items || []).filter(item => item.source_key === "source_csv");
const reviewItems = (enrichmentReview.items || []).filter(item => item.source_key === "source_csv");
const indexCounts = index?.index_counts || summary.reference_index_keys || {};
const schemaIssues = summary.schema_issues || {};
const usableReferenceRows = number(summary.usable_reference_rows);
const maxAllowedBytes = number(summary.max_allowed_bytes || process.env.MAX_SOURCE_CSV_BYTES || process.env.MAX_API_RESPONSE_BYTES || 5000000);
const sourceTooLarge = Boolean(summary.source_too_large || summary.status === "SOURCE_TOO_LARGE" || number(summary.response_size_bytes) > maxAllowedBytes);
const lightweightDetected = Boolean(summary.is_probably_lightweight_reference_csv || usableReferenceRows > 0);
const schemaValid = usableReferenceRows > 0 && number(schemaIssues.rows_missing_all_identity_keys) < usableReferenceRows;
const blockers = [
  sourceTooLarge ? "SOURCE_CSV_URL still points to the large raw CSV." : "",
  !usableReferenceRows ? "No usable lightweight source_csv reference rows." : "",
  usableReferenceRows > 0 && !number(dryRun.matched_vessels) ? "Cache exists but no current vessels matched." : "",
  quality.quality_label === "FAILED" ? quality.blocker_reason || "source_csv quality is FAILED" : ""
].filter(Boolean);

console.log("Source CSV Enrichment Audit");
console.log("===========================");
console.log(`configured=${summary.configured ? "yes" : "no"}`);
console.log(`response_size_bytes=${number(summary.response_size_bytes)}`);
console.log(`max_allowed_bytes=${maxAllowedBytes}`);
console.log(`content_type=${summary.content_type || "-"}`);
console.log(`file_name_hint=${summary.file_name_hint || "-"}`);
console.log(`lightweight_csv_detected=${lightweightDetected ? "yes" : "no"}`);
console.log(`large_raw_csv_detected=${sourceTooLarge || summary.is_probably_large_raw_csv ? "yes" : "no"}`);
console.log(`schema_valid=${schemaValid ? "yes" : "no"}`);
console.log(`usable_reference_rows=${usableReferenceRows}`);
console.log(`rows_with_imo=${number(summary.rows_with_imo)}`);
console.log(`rows_with_mmsi=${number(summary.rows_with_mmsi)}`);
console.log(`rows_with_call_sign=${number(summary.rows_with_call_sign)}`);
console.log(`rows_with_operator=${number(summary.rows_with_operator)}`);
console.log(`cache_status=${summary.cache_status || reference?.status || "missing"}`);
console.log(`reference_file_exists=${reference ? "yes" : "no"}`);
console.log(`index_file_exists=${index ? "yes" : "no"}`);
console.log(`index_counts=${JSON.stringify(indexCounts)}`);
console.log(`dry_run_matches=${number(dryRun.matched_vessels)}`);
console.log(`matches_by_imo=${number(dryRun.matches_by_imo)}`);
console.log(`matches_by_mmsi=${number(dryRun.matches_by_mmsi)}`);
console.log(`matches_by_call_sign=${number(dryRun.matches_by_call_sign)}`);
console.log(`matches_by_name_call_sign=${number(dryRun.matches_by_name_call_sign)}`);
console.log(`matches_by_name_gt_type=${number(dryRun.matches_by_name_gt_type)}`);
console.log(`auto_apply_count=${number(dryRun.auto_apply_count)}`);
console.log(`review_count=${number(dryRun.review_count)}`);
console.log(`reject_count=${number(dryRun.reject_count)}`);
console.log(`applied_fields=${appliedItems.length || number(dryRun.applied_fields) || number(bySource.auto_applied)}`);
console.log(`review_queue_items=${reviewItems.length || number(dryRun.review_items) || number(bySource.needs_review)}`);
console.log(`source_quality_label=${quality.quality_label || "-"}`);
console.log(`source_quality_score=${number(quality.utilization_score)}`);
console.log(`blockers=${blockers.join(" | ") || "-"}`);
console.log(`recommended_fix=${sourceTooLarge ? "SOURCE_CSV_URL still points to the large raw CSV. Point it to the lightweight verified vessel reference CSV." : summary.recommended_fix || quality.recommended_fix || "-"}`);

if (sourceTooLarge && !summary.previous_cache_available) {
  console.log("WARN: SOURCE_CSV_URL is configured but still points to an oversized raw CSV and no previous cache is available.");
}
if (usableReferenceRows > 0 && !reference) {
  console.error("FAIL: usable source_csv rows exist but dashboard/api/cache/source-csv-reference.json is missing.");
  process.exitCode = 1;
}
if (usableReferenceRows > 0 && !index) {
  console.error("FAIL: usable source_csv rows exist but dashboard/api/cache/source-csv-index.json is missing.");
  process.exitCode = 1;
}
