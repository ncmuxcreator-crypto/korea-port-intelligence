#!/usr/bin/env node

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const API_DIR = path.join(ROOT, "dashboard", "api");
const DASHBOARD_HTML = path.join(ROOT, "dashboard", "index.html");

const FEATURE_CATALOG = [
  ["bootstrap.json", "dashboard/api/bootstrap.json", "Executive Summary", ["bootstrap.json", "applyBootstrapSnapshot"]],
  ["vessel_display", "dashboard/api/vessels/page-1.json", "Vessel Intelligence", ["vessel_display", "vesselDetailsHtml"]],
  ["full vessel pagination", "dashboard/api/vessels/index.json", "전체 선박", ["ensureVesselIndex", "loadStaticVesselPage", "총 "]],
  ["target categories", "dashboard/api/targets/categories.json", "영업 대상 카테고리", ["targetCategoryCards", "target_categories"]],
  ["sales actions", "dashboard/api/sales/actions.json", "오늘의 영업 액션", ["/api/sales/actions.json", "sales/actions"]],
  ["verification queue", "dashboard/api/sales/verification-queue.json", "연락처 확인 필요", ["verification-queue.json", "followupRows"]],
  ["watchlist", "dashboard/api/watchlist/current.json", "관심 선박", ["watchlist/current.json", "watchlistRows"]],
  ["message drafts", "dashboard/api/sales/message-drafts.json", "오늘의 영업 액션", ["message-drafts", "message_draft"]],
  ["daily sales report", "dashboard/api/reports/daily-sales-report.json", "예상 매출", ["daily-sales-report", "executiveWeekly"]],
  ["repeat callers", "dashboard/api/intelligence/repeat-callers.json", "선대 인텔리전스", ["repeat-callers.json", "repeatCallers"]],
  ["biofouling risk", "dashboard/api/intelligence/biofouling-risk.json", "리스크 / Compliance", ["biofouling-risk.json", "biofoulingRisk"]],
  ["fleet intelligence", "dashboard/api/intelligence/fleet-intelligence.json", "선대 인텔리전스", ["fleet-intelligence.json", "fleet"]],
  ["revenue forecast", "dashboard/api/intelligence/revenue-forecast.json", "예상 매출", ["revenue-forecast.json", "revenueForecast"]],
  ["agent intelligence", "dashboard/api/intelligence/agent-intelligence.json", "선대 인텔리전스", ["agent-intelligence.json", "agentIntelligence"]],
  ["korea presence", "dashboard/api/intelligence/korea-presence.json", "고급 분석", ["korea-presence.json", "koreaPresence"]],
  ["fleet DNA", "dashboard/api/intelligence/fleet-dna.json", "선대 인텔리전스", ["fleet-dna.json", "fleetDna"]],
  ["compliance exposure", "dashboard/api/intelligence/compliance-exposure.json", "리스크 / Compliance", ["compliance-exposure.json", "complianceExposure"]],
  ["cleaning window", "dashboard/api/intelligence/cleaning-window.json", "리스크 / Compliance", ["cleaning-window.json", "cleaningWindow"]],
  ["opportunity memory", "dashboard/api/intelligence/opportunity-memory.json", "영업 인텔리전스", ["opportunity-memory.json", "opportunityMemory"]],
  ["opportunity decay", "dashboard/api/intelligence/opportunity-decay.json", "영업 인텔리전스", ["opportunity-decay.json", "opportunityDecay"]],
  ["missed opportunities", "dashboard/api/intelligence/missed-opportunities.json", "영업 인텔리전스", ["missed-opportunities.json", "missedOpportunities"]],
  ["actionability ranking", "dashboard/api/intelligence/actionability-ranking.json", "영업 인텔리전스", ["actionability-ranking", "actionability"]],
  ["hidden opportunities", "dashboard/api/intelligence/hidden-opportunities.json", "영업 인텔리전스", ["hidden-opportunities", "hiddenOpportunities"]],
  ["port DNA", "dashboard/api/intelligence/port-dna.json", "항만 인텔리전스", ["port-dna.json", "portDna"]],
  ["fleet momentum", "dashboard/api/intelligence/fleet-momentum.json", "선대 인텔리전스", ["fleet-momentum", "fleetMomentum"]],
  ["commercial similarity", "dashboard/api/intelligence/commercial-similarity.json", "고급 분석", ["commercial-similarity", "commercialSimilarity"]],
  ["congestion / waiting score", "dashboard/api/congestion-watchlist.json", "항만 인텔리전스", ["congestion-watchlist.json", "congestion"]],
  ["enrichment fields", "dashboard/api/quality/basic-info-coverage.json", "데이터 품질", ["call_sign", "operatorText", "vesselDetailsHtml"]],
  ["data quality dashboard", "dashboard/api/quality/data-quality.json", "데이터 품질", ["data-quality.json", "dataQuality"]]
];

function full(relativePath) {
  return path.join(ROOT, ...relativePath.split("/"));
}

function exists(relativePath) {
  return fs.existsSync(full(relativePath));
}

function sizeOf(relativePath) {
  try {
    return exists(relativePath) ? fs.statSync(full(relativePath)).size : 0;
  } catch {
    return 0;
  }
}

function readText(file) {
  try {
    return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  } catch {
    return "";
  }
}

function readJson(relativePath) {
  if (!exists(relativePath)) return { exists: false, payload: null, error: null };
  try {
    return { exists: true, payload: JSON.parse(fs.readFileSync(full(relativePath), "utf8")), error: null };
  } catch (error) {
    return { exists: true, payload: null, error: error.message };
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

function count(payload) {
  const direct = Number(payload?.record_count ?? payload?.total_count ?? payload?.total_vessels ?? payload?.all_vessels_count);
  if (Number.isFinite(direct)) return direct;
  const list = rows(payload);
  return list.length;
}

function generatedAt(payload) {
  return payload?.generated_at || payload?.status?.generated_at || payload?.data_health?.last_success_at || null;
}

function ageHours(value) {
  const time = Date.parse(value || "");
  if (!Number.isFinite(time)) return null;
  return (Date.now() - time) / 36e5;
}

function listJsonFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const child = path.join(dir, entry.name);
    if (entry.isDirectory()) return listJsonFiles(child);
    return entry.name.endsWith(".json") ? [child] : [];
  });
}

function rel(file) {
  return path.relative(ROOT, file).replace(/\\/g, "/");
}

function statusFor({ jsonExists, jsonError, recordCount, uiExists, stale }) {
  if (!jsonExists) return uiExists ? "BROKEN" : "NEEDS_UI";
  if (jsonError) return "BROKEN";
  if (recordCount > 0 && !uiExists) return "HIDDEN";
  if (stale) return "STALE";
  if (recordCount === 0) return uiExists ? "EMPTY" : "NEEDS_UI";
  return uiExists ? "ACTIVE" : "HIDDEN";
}

const html = readText(DASHBOARD_HTML);
const rowsOut = FEATURE_CATALOG.map(([feature, endpoint, uiSection, needles]) => {
  const { exists: jsonExists, payload, error } = readJson(endpoint);
  const recordCount = payload ? count(payload) : 0;
  const uiExists = needles.some(needle => html.includes(needle));
  const age = ageHours(generatedAt(payload));
  const stale = age !== null && age > 36;
  const oversized = endpoint.endsWith("bootstrap.json")
    ? sizeOf(endpoint) > 150 * 1024
    : endpoint.includes("/vessels/page-")
      ? sizeOf(endpoint) > 300 * 1024
      : false;
  const problems = [];
  if (!jsonExists) problems.push("endpoint missing");
  if (error) problems.push(`invalid JSON: ${error}`);
  if (!uiExists) problems.push("not referenced by dashboard UI");
  if (stale) problems.push(`stale generated_at (${Math.round(age)}h)`);
  if (oversized) problems.push("payload over size budget");
  if (jsonExists && !error && recordCount === 0) problems.push("0건");
  return {
    feature,
    endpoint,
    recordCount,
    uiSection,
    visible: uiExists ? "yes" : "no",
    status: statusFor({ jsonExists, jsonError: error, recordCount, uiExists, stale }),
    problem: problems.join("; ") || "-"
  };
});

console.log("UI Integration Audit");
console.log("====================");
console.log("Feature | Endpoint | record_count | UI Section | Visible | Status | Problem");
for (const row of rowsOut) {
  console.log(`${row.feature} | ${row.endpoint} | ${row.recordCount} | ${row.uiSection} | ${row.visible} | ${row.status} | ${row.problem}`);
}

const referencedEndpoints = new Set([...html.matchAll(/path:"([^"]+)"/g)].map(match => `dashboard${match[1]}`));
for (const match of html.matchAll(/api\("[^"]+","([^"]+)"/g)) referencedEndpoints.add(`dashboard${match[1]}`);

const jsonFiles = listJsonFiles(API_DIR);
const endpointRows = jsonFiles.map(file => {
  const relative = rel(file);
  const { payload, error } = readJson(relative);
  return {
    relative,
    count: payload && !error ? count(payload) : 0,
    referenced: referencedEndpoints.has(relative),
    size: fs.statSync(file).size,
    stale: payload ? ageHours(generatedAt(payload)) > 36 : false,
    error
  };
});

const dataNoUi = endpointRows.filter(row => row.count > 0 && !row.referenced && /dashboard\/api\/(intelligence|sales|reports|targets)\//.test(row.relative));
const missingUiEndpoints = [...referencedEndpoints].filter(endpoint => !exists(endpoint));
const staleEndpoints = endpointRows.filter(row => row.stale);
const oversized = endpointRows.filter(row =>
  (row.relative.endsWith("bootstrap.json") && row.size > 150 * 1024) ||
  (/dashboard\/api\/vessels\/page-\d+\.json$/.test(row.relative) && row.size > 300 * 1024) ||
  (row.size > 1024 * 1024 && !/dashboard\/api\/vessels\/page-\d+\.json$/.test(row.relative))
);

console.log("\nEndpoints with data but no UI reference:");
if (!dataNoUi.length) console.log("- none");
for (const row of dataNoUi.slice(0, 30)) console.log(`- ${row.relative}: ${row.count} records`);

console.log("\nUI sections with missing endpoint:");
if (!missingUiEndpoints.length) console.log("- none");
for (const endpoint of missingUiEndpoints.slice(0, 30)) console.log(`- ${endpoint}`);

console.log("\nStale endpoints:");
if (!staleEndpoints.length) console.log("- none");
for (const row of staleEndpoints.slice(0, 30)) console.log(`- ${row.relative}`);

console.log("\nOversized payloads:");
if (!oversized.length) console.log("- none");
for (const row of oversized.slice(0, 30)) console.log(`- ${row.relative}: ${row.size} bytes`);

const hiddenWithData = rowsOut.filter(row => row.status === "HIDDEN");
console.log("\nHidden intelligence with record_count > 0:");
if (!hiddenWithData.length) console.log("- none");
for (const row of hiddenWithData) console.log(`- ${row.feature}: ${row.recordCount} records`);
