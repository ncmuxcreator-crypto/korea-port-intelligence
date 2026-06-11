import fs from "fs";
import path from "path";

const ROOT = process.cwd();
const API_DIR = path.join(ROOT, "dashboard", "api", "vessels");
const MANIFEST_PATH = path.join(ROOT, "dashboard", "api", "endpoint-manifest.json");

function readJson(file, fallback = null) {
  try {
    const full = path.isAbsolute(file) ? file : path.join(ROOT, file);
    if (!fs.existsSync(full)) return fallback;
    return JSON.parse(fs.readFileSync(full, "utf8"));
  } catch (error) {
    return { __invalid_json: true, error: error.message };
  }
}

function rows(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.vessels)) return payload.vessels;
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
}

function clean(value) {
  const text = String(value ?? "").trim();
  return text && text !== "-" ? text : "";
}

function identity(row = {}) {
  const display = row.vessel_display || {};
  const vesselId = clean(row.vessel_id || row.master_vessel_id || display.vessel_id);
  const imo = clean(row.imo || display.imo);
  const mmsi = clean(row.mmsi || display.mmsi);
  const callSign = clean(row.call_sign || row.callsign || display.call_sign);
  const name = clean(row.vessel_name || display.vessel_name);
  if (vesselId) return `ID:${vesselId}`;
  if (imo) return `IMO:${imo}`;
  if (mmsi) return `MMSI:${mmsi}`;
  if (callSign && name) return `CALL_NAME:${callSign.toUpperCase()}|${name.toUpperCase()}`;
  return "";
}

function expectedPageNumber(fileName = "") {
  const match = fileName.match(/^page-(\d+)\.json$/);
  return match ? Number(match[1]) : null;
}

function manifestEntry(pathValue) {
  const manifest = readJson(MANIFEST_PATH, {});
  if (manifest?.__invalid_json || !Array.isArray(manifest?.endpoints)) return null;
  return manifest.endpoints.find(entry => entry?.path === pathValue) || null;
}

function uniqueIdentityCount(items = []) {
  const seen = new Set();
  let anonymous = 0;
  for (const item of items) {
    const key = identity(item);
    if (!key) {
      anonymous += 1;
      continue;
    }
    seen.add(key);
  }
  return seen.size + anonymous;
}

const sourceRows = rows(readJson("dashboard/api/all-collected-vessels.json", []));
const sourceUniqueCount = uniqueIdentityCount(sourceRows);
const reconciliation = readJson("dashboard/api/vessel-count-reconciliation.json", {});
const reconciliationCounts = reconciliation?.counts || {};
const index = readJson(path.join(API_DIR, "index.json"), {});
const totalCount = Number(index?.total_count || 0);
const detailEligibleCount = Number(reconciliationCounts.detail_eligible_vessel_count || reconciliation?.detail_eligible_vessel_count || totalCount);
const totalDetectedVessels = Number(reconciliationCounts.total_detected_vessels || reconciliation?.total_detected_vessels || sourceRows.length);
const pageSize = Number(index?.page_size || 0);
const totalPages = Number(index?.total_pages || 0);
const expectedTotalPages = pageSize > 0 ? Math.ceil(totalCount / pageSize) : 0;
const expectedPages = Array.isArray(index?.pages) ? index.pages : [];
const pageFiles = fs.existsSync(API_DIR)
  ? fs.readdirSync(API_DIR).filter(name => /^page-\d+\.json$/.test(name)).sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]))
  : [];

let sumItems = 0;
let maxPageItems = 0;
const seen = new Map();
const duplicates = [];
const missingPages = [];
const extraPages = [];
const mismatches = [];

for (let page = 1; page <= totalPages; page += 1) {
  const name = `page-${page}.json`;
  if (!pageFiles.includes(name)) missingPages.push(page);
}

for (const file of pageFiles) {
  const pageNumber = expectedPageNumber(file);
  if (!pageNumber || pageNumber > totalPages) extraPages.push(file);
  const page = readJson(path.join(API_DIR, file), {});
  if (page?.__invalid_json) {
    mismatches.push(`${file}: invalid JSON (${page.error})`);
    continue;
  }
  const items = rows(page);
  const expectedItemCount = pageNumber && pageNumber === totalPages
    ? Math.max(0, totalCount - pageSize * (totalPages - 1))
    : pageSize;
  if (Number(page?.page) !== pageNumber) mismatches.push(`${file}: page metadata ${page?.page} != ${pageNumber}`);
  if (Number(page?.page_size) !== pageSize) mismatches.push(`${file}: page_size ${page?.page_size} != index.page_size ${pageSize}`);
  if (Number(page?.total_count) !== totalCount) mismatches.push(`${file}: total_count ${page?.total_count} != index.total_count ${totalCount}`);
  if (Number(page?.total_pages) !== totalPages) mismatches.push(`${file}: total_pages ${page?.total_pages} != index.total_pages ${totalPages}`);
  if (items.length > pageSize) mismatches.push(`${file}: items.length ${items.length} > page_size ${pageSize}`);
  if (pageNumber && pageNumber <= totalPages && items.length !== expectedItemCount) {
    mismatches.push(`${file}: items.length ${items.length} != expected ${expectedItemCount}`);
  }
  sumItems += items.length;
  maxPageItems = Math.max(maxPageItems, items.length);
  for (const item of items) {
    const key = identity(item);
    if (!key) continue;
    if (seen.has(key)) duplicates.push(key);
    seen.set(key, file);
  }
}

const indexManifest = manifestEntry("dashboard/api/vessels/index.json");
if (indexManifest) {
  if (Number(indexManifest.record_count) !== totalCount) mismatches.push(`endpoint-manifest vessels.index record_count ${indexManifest.record_count} != index.total_count ${totalCount}`);
  if (Number(indexManifest.item_count) !== 0) mismatches.push(`endpoint-manifest vessels.index item_count ${indexManifest.item_count} != 0`);
}
for (const file of pageFiles) {
  const page = readJson(path.join(API_DIR, file), {});
  if (page?.__invalid_json) continue;
  const items = rows(page);
  const entry = manifestEntry(`dashboard/api/vessels/${file}`);
  if (entry) {
    if (Number(entry.record_count) !== totalCount) mismatches.push(`endpoint-manifest ${file} record_count ${entry.record_count} != index.total_count ${totalCount}`);
    if (Number(entry.item_count) !== items.length) mismatches.push(`endpoint-manifest ${file} item_count ${entry.item_count} != items.length ${items.length}`);
  }
}

console.log("Vessel page audit:");
console.log(`- total_count from source dataset: ${sourceRows.length}`);
console.log(`- unique_identity_count from source dataset: ${sourceUniqueCount}`);
console.log(`- total_detected_vessels from reconciliation: ${totalDetectedVessels}`);
console.log(`- detail_eligible_vessel_count from reconciliation: ${detailEligibleCount}`);
console.log(`- total_count from vessels/index.json: ${totalCount}`);
console.log(`- page_size: ${pageSize}`);
console.log(`- expected_total_pages: ${expectedTotalPages}`);
console.log(`- total_pages from vessels/index.json: ${totalPages}`);
console.log(`- actual page file count: ${pageFiles.length}`);
console.log(`- sum of page items: ${sumItems}`);
console.log(`- duplicate vessel count across pages: ${duplicates.length}`);
console.log(`- missing page numbers: ${missingPages.length ? missingPages.join(", ") : "none"}`);
console.log(`- extra pages: ${extraPages.length ? extraPages.join(", ") : "none"}`);
console.log(`- largest page size: ${maxPageItems}`);
console.log(`- mismatches: ${mismatches.length ? mismatches.join(" | ") : "none"}`);

const failures = [];
if (index?.__invalid_json) failures.push(`vessels/index.json invalid JSON: ${index.error}`);
if (sumItems !== totalCount) failures.push("sum of page items !== total_count");
if (detailEligibleCount && totalCount !== detailEligibleCount) failures.push("index total_count !== detail_eligible_vessel_count");
if (expectedTotalPages !== totalPages) failures.push("index total_pages !== ceil(total_count / page_size)");
if (expectedPages.length !== totalPages) failures.push("index pages.length !== total_pages");
if (pageFiles.length !== totalPages) failures.push("page file count !== total_pages");
if (maxPageItems > pageSize) failures.push("a page exceeds page_size");
if (!pageFiles.includes("page-1.json")) failures.push("page-1 missing");
if (totalCount > pageSize && pageFiles.length <= 1) failures.push("only first page generated when total_count > page_size");
if (missingPages.length) failures.push("missing page files");
if (extraPages.length) failures.push("extra stale page files");
if (duplicates.length) failures.push("duplicate vessel identity across pages");
if (mismatches.length) failures.push("page/index/manifest metadata mismatches");

if (failures.length) {
  console.error("\nFAIL:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
