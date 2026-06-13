import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

function readJson(relativePath, fallback = {}) {
  try {
    const filePath = path.join(ROOT, relativePath);
    return fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, "utf8")) : fallback;
  } catch (error) {
    return { __parse_error: error.message };
  }
}

function writeJson(relativePath, payload) {
  const filePath = path.join(ROOT, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));
}

function number(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

const summary = readJson("dashboard/api/aux/ulsan-summary.json", {});
const collection = readJson("dashboard/api/source-collection-status.json", { items: [] });
const localCollection = readJson("dashboard/api/debug/source-collection-status-local.json", { items: [] });
const sourceItem = [...(collection.items || []), ...(localCollection.items || [])]
  .find(item => item.source_key === "ulsan_vessel_operation") || {};
const diagnostics = Array.isArray(sourceItem.diagnostics) ? sourceItem.diagnostics : [];
const report = {
  schema_version: "1.0",
  generated_at: new Date().toISOString(),
  source_key: "ulsan_vessel_operation",
  configured: Boolean(sourceItem.configured ?? summary.configured),
  attempted: Boolean(sourceItem.collector_attempted ?? summary.collector_attempted),
  status: sourceItem.status || summary.status || "UNKNOWN",
  http_status: summary.http_status ?? diagnostics.find(item => item.http_status)?.http_status ?? null,
  rows_collected: number(summary.rows_collected ?? sourceItem.rows_collected),
  rows_normalized: number(summary.rows_normalized ?? sourceItem.rows_normalized),
  rows_matched_to_vessels: number(summary.rows_matched_to_vessels),
  matched_by_call_sign: number(summary.matched_by_call_sign),
  matched_by_vessel_name: number(summary.matched_by_vessel_name),
  unmatched_rows: number(summary.unmatched_rows),
  rows_with_call_sign: number(summary.rows_with_call_sign),
  rows_with_port: number(summary.rows_with_port),
  rows_with_berth: number(summary.rows_with_berth),
  rows_with_time: number(summary.rows_with_time),
  blocker_reason: summary.blocker_reason || sourceItem.skip_reason || "",
  recommended_fix: summary.recommended_fix || sourceItem.exact_fix_instruction || sourceItem.fix_hint || "",
  note: "ULSAN_API_URL may include getVtsBaseVslNvgtInfo already; collector avoids appending the operation twice."
};

writeJson("dashboard/api/aux/ulsan-source-audit.json", report);

console.log("Ulsan Source Audit");
console.log("==================");
console.log(`configured=${report.configured ? "yes" : "no"}`);
console.log(`attempted=${report.attempted ? "yes" : "no"}`);
console.log(`status=${report.status}`);
console.log(`http_status=${report.http_status ?? "-"}`);
console.log(`rows_collected=${report.rows_collected}`);
console.log(`rows_normalized=${report.rows_normalized}`);
console.log(`rows_matched_to_vessels=${report.rows_matched_to_vessels}`);
console.log(`rows_with_call_sign=${report.rows_with_call_sign}`);
console.log(`rows_with_port=${report.rows_with_port}`);
console.log(`rows_with_berth=${report.rows_with_berth}`);
console.log(`blocker_reason=${report.blocker_reason || "-"}`);
console.log("audit_report=dashboard/api/aux/ulsan-source-audit.json");
