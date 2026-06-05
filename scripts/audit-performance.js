import fs from "fs";
import path from "path";

const ROOT = process.cwd();
const API_DIR = path.join(ROOT, "dashboard", "api");
const DASHBOARD_HTML = path.join(ROOT, "dashboard", "index.html");

function sizeOf(file) {
  try {
    return fs.existsSync(file) ? fs.statSync(file).size : 0;
  } catch {
    return 0;
  }
}

function listJsonFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return listJsonFiles(full);
    return entry.name.endsWith(".json") ? [full] : [];
  });
}

const html = fs.existsSync(DASHBOARD_HTML) ? fs.readFileSync(DASHBOARD_HTML, "utf8") : "";
const loadSummaryBody = html.match(/async function loadSummary\(\)\{([\s\S]*?)\nfunction flattenVesselPageRow/)?.[1] || "";
const firstPaintSegment = loadSummaryBody.split("renderAll()")[0] || loadSummaryBody;
const firstPaintApiNames = [...firstPaintSegment.matchAll(/api\("([^"]+)"/g)].map(match => match[1]);
const fallbackApiNames = firstPaintApiNames.filter(name => name !== "bootstrap");
const startupApiCount = firstPaintApiNames.includes("bootstrap") ? 1 + Math.min(fallbackApiNames.length, 2) : fallbackApiNames.length;
const bootstrapFile = path.join(API_DIR, "bootstrap.json");
const vesselDir = path.join(API_DIR, "vessels");
const vesselPages = fs.existsSync(vesselDir)
  ? fs.readdirSync(vesselDir).filter(name => /^page-\d+\.json$/.test(name))
  : [];
const jsonFiles = listJsonFiles(API_DIR).map(file => ({ file, size: sizeOf(file) })).sort((a, b) => b.size - a.size);
const requiredStartupSnapshots = [
  "bootstrap.json",
  "dashboard-summary.json",
  "status.json"
];
const requiredLazyEndpoints = [
  "vessels/index.json",
  "candidates/top.json",
  "arrival-pipeline.json",
  "staying-vessels.json",
  "targets/current.json",
  "intelligence/sales-priority.json",
  "agent-followup-queue.json"
];
const requiredFiles = [...requiredStartupSnapshots, ...requiredLazyEndpoints];
const missingEndpoints = requiredFiles
  .map(name => ({ name, file: path.join(API_DIR, ...name.split("/")) }))
  .filter(entry => !fs.existsSync(entry.file));
const largestVesselPage = vesselPages
  .map(name => ({ file: path.join(vesselDir, name), size: sizeOf(path.join(vesselDir, name)) }))
  .sort((a, b) => b.size - a.size)[0] || { size: 0 };
const allVesselsStartup = /all-collected-vessels\.json/.test(html.split("$('refreshBtn'")[0] || html);
const apiHealthBlocksStartup = /api\("health"|"\/api\/health/.test(firstPaintSegment);

console.log("Performance audit:");
console.log(`- startup API count: ${startupApiCount}`);
console.log(`- bootstrap.json size: ${sizeOf(bootstrapFile)} bytes`);
console.log(`- dashboard/api JSON file count: ${jsonFiles.length}`);
console.log(`- vessel page count: ${vesselPages.length}`);
console.log(`- largest vessel page size: ${largestVesselPage.size} bytes`);
console.log(`- estimated first-load payload: ${sizeOf(bootstrapFile) || sizeOf(path.join(API_DIR, "dashboard-summary.json"))} bytes`);
console.log(`- full vessel list lazy-loaded: ${allVesselsStartup ? "no" : "yes"}`);
console.log(`- API health panel fetches all endpoints on startup: ${apiHealthBlocksStartup ? "yes" : "no"}`);
console.log("- slow or missing API list:");
if (!missingEndpoints.length) console.log("  - none detected from required static endpoints");
for (const entry of missingEndpoints) console.log(`  - missing: dashboard/api/${entry.name}`);
console.log("- largest JSON files:");
for (const entry of jsonFiles.slice(0, 8)) {
  console.log(`  - ${path.relative(ROOT, entry.file)}: ${entry.size} bytes`);
}
console.log("- each dashboard/api JSON file size:");
for (const entry of jsonFiles.sort((a, b) => path.relative(API_DIR, a.file).localeCompare(path.relative(API_DIR, b.file)))) {
  console.log(`  - ${path.relative(API_DIR, entry.file)}: ${entry.size} bytes`);
}

const warnings = [];
if (sizeOf(bootstrapFile) > 150 * 1024) warnings.push("bootstrap.json > 150 KB");
if (largestVesselPage.size > 300 * 1024) warnings.push("vessel page > 300 KB");
if (startupApiCount > 3) warnings.push("startup API count > 3");
if (allVesselsStartup) warnings.push("full vessel list may be fetched during startup");
if (apiHealthBlocksStartup) warnings.push("API health panel fetches endpoints during startup");
if (missingEndpoints.length) warnings.push("required static API endpoint missing");

if (warnings.length) {
  console.log("\nWarnings:");
  for (const warning of warnings) console.log(`- ${warning}`);
}
