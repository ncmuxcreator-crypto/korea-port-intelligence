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
  "dashboard/api/sales/verification-queue.json",
  "dashboard/api/sales/actions.json",
  "dashboard/api/sales/quote-opportunities.json",
  "dashboard/api/targets/categories.json",
  "dashboard/api/candidates/top.json",
  "dashboard/api/vessels/index.json",
  "dashboard/api/vessels/page-1.json",
  "dashboard/api/intelligence/risk-summary.json",
  "dashboard/api/intelligence/biofouling-risk.json",
  "dashboard/api/intelligence/hull-cleaning-engine.json",
  "dashboard/api/biofouling/port-risk-map.json",
  "dashboard/api/biofouling/vessel-risk-scores.json",
  "dashboard/api/biofouling/hotspots.json",
  "dashboard/api/biofouling/top-hull-cleaning-candidates.json",
  "dashboard/api/biofouling/brazil-compliance-risk.json",
  "dashboard/api/biofouling/port-risk-map.geojson",
  "dashboard/api/biofouling/hotspots.geojson",
  "dashboard/api/intelligence/explainability.json",
  "dashboard/api/intelligence/prediction-summary.json",
  "dashboard/api/intelligence/operator-summary.json",
  "dashboard/api/intelligence/operator-opportunities.json",
  "dashboard/api/intelligence/agent-summary.json",
  "dashboard/api/intelligence/agent-relationship.json",
  "dashboard/api/intelligence/repeat-callers.json",
  "dashboard/api/intelligence/fleet-summary.json",
  "dashboard/api/intelligence/fleet-memory.json",
  "dashboard/api/intelligence/customer-memory.json",
  "dashboard/api/intelligence/fleet-penetration.json",
  "dashboard/api/intelligence/fleet-expansion.json",
  "dashboard/api/intelligence/vessel-timeline.json",
  "dashboard/api/intelligence/korea-presence.json",
  "dashboard/api/intelligence/fleet-clusters.json",
  "dashboard/api/intelligence/cleaning-window.json",
  "dashboard/api/intelligence/port-opportunities.json",
  "dashboard/api/intelligence/superintendent-targets.json",
  "dashboard/api/intelligence/compliance-opportunities.json",
  "dashboard/api/intelligence/drydock-prediction.json",
  "dashboard/api/intelligence/revenue-forecast.json",
  "dashboard/api/intelligence/route-summary.json",
  "dashboard/api/intelligence/commercial-summary.json",
  "dashboard/api/intelligence/sales-priority.json"
];

const AUTOMATION_FILES = [
  "dashboard/api/reports/daily-sales-report.json",
  "dashboard/api/reports/daily-summary.json",
  "dashboard/api/reports/morning-brief.json",
  "dashboard/api/reports/executive-weekly.json",
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
const bootstrap = fs.existsSync("dashboard/api/bootstrap.json") ? readJson("dashboard/api/bootstrap.json") : {};
const health = readJson("dashboard/api/health.json");
const pipelineHealth = fs.existsSync("dashboard/api/health/pipeline.json") ? readJson("dashboard/api/health/pipeline.json") : {};
const continuity = fs.existsSync("dashboard/api/data-continuity.json") ? readJson("dashboard/api/data-continuity.json") : {};
const topPayload = readJson("dashboard/api/candidates/top.json");
const followups = rows(readJson("dashboard/api/agent-followup-queue.json"));
const verificationQueue = rows(readJson("dashboard/api/sales/verification-queue.json"));
const targetCategoriesPayload = readJson("dashboard/api/targets/categories.json");
const salesActionsPayload = readJson("dashboard/api/sales/actions.json");
const quoteOpportunitiesPayload = readJson("dashboard/api/sales/quote-opportunities.json");
const alerts = readJson("dashboard/api/alerts/latest.json");
const report = readJson("dashboard/api/reports/daily-summary.json");
const morningBrief = readJson("dashboard/api/reports/morning-brief.json");
const executiveWeekly = readJson("dashboard/api/reports/executive-weekly.json");
const dashboardSource = readText("dashboard/index.html");
const publicSource = readText("public/index.html");
const rootSource = readText("index.html");
const workerSource = readText("src/worker.js");
const updateSource = readText("scripts/update.js");
const intelligencePayloads = {
  risk: readJson("dashboard/api/intelligence/risk-summary.json"),
  biofoulingRisk: readJson("dashboard/api/intelligence/biofouling-risk.json"),
  hullCleaningEngine: readJson("dashboard/api/intelligence/hull-cleaning-engine.json"),
  explainability: readJson("dashboard/api/intelligence/explainability.json"),
  prediction: readJson("dashboard/api/intelligence/prediction-summary.json"),
  operator: readJson("dashboard/api/intelligence/operator-summary.json"),
  operatorOpportunities: readJson("dashboard/api/intelligence/operator-opportunities.json"),
  agent: readJson("dashboard/api/intelligence/agent-summary.json"),
  agentRelationship: readJson("dashboard/api/intelligence/agent-relationship.json"),
  repeatCallers: readJson("dashboard/api/intelligence/repeat-callers.json"),
  fleet: readJson("dashboard/api/intelligence/fleet-summary.json"),
  fleetMemory: readJson("dashboard/api/intelligence/fleet-memory.json"),
  customerMemory: readJson("dashboard/api/intelligence/customer-memory.json"),
  fleetPenetration: readJson("dashboard/api/intelligence/fleet-penetration.json"),
  fleetExpansion: readJson("dashboard/api/intelligence/fleet-expansion.json"),
  vesselTimeline: readJson("dashboard/api/intelligence/vessel-timeline.json"),
  koreaPresence: readJson("dashboard/api/intelligence/korea-presence.json"),
  fleetClusters: readJson("dashboard/api/intelligence/fleet-clusters.json"),
  cleaningWindow: readJson("dashboard/api/intelligence/cleaning-window.json"),
  portOpportunities: readJson("dashboard/api/intelligence/port-opportunities.json"),
  superintendentTargets: readJson("dashboard/api/intelligence/superintendent-targets.json"),
  complianceOpportunities: readJson("dashboard/api/intelligence/compliance-opportunities.json"),
  drydockPrediction: readJson("dashboard/api/intelligence/drydock-prediction.json"),
  revenueForecast: readJson("dashboard/api/intelligence/revenue-forecast.json"),
  route: readJson("dashboard/api/intelligence/route-summary.json"),
  commercial: readJson("dashboard/api/intelligence/commercial-summary.json"),
  salesPriority: readJson("dashboard/api/intelligence/sales-priority.json")
};
const biofoulingPayloads = {
  portRiskMap: readJson("dashboard/api/biofouling/port-risk-map.json"),
  vesselRiskScores: readJson("dashboard/api/biofouling/vessel-risk-scores.json"),
  hotspots: readJson("dashboard/api/biofouling/hotspots.json"),
  topHullCleaningCandidates: readJson("dashboard/api/biofouling/top-hull-cleaning-candidates.json"),
  brazilComplianceRisk: readJson("dashboard/api/biofouling/brazil-compliance-risk.json"),
  portRiskMapGeojson: readJson("dashboard/api/biofouling/port-risk-map.geojson"),
  hotspotsGeojson: readJson("dashboard/api/biofouling/hotspots.geojson")
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
for (const marker of ["dashboardStaticPath", "vesselDetailsHtml", "dedupeRows", "identityPick", "searchBlob", "state.rows.slice()"]) {
  assert(dashboardSource.includes(marker), `Dashboard vessel list regression guard missing marker: ${marker}`);
  assert(publicSource.includes(marker), `Public dashboard vessel list regression guard missing marker: ${marker}`);
  assert(rootSource.includes(marker), `Root dashboard vessel list regression guard missing marker: ${marker}`);
}
for (const marker of ["loadDynamicAllVesselPage", "/api/vessels?group=all&page="]) {
  assert(dashboardSource.includes(marker), `Dashboard all-vessel tab must reuse existing paginated all-vessels API: ${marker}`);
  assert(publicSource.includes(marker), `Public dashboard all-vessel tab must reuse existing paginated all-vessels API: ${marker}`);
}
for (const marker of [
  "추가 인사이트 / 심화 분석",
  "overviewExtraInsights",
  "salesExtraInsightsBlock",
  "데이터 준비 중",
  "/api/intelligence/explainability.json",
  "/api/intelligence/sales-priority.json",
  "renderSalesPriority",
  "renderIntelligence",
  "insightGroupAdvanced"
]) {
  assert(dashboardSource.includes(marker), `Dashboard hidden intelligence UI missing marker: ${marker}`);
  assert(publicSource.includes(marker), `Public dashboard hidden intelligence UI missing marker: ${marker}`);
}
for (const marker of [
  "/api/intelligence/biofouling-risk.json",
  "/api/intelligence/hull-cleaning-engine.json",
  "/api/intelligence/cleaning-window.json",
  "/api/intelligence/operator-opportunities.json",
  "/api/intelligence/fleet-memory.json",
  "/api/intelligence/agent-relationship.json",
  "/api/intelligence/customer-memory.json",
  "/api/intelligence/fleet-penetration.json",
  "/api/intelligence/fleet-expansion.json",
  "/api/intelligence/vessel-timeline.json",
  "/api/intelligence/korea-presence.json",
  "/api/intelligence/fleet-clusters.json",
  "/api/intelligence/port-opportunities.json",
  "/api/intelligence/superintendent-targets.json",
  "/api/intelligence/compliance-opportunities.json",
  "/api/intelligence/drydock-prediction.json",
  "/api/intelligence/revenue-forecast.json",
  "/api/reports/morning-brief.json",
  "/api/reports/executive-weekly.json"
]) {
  assert(dashboardSource.includes(marker), `Dashboard advanced intelligence endpoint missing marker: ${marker}`);
  assert(publicSource.includes(marker), `Public dashboard advanced intelligence endpoint missing marker: ${marker}`);
}
for (const marker of [
  "isLatestSnapshotAssetRoute",
  'pathname.endsWith("/targets/current.json")',
  'pathname.endsWith("/arrival-pipeline.json")',
  'pathname.endsWith("/reports/morning-brief.json")',
  'pathname.endsWith("/reports/executive-weekly.json")',
  '/^\\/api\\/vessels\\/(?:index|page-\\d+)\\.json$/.test(pathname)',
  '/^\\/api\\/biofouling\\/[^/]+\\.(?:json|geojson)$/.test(pathname)',
  '/^\\/api\\/intelligence\\/[^/]+\\.json$/.test(pathname)',
  '"agent-relationship": "agent-intelligence,operator_contact_history',
  '"customer-memory": "commercial_leads,operator_contact_history'
]) {
  assert(workerSource.includes(marker), `Worker must serve latest static snapshot before DB summary fallback: ${marker}`);
}
for (const [name, payload] of Object.entries(intelligencePayloads)) {
  assert(payload && typeof payload === "object", `Intelligence endpoint must be valid JSON: ${name}`);
  for (const field of ["generated_at", "schema_version", "data_mode", "record_count", "source_table", "items"]) {
    assert(field in payload, `Intelligence endpoint ${name} missing field: ${field}`);
  }
  assert(Array.isArray(payload.items), `Intelligence endpoint ${name} must expose items array.`);
  assert(payload.items.length <= 10, `Intelligence endpoint ${name} must be capped to 10 items.`);
}
for (const item of rows(intelligencePayloads.agentRelationship)) {
  for (const field of ["agent_name", "relationship_score", "vessel_count", "hot_count", "repeat_interactions", "opportunity_value", "recommended_action"]) {
    assert(field in item, `Agent relationship item missing required field: ${field}`);
  }
}
for (const [name, payload] of Object.entries(biofoulingPayloads).filter(([name]) => !name.endsWith("Geojson"))) {
  assert(payload && typeof payload === "object", `Biofouling endpoint must be valid JSON: ${name}`);
  for (const field of ["generated_at", "schema_version", "data_mode", "record_count", "source_table", "items"]) {
    assert(field in payload, `Biofouling endpoint ${name} missing field: ${field}`);
  }
  assert(Array.isArray(payload.items), `Biofouling endpoint ${name} must expose items array.`);
}
for (const item of rows(biofoulingPayloads.vesselRiskScores).slice(0, 5)) {
  for (const field of ["biofouling_risk_score", "norm_sst_anomaly", "norm_dwell_time", "norm_salinity", "formula", "data_sources", "vessel_display"]) {
    assert(field in item, `Biofouling vessel risk item missing field: ${field}`);
  }
  assert(item.formula === "0.5 * norm_sst_anomaly + 0.4 * norm_dwell_time + 0.1 * (1 - norm_salinity)", "Biofouling vessel risk formula must remain explicit.");
  assert(Array.isArray(item.data_sources) && item.data_sources.includes("NOAA SST"), "Biofouling vessel risk item must include NOAA SST as a data source.");
}
for (const [name, payload] of Object.entries({ portRiskMapGeojson: biofoulingPayloads.portRiskMapGeojson, hotspotsGeojson: biofoulingPayloads.hotspotsGeojson })) {
  assert(payload?.type === "FeatureCollection", `Biofouling ${name} must be a GeoJSON FeatureCollection.`);
  assert(Array.isArray(payload.features), `Biofouling ${name} must expose features array.`);
}
const majorBiofoulingPortCodes = ["020", "820", "620-YEOSU", "620-GWANGYANG", "030", "031", "810", "622", "070", "080", "621", "120", "940"];
const portRiskFeatureCodes = new Set(biofoulingPayloads.portRiskMapGeojson.features.map(feature => feature?.properties?.port_code).filter(Boolean));
const portRiskItemCodes = new Set(rows(biofoulingPayloads.portRiskMap).map(item => item.port_code).filter(Boolean));
for (const code of majorBiofoulingPortCodes) {
  assert(portRiskFeatureCodes.has(code), `Biofouling port risk GeoJSON must include major port code: ${code}`);
  assert(portRiskItemCodes.has(code), `Biofouling port risk JSON must include major port code: ${code}`);
}
assert(publicSource.includes("biofoulingNav") && dashboardSource.includes("biofoulingNav"), "Dashboard must expose the Biofouling navigation tab.");
assert(publicSource.includes("/api/biofouling/vessel-risk-scores.json") && dashboardSource.includes("/api/biofouling/vessel-risk-scores.json"), "Dashboard must lazy-load Biofouling vessel risk scores.");
assert(publicSource.includes("/api/intelligence/hull-cleaning-engine.json") && dashboardSource.includes("/api/intelligence/hull-cleaning-engine.json"), "Dashboard must surface the Hull Cleaning Intelligence Engine endpoint.");
for (const item of rows(intelligencePayloads.hullCleaningEngine).slice(0, 5)) {
  for (const field of ["vessel_display", "hull_cleaning_opportunity_score", "biofouling_risk_score", "departure_prediction_eta", "port_congestion_index", "hot_prospect_rank", "loitering_detected", "pilot_event_suppressed", "alert_dedupe_window_hours"]) {
    assert(field in item, `Hull Cleaning Engine item missing required field: ${field}`);
  }
  assert(Number(item.hull_cleaning_opportunity_score || 0) >= 0 && Number(item.hull_cleaning_opportunity_score || 0) <= 100, "Hull Cleaning opportunity score must be 0-100.");
  assert(Number(item.biofouling_risk_score || 0) >= 0 && Number(item.biofouling_risk_score || 0) <= 100, "Hull Cleaning biofouling risk score must be 0-100.");
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
for (const item of rows(intelligencePayloads.repeatCallers)) {
  for (const field of ["vessel_display", "visit_count_30d", "visit_count_90d", "visit_count_365d", "ports_visited", "average_stay_days", "last_visit", "next_eta", "operator", "opportunity_score", "repeat_caller_score", "reason_summary", "recommended_action"]) {
    assert(field in item, `Repeat caller item missing required field: ${field}`);
  }
  assert(Array.isArray(item.ports_visited), "Repeat caller item ports_visited must be an array.");
  assert(Number(item.visit_count_90d || 0) >= 2 || Number(item.visit_count_365d || 0) > 1 || Number(item.repeat_caller_score || 0) > 0, "Repeat caller item must have a repeat visit signal.");
  assert(String(item.reason_summary || "").length > 0, "Repeat caller item must explain why it is recommended.");
  assert(String(item.recommended_action || "").length > 0, "Repeat caller item must include a recommended action.");
}
for (const item of rows(intelligencePayloads.drydockPrediction)) {
  for (const field of ["vessel_display", "drydock_probability", "confidence_score", "reason_summary", "recommended_action"]) {
    assert(field in item, `Drydock prediction item missing required field: ${field}`);
  }
  assert(Number(item.drydock_probability || 0) >= 0 && Number(item.drydock_probability || 0) <= 100, "Drydock probability must be a 0-100 score.");
  assert(String(item.reason_summary || "").length > 0, "Drydock prediction item must explain why it is recommended.");
  assert(String(item.recommended_action || "").length > 0, "Drydock prediction item must include a recommended action.");
}
for (const item of rows(intelligencePayloads.customerMemory)) {
  for (const field of ["customer_name", "contact_attempts", "quote_history_count", "won_projects", "lost_projects", "customer_feedback_count", "fleet_history", "customer_memory_score", "reason_summary", "recommended_action"]) {
    assert(field in item, `Customer memory item missing required field: ${field}`);
  }
  assert(item.sensitive_details_exposed === false, "Customer memory must not expose sensitive contact or quote details.");
  assert(item.fleet_history && typeof item.fleet_history === "object", "Customer memory item must include fleet history summary.");
}
for (const item of rows(intelligencePayloads.fleetPenetration)) {
  for (const field of ["operator_name", "fleet_size_korea", "targeted_vessels", "contacted_vessels", "quoted_vessels", "won_vessels", "lost_vessels", "penetration_rate", "quote_rate", "win_rate", "opportunity_gap", "estimated_remaining_revenue", "reason_summary", "recommended_action", "recommended_next_action"]) {
    assert(field in item, `Fleet penetration item missing required field: ${field}`);
  }
  for (const field of ["fleet_size_korea", "targeted_vessels", "contacted_vessels", "quoted_vessels", "won_vessels", "lost_vessels", "opportunity_gap", "estimated_remaining_revenue"]) {
    assert(Number.isFinite(Number(item[field])) && Number(item[field]) >= 0, `Fleet penetration numeric field must be non-negative: ${field}`);
  }
  assert(Number(item.penetration_rate || 0) >= 0 && Number(item.penetration_rate || 0) <= 100, "Fleet penetration rate must be a 0-100 percentage.");
  assert(Number(item.quote_rate || 0) >= 0 && Number(item.quote_rate || 0) <= 100, "Fleet quote rate must be a 0-100 percentage.");
  assert(Number(item.win_rate || 0) >= 0 && Number(item.win_rate || 0) <= 100, "Fleet win rate must be a 0-100 percentage.");
}
for (const item of rows(intelligencePayloads.fleetExpansion)) {
  for (const field of ["operator_name", "known_korea_vessels", "total_operator_vessels", "high_opportunity_vessels", "unseen_vessels", "fleet_expansion_score", "recommended_action"]) {
    assert(field in item, `Fleet expansion item missing required field: ${field}`);
  }
}
for (const item of rows(intelligencePayloads.vesselTimeline)) {
  for (const field of ["vessel_display", "first_seen", "last_seen", "ports_visited", "visit_history", "risk_history", "opportunity_history"]) {
    assert(field in item, `Vessel timeline item missing required field: ${field}`);
  }
}
for (const item of rows(intelligencePayloads.koreaPresence)) {
  assert("korea_presence_score" in item, "Korea presence item missing korea_presence_score.");
  assert(Number(item.korea_presence_score || 0) >= 0 && Number(item.korea_presence_score || 0) <= 100, "Korea presence score must be 0-100.");
}
for (const item of rows(intelligencePayloads.fleetClusters)) {
  for (const field of ["operator_name", "vessel_count", "hot_count", "repeat_caller_count", "revenue_opportunity"]) {
    assert(field in item, `Fleet cluster item missing required field: ${field}`);
  }
}
for (const field of ["hot_count", "immediate_actions", "expected_revenue", "top_fleets", "top_ports", "compliance_opportunities", "warnings", "sections", "items"]) {
  assert(field in morningBrief, `Morning brief missing required field: ${field}`);
}
for (const section of ["executive_summary", "immediate_actions", "revenue", "top_fleets", "top_ports", "compliance_opportunities", "warnings"]) {
  assert(section in (morningBrief.sections || {}), `Morning brief missing section: ${section}`);
}
assert(Array.isArray(morningBrief.immediate_actions), "Morning brief immediate_actions must be an array.");
assert(Array.isArray(morningBrief.top_fleets), "Morning brief top_fleets must be an array.");
assert(Array.isArray(morningBrief.top_ports), "Morning brief top_ports must be an array.");
assert(Array.isArray(morningBrief.compliance_opportunities), "Morning brief compliance_opportunities must be an array.");
assert(Array.isArray(morningBrief.warnings), "Morning brief warnings must be an array.");
for (const section of ["executive_summary", "revenue_opportunities", "compliance_opportunities", "repeat_caller_insights", "fleet_expansion_opportunities", "risks"]) {
  assert(section in (executiveWeekly.sections || {}), `Executive weekly report missing section: ${section}`);
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
assert(topPayload.focus_question === "Which vessel should Korea Port Intelligence contact next and why?", "Top candidates must keep the sales-intelligence focus question.");
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
for (const [name, payload] of [
  ["vessels.json", readJson("dashboard/api/vessels.json")],
  ["all-collected-vessels.json", readJson("dashboard/api/all-collected-vessels.json")],
  ["target-vessels.json", readJson("dashboard/api/target-vessels.json")]
]) {
  assert(!Array.isArray(payload), `${name} must use an API envelope, not an array root.`);
  for (const field of ["serving_mode", "data_source_used", "fallback_used", "fallback_reason", "record_count"]) {
    assert(field in payload, `${name} missing API envelope field: ${field}`);
  }
  assert(["static_json", "worker_supabase", "local_diagnostics"].includes(payload.serving_mode), `${name} has invalid serving_mode: ${payload.serving_mode}`);
}
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
const identityResolutionIndex = updateSource.indexOf("resolveImoMmsiCandidates(cacheResult.records");
const scoringIndex = updateSource.indexOf("enrichSalesSignals(annotateRepeatCallerIntelligence(identityResolution.records))");
assert(
  enrichmentIndex >= 0 &&
    identityResolutionIndex > enrichmentIndex &&
    scoringIndex > identityResolutionIndex,
  "Enrichment and identity resolution must run before scoring."
);
assert(workerSource.includes("payload") && workerSource.includes("compact.vessel_display = vesselDisplay(merged)"), "Worker vessel pages must preserve enriched payload fields in vessel_display.");

for (const item of followups) {
  for (const field of ["vessel_name", "port", "reason", "recommended_message_angle", "urgency", "next_action"]) {
    assert(field in item, `Agent follow-up queue item missing field: ${field}`);
  }
}
assert(dashboardSource.includes("연락처 확인 필요"), "Dashboard must show contact verification section label.");
assert(publicSource.includes("연락처 확인 필요"), "Public dashboard must show contact verification section label.");
assert(dashboardSource.includes("/api/sales/verification-queue.json"), "Dashboard must prefer verification queue endpoint.");
assert(publicSource.includes("/api/sales/verification-queue.json"), "Public dashboard must prefer verification queue endpoint.");
for (const item of verificationQueue) {
  for (const field of ["rank", "vessel_display", "verification_type", "known_company", "missing_fields", "confidence_score", "priority_label", "reason_summary", "recommended_action", "source_names"]) {
    assert(field in item, `Verification queue item missing field: ${field}`);
  }
  assert(Array.isArray(item.missing_fields), "Verification queue missing_fields must be an array.");
  assert(item.missing_fields.length > 0, "Verification queue items must explain which contact fields are missing.");
  assert(["OPERATOR", "OWNER", "MANAGER", "LOCAL_AGENT", "CONTACT_PERSON"].includes(item.verification_type), `Invalid verification_type: ${item.verification_type}`);
}
assert(Array.isArray(targetCategoriesPayload.categories), "targets/categories.json must expose categories array.");
const categoryMap = new Map(targetCategoriesPayload.categories.map(category => [category.code, category]));
for (const code of ["CONTACT_NOW", "PRE_ARRIVAL", "ANCHORAGE_OPPORTUNITY", "LONG_STAY_RISK", "BIOFOULING_COMPLIANCE", "REPEAT_CALLER", "FLEET_EXPANSION", "VERIFY_CONTACT", "MONITOR", "HOLD"]) {
  assert(categoryMap.has(code), `targets/categories.json missing category: ${code}`);
}
for (const item of rows(readJson("dashboard/api/targets/current.json")).slice(0, 50)) {
  assert("primary_category" in item, "Target item must include primary_category.");
  assert(Array.isArray(item.target_categories), "Target item must include target_categories array.");
  assert(item.target_categories.length > 0, "Target item must have at least one target category.");
  assert(!(item.target_categories.some(category => category.code === "CONTACT_NOW") && item.target_categories.some(category => category.code === "HOLD")), "CONTACT_NOW and HOLD must not both apply.");
  for (const category of item.target_categories) {
    for (const field of ["code", "label", "confidence", "reason", "recommended_action"]) {
      assert(field in category, `Target category missing field: ${field}`);
    }
  }
}
const bootstrapKpis = bootstrap.kpis || {};
for (const key of ["contact_now_count", "pre_arrival_target_count", "anchorage_opportunity_count", "long_stay_risk_count", "compliance_target_count", "repeat_caller_count", "verify_contact_count", "monitor_count"]) {
  assert(key in bootstrapKpis, `bootstrap.kpis missing target category count: ${key}`);
}
const targetRowsForCategories = rows(readJson("dashboard/api/targets/current.json"));
const hotWithPort = targetRowsForCategories.some(item => String(item.priority_label || "").toUpperCase() === "HOT" && (item.port_name || item.port || item.current_port || item.anchorage_name));
if (hotWithPort) assert((categoryMap.get("CONTACT_NOW")?.count || 0) > 0, "HOT vessels with current port should produce CONTACT_NOW.");
const etaRows = targetRowsForCategories.some(item => (item.eta || item.etb || item.predicted_arrival_time) && !(item.ata || item.atb || item.berth_name || item.berth));
if (etaRows) assert((categoryMap.get("PRE_ARRIVAL")?.count || 0) > 0, "Vessels with ETA/ETB should produce PRE_ARRIVAL.");
const anchorageRows = targetRowsForCategories.some(item => item.is_anchorage_waiting || item.anchorage_name || Number(item.anchorage_hours || 0) > 0);
if (anchorageRows) assert((categoryMap.get("ANCHORAGE_OPPORTUNITY")?.count || 0) > 0, "Anchorage signals should produce ANCHORAGE_OPPORTUNITY.");
if (verificationQueue.length) assert((categoryMap.get("VERIFY_CONTACT")?.count || 0) > 0, "Missing operator/agent info on priority targets should produce VERIFY_CONTACT, not exclusion.");
assert(Array.isArray(rows(salesActionsPayload)), "sales/actions.json must expose action items.");
assert(Array.isArray(rows(quoteOpportunitiesPayload)), "sales/quote-opportunities.json must expose quote opportunity items.");
assert(quoteOpportunitiesPayload.disclaimer === "Estimated Opportunity Only", "Quote opportunities must be labeled as estimated opportunity only.");
const quoteRows = rows(quoteOpportunitiesPayload);
const hotTargetRows = rows(readJson("dashboard/api/targets/current.json")).filter(item => String(item.priority_label || item.sales_priority_band || item.vessel_display?.priority_label || "").toUpperCase() === "HOT" || Number(item.opportunity_score || item.vessel_display?.opportunity_score || 0) >= 75);
if (hotTargetRows.length) assert(quoteRows.length > 0, "HOT targets should produce quote opportunities.");
for (const item of quoteRows.slice(0, 20)) {
  for (const field of ["rank", "vessel_display", "quote_readiness_score", "quote_readiness_label", "recommended_services", "estimated_value_band", "missing_quote_fields", "quote_reason_summary", "recommended_next_action", "message_angle", "data_sources"]) {
    assert(field in item, `Quote opportunity item missing field: ${field}`);
  }
  assert(["READY", "NEEDS_INFO", "MONITOR"].includes(item.quote_readiness_label), `Invalid quote_readiness_label: ${item.quote_readiness_label}`);
  assert(Array.isArray(item.recommended_services), "Quote recommended_services must be an array.");
  assert(item.recommended_services.length > 0, "Quote recommended_services must not be empty.");
  assert(Array.isArray(item.missing_quote_fields), "Quote missing_quote_fields must be an array.");
  const band = item.estimated_value_band || {};
  for (const field of ["low", "mid", "high"]) {
    assert(Number.isFinite(Number(band[field])) && Number(band[field]) >= 0, `Quote estimated_value_band.${field} must be finite and non-negative.`);
  }
}
assert(dashboardSource.includes("/api/sales/quote-opportunities.json") && dashboardSource.includes("견적 기회 빌더"), "Dashboard must expose quote opportunity builder endpoint.");
assert(publicSource.includes("/api/sales/quote-opportunities.json") && publicSource.includes("견적 기회 빌더"), "Public dashboard must expose quote opportunity builder endpoint.");
assert(dashboardSource.includes("견적 정보 보기"), "Dashboard quote cards must expose expandable quote details.");
assert(dashboardSource.includes("영업 대상 카테고리") && dashboardSource.includes("/api/targets/categories.json"), "Dashboard must expose lazy-loaded target category UI.");
assert(publicSource.includes("영업 대상 카테고리") && publicSource.includes("/api/targets/categories.json"), "Public dashboard must expose lazy-loaded target category UI.");

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
  console.error("[Korea Port Intelligence] reliability test failures");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("[Korea Port Intelligence] reliability tests passed");
