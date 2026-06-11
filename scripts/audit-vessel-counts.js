#!/usr/bin/env node

import fs from "fs";
import path from "path";

const ROOT = process.cwd();
const VESSEL_PAGE_DIR = path.join(ROOT, "dashboard", "api", "vessels");

function readJson(relativePath) {
  const file = path.isAbsolute(relativePath) ? relativePath : path.join(ROOT, ...relativePath.split("/"));
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

function displayValue(record = {}, key) {
  return record?.[key] ?? record?.vessel_display?.[key] ?? null;
}

function tonnageSummary(record = {}) {
  return record.tonnage_summary || record.vessel_display?.tonnage_summary || {};
}

function gtValue(record = {}) {
  const summary = tonnageSummary(record);
  const candidates = [
    summary.gt,
    displayValue(record, "gt"),
    record.grtg,
    record.intrlGrtg,
    record.gross_tonnage,
    record.grossTonnage
  ];
  for (const candidate of candidates) {
    if (candidate === null || candidate === undefined || String(candidate).trim() === "" || String(candidate).trim() === "-") continue;
    const parsed = Number(String(candidate).replace(/,/g, ""));
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return null;
}

function compare(label, actual, expected, failures) {
  const a = number(actual, 0);
  const e = number(expected, 0);
  const ok = a === e;
  console.log(`- ${label}: ${a}${ok ? "" : ` (expected ${e})`}`);
  if (!ok) failures.push(`${label}: ${a} != ${e}`);
}

function pageFiles() {
  if (!fs.existsSync(VESSEL_PAGE_DIR)) return [];
  return fs.readdirSync(VESSEL_PAGE_DIR)
    .filter(name => /^page-\d+\.json$/.test(name))
    .sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));
}

function pageItems() {
  const rows = [];
  const failures = [];
  for (const file of pageFiles()) {
    const result = readJson(path.join(VESSEL_PAGE_DIR, file));
    if (result.error) {
      failures.push(`${file}: ${result.error}`);
      continue;
    }
    for (const item of items(result.data)) rows.push({ ...item, __page_file: file });
  }
  return { rows, failures };
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
const counts = reconciliation.counts || {};
const bootstrap = readJson("dashboard/api/bootstrap.json").data || {};
const vesselIndex = readJson("dashboard/api/vessels/index.json").data || {};
const excludedSummary = readJson("dashboard/api/vessels/excluded-summary.json").data || {};
const targets = readJson("dashboard/api/targets/current.json").data || {};
const pipeline = readJson("data/pipeline-report.json").data || {};
const kpis = bootstrap.kpis || {};
const targetItems = items(targets);
const { rows: vesselPageItems, failures: pageReadFailures } = pageItems();
const failures = [...pageReadFailures];
const warnings = [];

const rawRowsCollected = number(counts.raw_rows_collected ?? reconciliation.raw_rows_collected ?? reconciliation.raw_rows);
const totalDetected = number(counts.total_detected_vessels ?? reconciliation.total_detected_vessels ?? reconciliation.total_vessels);
const uniqueVesselCount = number(counts.unique_vessel_count ?? reconciliation.unique_vessel_count ?? totalDetected);
const gtKnown = number(counts.gt_known_count ?? reconciliation.gt_known_count);
const gt5000Plus = number(counts.gt_5000_plus_count ?? reconciliation.gt_5000_plus_count);
const gtBelow5000 = number(counts.gt_below_5000_count ?? reconciliation.gt_below_5000_count);
const gtUnknown = number(counts.gt_unknown_count ?? reconciliation.gt_unknown_count);
const detailEligible = number(counts.detail_eligible_vessel_count ?? reconciliation.detail_eligible_vessel_count ?? vesselIndex.total_count);
const salesTargetCount = number(counts.sales_target_count ?? reconciliation.sales_target_count);
const contactNowCount = number(counts.contact_now_count ?? reconciliation.contact_now_count);
const monitorCount = number(counts.monitor_count ?? reconciliation.monitor_count);
const detailPageTotal = number(vesselIndex.total_count ?? vesselIndex.record_count);
const excludedBelow5000 = number(excludedSummary.excluded_gt_below_5000_count ?? excludedSummary.gt_below_5000_count ?? 0);
const excludedUnknownGt = number(excludedSummary.excluded_gt_unknown_count ?? excludedSummary.gt_unknown_count ?? 0);
const exceptionIncludedCount = vesselPageItems.filter(item => item.detail_inclusion_exception === true || item.vessel_display?.detail_inclusion_exception === true).length;
const pageGtBelowWithoutException = vesselPageItems.filter(item => {
  const gt = gtValue(item);
  return gt !== null && gt < 5000 && !(item.detail_inclusion_exception || item.vessel_display?.detail_inclusion_exception);
});
const pageGtUnknownWithoutException = vesselPageItems.filter(item => {
  const gt = gtValue(item);
  return gt === null && !(item.detail_inclusion_exception || item.vessel_display?.detail_inclusion_exception);
});

console.log("Vessel count reconciliation audit:");
compare("raw_rows_collected", rawRowsCollected, pipeline.source_rows_collected ?? rawRowsCollected, failures);
compare("total_detected_vessels", totalDetected, kpis.total_detected_vessels ?? kpis.total_vessels ?? totalDetected, failures);
compare("unique_vessel_count", uniqueVesselCount, reconciliation.unique_vessel_count ?? totalDetected, failures);
compare("gt_known_count", gtKnown, gt5000Plus + gtBelow5000, failures);
compare("gt_5000_plus_count", gt5000Plus, reconciliation.gt_5000_plus_count ?? gt5000Plus, failures);
compare("gt_below_5000_count", gtBelow5000, excludedSummary.gt_below_5000_count ?? gtBelow5000, failures);
compare("gt_unknown_count", gtUnknown, excludedSummary.gt_unknown_count ?? gtUnknown, failures);
compare("detail_eligible_vessel_count", detailEligible, detailPageTotal, failures);
compare("detail page total_count", detailPageTotal, vesselPageItems.length, failures);
compare("sum of vessels/page-*.json items", vesselPageItems.length, detailEligible, failures);
compare("sales_target_count", salesTargetCount, kpis.sales_target_count ?? targets.record_count ?? targetItems.length, failures);
compare("contact_now_count", contactNowCount, kpis.contact_now_count, failures);
compare("monitor_count", monitorCount, kpis.monitor_count, failures);

console.log(`- excluded below-5000 count: ${excludedBelow5000}`);
console.log(`- excluded unknown-GT count: ${excludedUnknownGt}`);
console.log(`- exception-included count: ${exceptionIncludedCount}`);
console.log(`- page items with GT < 5000 without exception: ${pageGtBelowWithoutException.length}`);
console.log(`- page items with GT unknown without exception: ${pageGtUnknownWithoutException.length}`);

if (gt5000Plus + gtBelow5000 + gtUnknown !== totalDetected) {
  failures.push("gt_5000_plus_count + gt_below_5000_count + gt_unknown_count != total_detected_vessels");
}
if (detailPageTotal !== detailEligible) failures.push("vessels/index total_count != detail_eligible_vessel_count");
if (pageGtBelowWithoutException.length) failures.push("detail page includes GT < 5000 vessel without exception reason");
if (pageGtUnknownWithoutException.length) failures.push("GT unknown vessel included without exception reason");
if (rawRowsCollected === totalDetected && rawRowsCollected !== number(pipeline.source_rows_collected ?? rawRowsCollected)) {
  warnings.push("raw rows may be displayed as vessel count");
}

console.log("\nCount explanations:");
const explanationEntries = reconciliation.explanation && typeof reconciliation.explanation === "object"
  ? Object.entries(reconciliation.explanation).map(([field, explanation]) => ({ field, value: counts[field], explanation }))
  : Array.isArray(reconciliation.count_explanations) ? reconciliation.count_explanations : [];
for (const explanation of explanationEntries) {
  console.log(`- ${explanation.field}: ${explanation.value ?? ""} - ${explanation.explanation}`);
}

console.log("\nCount deltas:");
for (const [key, value] of Object.entries(reconciliation.count_deltas || {})) {
  console.log(`- ${key}: ${value}`);
}

if (warnings.length) {
  console.warn("\nWARN:");
  for (const warning of warnings) console.warn(`- ${warning}`);
}

if (failures.length) {
  console.error("\nFAIL:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("\nPASS: vessel count categories and detail page filtering are consistent.");
