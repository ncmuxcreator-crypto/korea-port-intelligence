#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

function filePath(relativePath) {
  return path.join(ROOT, ...relativePath.split("/"));
}

function readJson(relativePath, fallback = {}) {
  const file = filePath(relativePath);
  try {
    if (!fs.existsSync(file)) return { ...fallback, _error: "not_found" };
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    return { ...fallback, _error: error.message };
  }
}

function rows(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.items)) return payload.items;
  return [];
}

function fmt(value) {
  return Number.isFinite(Number(value)) ? Number(value).toLocaleString("ko-KR") : String(value ?? "-");
}

function countSignal(items, key, predicate) {
  let count = 0;
  for (const item of items || []) {
    const d = item?.vessel_display && typeof item.vessel_display === "object" ? item.vessel_display : item;
    if (predicate(d?.[key])) count += 1;
  }
  return count;
}

function collectUiVisibleSignals() {
  const endpoints = [
    "dashboard/api/bootstrap.json",
    "dashboard/api/sales/actions.json",
    "dashboard/api/targets/current.json",
    "dashboard/api/watchlist/current.json"
  ];
  const vesselDir = filePath("dashboard/api/vessels");
  if (fs.existsSync(vesselDir)) {
    for (const file of fs.readdirSync(vesselDir)) {
      if (/^page-\d+\.json$/.test(file)) endpoints.push(`dashboard/api/vessels/${file}`);
    }
  }

  const result = {
    endpoints_checked: endpoints.length,
    ui_visible_records: 0,
    pilotage_signal_display_count: 0,
    berth_signal_display_count: 0,
    data_lineage_display_count: 0
  };

  for (const endpoint of endpoints) {
    const payload = readJson(endpoint, {});
    const items = Array.isArray(payload.top_candidates) ? payload.top_candidates : rows(payload);
    result.ui_visible_records += items.length;
    result.pilotage_signal_display_count += countSignal(items, "pilotage_signal", value => value?.has_pilotage === true);
    result.berth_signal_display_count += countSignal(items, "berth_signal", value => value?.has_berth_info === true || value?.has_berth === true);
    result.data_lineage_display_count += countSignal(items, "data_lineage", value => value && typeof value === "object");
  }

  return result;
}

function staleAgainst(reference, payload) {
  if (!reference?.generated_at || !payload?.generated_at) return false;
  return String(reference.generated_at) !== String(payload.generated_at);
}

const bootstrap = readJson("dashboard/api/bootstrap.json", {});
const statusSummary = readJson("dashboard/api/status-summary.json", {});
const sourceQuality = readJson("dashboard/api/source-quality-score.json", { items: [] });
const utilization = readJson("dashboard/api/enrichment-utilization.json", { items: [] });
const candidates = readJson("dashboard/api/enrichment/candidates.json", { items: [] });
const applied = readJson("dashboard/api/enrichment/applied.json", { items: [] });
const review = readJson("dashboard/api/enrichment/review-queue.json", { items: [] });
const summary = readJson("dashboard/api/enrichment/summary.json", {});
const uiSignals = collectUiVisibleSignals();

const sourceRowsCollected = rows(sourceQuality).reduce((sum, item) => sum + Number(item.rows_collected || 0), 0);
const sourceRowsNormalized = rows(sourceQuality).reduce((sum, item) => sum + Number(item.rows_normalized || 0), 0);
const sourceRowsMatched = rows(sourceQuality).reduce((sum, item) => sum + Number(item.rows_matched_to_vessels || 0), 0);
const conflicts = rows(review).filter(item => item.conflict_type && item.conflict_type !== "LOW_CONFIDENCE_FUZZY_MATCH");
const staleFiles = [
  ["source-quality-score", sourceQuality],
  ["enrichment-utilization", utilization],
  ["enrichment-summary", summary],
  ["enrichment-candidates", candidates],
  ["enrichment-applied", applied],
  ["enrichment-review-queue", review]
].filter(([, payload]) => staleAgainst(bootstrap, payload));

console.log("Enrichment Quality Audit");
console.log("========================");
console.log(`bootstrap_generated_at=${bootstrap.generated_at || "-"}`);
console.log(`status_summary_generated_at=${statusSummary.generated_at || "-"}`);
console.log(`run_id=${bootstrap.run_id || statusSummary.run_id || "-"}`);
console.log(`latest_successful_run_id=${bootstrap.latest_successful_run_id || statusSummary.latest_successful_run_id || "-"}`);
console.log("");
console.log("Flow counts");
console.log(`A source_rows_collected=${fmt(sourceRowsCollected)}`);
console.log(`B source_rows_normalized=${fmt(sourceRowsNormalized)}`);
console.log(`C source_rows_matched_to_vessels=${fmt(sourceRowsMatched)}`);
console.log(`D enrichment_candidates_created=${fmt(rows(candidates).length || summary.enrichment_candidates_created || summary.total_candidates || 0)}`);
console.log(`E enrichment_patches_applied=${fmt(rows(applied).length || summary.enrichment_patches_applied || summary.auto_applied || 0)}`);
console.log(`F vessel_display_records_updated=${fmt(summary.vessel_display_records_updated || utilization.count_reconciliation?.vessel_display_records_updated || 0)}`);
console.log(`G UI_visible_records=${fmt(uiSignals.ui_visible_records)}`);
console.log("");
console.log("Visible signals");
console.log(`bootstrap.pilotage_detected_count=${fmt(bootstrap.kpis?.pilotage_detected_count || bootstrap.pilotage_detected_count || 0)}`);
console.log(`bootstrap.berth_info_detected_count=${fmt(bootstrap.kpis?.berth_info_detected_count || bootstrap.berth_info_detected_count || 0)}`);
console.log(`enrichment-utilization.pilotage_signal_count=${fmt(utilization.pilotage_signal_count || 0)} display=${fmt(utilization.pilotage_signal_display_count || 0)}`);
console.log(`enrichment-utilization.berth_signal_count=${fmt(utilization.berth_signal_count || 0)} display=${fmt(utilization.berth_signal_display_count || 0)}`);
console.log(`ui.pilotage_signal_display_count=${fmt(uiSignals.pilotage_signal_display_count)}`);
console.log(`ui.berth_signal_display_count=${fmt(uiSignals.berth_signal_display_count)}`);
console.log(`ui.data_lineage_display_count=${fmt(uiSignals.data_lineage_display_count)}`);
console.log("");
console.log("Review and blockers");
console.log(`review_queue_size=${fmt(rows(review).length)}`);
console.log(`conflicts=${fmt(conflicts.length)}`);
for (const item of rows(sourceQuality)) {
  if (item.blocker_reason || item.coverage_label === "SMOKE_LEVEL") {
    console.log(`- ${item.source_key}: ${item.coverage_label || item.quality_label || "-"} ${item.blocker_reason || item.coverage_note || ""}`);
  }
}
for (const gap of utilization.display_gap_explanations || []) {
  console.log(`- display_gap ${gap.signal}: matched=${gap.matched_count}, display=${gap.display_count}, reason=${gap.reason}`);
}

const problems = [];
for (const [name, payload] of staleFiles) {
  problems.push(`${name} generated_at ${payload.generated_at || "missing"} differs from bootstrap ${bootstrap.generated_at || "missing"}`);
}
if (rows(candidates).length !== Number(summary.total_candidates || rows(candidates).length)) {
  problems.push(`candidate count mismatch: candidates=${rows(candidates).length}, summary=${summary.total_candidates}`);
}
if (rows(applied).length !== Number(summary.auto_applied || rows(applied).length)) {
  problems.push(`applied count mismatch: applied=${rows(applied).length}, summary=${summary.auto_applied}`);
}
if (Number(utilization.pilotage_signal_count || 0) > 0 && Number(utilization.pilotage_signal_display_count || 0) === 0) {
  problems.push("pilotage source matches exist but enrichment-utilization display count is 0");
}
if (Number(utilization.berth_signal_count || 0) > 0 && Number(utilization.berth_signal_display_count || 0) === 0) {
  problems.push("berth source matches exist but enrichment-utilization display count is 0");
}

if (problems.length) {
  console.log("");
  console.warn("Problems");
  for (const problem of problems) console.warn(`- ${problem}`);
  process.exitCode = 1;
}
