#!/usr/bin/env node

import fs from "fs";
import path from "path";

const ROOT = process.cwd();
const API_ROOT = path.join(ROOT, "dashboard", "api");

const CRITICAL_ENDPOINTS = new Set([
  "dashboard/api/bootstrap.json",
  "dashboard/api/dashboard-summary.json",
  "dashboard/api/status.json",
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

function repoPath(filePath) {
  return path.relative(ROOT, filePath).replace(/\\/g, "/");
}

function listJsonFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listJsonFiles(fullPath));
    else if (entry.isFile() && entry.name.endsWith(".json")) out.push(fullPath);
  }
  return out;
}

function firstJsonCharacter(text = "") {
  const match = String(text || "").replace(/^\uFEFF/, "").match(/\S/);
  return match ? match[0] : "";
}

function rootType(value) {
  if (Array.isArray(value)) return "array";
  if (value === null) return "null";
  return typeof value;
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

function hasRowsArray(payload) {
  return rows(payload).length > 0 ||
    Array.isArray(payload?.items) ||
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

function findBadValues(value, currentPath = "$", found = []) {
  if (found.length > 20) return found;
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

function schemaProblems(relativePath, payload, firstChar) {
  const problems = [];
  const critical = CRITICAL_ENDPOINTS.has(relativePath);
  if (!payload || typeof payload !== "object" || (critical && Array.isArray(payload))) {
    problems.push("root_object_required");
    return problems;
  }
  if (critical && firstChar !== "{") problems.push("critical_first_char_not_object");
  if (!Array.isArray(payload)) {
    if (critical || needsWrapper(relativePath) || relativePath.endsWith("endpoint-manifest.json")) {
      if (!payload.schema_version) problems.push("missing_schema_version");
      if (!payload.generated_at) problems.push("missing_generated_at");
    }
    if (critical) {
      const count = Number(payload.record_count ?? payload.total_count ?? payload.total_vessels);
      if (!Number.isFinite(count)) problems.push("missing_numeric_record_count");
    }
    if (needsWrapper(relativePath) && !hasRowsArray(payload)) problems.push("missing_items_array");
  }
  const badValues = findBadValues(payload);
  if (badValues.length) problems.push(`bad_values:${badValues.slice(0, 5).join(",")}`);
  return problems;
}

function auditFile(filePath) {
  const relativePath = repoPath(filePath);
  const text = fs.readFileSync(filePath, "utf8");
  const size = fs.statSync(filePath).size;
  const firstChar = firstJsonCharacter(text);
  const problems = [];
  if (!firstChar) problems.push("empty_file");
  else if (!["{", "["].includes(firstChar)) problems.push(`leading_text_before_json_root:${firstChar}`);
  try {
    const payload = JSON.parse(text);
    const root = rootType(payload);
    problems.push(...schemaProblems(relativePath, payload, firstChar));
    return {
      file: relativePath,
      firstChar: firstChar || "-",
      rootType: root,
      parseOk: true,
      schemaOk: problems.length === 0,
      size,
      problem: problems.join("; ") || "-"
    };
  } catch (error) {
    problems.push(error.message);
    return {
      file: relativePath,
      firstChar: firstChar || "-",
      rootType: "-",
      parseOk: false,
      schemaOk: false,
      size,
      problem: problems.join("; ")
    };
  }
}

const files = listJsonFiles(API_ROOT).sort();
const entries = files.map(auditFile);

console.log("File | First Char | Root Type | Parse OK | Schema OK | Size | Problem");
for (const entry of entries) {
  console.log([
    entry.file,
    entry.firstChar,
    entry.rootType,
    entry.parseOk ? "yes" : "no",
    entry.schemaOk ? "yes" : "no",
    entry.size,
    entry.problem
  ].join(" | "));
}

const failures = entries.filter(entry => !entry.parseOk || (CRITICAL_ENDPOINTS.has(entry.file) && !entry.schemaOk) || /leading_text_before_json_root|bad_values/.test(entry.problem));

console.log(`\nSummary: files=${entries.length}, failures=${failures.length}`);
if (failures.length) {
  console.error("JSON write audit failed:");
  for (const failure of failures) console.error(`- ${failure.file}: ${failure.problem}`);
  process.exit(1);
}
