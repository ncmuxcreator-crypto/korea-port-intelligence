#!/usr/bin/env node

import fs from "fs";
import path from "path";

const ROOT = process.cwd();
const DASHBOARD_HTML = path.join(ROOT, "dashboard", "index.html");

const EXPECTED_ENDPOINTS = [
  "dashboard/api/bootstrap.json",
  "dashboard/api/sales/actions.json",
  "dashboard/api/sales/quote-opportunities.json",
  "dashboard/api/targets/categories.json",
  "dashboard/api/candidates/top.json",
  "dashboard/api/intelligence/fleet-intelligence.json",
  "dashboard/api/intelligence/revenue-forecast.json",
  "dashboard/api/intelligence/compliance-exposure.json",
  "dashboard/api/intelligence/cleaning-window.json",
  "dashboard/api/intelligence/actionability-ranking.json",
  "dashboard/api/intelligence/opportunity-memory.json",
  "dashboard/api/watchlist/current.json",
  "dashboard/api/vessels/index.json"
];

function readText(file) {
  try {
    return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  } catch {
    return "";
  }
}

function readJson(relativePath) {
  const file = path.join(ROOT, ...relativePath.split("/"));
  if (!fs.existsSync(file)) return { exists: false, payload: null, error: "missing" };
  try {
    const text = fs.readFileSync(file, "utf8");
    return { exists: true, payload: JSON.parse(text), error: null, size: Buffer.byteLength(text) };
  } catch (error) {
    return { exists: true, payload: null, error: error.message, size: fs.statSync(file).size };
  }
}

function rows(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.vessels)) return payload.vessels;
  if (Array.isArray(payload?.candidates)) return payload.candidates;
  if (Array.isArray(payload?.opportunities)) return payload.opportunities;
  if (Array.isArray(payload?.ports)) return payload.ports;
  if (Array.isArray(payload?.categories)) return payload.categories;
  return [];
}

function recordCount(payload) {
  const direct = Number(payload?.record_count ?? payload?.total_count ?? payload?.total_vessels ?? payload?.all_vessels_count);
  return Number.isFinite(direct) ? direct : rows(payload).length;
}

function endpointFromPath(pathValue) {
  if (!pathValue || !pathValue.startsWith("/api/")) return null;
  return `dashboard${pathValue}`;
}

const html = readText(DASHBOARD_HTML);
const dashboardEndpoints = new Set();
for (const match of html.matchAll(/api\("[^"]+","([^"]+)"/g)) {
  const endpoint = endpointFromPath(match[1]);
  if (endpoint) dashboardEndpoints.add(endpoint);
}
for (const match of html.matchAll(/path:"([^"]+)"/g)) {
  const endpoint = endpointFromPath(match[1]);
  if (endpoint) dashboardEndpoints.add(endpoint);
}

const allEndpoints = [...new Set([...EXPECTED_ENDPOINTS, ...dashboardEndpoints])].sort();

console.log("Endpoint Static JSON Audit");
console.log("==========================");
console.log("Endpoint | Exists | JSON | record_count | UI referenced | Size | Status | Problem");

const problems = [];
for (const endpoint of allEndpoints) {
  const result = readJson(endpoint);
  const jsonOk = result.exists && !result.error;
  const count = jsonOk ? recordCount(result.payload) : 0;
  const uiReferenced = dashboardEndpoints.has(endpoint);
  const status = !result.exists ? "MISSING" : result.error ? "BROKEN" : count === 0 ? "EMPTY" : "OK";
  const problem = !result.exists
    ? "파일 없음"
    : result.error
      ? `JSON 오류: ${result.error}`
      : count === 0
        ? "0건 또는 데이터 준비 중"
        : "-";
  if (status === "MISSING" || status === "BROKEN") problems.push(`${endpoint}: ${problem}`);
  console.log(`${endpoint} | ${result.exists ? "yes" : "no"} | ${jsonOk ? "yes" : "no"} | ${count} | ${uiReferenced ? "yes" : "no"} | ${result.size || 0} | ${status} | ${problem}`);
}

console.log("\nMissing or broken endpoints:");
if (!problems.length) {
  console.log("- none");
} else {
  for (const problem of problems) console.log(`- ${problem}`);
}
