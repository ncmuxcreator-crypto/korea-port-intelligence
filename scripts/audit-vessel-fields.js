import fs from "fs";
import path from "path";

const ROOT = process.cwd();

const FILES = [
  "dashboard/api/targets/current.json",
  "dashboard/api/targets/static.json",
  "dashboard/api/candidates/top.json",
  "dashboard/api/vessels/page-1.json",
  "dashboard/api/intelligence/sales-priority.json"
];

const REQUIRED_DISPLAY_FIELDS = [
  "vessel_name",
  "imo",
  "mmsi",
  "call_sign",
  "vessel_type",
  "gt",
  "dwt",
  "flag",
  "operator",
  "owner",
  "manager",
  "current_port",
  "eta",
  "etb",
  "ata",
  "atb",
  "stay_days",
  "last_seen_at",
  "data_source",
  "confidence_score",
  "opportunity_score",
  "risk_score",
  "priority_label",
  "reason_summary",
  "recommended_action",
  "data_sources"
];

function readJson(file, fallback = null) {
  const rootPath = path.join(ROOT, file);
  const debugPath = path.join(ROOT, file.replace("dashboard/api/", "dashboard/api/debug/"));
  const candidates = [rootPath, debugPath];
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) return JSON.parse(fs.readFileSync(candidate, "utf8"));
    } catch (error) {
      return { __invalid_json: true, error: error.message };
    }
  }
  return fallback;
}

function rows(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.vessels)) return payload.vessels;
  if (Array.isArray(payload?.candidates)) return payload.candidates;
  if (Array.isArray(payload?.opportunities)) return payload.opportunities;
  return [];
}

function present(value) {
  return value !== undefined && value !== null && String(value).trim() !== "";
}

console.log("Vessel display field audit:");

let totalRows = 0;
let totalMissing = 0;

for (const file of FILES) {
  const payload = readJson(file, {});
  const items = rows(payload);
  totalRows += items.length;
  const missingCounts = Object.fromEntries(REQUIRED_DISPLAY_FIELDS.map(field => [field, 0]));
  let rowsWithDisplay = 0;

  for (const item of items) {
    const display = item?.vessel_display || {};
    if (Object.keys(display).length) rowsWithDisplay += 1;
    for (const field of REQUIRED_DISPLAY_FIELDS) {
      const value = display[field] ?? item[field];
      if (!present(value)) {
        missingCounts[field] += 1;
        totalMissing += 1;
      }
    }
  }

  console.log(`\n${file}`);
  console.log(`- record_count: ${items.length}`);
  console.log(`- rows_with_vessel_display: ${rowsWithDisplay}`);
  for (const [field, count] of Object.entries(missingCounts).filter(([, count]) => count > 0)) {
    console.log(`- missing_${field}: ${count}`);
  }
}

console.log("\nSummary:");
console.log(`- audited_rows: ${totalRows}`);
console.log(`- missing_field_total: ${totalMissing}`);
if (totalRows > 0 && totalMissing > 0) {
  console.log("- note: 일부 원천 데이터에는 IMO/MMSI/선주/관리사 등 공개 데이터가 비어 있을 수 있습니다. vessel_display 구조 자체가 있는지 우선 확인하세요.");
}
