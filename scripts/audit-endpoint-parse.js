#!/usr/bin/env node

import fs from "fs";
import path from "path";

const ROOT = process.cwd();
const API_ROOT = path.join(ROOT, "dashboard", "api");
const MANIFEST_PATH = path.join(API_ROOT, "endpoint-manifest.json");
const TOO_LARGE_BYTES = 500 * 1024;

const REQUIRED_ITEM_ENDPOINTS = [
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

const STRICT_ENDPOINTS = new Set([
  "dashboard/api/bootstrap.json",
  "dashboard/api/status.json",
  "dashboard/api/dashboard-summary.json",
  "dashboard/api/sales/actions.json",
  "dashboard/api/sales/conversion-pipeline.json",
  "dashboard/api/watchlist/current.json",
  "dashboard/api/targets/categories.json",
  "dashboard/api/vessels/index.json",
  "dashboard/api/vessels/page-1.json"
]);

function repoPath(filePath) {
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

function firstArrayKey(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return "";
  for (const key of ["items", "data", "vessels", "candidates", "opportunities", "contact_today", "ports", "categories", "endpoints", "pages"]) {
    if (Array.isArray(payload[key])) return key;
  }
  return "";
}

function itemCount(payload) {
  if (Array.isArray(payload)) return payload.length;
  const key = firstArrayKey(payload);
  return key ? payload[key].length : 0;
}

function recordCount(payload) {
  if (Array.isArray(payload)) return payload.length;
  const value = Number(payload?.record_count ?? payload?.total_count ?? payload?.total_vessels ?? payload?.all_vessels_count);
  return Number.isFinite(value) ? value : itemCount(payload);
}

function requiresItems(relativePath) {
  return REQUIRED_ITEM_ENDPOINTS.some(pattern => pattern.test(relativePath));
}

function findBadValues(value, currentPath = "$", found = []) {
  if (found.length > 25) return found;
  if (value === undefined) {
    found.push(`${currentPath}:undefined`);
  } else if (typeof value === "number" && !Number.isFinite(value)) {
    found.push(`${currentPath}:${String(value)}`);
  } else if (typeof value === "string") {
    if (/^(undefined|nan|infinity|-infinity)$/i.test(value.trim())) found.push(`${currentPath}:${value}`);
    if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(value)) found.push(`${currentPath}:control_character`);
  } else if (Array.isArray(value)) {
    value.forEach((item, index) => findBadValues(item, `${currentPath}[${index}]`, found));
  } else if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) findBadValues(child, `${currentPath}.${key}`, found);
  }
  return found;
}

function validatePayload(relativePath, payload) {
  const problems = [];
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) problems.push("root_object_required");
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    if (!payload.schema_version) problems.push("missing_schema_version");
    if (!payload.generated_at) problems.push("missing_generated_at");
    if (!("record_count" in payload) && !("total_count" in payload) && !("total_vessels" in payload)) problems.push("missing_record_count");
    if (!("item_count" in payload)) problems.push("missing_item_count");
    const count = Number(payload.item_count);
    if (!Number.isFinite(count)) problems.push("invalid_item_count");
    const key = firstArrayKey(payload);
    if (requiresItems(relativePath) && !key) problems.push("missing_items_array");
    if (key && Number(payload.item_count) !== payload[key].length) problems.push(`item_count_mismatch:${payload.item_count}!=${payload[key].length}`);
  }
  const badValues = findBadValues(payload);
  if (badValues.length) problems.push(`bad_values:${badValues.slice(0, 5).join(",")}`);
  return problems;
}

function auditFile(filePath) {
  const relativePath = repoPath(filePath);
  const bytes = fs.statSync(filePath).size;
  const text = fs.readFileSync(filePath, "utf8");
  try {
    const payload = JSON.parse(text);
    const problems = validatePayload(relativePath, payload);
    const tooLarge = bytes > TOO_LARGE_BYTES;
    return {
      path: relativePath,
      exists: true,
      valid_json: true,
      schema_valid: problems.length === 0,
      record_count: recordCount(payload),
      item_count: itemCount(payload),
      bytes,
      status: problems.length ? "SCHEMA_MISMATCH" : tooLarge ? "TOO_LARGE" : "OK",
      problem: problems.join("; ") || (tooLarge ? `${Math.round(bytes / 1024)}KB; suggest summary/detail split` : "")
    };
  } catch (error) {
    return {
      path: relativePath,
      exists: true,
      valid_json: false,
      schema_valid: false,
      record_count: 0,
      item_count: 0,
      bytes,
      status: "INVALID_JSON",
      problem: error.message
    };
  }
}

function readManifest() {
  if (!fs.existsSync(MANIFEST_PATH)) return null;
  try {
    return JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
  } catch (error) {
    return { parse_error: error.message, endpoints: [] };
  }
}

const entries = listJsonFiles(API_ROOT).sort().map(auditFile);
const byPath = new Map(entries.map(entry => [entry.path, entry]));
const manifest = readManifest();
const manifestMismatches = [];

if (manifest?.parse_error) {
  manifestMismatches.push({ path: "dashboard/api/endpoint-manifest.json", problem: manifest.parse_error });
} else if (manifest?.endpoints) {
  for (const endpoint of manifest.endpoints) {
    const actual = byPath.get(endpoint.path);
    if (!actual) {
      manifestMismatches.push({ path: endpoint.path, problem: "manifest endpoint missing actual file" });
      continue;
    }
    for (const field of ["valid_json", "schema_valid", "record_count", "item_count", "status"]) {
      if (field in endpoint && String(endpoint[field]) !== String(actual[field])) {
        manifestMismatches.push({
          path: endpoint.path,
          problem: `${field} manifest=${endpoint[field]} actual=${actual[field]}`
        });
      }
    }
    if (endpoint.valid_json === true && actual.valid_json === false) {
      manifestMismatches.push({ path: endpoint.path, problem: "manifest_valid_json_true_but_parse_failed" });
    }
  }
}

console.log("Endpoint parse truth:");
console.log("Path | Parse | Schema | record_count | item_count | Size | Status | Problem");
for (const entry of entries) {
  console.log([
    entry.path,
    entry.valid_json ? "OK" : "FAIL",
    entry.schema_valid ? "OK" : "FAIL",
    entry.record_count,
    entry.item_count,
    `${Math.round(entry.bytes / 1024)}KB`,
    entry.status,
    entry.problem || "-"
  ].join(" | "));
}

if (manifestMismatches.length) {
  console.log("\nManifest mismatches:");
  for (const mismatch of manifestMismatches) console.log(`- ${mismatch.path}: ${mismatch.problem}`);
}

const invalid = entries.filter(entry => !entry.valid_json);
const strictSchema = entries.filter(entry => STRICT_ENDPOINTS.has(entry.path) && !entry.schema_valid);
const manifestWrong = manifestMismatches.filter(mismatch => /valid_json|parse|actual file|schema_valid|record_count|item_count|status/.test(mismatch.problem));
const large = entries.filter(entry => entry.status === "TOO_LARGE");

console.log(`\nSummary: files=${entries.length}, invalid_json=${invalid.length}, strict_schema_failures=${strictSchema.length}, too_large=${large.length}, manifest_mismatches=${manifestMismatches.length}`);
if (large.length) {
  console.log("Heavy endpoint warnings:");
  for (const entry of large.slice(0, 30)) console.log(`- ${entry.path}: ${Math.round(entry.bytes / 1024)}KB (summary/detail split recommended)`);
}

if (invalid.length || strictSchema.length || manifestWrong.length) {
  console.error("\nEndpoint parse audit failed:");
  for (const entry of invalid) console.error(`- ${entry.path}: ${entry.problem}`);
  for (const entry of strictSchema) console.error(`- ${entry.path}: ${entry.problem}`);
  for (const mismatch of manifestWrong) console.error(`- ${mismatch.path}: ${mismatch.problem}`);
  process.exit(1);
}
