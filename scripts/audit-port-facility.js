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

const summary = readJson("dashboard/api/aux/latest/port-facility-summary.json", readJson("dashboard/api/aux/port-facility-summary.json", {}));
const patchHints = readJson("dashboard/api/aux/latest/patch-hints.json", { items: [] });
const portFacilityHints = (patchHints.items || []).filter(item => item.source_key === "port_facility" || item.signal_type === "port_facility_berth_signal");
const report = {
  schema_version: "1.0",
  generated_at: new Date().toISOString(),
  source_key: "port_facility",
  owner_tier: summary.owner_tier || "fast_aux",
  core_may_update: summary.core_may_update === false,
  integration_rule: summary.integration_rule || "CargHarborUse2 child enrichment only; not a standalone collector.",
  status: summary.status || "UNKNOWN",
  configured: Boolean(summary.configured),
  attempted: Boolean(summary.attempted || summary.collector_attempted || number(summary.child_enrichment_attempted)),
  http_status: summary.http_status || null,
  child_enrichment_attempted: number(summary.child_enrichment_attempted),
  child_enrichment_success: number(summary.child_enrichment_success),
  raw_rows: number(summary.raw_rows || summary.rows_collected),
  normalized_rows: number(summary.normalized_rows || summary.rows_normalized),
  matched_vessels: number(summary.matched_vessels || summary.rows_matched_to_vessels),
  matched_by_call_sign_entry_count: number(summary.matched_by_call_sign_entry_count || summary.matched_vessels || summary.rows_matched_to_vessels),
  rows_with_facility_hint: number(summary.rows_with_facility_hint),
  rows_with_operator_candidate: number(summary.rows_with_operator_candidate),
  rows_with_cargo_hint: number(summary.rows_with_cargo_hint),
  fields_contributed: summary.fields_contributed || ["berth", "facility_name", "operator_or_agent_candidate", "cargo_operation_hint"],
  patch_hints_created: portFacilityHints.length || number(summary.patch_hints_created),
  raw_sample_keys: summary.raw_sample_keys || [],
  parser_alias_coverage: summary.parser_alias_coverage || summary.diagnostic_summary?.expected_field_aliases_matched || {},
  normalized_sample: summary.normalized_sample || summary.sanitized_raw_samples?.[0] || null,
  statuses: summary.statuses || {},
  blocker_reason: summary.blocker_reason || (number(summary.child_enrichment_attempted) > 0
    ? "child_enrichment_returned_no_usable_rows"
    : "waiting_for_port_operation_child_enrichment"),
  recommended_fix: summary.recommended_fix || "Keep CargHarborUse2 tied to port_operation parent keys: prtAgCd + etryptYear + etryptCo + clsgn."
};

writeJson("dashboard/api/aux/port-facility-audit.json", report);

console.log("Port Facility Audit");
console.log("===================");
console.log(`status=${report.status}`);
console.log(`child_enrichment_attempted=${report.child_enrichment_attempted}`);
console.log(`child_enrichment_success=${report.child_enrichment_success}`);
console.log(`raw_rows=${report.raw_rows}`);
console.log(`normalized_rows=${report.normalized_rows}`);
console.log(`matched_vessels=${report.matched_vessels}`);
console.log(`matched_by_call_sign_entry_count=${report.matched_by_call_sign_entry_count}`);
console.log(`rows_with_facility_hint=${report.rows_with_facility_hint}`);
console.log(`rows_with_operator_candidate=${report.rows_with_operator_candidate}`);
console.log(`rows_with_cargo_hint=${report.rows_with_cargo_hint}`);
console.log(`patch_hints_created=${report.patch_hints_created}`);
console.log(`blocker_reason=${report.blocker_reason || "-"}`);
console.log("audit_report=dashboard/api/aux/port-facility-audit.json");
