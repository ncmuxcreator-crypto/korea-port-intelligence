#!/usr/bin/env node

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const ENDPOINT_PATH = "dashboard/api/intelligence/fleet-gap-finder.json";
const UNKNOWN_OPERATOR = "미확인 운영사";

const REQUIRED_FIELDS = [
  "operator_name",
  "known_korea_vessels",
  "targeted_vessels",
  "untargeted_vessels",
  "hot_untargeted_vessels",
  "warm_untargeted_vessels",
  "high_risk_untargeted_vessels",
  "gap_score",
  "opportunity_gap",
  "estimated_gap_revenue",
  "gap_vessels",
  "recommended_next_action"
];

const NUMERIC_FIELDS = [
  "known_korea_vessels",
  "targeted_vessels",
  "untargeted_vessels",
  "hot_untargeted_vessels",
  "warm_untargeted_vessels",
  "high_risk_untargeted_vessels",
  "gap_score",
  "opportunity_gap",
  "estimated_gap_revenue"
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
  const next = Number(value);
  return Number.isFinite(next) ? next : 0;
}

function sum(items, field) {
  return items.reduce((total, item) => total + number(item[field]), 0);
}

function vesselKey(item = {}) {
  const d = item.vessel_display || {};
  const name = String(item.vessel_name || d.vessel_name || "").normalize("NFKC").toUpperCase().replace(/\s+/g, "");
  return String(item.imo || d.imo || item.mmsi || d.mmsi || item.call_sign || d.call_sign || `${name}|${d.current_port || item.port || ""}`);
}

const result = readJson(ENDPOINT_PATH);
console.log("Fleet Gap Finder Audit");
console.log("======================");
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
const invalidGapRows = [];
const seenGapVessels = new Map();

for (const [index, item] of items.entries()) {
  const missing = REQUIRED_FIELDS.filter(field => !(field in item));
  if (missing.length) missingFieldRows.push({ row: index + 1, operator_name: item.operator_name || "-", missing });
  const invalid = NUMERIC_FIELDS.filter(field => !Number.isFinite(Number(item[field])) || Number(item[field]) < 0);
  if (invalid.length) invalidNumericRows.push({ row: index + 1, operator_name: item.operator_name || "-", invalid });
  if (!Array.isArray(item.gap_vessels)) {
    invalidGapRows.push({ row: index + 1, operator_name: item.operator_name || "-" });
    continue;
  }
  for (const vessel of item.gap_vessels) {
    const key = vesselKey(vessel);
    if (!key) continue;
    const current = seenGapVessels.get(key) || [];
    current.push(item.operator_name || "-");
    seenGapVessels.set(key, current);
  }
}

const duplicateVessels = [...seenGapVessels.entries()].filter(([, operators]) => new Set(operators).size > 1);
const unknownOperatorItems = items.filter(item => item.operator_name === UNKNOWN_OPERATOR);
const totalGapVessels = sum(items, "untargeted_vessels");
const unknownOperatorGap = sum(unknownOperatorItems, "untargeted_vessels");
const totalRevenue = sum(items, "estimated_gap_revenue");

console.log(`- generated_at: ${payload.generated_at || "-"}`);
console.log(`- data_mode: ${payload.data_mode || "unknown"}`);
console.log(`- source_table: ${payload.source_table || "-"}`);
console.log(`- record_count: ${payload.record_count ?? items.length}`);
console.log(`- total_operators: ${items.length}`);
console.log(`- total_gap_vessels: ${totalGapVessels}`);
console.log(`- unknown_operator_gap: ${unknownOperatorGap}`);
console.log(`- estimated_gap_revenue_total: ${Math.round(totalRevenue)}`);
console.log(`- duplicate_gap_vessel_groups: ${duplicateVessels.length}`);

if (!items.length) console.log("WARNING: fleet gap finder endpoint is empty.");
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
if (invalidGapRows.length) {
  console.log("ERROR: gap_vessels must be an array.");
  for (const row of invalidGapRows.slice(0, 10)) {
    console.log(`  - row ${row.row} ${row.operator_name}`);
  }
}

console.log("\nTop 10 operator gaps:");
items
  .slice()
  .sort((a, b) =>
    number(b.gap_score) - number(a.gap_score) ||
    number(b.untargeted_vessels) - number(a.untargeted_vessels) ||
    number(b.estimated_gap_revenue) - number(a.estimated_gap_revenue)
  )
  .slice(0, 10)
  .forEach((item, index) => {
    console.log(`  ${index + 1}. ${item.operator_name || "-"} | known=${number(item.known_korea_vessels)} targeted=${number(item.targeted_vessels)} gap=${number(item.untargeted_vessels)} hot_gap=${number(item.hot_untargeted_vessels)} score=${number(item.gap_score)} revenue=${number(item.estimated_gap_revenue)}`);
  });

if (duplicateVessels.length) {
  console.log("\nDuplicated vessel handling:");
  for (const [key, operators] of duplicateVessels.slice(0, 10)) {
    console.log(`  - ${key}: ${[...new Set(operators)].join(", ")}`);
  }
}

if (missingFieldRows.length || invalidNumericRows.length || invalidGapRows.length) process.exit(1);
