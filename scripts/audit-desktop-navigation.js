#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const DASHBOARD_HTML = path.join(ROOT, "dashboard", "index.html");
const REVIVAL_PLAN = path.join(ROOT, "dashboard", "api", "feature-revival-plan.json");

const EXPECTED_MENUS = [
  ["overview", "홈 / 상황판"],
  ["sales", "영업 실행"],
  ["vessels", "선박 인텔리전스"],
  ["ports-fleets", "항만·선대 인텔리전스"],
  ["sources", "데이터 소스·Enrichment"],
  ["diagnostics", "시스템 진단"]
];

const FEATURE_MENU_MAP = {
  "Today Sales Actions": "sales",
  "Sales Targets": "sales",
  "Quote Opportunities": "sales",
  "Verification Queue": "sales",
  "Watchlist": "sales",
  "Target Categories": "sales",
  "Cleaning Window": "vessels",
  "Compliance Exposure": "vessels",
  "Contact Coverage": "vessels",
  "Opportunity Memory": "vessels",
  "Port Summary": "ports-fleets",
  "Port DNA": "ports-fleets",
  "Fleet Intelligence": "ports-fleets",
  "Fleet Penetration": "ports-fleets",
  "Revenue Forecast": "ports-fleets",
  "Pilotage Summary": "ports-fleets",
  "Berth / PNC Summary": "ports-fleets",
  "AIS Info Summary": "sources",
  "Vessel Spec Summary": "sources",
  "Source CSV Summary": "sources",
  "Source Quality Score": "sources",
  "Enrichment Utilization": "sources"
};

const DIAGNOSTIC_ENDPOINTS = [
  "/api/source-health-runtime.json",
  "/api/source-collection-status.json",
  "/api/endpoint-manifest.json",
  "/api/runtime/update-tiers.json",
  "/api/runtime-budget-report.json",
  "/api/storage-efficiency-report.json",
  "/api/db-cleanup-plan.json"
];

const FORBIDDEN_HOME_ENDPOINTS = [
  "/api/status.json",
  "/api/targets/categories.json",
  "/api/sales/verification-queue.json",
  "/api/source-health-runtime.json",
  "/api/source-collection-status.json",
  "/api/endpoint-manifest.json",
  "/api/runtime/update-tiers.json",
  "/api/runtime-budget-report.json",
  "/api/storage-efficiency-report.json",
  "/api/aux/latest/",
  "/api/enrichment/latest/"
];

function readText(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}

function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function extractObjectLiteralBlock(html, name) {
  const marker = `const ${name}=`;
  const start = html.indexOf(marker);
  if (start < 0) return "";
  const open = html.indexOf("[", start);
  if (open < 0) return "";
  let depth = 0;
  for (let index = open; index < html.length; index += 1) {
    const char = html[index];
    if (char === "[") depth += 1;
    if (char === "]") depth -= 1;
    if (depth === 0) return html.slice(open, index + 1);
  }
  return "";
}

function extractFunctionBody(html, name) {
  const marker = `${name}=async function()`;
  let start = html.lastIndexOf(marker);
  if (start < 0) start = html.lastIndexOf(`async function ${name}()`);
  if (start < 0) return "";
  const open = html.indexOf("{", start);
  if (open < 0) return "";
  let depth = 0;
  for (let index = open; index < html.length; index += 1) {
    const char = html[index];
    if (char === "{") depth += 1;
    if (char === "}") depth -= 1;
    if (depth === 0) return html.slice(open + 1, index);
  }
  return "";
}

function apiCalls(segment = "") {
  return [...segment.matchAll(/api\("([^"]+)","([^"]+)"/g)].map(match => ({
    key: match[1],
    path: match[2]
  }));
}

function firstPaintSegment(html) {
  const body = extractFunctionBody(html, "loadSummary");
  return body.split("renderAll()")[0] || body;
}

function sectionsByMenu(html) {
  const block = extractObjectLiteralBlock(html, "DESKTOP_NAV_CONFIG");
  const result = new Map();
  for (const match of block.matchAll(/\{key:"([^"]+)"[\s\S]*?sections:\[([^\]]*)\]/g)) {
    const sections = [...match[2].matchAll(/"([^"]+)"/g)].map(item => item[1]);
    result.set(match[1], sections);
  }
  return result;
}

const html = readText(DASHBOARD_HTML);
const revival = readJson(REVIVAL_PLAN, {});
const sections = sectionsByMenu(html);
const firstPaintCalls = apiCalls(firstPaintSegment(html));

const menuRows = EXPECTED_MENUS.map(([key, label]) => ({
  key,
  label,
  found: html.includes(`key:"${key}"`) && html.includes(label),
  sections: sections.get(key) || []
}));

const revivedFeatures = Array.isArray(revival.features)
  ? revival.features.filter(feature => ["ALREADY_VISIBLE", "SAFE_TO_RECONNECT"].includes(feature.revival_classification))
  : [];

const featureRows = revivedFeatures.map(feature => {
  const menu = FEATURE_MENU_MAP[feature.feature_name] || "";
  const endpointNeedle = String(feature.endpoint_path || "").replace(/^dashboard/, "");
  return {
    feature: feature.feature_name,
    menu,
    endpoint: feature.endpoint_path,
    mapped: Boolean(menu),
    endpointReferenced: endpointNeedle ? html.includes(endpointNeedle) : false
  };
});

const unmappedRevived = featureRows.filter(row => !row.mapped);
const missingEndpointRefs = featureRows.filter(row => row.mapped && !row.endpointReferenced);
const firstPaintForbidden = firstPaintCalls.filter(call =>
  FORBIDDEN_HOME_ENDPOINTS.some(pattern => call.path.includes(pattern))
);
const diagnosticsMissingFromSystem = DIAGNOSTIC_ENDPOINTS.filter(endpoint =>
  html.includes(endpoint) && !html.includes("SYSTEM_DIAGNOSTIC_ENDPOINTS")
);
const diagnosticsOutsideBusiness = DIAGNOSTIC_ENDPOINTS.filter(endpoint => {
  const index = html.indexOf(endpoint);
  if (index < 0) return false;
  const systemIndex = html.indexOf("SYSTEM_DIAGNOSTIC_ENDPOINTS");
  return systemIndex < 0 || index < systemIndex - 2000;
});
const mobileNavPatterns = [
  /mobile-bottom/i,
  /bottom-tabs?/i,
  /mobileNav/,
  /bottomNav/,
  /data-mobile-nav/i,
  /data-mobile-tab/i
];
const mobileNavigationChanges = mobileNavPatterns.filter(pattern => pattern.test(html));
const allSections = [...sections.values()].flat();
const duplicateSections = [...new Set(allSections.filter((section, index) => allSections.indexOf(section) !== index))];
const freshnessOk = html.includes("tierFreshness") && html.includes("/api/runtime/update-tiers.json") && ["Core", "Aux", "Enrich", "Audit"].every(label => html.includes(label));

console.log("Desktop Navigation Audit");
console.log("========================");
console.log("Top-level menus:");
for (const row of menuRows) {
  console.log(`- ${row.label} (${row.key}) | found=${row.found ? "yes" : "no"} | sections=${row.sections.join(", ") || "-"}`);
}

console.log("\nRevived feature mapping:");
for (const row of featureRows) {
  console.log(`- ${row.feature} -> ${row.menu || "UNMAPPED"} | endpoint_ref=${row.endpointReferenced ? "yes" : "no"}`);
}

console.log("\nLoad and isolation checks:");
console.log(`- first-paint API calls: ${firstPaintCalls.map(call => call.path).join(", ") || "none"}`);
console.log(`- forbidden home endpoint loads: ${firstPaintForbidden.length}`);
console.log(`- diagnostics outside system diagnostics: ${diagnosticsOutsideBusiness.length}`);
console.log(`- mobile navigation patterns detected: ${mobileNavigationChanges.length}`);
console.log(`- duplicate page sections: ${duplicateSections.length ? duplicateSections.join(", ") : "none"}`);
console.log(`- tier freshness indicators: ${freshnessOk ? "yes" : "no"}`);

const problems = [];
for (const row of menuRows) {
  if (!row.found) problems.push(`Missing desktop menu: ${row.label}`);
  if (!row.sections.length) problems.push(`Menu has no sections: ${row.label}`);
}
for (const row of unmappedRevived) problems.push(`Unmapped revived feature: ${row.feature}`);
for (const row of missingEndpointRefs) problems.push(`Mapped feature endpoint not referenced: ${row.feature} (${row.endpoint})`);
for (const call of firstPaintForbidden) problems.push(`Forbidden endpoint on home first paint: ${call.path}`);
for (const endpoint of diagnosticsMissingFromSystem) problems.push(`Diagnostic endpoint not owned by system diagnostics list: ${endpoint}`);
for (const endpoint of diagnosticsOutsideBusiness) problems.push(`Diagnostic endpoint appears outside system diagnostics: ${endpoint}`);
for (const pattern of mobileNavigationChanges) problems.push(`Mobile navigation change pattern detected: ${pattern}`);
for (const section of duplicateSections) problems.push(`Duplicate page section mapping: ${section}`);
if (!freshnessOk) problems.push("Tier freshness indicators are missing or not backed by runtime/update-tiers.json");

if (problems.length) {
  console.log("\nProblems:");
  for (const problem of problems) console.log(`- ${problem}`);
  process.exitCode = 1;
} else {
  console.log("\nDesktop navigation looks good.");
}
