#!/usr/bin/env node

import fs from "fs";
import path from "path";

const ROOT = process.cwd();

function resolvePath(relativePath) {
  const primary = path.join(ROOT, ...relativePath.split("/"));
  const debug = path.join(ROOT, ...relativePath.replace("dashboard/api/", "dashboard/api/debug/").split("/"));
  if (fs.existsSync(primary)) return primary;
  if (fs.existsSync(debug)) return debug;
  return primary;
}

function readJson(relativePath, fallback = {}) {
  const file = resolvePath(relativePath);
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    return { ...fallback, _error: error.message };
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

function displayName(item = {}) {
  const d = item.vessel_display || {};
  return item.vessel_name || d.vessel_name || item.name || "선명 확인 필요";
}

function hasMissing(item = {}, field) {
  return rows(item.missing_quote_fields).some(value => String(value).toLowerCase() === String(field).toLowerCase());
}

function krw(value) {
  return `${Math.round(number(value) / 10000).toLocaleString("ko-KR")}만원`;
}

const quotePayload = readJson("dashboard/api/sales/quote-opportunities.json", { items: [] });
const targetsPayload = readJson("dashboard/api/targets/current.json", { items: [] });
const topPayload = readJson("dashboard/api/candidates/top.json", { items: [], opportunities: [] });
const quoteRows = rows(quotePayload);
const targetRows = rows(targetsPayload);
const topRows = rows(topPayload);

const hotTargets = targetRows.filter(item => String(item.priority_label || item.sales_priority_band || item.vessel_display?.priority_label || "").toUpperCase() === "HOT" || number(item.opportunity_score || item.vessel_display?.opportunity_score) >= 75);
const readyRows = quoteRows.filter(item => item.quote_readiness_label === "READY");
const needsInfoRows = quoteRows.filter(item => item.quote_readiness_label === "NEEDS_INFO");
const monitorRows = quoteRows.filter(item => item.quote_readiness_label === "MONITOR");
const avgReadiness = quoteRows.length
  ? Math.round(quoteRows.reduce((sum, item) => sum + number(item.quote_readiness_score), 0) / quoteRows.length)
  : 0;
const missingImo = quoteRows.filter(item => hasMissing(item, "IMO")).length;
const missingOperator = quoteRows.filter(item => hasMissing(item, "Operator")).length;
const missingPort = quoteRows.filter(item => hasMissing(item, "Current Port")).length;
const totalValue = quoteRows.reduce((sum, item) => {
  const band = item.estimated_value_band || {};
  sum.low += number(band.low);
  sum.mid += number(band.mid);
  sum.high += number(band.high);
  return sum;
}, { low: 0, mid: 0, high: 0 });

const warnings = [];
if (hotTargets.length > 0 && quoteRows.length === 0) warnings.push("HOT targets exist but quote opportunities = 0");
if (hotTargets.length > 0 && readyRows.length === 0) warnings.push("READY count = 0 while HOT targets > 0");
if (quoteRows.length > 0 && missingOperator / quoteRows.length > 0.6) warnings.push("missing operator rate > 60%");
if (quoteRows.length > 0 && totalValue.low + totalValue.mid + totalValue.high === 0) warnings.push("estimated value all zero");
if (quotePayload._error) warnings.push(`quote JSON parse/read error: ${quotePayload._error}`);

console.log("Quote Opportunity Audit");
console.log("=======================");
console.log(`total targets: ${targetRows.length}`);
console.log(`top candidate rows: ${topRows.length}`);
console.log(`HOT targets: ${hotTargets.length}`);
console.log(`quote opportunity count: ${quoteRows.length}`);
console.log(`READY count: ${readyRows.length}`);
console.log(`NEEDS_INFO count: ${needsInfoRows.length}`);
console.log(`MONITOR count: ${monitorRows.length}`);
console.log(`average quote readiness score: ${avgReadiness}`);
console.log(`missing IMO count: ${missingImo}`);
console.log(`missing operator count: ${missingOperator}`);
console.log(`missing current port count: ${missingPort}`);
console.log(`estimated total value low/mid/high: ${krw(totalValue.low)} / ${krw(totalValue.mid)} / ${krw(totalValue.high)}`);

console.log("\nTop 10 quote opportunities:");
for (const item of quoteRows.slice(0, 10)) {
  const services = rows(item.recommended_services).join(" + ") || "-";
  console.log(`${item.rank || "-"} | ${displayName(item)} | ${item.quote_readiness_label || "-"} ${number(item.quote_readiness_score)} | ${krw(item.estimated_value_band?.mid)} | ${services}`);
}

console.log("\nWarnings:");
if (!warnings.length) {
  console.log("- none");
} else {
  for (const warning of warnings) console.log(`- WARNING: ${warning}`);
}
