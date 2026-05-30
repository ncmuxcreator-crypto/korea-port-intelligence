import fs from "node:fs";

const required = [
  "dashboard/api/vessels.json",
  "dashboard/api/all-collected-vessels.json",
  "dashboard/api/target-vessels.json",
  "dashboard/api/candidates.json",
  "dashboard/api/dashboard-summary.json",
  "dashboard/api/candidate-summary.json",
  "dashboard/api/contact-queue.json"
];

function readJson(path, fallback = null) {
  try {
    return fs.existsSync(path) ? JSON.parse(fs.readFileSync(path, "utf8")) : fallback;
  } catch {
    return fallback;
  }
}

function countRows(value) {
  if (Array.isArray(value)) return value.length;
  if (Array.isArray(value?.data)) return value.data.length;
  if (Array.isArray(value?.items)) return value.items.length;
  if (Array.isArray(value?.vessels)) return value.vessels.length;
  if (Array.isArray(value?.candidates)) return value.candidates.length;
  if (value && typeof value === "object") {
    return Number(value.record_count || value.all_vessels_count || value.target_vessels_count || value.candidate_count || 0);
  }
  return 0;
}

const validationMode = String(process.env.VALIDATION_MODE || (process.env.CI === "true" ? "production" : "local")).toLowerCase();
const status = readJson("dashboard/api/status.json", {});
const dashboardSummary = readJson("dashboard/api/dashboard-summary.json", {});
const fileRows = {};
const missing = [];
const empty = [];

for (const file of required) {
  if (!fs.existsSync(file)) {
    missing.push(file);
    continue;
  }
  const stat = fs.statSync(file);
  const rows = stat.size > 0 ? countRows(readJson(file, [])) : 0;
  fileRows[file] = rows;
  if (stat.size === 0 || rows === 0) empty.push(file);
}

const dataMode = String(status.data_mode || dashboardSummary.status?.data_mode || "").toLowerCase();
const recordCount = Number(status.record_count || dashboardSummary.record_count || 0);
const allCollectedRows = Number(fileRows["dashboard/api/all-collected-vessels.json"] || 0);
const emptyDataset = recordCount === 0 || allCollectedRows === 0;
const localNoLiveData = validationMode === "local" && dataMode === "no_live_data";
const ok = missing.length === 0 && (!emptyDataset || localNoLiveData);

const report = {
  version: "17.7.0",
  generated_at: new Date().toISOString(),
  validation_mode: validationMode,
  data_mode: dataMode || "unknown",
  record_count: recordCount,
  dashboard_summary_record_count: Number(dashboardSummary.record_count || 0),
  required,
  missing,
  empty,
  file_rows: fileRows,
  status: emptyDataset ? "empty_dataset" : "ready",
  ok,
  production_ready: ok && validationMode === "production",
  warning: localNoLiveData && emptyDataset ? "local/no-secret no_live_data snapshot has no rows and is diagnostics-only" : null
};

fs.mkdirSync("dashboard/api", { recursive: true });
fs.writeFileSync("dashboard/api/snapshot-guard.json", JSON.stringify(report, null, 2));

if (!report.ok) {
  console.error("Snapshot guard failed", report);
  process.exit(1);
}

console.log("Snapshot guard passed");
