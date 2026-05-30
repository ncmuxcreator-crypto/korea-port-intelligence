import fs from "node:fs";

const vesselsPath = "dashboard/api/vessels.json";
const statusPath = "dashboard/api/status.json";
const outputPaths = [
  "dashboard/api/readiness-gate.json",
  "dashboard/api/readiness-gate-runtime.json"
];

function readJson(path, fallback) {
  try {
    return fs.existsSync(path) ? JSON.parse(fs.readFileSync(path, "utf8")) : fallback;
  } catch {
    return fallback;
  }
}

const status = readJson(statusPath, {});
const data = readJson(vesselsPath, []);
const previousReports = outputPaths.map(path => readJson(path, null)).filter(Boolean);
const vessels = Array.isArray(data) ? data : (data.vessels || data.items || data.data || []);
const statusRunId = status.run_id || status.active_run_id || status.summary_run_id || null;
const vesselRunIds = [...new Set(vessels.map(v => v.run_id).filter(Boolean))];
const inferredRunId = vesselRunIds.length === 1 ? vesselRunIds[0] : statusRunId;
const staleReadinessGate = Boolean(statusRunId && inferredRunId && String(statusRunId) !== String(inferredRunId));
const stalePreviousReports = previousReports.filter(previous => previous?.run_id && statusRunId && String(previous.run_id) !== String(statusRunId));
const previousStale = stalePreviousReports.length > 0;
const validationMode = String(process.env.VALIDATION_MODE || (process.env.CI === "true" ? "production" : "local")).toLowerCase();
const dataMode = String(status.data_mode || status.data_mode_detail?.mode || "").toLowerCase();
const emptyDataset = vessels.length === 0 || Number(status.record_count || 0) === 0;
const noLiveData = dataMode === "no_live_data";
const productionReady = !staleReadinessGate && !previousStale && !emptyDataset && !noLiveData;

const report = {
  version: "17.7.0",
  run_id: statusRunId,
  status_run_id: statusRunId,
  vessels_run_id: inferredRunId,
  active_run_id: statusRunId,
  previous_readiness_run_id: previousReports[0]?.run_id || null,
  previous_readiness_run_ids: [...new Set(previousReports.map(previous => previous.run_id).filter(Boolean))],
  generated_at: new Date().toISOString(),
  status_generated_at: status.completed_at || status.generated_at || null,
  total: vessels.length,
  salesReady: vessels.filter(v => v.commercial_use_status === "sales_review_ready").length,
  blockedSample: vessels.filter(v => v.commercial_use_status === "do_not_use_for_outreach").length,
  sampleImmediateBlocked: vessels.filter(v => v.commercial_use_status === "do_not_use_for_outreach" && v.is_immediate_candidate).length,
  operatingImmediate: vessels.filter(v => v.is_operating_immediate_candidate).length,
  readiness_status: emptyDataset || noLiveData ? "empty_dataset" : staleReadinessGate || previousStale ? "stale" : "ready",
  data_mode: status.data_mode || null,
  record_count: Number(status.record_count || 0),
  production_ready: productionReady,
  validation_mode: validationMode,
  stale_readiness_gate: staleReadinessGate || previousStale,
  stale_reasons: [
    staleReadinessGate ? "vessels.json run_id does not match status.json run_id" : null,
    previousStale ? "previous readiness gate run_id does not match current status.json run_id" : null
  ].filter(Boolean),
  status_run_id_match: !staleReadinessGate,
  ok: productionReady && vessels.every(v => !String(v.source_mode || "").includes("sample") || v.commercial_use_status === "do_not_use_for_outreach"),
  note: "This gate is generated for the current status.json run_id and must not be reused across active_run_id changes."
};

fs.mkdirSync("dashboard/api", { recursive: true });
for (const outputPath of outputPaths) {
  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
}

if (report.stale_readiness_gate || (validationMode === "production" && !report.ok)) {
  console.error("Readiness gate is stale for the current dataset", report);
  process.exit(1);
}

console.log("Readiness gate generated");
