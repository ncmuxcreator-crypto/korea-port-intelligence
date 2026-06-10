#!/usr/bin/env node

import fs from "fs";
import path from "path";

const ROOT = process.cwd();
const ENDPOINT = "dashboard/api/intelligence/contact-coverage.json";

function resolvePath(relativePath) {
  const primary = path.join(ROOT, ...relativePath.split("/"));
  const debug = path.join(ROOT, ...relativePath.replace("dashboard/api/", "dashboard/api/debug/").split("/"));
  if (fs.existsSync(primary)) return primary;
  if (fs.existsSync(debug)) return debug;
  return primary;
}

function readJson(relativePath, fallback = {}) {
  const fullPath = resolvePath(relativePath);
  try {
    if (!fs.existsSync(fullPath)) return { ...fallback, _error: "not_found", _path: fullPath };
    return { ...JSON.parse(fs.readFileSync(fullPath, "utf8")), _path: fullPath };
  } catch (error) {
    return { ...fallback, _error: error.message, _path: fullPath };
  }
}

function rows(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.vessels)) return payload.vessels;
  if (Array.isArray(payload?.candidates)) return payload.candidates;
  if (Array.isArray(payload?.opportunities)) return payload.opportunities;
  return [];
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function pct(value) {
  return `${number(value).toLocaleString("ko-KR")}%`;
}

function displayName(item = {}) {
  const d = item.vessel_display || {};
  return item.vessel_name || d.vessel_name || item.name || "선명 확인 필요";
}

function fieldMissing(item = {}, field) {
  return rows(item.missing_contact_fields).includes(field);
}

const payload = readJson(ENDPOINT, { items: [] });
const items = rows(payload);
const metrics = payload.portfolio_metrics || payload.summary?.portfolio_metrics || {};
const verificationQueue = readJson("dashboard/api/sales/verification-queue.json", { items: [] });
const verificationRows = rows(verificationQueue);

const labels = { HIGH: 0, MEDIUM: 0, LOW: 0 };
for (const item of items) {
  const label = String(item.contact_coverage_label || "").toUpperCase();
  if (label in labels) labels[label] += 1;
}

const hotItems = items.filter(item => String(item.priority_label || item.vessel_display?.priority_label || "").toUpperCase() === "HOT");
const hotMissingOperator = hotItems.filter(item => fieldMissing(item, "운영사/회사")).length;
const hotMissingAgent = hotItems.filter(item => fieldMissing(item, "에이전트")).length;
const avgCoverage = items.length
  ? Math.round((items.reduce((sum, item) => sum + number(item.contact_coverage_score), 0) / items.length) * 10) / 10
  : 0;

const invalidItems = [];
for (const [index, item] of items.entries()) {
  const score = Number(item.contact_coverage_score);
  if (!Number.isFinite(score) || score < 0 || score > 100) invalidItems.push(`row ${index + 1}: invalid contact_coverage_score`);
  if (!["HIGH", "MEDIUM", "LOW"].includes(String(item.contact_coverage_label || "").toUpperCase())) invalidItems.push(`row ${index + 1}: invalid contact_coverage_label`);
  if (!Array.isArray(item.missing_contact_fields)) invalidItems.push(`row ${index + 1}: missing_contact_fields must be array`);
  if (!Array.isArray(item.available_contact_fields)) invalidItems.push(`row ${index + 1}: available_contact_fields must be array`);
}

const metricErrors = [];
for (const key of [
  "imo_coverage_pct",
  "mmsi_coverage_pct",
  "call_sign_coverage_pct",
  "operator_display_coverage_pct",
  "owner_coverage_pct",
  "manager_coverage_pct",
  "agent_coverage_pct",
  "contact_person_coverage_pct",
  "quote_ready_pct"
]) {
  const value = Number(metrics[key]);
  if (!Number.isFinite(value) || value < 0 || value > 100) metricErrors.push(key);
}

console.log("Contact Coverage Audit");
console.log("======================");
console.log(`endpoint: ${ENDPOINT}`);
console.log(`path: ${payload._path || "-"}`);
console.log(`generated_at: ${payload.generated_at || "-"}`);
console.log(`data_mode: ${payload.data_mode || "unknown"}`);
console.log(`record_count: ${payload.record_count ?? items.length}`);
console.log(`target coverage rows: ${items.length}`);
console.log(`average contact coverage score: ${avgCoverage}`);
console.log(`HIGH / MEDIUM / LOW: ${labels.HIGH} / ${labels.MEDIUM} / ${labels.LOW}`);
console.log("");
console.log("Portfolio coverage:");
console.log(`- IMO coverage: ${pct(metrics.imo_coverage_pct)}`);
console.log(`- MMSI coverage: ${pct(metrics.mmsi_coverage_pct)}`);
console.log(`- Call Sign coverage: ${pct(metrics.call_sign_coverage_pct)}`);
console.log(`- Operator/company coverage: ${pct(metrics.operator_display_coverage_pct)}`);
console.log(`- Owner coverage: ${pct(metrics.owner_coverage_pct)}`);
console.log(`- Manager coverage: ${pct(metrics.manager_coverage_pct)}`);
console.log(`- Agent coverage: ${pct(metrics.agent_coverage_pct)}`);
console.log(`- Contact person coverage: ${pct(metrics.contact_person_coverage_pct)}`);
console.log(`- Quote ready: ${pct(metrics.quote_ready_pct)}`);
console.log("");
console.log(`HOT targets missing operator: ${hotMissingOperator}`);
console.log(`HOT targets missing agent: ${hotMissingAgent}`);
console.log(`verification queue count: ${verificationRows.length}`);

console.log("\nTop missing fields:");
for (const row of rows(payload.top_missing_fields).slice(0, 8)) {
  console.log(`- ${row.field || "-"}: ${number(row.count)}`);
}

console.log("\nTop contact coverage gaps:");
items
  .slice()
  .sort((a, b) => number(a.contact_coverage_score) - number(b.contact_coverage_score))
  .slice(0, 10)
  .forEach((item, index) => {
    console.log(`${index + 1}. ${displayName(item)} | ${item.contact_coverage_label || "-"} ${number(item.contact_coverage_score)} | missing=${rows(item.missing_contact_fields).join(", ") || "-"}`);
  });

if (payload._error) {
  console.log(`ERROR: contact coverage endpoint read failed: ${payload._error}`);
}
if (verificationQueue._error) {
  console.log(`WARNING: verification queue read failed: ${verificationQueue._error}`);
}
if (items.length === 0) {
  console.log("WARNING: contact coverage endpoint is empty.");
}
if (hotItems.length > 0 && labels.LOW > 0 && verificationRows.length === 0) {
  console.log("WARNING: HOT/LOW coverage candidates exist but verification queue is empty.");
}
if (metricErrors.length) {
  console.log(`ERROR: invalid portfolio metrics: ${metricErrors.join(", ")}`);
}
if (invalidItems.length) {
  console.log("ERROR: invalid contact coverage rows:");
  for (const error of invalidItems.slice(0, 20)) console.log(`- ${error}`);
}

if (payload._error || metricErrors.length || invalidItems.length) process.exit(1);
