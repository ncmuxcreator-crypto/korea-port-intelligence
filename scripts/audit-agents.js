#!/usr/bin/env node

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

function readJson(relativePath) {
  const fullPath = path.join(ROOT, relativePath);
  if (!fs.existsSync(fullPath)) return { missing: true, path: relativePath };
  try {
    return JSON.parse(fs.readFileSync(fullPath, "utf8"));
  } catch (error) {
    return { error: error.message, path: relativePath };
  }
}

function rows(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.queue)) return payload.queue;
  return [];
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function uniqueCount(values) {
  return new Set(values.map(value => String(value || "").trim()).filter(Boolean)).size;
}

const agentIntelligence = readJson("dashboard/api/intelligence/agent-intelligence.json");
const agentSummary = readJson("dashboard/api/intelligence/agent-summary.json");
const followupPriority = readJson("dashboard/api/sales/agent-followup-priority.json");
const verificationQueue = readJson("dashboard/api/sales/verification-queue.json");
const legacyFollowupQueue = readJson("dashboard/api/agent-followup-queue.json");

const problems = [agentIntelligence, followupPriority]
  .filter(payload => payload.missing || payload.error)
  .map(payload => `${payload.path}: ${payload.missing ? "missing" : payload.error}`);

console.log("Agent Intelligence Audit");
console.log("========================");

if (problems.length) {
  for (const problem of problems) console.error(`ERROR: ${problem}`);
  process.exit(1);
}

const agentRows = rows(agentIntelligence);
const summaryRows = rows(agentSummary);
const priorityRows = rows(followupPriority);
const verificationRows = rows(verificationQueue);
const legacyRows = rows(legacyFollowupQueue);
const missingAgentRows = verificationRows.filter(item => {
  const missing = Array.isArray(item.missing_fields) ? item.missing_fields : [];
  return missing.some(field => /agent|local_agent|contact/i.test(String(field)));
});

console.log(`- generated_at: ${agentIntelligence.generated_at || "-"}`);
console.log(`- data_mode: ${agentIntelligence.data_mode || "-"}`);
console.log(`- agent_intelligence_record_count: ${agentIntelligence.record_count ?? agentRows.length}`);
console.log(`- legacy_agent_summary_record_count: ${agentSummary.record_count ?? summaryRows.length}`);
console.log(`- agent_followup_priority_count: ${followupPriority.record_count ?? priorityRows.length}`);
console.log(`- verification_queue_count: ${verificationQueue.record_count ?? verificationRows.length}`);
console.log(`- legacy_followup_queue_count: ${legacyFollowupQueue.record_count ?? legacyRows.length}`);
console.log(`- missing_agent_followups: ${missingAgentRows.length}`);
console.log(`- agents_with_hot_targets: ${agentRows.filter(item => number(item.hot_count) > 0).length}`);
console.log(`- agents_with_missing_contacts: ${agentRows.filter(item => number(item.missing_contact_count) > 0).length}`);
console.log(`- ports_covered: ${uniqueCount(agentRows.flatMap(item => Array.isArray(item.ports_served) ? item.ports_served : []))}`);
console.log(`- operators_covered: ${uniqueCount(agentRows.flatMap(item => Array.isArray(item.operators_served) ? item.operators_served : []))}`);

if (!agentRows.length) console.log("WARNING: agent-intelligence endpoint is empty");
if (!priorityRows.length && missingAgentRows.length) console.log("WARNING: missing agent/contact rows exist but followup priority is empty");

console.log("\nTop agents:");
agentRows
  .slice()
  .sort((a, b) => number(b.hot_count) - number(a.hot_count) || number(b.target_count) - number(a.target_count) || number(b.average_opportunity_score) - number(a.average_opportunity_score))
  .slice(0, 10)
  .forEach((item, index) => {
    console.log(`  ${index + 1}. ${item.agent_name || "미확인 에이전트"} | vessels=${number(item.vessel_count)} | hot=${number(item.hot_count)} | targets=${number(item.target_count)} | missing=${number(item.missing_contact_count)}`);
  });

console.log("\nTop follow-up priorities:");
priorityRows.slice(0, 10).forEach((item, index) => {
  const vesselName = item.vessel_display?.vessel_name || item.vessel_name || "-";
  console.log(`  ${index + 1}. ${item.agent_name || "미확인 에이전트"} | ${vesselName} | ${item.priority_label || "-"} | confidence=${number(item.confidence_score)}`);
});
