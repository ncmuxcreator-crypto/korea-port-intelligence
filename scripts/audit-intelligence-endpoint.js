#!/usr/bin/env node

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

const endpoint = process.argv[2];
const label = process.argv[3] || endpoint || "intelligence";

if (!endpoint) {
  console.error("Usage: node scripts/audit-intelligence-endpoint.js <endpoint-name> [label]");
  process.exit(1);
}

function readJson(relativePath) {
  const fullPath = path.join(ROOT, relativePath);
  if (!fs.existsSync(fullPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(fullPath, "utf8"));
  } catch (error) {
    return { __error: error.message };
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

const payload = readJson(`dashboard/api/intelligence/${endpoint}.json`);
const status = readJson("dashboard/api/status.json") || {};

console.log(`${label} Audit`);
console.log("=".repeat(`${label} Audit`.length));

if (!payload || payload.__error) {
  console.error(`ERROR: dashboard/api/intelligence/${endpoint}.json ${payload?.__error || "not found"}`);
  process.exit(1);
}

const items = rows(payload);
console.log(`- endpoint: ${endpoint}`);
console.log(`- data_mode: ${payload.data_mode || status.data_mode || "unknown"}`);
console.log(`- generated_at: ${payload.generated_at || "-"}`);
console.log(`- source_table: ${payload.source_table || "-"}`);
console.log(`- record_count: ${payload.record_count ?? items.length}`);
console.log(`- items: ${items.length}`);
console.log(`- with_vessel_display: ${items.filter(item => item.vessel_display).length}`);
console.log(`- average_opportunity_score: ${items.length ? Math.round(items.reduce((sum, item) => sum + number(item.opportunity_score || item.average_opportunity_score || item.opportunity_index), 0) / items.length) : 0}`);
console.log(`- high_or_hot_count: ${items.filter(item => String(item.risk_level || item.priority_label || "").toUpperCase() === "HIGH" || number(item.hot_count) > 0 || number(item.risk_score) >= 70).length}`);

if (!payload.generated_at || !payload.schema_version || !Array.isArray(payload.items)) {
  console.log("WARNING: intelligence endpoint contract is incomplete");
}
if (!items.length) {
  console.log("WARNING: endpoint is empty");
}

console.log("\nTop items:");
items.slice(0, 10).forEach((item, index) => {
  const name = item.vessel_name || item.operator_name || item.port_name || item.route_name || item.vessel_display?.vessel_name || "항목 확인 필요";
  const score = item.opportunity_score ?? item.average_opportunity_score ?? item.opportunity_index ?? item.risk_score ?? item.window_score ?? item.compliance_score ?? item.relationship_score ?? "-";
  console.log(`  ${index + 1}. ${name} | score=${score} | ${item.reason_summary || item.recommended_action || ""}`);
});
