import fs from "fs";
import { buildPortStatistics, normalizePort } from "../scripts/lib/port-statistics.js";

const failures = [];

const REQUIRED_FILES = [
  "dashboard/api/dashboard-summary.json",
  "dashboard/api/status.json",
  "dashboard/api/health.json",
  "dashboard/api/staying-vessels.json",
  "dashboard/api/arrival-pipeline.json",
  "dashboard/api/congestion-watchlist.json",
  "dashboard/api/agent-followup-queue.json",
  "dashboard/api/candidates/top.json",
  "dashboard/api/vessels/index.json",
  "dashboard/api/vessels/page-1.json",
  "dashboard/api/intelligence/risk-summary.json",
  "dashboard/api/intelligence/explainability.json",
  "dashboard/api/intelligence/prediction-summary.json",
  "dashboard/api/intelligence/operator-summary.json",
  "dashboard/api/intelligence/route-summary.json",
  "dashboard/api/intelligence/commercial-summary.json",
  "dashboard/api/intelligence/sales-priority.json"
];

const AUTOMATION_FILES = [
  "dashboard/api/reports/daily-sales-report.json",
  "dashboard/api/reports/daily-summary.json",
  "dashboard/api/alerts/sales-alerts.json",
  "dashboard/api/alerts/latest.json"
];

const HEALTH_LABELS = [
  "데이터 상태",
  "마지막 성공 갱신",
  "현재 실행 상태",
  "선박 데이터 수",
  "Supabase 저장 상태",
  "Dataset 승격 상태",
  "Fallback 사용 여부",
  "오류 원인"
];

function fail(message) {
  failures.push(message);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function readText(path) {
  return fs.existsSync(path) ? fs.readFileSync(path, "utf8") : "";
}

function readJson(path) {
  try {
    return JSON.parse(readText(outputPath(path)));
  } catch (error) {
    fail(`${path} is not valid JSON: ${error.message}`);
    return {};
  }
}

function outputPath(path) {
  const debugPath = path.replace("dashboard/api/", "dashboard/api/debug/");
  if (fs.existsSync(path)) return path;
  if (fs.existsSync(debugPath)) return debugPath;
  return path;
}

function rows(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.vessels)) return payload.vessels;
  if (Array.isArray(payload?.candidates)) return payload.candidates;
  if (Array.isArray(payload?.opportunities)) return payload.opportunities;
  return [];
}

function numberOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function chooseDataset({ activePointer, activeRows = 0, latestCompletedRun, latestCompletedRows = 0, latestRun, staticRows = 0 }) {
  if (activePointer?.active_run_id && activeRows > 0) return "active_dataset_pointer";
  if (latestCompletedRun?.run_id && latestCompletedRows > 0) return "latest_successful_dataset";
  if (latestRun?.status === "syncing") return staticRows > 0 ? "static_backup" : "sample_mode";
  if (staticRows > 0) return "static_backup";
  return "sample_mode";
}

function assertSortedDescending(items, field, label) {
  for (let i = 1; i < items.length; i += 1) {
    const prev = numberOrNull(items[i - 1]?.[field]) ?? 0;
    const next = numberOrNull(items[i]?.[field]) ?? 0;
    assert(prev >= next, `${label} must be sorted descending by ${field}.`);
  }
}

for (const file of [...REQUIRED_FILES, ...AUTOMATION_FILES]) {
  assert(fs.existsSync(file) || fs.existsSync(outputPath(file)), `Missing required reliability output: ${file}`);
}

const summary = readJson("dashboard/api/dashboard-summary.json");
const status = readJson("dashboard/api/status.json");
const health = readJson("dashboard/api/health.json");
const pipelineHealth = fs.existsSync("dashboard/api/health/pipeline.json") ? readJson("dashboard/api/health/pipeline.json") : {};
const continuity = fs.existsSync("dashboard/api/data-continuity.json") ? readJson("dashboard/api/data-continuity.json") : {};
const topPayload = readJson("dashboard/api/candidates/top.json");
const followups = rows(readJson("dashboard/api/agent-followup-queue.json"));
const alerts = readJson("dashboard/api/alerts/latest.json");
const report = readJson("dashboard/api/reports/daily-summary.json");
const dashboardSource = readText("dashboard/index.html");
const publicSource = readText("public/index.html");
const rootSource = readText("index.html");
const workerSource = readText("src/worker.js");
const updateSource = readText("scripts/update.js");
const intelligencePayloads = {
  risk: readJson("dashboard/api/intelligence/risk-summary.json"),
  explainability: readJson("dashboard/api/intelligence/explainability.json"),
  prediction: readJson("dashboard/api/intelligence/prediction-summary.json"),
  operator: readJson("dashboard/api/intelligence/operator-summary.json"),
  route: readJson("dashboard/api/intelligence/route-summary.json"),
  commercial: readJson("dashboard/api/intelligence/commercial-summary.json"),
  salesPriority: readJson("dashboard/api/intelligence/sales-priority.json")
};

for (const [name, payload] of Object.entries({ summary, status, health, pipelineHealth, continuity })) {
  assert(payload && typeof payload === "object", `${name} payload must be an object.`);
  assert("generated_at" in payload || name === "continuity", `${name} must expose generated_at or runtime context.`);
}

const countFields = [
  summary.all_vessels_count,
  summary.record_count,
  status.record_count,
  status.all_vessels_count,
  report.kpis?.total_vessels
].filter(value => value !== undefined && value !== null);
for (const value of countFields) {
  assert(numberOrNull(value) !== null, `KPI/count field must resolve to a number: ${value}`);
}

const recordCount = numberOrNull(summary.all_vessels_count ?? status.all_vessels_count ?? status.record_count) ?? 0;
const dataMode = String(status.data_mode || summary.data_mode || "");
if (recordCount > 0) {
  assert(!/sample/i.test(dataMode), "Real record_count > 0 must not be reported as sample mode.");
}

assert("port_statistics_status" in summary, "dashboard-summary.json must include port_statistics_status.");
assert(!/loading/i.test(String(summary.port_statistics_status || "")), "Port statistics status must not stay loading after dashboard summary generation.");
if (recordCount > 0) {
  assert(["completed", "empty", "failed"].includes(summary.port_statistics_status), "Port statistics status must be completed, empty, or failed when records exist.");
  if (summary.port_statistics_status === "completed") {
    assert(numberOrNull(summary.port_count) !== null && Number(summary.port_count) > 0, "record_count > 0 must generate port_count > 0 when port statistics complete.");
    assert(rows(summary.ports).length === Number(summary.port_count), "port_count must equal dashboard-summary ports length.");
    const summaryDisplayNames = rows(summary.ports).map(port => port.display_name || port.port_name).filter(Boolean);
    assert(summaryDisplayNames.length === new Set(summaryDisplayNames).size, "dashboard-summary ports must not contain duplicate display_name values.");
  }
  if (["empty", "failed"].includes(summary.port_statistics_status)) {
    assert(String(summary.port_statistics_error || "").length > 0, "Port statistics empty/failed status must include an error reason.");
  }
}

const portAlias = normalizePort("KR PUS");
assert(portAlias.port_code === "020" && portAlias.port_name === "부산", "normalizePort must resolve KR PUS/KRPUS style Busan aliases.");
const koreanPortAlias = normalizePort("부산항");
assert(koreanPortAlias.port_code === "020" && koreanPortAlias.port_name === "부산", "normalizePort must resolve Korean port aliases before summary generation.");
const portStatsFixture = buildPortStatistics([
  { vessel_name: "A", port_name: "BUSAN", commercial_value_score: 80, last_seen_at: "2026-06-01T00:00:00Z" },
  { vessel_name: "B", port: "KR PUS", biofoulingScore: 60 },
  { vessel_name: "C", port_name: "UNLISTED TEST PORT", salesScore: 55 },
  { vessel_name: "D", port_name: "", salesScore: 90 }
], "2026-06-01T00:00:00Z");
assert(portStatsFixture.port_statistics_status === "completed", "Port statistics fixture should complete.");
assert(portStatsFixture.port_count === 2, "port_count must equal unique normalized ports, excluding empty/null and including UNKNOWN.");
assert(portStatsFixture.unknown_port_count === 1, "Unknown ports must be counted as UNKNOWN, not dropped.");
assert(portStatsFixture.vessels_missing_port_field === 1, "Missing port fields must be counted without breaking dashboard statistics.");
const normalizedAliasStats = buildPortStatistics([
  { vessel_name: "B1", port: "BUSAN" },
  { vessel_name: "B2", port: "PUSAN" },
  { vessel_name: "B3", port: "부산" },
  { vessel_name: "B4", port: "부산항" },
  { vessel_name: "B5", port: "KRPUS" },
  { vessel_name: "B6", port: "KR PUS" },
  { vessel_name: "U1", port: "ULSAN" },
  { vessel_name: "U2", port: "울산항" },
  { vessel_name: "X1", port: "UNLISTED TEST PORT" }
], "2026-06-01T00:00:00Z");
const normalizedDisplayNames = normalizedAliasStats.ports.map(port => port.display_name || port.port_name);
assert(normalizedDisplayNames.length === new Set(normalizedDisplayNames).size, "No duplicate display_name should remain in normalized port summaries.");
assert(normalizedAliasStats.port_count === new Set(normalizedAliasStats.ports.map(port => port.port_code || port.port_name)).size, "port_count must equal unique normalized ports.");
const busanSummary = normalizedAliasStats.ports.find(port => port.port_name === "부산");
assert(busanSummary?.vessel_count === 6, "BUSAN/PUSAN/부산/부산항/KRPUS/KR PUS must merge into 부산.");
for (const alias of ["BUSAN", "PUSAN", "부산", "부산항", "KRPUS", "KR PUS"]) {
  assert((busanSummary?.raw_aliases || []).includes(alias), `Raw port alias must be preserved for audit: ${alias}`);
}
const missingPortStats = buildPortStatistics([{ vessel_name: "NO PORT" }], "2026-06-01T00:00:00Z");
assert(missingPortStats.port_statistics_status === "empty", "Rows with no valid port field must produce empty port statistics, not loading.");
assert(String(missingPortStats.port_statistics_error || "").includes("no_valid_port_field"), "Missing port fields must explain why port statistics are empty.");
const fallbackPortStats = buildPortStatistics(rows(readJson("dashboard/api/all-collected-vessels.json")).length ? rows(readJson("dashboard/api/all-collected-vessels.json")) : [
  { vessel_name: "Fallback A", port_name: "울산", salesScore: 75 }
], "2026-06-01T00:00:00Z");
assert(["completed", "empty"].includes(fallbackPortStats.port_statistics_status), "Fallback dataset must produce bounded port statistics state.");

for (const label of HEALTH_LABELS) {
  assert(dashboardSource.includes(label), `Dashboard health panel missing label: ${label}`);
  assert(publicSource.includes(label), `Public dashboard health panel missing label: ${label}`);
}
assert(dashboardSource.includes("AbortController"), "Dashboard fetches must use AbortController to avoid infinite loading.");
assert(dashboardSource.includes("확인 불가"), "Dashboard must render 확인 불가 for missing values.");
assert(dashboardSource.includes("setTimeout"), "Dashboard must have a bounded loading fallback.");
for (const marker of ["port_statistics_status", "항만 정보 없음", "항만 통계 생성 실패", "fmtMaybe"]) {
  assert(dashboardSource.includes(marker), `Dashboard port statistics rendering missing marker: ${marker}`);
}
for (const marker of ["dashboardStaticPath", "vesselDetailsHtml", "dedupeRows", "searchBlob", "state.rows.slice()"]) {
  assert(dashboardSource.includes(marker), `Dashboard vessel list regression guard missing marker: ${marker}`);
  assert(publicSource.includes(marker), `Public dashboard vessel list regression guard missing marker: ${marker}`);
  assert(rootSource.includes(marker), `Root dashboard vessel list regression guard missing marker: ${marker}`);
}
for (const marker of [
  "숨겨진 인사이트 / 고급 분석",
  "데이터 준비 중",
  "/api/intelligence/explainability.json",
  "/api/intelligence/sales-priority.json",
  "오늘의 영업 우선순위",
  "renderSalesPriority",
  "renderIntelligence",
  "예측 신호 / 실험 기능"
]) {
  assert(dashboardSource.includes(marker), `Dashboard hidden intelligence UI missing marker: ${marker}`);
  assert(publicSource.includes(marker), `Public dashboard hidden intelligence UI missing marker: ${marker}`);
}
for (const [name, payload] of Object.entries(intelligencePayloads)) {
  assert(payload && typeof payload === "object", `Intelligence endpoint must be valid JSON: ${name}`);
  for (const field of ["generated_at", "schema_version", "data_mode", "record_count", "source_table", "items"]) {
    assert(field in payload, `Intelligence endpoint ${name} missing field: ${field}`);
  }
  assert(Array.isArray(payload.items), `Intelligence endpoint ${name} must expose items array.`);
  assert(payload.items.length <= 10, `Intelligence endpoint ${name} must be capped to 10 items.`);
}
for (const item of rows(intelligencePayloads.explainability)) {
  assert(String(item.reason_summary || "").length > 0, "Explainability item must include reason_summary.");
}
for (const item of rows(intelligencePayloads.salesPriority)) {
  for (const field of ["rank", "vessel_name", "port", "opportunity_score", "risk_score", "confidence_score", "reason_summary", "recommended_action", "data_sources", "last_seen_at"]) {
    assert(field in item, `Sales priority item missing required field: ${field}`);
  }
  assert(String(item.reason_summary || "").length > 0, "Sales priority item must explain why it is recommended.");
  assert(Array.isArray(item.data_sources) && item.data_sources.length > 0, "Sales priority item must include data_sources.");
}

const fallbackChoiceCases = [
  {
    name: "active pointer wins",
    input: { activePointer: { active_run_id: "run_active" }, activeRows: 10, latestCompletedRun: { run_id: "run_old" }, latestCompletedRows: 10 },
    expected: "active_dataset_pointer"
  },
  {
    name: "missing active falls to latest successful",
    input: { activePointer: null, activeRows: 0, latestCompletedRun: { run_id: "run_success" }, latestCompletedRows: 5 },
    expected: "latest_successful_dataset"
  },
  {
    name: "syncing latest does not block static",
    input: { latestRun: { status: "syncing" }, staticRows: 3 },
    expected: "static_backup"
  },
  {
    name: "sample mode is final fallback only",
    input: {},
    expected: "sample_mode"
  }
];
for (const scenario of fallbackChoiceCases) {
  assert(chooseDataset(scenario.input) === scenario.expected, `Fallback order regression failed: ${scenario.name}`);
}

for (const marker of [
  "active_dataset_pointer",
  "latest_completed_real_run",
  "latest_snapshot_run",
  "legacy_latest_snapshots",
  "fetchLocalStaticSnapshot"
]) {
  assert(workerSource.includes(marker), `Worker fallback logic missing marker: ${marker}`);
}
assert(!/ReferenceError/.test(JSON.stringify(status.error_summary || {})), "Status must not contain ReferenceError from fallback logic.");

const opportunities = rows(topPayload);
assert(topPayload.focus_question === "Which vessel should HullWiper Korea contact next and why?", "Top candidates must keep the sales-intelligence focus question.");
assert(topPayload.ranking_model === "sales_priority_v3" || opportunities.length === 0, "Top candidates must expose sales_priority_v3 ranking model when candidates exist.");
assertSortedDescending(opportunities, "opportunity_score", "Top candidates");
for (const [index, candidate] of opportunities.slice(0, 10).entries()) {
  assert(candidate.rank === index + 1, "Top 10 candidate ranks must start at 1 and increment by 1.");
  for (const field of ["vessel_name", "port", "vessel_type", "opportunity_score", "priority_label", "reason_summary", "recommended_action"]) {
    assert(field in candidate, `Top candidate missing required field: ${field}`);
  }
  assert(["HOT", "WARM", "LOW"].includes(candidate.priority_label), `Invalid priority_label: ${candidate.priority_label}`);
  if (candidate.priority_label === "HOT") {
    assert(String(candidate.reason_summary || candidate.why_now || "").length > 0, "HOT candidate must explain why it is hot.");
  }
}
const seenIds = new Set();
for (const candidate of opportunities) {
  const id = candidate.imo || candidate.mmsi;
  if (!id) continue;
  assert(!seenIds.has(id), `Duplicate candidate identifier in top candidates: ${id}`);
  seenIds.add(id);
}

const requiredVesselDisplayFields = [
  "vessel_name",
  "imo",
  "mmsi",
  "call_sign",
  "flag",
  "vessel_type",
  "gt",
  "dwt",
  "operator",
  "owner",
  "manager",
  "current_port",
  "eta",
  "ata",
  "stay_days",
  "opportunity_score",
  "risk_score",
  "confidence_score",
  "priority_label",
  "reason_summary",
  "recommended_action",
  "data_sources"
];
const pageOne = readJson("dashboard/api/vessels/page-1.json");
const displayRows = [
  ...rows(topPayload).slice(0, 10),
  ...rows(pageOne).slice(0, 10)
];
for (const item of displayRows) {
  const display = item.vessel_display || {};
  for (const field of requiredVesselDisplayFields) {
    assert(field in display, `vessel_display missing field: ${field}`);
    assert(display[field] !== null && display[field] !== undefined && String(display[field]).trim() !== "", `vessel_display field must use '-' instead of empty/null: ${field}`);
  }
  assert(Array.isArray(display.data_sources), "vessel_display.data_sources must be an array.");
}
const enrichmentIndex = updateSource.indexOf("enrichWithVesselMasterCache(referenceEnrichedRows)");
const scoringIndex = updateSource.indexOf("enrichSalesSignals(annotateRepeatCallerIntelligence(cacheResult.records))");
assert(enrichmentIndex >= 0 && scoringIndex > enrichmentIndex, "Enrichment must run before scoring.");
assert(workerSource.includes("payload") && workerSource.includes("compact.vessel_display = vesselDisplay(merged)"), "Worker vessel pages must preserve enriched payload fields in vessel_display.");

for (const item of followups) {
  for (const field of ["vessel_name", "port", "reason", "recommended_message_angle", "urgency", "next_action"]) {
    assert(field in item, `Agent follow-up queue item missing field: ${field}`);
  }
}

const alertRows = rows(alerts.alerts || alerts);
assert("alert_count" in alerts, "Latest alerts payload must expose alert_count.");
for (const alert of alertRows) {
  assert(alert.alert_key || alert.stable_key, "Alert must expose stable unique key.");
  assert(alert.type && alert.severity && alert.next_action, "Alert must expose type, severity, and next_action.");
}
const alertKeys = alertRows.map(alert => alert.alert_key || alert.stable_key).filter(Boolean);
assert(alertKeys.length === new Set(alertKeys).size, "Alert keys must be unique to avoid spam.");

for (const field of ["total_vessels", "hot_candidates", "fallback_active"]) {
  assert(field in (report.kpis || {}), `Daily report KPI missing: ${field}`);
}
assert(Array.isArray(report.contact_today), "Daily report must expose contact_today array.");
assert(report.data_continuity && typeof report.data_continuity === "object", "Daily report must include data_continuity.");

const continuityOrder = continuity.fallback_order || report.data_continuity?.fallback_order || [];
if (continuityOrder.length) {
  const sources = continuityOrder.map(item => item.source);
  for (const source of ["active_dataset_pointer", "latest_successful_dataset", "latest_snapshot", "static_backup", "sample_mode"]) {
    assert(sources.includes(source) || source === "latest_successful_dataset" && sources.includes("latest_successful_dataset_bundle"), `Fallback order missing source: ${source}`);
  }
}

if (failures.length) {
  console.error("[HWK] reliability test failures");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("[HWK] reliability tests passed");
