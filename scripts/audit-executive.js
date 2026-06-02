#!/usr/bin/env node

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const reportPath = path.join(ROOT, "dashboard/api/reports/executive-weekly.json");

function readJson(fullPath) {
  if (!fs.existsSync(fullPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(fullPath, "utf8"));
  } catch (error) {
    return { __error: error.message };
  }
}

const payload = readJson(reportPath);

console.log("Executive Weekly Audit");
console.log("======================");

if (!payload || payload.__error) {
  console.error(`ERROR: dashboard/api/reports/executive-weekly.json ${payload?.__error || "not found"}`);
  process.exit(1);
}

const sections = payload.sections || {};
const requiredSections = [
  "executive_summary",
  "revenue_opportunities",
  "compliance_opportunities",
  "repeat_caller_insights",
  "fleet_expansion_opportunities",
  "risks"
];

console.log(`- generated_at: ${payload.generated_at || "-"}`);
console.log(`- data_mode: ${payload.data_mode || "unknown"}`);
console.log(`- source_table: ${payload.source_table || "-"}`);
console.log(`- record_count: ${payload.record_count ?? 0}`);
console.log(`- total_vessels: ${sections.executive_summary?.total_vessels ?? 0}`);
console.log(`- hot_targets: ${sections.executive_summary?.hot_targets ?? 0}`);
console.log(`- estimated_pipeline_high: ${sections.revenue_opportunities?.estimated_pipeline ?? 0}`);
console.log(`- top_operators: ${(sections.executive_summary?.top_operators || []).length}`);
console.log(`- top_ports: ${(sections.executive_summary?.top_ports || []).length}`);
console.log(`- repeat_caller_items: ${(sections.repeat_caller_insights || []).length}`);
console.log(`- fleet_expansion_items: ${(sections.fleet_expansion_opportunities || []).length}`);
console.log(`- risk_warnings: ${(sections.risks?.warnings || []).length}`);

const missing = requiredSections.filter(section => !(section in sections));
if (missing.length) {
  console.error(`ERROR: missing sections: ${missing.join(", ")}`);
  process.exit(1);
}

if (!payload.generated_at || !payload.schema_version || !payload.report_type) {
  console.error("ERROR: executive weekly report contract is incomplete");
  process.exit(1);
}

console.log("status: ok");
