#!/usr/bin/env node

import fs from "fs";
import path from "path";

const ROOT = process.cwd();
const API_ROOT = path.join(ROOT, "dashboard", "api");
const DASHBOARD_HTML = path.join(ROOT, "dashboard", "index.html");
const MANIFEST_PATH = path.join(API_ROOT, "endpoint-manifest.json");
const INITIAL_PAYLOAD_LIMIT_BYTES = 300 * 1024;
const STARTUP_SAFE_BYTES = 100 * 1024;
const STARTUP_SAFE_BOOTSTRAP_BYTES = 150 * 1024;

const DISALLOWED_INITIAL_PATTERNS = [
  /dashboard\/api\/status\.json$/i,
  /dashboard\/api\/targets\/categories\.json$/i,
  /dashboard\/api\/sales\/verification-queue\.json$/i,
  /dashboard\/api\/source-health-runtime\.json$/i,
  /dashboard\/api\/source-collection-status\.json$/i,
  /dashboard\/api\/aux\//i
];

function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function endpointFromUrl(url = "") {
  const clean = String(url || "").split("?")[0].replace(/^\/+/, "");
  if (!clean) return "";
  if (clean.startsWith("api/")) return `dashboard/${clean}`;
  if (clean.startsWith("dashboard/api/")) return clean;
  if (clean.startsWith("data/")) return clean;
  return clean;
}

function fileSizeForEndpoint(endpoint = "") {
  const normalized = String(endpoint || "").replace(/\\/g, "/");
  if (!normalized.startsWith("dashboard/api/")) return 0;
  const filePath = path.join(ROOT, ...normalized.split("/"));
  try {
    return fs.existsSync(filePath) ? fs.statSync(filePath).size : 0;
  } catch {
    return 0;
  }
}

function apiCallsFromSegment(segment = "") {
  return [...segment.matchAll(/api\("([^"]+)","([^"]+)"/g)].map(match => ({
    key: match[1],
    url: match[2],
    endpoint: endpointFromUrl(match[2])
  }));
}

function extractFunctionBody(html, name) {
  const marker = `function ${name}(`;
  const start = html.indexOf(marker);
  if (start < 0) return "";
  const braceStart = html.indexOf("{", start);
  if (braceStart < 0) return "";
  let depth = 0;
  for (let index = braceStart; index < html.length; index += 1) {
    const char = html[index];
    if (char === "{") depth += 1;
    if (char === "}") depth -= 1;
    if (depth === 0) return html.slice(braceStart + 1, index);
  }
  return "";
}

function extractOverviewLoadSegments(html) {
  const overrideMatch = html.match(/loadSummary=async function\(\)\{([\s\S]*?)\}\s*const renderAllHull/);
  const loadSummaryBody = overrideMatch?.[1] || extractFunctionBody(html, "loadSummary");
  const firstPaintSegment = (loadSummaryBody.split("renderAll()")[0] || loadSummaryBody);
  const secondaryBody = extractFunctionBody(html, "loadSecondaryAfterFirstPaint");
  const secondarySnapshotBody = extractFunctionBody(html, "loadSecondarySnapshotData");
  const overviewBlocksSecondary = /page\s*===\s*["']overview["']\)\s*return/.test(secondaryBody);
  return {
    firstPaintSegment,
    secondaryBody,
    secondarySnapshotBody,
    overviewBlocksSecondary
  };
}

function endpointTooHeavy(entry = {}) {
  const bytes = Number(entry.bytes || 0);
  if (entry.path === "dashboard/api/bootstrap.json") return bytes > STARTUP_SAFE_BOOTSTRAP_BYTES;
  return bytes > STARTUP_SAFE_BYTES;
}

const manifest = readJson(MANIFEST_PATH, {});
const manifestEntries = Array.isArray(manifest.endpoints) ? manifest.endpoints : [];
const initialEntries = manifestEntries.filter(entry => entry.startup_safe === true || entry.load_strategy === "initial");
const initialPayloadBytes = initialEntries.reduce((sum, entry) => sum + Number(entry.bytes || 0), 0);
const heavyStartupViolations = initialEntries.filter(endpointTooHeavy);
const auxInitialViolations = initialEntries.filter(entry => entry.source_layer === "auxiliary" || /dashboard\/api\/aux\//.test(entry.path || ""));
const diagnosticInitialViolations = initialEntries.filter(entry => entry.source_layer === "diagnostic");
const forbiddenInitialViolations = initialEntries.filter(entry => DISALLOWED_INITIAL_PATTERNS.some(pattern => pattern.test(entry.path || "")));
const startupFlagViolations = manifestEntries.filter(entry =>
  entry.startup_safe === true && (entry.source_layer !== "core" || entry.load_strategy !== "initial")
);

const html = fs.existsSync(DASHBOARD_HTML) ? fs.readFileSync(DASHBOARD_HTML, "utf8") : "";
const { firstPaintSegment, secondarySnapshotBody, overviewBlocksSecondary } = extractOverviewLoadSegments(html);
const firstPaintCalls = apiCallsFromSegment(firstPaintSegment);
const disallowedFirstPaintCalls = firstPaintCalls.filter(call =>
  DISALLOWED_INITIAL_PATTERNS.some(pattern => pattern.test(call.endpoint))
);
const secondaryCalls = apiCallsFromSegment(secondarySnapshotBody);
const auxDetailSecondaryCalls = overviewBlocksSecondary
  ? []
  : secondaryCalls.filter(call => /dashboard\/api\/aux\//.test(call.endpoint));
const diagnosticSecondaryCalls = overviewBlocksSecondary
  ? []
  : secondaryCalls.filter(call => /dashboard\/api\/(?:status\.json|source-health-runtime|source-collection-status|health\/pipeline|data-continuity|continuity)/.test(call.endpoint));

const actualFirstPaintPayloadBytes = firstPaintCalls.reduce((sum, call) => sum + fileSizeForEndpoint(call.endpoint), 0);
const missingAuxSummaries = [
  "dashboard/api/aux/source-csv-summary.json",
  "dashboard/api/aux/pilotage-summary.json",
  "dashboard/api/aux/berth-summary.json",
  "dashboard/api/aux/ais-info-summary.json",
  "dashboard/api/aux/ais-dynamic-summary.json",
  "dashboard/api/aux/vessel-spec-summary.json"
].filter(endpoint => !fs.existsSync(path.join(ROOT, ...endpoint.split("/"))));

console.log("Load strategy audit:");
console.log(`- initial endpoint count: ${initialEntries.length}`);
console.log(`- initial payload size: ${Math.round((initialPayloadBytes / 1024) * 10) / 10} KB`);
console.log(`- first-paint frontend endpoint count: ${firstPaintCalls.length}`);
console.log(`- first-paint frontend payload size: ${Math.round((actualFirstPaintPayloadBytes / 1024) * 10) / 10} KB`);
console.log(`- overview secondary load blocked: ${overviewBlocksSecondary ? "yes" : "no"}`);
console.log(`- heavy startup violations: ${heavyStartupViolations.length}`);
console.log(`- auxiliary detail loaded on Overview: ${auxInitialViolations.length + auxDetailSecondaryCalls.length}`);
console.log(`- diagnostic files loaded on Overview: ${diagnosticInitialViolations.length + diagnosticSecondaryCalls.length}`);
console.log(`- missing auxiliary summaries: ${missingAuxSummaries.length ? missingAuxSummaries.join(", ") : "none"}`);

console.log("\nInitial manifest endpoints:");
for (const entry of initialEntries) {
  console.log(`- ${entry.key || entry.path} | ${entry.path} | ${entry.source_layer || "-"} | ${entry.load_strategy || "-"} | ${entry.size_kb ?? Math.round((Number(entry.bytes || 0) / 1024) * 10) / 10} KB`);
}

console.log("\nFirst-paint frontend calls:");
for (const call of firstPaintCalls) {
  console.log(`- ${call.key} | ${call.endpoint || call.url} | ${Math.round((fileSizeForEndpoint(call.endpoint) / 1024) * 10) / 10} KB`);
}

const problems = [];
if (initialPayloadBytes > INITIAL_PAYLOAD_LIMIT_BYTES) problems.push(`Overview initial manifest payload exceeds 300KB (${initialPayloadBytes} bytes)`);
if (actualFirstPaintPayloadBytes > INITIAL_PAYLOAD_LIMIT_BYTES) problems.push(`Overview first-paint payload exceeds 300KB (${actualFirstPaintPayloadBytes} bytes)`);
for (const entry of heavyStartupViolations) problems.push(`Heavy startup endpoint: ${entry.path}`);
for (const entry of forbiddenInitialViolations) problems.push(`Forbidden initial endpoint: ${entry.path}`);
for (const entry of auxInitialViolations) problems.push(`Auxiliary endpoint marked initial/startup-safe: ${entry.path}`);
for (const entry of diagnosticInitialViolations) problems.push(`Diagnostic endpoint marked initial/startup-safe: ${entry.path}`);
for (const entry of startupFlagViolations) problems.push(`startup_safe contract mismatch: ${entry.path}`);
for (const call of disallowedFirstPaintCalls) problems.push(`Frontend first-paint loads forbidden endpoint: ${call.endpoint || call.url}`);
for (const call of auxDetailSecondaryCalls) problems.push(`Overview secondary load includes aux detail: ${call.endpoint || call.url}`);
for (const call of diagnosticSecondaryCalls) problems.push(`Overview secondary load includes diagnostics: ${call.endpoint || call.url}`);
for (const endpoint of missingAuxSummaries) problems.push(`Missing auxiliary summary: ${endpoint}`);

if (problems.length) {
  console.log("\nProblems:");
  for (const problem of problems) console.log(`- ${problem}`);
  process.exitCode = 1;
} else {
  console.log("\nLoad strategy looks good.");
}
