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

function hasUsefulValue(value) {
  const text = String(value ?? "").trim();
  return Boolean(text) && !/^(unknown|none|null|undefined|-|확인 필요|미확인)$/i.test(text);
}

function field(row, ...keys) {
  const display = row?.vessel_display && typeof row.vessel_display === "object" ? row.vessel_display : {};
  for (const key of keys) {
    const value = row?.[key] ?? display?.[key];
    if (hasUsefulValue(value)) return value;
  }
  return "";
}

function pilotageSignal(row) {
  const display = row?.vessel_display && typeof row.vessel_display === "object" ? row.vessel_display : {};
  const signal = display.pilotage_signal || row?.pilotage_signal || {};
  return signal && typeof signal === "object" ? signal : {};
}

function hasPilotageSignalField(row) {
  const display = row?.vessel_display && typeof row.vessel_display === "object" ? row.vessel_display : {};
  return Boolean(
    (display.pilotage_signal && typeof display.pilotage_signal === "object") ||
    (row?.pilotage_signal && typeof row.pilotage_signal === "object")
  );
}

function hasPilotage(row) {
  return pilotageSignal(row).has_pilotage === true;
}

function sourceText(row) {
  return [
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
}

function pilotSourceIndicators(row) {
  const indicators = [];
  const source = sourceText(row);
  const direction = String(field(row, "pilot_direction", "movement_type")).toLowerCase();
  if (/pilot|pilotage|pilot_schedule|도선/i.test(source)) indicators.push("source_name");
  if (row.pilot_schedule_matched === true) indicators.push("pilot_schedule_matched");
  if (row.pilot_only_arrival_review === true) indicators.push("pilot_only_arrival_review");
  if (row.outbound_pilot_scheduled === true) indicators.push("outbound_pilot_scheduled");
  if (hasUsefulValue(field(row, "pilot_time", "pilotage_time", "pilot_event_time", "pilot_boarding_time", "pilot_inbound_time", "pilot_outbound_time"))) indicators.push("pilot_time");
  if (hasUsefulValue(field(row, "pilot_station", "pilotage_station", "pilot_boarding_station"))) indicators.push("pilot_station");
  if (direction && !/unknown|none|null/.test(direction)) indicators.push("pilot_direction");
  if (hasUsefulValue(row.pilot_source_url)) indicators.push("pilot_source_url");
  return [...new Set(indicators)];
}

function hasActualPilotSource(row) {
  return pilotSourceIndicators(row).some(indicator => indicator !== "pilot_source_url");
}

function rawMentionsPilot(row) {
  return /pilot|pilotage|도선/i.test(JSON.stringify(row));
}

function hasPilotageArrivalWindow(row) {
  const signal = pilotageSignal(row);
  return Boolean(signal.arrival_window || field(row, "arrival_window_source"));
}

function hasPilotageBerth(row) {
  const signal = pilotageSignal(row);
  return Boolean(field(row, "berth", "berth_name") || signal.berth_name || field(row, "berth_source"));
}

function sourceName(row) {
  const signal = pilotageSignal(row);
  return String(signal.pilotage_source || row.source_origin || row.source_name || "unknown");
}

function identityMatchType(row) {
  if (field(row, "call_sign", "callsign", "clsgn")) return "call_sign";
  if (field(row, "vessel_name", "name", "ship_name")) return "vessel_name";
  return "weak_or_missing_identity";
}

function summarizeRows(rows) {
  const withSignalField = rows.filter(hasPilotageSignalField);
  const displayReliable = rows.filter(hasPilotage);
  const pilotSourceRows = rows.filter(hasActualPilotSource);
  const rawPilotMentions = rows.filter(rawMentionsPilot);
  const sourceUrlOnly = rows.filter(row => {
    const indicators = pilotSourceIndicators(row);
    return indicators.length === 1 && indicators[0] === "pilot_source_url";
  });
  const bySource = new Map();
  for (const row of displayReliable) {
    const source = sourceName(row);
    bySource.set(source, (bySource.get(source) || 0) + 1);
  }
  return {
    total: rows.length,
    pilot_source_rows: pilotSourceRows.length,
    raw_records_containing_pilot_terms: rawPilotMentions.length,
    source_url_only_not_counted: sourceUrlOnly.length,
    pilotage_signal_field_count: withSignalField.length,
    has_pilotage_count: displayReliable.length,
    arrival_window_count: displayReliable.filter(hasPilotageArrivalWindow).length,
    berth_count: displayReliable.filter(hasPilotageBerth).length,
    linked_by_call_sign: displayReliable.filter(row => identityMatchType(row) === "call_sign").length,
    linked_by_vessel_name: displayReliable.filter(row => identityMatchType(row) === "vessel_name").length,
    weak_matches: displayReliable.filter(row => identityMatchType(row) === "weak_or_missing_identity").length,
    by_source: Object.fromEntries([...bySource.entries()].sort((a, b) => b[1] - a[1]))
  };
}

function allVesselPageRows() {
  const index = readJson("dashboard/api/vessels/index.json", {});
  const pages = Array.isArray(index.pages) ? index.pages : ["page-1.json"];
  const rows = [];
  const pageStats = [];
  for (const page of pages) {
    const pageRows = items(readJson(`dashboard/api/vessels/${page}`, {}));
    rows.push(...pageRows);
    pageStats.push({
      page,
      rows: pageRows.length,
      rows_with_pilotage_signal: pageRows.filter(hasPilotageSignalField).length,
      rows_with_has_pilotage: pageRows.filter(hasPilotage).length
    });
  }
  return { rows, pageStats };
}

function latestReport() {
  return readJson("data/pipeline-report.json", {}) || {};
}

const allPages = allVesselPageRows();
const endpointRows = {
  all_collected: items(readJson("dashboard/api/all-collected-vessels.json", {})),
  vessels_pages: allPages.rows,
  arrival_pipeline: items(readJson("dashboard/api/arrival-pipeline.json", {})),
  candidates_top: items(readJson("dashboard/api/candidates/top.json", {})),
  targets_current: items(readJson("dashboard/api/targets/current.json", {})),
  sales_actions: items(readJson("dashboard/api/sales/actions.json", {}))
};

const report = latestReport();
const dashboardSummary = readJson("dashboard/api/dashboard-summary.json", {}) || {};
const status = readJson("dashboard/api/status.json", {}) || {};
const bootstrap = readJson("dashboard/api/bootstrap.json", {}) || {};
const summaries = Object.fromEntries(Object.entries(endpointRows).map(([name, rows]) => [name, summarizeRows(rows)]));
const pilotageEnrichment = report?.pilotage_enrichment || report?.collector_diagnostics?.pilotage_enrichment || {};
const rowsWritten = report?.rows_written_by_table || status?.rows_written_by_table || dashboardSummary?.rows_written_by_table || {};
const pilotScheduleEventsRows = Number(rowsWritten.pilot_schedule_events || report?.pilot_schedule_events_rows || report?.pilot_schedule_events_saved || 0);
const matchingDiagnostics = report?.collector_diagnostics?.matching_diagnostics || report?.matching_diagnostics || {};
const matchingPilotRowsCollected = Number(matchingDiagnostics.pilot_rows_collected || 0);
const matchingPilotRowsMatched = Number(matchingDiagnostics.pilot_rows_matched || 0);
const bootstrapKpi = Number(bootstrap?.kpis?.pilotage_detected_count || 0);
const vesselPageFilesWithSignal = allPages.pageStats.filter(page => page.rows_with_pilotage_signal > 0).length;
const vesselPageFilesWithHasPilotage = allPages.pageStats.filter(page => page.rows_with_has_pilotage > 0).length;
const pilotSourceRows = summaries.all_collected.pilot_source_rows;
const vesselsWithPilotage = summaries.all_collected.has_pilotage_count;
const availabilityMessage = pilotScheduleEventsRows === 0
  ? "도선 정보 미수집 또는 매칭 없음"
  : vesselsWithPilotage > 0
    ? "도선 정보 표시 가능"
    : "도선 이벤트는 있으나 선박 매칭 없음";
const warnings = [];

if (pilotScheduleEventsRows === 0 && bootstrapKpi > 0) {
  warnings.push("pilot_schedule_events=0 but bootstrap pilotage_detected_count is non-zero");
}
if (pilotScheduleEventsRows === 0 && summaries.vessels_pages.has_pilotage_count > 0) {
  warnings.push("pilot_schedule_events=0 but vessel pages contain active pilotage badges");
}
if (pilotSourceRows > 0 && vesselsWithPilotage === 0) {
  warnings.push("pilot source rows exist but vessel_display.pilotage_signal.has_pilotage is never true");
}
if (pilotScheduleEventsRows > 0 && vesselsWithPilotage === 0) {
  warnings.push("pilot_schedule_events rows exist but no vessel was matched for display");
}
if (summaries.all_collected.has_pilotage_count !== bootstrapKpi) {
  warnings.push(`bootstrap.kpis.pilotage_detected_count=${bootstrapKpi} differs from all_collected has_pilotage_count=${summaries.all_collected.has_pilotage_count}`);
}

console.log("Pilotage Signal Availability Audit");
console.log("==================================");
console.log(`availability_status=${availabilityMessage}`);
console.log(`pilot_schedule_events_rows=${pilotScheduleEventsRows}`);
console.log(`pilot_source_rows=${pilotSourceRows}`);
console.log(`matching_diagnostics_pilot_rows_collected=${matchingPilotRowsCollected}`);
console.log(`matching_diagnostics_pilot_rows_matched=${matchingPilotRowsMatched}`);
console.log(`raw_records_containing_pilot_terms=${summaries.all_collected.raw_records_containing_pilot_terms}`);
console.log(`source_url_only_not_counted=${summaries.all_collected.source_url_only_not_counted}`);
console.log(`vessels_with_pilotage_signal_has_pilotage=${vesselsWithPilotage}`);
console.log(`bootstrap_kpi_pilotage_detected_count=${bootstrapKpi}`);
console.log(`vessel_page_files_checked=${allPages.pageStats.length}`);
console.log(`vessel_pages_containing_pilotage_signal=${vesselPageFilesWithSignal}`);
console.log(`vessel_pages_containing_active_pilotage=${vesselPageFilesWithHasPilotage}`);
console.log(`vessel_page_rows_with_pilotage_signal=${summaries.vessels_pages.pilotage_signal_field_count}`);
console.log(`vessel_page_rows_with_has_pilotage=${summaries.vessels_pages.has_pilotage_count}`);
console.log(`pilotage_enrichment_status=${pilotageEnrichment.status || "unknown"}`);
console.log(`pilotage_reference_events_total=${pilotageEnrichment.reference_events_total || 0}`);
console.log(`pilotage_applied_to_records=${pilotageEnrichment.applied_to_records || 0}`);
console.log(`pilotage_berth_applied_count=${pilotageEnrichment.berth_applied_count || 0}`);
console.log(`pilotage_arrival_timing_applied_count=${pilotageEnrichment.arrival_timing_applied_count || 0}`);
console.log(`pilotage_identity_applied_count=${pilotageEnrichment.identity_applied_count || 0}`);
console.log("");
console.log("Endpoint coverage");
for (const [name, summary] of Object.entries(summaries)) {
  console.log(`- ${name}: total=${summary.total}, pilot_source_rows=${summary.pilot_source_rows}, raw_pilot_terms=${summary.raw_records_containing_pilot_terms}, signal_field=${summary.pilotage_signal_field_count}, has_pilotage=${summary.has_pilotage_count}, arrival_window=${summary.arrival_window_count}, berth=${summary.berth_count}, call_sign=${summary.linked_by_call_sign}, vessel_name=${summary.linked_by_vessel_name}, weak=${summary.weak_matches}`);
}
console.log("");
console.log("Detected pilotage by source");
console.log(JSON.stringify(summaries.all_collected.by_source, null, 2));

if (pilotScheduleEventsRows === 0) {
  console.log("");
  console.log("NOTE");
  console.log("- 도선 정보 미수집 또는 매칭 없음");
  console.log("- pilot_source_url 같은 설정성 URL은 실제 도선 배지/카운트로 세지 않습니다.");
}

if (warnings.length) {
  console.log("");
  console.log("WARNINGS");
  for (const warning of warnings) console.log(`- ${warning}`);
  process.exitCode = 1;
} else {
  console.log("");
  console.log("OK: pilotage counts are not shown as active without matched pilotage data.");
}
