#!/usr/bin/env node

import fs from "fs";
import path from "path";

const ROOT = process.cwd();

const ENDPOINTS = [
  {
    key: "sales/actions",
    file: "dashboard/api/sales/actions.json",
    required: true
  },
  {
    key: "targets/current",
    file: "dashboard/api/targets/current.json",
    required: true
  },
  {
    key: "sales/quote-opportunities",
    file: "dashboard/api/sales/quote-opportunities.json",
    required: true
  },
  {
    key: "watchlist/current",
    file: "dashboard/api/watchlist/current.json",
    required: true,
    filter: item => !item.watch_type || item.watch_type === "VESSEL" || item.vessel_display
  },
  {
    key: "bootstrap.top_candidates",
    file: "dashboard/api/bootstrap.json",
    required: true,
    rows: payload => rows(payload.top_candidates)
  }
];

function fullPath(relativePath) {
  return path.join(ROOT, ...relativePath.split("/"));
}

function readJson(relativePath) {
  const file = fullPath(relativePath);
  try {
    return {
      file,
      payload: JSON.parse(fs.readFileSync(file, "utf8")),
      error: null
    };
  } catch (error) {
    return { file, payload: null, error: error.message };
  }
}

function rows(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.items)) return value.items;
  if (Array.isArray(value?.data)) return value.data;
  if (Array.isArray(value?.vessels)) return value.vessels;
  if (Array.isArray(value?.candidates)) return value.candidates;
  if (Array.isArray(value?.opportunities)) return value.opportunities;
  return [];
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function displayName(item = {}) {
  const display = item.vessel_display || {};
  return item.vessel_name || display.vessel_name || item.watch_name || item.name || "-";
}

function confidence(item = {}) {
  const display = item.vessel_display || {};
  return {
    score: number(item.commercial_data_confidence ?? display.commercial_data_confidence),
    label: String(item.confidence_label || display.confidence_label || "").toUpperCase(),
    missing: Array.isArray(item.missing_critical_fields)
      ? item.missing_critical_fields
      : Array.isArray(display.missing_critical_fields)
        ? display.missing_critical_fields
        : [],
    available: Array.isArray(item.available_strong_fields)
      ? item.available_strong_fields
      : Array.isArray(display.available_strong_fields)
        ? display.available_strong_fields
        : [],
    reason: item.confidence_reason || display.confidence_reason || ""
  };
}

function addMissingFieldCounts(counts, fields = []) {
  for (const field of fields) {
    const key = String(field || "-").trim() || "-";
    counts.set(key, (counts.get(key) || 0) + 1);
  }
}

const endpointResults = [];
const globalMissing = new Map();
const problems = [];

for (const endpoint of ENDPOINTS) {
  const { file, payload, error } = readJson(endpoint.file);
  if (error) {
    endpointResults.push({
      ...endpoint,
      file,
      error,
      itemCount: 0,
      scoredCount: 0,
      labels: { HIGH: 0, MEDIUM: 0, LOW: 0 },
      invalidCount: 0,
      lowSamples: []
    });
    if (endpoint.required) problems.push(`${endpoint.key}: cannot read JSON (${error})`);
    continue;
  }

  const extractRows = endpoint.rows || rows;
  const rawItems = extractRows(payload);
  const items = endpoint.filter ? rawItems.filter(endpoint.filter) : rawItems;
  const labels = { HIGH: 0, MEDIUM: 0, LOW: 0 };
  let scoredCount = 0;
  let invalidCount = 0;
  const localMissing = new Map();
  const lowSamples = [];

  for (const item of items) {
    const c = confidence(item);
    const validScore = c.score !== null && c.score >= 0 && c.score <= 100;
    const validLabel = ["HIGH", "MEDIUM", "LOW"].includes(c.label);
    if (validScore && validLabel) {
      scoredCount += 1;
      labels[c.label] += 1;
      addMissingFieldCounts(localMissing, c.missing);
      addMissingFieldCounts(globalMissing, c.missing);
      if (c.label === "LOW" && lowSamples.length < 5) {
        lowSamples.push({
          vessel: displayName(item),
          score: c.score,
          missing: c.missing,
          reason: c.reason
        });
      }
    } else {
      invalidCount += 1;
    }
  }

  if (items.length > 0 && scoredCount === 0) {
    problems.push(`${endpoint.key}: ${items.length} rows but no valid commercial confidence fields`);
  }
  if (invalidCount > 0) {
    problems.push(`${endpoint.key}: ${invalidCount} rows have invalid or missing confidence fields`);
  }

  endpointResults.push({
    ...endpoint,
    file,
    generatedAt: payload.generated_at || "-",
    itemCount: items.length,
    rawItemCount: rawItems.length,
    scoredCount,
    labels,
    invalidCount,
    topMissing: [...localMissing.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8),
    lowSamples
  });
}

console.log("Commercial Data Confidence Audit");
console.log("================================");

for (const result of endpointResults) {
  console.log("");
  console.log(`${result.key}`);
  console.log(`- file: ${result.file}`);
  if (result.error) {
    console.log(`- ERROR: ${result.error}`);
    continue;
  }
  console.log(`- generated_at: ${result.generatedAt}`);
  console.log(`- rows checked: ${result.itemCount} (raw ${result.rawItemCount})`);
  console.log(`- scored rows: ${result.scoredCount}`);
  console.log(`- HIGH / MEDIUM / LOW: ${result.labels.HIGH} / ${result.labels.MEDIUM} / ${result.labels.LOW}`);
  console.log(`- invalid rows: ${result.invalidCount}`);
  console.log("- top missing critical fields:");
  if (result.topMissing.length === 0) console.log("  - none");
  for (const [field, count] of result.topMissing) console.log(`  - ${field}: ${count}`);
  if (result.lowSamples.length) {
    console.log("- LOW confidence samples:");
    for (const sample of result.lowSamples) {
      console.log(`  - ${sample.vessel} | ${sample.score} | missing=${sample.missing.join(", ") || "-"}`);
    }
  }
}

console.log("");
console.log("Portfolio missing critical fields:");
const missing = [...globalMissing.entries()].sort((a, b) => b[1] - a[1]);
if (missing.length === 0) console.log("- none");
for (const [field, count] of missing.slice(0, 12)) console.log(`- ${field}: ${count}`);

if (problems.length) {
  console.log("");
  console.log("Problems:");
  for (const problem of problems) console.log(`- ${problem}`);
  process.exit(1);
}
