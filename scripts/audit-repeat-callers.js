#!/usr/bin/env node

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

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
  if (Array.isArray(payload?.vessels)) return payload.vessels;
  if (Array.isArray(payload?.candidates)) return payload.candidates;
  return [];
}

function number(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function vesselName(item = {}) {
  return item.vessel_name || item.vessel_display?.vessel_name || "선명 확인 필요";
}

function portName(item = {}) {
  return item.port || item.current_port || item.vessel_display?.current_port || rows(item.ports_visited)[0] || "-";
}

function priorityLabel(item = {}) {
  return String(item.priority_label || item.vessel_display?.priority_label || "").toUpperCase();
}

function printLine(label, value) {
  console.log(`- ${label}: ${value}`);
}

const repeatPayload = readJson("dashboard/api/intelligence/repeat-callers.json");
const targetsPayload = readJson("dashboard/api/targets/current.json");
const routePayload = readJson("dashboard/api/intelligence/route-summary.json");
const statusPayload = readJson("dashboard/api/status.json");

if (!repeatPayload || repeatPayload.__error) {
  console.error("Repeat Caller Intelligence Audit");
  console.error("================================");
  console.error(`ERROR: repeat-callers.json ${repeatPayload?.__error || "not found"}`);
  process.exit(1);
}

const repeatRows = rows(repeatPayload);
const targetRows = rows(targetsPayload);
const repeat90 = repeatRows.filter(item => number(item.visit_count_90d) >= 2);
const repeatSamePort = repeatRows.filter(item => rows(item.ports_visited).length === 1 && number(item.visit_count_365d) >= 2);
const previousHot = repeatRows.filter(item => priorityLabel(item) === "HOT" || number(item.opportunity_score) >= 75);
const missingContract = repeatRows.filter(item => !item.vessel_display || !("visit_count_90d" in item) || !("repeat_caller_score" in item) || !("recommended_action" in item));

console.log("Repeat Caller Intelligence Audit");
console.log("================================");
printLine("data_mode", repeatPayload.data_mode || statusPayload?.data_mode || "unknown");
printLine("generated_at", repeatPayload.generated_at || "-");
printLine("source_table", repeatPayload.source_table || "-");
printLine("record_count", repeatPayload.record_count ?? repeatRows.length);
printLine("items", repeatRows.length);
printLine("targets_current_count", targetRows.length);
printLine("repeat_90d_2plus_count", repeat90.length);
printLine("same_port_repeat_count", repeatSamePort.length);
printLine("previous_hot_or_high_score_count", previousHot.length);
printLine("route_summary_count", rows(routePayload).length);
printLine("contract_missing_count", missingContract.length);

if (repeatRows.length === 0) {
  console.log("WARNING: 반복 입항 선박 데이터가 비어 있습니다.");
}
if (missingContract.length > 0) {
  console.log("WARNING: 일부 반복 입항 항목에 필수 표시 필드가 없습니다.");
}

console.log("\nTop repeat callers:");
repeatRows.slice(0, 10).forEach((item, index) => {
  const ports = rows(item.ports_visited).join(", ") || portName(item);
  console.log(`  ${index + 1}. ${vesselName(item)} | 90d=${number(item.visit_count_90d)} | 365d=${number(item.visit_count_365d)} | score=${number(item.repeat_caller_score)} | ports=${ports}`);
});
