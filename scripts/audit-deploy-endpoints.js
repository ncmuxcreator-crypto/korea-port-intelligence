#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const MANIFEST_PATH = "dashboard/api/endpoint-manifest.json";
const WORKFLOW_PATH = ".github/workflows/longterm-update.yml";
const DASHBOARD_HTML = "dashboard/index.html";
const LARGE_BYTES = 500 * 1024;
const VERY_LARGE_BYTES = 1024 * 1024;

const REQUIRED_FIELDS = [
  "key",
  "path",
  "exists",
  "valid_json",
  "parsed_from_disk",
  "first_char",
  "root_type",
  "size_kb",
  "item_count",
  "record_count",
  "owner_tier",
  "source_layer",
  "startup_safe",
  "load_strategy",
  "deploy_target",
  "included_in_deploy",
  "summary_available",
  "detail_available",
  "stale_diagnostic",
  "generated_at",
  "run_id",
  "source_run_id"
];

const OWNER_TIERS = new Set(["core", "fast_aux", "reference_enrichment", "discovery_audit", "diagnostic", "mixed"]);
const LOAD_STRATEGIES = new Set(["initial", "lazy", "on_demand", "diagnostic_only", "never_startup"]);
const DEPLOY_TARGETS = new Set(["worker_public", "repo_only", "diagnostic_only", "excluded_heavy"]);

const REQUIRED_WORKER_PUBLIC = [
  "dashboard/api/runtime/update-tiers.json",
  "dashboard/api/runtime-budget-report.json",
  "dashboard/api/status-summary.json",
  "dashboard/api/bootstrap.json",
  "dashboard/api/vessel-count-reconciliation.json",
  "dashboard/api/endpoint-manifest.json",
  "dashboard/api/source-quality-score.json",
  "dashboard/api/enrichment-utilization.json",
  "dashboard/api/aux/latest/index.json",
  "dashboard/api/aux/latest/cache-status.json",
  "dashboard/api/aux/latest/pilotage-summary.json",
  "dashboard/api/aux/latest/berth-summary.json",
  "dashboard/api/aux/latest/ais-info-summary.json",
  "dashboard/api/aux/latest/ais-dynamic-summary.json",
  "dashboard/api/aux/latest/ais-stat-summary.json",
  "dashboard/api/aux/latest/vessel-spec-summary.json",
  "dashboard/api/aux/latest/patch-hints.json",
  "dashboard/api/aux/latest/pilotage-match-results.json",
  "dashboard/api/aux/latest/berth-match-results.json",
  "dashboard/api/aux/latest/vessel-spec-parser-diagnostic.json",
  "dashboard/api/aux/latest/ais-target-enrichment.json",
  "dashboard/api/aux/latest/ais-target-queue.json",
  "dashboard/api/aux/latest/ais-cursor.json",
  "dashboard/api/aux/latest/ais-cache.json",
  "dashboard/api/aux/source-csv-summary.json",
  "dashboard/api/aux/pilotage-summary.json",
  "dashboard/api/aux/berth-summary.json",
  "dashboard/api/aux/ais-info-summary.json",
  "dashboard/api/aux/ais-dynamic-summary.json",
  "dashboard/api/aux/vessel-spec-summary.json",
  "dashboard/api/enrichment/vessel-identity-graph.json",
  "dashboard/api/enrichment/latest/index.json",
  "dashboard/api/enrichment/latest/summary.json",
  "dashboard/api/enrichment/latest/patches.json",
  "dashboard/api/enrichment/latest/review-queue.json",
  "dashboard/api/enrichment/summary.json",
  "dashboard/api/enrichment/review-queue.json"
];

const FORBIDDEN_DEFAULT_DEPLOY = [
  "dashboard/api/enrichment/latest/candidates.json",
  "dashboard/api/enrichment/latest/applied.json"
];

function fullPath(relativePath) {
  return path.join(ROOT, ...String(relativePath || "").split("/"));
}

function readText(relativePath) {
  try {
    return fs.readFileSync(fullPath(relativePath), "utf8");
  } catch {
    return "";
  }
}

function readJson(relativePath, fallback = null) {
  try {
    return JSON.parse(readText(relativePath));
  } catch {
    return fallback;
  }
}

function exists(relativePath) {
  return fs.existsSync(fullPath(relativePath));
}

function firstJsonCharacter(text = "") {
  const cleaned = String(text || "").replace(/^\uFEFF/, "");
  const match = cleaned.match(/\S/);
  return match ? match[0] : "";
}

function rootType(payload) {
  if (Array.isArray(payload)) return "array";
  if (payload === null) return "null";
  return typeof payload;
}

function itemCount(payload) {
  if (Array.isArray(payload)) return payload.length;
  if (!payload || typeof payload !== "object") return 0;
  for (const key of [
    "items",
    "records",
    "rows",
    "vessels",
    "ports",
    "targets",
    "candidates",
    "opportunities",
    "categories",
    "endpoints",
    "patches",
    "queue"
  ]) {
    if (Array.isArray(payload[key])) return payload[key].length;
  }
  return 0;
}

function recordCount(payload) {
  if (payload && typeof payload === "object" && Number.isFinite(Number(payload.record_count))) {
    return Number(payload.record_count);
  }
  return itemCount(payload);
}

function sizeKb(bytes = 0) {
  return Math.round((Number(bytes || 0) / 1024) * 10) / 10;
}

function parseDeployWhitelist(workflowText = "") {
  const deployBlock = workflowText.match(/for file in \\\s*([\s\S]*?)\s*; do/)?.[1] || "";
  const entries = new Set();
  for (const match of deployBlock.matchAll(/([A-Za-z0-9_./-]+\.(?:json|geojson))/g)) {
    entries.add(`dashboard/api/${match[1]}`);
  }
  return entries;
}

function workflowIncludesPath(relativePath = "", deployWhitelist = new Set(), workflowText = "") {
  const normalized = String(relativePath || "").replace(/\\/g, "/");
  if (deployWhitelist.has(normalized)) return true;
  if (/^dashboard\/api\/vessels\/page-\d+\.json$/i.test(normalized)) {
    return /cp \.\/api\.cloudflare-upload-full\/vessels\/page-\*\.json dashboard\/api\/vessels\//.test(workflowText);
  }
  if (/^dashboard\/api\/ports\/[^/]+\/hull-cleaning\.json$/i.test(normalized)) {
    return /find \.\/api\.cloudflare-upload-full\/ports -path '\*\/hull-cleaning\.json'/.test(workflowText);
  }
  return false;
}

function endpointFromUrl(url = "") {
  const clean = String(url || "").split("?")[0].replace(/^\/+/, "");
  if (!clean) return "";
  if (clean.startsWith("api/")) return `dashboard/${clean}`;
  if (clean.startsWith("dashboard/api/")) return clean;
  return clean;
}

function apiCallsFromSegment(segment = "") {
  return [...segment.matchAll(/api\("([^"]+)","([^"]+)"/g)].map(match => ({
    key: match[1],
    endpoint: endpointFromUrl(match[2])
  }));
}

function extractFunctionBody(html = "", name = "") {
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

function overviewFirstPaintEndpoints() {
  const html = readText(DASHBOARD_HTML);
  const overrideMatch = html.match(/loadSummary=async function\(\)\{([\s\S]*?)\}\s*const renderAllHull/);
  const loadSummaryBody = overrideMatch?.[1] || extractFunctionBody(html, "loadSummary");
  const firstPaintSegment = (loadSummaryBody.split("renderAll()")[0] || loadSummaryBody);
  return apiCallsFromSegment(firstPaintSegment).map(call => call.endpoint).filter(Boolean);
}

function parseActualFile(relativePath) {
  if (!exists(relativePath)) {
    return {
      exists: false,
      valid_json: false,
      first_char: "",
      root_type: "missing",
      bytes: 0,
      size_kb: 0,
      item_count: 0,
      record_count: 0
    };
  }
  const text = readText(relativePath);
  const bytes = Buffer.byteLength(text);
  try {
    const payload = JSON.parse(text);
    return {
      exists: true,
      valid_json: true,
      first_char: firstJsonCharacter(text),
      root_type: rootType(payload),
      bytes,
      size_kb: sizeKb(bytes),
      item_count: itemCount(payload),
      record_count: recordCount(payload)
    };
  } catch (error) {
    return {
      exists: true,
      valid_json: false,
      first_char: firstJsonCharacter(text),
      root_type: "invalid",
      bytes,
      size_kb: sizeKb(bytes),
      item_count: 0,
      record_count: 0,
      problem: error.message
    };
  }
}

function builtArtifactRoots() {
  return [
    "api.cloudflare-upload-full",
    "dist/api",
    "build/api",
    "public/api"
  ].filter(relativePath => fs.existsSync(fullPath(relativePath)));
}

function builtArtifactHas(relativePath = "", roots = []) {
  const apiRelative = String(relativePath || "").replace(/^dashboard\/api\//, "");
  if (!roots.length) return true;
  return roots.some(root => fs.existsSync(fullPath(`${root}/${apiRelative}`)));
}

function issueText(issues = [], warnings = []) {
  const all = [...issues, ...warnings.map(warning => `WARN: ${warning}`)];
  return all.length ? all.join("; ") : "OK";
}

const manifest = readJson(MANIFEST_PATH, {});
const manifestEntries = Array.isArray(manifest.endpoints) ? manifest.endpoints : [];
const manifestByPath = new Map(manifestEntries.map(entry => [String(entry.path || "").replace(/\\/g, "/"), entry]));
const workflowText = readText(WORKFLOW_PATH);
const deployWhitelist = parseDeployWhitelist(workflowText);
const artifactRoots = builtArtifactRoots();
const firstPaintEndpoints = new Set(overviewFirstPaintEndpoints());
const problems = [];
const warnings = [];
const rows = [];
const pathsToCheck = new Set([
  ...manifestByPath.keys(),
  ...REQUIRED_WORKER_PUBLIC,
  ...FORBIDDEN_DEFAULT_DEPLOY
]);

for (const relativePath of pathsToCheck) {
  const entry = manifestByPath.get(relativePath);
  const actual = parseActualFile(relativePath);
  const deployListed = workflowIncludesPath(relativePath, deployWhitelist, workflowText);
  const endpointIssues = [];
  const endpointWarnings = [];
  const label = entry?.key || relativePath.replace(/^dashboard\/api\//, "");

  if (REQUIRED_WORKER_PUBLIC.includes(relativePath)) {
    if (!actual.exists) endpointIssues.push("required file missing in repo");
    if (!entry) endpointIssues.push("missing from endpoint-manifest");
    if (entry && entry.included_in_deploy !== true) endpointIssues.push("manifest deploy flag false");
    if (entry && entry.deploy_target !== "worker_public") endpointIssues.push(`deploy_target=${entry.deploy_target || "missing"}`);
    if (!deployListed) endpointIssues.push("missing from Cloudflare whitelist");
    if (!builtArtifactHas(relativePath, artifactRoots)) endpointIssues.push("missing from built artifact");
  }

  if (FORBIDDEN_DEFAULT_DEPLOY.includes(relativePath) && deployListed) {
    endpointIssues.push("heavy enrichment detail should not be in default Cloudflare whitelist");
  }

  if (entry) {
    for (const field of REQUIRED_FIELDS) {
      if (!(field in entry)) endpointIssues.push(`manifest missing ${field}`);
    }
    if (!OWNER_TIERS.has(entry.owner_tier)) endpointIssues.push(`invalid owner_tier=${entry.owner_tier || "missing"}`);
    if (!LOAD_STRATEGIES.has(entry.load_strategy)) endpointIssues.push(`invalid load_strategy=${entry.load_strategy || "missing"}`);
    if (!DEPLOY_TARGETS.has(entry.deploy_target)) endpointIssues.push(`invalid deploy_target=${entry.deploy_target || "missing"}`);
    if (entry.parsed_from_disk !== true) endpointIssues.push("parsed_from_disk is not true");
    if (entry.exists !== actual.exists) endpointIssues.push(`exists mismatch actual=${actual.exists}`);
    if (entry.valid_json !== actual.valid_json) endpointIssues.push(`valid_json mismatch actual=${actual.valid_json}`);
    if (entry.valid_json === true && !actual.valid_json) endpointIssues.push("CRITICAL manifest says valid_json but disk parse fails");
    if (actual.exists && entry.first_char !== actual.first_char) endpointIssues.push(`first_char mismatch actual=${actual.first_char || "empty"}`);
    if (actual.exists && entry.root_type !== actual.root_type) endpointIssues.push(`root_type mismatch actual=${actual.root_type}`);
    if (actual.exists && Math.abs(Number(entry.size_kb || 0) - actual.size_kb) > 0.2) endpointIssues.push(`size_kb mismatch actual=${actual.size_kb}`);
    if (entry.path !== relativePath) endpointIssues.push("manifest path key mismatch");
    if (firstPaintEndpoints.has(relativePath) && entry.startup_safe !== true) endpointIssues.push("overview first paint loads non-startup-safe endpoint");
    if (firstPaintEndpoints.has(relativePath) && Number(entry.bytes || actual.bytes || 0) > LARGE_BYTES) endpointIssues.push("overview first paint loads heavy endpoint");
    if (Number(entry.bytes || actual.bytes || 0) > LARGE_BYTES && entry.startup_safe === true) endpointIssues.push("heavy file marked startup_safe");
    if (entry.load_strategy === "initial" && entry.startup_safe !== true) endpointIssues.push("initial load without startup_safe");
    if (/^dashboard\/api\/(?:debug|discovery)\//i.test(relativePath) && (entry.included_in_deploy || deployListed)) {
      endpointIssues.push("debug/discovery file included in business deploy");
    }
    if (/^dashboard\/api\/(?:debug|discovery)\//i.test(relativePath) && entry.load_strategy === "initial") {
      endpointIssues.push("debug/discovery file marked initial");
    }
    if (Number(entry.bytes || actual.bytes || 0) > VERY_LARGE_BYTES && (entry.included_in_deploy || deployListed)) {
      endpointWarnings.push("worker_public file exceeds 1MB");
    }
  }

  for (const issue of endpointIssues) problems.push(`${relativePath}: ${issue}`);
  for (const warning of endpointWarnings) warnings.push(`${relativePath}: ${warning}`);

  if (entry || endpointIssues.length || endpointWarnings.length || REQUIRED_WORKER_PUBLIC.includes(relativePath)) {
    rows.push({
      endpoint: label,
      ownerTier: entry?.owner_tier || "-",
      size: entry?.size_kb ?? actual.size_kb,
      startupSafe: entry?.startup_safe === true ? "yes" : "no",
      deployIncluded: entry?.included_in_deploy === true || deployListed ? "yes" : "no",
      loadStrategy: entry?.load_strategy || "-",
      issue: issueText(endpointIssues, endpointWarnings)
    });
  }
}

console.log("Deploy endpoint audit:");
console.log(`- manifest entries: ${manifestEntries.length}`);
console.log(`- Cloudflare whitelist entries: ${deployWhitelist.size}`);
console.log(`- required lightweight outputs: ${REQUIRED_WORKER_PUBLIC.length}`);
console.log(`- build artifact roots: ${artifactRoots.length ? artifactRoots.join(", ") : "none detected"}`);
console.log(`- overview first-paint endpoints: ${firstPaintEndpoints.size}`);

console.log("\nEndpoint | Owner Tier | Size KB | Startup Safe | Deploy Included | Load Strategy | Issue");
console.log("--- | --- | ---: | --- | --- | --- | ---");
for (const row of rows.sort((a, b) => String(a.endpoint).localeCompare(String(b.endpoint)))) {
  console.log(`${row.endpoint} | ${row.ownerTier} | ${row.size ?? 0} | ${row.startupSafe} | ${row.deployIncluded} | ${row.loadStrategy} | ${row.issue}`);
}

if (warnings.length) {
  console.log("\nWarnings:");
  for (const warning of warnings) console.log(`- ${warning}`);
}

if (problems.length) {
  console.log("\nProblems:");
  for (const problem of problems) console.log(`- ${problem}`);
  process.exitCode = 1;
} else {
  console.log("\nDeploy endpoint audit passed.");
}
