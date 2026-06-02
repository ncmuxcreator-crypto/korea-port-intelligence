import fs from "fs";
import path from "path";

const ROOT = process.cwd();
const API_DIR = path.join(ROOT, "dashboard", "api", "vessels");

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

function identity(row = {}) {
  const display = row.vessel_display || {};
  const imo = row.imo || display.imo;
  const mmsi = row.mmsi || display.mmsi;
  const vesselId = row.vessel_id || row.master_vessel_id || display.vessel_id;
  const name = row.vessel_name || display.vessel_name;
  const port = row.port_code || row.port_name || display.current_port;
  if (imo && imo !== "-") return `IMO:${imo}`;
  if (mmsi && mmsi !== "-") return `MMSI:${mmsi}`;
  if (vesselId && vesselId !== "-") return `ID:${vesselId}`;
  return name ? `NAME:${String(name).toUpperCase()}|${port || ""}` : "";
}

const sourceRows = rows(readJson("dashboard/api/all-collected-vessels.json", []));
const index = readJson(path.join(API_DIR, "index.json"), {});
const totalCount = Number(index?.total_count || 0);
const pageSize = Number(index?.page_size || 0);
const totalPages = Number(index?.total_pages || 0);
const expectedPages = Array.isArray(index?.pages) ? index.pages : [];
const pageFiles = fs.existsSync(API_DIR)
  ? fs.readdirSync(API_DIR).filter(name => /^page-\d+\.json$/.test(name)).sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]))
  : [];

let sumItems = 0;
let maxPageItems = 0;
const seen = new Map();
const duplicates = [];
const missingPages = [];

for (let page = 1; page <= totalPages; page += 1) {
  const name = `page-${page}.json`;
  if (!pageFiles.includes(name)) missingPages.push(page);
}

for (const file of pageFiles) {
  const page = readJson(path.join(API_DIR, file), {});
  const items = rows(page);
  sumItems += items.length;
  maxPageItems = Math.max(maxPageItems, items.length);
  for (const item of items) {
    const key = identity(item);
    if (!key) continue;
    if (seen.has(key)) duplicates.push(key);
    seen.set(key, file);
  }
}

console.log("Vessel page audit:");
console.log(`- total_count from source dataset: ${sourceRows.length}`);
console.log(`- total_count from vessels/index.json: ${totalCount}`);
console.log(`- page_size: ${pageSize}`);
console.log(`- total_pages: ${totalPages}`);
console.log(`- actual page file count: ${pageFiles.length}`);
console.log(`- sum of page items: ${sumItems}`);
console.log(`- duplicate vessel count across pages: ${duplicates.length}`);
console.log(`- missing page numbers: ${missingPages.length ? missingPages.join(", ") : "none"}`);
console.log(`- largest page size: ${maxPageItems}`);

const failures = [];
if (sumItems !== totalCount) failures.push("sum of page items !== total_count");
if (sourceRows.length && totalCount !== sourceRows.length) failures.push("index total_count !== source dataset count");
if (pageFiles.length !== totalPages) failures.push("page file count !== total_pages");
if (maxPageItems > pageSize) failures.push("a page exceeds page_size");
if (totalCount > pageSize && pageFiles.length <= 1) failures.push("only first page generated when total_count > page_size");
if (missingPages.length) failures.push("missing page files");
if (duplicates.length) failures.push("duplicate vessel identity across pages");

if (failures.length) {
  console.error("\nFAIL:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
