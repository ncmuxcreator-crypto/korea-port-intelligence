#!/usr/bin/env node

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

const FILES = [
  "dashboard/api/intelligence/compliance-exposure.json",
  "dashboard/api/intelligence/biofouling-risk.json",
  "dashboard/api/targets/current.json",
  "dashboard/api/candidates/top.json",
  "dashboard/api/sales/actions.json",
  "dashboard/api/sales/quote-opportunities.json",
  "dashboard/api/bootstrap.json"
];

const JURISDICTIONS = ["Australia", "New Zealand", "Brazil", "California"];

function readJson(relativePath) {
  const fullPath = path.join(ROOT, relativePath);
  if (!fs.existsSync(fullPath)) return { missing: true, path: relativePath, payload: null };
  try {
    return { missing: false, path: relativePath, payload: JSON.parse(fs.readFileSync(fullPath, "utf8")) };
  } catch (error) {
    return { missing: false, path: relativePath, error: error.message, payload: null };
  }
}

function collectItems(payload) {
  const out = [];
  const visit = value => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (value.vessel_display || value.compliance_exposure || value.biofouling_compliance_exposure) out.push(value);
    for (const key of ["items", "top_candidates", "sales_priority", "immediate_targets", "candidates", "actions", "categories"]) {
      const child = value[key];
      if (Array.isArray(child)) child.forEach(visit);
    }
  };
  visit(payload);
  return out;
}

function exposureOf(item = {}) {
  const raw = item.compliance_exposure || item.biofouling_compliance_exposure || item.vessel_display?.compliance_exposure || item.vessel_display?.biofouling_compliance_exposure;
  if (!raw || typeof raw !== "object") {
    return { exposed: false, jurisdiction: "", basis: "", threshold_type: "", confidence: 0, notes: "" };
  }
  return {
    exposed: Boolean(raw.exposed),
    jurisdiction: String(raw.jurisdiction || ""),
    basis: String(raw.basis || ""),
    threshold_type: String(raw.threshold_type || ""),
    confidence: Number.isFinite(Number(raw.confidence)) ? Number(raw.confidence) : 0,
    notes: String(raw.notes || "")
  };
}

function vesselName(item = {}) {
  return item.vessel_display?.vessel_name || item.vessel_name || item.name || item.watch_name || "선명 확인 필요";
}

function looksLikeGt5000LegalMisuse(item = {}, exposure = exposureOf(item)) {
  const text = JSON.stringify({
    threshold_type: exposure.threshold_type,
    notes: exposure.notes,
    reason_summary: item.reason_summary,
    recommended_action: item.recommended_action,
    route_signal: item.route_signal
  }).toLowerCase();
  if (!exposure.exposed) return false;
  if (!exposure.jurisdiction) return true;
  if (/gt\s*5000|5000\s*gt|5000톤|5000\s*ton/.test(text) && /(legal|regulat|법적|규제\s*기준|threshold)/.test(text) && exposure.threshold_type !== "proxy_gt") return true;
  if (exposure.threshold_type === "gt_5000" || exposure.threshold_type === "commercial_gt_5000") return true;
  if (exposure.threshold_type === "proxy_gt" && exposure.jurisdiction !== "Brazil") return true;
  return false;
}

const loaded = FILES.map(readJson);
const allItems = [];
for (const file of loaded) {
  if (file.payload) {
    for (const item of collectItems(file.payload)) allItems.push({ ...item, __file: file.path });
  }
}

const exposed = allItems
  .map(item => ({ item, exposure: exposureOf(item) }))
  .filter(row => row.exposure.exposed);

const counts = Object.fromEntries(JURISDICTIONS.map(name => [name, 0]));
for (const row of exposed) {
  if (counts[row.exposure.jurisdiction] !== undefined) counts[row.exposure.jurisdiction] += 1;
}

const proxyBased = exposed.filter(row => row.exposure.basis === "proxy" || row.exposure.threshold_type === "proxy_gt");
const incorrect = exposed.filter(row => looksLikeGt5000LegalMisuse(row.item, row.exposure));
const invalidJurisdiction = exposed.filter(row => !JURISDICTIONS.includes(row.exposure.jurisdiction));

console.log("Biofouling Compliance Exposure Audit");
console.log("====================================");
for (const file of loaded) {
  const status = file.missing ? "MISSING" : file.error ? `INVALID_JSON: ${file.error}` : "OK";
  const items = file.payload ? collectItems(file.payload).length : 0;
  console.log(`- ${file.path}: ${status}, items=${items}`);
}
console.log("");
console.log(`Australia exposure count: ${counts.Australia}`);
console.log(`New Zealand exposure count: ${counts["New Zealand"]}`);
console.log(`Brazil exposure count: ${counts.Brazil}`);
console.log(`California exposure count: ${counts.California}`);
console.log(`proxy-based exposure count: ${proxyBased.length}`);
console.log(`vessels incorrectly using GT 5000 as legal threshold: ${incorrect.length}`);
console.log(`invalid jurisdiction exposure count: ${invalidJurisdiction.length}`);

if (proxyBased.length) {
  console.log("\nProxy-based exposure samples:");
  proxyBased.slice(0, 10).forEach((row, index) => {
    console.log(`  ${index + 1}. ${vesselName(row.item)} | ${row.exposure.jurisdiction} | ${row.exposure.threshold_type} | ${row.__file || row.item.__file}`);
  });
}

if (incorrect.length || invalidJurisdiction.length) {
  console.error("\nCRITICAL: compliance exposure contains invalid jurisdiction or GT 5000 legal-threshold misuse.");
  [...incorrect, ...invalidJurisdiction].slice(0, 20).forEach((row, index) => {
    console.error(`  ${index + 1}. ${vesselName(row.item)} | file=${row.item.__file} | jurisdiction=${row.exposure.jurisdiction || "-"} | threshold=${row.exposure.threshold_type || "-"} | notes=${row.exposure.notes || "-"}`);
  });
  process.exit(1);
}

if (!exposed.length) {
  console.log("\nINFO: no jurisdiction-based compliance exposures found in current snapshot.");
}
