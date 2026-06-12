import fs from "fs";
import path from "path";

const ROOT = process.cwd();
const REQUIRED_LINEAGE_FIELDS = [
  "vessel_name",
  "call_sign",
  "gt",
  "dwt",
  "operator_display",
  "current_port",
  "berth",
  "pilotage_signal",
  "opportunity_score"
];

function readJson(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  return JSON.parse(raw);
}

function listVesselPageFiles() {
  const dir = path.join(ROOT, "dashboard", "api", "vessels");
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(name => /^page-\d+\.json$/.test(name))
    .sort((a, b) => Number(a.match(/\d+/)?.[0] || 0) - Number(b.match(/\d+/)?.[0] || 0))
    .map(name => path.join("dashboard", "api", "vessels", name));
}

function endpointFiles() {
  return [
    ...listVesselPageFiles(),
    path.join("dashboard", "api", "sales", "actions.json"),
    path.join("dashboard", "api", "targets", "current.json"),
    path.join("dashboard", "api", "watchlist", "current.json"),
    path.join("dashboard", "api", "sales", "quote-opportunities.json")
  ];
}

function itemsFromPayload(payload) {
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload)) return payload;
  return [];
}

function lineageForItem(item) {
  const display = item?.vessel_display && typeof item.vessel_display === "object" ? item.vessel_display : null;
  if (!display) return null;
  return display.data_lineage && typeof display.data_lineage === "object" ? display.data_lineage : null;
}

function formatPct(count, total) {
  if (!total) return "0.0%";
  return `${Math.round((count / total) * 1000) / 10}%`;
}

const rows = [];
let totalDisplays = 0;
let totalMissingLineage = 0;
const globalFieldCounts = Object.fromEntries(REQUIRED_LINEAGE_FIELDS.map(field => [field, 0]));
const problems = [];

for (const relativePath of endpointFiles()) {
  const filePath = path.join(ROOT, relativePath);
  if (!fs.existsSync(filePath)) {
    problems.push(`${relativePath}: missing file`);
    rows.push({ endpoint: relativePath, item_count: 0, display_count: 0, lineage_count: 0, missing_lineage: 0, fields: {} });
    continue;
  }
  let payload;
  try {
    payload = readJson(filePath);
  } catch (error) {
    problems.push(`${relativePath}: invalid JSON (${error.message})`);
    rows.push({ endpoint: relativePath, item_count: 0, display_count: 0, lineage_count: 0, missing_lineage: 0, fields: {} });
    continue;
  }
  const items = itemsFromPayload(payload);
  const displays = items.filter(item => item?.vessel_display && typeof item.vessel_display === "object");
  const fieldCounts = Object.fromEntries(REQUIRED_LINEAGE_FIELDS.map(field => [field, 0]));
  let lineageCount = 0;
  for (const item of displays) {
    const lineage = lineageForItem(item);
    if (!lineage) continue;
    lineageCount += 1;
    for (const field of REQUIRED_LINEAGE_FIELDS) {
      if (lineage[field] !== undefined && lineage[field] !== null && String(lineage[field]).trim() !== "") {
        fieldCounts[field] += 1;
        globalFieldCounts[field] += 1;
      }
    }
  }
  const missingLineage = displays.length - lineageCount;
  totalDisplays += displays.length;
  totalMissingLineage += missingLineage;
  if (missingLineage > 0) problems.push(`${relativePath}: ${missingLineage} vessel_display rows missing data_lineage`);
  rows.push({
    endpoint: relativePath,
    item_count: items.length,
    display_count: displays.length,
    lineage_count: lineageCount,
    missing_lineage: missingLineage,
    fields: fieldCounts
  });
}

console.log("Vessel Data Lineage Audit");
console.log("=".repeat(32));
console.log(`Endpoints checked: ${rows.length}`);
console.log(`vessel_display rows: ${totalDisplays}`);
console.log(`missing data_lineage: ${totalMissingLineage}`);
console.log("");
console.log("Endpoint | items | vessel_display | data_lineage | missing");
for (const row of rows) {
  console.log(`${row.endpoint} | ${row.item_count} | ${row.display_count} | ${row.lineage_count} | ${row.missing_lineage}`);
}
console.log("");
console.log("Field coverage");
for (const field of REQUIRED_LINEAGE_FIELDS) {
  console.log(`${field}: ${globalFieldCounts[field]}/${totalDisplays} (${formatPct(globalFieldCounts[field], totalDisplays)})`);
}
if (problems.length) {
  console.log("");
  console.warn("Problems");
  for (const problem of problems) console.warn(`- ${problem}`);
  process.exitCode = 1;
}
