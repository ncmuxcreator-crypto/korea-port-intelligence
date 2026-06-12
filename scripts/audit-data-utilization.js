#!/usr/bin/env node

import fs from "fs";
import path from "path";

const ROOT = process.cwd();
const API_ROOT = path.join(ROOT, "dashboard", "api");
const MANIFEST_PATH = path.join(API_ROOT, "endpoint-manifest.json");
const STARTUP_LIMIT_BYTES = 300 * 1024;
const SUMMARY_LIMIT_BYTES = 100 * 1024;
const DETAIL_LIMIT_BYTES = 500 * 1024;

const SUMMARY_DETAIL_PAIRS = [
  ["dashboard/api/all-collected-vessels.json", "dashboard/api/all-collected-vessels-summary.json"],
  ["dashboard/api/target-vessels.json", "dashboard/api/target-vessels-summary.json"],
  ["dashboard/api/vessels.json", "dashboard/api/vessels-summary.json"],
  ["dashboard/api/candidates.json", "dashboard/api/candidates-summary.json"],
  ["dashboard/api/candidates/top.json", "dashboard/api/candidates/top-summary.json"],
  ["dashboard/api/hot-vessels.json", "dashboard/api/hot-vessels-summary.json"],
  ["dashboard/api/sales/actions.json", "dashboard/api/sales/actions-summary.json"],
  ["dashboard/api/sales/verification-queue.json", "dashboard/api/sales/verification-queue-summary.json"],
  ["dashboard/api/targets/current.json", "dashboard/api/targets/current-summary.json"],
  ["dashboard/api/targets/categories.json", "dashboard/api/targets/categories-summary.json"],
  ["dashboard/api/staying-vessels.json", "dashboard/api/staying-vessels-summary.json"],
  ["dashboard/api/anchorage-waiting.json", "dashboard/api/anchorage-waiting-summary.json"],
  ["dashboard/api/arrival-pipeline.json", "dashboard/api/arrival-pipeline-summary.json"],
  ["dashboard/api/predicted-arrivals.json", "dashboard/api/predicted-arrivals-summary.json"],
  ["dashboard/api/commercial-command-center.json", "dashboard/api/commercial-command-center-summary.json"],
  ["dashboard/api/biofouling/vessel-risk-scores.json", "dashboard/api/biofouling/vessel-risk-scores-summary.json"],
  ["dashboard/api/intelligence/contact-coverage.json", "dashboard/api/intelligence/contact-coverage-summary.json"],
  ["dashboard/api/status.json", "dashboard/api/status-summary.json"]
];

function readJson(relativePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, ...relativePath.split("/")), "utf8"));
  } catch {
    return fallback;
  }
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

function toRepoPath(filePath) {
  return path.relative(ROOT, filePath).replace(/\\/g, "/");
}

function rows(payload) {
  if (Array.isArray(payload)) return payload;
  for (const key of ["items", "data", "vessels", "candidates", "categories", "ports", "opportunities", "endpoints"]) {
    if (Array.isArray(payload?.[key])) return payload[key];
  }
  return [];
}

function recordCount(payload) {
  if (Array.isArray(payload)) return payload.length;
  for (const key of ["record_count", "total_count", "total_vessels", "target_count"]) {
    if (Number.isFinite(Number(payload?.[key]))) return Number(payload[key]);
  }
  return rows(payload).length;
}

function endpointLayer(relativePath = "") {
  const normalized = String(relativePath || "").replace(/\\/g, "/");
  if (/dashboard\/api\/aux\//.test(normalized) || /source-csv|vessel-spec|ais-|pilotage|berth|vts|ulsan/i.test(normalized)) return "auxiliary";
  if (/dashboard\/api\/(?:debug|quality|review)\//.test(normalized) || /status\.json|source-health|source-collection|health\/pipeline|readiness|snapshot|continuity|storage-efficiency|diagnostic|audit|imo-recovery/i.test(normalized)) return "diagnostic";
  return "core";
}

function fileInfo(filePath) {
  const relativePath = toRepoPath(filePath);
  const text = fs.readFileSync(filePath, "utf8");
  let payload = null;
  let parseOk = true;
  try {
    payload = JSON.parse(text);
  } catch {
    parseOk = false;
  }
  const bytes = fs.statSync(filePath).size;
  const vesselDisplayRepeats = (text.match(/"vessel_display"/g) || []).length;
  const itemCount = parseOk ? rows(payload).length : 0;
  return {
    path: relativePath,
    bytes,
    size_kb: Math.round((bytes / 1024) * 10) / 10,
    layer: endpointLayer(relativePath),
    parse_ok: parseOk,
    record_count: parseOk ? recordCount(payload) : 0,
    item_count: itemCount,
    vessel_display_repeats: vesselDisplayRepeats,
    repeated_vessel_display_estimate_kb: Math.round((vesselDisplayRepeats * 1.8) * 10) / 10
  };
}

function sumBytes(files) {
  return files.reduce((sum, file) => sum + Number(file.bytes || 0), 0);
}

function top(files, count = 10) {
  return files.slice().sort((a, b) => b.bytes - a.bytes).slice(0, count);
}

function printEndpointTable(title, files) {
  console.log(`\n${title}`);
  for (const file of files) {
    console.log(`- ${file.path} | ${file.size_kb}KB | records=${file.record_count} | items=${file.item_count} | vessel_display=${file.vessel_display_repeats}`);
  }
}

const files = listJsonFiles(API_ROOT).map(fileInfo);
const dynamicPortSummaryPairs = files
  .filter(file => /^dashboard\/api\/ports\/[^/]+\/vessels\.json$/.test(file.path))
  .map(file => [file.path, file.path.replace(/\/vessels\.json$/, "/vessels-summary.json")]);
const effectiveSummaryDetailPairs = [...SUMMARY_DETAIL_PAIRS, ...dynamicPortSummaryPairs];
const manifest = readJson("dashboard/api/endpoint-manifest.json", {});
const manifestEntries = Array.isArray(manifest.endpoints) ? manifest.endpoints : [];
const startupEntries = manifestEntries.filter(entry => entry.startup_safe === true || entry.load_strategy === "initial");
const startupPayloadBytes = startupEntries.reduce((sum, entry) => sum + Number(entry.bytes || 0), 0);
const coreFiles = files.filter(file => file.layer === "core");
const auxiliaryFiles = files.filter(file => file.layer === "auxiliary");
const diagnosticFiles = files.filter(file => file.layer === "diagnostic");
const largest = top(files, 12);
const repeatedDisplayFiles = files
  .filter(file => file.vessel_display_repeats > 25)
  .sort((a, b) => b.vessel_display_repeats - a.vessel_display_repeats)
  .slice(0, 10);

const summaryProblems = [];
for (const [detail, summary] of effectiveSummaryDetailPairs) {
  const detailInfo = files.find(file => file.path === detail);
  const summaryInfo = files.find(file => file.path === summary);
  if (!summaryInfo) {
    summaryProblems.push(`${detail}: missing summary ${summary}`);
  } else if (summaryInfo.bytes > SUMMARY_LIMIT_BYTES) {
    summaryProblems.push(`${summary}: summary too large (${summaryInfo.size_kb}KB)`);
  }
  if (detailInfo && detailInfo.bytes > DETAIL_LIMIT_BYTES && !summaryInfo) {
    summaryProblems.push(`${detail}: >500KB without summary`);
  }
}

const oversizedLazy = files.filter(file => file.bytes > DETAIL_LIMIT_BYTES && !effectiveSummaryDetailPairs.some(([detail]) => detail === file.path));
const startupViolations = startupEntries.filter(entry => Number(entry.bytes || 0) > (entry.path === "dashboard/api/bootstrap.json" ? 150 * 1024 : SUMMARY_LIMIT_BYTES));

const sourceStatus = readJson("dashboard/api/source-collection-status.json", {});
const sourceItems = Array.isArray(sourceStatus.items) ? sourceStatus.items : [];
const sourceByKey = new Map(sourceItems.map(item => [item.source_key || item.key, item]));
const sourceCsv = readJson("dashboard/api/aux/source-csv-summary.json", {});
const pilotage = sourceByKey.get("pilot_sources") || {};
const berth = sourceByKey.get("berth_sources") || {};
const vesselSpec = sourceByKey.get("vessel_spec") || readJson("dashboard/api/aux/vessel-spec-summary.json", {});
const storage = readJson("dashboard/api/storage-efficiency-report.json", {});

console.log("Data utilization audit:");
console.log(`- core endpoint count: ${coreFiles.length} | size: ${Math.round((sumBytes(coreFiles) / 1024) * 10) / 10}KB`);
console.log(`- auxiliary endpoint count: ${auxiliaryFiles.length} | size: ${Math.round((sumBytes(auxiliaryFiles) / 1024) * 10) / 10}KB`);
console.log(`- diagnostic endpoint count: ${diagnosticFiles.length} | size: ${Math.round((sumBytes(diagnosticFiles) / 1024) * 10) / 10}KB`);
console.log(`- startup payload size: ${Math.round((startupPayloadBytes / 1024) * 10) / 10}KB`);
console.log(`- repeated vessel_display estimate: ${Math.round(repeatedDisplayFiles.reduce((sum, file) => sum + file.repeated_vessel_display_estimate_kb, 0) * 10) / 10}KB`);

printEndpointTable("Largest endpoints", largest);
printEndpointTable("Repeated vessel_display hotspots", repeatedDisplayFiles);

console.log("\nSummary/detail split opportunities");
for (const [detail, summary] of effectiveSummaryDetailPairs) {
  const detailInfo = files.find(file => file.path === detail);
  const summaryInfo = files.find(file => file.path === summary);
  console.log(`- ${detail} -> ${summary} | detail=${detailInfo ? `${detailInfo.size_kb}KB` : "missing"} | summary=${summaryInfo ? `${summaryInfo.size_kb}KB` : "missing"}`);
}

console.log("\nAuxiliary source utilization");
console.log(`- source_csv: status=${sourceCsv.status || sourceByKey.get("source_csv")?.status || "unknown"} | source_too_large=${Boolean(sourceCsv.source_too_large)} | usable_reference_rows=${sourceCsv.usable_reference_rows ?? 0}`);
console.log(`- pilotage: rows_collected=${pilotage.rows_collected ?? 0} | rows_normalized=${pilotage.rows_normalized ?? 0} | matched_vessels=${pilotage.matched_vessels ?? pilotage.pilotage_signal_count ?? 0}`);
console.log(`- berth: rows_collected=${berth.rows_collected ?? 0} | rows_normalized=${berth.rows_normalized ?? 0} | status=${berth.status || "unknown"}`);
console.log(`- vessel_spec: status=${vesselSpec.status || "unknown"} | configured=${Boolean(vesselSpec.configured ?? vesselSpec.collector_enabled)} | skip_reason=${vesselSpec.skip_reason || (Array.isArray(vesselSpec.skip_reasons) ? vesselSpec.skip_reasons.join(",") : "") || "none"}`);

console.log("\nStorage efficiency");
const tableRows = Array.isArray(storage.row_counts_by_table) ? storage.row_counts_by_table : [];
console.log(`- storage report exists: ${storage.schema_version ? "yes" : "no"}`);
console.log(`- row-counted tables: ${tableRows.length}`);
for (const row of tableRows.slice(0, 10)) console.log(`  - ${row.table_name}: ${row.row_count}`);
const cleanup = Array.isArray(storage.cleanup_candidates) ? storage.cleanup_candidates : [];
console.log(`- cleanup candidates: ${cleanup.length}`);

const problems = [];
if (startupPayloadBytes > STARTUP_LIMIT_BYTES) problems.push(`startup payload exceeds 300KB (${Math.round(startupPayloadBytes / 1024)}KB)`);
for (const entry of startupViolations) problems.push(`startup endpoint too large: ${entry.path} ${Math.round(Number(entry.bytes || 0) / 1024)}KB`);
for (const problem of summaryProblems) problems.push(problem);
for (const file of oversizedLazy) problems.push(`lazy endpoint >500KB without registered summary/detail split: ${file.path} ${file.size_kb}KB`);
if (sourceCsv.source_too_large || String(sourceByKey.get("source_csv")?.status || "").toUpperCase() === "SOURCE_TOO_LARGE") {
  problems.push("source_csv oversized: keep auxiliary and create smaller verified reference CSV");
}
if (Number(pilotage.rows_normalized || 0) > 0 && Number(pilotage.matched_vessels || pilotage.pilotage_signal_count || 0) === 0) {
  problems.push("pilotage normalized rows exist but no matched vessels/pilotage_signal detected");
}
if (Number(berth.rows_collected || 0) > 0 && Number(berth.rows_normalized || 0) === 0) {
  problems.push("berth rows collected but rows_normalized=0 utilization loss");
}
if (String(vesselSpec.status || "").toUpperCase() === "NOT_ATTEMPTED" && !(vesselSpec.skip_reason || vesselSpec.skip_reasons)) {
  problems.push("vessel_spec NOT_ATTEMPTED without exact blocker");
}
if (!storage.schema_version) problems.push("storage-efficiency-report.json missing");

if (problems.length) {
  console.log("\nFindings:");
  for (const problem of problems) console.log(`- ${problem}`);
} else {
  console.log("\nData utilization looks efficient.");
}
