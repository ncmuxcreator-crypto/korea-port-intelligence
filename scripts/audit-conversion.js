#!/usr/bin/env node

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const PIPELINE_PATH = "dashboard/api/sales/conversion-pipeline.json";
const STAGES = [
  "NEW_TARGET",
  "CONTACT_PLANNED",
  "CONTACTED",
  "QUOTE_REQUESTED",
  "QUOTE_SENT",
  "NEGOTIATION",
  "WON",
  "LOST",
  "ARCHIVED"
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

const payload = readJson(PIPELINE_PATH);

console.log("Lead Conversion Audit");
console.log("=====================");

if (!payload) {
  console.error(`ERROR: ${PIPELINE_PATH} not found`);
  process.exit(1);
}

const items = rows(payload);
const returnedStageCounts = Object.fromEntries(STAGES.map(stage => [stage, 0]));
for (const item of items) {
  const stage = String(item.current_stage || "UNKNOWN");
  returnedStageCounts[stage] = (returnedStageCounts[stage] || 0) + 1;
}
const totalStageCounts = payload.stage_counts && typeof payload.stage_counts === "object"
  ? payload.stage_counts
  : returnedStageCounts;

console.log(`- endpoint: ${PIPELINE_PATH}`);
console.log(`- data_mode: ${payload.data_mode || "unknown"}`);
console.log(`- generated_at: ${payload.generated_at || "-"}`);
console.log(`- source_table: ${payload.source_table || "-"}`);
console.log(`- record_count: ${payload.record_count ?? items.length}`);
console.log(`- total_count: ${payload.total_count ?? items.length}`);
console.log(`- returned_count: ${payload.returned_count ?? items.length}`);
console.log("- total_stage_counts:");
for (const stage of STAGES) console.log(`  - ${stage}: ${totalStageCounts[stage] || 0}`);
console.log("- returned_stage_counts:");
for (const stage of STAGES) console.log(`  - ${stage}: ${returnedStageCounts[stage] || 0}`);

const missingStage = items.filter(item => !item.current_stage).length;
const missingVesselDisplay = items.filter(item => !item.vessel_display).length;
const missingNextAction = items.filter(item => !item.recommended_next_action && !item.recommended_action).length;

console.log(`- missing_current_stage: ${missingStage}`);
console.log(`- missing_vessel_display: ${missingVesselDisplay}`);
console.log(`- missing_next_action: ${missingNextAction}`);

if (!payload.generated_at || !payload.schema_version || !Array.isArray(payload.items)) {
  console.log("WARNING: conversion pipeline contract is incomplete");
}
if (!items.length) {
  console.log("WARNING: conversion pipeline is empty");
}
if (missingStage || missingVesselDisplay || missingNextAction) {
  console.log("WARNING: conversion pipeline has incomplete rows");
}

console.log("\nTop pipeline items:");
items.slice(0, 10).forEach((item, index) => {
  const display = item.vessel_display || {};
  const name = item.vessel_name || display.vessel_name || "선명 확인 필요";
  const port = item.port || display.current_port || "-";
  const score = item.opportunity_score ?? display.opportunity_score ?? "-";
  console.log(`  ${index + 1}. ${name} | ${item.current_stage || "-"} | ${port} | score=${score}`);
});
