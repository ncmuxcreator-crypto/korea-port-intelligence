import fs from "node:fs";
import path from "node:path";
import { buildSourceCollectionStatus, normalizeSourceCollectionStatusPayload } from "./lib/source-activation.js";

const ROOT = process.cwd();

function readJson(relativePath, fallback = null) {
  try {
    const filePath = path.join(ROOT, relativePath);
    return fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, "utf8")) : fallback;
  } catch (error) {
    return { __parse_error: error.message };
  }
}

function number(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function sumDiagnostics(diagnostics = [], key) {
  return diagnostics.reduce((sum, item) => sum + number(item?.[key]), 0);
}

function firstPresent(diagnostics = [], key) {
  const found = diagnostics.find(item => item?.[key] !== undefined && item?.[key] !== null && String(item[key]).trim() !== "");
  return found ? found[key] : null;
}

const status = readJson("dashboard/api/status.json", {});
const sourceCollectionStatus = readJson("dashboard/api/source-collection-status.json", null);
const localSourceCollectionStatus = readJson("dashboard/api/debug/source-collection-status-local.json", null);
const summary = readJson("dashboard/api/aux/vessel-spec-summary.json", null);
const selectedSourceStatus = sourceCollectionStatus?.items
  ? sourceCollectionStatus
  : localSourceCollectionStatus;
const sourceStatus = normalizeSourceCollectionStatusPayload(selectedSourceStatus?.items
  ? selectedSourceStatus
  : buildSourceCollectionStatus({
    report: status,
    collectorDiagnostics: status.collector_diagnostics || {},
    generatedAt: new Date().toISOString()
  }));

const item = (sourceStatus.items || []).find(row => row.source_key === "vessel_spec") || {};
const diagnostics = Array.isArray(item.diagnostics) ? item.diagnostics : [];
const configured = (item.present_env || []).includes("VESSEL_SPEC_SERVICE_KEY") &&
  (item.present_env || []).includes("VESSEL_SPEC_API_URL");
const attempted = Boolean(item.collector_attempted);
const parserErrors = diagnostics
  .filter(row => /parse|unsupported_response_format/i.test(String(row.error_message || row.skip_reason || row.failure_reason || row.status || "")))
  .map(row => row.error_message || row.skip_reason || row.failure_reason || row.status)
  .filter(Boolean);

const rowsWithImo = number(summary?.rows_with_imo) || sumDiagnostics(diagnostics, "rows_with_imo");
const rowsWithMmsi = number(summary?.rows_with_mmsi) || sumDiagnostics(diagnostics, "rows_with_mmsi");
const rowsWithDwt = number(summary?.rows_with_dwt) || sumDiagnostics(diagnostics, "rows_with_dwt");
const rowsWithFlag = number(summary?.rows_with_flag) || sumDiagnostics(diagnostics, "rows_with_flag");

console.log("Vessel Spec Source Audit");
console.log("========================");
console.log(`configured=${configured ? "yes" : "no"}`);
console.log(`status=${item.status || summary?.status || "unknown"}`);
console.log(`collector_enabled=${item.collector_enabled ? "yes" : "no"}`);
console.log(`attempted=${attempted ? "yes" : "no"}`);
console.log(`http_status=${firstPresent(diagnostics, "http_status") ?? "-"}`);
console.log(`rows_collected=${number(item.rows_collected || summary?.rows_collected)}`);
console.log(`rows_normalized=${number(item.rows_normalized || summary?.rows_normalized)}`);
console.log(`rows_with_imo=${rowsWithImo}`);
console.log(`rows_with_mmsi=${rowsWithMmsi}`);
console.log(`rows_with_dwt=${rowsWithDwt}`);
console.log(`rows_with_flag=${rowsWithFlag}`);
console.log(`parser_errors=${parserErrors.join("; ") || "-"}`);
console.log(`skip_reason=${item.skip_reason || summary?.skip_reasons?.[0] || "-"}`);
console.log(`missing_env=${(item.missing_env || []).join(",") || "-"}`);
console.log(`fix_hint=${item.exact_fix_instruction || item.fix_hint || summary?.fix_hint || "-"}`);
console.log(`summary_endpoint=dashboard/api/aux/vessel-spec-summary.json`);

if (configured && item.status === "NOT_CONFIGURED") {
  console.error("ERROR: vessel_spec has VESSEL_SPEC_SERVICE_KEY and VESSEL_SPEC_API_URL but is classified as NOT_CONFIGURED.");
  process.exitCode = 1;
}
if (configured && !attempted && !["NOT_ATTEMPTED", "SKIPPED"].includes(String(item.status || ""))) {
  console.log("WARN: vessel_spec is configured but was not attempted; check skip_reason for the exact blocker.");
}
