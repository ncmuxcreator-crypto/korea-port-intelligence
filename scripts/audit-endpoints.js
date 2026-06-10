#!/usr/bin/env node

import fs from "fs";
import path from "path";

const ROOT = process.cwd();
const API_ROOT = path.join(ROOT, "dashboard", "api");
const DASHBOARD_HTML = path.join(ROOT, "dashboard", "index.html");
const MANIFEST_PATH = path.join(API_ROOT, "endpoint-manifest.json");
const TOO_LARGE_BYTES = 500 * 1024;
const STALE_HOURS = 36;

const IMPORTANT_ENDPOINTS = [
  ["bootstrap", "dashboard/api/bootstrap.json"],
  ["status", "dashboard/api/status.json"],
  ["dashboard-summary", "dashboard/api/dashboard-summary.json"],
  ["sales.actions", "dashboard/api/sales/actions.json"],
  ["sales.conversionPipeline", "dashboard/api/sales/conversion-pipeline.json"],
  ["sales.quoteOpportunities", "dashboard/api/sales/quote-opportunities.json"],
  ["sales.verificationQueue", "dashboard/api/sales/verification-queue.json"],
  ["watchlist.current", "dashboard/api/watchlist/current.json"],
  ["targets.current", "dashboard/api/targets/current.json"],
  ["targets.categories", "dashboard/api/targets/categories.json"],
  ["vessels.index", "dashboard/api/vessels/index.json"],
  ["vessels.page1", "dashboard/api/vessels/page-1.json"],
  ["intelligence.fleetIntelligence", "dashboard/api/intelligence/fleet-intelligence.json"],
  ["intelligence.fleetPenetration", "dashboard/api/intelligence/fleet-penetration.json"],
  ["intelligence.revenueForecast", "dashboard/api/intelligence/revenue-forecast.json"],
  ["intelligence.portDna", "dashboard/api/intelligence/port-dna.json"],
  ["intelligence.opportunityMemory", "dashboard/api/intelligence/opportunity-memory.json"],
  ["intelligence.contactCoverage", "dashboard/api/intelligence/contact-coverage.json"],
  ["intelligence.complianceExposure", "dashboard/api/intelligence/compliance-exposure.json"],
  ["intelligence.cleaningWindow", "dashboard/api/intelligence/cleaning-window.json"]
];

const CRITICAL_ENDPOINTS = new Set([
  "dashboard/api/bootstrap.json",
  "dashboard/api/status.json",
  "dashboard/api/dashboard-summary.json",
  "dashboard/api/sales/actions.json",
  "dashboard/api/sales/conversion-pipeline.json",
  "dashboard/api/watchlist/current.json",
  "dashboard/api/vessels/index.json",
  "dashboard/api/vessels/page-1.json"
]);

const WRAPPER_PATTERNS = [
  /^dashboard\/api\/sales\//,
  /^dashboard\/api\/watchlist\//,
  /^dashboard\/api\/targets\//,
  /^dashboard\/api\/intelligence\//,
  /^dashboard\/api\/reports\//,
  /^dashboard\/api\/candidates\/top\.json$/,
  /^dashboard\/api\/arrival-pipeline\.json$/,
  /^dashboard\/api\/anchorage-waiting\.json$/,
  /^dashboard\/api\/staying-vessels\.json$/,
  /^dashboard\/api\/congestion-watchlist\.json$/,
  /^dashboard\/api\/agent-followup-queue\.json$/
];

function toRepoPath(filePath) {
  return path.relative(ROOT, filePath).replace(/\\/g, "/");
}

function listJsonFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listJsonFiles(full));
    else if (entry.isFile() && entry.name.endsWith(".json")) out.push(full);
  }
  return out;
}

function rows(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.vessels)) return payload.vessels;
  if (Array.isArray(payload?.candidates)) return payload.candidates;
  if (Array.isArray(payload?.opportunities)) return payload.opportunities;
  if (Array.isArray(payload?.contact_today)) return payload.contact_today;
  if (Array.isArray(payload?.ports)) return payload.ports;
  if (Array.isArray(payload?.categories)) return payload.categories;
  if (Array.isArray(payload?.endpoints)) return payload.endpoints;
  if (Array.isArray(payload?.pages)) return payload.pages;
  return [];
}

function itemCount(payload) {
  return rows(payload).length;
}

function recordCount(payload) {
  const direct = Number(payload?.record_count ?? payload?.total_count ?? payload?.total_vessels ?? payload?.all_vessels_count);
  return Number.isFinite(direct) ? direct : rows(payload).length;
}

function hasArrayPayload(payload) {
  return Array.isArray(payload?.items) ||
    Array.isArray(payload?.data) ||
    Array.isArray(payload?.vessels) ||
    Array.isArray(payload?.candidates) ||
    Array.isArray(payload?.opportunities) ||
    Array.isArray(payload?.contact_today) ||
    Array.isArray(payload?.ports) ||
    Array.isArray(payload?.categories) ||
    Array.isArray(payload?.endpoints) ||
    Array.isArray(payload?.pages);
}

function needsWrapper(relativePath) {
  return WRAPPER_PATTERNS.some(pattern => pattern.test(relativePath));
}

function isCritical(relativePath) {
  return CRITICAL_ENDPOINTS.has(relativePath);
}

function staleHours(payload) {
  const value = payload?.generated_at || payload?.last_success_at || payload?.updated_at;
  const time = Date.parse(value || "");
  if (!Number.isFinite(time)) return null;
  return (Date.now() - time) / 36e5;
}

function findUndefinedLike(value, currentPath = "$", found = []) {
  if (found.length > 20) return found;
  if (typeof value === "string" && /^(undefined|nan|infinity|-infinity)$/i.test(value.trim())) {
    found.push(currentPath);
  } else if (Array.isArray(value)) {
    value.forEach((item, index) => findUndefinedLike(item, `${currentPath}[${index}]`, found));
  } else if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) findUndefinedLike(child, `${currentPath}.${key}`, found);
  }
  return found;
}

function validateSchema(relativePath, payload) {
  if (!payload || typeof payload !== "object") return "root object or array required";
  if (Array.isArray(payload)) return "";
  if (relativePath.endsWith("endpoint-manifest.json")) {
    if (!payload.schema_version) return "missing schema_version";
    if (!payload.generated_at) return "missing generated_at";
    if (!Array.isArray(payload.endpoints)) return "missing endpoints array";
    return "";
  }
  const strictWrapper = isCritical(relativePath) || needsWrapper(relativePath);
  if (!strictWrapper) return "";
  if (!payload.schema_version) return "missing schema_version";
  if (!payload.generated_at) return "missing generated_at";
  if (!Number.isFinite(Number(payload.record_count ?? payload.total_count ?? payload.total_vessels))) return "missing numeric record_count";
  if (needsWrapper(relativePath) && !hasArrayPayload(payload)) return "missing items/data array";
  return "";
}

function auditFile(relativePath) {
  const filePath = path.join(ROOT, ...relativePath.split("/"));
  if (!fs.existsSync(filePath)) {
  return { endpoint: relativePath, path: relativePath, exists: false, valid_json: false, schema_valid: false, record_count: 0, item_count: 0, status: "MISSING", problem: "file missing", bytes: 0 };
  }
  const bytes = fs.statSync(filePath).size;
  const text = fs.readFileSync(filePath, "utf8");
  try {
    const payload = JSON.parse(text);
    const undefinedLike = findUndefinedLike(payload);
    const schemaProblem = validateSchema(relativePath, payload);
    const age = staleHours(payload);
    const count = recordCount(payload);
    const actualItemCount = itemCount(payload);
    let status = "OK";
    let problem = "";
    if (undefinedLike.length) {
      status = "SCHEMA_MISMATCH";
      problem = `undefined-like string at ${undefinedLike.slice(0, 3).join(", ")}`;
    } else if (schemaProblem) {
      status = "SCHEMA_MISMATCH";
      problem = schemaProblem;
    } else if (bytes > TOO_LARGE_BYTES) {
      status = "TOO_LARGE";
      problem = `${Math.round(bytes / 1024)}KB`;
    } else if (age !== null && age > STALE_HOURS) {
      status = "STALE";
      problem = `${Math.round(age)}h old`;
    } else if (count === 0 && hasArrayPayload(payload)) {
      status = "EMPTY_VALID";
      problem = "0 records";
    }
    return {
      endpoint: relativePath,
      path: relativePath,
      exists: true,
      valid_json: true,
      schema_valid: !schemaProblem && !undefinedLike.length,
      record_count: count,
      item_count: actualItemCount,
      status,
      problem,
      bytes
    };
  } catch (error) {
    return {
      endpoint: relativePath,
      path: relativePath,
      exists: true,
      valid_json: false,
      schema_valid: false,
      record_count: 0,
      item_count: 0,
      status: "INVALID_JSON",
      problem: error.message,
      bytes
    };
  }
}

function readDashboardEndpointMap() {
  const html = fs.existsSync(DASHBOARD_HTML) ? fs.readFileSync(DASHBOARD_HTML, "utf8") : "";
  const endpoints = new Map();
  for (const match of html.matchAll(/api\("([^"]+)","([^"]+)"/g)) {
    const pathValue = match[2].replace(/^\/api\//, "dashboard/api/").replace(/\?.*$/, "");
    endpoints.set(match[1], pathValue);
  }
  for (const match of html.matchAll(/\{key:"([^"]+)",title:"[^"]+",path:"([^"]+)"/g)) {
    const pathValue = match[2].replace(/^\/api\//, "dashboard/api/").replace(/\?.*$/, "");
    endpoints.set(`insight:${match[1]}`, pathValue);
  }
  return endpoints;
}

function writeManifest(entries) {
  const importantByPath = new Map(entries.map(entry => [entry.path, entry]));
  const endpoints = IMPORTANT_ENDPOINTS.map(([key, relativePath]) => {
    const entry = importantByPath.get(relativePath) || auditFile(relativePath);
    return {
      key,
      path: relativePath,
      exists: entry.exists,
      valid_json: entry.valid_json,
      schema_valid: entry.schema_valid,
      record_count: entry.record_count,
      item_count: entry.item_count,
      status: entry.status,
      problem: entry.problem || ""
    };
  });
  const manifest = {
    schema_version: "1.0",
    generated_at: new Date().toISOString(),
    record_count: endpoints.length,
    endpoints
  };
  fs.mkdirSync(path.dirname(MANIFEST_PATH), { recursive: true });
  fs.writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return manifest;
}

const existingFiles = listJsonFiles(API_ROOT).map(toRepoPath);
const importantPaths = IMPORTANT_ENDPOINTS.map(([, endpointPath]) => endpointPath);
const allPaths = [...new Set([...existingFiles, ...importantPaths])].sort();
const entries = allPaths.map(auditFile);
const manifest = writeManifest(entries);
const endpointMap = readDashboardEndpointMap();

console.log("Endpoint | Path | Exists | Valid JSON | Schema Valid | Record Count | Item Count | Status | Problem");
for (const entry of entries) {
  console.log([
    entry.endpoint,
    entry.path,
    entry.exists ? "yes" : "no",
    entry.valid_json ? "yes" : "no",
    entry.schema_valid ? "yes" : "no",
    entry.record_count,
    entry.item_count,
    entry.status,
    entry.problem || "-"
  ].join(" | "));
}

console.log("\nFrontend endpoint map:");
for (const [key, endpointPath] of [...endpointMap.entries()].sort()) {
  const entry = entries.find(item => item.path === endpointPath) || auditFile(endpointPath);
  console.log(`- ${key}: ${endpointPath} -> ${entry.status}${entry.problem ? ` (${entry.problem})` : ""}`);
}

console.log("\nStartup heavy-file warnings:");
const heavyStartup = [...endpointMap.entries()]
  .filter(([, endpointPath]) => /imo-recovery-priority|vessels\/page-(?!1\.json)\d+|audit|diagnostic|debug/i.test(endpointPath))
  .map(([key, endpointPath]) => `${key}: ${endpointPath}`);
if (heavyStartup.length) heavyStartup.forEach(line => console.log(`- WARNING ${line}`));
else console.log("- none");

console.log(`\nManifest written: dashboard/api/endpoint-manifest.json (${manifest.record_count} endpoints)`);

const invalidJson = entries.filter(entry => entry.status === "INVALID_JSON");
const missingCritical = entries.filter(entry => isCritical(entry.path) && entry.status === "MISSING");
const schemaCritical = entries.filter(entry => isCritical(entry.path) && !entry.schema_valid);
const criticalManifestFailures = manifest.endpoints.filter(entry => CRITICAL_ENDPOINTS.has(entry.path) && (entry.status === "INVALID_JSON" || entry.status === "MISSING" || !entry.schema_valid));

if (invalidJson.length || missingCritical.length || schemaCritical.length || criticalManifestFailures.length) {
  console.error("\nEndpoint audit failed:");
  for (const entry of [...invalidJson, ...missingCritical, ...schemaCritical, ...criticalManifestFailures]) {
    console.error(`- ${entry.path}: ${entry.status} ${entry.problem || ""}`.trim());
  }
  process.exit(1);
}
