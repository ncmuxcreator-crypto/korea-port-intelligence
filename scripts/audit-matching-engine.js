#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const FILES = {
  normalization: "dashboard/api/enrichment/normalization-diagnostics.json",
  sourceCsvDryRun: "dashboard/api/enrichment/source-csv-dry-run.json",
  pilotReview: "dashboard/api/review/pilotage-berth-matches.json"
};

function abs(relativePath) {
  return path.join(ROOT, ...relativePath.split("/"));
}

function readJson(relativePath, fallback = {}) {
  try {
    const file = abs(relativePath);
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : fallback;
  } catch (error) {
    return { ...fallback, __parse_error: error.message };
  }
}

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const normalization = readJson(FILES.normalization, { items: [], __missing: true });
const sourceCsvDryRun = readJson(FILES.sourceCsvDryRun, {});
const pilotReview = readJson(FILES.pilotReview, {});
const problems = [];

if (normalization.__missing) problems.push(`${FILES.normalization} missing`);
if (normalization.__parse_error) problems.push(`${FILES.normalization} parse error: ${normalization.__parse_error}`);

const items = Array.isArray(normalization.items) ? normalization.items : [];
const normalizedSources = items.filter(item => number(item.rows_normalized) > 0);
const sourcesWithoutKeys = normalizedSources.filter(item => number(item.rows_with_match_keys) === 0);
if (sourcesWithoutKeys.length) {
  problems.push(`normalized sources without match keys: ${sourcesWithoutKeys.map(item => item.source_key).join(",")}`);
}

const lowKeyCoverage = normalizedSources.filter(item => {
  const rows = number(item.rows_normalized);
  if (!rows) return false;
  return number(item.rows_with_match_keys) / rows < 0.5;
});

console.log("Matching Engine Audit");
console.log("=====================");
console.log(`normalization_diagnostics=${normalization.__missing ? "missing" : "present"}`);
console.log(`normalization_sources=${items.length}`);
console.log(`normalized_sources=${normalizedSources.length}`);
console.log(`sources_without_match_keys=${sourcesWithoutKeys.map(item => item.source_key).join(",") || "none"}`);
console.log(`low_match_key_coverage=${lowKeyCoverage.map(item => `${item.source_key}:${item.rows_with_match_keys}/${item.rows_normalized}`).join(",") || "none"}`);
console.log(`source_csv_matched_vessels=${number(sourceCsvDryRun.matched_vessels)} candidate_vessels_checked=${number(sourceCsvDryRun.candidate_vessels_checked)}`);
console.log(`pilot_review_items=${number(pilotReview.item_count || (pilotReview.items || []).length)}`);
console.log(`problems=${problems.length ? problems.join("; ") : "none"}`);

if (problems.length) process.exit(1);
