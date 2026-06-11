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

function display(row = {}) {
  return row.vessel_display && typeof row.vessel_display === "object" ? row.vessel_display : {};
}

function signal(row = {}) {
  const value = display(row).pilotage_signal || row.pilotage_signal || {};
  return value && typeof value === "object" ? value : {};
}

function useful(value) {
  const text = String(value ?? "").trim();
  return Boolean(text) && !/^(?:-|unknown|none|null|undefined|미확인|확인\s*필요)$/i.test(text);
}

function value(row = {}, ...keys) {
  const view = display(row);
  for (const key of keys) {
    const current = row[key] ?? view[key] ?? row.raw_payload?.[key];
    if (useful(current)) return current;
  }
  return "";
}

function rawText(row = {}) {
  try {
    return JSON.stringify(row);
  } catch {
    return "";
  }
}

function hasPilotSource(row = {}) {
  return Boolean(
    row.source_origin === "pilot_schedule" ||
    row.source_profile === "pilot_schedule" ||
    row.pilot_schedule_matched ||
    row.pilot_only_arrival_review ||
    /pilot|pilotage|도선/i.test(rawText({
      source_origin: row.source_origin,
      source_profile: row.source_profile,
      source_name: row.source_name,
      data_sources: row.data_sources,
      source_names: row.source_names
    }))
  );
}

function hasPilotTerms(row = {}) {
  return Boolean(
    useful(row.pilot_time) ||
    useful(row.pilot_time_text) ||
    useful(row.raw_pilot_time) ||
    useful(row.pilot_station) ||
    useful(row.pilot_direction) ||
    useful(row.movement_type) && /pilot|도선/i.test(String(row.movement_type)) ||
    /pilot|pilotage|도선|도선시간|도선일시|도선점|입항도선|출항도선/i.test(rawText({
      source_origin: row.source_origin,
      source_profile: row.source_profile,
      source_name: row.source_name,
      raw_source_keys: row.raw_source_keys,
      pilot_source_origin: row.pilot_source_origin
    }))
  );
}

function allVesselPageRows() {
  const index = readJson("dashboard/api/vessels/index.json", {}) || {};
  const pages = Array.isArray(index.pages) ? index.pages : ["page-1.json"];
  const rows = [];
  for (const page of pages) rows.push(...items(readJson(`dashboard/api/vessels/${page}`, {})));
  return rows;
}

function count(rows, predicate) {
  return rows.filter(predicate).length;
}

function summarizePilotRows(rows = []) {
  const pilotRows = rows.filter(row => hasPilotSource(row) || hasPilotTerms(row));
  return {
    raw_pilot_rows: pilotRows.length,
    rows_with_vessel_name: count(pilotRows, row => useful(value(row, "vessel_name", "name", "ship_name"))),
    rows_with_call_sign: count(pilotRows, row => useful(value(row, "call_sign", "callsign", "clsgn"))),
    rows_with_port: count(pilotRows, row => useful(value(row, "port", "port_name", "current_port"))),
    rows_with_pilot_date: count(pilotRows, row => useful(value(row, "pilot_date"))),
    rows_with_pilot_time: count(pilotRows, row => useful(value(row, "pilot_time", "pilot_time_text", "raw_pilot_time", "movement_time"))),
    rows_with_pilot_station: count(pilotRows, row => useful(value(row, "pilot_station"))),
    rows_with_pilot_direction: count(pilotRows, row => useful(value(row, "pilot_direction", "movement_type"))),
    time_only_rows: count(pilotRows, row => value(row, "pilot_time_parse_status", "parse_status") === "time_only_missing_date"),
    invalid_time_rows: count(pilotRows, row => value(row, "pilot_time_parse_status", "parse_status") === "invalid_date_time")
  };
}

function summarizeSignals(rows = []) {
  const active = rows.filter(row => signal(row).has_pilotage === true);
  return {
    pilotage_signal_count: rows.filter(row => row.pilotage_signal || display(row).pilotage_signal).length,
    has_pilotage_count: active.length,
    time_only_signal_count: active.filter(row => signal(row).pilotage_status === "TIME_ONLY").length,
    matched_by_call_sign: active.filter(row => /call_sign/.test(signal(row).match_type || row.pilotage_match_type || "")).length,
    matched_by_name: active.filter(row => /name/.test(signal(row).match_type || row.pilotage_match_type || "")).length,
    weak_matches: active.filter(row => /weak/.test(signal(row).match_type || row.pilotage_match_type || "")).length,
    sample_matched_vessels: active.slice(0, 20).map(row => ({
      vessel_name: value(row, "vessel_name"),
      call_sign: value(row, "call_sign"),
      port: value(row, "current_port", "port_name", "port"),
      pilotage_status: signal(row).pilotage_status || "",
      pilotage_time: signal(row).pilotage_time || signal(row).pilotage_time_text || "",
      match_type: signal(row).match_type || row.pilotage_match_type || ""
    }))
  };
}

const report = readJson("data/pipeline-report.json", {}) || {};
const status = readJson("dashboard/api/status.json", {}) || {};
const dashboardSummary = readJson("dashboard/api/dashboard-summary.json", {}) || {};
const bootstrap = readJson("dashboard/api/bootstrap.json", {}) || {};
const allCollected = items(readJson("dashboard/api/all-collected-vessels.json", {}));
const vesselPages = allVesselPageRows();
const candidatesTop = items(readJson("dashboard/api/candidates/top.json", {}));
const salesActions = items(readJson("dashboard/api/sales/actions.json", {}));
const collectorPilot = report?.collector_diagnostics?.pilot_schedule || report?.collector_diagnostics?.matching_diagnostics || {};
const pilotageEnrichment = report?.pilotage_enrichment || report?.collector_diagnostics?.pilotage_enrichment || {};
const insertDiagnostics = report?.pilot_schedule_events_insert || report?.supabase_write?.pilot_schedule_events_insert || {};
const rowsWritten = report?.db_rows_written_by_table || report?.rows_written_by_table || status?.db_rows_written_by_table || status?.rows_written_by_table || dashboardSummary?.rows_written_by_table || {};
const collectedSummary = summarizePilotRows(allCollected);
const pageSignalSummary = summarizeSignals(vesselPages);
const candidateSignalSummary = summarizeSignals(candidatesTop);
const actionSignalSummary = summarizeSignals(salesActions);
const collectorRawPilotRows = Number(collectorPilot.pilot_rows_collected || 0);
const persistedEventsLoaded = Number(pilotageEnrichment.persisted_events_loaded || 0);
const sourceConfigured = Boolean(String(process.env.PILOT_SOURCE_URLS || "").trim()) || Number(collectorPilot.pilot_sources_attempted || 0) > 0;
const sourceEnabled = sourceConfigured || collectorRawPilotRows > 0;
const fetchAttempted = Number(collectorPilot.pilot_sources_attempted || 0) > 0;
const insertedEvents = Number(insertDiagnostics.inserted ?? rowsWritten.pilot_schedule_events ?? report.pilotScheduleEventsSaved ?? 0);
const failedEvents = Number(insertDiagnostics.failed ?? report.pilotScheduleEventsInsertFailed ?? 0);
const warnings = [];

if (sourceEnabled && collectorRawPilotRows === 0) warnings.push("pilot_sources enabled but raw_pilot_rows=0");
if (collectorRawPilotRows > 0 && insertedEvents === 0) warnings.push("raw pilot rows exist but inserted_pilot_schedule_events=0");
if (insertedEvents > 0 && pageSignalSummary.has_pilotage_count === 0) warnings.push("pilot_schedule_events rows exist but matched_vessels=0");
if (Number(collectorPilot.time_only_rows || 0) > 0 && Number(collectorPilot.time_only_rows_discarded || 0) > 0) warnings.push("time-only rows were discarded");
if (failedEvents > 0 && /timestamp|timestamptz|time zone/i.test(JSON.stringify(insertDiagnostics.failure_reasons || []))) warnings.push("pilot_schedule_events insert failed due to timestamptz parsing");

console.log("Pilotage Parsing, Storage, and Matching Audit");
console.log("=============================================");
console.log(`PILOT_SOURCE_URLS_configured=${sourceConfigured ? "yes" : "no"}`);
console.log(`pilot_sources_enabled=${sourceEnabled ? "yes" : "no"}`);
console.log(`pilot_source_fetch_attempted=${fetchAttempted ? "yes" : "no"}`);
console.log(`pilot_source_rows_collected=${collectorRawPilotRows}`);
console.log(`raw_pilot_rows=${collectorRawPilotRows}`);
console.log(`persisted_pilot_schedule_events_loaded=${persistedEventsLoaded}`);
console.log(`raw_records_containing_pilot_terms=${collectedSummary.raw_pilot_rows}`);
console.log(`normalized_pilot_rows=${Number(collectorPilot.pilot_rows_normalized || 0)}`);
console.log(`pilot_rows_with_vessel_name=${Number(collectorPilot.pilot_rows_with_vessel_name || 0)}`);
console.log(`pilot_rows_with_call_sign=${Number(collectorPilot.pilot_rows_with_call_sign || 0)}`);
console.log(`pilot_rows_with_port=${Number(collectorPilot.pilot_rows_with_port || 0)}`);
console.log(`pilot_rows_with_pilot_date=${Number(collectorPilot.pilot_rows_with_pilot_date || 0)}`);
console.log(`pilot_rows_with_pilot_time=${Number(collectorPilot.pilot_rows_with_pilot_time || 0)}`);
console.log(`pilot_rows_with_pilot_station=${Number(collectorPilot.pilot_rows_with_pilot_station || 0)}`);
console.log(`pilot_rows_with_pilot_direction=${Number(collectorPilot.pilot_rows_with_pilot_direction || 0)}`);
console.log(`pilot_schedule_events_insert_attempted=${Number(insertDiagnostics.attempted ?? report.pilotScheduleEventsInsertAttempted ?? 0)}`);
console.log(`pilot_schedule_events_inserted=${insertedEvents}`);
console.log(`pilot_schedule_events_failed=${failedEvents}`);
console.log(`failure_reasons=${JSON.stringify(insertDiagnostics.failure_reasons || [])}`);
console.log(`time_only_rows=${Number(insertDiagnostics.time_only_rows || pilotageEnrichment.time_only_events || collectorPilot.time_only_rows || collectedSummary.time_only_rows || 0)}`);
console.log(`invalid_time_rows=${Number(insertDiagnostics.invalid_time_rows || pilotageEnrichment.invalid_time_events || collectorPilot.invalid_time_rows || collectedSummary.invalid_time_rows || 0)}`);
console.log(`matched_vessels=${Number(pilotageEnrichment.matched_vessels || pilotageEnrichment.applied_to_records || pageSignalSummary.has_pilotage_count || 0)}`);
console.log(`matched_by_call_sign=${Number(pilotageEnrichment.matched_by_call_sign || pageSignalSummary.matched_by_call_sign || 0)}`);
console.log(`matched_by_name=${Number(pilotageEnrichment.matched_by_name || pageSignalSummary.matched_by_name || 0)}`);
console.log(`matched_by_port_only=${Number(pilotageEnrichment.matched_by_port_only || 0)}`);
console.log(`weak_matches=${Number(pilotageEnrichment.weak_matches || pageSignalSummary.weak_matches || 0)}`);
console.log(`unmatched_pilot_rows=${Number(pilotageEnrichment.unmatched_pilot_rows || Math.max(0, collectorRawPilotRows + persistedEventsLoaded - pageSignalSummary.has_pilotage_count) || 0)}`);
console.log(`pilotage_signal_count=${pageSignalSummary.pilotage_signal_count}`);
console.log(`bootstrap_kpi_pilotage_detected_count=${Number(bootstrap?.kpis?.pilotage_detected_count || 0)}`);
console.log("");
console.log("Endpoint signal coverage");
console.log(`- vessels_pages: signal=${pageSignalSummary.pilotage_signal_count}, active=${pageSignalSummary.has_pilotage_count}, time_only=${pageSignalSummary.time_only_signal_count}`);
console.log(`- candidates_top: signal=${candidateSignalSummary.pilotage_signal_count}, active=${candidateSignalSummary.has_pilotage_count}, time_only=${candidateSignalSummary.time_only_signal_count}`);
console.log(`- sales_actions: signal=${actionSignalSummary.pilotage_signal_count}, active=${actionSignalSummary.has_pilotage_count}, time_only=${actionSignalSummary.time_only_signal_count}`);
console.log("");
console.log("Top matched vessels");
console.log(JSON.stringify(pageSignalSummary.sample_matched_vessels, null, 2));

if (insertedEvents === 0) {
  console.log("");
  console.log('NOTE: 도선 정보 미수집 또는 매칭 없음');
}

if (warnings.length) {
  console.log("");
  console.log("WARNINGS");
  for (const warning of warnings) console.log(`- ${warning}`);
} else {
  console.log("");
  console.log("OK: pilotage pipeline has no contradictory active counts.");
}
