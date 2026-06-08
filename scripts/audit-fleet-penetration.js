#!/usr/bin/env node

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const ENDPOINT_PATH = "dashboard/api/intelligence/fleet-penetration.json";

const REQUIRED_FIELDS = [
  "operator_name",
  "fleet_size_korea",
  "targeted_vessels",
  "contacted_vessels",
  "quoted_vessels",
  "won_vessels",
  "lost_vessels",
  "penetration_rate",
  "quote_rate",
  "win_rate",
  "opportunity_gap",
  "estimated_remaining_revenue",
  "recommended_next_action"
];

const NUMERIC_FIELDS = [
  "fleet_size_korea",
  "targeted_vessels",
  "contacted_vessels",
  "quoted_vessels",
  "won_vessels",
  "lost_vessels",
  "penetration_rate",
  "quote_rate",
  "win_rate",
  "opportunity_gap",
  "estimated_remaining_revenue"
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

function average(items, field) {
  if (!items.length) return 0;
  return Math.round((items.reduce((sum, item) => sum + number(item[field]), 0) / items.length) * 10) / 10;
}

function sum(items, field) {
  return items.reduce((total, item) => total + number(item[field]), 0);
}

const result = readJson(ENDPOINT_PATH);
console.log("Fleet Penetration Audit");
console.log("========================");
console.log(`- endpoint: ${ENDPOINT_PATH}`);

if (result.error) {
  console.error(`ERROR: ${result.error}`);
  console.error(`- path: ${result.fullPath}`);
  process.exit(1);
}

const payload = result.value;
const items = rows(payload);
const missingFieldRows = [];
const invalidNumericRows = [];

for (const [index, item] of items.entries()) {
  const missing = REQUIRED_FIELDS.filter(field => !(field in item));
  if (missing.length) missingFieldRows.push({ row: index + 1, operator_name: item.operator_name || "-", missing });
  const invalid = NUMERIC_FIELDS.filter(field => !Number.isFinite(Number(item[field])) || Number(item[field]) < 0);
  if (invalid.length) invalidNumericRows.push({ row: index + 1, operator_name: item.operator_name || "-", invalid });
}

const operatorCount = items.length;
const unknownOperator = items.find(item => item.operator_name === "미확인 운영사");
const totalFleetSize = sum(items, "fleet_size_korea");
const totalTargeted = sum(items, "targeted_vessels");
const totalContacted = sum(items, "contacted_vessels");
const totalQuoted = sum(items, "quoted_vessels");
const totalWon = sum(items, "won_vessels");
const totalLost = sum(items, "lost_vessels");
const totalRemainingRevenue = sum(items, "estimated_remaining_revenue");

console.log(`- generated_at: ${payload.generated_at || "-"}`);
console.log(`- data_mode: ${payload.data_mode || "unknown"}`);
console.log(`- source_table: ${payload.source_table || "-"}`);
console.log(`- record_count: ${payload.record_count ?? items.length}`);
console.log(`- operator_count: ${operatorCount}`);
console.log(`- fleet_size_korea_total: ${totalFleetSize}`);
console.log(`- targeted_vessels_total: ${totalTargeted}`);
console.log(`- contacted_vessels_total: ${totalContacted}`);
console.log(`- quoted_vessels_total: ${totalQuoted}`);
console.log(`- won_vessels_total: ${totalWon}`);
console.log(`- lost_vessels_total: ${totalLost}`);
console.log(`- average_penetration_rate: ${average(items, "penetration_rate")}%`);
console.log(`- average_quote_rate: ${average(items, "quote_rate")}%`);
console.log(`- average_win_rate: ${average(items, "win_rate")}%`);
console.log(`- estimated_remaining_revenue_total: ${Math.round(totalRemainingRevenue)}`);
console.log(`- unknown_operator_group_present: ${unknownOperator ? "yes" : "no"}`);

if (!items.length) {
  console.log("WARNING: fleet penetration endpoint is empty.");
}
if (missingFieldRows.length) {
  console.log("ERROR: required fields are missing.");
  for (const row of missingFieldRows.slice(0, 10)) {
    console.log(`  - row ${row.row} ${row.operator_name}: ${row.missing.join(", ")}`);
  }
}
if (invalidNumericRows.length) {
  console.log("ERROR: numeric fields must be finite non-negative numbers.");
  for (const row of invalidNumericRows.slice(0, 10)) {
    console.log(`  - row ${row.row} ${row.operator_name}: ${row.invalid.join(", ")}`);
  }
}
if (totalContacted === 0 && totalQuoted === 0 && totalWon === 0 && totalLost === 0) {
  console.log("INFO: private sales history appears empty; contact/quote/win/loss counts are correctly reported as 0.");
}

console.log("\nTop operators:");
items
  .slice()
  .sort((a, b) =>
    number(b.estimated_remaining_revenue) - number(a.estimated_remaining_revenue) ||
    number(b.opportunity_gap) - number(a.opportunity_gap) ||
    number(b.penetration_rate) - number(a.penetration_rate)
  )
  .slice(0, 10)
  .forEach((item, index) => {
    console.log(`  ${index + 1}. ${item.operator_name || "-"} | fleet=${number(item.fleet_size_korea)} target=${number(item.targeted_vessels)} contact=${number(item.contacted_vessels)} quote=${number(item.quoted_vessels)} won=${number(item.won_vessels)} lost=${number(item.lost_vessels)} penetration=${number(item.penetration_rate)}% gap=${number(item.opportunity_gap)}`);
  });

if (missingFieldRows.length || invalidNumericRows.length) process.exit(1);
