#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

const FILES = {
  sourceQuality: "dashboard/api/source-quality-score.json",
  utilization: "dashboard/api/enrichment-utilization.json",
  bottlenecks: "dashboard/api/enrichment/source-bottleneck-report.json",
  patchHints: "dashboard/api/aux/latest/patch-hints.json",
  pilotageSummary: "dashboard/api/aux/latest/pilotage-summary.json",
  berthSummary: "dashboard/api/aux/latest/berth-summary.json",
  aisInfoSummary: "dashboard/api/aux/latest/ais-info-summary.json",
  aisDynamicSummary: "dashboard/api/aux/latest/ais-dynamic-summary.json",
  vesselSpecSummary: "dashboard/api/aux/latest/vessel-spec-summary.json",
  sourceCsvSummary: "dashboard/api/aux/source-csv-summary.json",
  bootstrap: "dashboard/api/bootstrap.json",
  vesselDisplayReport: "dashboard/api/enrichment/vessel-display-propagation-report.json"
};

function abs(relativePath) {
  return path.join(ROOT, ...relativePath.split("/"));
}

function readJson(relativePath, fallback = {}) {
  try {
    const file = abs(relativePath);
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : fallback;
  } catch (error) {
    return { ...fallback, __parse_error: error.message };
  }
}

function items(payload = {}) {
  return Array.isArray(payload.items) ? payload.items : [];
}

function sourceItem(payload = {}, sourceKey = "") {
  return items(payload).find(item => item.source_key === sourceKey) || {};
}

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function sampleContradictions(utilization = {}) {
  return items(utilization).filter(item =>
    number(item.matched_vessels || item.rows_matched_to_vessels) <= 0 &&
    (item.sample_enriched_vessels || []).some(sample => Array.isArray(sample.fields_added) && sample.fields_added.length > 0)
  ).map(item => item.source_key);
}

const sourceQuality = readJson(FILES.sourceQuality, { items: [] });
const utilization = readJson(FILES.utilization, { items: [] });
const bottlenecks = readJson(FILES.bottlenecks, { items: [] });
const patchHints = readJson(FILES.patchHints, { items: [] });
const pilotage = readJson(FILES.pilotageSummary, {});
const berth = readJson(FILES.berthSummary, {});
const aisInfo = readJson(FILES.aisInfoSummary, {});
const aisDynamic = readJson(FILES.aisDynamicSummary, {});
const vesselSpec = readJson(FILES.vesselSpecSummary, {});
const sourceCsv = readJson(FILES.sourceCsvSummary, {});
const bootstrap = readJson(FILES.bootstrap, {});
const vesselDisplayReport = readJson(FILES.vesselDisplayReport, {});

const pilotQuality = sourceItem(sourceQuality, "pilot_sources");
const berthQuality = sourceItem(sourceQuality, "berth_sources");
const sourceCsvBottleneck = sourceItem(bottlenecks, "source_csv");
const vesselSpecBottleneck = sourceItem(bottlenecks, "vessel_spec");
const aisInfoBottleneck = sourceItem(bottlenecks, "mof_ais_info");
const aisDynamicBottleneck = sourceItem(bottlenecks, "mof_ais_dynamic");
const contradictions = sampleContradictions(utilization);
const hintItems = items(patchHints);
const malformedHints = hintItems.filter(item =>
  !item.vessel_key ||
  !item.source_key ||
  !item.signal_type ||
  !item.fields ||
  typeof item.fields !== "object" ||
  !["APPLY", "REVIEW", "REJECT"].includes(String(item.apply_policy || "").toUpperCase())
);
const problems = [];

if (contradictions.length) problems.push(`sample contradictions: ${contradictions.join(",")}`);
if (malformedHints.length) problems.push(`malformed patch hints: ${malformedHints.length}`);
if (
  sourceCsvBottleneck.bottleneck_stage &&
  sourceCsvBottleneck.bottleneck_stage !== "FETCH_BLOCKED" &&
  !["ACTIVE", "CACHE_AVAILABLE", "CACHE_ONLY_PREVIOUS_CACHE"].includes(String(sourceCsv.status || "").toUpperCase())
) {
  problems.push("source_csv bottleneck should be FETCH_BLOCKED unless the lightweight reference cache is active");
}
if (vesselSpecBottleneck.bottleneck_stage && vesselSpecBottleneck.bottleneck_stage !== "NORMALIZE_BLOCKED") problems.push("vessel_spec bottleneck should be NORMALIZE_BLOCKED");
if (aisInfoBottleneck.bottleneck_stage && aisInfoBottleneck.bottleneck_stage !== "COVERAGE_LIMITED") problems.push("mof_ais_info bottleneck should be COVERAGE_LIMITED");
if (aisDynamicBottleneck.bottleneck_stage && aisDynamicBottleneck.bottleneck_stage !== "COVERAGE_LIMITED") problems.push("mof_ais_dynamic bottleneck should be COVERAGE_LIMITED");

console.log("Enrichment strengthening audit");
console.log("=============================");
console.log(`pilot_rows=${number(pilotage.rows_collected || pilotQuality.rows_collected)}/${number(pilotage.rows_normalized || pilotQuality.rows_normalized)}/${number(pilotage.rows_matched_to_vessels || pilotage.matched_vessels || pilotQuality.rows_matched_to_vessels)}`);
console.log(`pilot_match_attempt_priority=${(pilotage.match_attempt_priority || []).join(",") || "not_recorded"}`);
console.log(`pilot_match_blockers=${(pilotage.match_blockers || pilotQuality.match_blockers || []).join(";") || pilotQuality.blocker_reason || "none"}`);
console.log(`berth_rows=${number(berth.rows_collected || berthQuality.rows_collected)}/${number(berth.rows_normalized || berthQuality.rows_normalized)}/${number(berth.rows_matched_to_vessels || berth.matched_vessels || berthQuality.rows_matched_to_vessels)}`);
console.log(`berth_match_attempt_priority=${(berth.match_attempt_priority || []).join(",") || "not_recorded"}`);
console.log(`berth_match_blockers=${(berth.match_blockers || berthQuality.match_blockers || []).join(";") || berthQuality.blocker_reason || "none"}`);
console.log(`patch_hints_created=${number(patchHints.patch_hints_created || patchHints.item_count || hintItems.length)} apply_policy_counts=${JSON.stringify(patchHints.apply_policy_counts || {})}`);
console.log(`patch_hints_malformed=${malformedHints.length}`);
console.log(`cached_patch_applied=${number(utilization.cached_patch_applied_count)} vessel_display_records_updated=${number(utilization.vessel_display_records_updated || utilization.count_reconciliation?.vessel_display_records_updated)}`);
console.log(`baseline_berth=${number(bootstrap.kpis?.baseline_berth_count || bootstrap.baseline_berth_count || vesselDisplayReport.output_scan_counts?.baseline_berth_count)} aux_confirmed_berth=${number(bootstrap.kpis?.aux_confirmed_berth_count || bootstrap.aux_confirmed_berth_count || vesselDisplayReport.output_scan_counts?.aux_confirmed_berth_count)}`);
console.log(`ais_info=${aisInfo.coverage_label || aisInfo.utilization_status || "unknown"} rows=${number(aisInfo.rows_collected)}/${number(aisInfo.rows_normalized)} hidden_identifiers=${Boolean(aisInfo.identifier_fields_hidden_in_display)}`);
console.log(`ais_dynamic=${aisDynamic.coverage_label || aisDynamic.utilization_status || "unknown"} rows=${number(aisDynamic.rows_collected)}/${number(aisDynamic.rows_normalized)} hidden_identifiers=${Boolean(aisDynamic.identifier_fields_hidden_in_display)}`);
console.log(`vessel_spec_parser_blocker=${vesselSpec.parser_blocker || vesselSpec.parser_blocker_classification || "none"} expected_aliases_missing=${(vesselSpec.expected_aliases_missing || []).join(",") || "none"}`);
console.log(`source_csv_status=${sourceCsv.status || "unknown"} source_too_large=${Boolean(sourceCsv.source_too_large)} blocker=${sourceCsv.blocker_reason || sourceCsv.skip_reason || sourceCsv.fix_hint || "none"}`);
console.log(`bottleneck_stage_counts=${JSON.stringify(bottlenecks.stage_counts || {})}`);
console.log(`enrichment_utilization_consistency=${contradictions.length ? "FAILED" : "OK"}`);
console.log(`problems=${problems.length ? problems.join("; ") : "none"}`);

if (problems.length) process.exit(1);
