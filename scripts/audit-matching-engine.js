#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const FILES = {
  normalization: "dashboard/api/enrichment/normalization-diagnostics.json",
  identityGraph: "dashboard/api/enrichment/vessel-identity-graph.json",
  sourceCsvDryRun: "dashboard/api/enrichment/source-csv-dry-run.json",
  pilotReview: "dashboard/api/review/pilotage-berth-matches.json",
  pilotageMatchResults: "dashboard/api/aux/latest/pilotage-match-results.json",
  berthMatchResults: "dashboard/api/aux/latest/berth-match-results.json",
  aisTargetEnrichment: "dashboard/api/aux/latest/ais-target-enrichment.json",
  vesselSpecParser: "dashboard/api/aux/latest/vessel-spec-parser-diagnostic.json",
  patchHints: "dashboard/api/aux/latest/patch-hints.json",
  enrichmentUtilization: "dashboard/api/enrichment-utilization.json",
  propagationReport: "dashboard/api/enrichment/vessel-display-propagation-report.json"
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

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const normalization = readJson(FILES.normalization, { items: [], __missing: true });
const identityGraph = readJson(FILES.identityGraph, { items: [], indexes: {}, __missing: true });
const sourceCsvDryRun = readJson(FILES.sourceCsvDryRun, {});
const pilotReview = readJson(FILES.pilotReview, {});
const pilotageMatchResults = readJson(FILES.pilotageMatchResults, { items: [], __missing: true });
const berthMatchResults = readJson(FILES.berthMatchResults, { items: [], __missing: true });
const aisTargetEnrichment = readJson(FILES.aisTargetEnrichment, { __missing: true });
const vesselSpecParser = readJson(FILES.vesselSpecParser, { __missing: true });
const patchHints = readJson(FILES.patchHints, { items: [], __missing: true });
const enrichmentUtilization = readJson(FILES.enrichmentUtilization, { items: [] });
const propagationReport = readJson(FILES.propagationReport, {});
const problems = [];

if (normalization.__missing) problems.push(`${FILES.normalization} missing`);
if (normalization.__parse_error) problems.push(`${FILES.normalization} parse error: ${normalization.__parse_error}`);
if (identityGraph.__missing) problems.push(`${FILES.identityGraph} missing`);
if (pilotageMatchResults.__missing) problems.push(`${FILES.pilotageMatchResults} missing`);
if (berthMatchResults.__missing) problems.push(`${FILES.berthMatchResults} missing`);
if (aisTargetEnrichment.__missing) problems.push(`${FILES.aisTargetEnrichment} missing`);
if (vesselSpecParser.__missing) problems.push(`${FILES.vesselSpecParser} missing`);
if (patchHints.__missing) problems.push(`${FILES.patchHints} missing`);

const items = Array.isArray(normalization.items) ? normalization.items : [];
const normalizedSources = items.filter(item => number(item.rows_normalized) > 0);
const sourcesWithoutKeys = normalizedSources.filter(item => number(item.rows_with_match_keys) === 0);
if (sourcesWithoutKeys.length) {
  problems.push(`normalized sources without match keys: ${sourcesWithoutKeys.map(item => item.source_key).join(",")}`);
}

const lowKeyCoverage = normalizedSources.filter(item => {
  const rows = number(item.rows_normalized);
  if (!rows) return false;
  return number(item.rows_with_match_keys) / rows < 0.5;
});
const indexKeys = Object.keys(identityGraph.indexes || {});
const graphSize = number(identityGraph.record_count || identityGraph.item_count || (identityGraph.items || []).length);
const pilotRate = number(pilotageMatchResults.match_rate);
const berthRate = number(berthMatchResults.match_rate);
const patchHintCount = number(patchHints.patch_hints_created || patchHints.item_count || (patchHints.items || []).length);
const reviewQueueSize = number(pilotageMatchResults.review_count) + number(berthMatchResults.review_count);
const utilizationPatchHints = number(enrichmentUtilization.patch_hints_created);
const coreApplied = number(
  enrichmentUtilization.cached_patch_applied_count ||
  enrichmentUtilization.patches_applied_to_vessel_display ||
  enrichmentUtilization.count_reconciliation?.patches_applied_to_vessel_display ||
  propagationReport.patch_hints_applied ||
  propagationReport.patches_applied
);

if (!graphSize) problems.push("identity graph has no nodes");
if (indexKeys.length < 5) problems.push("identity graph indexes incomplete");
if (patchHintCount < utilizationPatchHints) problems.push("patch hint count is lower than utilization summary");

console.log("Matching Engine Audit");
console.log("=====================");
console.log(`normalization_diagnostics=${normalization.__missing ? "missing" : "present"}`);
console.log(`normalization_sources=${items.length}`);
console.log(`normalized_sources=${normalizedSources.length}`);
console.log(`sources_without_match_keys=${sourcesWithoutKeys.map(item => item.source_key).join(",") || "none"}`);
console.log(`low_match_key_coverage=${lowKeyCoverage.map(item => `${item.source_key}:${item.rows_with_match_keys}/${item.rows_normalized}`).join(",") || "none"}`);
console.log(`identity_graph_size=${graphSize}`);
console.log(`identity_graph_current_vessels=${number(identityGraph.current_vessel_count)}`);
console.log(`identity_graph_indexes=${indexKeys.join(",") || "none"}`);
console.log(`matching_booster_available=${identityGraph.matching_booster_available === true ? "yes" : "no"}`);
console.log(`pilot_match_rate=${pilotRate}% apply=${number(pilotageMatchResults.apply_count)} review=${number(pilotageMatchResults.review_count)} reject=${number(pilotageMatchResults.reject_count)}`);
console.log(`berth_pnc_match_rate=${berthRate}% apply=${number(berthMatchResults.apply_count)} review=${number(berthMatchResults.review_count)} reject=${number(berthMatchResults.reject_count)}`);
console.log(`ais_target_batch_checked=${number(aisTargetEnrichment.target_vessels_checked)} info_matches=${number(aisTargetEnrichment.ais_info_matches)} dynamic_matches=${number(aisTargetEnrichment.ais_dynamic_matches)} coverage=${aisTargetEnrichment.coverage_label || "unknown"}`);
console.log(`vessel_spec_parser=${vesselSpecParser.parser_blocker || "unknown"} rows=${number(vesselSpecParser.rows_collected)}/${number(vesselSpecParser.rows_normalized)}`);
console.log(`patch_hints_created=${patchHintCount}`);
console.log(`patches_applied_in_core=${coreApplied}`);
console.log(`review_queue_size=${reviewQueueSize}`);
console.log(`pilot_blockers=${(pilotageMatchResults.top_blockers || []).map(item => `${item.reason}:${item.count}`).join(",") || "none"}`);
console.log(`berth_blockers=${(berthMatchResults.top_blockers || []).map(item => `${item.reason}:${item.count}`).join(",") || "none"}`);
console.log(`source_csv_matched_vessels=${number(sourceCsvDryRun.matched_vessels)} candidate_vessels_checked=${number(sourceCsvDryRun.candidate_vessels_checked)}`);
console.log(`pilot_review_items=${number(pilotReview.item_count || (pilotReview.items || []).length)}`);
console.log(`problems=${problems.length ? problems.join("; ") : "none"}`);

if (problems.length) process.exit(1);
