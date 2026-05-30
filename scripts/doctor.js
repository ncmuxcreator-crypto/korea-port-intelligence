import fs from "node:fs";

const requiredFiles = [
  "package.json",
  ".github/workflows/longterm-update.yml",
  "dashboard/api/status.json",
  "dashboard/api/vessels.json",
  "dashboard/api/candidates.json",
  "dashboard/api/candidate-summary.json",
  "dashboard/api/coverage-registry.json"
];

const requiredSecrets = [
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "MOF_AIS_DYNAMIC_API_URL",
  "MOF_AIS_DYNAMIC_SERVICE_KEY",
  "MOF_VTS_API_BASE",
  "MOF_VTS_SERVICE_KEY",
  "VESSEL_SPEC_SERVICE_KEY",
  "PORT_OPERATION_SERVICE_KEY"
];

function readJson(path, fallback) {
  try {
    return fs.existsSync(path) ? JSON.parse(fs.readFileSync(path, "utf8")) : fallback;
  } catch (error) {
    return { __read_error: error?.message || String(error) };
  }
}

function rowsFromJson(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.data)) return value.data;
  if (Array.isArray(value?.items)) return value.items;
  if (Array.isArray(value?.vessels)) return value.vessels;
  if (Array.isArray(value?.candidates)) return value.candidates;
  return [];
}

const status = readJson("dashboard/api/status.json", {});
const vesselsPayload = readJson("dashboard/api/vessels.json", []);
const candidatesPayload = readJson("dashboard/api/candidates.json", []);
const candidateSummary = readJson("dashboard/api/candidate-summary.json", {});
const vessels = rowsFromJson(vesselsPayload);
const candidates = rowsFromJson(candidatesPayload);
const recordCount = Number(status.record_count || vessels.length || 0);
const candidateCount = Number(candidateSummary.candidate_count || candidateSummary.current_candidate_count || candidates.length || 0);
const files = {};
let filesExist = true;

for (const file of requiredFiles) {
  const exists = fs.existsSync(file);
  files[file] = exists ? "ok" : "missing";
  if (!exists) filesExist = false;
}

const filesHaveRows = vessels.length > 0 && recordCount > 0;
const dataMode = status.data_mode || "unknown";
const dataStatus = filesHaveRows ? "ready" : "empty_dataset";
const productionReady = filesExist &&
  filesHaveRows &&
  recordCount > 0 &&
  !["no_live_data", "degraded_sample_only", "sample_only"].includes(dataMode);

const report = {
  ok: productionReady,
  checked_at: new Date().toISOString(),
  files_exist: filesExist,
  files_have_rows: filesHaveRows,
  record_count: recordCount,
  vessel_rows: vessels.length,
  candidate_count: candidateCount,
  candidate_rows: candidates.length,
  data_mode: dataMode,
  data_status: dataStatus,
  production_ready: productionReady,
  files,
  secrets: Object.fromEntries(requiredSecrets.map(secret => [secret, process.env[secret] ? "configured" : "missing_or_not_in_ci"])),
  notes: [
    filesHaveRows ? "Vessel rows are present." : "vessels.json/status.json indicate an empty dataset.",
    productionReady ? "Backend static outputs look production-ready." : "Backend is not production-ready from static JSON outputs. Use Worker/Supabase active dataset if available."
  ],
  failure_reasons: [
    !filesExist ? "required_files_missing" : null,
    !filesHaveRows ? "empty_dataset" : null,
    recordCount === 0 ? "status_record_count_zero" : null,
    ["no_live_data", "degraded_sample_only", "sample_only"].includes(dataMode) ? `data_mode_${dataMode}` : null
  ].filter(Boolean)
};

fs.mkdirSync("dashboard/api", { recursive: true });
fs.writeFileSync("dashboard/api/backend-doctor.json", JSON.stringify(report, null, 2));

if (!report.ok) {
  console.error("Backend doctor failed", report);
  process.exit(1);
}

console.log("Backend doctor passed");
