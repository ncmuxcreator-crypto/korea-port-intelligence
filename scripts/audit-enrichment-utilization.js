import fs from "node:fs";
import path from "node:path";
import { buildEnrichmentUtilizationPayload } from "./lib/enrichment-utilization.js";

const ROOT = process.cwd();

function readJson(relativePath, fallback = null) {
  const filePath = path.join(ROOT, relativePath);
  try {
    return fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, "utf8")) : fallback;
  } catch (error) {
    return { __parse_error: error.message };
  }
}

function readVesselPageRecords() {
  const dir = path.join(ROOT, "dashboard/api/vessels");
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(file => /^page-\d+\.json$/.test(file))
    .sort((a, b) => Number(a.match(/\d+/)?.[0] || 0) - Number(b.match(/\d+/)?.[0] || 0))
    .flatMap(file => {
      const payload = readJson(path.join("dashboard/api/vessels", file), {});
      return Array.isArray(payload.items) ? payload.items : [];
    });
}

function fmt(value) {
  return Number.isFinite(Number(value)) ? Number(value).toLocaleString("ko-KR") : String(value ?? "-");
}

const existing = readJson("dashboard/api/enrichment-utilization.json", null);
const bootstrap = readJson("dashboard/api/bootstrap.json", {}) || {};
const sourceQualityScore = readJson("dashboard/api/source-quality-score.json", {}) || {};
const status = readJson("dashboard/api/status.json", {}) || {};

const payload = existing?.items
  ? existing
  : buildEnrichmentUtilizationPayload({
    records: readVesselPageRecords(),
    sourceQualityScore,
    bootstrapKpis: bootstrap.kpis || {},
    report: status,
    generatedAt: sourceQualityScore.generated_at || bootstrap.generated_at || new Date().toISOString(),
    dataMode: sourceQualityScore.data_mode || bootstrap.data_mode || "static_snapshot"
  });

console.log("Enrichment Utilization Audit");
console.log("============================");
console.log(`generated_at=${payload.generated_at || "unknown"}`);
console.log(`source_run_id=${payload.source_run_id || payload.run_id || "unknown"}`);
console.log(`total_vessels=${fmt(payload.total_vessels)}`);
console.log(`display_vessel_count=${fmt(payload.display_vessel_count)}`);
console.log(`pilotage_signal_count=${fmt(payload.pilotage_signal_count)} (display=${fmt(payload.pilotage_signal_display_count)})`);
console.log(`berth_signal_count=${fmt(payload.berth_signal_count)} (display=${fmt(payload.berth_signal_display_count)})`);
console.log(`operator_recovered_count=${fmt(payload.operator_recovered_count)}`);
console.log(`imo_recovered_count=${fmt(payload.imo_recovered_count)}`);
console.log(`mmsi_recovered_count=${fmt(payload.mmsi_recovered_count)}`);
console.log(`dwt_recovered_count=${fmt(payload.dwt_recovered_count)}`);
console.log(`flag_recovered_count=${fmt(payload.flag_recovered_count)}`);
console.log(`enrichment_failures=${fmt((payload.enrichment_failures || []).length)}`);
console.log("");
console.log("Source | Matched Vessels | Fields Added | Fields Blocked | Samples | Blocker");

for (const item of payload.items || []) {
  const added = (item.fields_added || []).map(field => `${field.field}:${field.count}`).join(", ") || "-";
  const blocked = (item.fields_blocked || []).map(field => field.field).join(", ") || "-";
  console.log([
    item.source_key,
    fmt(item.matched_vessels),
    added,
    blocked,
    fmt((item.sample_enriched_vessels || []).length),
    item.blocker_reason || "-"
  ].join(" | "));
}

if (!existing?.items) {
  console.log("");
  console.log("WARN: dashboard/api/enrichment-utilization.json is missing; audit used an in-memory calculation.");
}

const failures = payload.enrichment_failures || [];
if (failures.length) {
  console.log("");
  console.log("Utilization blockers:");
  for (const failure of failures.slice(0, 10)) {
    console.log(`- ${failure.source_key}: ${failure.blocker_reason}`);
  }
}
