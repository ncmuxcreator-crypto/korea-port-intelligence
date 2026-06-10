#!/usr/bin/env node

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const ENDPOINT_PATH = "dashboard/api/intelligence/opportunity-memory.json";

const REQUIRED_FIELDS = [
  "vessel_display",
  "hot_count_30d",
  "hot_count_90d",
  "warm_count_90d",
  "target_count_90d",
  "previous_priority_labels",
  "first_seen_as_target_at",
  "last_seen_as_target_at",
  "last_hot_at",
  "repeat_target_score",
  "reason_summary",
  "recommended_action"
];

const NUMERIC_FIELDS = [
  "hot_count_30d",
  "hot_count_90d",
  "warm_count_90d",
  "target_count_90d",
  "repeat_target_score"
];

function readJson(relativePath) {
  const fullPath = path.join(ROOT, relativePath);
  if (!fs.existsSync(fullPath)) return { error: "not_found", fullPath };
  try {
    return { value: JSON.parse(fs.readFileSync(fullPath, "utf8")), fullPath };
  } catch (error) {
    return { error: error.message, fullPath };
  }
}

function rows(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
}

function number(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function operatorRows(payload) {
  if (Array.isArray(payload?.extra?.operators)) return payload.extra.operators;
  if (Array.isArray(payload?.summary?.operators)) return payload.summary.operators;
  return [];
}

function vesselName(item = {}) {
  return item.vessel_display?.vessel_name || item.vessel_name || "선명 확인 필요";
}

const result = readJson(ENDPOINT_PATH);
console.log("Opportunity Memory Audit");
console.log("========================");
console.log(`- endpoint: ${ENDPOINT_PATH}`);

if (result.error) {
  console.error(`ERROR: ${result.error}`);
  console.error(`- path: ${result.fullPath}`);
  process.exit(1);
}

const payload = result.value;
const items = rows(payload);
const operators = operatorRows(payload);
const missingFieldRows = [];
const invalidNumericRows = [];
const duplicateIdentityRows = [];
const missingIdentityRows = [];

for (const [index, item] of items.entries()) {
  const missing = REQUIRED_FIELDS.filter(field => !(field in item));
  if (missing.length) missingFieldRows.push({ row: index + 1, vessel_name: vesselName(item), missing });
  const invalid = NUMERIC_FIELDS.filter(field => !Number.isFinite(Number(item[field])) || Number(item[field]) < 0);
  if (invalid.length) invalidNumericRows.push({ row: index + 1, vessel_name: vesselName(item), invalid });
  if (number(item.duplicate_rows_merged) > 0) duplicateIdentityRows.push(item);
  if (item.missing_identity || String(item.identity_confidence || "").toLowerCase() === "low") missingIdentityRows.push(item);
}

const totalTrackedVessels = number(payload.summary?.total_tracked_vessels || payload.extra?.all_vessel_count || items.length);
const repeatTargetVessels = number(payload.summary?.repeat_target_vessels || items.filter(item => number(item.target_count_90d) >= 2).length);
const repeatedHotVessels = number(payload.summary?.repeated_hot_vessels || items.filter(item => number(item.hot_count_90d) >= 2).length);
const operatorRepeatOpportunityCount = operators.filter(item => number(item.repeat_target_count) > 0 || number(item.hot_vessels_90d) > 0).length;
const duplicateIdentityGroups = number(payload.summary?.duplicate_identity_groups || payload.extra?.duplicate_identity_groups || duplicateIdentityRows.length);
const duplicateRowsMerged = number(payload.summary?.duplicate_rows_merged || payload.extra?.duplicate_rows_merged || duplicateIdentityRows.reduce((sum, item) => sum + number(item.duplicate_rows_merged), 0));

console.log(`- generated_at: ${payload.generated_at || "-"}`);
console.log(`- data_mode: ${payload.data_mode || "unknown"}`);
console.log(`- source_table: ${payload.source_table || "-"}`);
console.log(`- record_count: ${payload.record_count ?? items.length}`);
console.log(`- visible_items: ${items.length}`);
console.log(`- total_tracked_vessels: ${totalTrackedVessels}`);
console.log(`- repeat_target_vessels: ${repeatTargetVessels}`);
console.log(`- repeated_hot_vessels: ${repeatedHotVessels}`);
console.log(`- operator_repeat_opportunity_count: ${operatorRepeatOpportunityCount}`);
console.log(`- duplicate_identity_groups: ${duplicateIdentityGroups}`);
console.log(`- duplicate_rows_merged: ${duplicateRowsMerged}`);
console.log(`- low_or_missing_identity_items: ${missingIdentityRows.length}`);
console.log(`- identity_strategy: ${payload.summary?.identity_strategy || "IMO > MMSI > normalized vessel name + call sign + operator/port"}`);

if (!items.length) console.log("WARNING: opportunity-memory endpoint is empty.");
if (!operators.length) console.log("WARNING: operator-level summary is empty.");

if (missingFieldRows.length) {
  console.log("ERROR: required fields are missing.");
  for (const row of missingFieldRows.slice(0, 10)) {
    console.log(`  - row ${row.row} ${row.vessel_name}: ${row.missing.join(", ")}`);
  }
}

if (invalidNumericRows.length) {
  console.log("ERROR: numeric fields must be finite non-negative numbers.");
  for (const row of invalidNumericRows.slice(0, 10)) {
    console.log(`  - row ${row.row} ${row.vessel_name}: ${row.invalid.join(", ")}`);
  }
}

console.log("\nTop repeated vessel opportunities:");
items.slice(0, 10).forEach((item, index) => {
  console.log(`  ${index + 1}. ${vesselName(item)} | repeat_score=${number(item.repeat_target_score)} | HOT90=${number(item.hot_count_90d)} | target90=${number(item.target_count_90d)} | last_hot=${item.last_hot_at || "-"}`);
});

console.log("\nTop operator opportunity memory:");
operators.slice(0, 10).forEach((item, index) => {
  console.log(`  ${index + 1}. ${item.operator_name || "-"} | hot_vessels_90d=${number(item.hot_vessels_90d)} | target_vessels_90d=${number(item.target_vessels_90d)} | repeat_target_count=${number(item.repeat_target_count)} | score=${number(item.repeat_opportunity_score)}`);
});

if (duplicateIdentityRows.length) {
  console.log("\nDuplicate identity handling:");
  duplicateIdentityRows.slice(0, 10).forEach((item, index) => {
    console.log(`  ${index + 1}. ${vesselName(item)} | identity=${item.identity_match_type || "-"} | merged_rows=${number(item.duplicate_rows_merged)}`);
  });
} else {
  console.log("\nDuplicate identity handling: no duplicate rows merged in visible items.");
}

if (missingFieldRows.length || invalidNumericRows.length) process.exit(1);
