import fs from "fs";

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
  "dashboard/api/sales-pipeline.json",
  "dashboard/api/history/vessel-visits.json"
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
  "데이터 묶음 승격 상태",
  "대체 데이터 사용 여부",
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
const salesPipeline = readJson("dashboard/api/sales-pipeline.json");
const vesselVisits = readJson("dashboard/api/history/vessel-visits.json");
const report = readJson("dashboard/api/reports/daily-summary.json");
const packageJson = readJson("package.json");
const dashboardSource = readText("dashboard/index.html");
const publicSource = readText("public/index.html");
const dashboardMainSource = readText("dashboard/app/dashboard-main.js");
const workerSource = readText("src/worker.js");
const dbSource = readText("scripts/lib/db.js");
const retentionSource = readText("scripts/lib/db/retention.js");
const auditDataSource = readText("scripts/audit-data-health.js");
const schemaSource = readText("supabase/schema.sql");

for (const scriptName of ["update", "validate", "audit:data", "health", "build", "test", "test:reliability"]) {
  assert(packageJson.scripts?.[scriptName], `package.json missing required script: ${scriptName}`);
}

for (const requiredPath of ["wrangler.jsonc", "src/worker.js"]) {
  assert(fs.existsSync(requiredPath), `Required Cloudflare Worker file missing: ${requiredPath}`);
}

for (const [name, payload] of Object.entries({ summary, status, health, pipelineHealth, continuity })) {
  assert(payload && typeof payload === "object", `${name} payload must be an object.`);
  assert("generated_at" in payload || name === "continuity", `${name} must expose generated_at or runtime context.`);
}

for (const file of [
  "dashboard/api/dashboard-summary.json",
  "dashboard/api/status.json",
  "dashboard/api/health.json",
  "dashboard/api/candidates/top.json",
  "dashboard/api/staying-vessels.json",
  "dashboard/api/arrival-pipeline.json",
  "dashboard/api/congestion-watchlist.json",
  "dashboard/api/agent-followup-queue.json",
  "dashboard/api/sales-pipeline.json",
  "dashboard/api/alerts/latest.json"
]) {
  const payload = readJson(file);
  for (const field of ["generated_at", "data_mode", "schema_version", "source_status", "fallback_used", "record_count"]) {
    assert(field in payload, `${file} missing dashboard API contract field: ${field}`);
  }
}

const countFields = [
  summary.all_vessels_count,
  summary.record_count,
  summary.total_vessels,
  summary.sales_target_count,
  summary.immediate_target_count,
  summary.port_count,
  status.record_count,
  status.all_vessels_count,
  report.kpis?.total_vessels
].filter(value => value !== undefined && value !== null);
for (const value of countFields) {
  assert(numberOrNull(value) !== null, `KPI/count field must resolve to a number: ${value}`);
}

for (const field of ["record_count", "all_vessels_count", "total_vessels", "sales_target_count", "immediate_target_count", "port_count"]) {
  assert(field in summary, `dashboard-summary.json missing stable numeric field: ${field}`);
  assert(numberOrNull(summary[field]) !== null, `dashboard-summary.json field must be numeric: ${field}`);
}
for (const field of ["data_mode", "generated_at"]) {
  assert(field in summary, `dashboard-summary.json missing stable top-level field: ${field}`);
}

const recordCount = numberOrNull(summary.all_vessels_count ?? status.all_vessels_count ?? status.record_count) ?? 0;
const dataMode = String(status.data_mode || summary.data_mode || "");
if (recordCount > 0) {
  assert(!/sample/i.test(dataMode), "Real record_count > 0 must not be reported as sample mode.");
}

for (const label of HEALTH_LABELS) {
  assert(dashboardSource.includes(label) || readText("dashboard/app/data-health-renderer.js").includes(label), `Dashboard health panel missing label: ${label}`);
  assert(publicSource.includes(label) || readText("public/app/data-health-renderer.js").includes(label), `Public dashboard health panel missing label: ${label}`);
}
assert(dashboardSource.includes("AbortController") || readText("dashboard/app/api-client.js").includes("AbortController"), "Dashboard fetches must use AbortController to avoid infinite loading.");
assert(dashboardSource.includes("확인 불가") || readText("dashboard/app/utils.js").includes("확인 불가"), "Dashboard must render 확인 불가 for missing values.");
assert(readText("dashboard/app/utils.js").includes("isKnownNumber") && readText("dashboard/app/utils.js").includes("toLocaleString"), "Dashboard numeric formatter must distinguish missing values from valid zero.");
assert(dashboardSource.includes("setTimeout") || dashboardMainSource.includes("setTimeout"), "Dashboard must have a bounded loading fallback.");

for (const modulePath of ["dashboard/app/api-client.js", "dashboard/app/kpi-resolver.js", "dashboard/app/data-health-renderer.js", "dashboard/app/candidate-table-renderer.js", "dashboard/app/utils.js"]) {
  assert(fs.existsSync(modulePath), `Dashboard architecture module missing: ${modulePath}`);
}
for (const modulePath of ["scripts/lib/db/client.js", "scripts/lib/db/runs.js", "scripts/lib/db/promotion.js", "scripts/lib/db/summary-snapshot.js", "scripts/lib/db/retention.js", "scripts/lib/db/verification.js"]) {
  assert(fs.existsSync(modulePath), `DB architecture module missing: ${modulePath}`);
}

for (const marker of [
  "portRunSnapshotDays",
  "portRunSnapshotKeepRuns",
  "opportunityScoreDays",
  "candidateHistoryDays",
  "salesPipelineDays",
  "portDailySummaryDays",
  "portWeeklySummaryDays",
  "portMonthlySummaryDays",
  "DB_RETENTION_PORT_RUN_SNAPSHOT_DAYS",
  "DB_RETENTION_PORT_RUN_SNAPSHOT_KEEP_RUNS"
]) {
  assert(retentionSource.includes(marker), `Retention policy missing marker: ${marker}`);
}

for (const table of ["port_daily_summary", "port_weekly_summary", "port_monthly_summary"]) {
  assert(schemaSource.includes(`create table if not exists ${table}`), `Schema missing port rollup table: ${table}`);
  assert(dbSource.includes(table), `DB persistence/cleanup missing port rollup table: ${table}`);
}

const runScopedBlock = dbSource.match(/const runScopedBulkyTables = \[([\s\S]*?)\];/)?.[1] || "";
for (const table of ["vessel_snapshot_daily", "port_call_master", "commercial_opportunity_daily", "commercial_leads", "risk_history"]) {
  assert(!runScopedBlock.includes(`"${table}"`), `Vessel intelligence history table must not be pruned by run-id only: ${table}`);
}
assert(dbSource.includes("deleteOldPortRunSnapshots"), "Port detail cleanup must use a dedicated port snapshot retention policy.");
assert(dbSource.includes("port_snapshot_keep_run_ids"), "Port snapshot cleanup must preserve active/latest successful run ids.");
assert(dbSource.includes("compacted_then_pruned"), "Old detailed port snapshots must be compacted before deletion.");
assert(dbSource.includes("port_summary_rollup_status"), "Port snapshots must be converted into daily/weekly/monthly summaries before cleanup.");
assert(workerSource.includes("portHistoryTable") && workerSource.includes("port_daily_summary"), "Dashboard port history must render from port_daily_summary after detailed cleanup.");
for (const marker of ["port_snapshot_count", "oldest_port_snapshot", "newest_port_snapshot", "vessel_history_count", "candidate_history_count", "cleanup_candidates"]) {
  assert(auditDataSource.includes(marker), `audit:data missing retention audit output: ${marker}`);
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
assert(topPayload.focus_question === "Which vessel should we contact next, and why?", "Top candidates must keep the generalized sales-intelligence focus question.");
assert(topPayload.ranking_model === "commercial_opportunity_v1" || opportunities.length === 0, "Top candidates must expose commercial_opportunity_v1 ranking model when candidates exist.");
assertSortedDescending(opportunities, "opportunity_score", "Top candidates");
for (const [index, candidate] of opportunities.slice(0, 10).entries()) {
  assert(candidate.rank === index + 1, "Top 10 candidate ranks must start at 1 and increment by 1.");
  for (const field of ["vessel_id", "vessel_name", "normalized_vessel_name", "port", "vessel_type", "opportunity_score", "priority_label", "score_factors", "reason_summary", "recommended_action", "confidence_score", "confidence_label"]) {
    assert(field in candidate, `Top candidate missing required field: ${field}`);
  }
  assert(["HOT", "WARM", "LOW"].includes(candidate.priority_label), `Invalid priority_label: ${candidate.priority_label}`);
  assert(numberOrNull(candidate.confidence_score) !== null && candidate.confidence_score >= 0 && candidate.confidence_score <= 100, "Candidate confidence_score must be a finite number between 0 and 100.");
  assert(["HIGH", "MEDIUM", "LOW"].includes(candidate.confidence_label), `Invalid confidence_label: ${candidate.confidence_label}`);
  if (candidate.priority_label === "HOT") {
    assert(candidate.score_factors.length >= 2, "HOT candidate must have at least 2 score_factors.");
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

for (const item of followups) {
  for (const field of ["vessel_name", "port", "reason", "recommended_message_angle", "urgency", "next_action"]) {
    assert(field in item, `Agent follow-up queue item missing field: ${field}`);
  }
}

const alertRows = rows(alerts.alerts || alerts);
assert("alert_count" in alerts, "Latest alerts payload must expose alert_count.");
for (const alert of alertRows) {
  for (const field of ["alert_id", "alert_type", "severity", "created_at", "dedupe_key", "recommended_action"]) {
    assert(field in alert, `Alert missing field: ${field}`);
  }
  assert(["INFO", "WARNING", "CRITICAL"].includes(alert.severity), `Invalid alert severity: ${alert.severity}`);
}
const alertKeys = alertRows.map(alert => alert.dedupe_key).filter(Boolean);
assert(alertKeys.length === new Set(alertKeys).size, "Alert keys must be unique to avoid spam.");

const pipelineRows = rows(salesPipeline);
const hotIds = new Set(opportunities.filter(candidate => candidate.priority_label === "HOT").map(candidate => candidate.vessel_id));
for (const item of pipelineRows) {
  for (const field of ["vessel_id", "vessel_name", "opportunity_score", "priority_label", "pipeline_stage", "recommended_next_action", "contact_status"]) {
    assert(field in item, `Sales pipeline item missing field: ${field}`);
  }
  assert(["NEW_HOT", "CONTACT_PLANNED", "CONTACTED", "QUOTE_SENT", "FOLLOW_UP", "WON", "LOST", "ARCHIVED"].includes(item.pipeline_stage), `Invalid pipeline stage: ${item.pipeline_stage}`);
  hotIds.delete(item.vessel_id);
}
assert(hotIds.size === 0, "Every HOT candidate must appear in sales-pipeline.json.");

for (const visit of rows(vesselVisits)) {
  for (const field of ["vessel_id", "vessel_name", "port", "first_seen_at", "last_seen_at", "stay_hours", "source_names", "opportunity_score_at_visit", "confidence_score"]) {
    assert(field in visit, `Vessel visit missing field: ${field}`);
  }
  assert(numberOrNull(visit.stay_hours) !== null, "Vessel visit stay_hours must be numeric.");
}

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
