#!/usr/bin/env node

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

const FILES = [
  "dashboard/api/bootstrap.json",
  "dashboard/api/candidates/top.json",
  "dashboard/api/targets/current.json",
  "dashboard/api/sales/actions.json",
  "dashboard/api/sales/conversion-pipeline.json",
  "dashboard/api/sales/quote-opportunities.json",
  "dashboard/api/watchlist/current.json",
  "dashboard/api/vessels/index.json"
];

const VESSEL_PAGE_DIR = "dashboard/api/vessels";
const CONTRADICTION_CODES = [
  "GT_30000_PLUS",
  "GT_80000_PLUS",
  "HIGH_GT_VESSEL",
  "HIGH_VALUE_GT_30000_PLUS"
];

function readJson(relativePath) {
  const fullPath = path.join(ROOT, relativePath);
  if (!fs.existsSync(fullPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(fullPath, "utf8"));
  } catch (error) {
    return { __error: error.message, __path: relativePath };
  }
}

function rows(payload) {
  if (!payload || payload.__error) return [];
  if (Array.isArray(payload)) return payload;
  const out = [];
  const visit = value => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (value.vessel_display || value.tonnage_summary || value.vessel_name || value.watch_name) out.push(value);
    for (const key of ["items", "top_candidates", "sales_priority", "actions", "categories"]) {
      const child = value[key];
      if (Array.isArray(child)) child.forEach(visit);
    }
  };
  visit(payload);
  return out;
}

function numberOrNull(...values) {
  for (const value of values) {
    if (value === undefined || value === null || String(value).trim() === "") continue;
    const number = Number(String(value).replace(/,/g, ""));
    if (Number.isFinite(number) && number > 0) return number;
  }
  return null;
}

function sizeClass(gt) {
  if (!Number.isFinite(Number(gt)) || Number(gt) <= 0) return "UNKNOWN";
  if (gt < 5000) return "BELOW_COMMERCIAL_MIN";
  if (gt < 10000) return "SMALL_COMMERCIAL";
  if (gt < 30000) return "MEDIUM_COMMERCIAL";
  if (gt < 80000) return "LARGE_COMMERCIAL";
  return "VERY_LARGE_COMMERCIAL";
}

function tonnage(item = {}) {
  const display = item.vessel_display || {};
  const summary = item.tonnage_summary || display.tonnage_summary || {};
  const gt = numberOrNull(summary.gt, display.gt, item.gt, item.grtg, item.intrlGrtg, item.gross_tonnage);
  const dwt = numberOrNull(summary.dwt, display.dwt, item.dwt, item.deadweight, item.deadweight_tonnage);
  return {
    gt,
    dwt,
    size_class: summary.size_class || sizeClass(gt),
    gt_source: summary.gt_source || (gt ? "raw" : "missing"),
    dwt_source: summary.dwt_source || (dwt ? "raw" : "missing")
  };
}

function codeSet(item = {}) {
  return new Set([
    item.reason_codes,
    item.sales_reason,
    item.target_signal_codes,
    item.commercial_signal_flags,
    item.top_factors,
    item.vessel_display?.reason_codes
  ].flatMap(value => Array.isArray(value) ? value : value ? [value] : []).map(String));
}

function identity(item = {}) {
  const display = item.vessel_display || {};
  return display.vessel_name || item.vessel_name || item.watch_name || item.name || "선명 확인 필요";
}

function knownText(value) {
  if (value === undefined || value === null) return "";
  const text = String(value).trim();
  if (!text || text === "-" || /^(unknown|null|undefined|n\/a|na|미확인|확인 필요)$/i.test(text)) return "";
  return text;
}

function isQualified(item = {}) {
  const display = item.vessel_display || {};
  if (item.target_size_qualified === true || display.target_size_qualified === true) return true;
  if (item.is_sales_target === true || item.candidate_band === "sales_target") return true;
  const label = String(item.priority_label || display.priority_label || "").toUpperCase();
  return label === "HOT" || label === "WARM";
}

function collectAllRows() {
  const collected = [];
  for (const file of FILES) {
    const payload = readJson(file);
    rows(payload).forEach(item => collected.push({ ...item, __file: file }));
  }
  const vesselDir = path.join(ROOT, VESSEL_PAGE_DIR);
  if (fs.existsSync(vesselDir)) {
    const pageFiles = fs.readdirSync(vesselDir)
      .filter(name => /^page-\d+\.json$/.test(name))
      .sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));
    for (const name of pageFiles) {
      const file = `${VESSEL_PAGE_DIR}/${name}`;
      const payload = readJson(file);
      rows(payload).forEach(item => collected.push({ ...item, __file: file }));
    }
  }
  return collected;
}

const allRows = collectAllRows();
const vesselPageRows = allRows.filter(row => /^dashboard\/api\/vessels\/page-\d+\.json$/.test(row.__file || ""));
const targetRows = allRows.filter(row => row.__file === "dashboard/api/targets/current.json");
const vessels = vesselPageRows;

const counts = {
  total_vessels: vessels.length,
  vessels_with_gt: 0,
  gt_5000_plus: 0,
  gt_below_5000: 0,
  gt_unknown: 0,
  qualified_targets_gt_below_5000: 0,
  qualified_targets_gt_unknown: 0
};
const contradictions = [];
const dwtZeroDisplay = [];
const exceptionExamples = [];

for (const item of allRows) {
  const summary = tonnage(item);
  const codes = codeSet(item);
  if (codes.has("GT_BELOW_5000_NOT_COMMERCIAL_TARGET") && CONTRADICTION_CODES.some(code => codes.has(code))) {
    contradictions.push({ item, summary, codes: [...codes].filter(code => code.startsWith("GT_") || code.includes("GT") || code.includes("VALUE") || code.includes("BULK")) });
  }
  if (item.vessel_display && item.vessel_display.dwt === 0) dwtZeroDisplay.push({ item, summary });
}

for (const item of vessels) {
  const summary = tonnage(item);
  if (summary.gt === null) counts.gt_unknown += 1;
  else {
    counts.vessels_with_gt += 1;
    if (summary.gt >= 5000) counts.gt_5000_plus += 1;
    else counts.gt_below_5000 += 1;
  }
}

for (const item of targetRows) {
  const summary = tonnage(item);
  if (isQualified(item) && summary.gt !== null && summary.gt < 5000) {
    counts.qualified_targets_gt_below_5000 += 1;
    exceptionExamples.push({ item, summary, reason: item.target_size_reason || item.vessel_display?.target_size_reason || "" });
  }
  if (isQualified(item) && summary.gt === null) {
    counts.qualified_targets_gt_unknown += 1;
    exceptionExamples.push({ item, summary, reason: item.target_size_reason || item.vessel_display?.target_size_reason || "" });
  }
}

console.log("Tonnage Threshold Audit");
console.log("=======================");
console.log(`total vessels: ${counts.total_vessels}`);
console.log(`vessels with GT: ${counts.vessels_with_gt}`);
console.log(`vessels with GT >= 5000: ${counts.gt_5000_plus}`);
console.log(`vessels with GT < 5000: ${counts.gt_below_5000}`);
console.log(`vessels with GT unknown: ${counts.gt_unknown}`);
console.log(`qualified targets with GT < 5000: ${counts.qualified_targets_gt_below_5000}`);
console.log(`qualified targets with GT unknown: ${counts.qualified_targets_gt_unknown}`);
console.log(`candidates with contradictory GT reason codes: ${contradictions.length}`);
console.log(`vessel_display DWT shown as 0: ${dwtZeroDisplay.length}`);

const examples = [...contradictions, ...dwtZeroDisplay].slice(0, 20);
if (examples.length) {
  console.log("\nTop 20 examples:");
  examples.forEach((entry, index) => {
    const item = entry.item;
    const summary = entry.summary || tonnage(item);
    console.log(`  ${index + 1}. ${identity(item)} | file=${item.__file} | gt=${summary.gt ?? "-"} | dwt=${summary.dwt ?? "-"} | size=${summary.size_class} | codes=${(entry.codes || [...codeSet(item)]).join(",")}`);
  });
}

if (exceptionExamples.length) {
  console.log("\nQualified below-threshold/unknown GT examples:");
  exceptionExamples.slice(0, 20).forEach((entry, index) => {
    const item = entry.item;
    console.log(`  ${index + 1}. ${identity(item)} | file=${item.__file} | gt=${entry.summary.gt ?? "-"} | size=${entry.summary.size_class} | reason=${entry.reason || "exception reason missing"}`);
  });
}

if (contradictions.length || dwtZeroDisplay.length) {
  console.error("\nFAIL: tonnage threshold consistency check failed.");
  process.exit(1);
}
