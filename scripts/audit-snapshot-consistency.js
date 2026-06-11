#!/usr/bin/env node

import fs from "fs";
import path from "path";

const ROOT = process.cwd();

const CRITICAL_SUMMARIES = [
  "dashboard/api/bootstrap.json",
  "dashboard/api/status-summary.json",
  "dashboard/api/vessel-count-reconciliation.json",
  "dashboard/api/endpoint-manifest.json",
  "dashboard/api/vessels/index.json",
  "dashboard/api/targets/categories-summary.json",
  "dashboard/api/sales/verification-queue-summary.json"
];

const MANIFEST_CRITICAL_ENDPOINTS = new Set([
  "dashboard/api/bootstrap.json",
  "dashboard/api/status-summary.json",
  "dashboard/api/vessel-count-reconciliation.json",
  "dashboard/api/vessels/index.json",
  "dashboard/api/targets/categories-summary.json",
  "dashboard/api/sales/verification-queue-summary.json"
]);

function readJson(relativePath) {
  const filePath = path.join(ROOT, ...relativePath.split("/"));
  const text = fs.readFileSync(filePath, "utf8");
  const payload = JSON.parse(text);
  return { text, payload };
}

function firstValue(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return null;
}

function finiteNumber(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function countFromItems(payload = {}) {
  if (Array.isArray(payload.items)) return payload.items.length;
  if (Array.isArray(payload.data)) return payload.data.length;
  if (Array.isArray(payload.vessels)) return payload.vessels.length;
  if (Array.isArray(payload.candidates)) return payload.candidates.length;
  if (Array.isArray(payload.categories)) return payload.categories.length;
  if (Array.isArray(payload.endpoints)) return payload.endpoints.length;
  return 0;
}

function summaryInfo(relativePath) {
  const exists = fs.existsSync(path.join(ROOT, ...relativePath.split("/")));
  if (!exists) {
    return {
      path: relativePath,
      exists: false,
      generated_at: null,
      run_id: null,
      source_run_id: null,
      data_mode: null,
      total_vessels: null,
      detail_eligible_vessel_count: null,
      sales_target_count: null,
      item_count: null,
      problem: "missing_file"
    };
  }
  try {
    const { payload } = readJson(relativePath);
    const context = payload.snapshot_context && typeof payload.snapshot_context === "object" ? payload.snapshot_context : {};
    return {
      path: relativePath,
      exists: true,
      generated_at: firstValue(context.generated_at, payload.generated_at),
      run_id: firstValue(context.run_id, payload.run_id, payload.active_run_id, payload.latest_successful_run_id),
      source_run_id: firstValue(context.source_run_id, payload.source_run_id, payload.status_run_id, payload.active_run_id, payload.latest_successful_run_id),
      data_mode: firstValue(context.data_mode, payload.data_mode),
      total_vessels: finiteNumber(
        payload.kpis?.total_vessels,
        payload.counts?.total_vessels,
        payload.counts?.total_detected_vessels,
        payload.total_vessels,
        payload.total_detected_vessels,
        payload.total_rows
      ),
      detail_eligible_vessel_count: finiteNumber(
        payload.kpis?.detail_eligible_vessel_count,
        payload.counts?.detail_eligible_vessel_count,
        payload.counts?.display_vessel_count,
        payload.detail_eligible_vessel_count,
        payload.display_vessel_count,
        payload.total_count
      ),
      sales_target_count: finiteNumber(
        payload.kpis?.sales_target_count,
        payload.counts?.sales_target_count,
        payload.sales_target_count
      ),
      item_count: finiteNumber(payload.item_count, countFromItems(payload)),
      problem: ""
    };
  } catch (error) {
    return {
      path: relativePath,
      exists: true,
      generated_at: null,
      run_id: null,
      source_run_id: null,
      data_mode: null,
      total_vessels: null,
      detail_eligible_vessel_count: null,
      sales_target_count: null,
      item_count: null,
      problem: error.message
    };
  }
}

function uniqueNonEmpty(values) {
  return [...new Set(values.filter(value => value !== null && value !== undefined && value !== ""))];
}

function compareField(rows, field, expected, failures, { requiredPaths = [] } = {}) {
  for (const row of rows) {
    if (!requiredPaths.includes(row.path) && (row[field] === null || row[field] === undefined || row[field] === "")) continue;
    if (row[field] !== expected) {
      failures.push(`${row.path}: ${field}=${row[field] ?? "(missing)"} expected=${expected}`);
    }
  }
}

const rows = CRITICAL_SUMMARIES.map(summaryInfo);
const failures = [];

for (const row of rows) {
  if (!row.exists || row.problem) failures.push(`${row.path}: ${row.problem || "missing_file"}`);
}

const bootstrap = rows.find(row => row.path === "dashboard/api/bootstrap.json");
const statusSummary = rows.find(row => row.path === "dashboard/api/status-summary.json");
const reconciliation = rows.find(row => row.path === "dashboard/api/vessel-count-reconciliation.json");
const manifest = rows.find(row => row.path === "dashboard/api/endpoint-manifest.json");

const expectedGeneratedAt = bootstrap?.generated_at;
if (!expectedGeneratedAt) {
  failures.push("dashboard/api/bootstrap.json: missing generated_at");
} else {
  compareField(rows, "generated_at", expectedGeneratedAt, failures, { requiredPaths: CRITICAL_SUMMARIES });
}

const expectedRunId = firstValue(bootstrap?.run_id, statusSummary?.run_id, reconciliation?.run_id);
if (expectedRunId) {
  compareField([bootstrap, statusSummary, reconciliation].filter(Boolean), "run_id", expectedRunId, failures, {
    requiredPaths: [
      "dashboard/api/bootstrap.json",
      "dashboard/api/status-summary.json",
      "dashboard/api/vessel-count-reconciliation.json"
    ]
  });
}

const expectedTotalVessels = firstValue(bootstrap?.total_vessels, reconciliation?.total_vessels);
if (expectedTotalVessels !== null) {
  compareField([bootstrap, reconciliation, rows.find(row => row.path === "dashboard/api/vessels/index.json")].filter(Boolean), "total_vessels", expectedTotalVessels, failures);
}

const expectedDetailEligible = firstValue(reconciliation?.detail_eligible_vessel_count, rows.find(row => row.path === "dashboard/api/vessels/index.json")?.detail_eligible_vessel_count);
if (expectedDetailEligible !== null) {
  compareField([reconciliation, rows.find(row => row.path === "dashboard/api/vessels/index.json")].filter(Boolean), "detail_eligible_vessel_count", expectedDetailEligible, failures);
}

const expectedSalesTargets = firstValue(bootstrap?.sales_target_count, reconciliation?.sales_target_count);
if (expectedSalesTargets !== null) {
  compareField([bootstrap, reconciliation, rows.find(row => row.path === "dashboard/api/targets/categories-summary.json")].filter(Boolean), "sales_target_count", expectedSalesTargets, failures);
}

let manifestPayload = null;
try {
  manifestPayload = readJson("dashboard/api/endpoint-manifest.json").payload;
} catch (error) {
  failures.push(`dashboard/api/endpoint-manifest.json: ${error.message}`);
}

if (manifestPayload) {
  if (manifestPayload.generated_at !== expectedGeneratedAt) {
    failures.push(`dashboard/api/endpoint-manifest.json: generated_at=${manifestPayload.generated_at} expected=${expectedGeneratedAt}`);
  }
  if (manifestPayload.snapshot_context?.generated_at !== expectedGeneratedAt) {
    failures.push(`dashboard/api/endpoint-manifest.json: snapshot_context.generated_at=${manifestPayload.snapshot_context?.generated_at ?? "(missing)"} expected=${expectedGeneratedAt}`);
  }
  const endpoints = Array.isArray(manifestPayload.endpoints) ? manifestPayload.endpoints : [];
  const byPath = new Map(endpoints.map(entry => [entry.path, entry]));
  for (const endpointPath of MANIFEST_CRITICAL_ENDPOINTS) {
    const entry = byPath.get(endpointPath);
    if (!entry) {
      failures.push(`endpoint-manifest: missing ${endpointPath}`);
      continue;
    }
    if (entry.parsed_from_disk !== true) failures.push(`${endpointPath}: parsed_from_disk is not true`);
    if (!entry.parse_checked_at) failures.push(`${endpointPath}: missing parse_checked_at`);
    if (entry.parse_checked_at !== expectedGeneratedAt) {
      failures.push(`${endpointPath}: parse_checked_at=${entry.parse_checked_at ?? "(missing)"} expected=${expectedGeneratedAt}`);
    }
    if (entry.valid_json !== true) failures.push(`${endpointPath}: manifest valid_json is not true`);
  }
}

console.log("Snapshot consistency audit:");
console.log("File | generated_at | run_id | source_run_id | data_mode | total_vessels | detail_eligible | sales_target_count | item_count | Problem");
for (const row of rows) {
  console.log([
    row.path,
    row.generated_at ?? "-",
    row.run_id ?? "-",
    row.source_run_id ?? "-",
    row.data_mode ?? "-",
    row.total_vessels ?? "-",
    row.detail_eligible_vessel_count ?? "-",
    row.sales_target_count ?? "-",
    row.item_count ?? "-",
    row.problem || "-"
  ].join(" | "));
}

console.log(`\nDistinct generated_at values: ${uniqueNonEmpty(rows.map(row => row.generated_at)).join(", ") || "-"}`);
console.log(`Distinct run_id values: ${uniqueNonEmpty(rows.map(row => row.run_id)).join(", ") || "-"}`);

if (failures.length) {
  console.error("\nSnapshot consistency audit failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("\nSummary: snapshot context is consistent across critical overview summaries.");
