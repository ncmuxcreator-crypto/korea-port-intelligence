#!/usr/bin/env node

import fs from "fs";
import path from "path";

const ROOT = process.cwd();
const MANIFEST_PATH = path.join(ROOT, "dashboard", "api", "endpoint-manifest.json");

const CRITICAL_FILES = [
  "dashboard/api/bootstrap.json",
  "dashboard/api/dashboard-summary.json",
  "dashboard/api/status.json",
  "dashboard/api/sales/actions.json",
  "dashboard/api/watchlist/current.json",
  "dashboard/api/vessels/index.json",
  "dashboard/api/vessels/page-1.json"
];

function readRaw(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function prefix(text) {
  return text
    .slice(0, 200)
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n")
    .replace(/\t/g, "\\t");
}

function firstNonWhitespace(text) {
  const match = text.match(/\S/);
  return match ? match[0] : "";
}

function rootType(value) {
  if (Array.isArray(value)) return "array";
  if (value === null) return "null";
  return typeof value;
}

function loadManifest() {
  if (!fs.existsSync(MANIFEST_PATH)) return { endpoints: [], error: "missing_manifest" };
  try {
    return JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
  } catch (error) {
    return { endpoints: [], error: error.message };
  }
}

const manifest = loadManifest();
const manifestByPath = new Map((manifest.endpoints || []).map(entry => [entry.path, entry]));
const rows = [];
const failures = [];

for (const relativePath of CRITICAL_FILES) {
  const row = {
    path: relativePath,
    exists: fs.existsSync(path.join(ROOT, relativePath)),
    first_200: "",
    first_non_whitespace: "",
    parse_ok: false,
    root_type: "-",
    schema_version: "-",
    generated_at: "-",
    problem: "-"
  };

  if (!row.exists) {
    row.problem = "missing_file";
    failures.push(`${relativePath}: missing_file`);
    rows.push(row);
    continue;
  }

  const raw = readRaw(relativePath);
  row.first_200 = prefix(raw);
  row.first_non_whitespace = firstNonWhitespace(raw) || "(empty)";

  if (row.first_non_whitespace !== "{") {
    row.problem = `first_non_whitespace_not_object:${row.first_non_whitespace}`;
    failures.push(`${relativePath}: ${row.problem}; prefix="${row.first_200}"`);
    rows.push(row);
    continue;
  }

  try {
    const parsed = JSON.parse(raw);
    row.parse_ok = true;
    row.root_type = rootType(parsed);
    row.schema_version = parsed?.schema_version ?? "-";
    row.generated_at = parsed?.generated_at ?? "-";
  } catch (error) {
    row.problem = `json_parse_failed:${error.message}`;
    failures.push(`${relativePath}: ${row.problem}; prefix="${row.first_200}"`);
  }

  const manifestEntry = manifestByPath.get(relativePath);
  if (manifestEntry?.valid_json === true && !row.parse_ok) {
    failures.push(`${relativePath}: endpoint-manifest valid_json=true but raw JSON.parse failed`);
  }

  rows.push(row);
}

if (manifest.error) {
  failures.push(`dashboard/api/endpoint-manifest.json: ${manifest.error}`);
}

console.log("Raw JSON parse truth:");
console.log("Path | First | Parse | Root | schema_version | generated_at | Prefix");
for (const row of rows) {
  console.log([
    row.path,
    row.first_non_whitespace,
    row.parse_ok ? "OK" : "FAIL",
    row.root_type,
    row.schema_version,
    row.generated_at,
    row.first_200
  ].join(" | "));
}

if (failures.length) {
  console.error("\nRaw JSON audit failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`\nSummary: critical_files=${CRITICAL_FILES.length}, failures=0`);
