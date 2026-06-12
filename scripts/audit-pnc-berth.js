import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const API_DIR = path.join(ROOT, "dashboard", "api");

function readJson(relativePath, fallback = null) {
  const filePath = path.join(ROOT, relativePath);
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function listJsonFiles(dir, pattern) {
  const absoluteDir = path.join(ROOT, dir);
  if (!fs.existsSync(absoluteDir)) return [];
  return fs.readdirSync(absoluteDir)
    .filter(name => pattern.test(name))
    .map(name => path.join(absoluteDir, name));
}

function asItems(payload) {
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.top_candidates)) return payload.top_candidates;
  if (Array.isArray(payload?.sales_priority)) return payload.sales_priority;
  return [];
}

function collectEndpointItems() {
  const files = [
    "dashboard/api/bootstrap.json",
    "dashboard/api/candidates/top.json",
    "dashboard/api/targets/current.json",
    "dashboard/api/sales/actions.json",
    "dashboard/api/sales/conversion-pipeline.json",
    "dashboard/api/sales/quote-opportunities.json",
    "dashboard/api/watchlist/current.json",
    "dashboard/api/arrival-pipeline.json",
    ...listJsonFiles("dashboard/api/vessels", /^page-\d+\.json$/).map(file => path.relative(ROOT, file).replace(/\\/g, "/"))
  ];
  const rows = [];
  for (const relativePath of files) {
    const payload = readJson(relativePath, null);
    if (!payload) continue;
    for (const item of asItems(payload)) rows.push({ endpoint: relativePath, item });
  }
  return rows;
}

function vesselKey(item = {}) {
  const display = item.vessel_display || item;
  return [
    display.imo || item.imo,
    display.mmsi || item.mmsi,
    display.call_sign || item.call_sign,
    display.vessel_name || item.vessel_name,
    display.current_port || item.port
  ].filter(Boolean).join("|");
}

function displaySignal(item = {}) {
  const display = item.vessel_display || item;
  return display.berth_signal || item.berth_signal || {};
}

function findSourceStatus() {
  const runtime = readJson("dashboard/api/source-collection-status.json", null)
    || readJson("dashboard/api/debug/source-collection-status-local.json", null);
  const item = (runtime?.items || []).find(row => row.source_key === "berth_sources") || {};
  const pncDiagnostics = (item.diagnostics || []).filter(diag => String(diag.key || "").startsWith("pnc_source_"));
  return { runtime, item, pncDiagnostics };
}

const { runtime, item: berthSource, pncDiagnostics } = findSourceStatus();
const endpointRows = collectEndpointItems();
const berthSignalRows = endpointRows.filter(row => displaySignal(row.item).has_berth_info === true);
const uniqueBerthSignals = new Map();
for (const row of berthSignalRows) {
  const key = vesselKey(row.item) || `${row.endpoint}:${uniqueBerthSignals.size}`;
  if (!uniqueBerthSignals.has(key)) uniqueBerthSignals.set(key, row);
}

const matchedByCallSign = [...uniqueBerthSignals.values()].filter(row => /call_sign/i.test(displaySignal(row.item).match_type || "")).length;
const matchedByName = [...uniqueBerthSignals.values()].filter(row => /vessel_name|name/i.test(displaySignal(row.item).match_type || "")).length;
const matchedByPortOnly = [...uniqueBerthSignals.values()].filter(row => /port/i.test(displaySignal(row.item).match_type || "") && !/call_sign|vessel_name|name/i.test(displaySignal(row.item).match_type || "")).length;
const pncRowsCollected = pncDiagnostics.reduce((sum, diag) => sum + Number(diag.rows_collected || 0), 0);
const pncRowsNormalized = pncDiagnostics.reduce((sum, diag) => sum + Number(diag.rows_normalized || 0), 0);

console.log("PNC Berth Source Audit");
console.log("======================");
console.log(`generated_by=${runtime?.generated_by || "(missing)"}`);
console.log(`generated_at=${runtime?.generated_at || "(missing)"}`);
console.log(`PNC_SOURCE_URLS_configured=${Boolean(berthSource?.env_presence?.PNC_SOURCE_URLS?.present || process.env.PNC_SOURCE_URLS)}`);
console.log(`BERTH_SOURCE_URLS_configured=${Boolean(berthSource?.env_presence?.BERTH_SOURCE_URLS?.present || process.env.BERTH_SOURCE_URLS)}`);
console.log(`berth_sources_status=${berthSource?.status || "MISSING"}`);
console.log(`berth_sources_rows_collected=${Number(berthSource?.rows_collected || 0)}`);
console.log(`berth_sources_rows_normalized=${Number(berthSource?.rows_normalized || 0)}`);
console.log(`pnc_sources=${pncDiagnostics.length}`);
console.log(`pnc_rows_collected=${pncRowsCollected}`);
console.log(`pnc_rows_normalized=${pncRowsNormalized}`);

for (const diag of pncDiagnostics) {
  console.log("");
  console.log(`Source: ${diag.key}`);
  console.log(`  http_status=${diag.http_status ?? "(missing)"}`);
  console.log(`  rows_collected=${Number(diag.rows_collected || 0)}`);
  console.log(`  rows_normalized=${Number(diag.rows_normalized || 0)}`);
  console.log(`  raw_sample_keys=${JSON.stringify(diag.raw_sample_keys || [])}`);
  console.log(`  expected_field_aliases_matched=${JSON.stringify(diag.expected_field_aliases_matched || {})}`);
  console.log(`  missing_required_fields=${JSON.stringify(diag.missing_required_fields || {})}`);
  console.log(`  parser_blockers=${JSON.stringify(diag.parser_blockers || [])}`);
  console.log(`  sanitized_raw_samples=${JSON.stringify((diag.sanitized_raw_samples || []).slice(0, 5))}`);
}

const sourceDiag = readJson("dashboard/api/status.json", null)?.source_diagnostics || {};
console.log("");
console.log("PNC Normalization / Matching");
console.log(`raw_rows=${pncRowsCollected || Number(sourceDiag.pnc_rows_collected || 0)}`);
console.log(`normalized_rows=${pncRowsNormalized || Number(sourceDiag.pnc_rows_normalized || 0)}`);
console.log(`matched_vessels=${uniqueBerthSignals.size || Number(sourceDiag.pnc_rows_matched || 0)}`);
console.log(`unmatched_rows=${Math.max(0, (pncRowsNormalized || Number(sourceDiag.pnc_rows_normalized || 0)) - (uniqueBerthSignals.size || Number(sourceDiag.pnc_rows_matched || 0)))}`);
console.log(`matched_by_call_sign=${matchedByCallSign || Number(sourceDiag.pnc_matched_by_call_sign || 0)}`);
console.log(`matched_by_name=${matchedByName || Number(sourceDiag.pnc_matched_by_name || 0)}`);
console.log(`matched_by_port_only=${matchedByPortOnly || Number(sourceDiag.pnc_matched_by_port_only || 0)}`);
console.log(`vessel_outputs_with_berth_signal=${uniqueBerthSignals.size}`);
console.log(`bootstrap_kpi_berth_info_detected_count=${Number(readJson("dashboard/api/bootstrap.json", {})?.kpis?.berth_info_detected_count || 0)}`);

const samples = [...uniqueBerthSignals.values()].slice(0, 10).map(row => {
  const display = row.item.vessel_display || row.item;
  const signal = displaySignal(row.item);
  return {
    vessel_name: display.vessel_name || row.item.vessel_name || "",
    call_sign: display.call_sign || row.item.call_sign || "",
    port: display.current_port || row.item.port || "",
    terminal: signal.terminal || display.terminal || "",
    berth: signal.berth || display.berth || "",
    match_type: signal.match_type || "",
    confidence: signal.confidence ?? null,
    endpoint: row.endpoint
  };
});
console.log(`sample_matched_vessels=${JSON.stringify(samples)}`);

const warnings = [];
if (pncRowsCollected > 0 && pncRowsNormalized === 0) warnings.push("PNC success but rows_normalized=0; check alias mapping/parser blockers.");
if (pncRowsNormalized > 0 && uniqueBerthSignals.size === 0) warnings.push("PNC normalized rows exist but no berth_signal generated.");
if (pncRowsCollected > 0 && !pncDiagnostics.some(diag => Number(diag.http_status || 0) === 200)) warnings.push("PNC rows exist but HTTP 200 was not reported.");
if (!pncDiagnostics.length && (berthSource?.env_presence?.PNC_SOURCE_URLS?.present || process.env.PNC_SOURCE_URLS)) warnings.push("PNC_SOURCE_URLS configured but no pnc_source diagnostics were found.");

if (warnings.length) {
  console.log("");
  console.log("WARNINGS");
  for (const warning of warnings) console.log(`- ${warning}`);
} else {
  console.log("");
  console.log("warnings=none");
}
