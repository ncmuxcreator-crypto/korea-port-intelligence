#!/usr/bin/env node

import fs from "fs";
import path from "path";

const ROOT = process.cwd();

function readJson(relativePath) {
  const file = path.join(ROOT, ...relativePath.split("/"));
  if (!fs.existsSync(file)) return { exists: false, data: null, error: "missing" };
  try {
    return { exists: true, data: JSON.parse(fs.readFileSync(file, "utf8")), error: "" };
  } catch (error) {
    return { exists: true, data: null, error: error?.message || String(error) };
  }
}

function items(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.vessels)) return payload.vessels;
  if (Array.isArray(payload?.candidates)) return payload.candidates;
  if (Array.isArray(payload?.opportunities)) return payload.opportunities;
  return [];
}

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function compare(label, actual, expected, mismatches) {
  const a = number(actual, 0);
  const e = number(expected, 0);
  const ok = a === e;
  console.log(`- ${label}: ${a}${ok ? "" : ` (expected ${e})`}`);
  if (!ok) mismatches.push(`${label}: ${a} != ${e}`);
}

const reconciliationResult = readJson("dashboard/api/vessel-count-reconciliation.json");
if (!reconciliationResult.exists) {
  console.error("vessel-count-reconciliation.json missing. Run npm run update first.");
  process.exit(1);
}
if (reconciliationResult.error) {
  console.error(`vessel-count-reconciliation.json invalid JSON: ${reconciliationResult.error}`);
  process.exit(1);
}

const reconciliation = reconciliationResult.data || {};
const bootstrap = readJson("dashboard/api/bootstrap.json").data || {};
const vesselIndex = readJson("dashboard/api/vessels/index.json").data || {};
const targets = readJson("dashboard/api/targets/current.json").data || {};
const salesActions = readJson("dashboard/api/sales/actions.json").data || {};
const pipeline = readJson("data/pipeline-report.json").data || {};
const kpis = bootstrap.kpis || {};
const targetItems = items(targets);
const salesActionItems = items(salesActions);
const mismatches = [];

console.log("Vessel count reconciliation audit:");
compare("raw_rows", reconciliation.raw_rows, pipeline.source_rows_collected ?? reconciliation.raw_rows, mismatches);
compare("normalized_rows", reconciliation.normalized_rows, pipeline.normalized_rows ?? reconciliation.normalized_rows, mismatches);
compare("total_vessels", reconciliation.total_vessels, kpis.total_vessels ?? bootstrap.record_count, mismatches);
compare("display_vessel_count", reconciliation.display_vessel_count, vesselIndex.total_count ?? vesselIndex.record_count, mismatches);
compare("sales_target_count", reconciliation.sales_target_count, kpis.sales_target_count ?? targets.record_count ?? targetItems.length, mismatches);
compare("sales_actions_count", reconciliation.sales_actions_count, salesActions.item_count ?? salesActionItems.length, mismatches);
compare("contact_now_count", reconciliation.contact_now_count, kpis.contact_now_count, mismatches);
compare("monitor_count", reconciliation.monitor_count, kpis.monitor_count, mismatches);

console.log(`- gt_5000_plus_count: ${number(reconciliation.gt_5000_plus_count)}`);
console.log(`- monitor_candidate_count: ${number(reconciliation.monitor_candidate_count)}`);
console.log(`- excluded_count: ${number(reconciliation.excluded_count)}`);
console.log(`- duplicate_removed_count: ${number(reconciliation.duplicate_removed_count)}`);
console.log(`- display_coverage_pct: ${number(reconciliation.ratios?.display_coverage_pct)}%`);
console.log(`- sales_target_ratio_pct: ${number(reconciliation.ratios?.sales_target_ratio_pct)}%`);

console.log("\nCount explanations:");
for (const explanation of Array.isArray(reconciliation.count_explanations) ? reconciliation.count_explanations : []) {
  console.log(`- ${explanation.field}: ${explanation.value} — ${explanation.explanation}`);
}

console.log("\nCount deltas:");
for (const [key, value] of Object.entries(reconciliation.count_deltas || {})) {
  console.log(`- ${key}: ${value}`);
}

if (!Array.isArray(reconciliation.count_explanations) || reconciliation.count_explanations.length === 0) {
  mismatches.push("count_explanations missing");
}
if (number(reconciliation.display_vessel_count) > number(reconciliation.normalized_rows)) {
  mismatches.push("display_vessel_count exceeds normalized_rows");
}
if (number(reconciliation.duplicate_removed_count) !== Math.max(0, number(reconciliation.normalized_rows) - number(reconciliation.display_vessel_count))) {
  mismatches.push("duplicate_removed_count does not equal normalized_rows - display_vessel_count");
}

if (mismatches.length) {
  console.error("\nFAIL:");
  for (const mismatch of mismatches) console.error(`- ${mismatch}`);
  process.exit(1);
}

console.log("\nPASS: vessel count reconciliation is consistent.");
