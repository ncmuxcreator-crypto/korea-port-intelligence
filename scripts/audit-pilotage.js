import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

function readJson(relativePath, fallback = null) {
  const filePath = path.join(ROOT, relativePath);
  try {
    return fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, "utf8")) : fallback;
  } catch (error) {
    return { __parse_error: error.message };
  }
}

function items(payload) {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.items)) return payload.items;
  if (Array.isArray(payload.data)) return payload.data;
  if (Array.isArray(payload.vessels)) return payload.vessels;
  if (Array.isArray(payload.top_candidates)) return payload.top_candidates;
  if (Array.isArray(payload.features)) return payload.features.map(feature => feature.properties || {});
  return [];
}

function field(row, ...keys) {
  const display = row?.vessel_display && typeof row.vessel_display === "object" ? row.vessel_display : {};
  for (const key of keys) {
    const value = row?.[key] ?? display?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== "" && String(value).trim() !== "-") return value;
  }
  return "";
}

function knownDirection(value) {
  const text = String(value || "").toLowerCase();
  if (!text || /unknown|none|null|미확인/.test(text)) return false;
  return /inbound|outbound|arrival|departure|pilot|도선|입항|출항/.test(text);
}

function rawPilotSignal(row) {
  const sourceText = [
    row.source_origin,
    row.source_profile,
    row.source_name,
    row.eta_source,
    row.etb_source,
    row.enrichment_source,
    row.enrichment_source_type,
    ...(Array.isArray(row.source_names) ? row.source_names : []),
    ...(Array.isArray(row.data_sources) ? row.data_sources : [])
  ].filter(Boolean).join(" ");
  const sourceIndicatesPilot = /pilot|pilotage|pilot_schedule|pilot_sources|도선/i.test(sourceText);
  const explicit = Boolean(row.pilot_schedule_matched || row.pilot_only_arrival_review || row.outbound_pilot_scheduled || row.source_origin === "pilot_schedule");
  const pilotTime = Boolean(field(row, "pilot_time", "pilotage_time", "pilot_event_time", "pilot_boarding_time", "pilot_inbound_time", "pilot_outbound_time", "pilot_inbound", "pilot_outbound"));
  const movementTime = Boolean(field(row, "movement_time")) && (sourceIndicatesPilot || explicit || knownDirection(field(row, "pilot_direction", "movement_type")));
  const station = Boolean(field(row, "pilot_station", "pilotage_station", "pilot_boarding_station"));
  const status = Boolean(field(row, "pilot_status", "pilotage_status", "pilot_order_status", "pilot_schedule_status"));
  const direction = knownDirection(field(row, "pilot_direction", "movement_type")) && sourceIndicatesPilot;
  return explicit || pilotTime || movementTime || station || status || direction;
}

function displayPilotSignal(row) {
  const signal = row?.vessel_display?.pilotage_signal || row?.pilotage_signal || {};
  return signal && typeof signal === "object" && signal.has_pilotage === true;
}

function hasPilotageArrivalWindow(row) {
  const display = row?.vessel_display && typeof row.vessel_display === "object" ? row.vessel_display : {};
  const signal = display.pilotage_signal || row?.pilotage_signal || {};
  return Boolean(display.arrival_window || row?.arrival_window || signal.arrival_window || field(row, "arrival_window_source"));
}

function hasPilotageBerth(row) {
  const display = row?.vessel_display && typeof row.vessel_display === "object" ? row.vessel_display : {};
  const signal = display.pilotage_signal || row?.pilotage_signal || {};
  return Boolean(field(row, "berth", "berth_name") || signal.berth_name || field(row, "berth_source"));
}

function sourceName(row) {
  const signal = row?.vessel_display?.pilotage_signal || row?.pilotage_signal || {};
  return String(signal.pilotage_source || row.source_origin || row.source_name || "unknown");
}

function identityMatchType(row) {
  if (field(row, "call_sign", "callsign", "clsgn")) return "call_sign";
  if (field(row, "vessel_name", "name", "ship_name")) return "vessel_name";
  return "weak_or_missing_identity";
}

function summarizeRows(rows) {
  const rawReliable = rows.filter(rawPilotSignal);
  const displayReliable = rows.filter(displayPilotSignal);
  const bySource = new Map();
  for (const row of displayReliable) {
    const source = sourceName(row);
    bySource.set(source, (bySource.get(source) || 0) + 1);
  }
  return {
    total: rows.length,
    raw_reliable_count: rawReliable.length,
    display_count: displayReliable.length,
    arrival_window_count: displayReliable.filter(hasPilotageArrivalWindow).length,
    berth_count: displayReliable.filter(hasPilotageBerth).length,
    linked_by_call_sign: displayReliable.filter(row => identityMatchType(row) === "call_sign").length,
    linked_by_vessel_name: displayReliable.filter(row => identityMatchType(row) === "vessel_name").length,
    weak_matches: displayReliable.filter(row => identityMatchType(row) === "weak_or_missing_identity").length,
    by_source: Object.fromEntries([...bySource.entries()].sort((a, b) => b[1] - a[1]))
  };
}

function firstPageRows() {
  const index = readJson("dashboard/api/vessels/index.json", {});
  const pages = Array.isArray(index.pages) ? index.pages : ["page-1.json"];
  const rows = [];
  for (const page of pages.slice(0, 5)) {
    rows.push(...items(readJson(`dashboard/api/vessels/${page}`, {})));
  }
  return rows;
}

function latestReport() {
  return readJson("data/pipeline-report.json", {}) || {};
}

const endpointRows = {
  all_collected: items(readJson("dashboard/api/all-collected-vessels.json", {})),
  vessels_pages_sample: firstPageRows(),
  arrival_pipeline: items(readJson("dashboard/api/arrival-pipeline.json", {})),
  candidates_top: items(readJson("dashboard/api/candidates/top.json", {})),
  targets_current: items(readJson("dashboard/api/targets/current.json", {})),
  sales_actions: items(readJson("dashboard/api/sales/actions.json", {}))
};

const report = latestReport();
const summaries = Object.fromEntries(Object.entries(endpointRows).map(([name, rows]) => [name, summarizeRows(rows)]));
const pilotageEnrichment = report?.pilotage_enrichment || report?.collector_diagnostics?.pilotage_enrichment || {};
const bootstrap = readJson("dashboard/api/bootstrap.json", {});
const bootstrapKpi = Number(bootstrap?.kpis?.pilotage_detected_count || 0);
const raw = endpointRows.all_collected;
const sourceUrlOnly = raw.filter(row =>
  row.pilot_source_url &&
  !rawPilotSignal(row)
).length;
const pipelineSaved = Number(report?.collector_diagnostics?.pilotScheduleEventsSaved || report?.pilot_schedule_events_saved || report?.rows_written_by_table?.pilot_schedule_events || 0);
const uiFile = fs.existsSync(path.join(ROOT, "dashboard/index.html")) ? fs.readFileSync(path.join(ROOT, "dashboard/index.html"), "utf8") : "";
const uiHasBadge = /pilotage-badge|도선 정보/.test(uiFile);
const uiHasFilter = /pilotageOnly|도선 정보 있음/.test(uiFile);
const warnings = [];

if (summaries.all_collected.raw_reliable_count > 0 && summaries.all_collected.display_count === 0) {
  warnings.push("raw pilotage signals exist but vessel_display.pilotage_signal is not populated");
}
if (pipelineSaved > 0 && summaries.all_collected.display_count === 0) {
  warnings.push("pilot_schedule_events were saved but no vessel_display pilotage signal is visible");
}
if (summaries.all_collected.display_count !== bootstrapKpi) {
  warnings.push(`bootstrap.kpis.pilotage_detected_count=${bootstrapKpi} differs from all_collected display_count=${summaries.all_collected.display_count}`);
}
if (summaries.all_collected.display_count > 0 && !uiHasBadge) warnings.push("UI pilotage badge marker not found");
if (summaries.all_collected.display_count > 0 && !uiHasFilter) warnings.push("UI pilotage quick filter marker not found");

console.log("Pilotage Audit");
console.log("==============");
console.log(`total_vessels=${summaries.all_collected.total}`);
console.log(`pilotage_detected_count=${summaries.all_collected.display_count}`);
console.log(`raw_reliable_pilotage_count=${summaries.all_collected.raw_reliable_count}`);
console.log(`source_url_only_not_counted=${sourceUrlOnly}`);
console.log(`pilot_schedule_events_saved=${pipelineSaved}`);
console.log(`bootstrap_kpi_pilotage_detected_count=${bootstrapKpi}`);
console.log(`pilotage_enrichment_status=${pilotageEnrichment.status || "unknown"}`);
console.log(`pilotage_reference_events_total=${pilotageEnrichment.reference_events_total || 0}`);
console.log(`pilotage_applied_to_records=${pilotageEnrichment.applied_to_records || 0}`);
console.log(`pilotage_berth_applied_count=${pilotageEnrichment.berth_applied_count || 0}`);
console.log(`pilotage_arrival_timing_applied_count=${pilotageEnrichment.arrival_timing_applied_count || 0}`);
console.log(`pilotage_identity_applied_count=${pilotageEnrichment.identity_applied_count || 0}`);
console.log("");
console.log("Endpoint coverage");
for (const [name, summary] of Object.entries(summaries)) {
  console.log(`- ${name}: total=${summary.total}, display=${summary.display_count}, raw_reliable=${summary.raw_reliable_count}, arrival_window=${summary.arrival_window_count}, berth=${summary.berth_count}, call_sign=${summary.linked_by_call_sign}, vessel_name=${summary.linked_by_vessel_name}, weak=${summary.weak_matches}`);
}
console.log("");
console.log("Detected by source");
console.log(JSON.stringify(summaries.all_collected.by_source, null, 2));

if (warnings.length) {
  console.log("");
  console.log("WARNINGS");
  for (const warning of warnings) console.log(`- ${warning}`);
  process.exitCode = 1;
} else {
  console.log("");
  console.log("OK: pilotage mapping is internally consistent.");
}
