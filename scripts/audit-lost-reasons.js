#!/usr/bin/env node

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const ENDPOINT_PATH = "dashboard/api/intelligence/lost-opportunity-reasons.json";
const REASONS = [
  "NO_CONTACT_INFO",
  "TIMING_MISSED",
  "LOW_CONFIDENCE",
  "WRONG_PORT",
  "VESSEL_DEPARTED",
  "NO_RESPONSE",
  "PRICE_REJECTED",
  "COMPETITOR_USED",
  "INTERNAL_CAPACITY"
];

function readJson(relativePath) {
  const fullPath = path.join(ROOT, relativePath);
  if (!fs.existsSync(fullPath)) return null;
  return JSON.parse(fs.readFileSync(fullPath, "utf8"));
}

function rows(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

const payload = readJson(ENDPOINT_PATH);

console.log("Lost Opportunity Reason Audit");
console.log("=============================");

if (!payload) {
  console.error(`ERROR: ${ENDPOINT_PATH} not found`);
  process.exit(1);
}

const items = rows(payload);
const reasonCounts = Object.fromEntries(REASONS.map(reason => [reason, 0]));
for (const item of items) {
  const reason = String(item.lost_reason || "UNKNOWN").toUpperCase();
  reasonCounts[reason] = (reasonCounts[reason] || 0) + 1;
}

console.log(`- endpoint: ${ENDPOINT_PATH}`);
console.log(`- data_mode: ${payload.data_mode || "unknown"}`);
console.log(`- generated_at: ${payload.generated_at || "-"}`);
console.log(`- source_table: ${payload.source_table || "-"}`);
console.log(`- record_count: ${payload.record_count ?? items.length}`);
console.log(`- items: ${items.length}`);
console.log(`- with_vessel_display: ${items.filter(item => item.vessel_display).length}`);
console.log(`- with_evidence: ${items.filter(item => Array.isArray(item.evidence) ? item.evidence.length : Boolean(item.evidence)).length}`);
console.log(`- with_prevention: ${items.filter(item => item.recommended_prevention || item.recommended_action).length}`);
console.log("- reason_counts:");
for (const reason of REASONS) console.log(`  - ${reason}: ${reasonCounts[reason] || 0}`);

const missingReason = items.filter(item => !item.lost_reason).length;
const missingEvidence = items.filter(item => !(Array.isArray(item.evidence) ? item.evidence.length : item.evidence)).length;
const missingPrevention = items.filter(item => !item.recommended_prevention && !item.recommended_action).length;
const averageOpportunity = items.length
  ? Math.round(items.reduce((sum, item) => sum + number(item.opportunity_score), 0) / items.length)
  : 0;

console.log(`- missing_lost_reason: ${missingReason}`);
console.log(`- missing_evidence: ${missingEvidence}`);
console.log(`- missing_prevention: ${missingPrevention}`);
console.log(`- average_opportunity_score: ${averageOpportunity}`);

if (!payload.generated_at || !payload.schema_version || !Array.isArray(payload.items)) {
  console.log("WARNING: lost opportunity reason endpoint contract is incomplete");
}
if (!items.length) {
  console.log("WARNING: lost opportunity reason endpoint is empty");
}
if (missingReason || missingEvidence || missingPrevention) {
  console.log("WARNING: some lost reason rows are incomplete");
}

console.log("\nTop lost reason items:");
items.slice(0, 10).forEach((item, index) => {
  const name = item.vessel_name || item.vessel_display?.vessel_name || "선명 확인 필요";
  const evidence = Array.isArray(item.evidence) ? item.evidence.join(" / ") : item.evidence || "";
  console.log(`  ${index + 1}. ${name} | ${item.lost_reason || "-"} | score=${number(item.opportunity_score)} | ${evidence}`);
});
