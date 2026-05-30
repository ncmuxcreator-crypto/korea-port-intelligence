import fs from "fs";

const failures = [];

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

function hasWarning(payload, pattern) {
  const text = JSON.stringify(payload || {});
  return pattern.test(text);
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
if (targetRatio > 0.3) {
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

if (Number(backendDoctor.record_count || 0) === 0 || backendDoctor.data_status === "empty_dataset") {
  assert(
    backendDoctor.ok === false && backendDoctor.production_ready === false,
    "backend-doctor must fail empty datasets."
  );
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
