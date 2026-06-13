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
const configured = (item.present_env || []).includes("VESSEL_SPEC_SERVICE_KEY") || summary?.configured === true;
const attempted = Boolean(item.collector_attempted);
const parserErrors = diagnostics
  .filter(row => /parse|unsupported_response_format/i.test(String(row.error_message || row.skip_reason || row.failure_reason || row.status || "")))
  .map(row => row.error_message || row.skip_reason || row.failure_reason || row.status)
  .filter(Boolean);

const rowsWithImo = number(summary?.rows_with_imo) || sumDiagnostics(diagnostics, "rows_with_imo");
const rowsWithFlag = number(summary?.rows_with_flag) || sumDiagnostics(diagnostics, "rows_with_flag");
const rowsWithCallSign = number(summary?.rows_with_call_sign) || sumDiagnostics(diagnostics, "rows_with_call_sign");
const rowsWithGt = number(summary?.rows_with_gt) || sumDiagnostics(diagnostics, "rows_with_gt");
const rowsWithLoa = number(summary?.rows_with_loa) || sumDiagnostics(diagnostics, "rows_with_loa");
const rowsWithBeam = number(summary?.rows_with_beam) || sumDiagnostics(diagnostics, "rows_with_beam");
const skipReason = item.skip_reason || summary?.skip_reasons?.[0] || "";
const recommendedFix = String(skipReason).startsWith("waiting_until_next_window")
  ? "No setting change required; vessel_spec is scheduled for the next auxiliary window."
  : item.exact_fix_instruction || item.fix_hint || summary?.fix_hint || summary?.recommended_fix || "";
const report = {
  schema_version: "1.0",
  generated_at: new Date().toISOString(),
  source_key: "vessel_spec",
  configured,
  attempted,
  http_status: firstPresent(diagnostics, "http_status") ?? null,
  status: item.status || summary?.status || "unknown",
  rows_collected: number(item.rows_collected || summary?.rows_collected),
  rows_normalized: number(item.rows_normalized || summary?.rows_normalized),
  rows_matched_to_vessels: number(summary?.rows_matched_to_vessels),
  rows_with_imo: rowsWithImo,
  rows_with_call_sign: rowsWithCallSign,
  rows_with_gt: rowsWithGt,
  rows_with_flag: rowsWithFlag,
  rows_with_loa: rowsWithLoa,
  rows_with_beam: rowsWithBeam,
  parser_alias_coverage: summary?.parser_alias_coverage || summary?.diagnostic_summary?.sample_sources?.[0]?.expected_field_aliases_matched || {},
  parser_errors: parserErrors,
  blocker_reason: summary?.blocker_reason || summary?.parser_blocker || skipReason || "",
  recommended_fix: recommendedFix
};
fs.mkdirSync(path.join(ROOT, "dashboard/api/aux"), { recursive: true });
fs.writeFileSync(path.join(ROOT, "dashboard/api/aux/vessel-spec-audit.json"), JSON.stringify(report, null, 2));

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
console.log(`rows_with_call_sign=${rowsWithCallSign}`);
console.log(`rows_with_gt=${rowsWithGt}`);
console.log(`rows_with_flag=${rowsWithFlag}`);
console.log(`rows_with_loa=${rowsWithLoa}`);
console.log(`rows_with_beam=${rowsWithBeam}`);
console.log(`parser_errors=${parserErrors.join("; ") || "-"}`);
console.log(`skip_reason=${skipReason || "-"}`);
console.log(`missing_env=${(item.missing_env || []).join(",") || "-"}`);
console.log(`fix_hint=${recommendedFix || "-"}`);
console.log(`summary_endpoint=dashboard/api/aux/vessel-spec-summary.json`);
console.log(`audit_report=dashboard/api/aux/vessel-spec-audit.json`);

if (configured && item.status === "NOT_CONFIGURED") {
  console.error("ERROR: vessel_spec has VESSEL_SPEC_SERVICE_KEY and VESSEL_SPEC_API_URL but is classified as NOT_CONFIGURED.");
  process.exitCode = 1;
}
if (configured && !attempted && !["NOT_ATTEMPTED", "SKIPPED"].includes(String(item.status || ""))) {
  console.log("WARN: vessel_spec is configured but was not attempted; check skip_reason for the exact blocker.");
}
