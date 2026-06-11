import fs from "fs";
import {
  buildOceanIntelligenceLayer,
  buildOceanRiskGeoJson,
  calculateOceanRiskScore,
  oceanRiskLabelKo
} from "../src/lib/oceanIntelligence.js";

const failures = [];
const validationMode = String(process.env.VALIDATION_MODE || (process.env.CI === "true" ? "production" : "local")).toLowerCase();

function readJson(path, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

function rows(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.vessels)) return payload.vessels;
  if (Array.isArray(payload?.candidates)) return payload.candidates;
  return [];
}

function fail(message) {
  failures.push(message);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

const oceanRiskFixture = calculateOceanRiskScore(
  { stay_hours: 96, anchorage_hours: 48, destination: "Australia" },
  { port_code: "BUSAN", sst_c: 24.6, sst_anomaly_c: 2.1, marine_heatwave_level: "HIGH" }
);
assert(oceanRiskFixture.biofouling_risk_score >= 0 && oceanRiskFixture.biofouling_risk_score <= 100, "Ocean biofouling risk score must stay within 0-100.");
assert(oceanRiskLabelKo(85) === "매우 높음", "Ocean risk Korean label mapping must include VERY HIGH.");
const oceanFallbackLayer = await buildOceanIntelligenceLayer({
  records: [{ vessel_name: "TEST OCEAN", port_code: "BUSAN", stay_hours: 96 }],
  generatedAt: "2026-06-10T00:00:00.000Z",
  dataMode: "test"
});
const oceanFallbackGeoJson = buildOceanRiskGeoJson(oceanFallbackLayer);
assert(oceanFallbackLayer.port_ocean_conditions.length >= 12, "Ocean fallback must cover major Korean ports.");
assert(oceanFallbackGeoJson.type === "FeatureCollection", "Ocean risk output must be GeoJSON FeatureCollection.");
assert(oceanFallbackGeoJson.features.every(feature => Number(feature.properties?.biofouling_risk_score) >= 0 && Number(feature.properties?.biofouling_risk_score) <= 100), "Ocean GeoJSON scores must be 0-100.");

function hasWarning(payload, pattern) {
  const text = JSON.stringify(payload || {});
  return pattern.test(text);
}

function classifyPersistenceState(payload = {}) {
  const write = payload.supabase_write || payload.storage_status?.supabase || {};
  const verification = write.post_write_verification || {};
  const writeStatus = String(write.status || "").toLowerCase();
  if (!["completed", "synced"].includes(writeStatus)) return "db_write_failed";
  if (verification.status && verification.status !== "completed") return "post_write_verification_failed";
  if ((verification.promotion_errors || []).includes("active_dataset_pointer_run_id_mismatch")) return "active_dataset_pointer_not_updated";
  if ((verification.promotion_errors || []).includes("active_dataset_pointer_not_promoted") || write.promoted === false) return "promotion_blocked";
  return "ok";
}

const fixtureFiles = [
  "tests/fixtures/port-operation-sample.json",
  "tests/fixtures/pilot-schedule-sample.json",
  "tests/fixtures/pnc-berth-sample.html",
  "tests/fixtures/ulsan-berth-cargo-sample.json"
];

for (const file of fixtureFiles) {
  assert(fs.existsSync(file), `Missing regression fixture: ${file}`);
}

const portOperationFixture = readJson("tests/fixtures/port-operation-sample.json", {});
assert(rows(portOperationFixture).length >= 2, "Port Operation fixture must include I/O rows for dedupe testing.");

const status = readJson("dashboard/api/status.json", {});
const report = readJson("data/pipeline-report.json", {});
const summary = readJson("dashboard/api/dashboard-summary.json", {});
const allVesselsPayload = readJson("dashboard/api/all-collected-vessels.json", []);
const targetVesselsPayload = readJson("dashboard/api/target-vessels.json", []);
const vesselsPayload = readJson("dashboard/api/vessels.json", []);
const backendDoctor = readJson("dashboard/api/backend-doctor.json", {});
const workerSource = fs.readFileSync("src/worker.js", "utf8");
const dbSource = fs.readFileSync("scripts/lib/db.js", "utf8");
const updateSource = fs.readFileSync("scripts/update.js", "utf8");
const auditNormalizeSource = fs.readFileSync("scripts/audit-normalize.js", "utf8");
const dashboardSource = fs.readFileSync("dashboard/index.html", "utf8");
const publicDashboardSource = fs.readFileSync("public/index.html", "utf8");

const allVessels = rows(allVesselsPayload);
const targetVessels = rows(targetVesselsPayload);
const vessels = rows(vesselsPayload);
const dataMode = String(status.data_mode || report.data_mode || "");
const recordCount = Number(status.record_count || report.record_count || 0);
const allVesselsCount = Number(
  status.all_vessels_count ||
  report.all_collected_vessel_count ||
  report.all_vessels_count ||
  summary.all_vessels_count ||
  allVessels.length ||
  0
);

for (const file of [
  "dashboard/api/staying-vessels.json",
  "dashboard/api/arrival-pipeline.json",
  "dashboard/api/congestion-watchlist.json",
  "dashboard/api/agent-followup-queue.json"
]) {
  assert(fs.existsSync(file), `Missing required API output file: ${file}`);
}

assert(
  dashboardSource.includes("function getLastUpdatedAt(payload)") &&
    dashboardSource.includes("LAST_UPDATED_FALLBACK_TEXT") &&
    dashboardSource.includes("최근 갱신 시간 확인 불가") &&
    dashboardSource.includes("setTimeout(()=>{if(!currentLastUpdatedAt())setLastUpdatedBadge()},5000)") &&
    dashboardSource.includes("AbortController") &&
    dashboardSource.includes('api("summary","/api/dashboard-summary.json",4500)') &&
    dashboardSource.includes('api("health","/api/health/pipeline.json",3000)'),
  "Dashboard must normalize last-updated fields, timeout slow APIs, and render summary before optional panels."
);
assert(
  dashboardSource.includes("function resolveKpiValue") &&
    dashboardSource.includes("[KPI DEBUG]") &&
    dashboardSource.includes("확인 불가") &&
    dashboardSource.includes("isValidKpiValue"),
  "Dashboard KPI cards must resolve missing numeric fields without infinite skeleton loading."
);
assert(
  dashboardSource.includes("function getHotCandidates") &&
    dashboardSource.includes("hotIdentityKey") &&
    dashboardSource.includes("compareHotRows"),
  "HOT candidate cards must dedupe repeated vessel identities and use fixed score sorting."
);
assert(
  dashboardSource.includes("subSum>total") &&
    dashboardSource.includes("서브항 일부 표시") &&
    publicDashboardSource.includes("서브항 일부 표시"),
  "Port cards must not report partial sub-port breakdowns as total-count mismatches."
);
assert(
  dashboardSource.includes("기준 충족 없음") &&
    publicDashboardSource.includes("기준 충족 없음"),
  "Immediate-target KPI must clearly indicate when no vessel meets the current threshold."
);
assert(
  dashboardSource.includes("PORT_NAME_KO") &&
    dashboardSource.includes("localizePortName") &&
    publicDashboardSource.includes("PORT_NAME_KO"),
  "Dashboard must localize common English port names before rendering cards and lists."
);
assert(
  publicDashboardSource.includes("function getLastUpdatedAt(payload)") &&
    publicDashboardSource.includes("최근 갱신 시간 확인 불가") &&
    publicDashboardSource.includes("AbortController") &&
    publicDashboardSource.includes("function resolveKpiValue") &&
    publicDashboardSource.includes("function getHotCandidates"),
  "Deployed public dashboard must include the same last-updated fallback logic as dashboard/index.html."
);
assert(
  updateSource.includes('"dashboard/api/health.json"') &&
    updateSource.includes("last_success_at: completedAt") &&
    updateSource.includes("last_success_at: report?.last_success_at || completedAt"),
  "Update output must expose generated_at/last_success_at for status, dashboard-summary, and health payloads."
);

assert(
  !workerSource.includes("promoted.error"),
  "Worker fallback must not reference undefined promoted.error."
);
assert(
  workerSource.includes('active.error || latestRun.error || legacy.error || "missing_active_dataset"'),
  "Worker missing-active fallback must resolve without throwing ReferenceError."
);
for (const marker of ["active_dataset_pointer", "latest_completed_real_run", "latest_snapshot_run", "legacy_latest_snapshots", "missing_active_dataset"]) {
  assert(workerSource.includes(marker), `Worker fallback regression missing marker: ${marker}`);
}
assert(
  dbSource.indexOf('.upsert(summarySnapshot, { onConflict: "snapshot_id" })') <
    dbSource.indexOf('.update({ is_latest_successful: false })'),
  "dashboard_summary_snapshots must write new summary before clearing previous latest pointer."
);
assert(
  dbSource.includes('.select("snapshot_id,run_id,record_count,all_vessels_count,is_latest_successful")') &&
    dbSource.includes("Dashboard summary snapshot verification failed after write.") &&
    dbSource.includes('.neq("snapshot_id", summarySnapshot.snapshot_id)') &&
    dbSource.includes('.update({ is_latest_successful: true })'),
  "dashboard_summary_snapshots latest pointer update must verify current snapshot before replacing previous latest."
);
assert(
  dbSource.includes("function ensureCandidateFunnelRanks") &&
    dbSource.includes("buildCandidateFunnelDiagnostics(records") &&
    dbSource.includes("candidate_funnel_diagnostics") &&
    dbSource.includes("records_missing_rank_before") &&
    dbSource.includes("withinCommercialPercentile(record, 20)") &&
    dbSource.indexOf("ensureCandidateFunnelRanks(records)") < dbSource.indexOf("shouldPromoteRun(records, diagnostics)"),
  "Candidate DB materialization must diagnose the funnel and repair missing rank/percentile fields before filtering current candidates."
);
assert(
  auditNormalizeSource.includes("vessels_with_port") &&
    auditNormalizeSource.includes("vessels_with_imo_mmsi") &&
    auditNormalizeSource.includes("vessels_with_stay_duration") &&
    auditNormalizeSource.includes("vessels_with_opportunity_score") &&
    auditNormalizeSource.includes("vessels_passing_hot_threshold") &&
    auditNormalizeSource.includes("vessels_passing_warm_threshold") &&
    auditNormalizeSource.includes("global_percentile exists OR port_percentile exists"),
  "Normalization audit must show candidate funnel counts and the exact rank/percentile filter that can remove all candidates."
);

if (dataMode !== "no_live_data" && recordCount > 0) {
  assert(allVesselsCount > 0, "all_vessels_count must be > 0 after successful collection.");
  assert(allVessels.length > 0 || vessels.length > 0, "Static all/vessel output must contain rows after successful collection.");
  const portCallCoverage = allVessels.length
    ? allVessels.filter(row => row.port_call_id).length / allVessels.length
    : 0;
  assert(portCallCoverage > 0.8, "port_call_id coverage must be > 80% after successful collection.");
}

const portCallIds = allVessels.map(row => row.port_call_id).filter(Boolean);
const duplicatePortCallIds = portCallIds.filter((id, index) => portCallIds.indexOf(id) !== index);
assert(duplicatePortCallIds.length === 0, `Duplicate port_call_id detected: ${[...new Set(duplicatePortCallIds)].slice(0, 5).join(", ")}`);

const targetRatio = Number(
  status.target_ratio ||
  report.target_ratio ||
  report.scoring_diagnostics?.target_ratio ||
  summary.target_ratio ||
  0
);
const targetRatioFraction = targetRatio > 1 ? targetRatio / 100 : targetRatio;
if (targetRatioFraction > 0.3) {
  assert(
    hasWarning(status, /영업대상 기준이 너무 넓습니다|target qualification.*broad|target_ratio_too_high/i) ||
    hasWarning(report, /영업대상 기준이 너무 넓습니다|target qualification.*broad|target_ratio_too_high/i) ||
    hasWarning(summary, /영업대상 기준이 너무 넓습니다|target qualification.*broad|target_ratio_too_high/i),
    "target_ratio > 30% must emit a warning."
  );
}

const summaryTargetCount = Number(
  summary.target_vessels_count ||
  summary.sales_target_count ||
  status.target_vessels_count ||
  status.sales_target_count ||
  0
);
const tableTargetCount = Number(targetVessels.length || vessels.length || 0);
if (summaryTargetCount > 0) {
  assert(tableTargetCount > 0, "Summary reports target vessels but target table/static output is empty.");
  assert(
    tableTargetCount === summaryTargetCount,
    `Summary target count must match target-vessels output count. summary=${summaryTargetCount}, table=${tableTargetCount}`
  );
}

if (dataMode === "no_live_data") {
  assert(
    status.production_ready === false ||
    report.production_ready === false ||
    status.data_status === "empty_dataset" ||
    report.data_status === "empty_dataset" ||
    report.last_successful_dataset_lock?.locked === true,
    "no_live_data must not be treated as production-ready."
  );
}

assert(
  classifyPersistenceState({
    supabase_write: {
      status: "failed",
      post_write_verification: { status: "failed", errors: ["db_write_failed"] }
    }
  }) === "db_write_failed",
  "Regression: real rows collected but Supabase write fails must classify as db_write_failed."
);

assert(
  classifyPersistenceState({
    supabase_write: {
      status: "completed",
      promoted: false,
      post_write_verification: {
        status: "completed",
        promotion_errors: ["active_dataset_pointer_not_promoted"]
      }
    }
  }) === "promotion_blocked",
  "Regression: successful DB write with blocked promotion must classify as promotion_blocked."
);

assert(
  classifyPersistenceState({
    supabase_write: {
      status: "completed",
      promoted: true,
      post_write_verification: {
        status: "completed",
        promotion_errors: ["active_dataset_pointer_run_id_mismatch"]
      }
    }
  }) === "active_dataset_pointer_not_updated",
  "Regression: active_dataset_pointer mismatch must classify as active_dataset_pointer_not_updated."
);

if (status.supabase_write?.status === "completed" && status.supabase_write?.promoted === false) {
  assert(
    ["promotion_blocked", "active_dataset_pointer_not_updated"].includes(status.supabase_write_failure_type || classifyPersistenceState(status)),
    "Completed Supabase write without promotion must not be reported as db_write_failed."
  );
}

if (Number(backendDoctor.record_count || 0) === 0 || backendDoctor.data_status === "empty_dataset") {
  assert(
    backendDoctor.ok === false && backendDoctor.production_ready === false,
    "backend-doctor must fail empty datasets."
  );
}

const baseDatasetEmpty = Number(status.all_collected_vessel_count || status.all_vessels_count || status.record_count || 0) === 0 ||
  ["no_live_data", "degraded_sample_only"].includes(dataMode);
if (baseDatasetEmpty) {
  for (const file of [
    "dashboard/api/backend-doctor.json",
    "dashboard/api/readiness-gate.json",
    "dashboard/api/snapshot-guard.json",
    "dashboard/api/source-health-runtime.json",
    "dashboard/api/collector-plan-runtime.json",
    "dashboard/api/quality/dataset-generation-audit.json"
  ]) {
    if (!fs.existsSync(file)) continue;
    const payload = readJson(file, {});
    const localLegacyDiagnostics = validationMode === "local" && dataMode === "no_live_data";
    if (!localLegacyDiagnostics) {
      assert(payload.base_dataset_empty === true, `${file} must mark base_dataset_empty=true.`);
      assert(payload.derived_from_empty_dataset === true, `${file} must mark derived_from_empty_dataset=true.`);
      assert(payload.ok !== true, `${file} must not return ok=true when source vessel dataset is empty.`);
    }
  }
}

const migrationFiles = fs.existsSync("migrations")
  ? fs.readdirSync("migrations").filter(file => /\.sql$/i.test(file))
  : [];
assert(migrationFiles.length > 0, "Schema changes must have versioned migration files in migrations/.");

const contractDoc = fs.existsSync("docs/data-contract.md") ? fs.readFileSync("docs/data-contract.md", "utf8") : "";
for (const marker of ["run_id", "generated_at", "data_source_used", "port_call_id", "master_vessel_id", "port_code", "candidate_band", "commercial_value_score"]) {
  assert(contractDoc.includes(marker), `Data contract missing required marker: ${marker}`);
}

if (failures.length) {
  console.error("[HWK] regression failures");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("[HWK] regression tests passed");
