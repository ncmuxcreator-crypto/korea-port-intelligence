import fs from "node:fs";

const vesselsPath = "dashboard/api/vessels.json";
const statusPath = "dashboard/api/status.json";
const outputPath = "dashboard/api/readiness-gate-runtime.json";

function readJson(path, fallback) {
  try {
    return fs.existsSync(path) ? JSON.parse(fs.readFileSync(path, "utf8")) : fallback;
  } catch {
    return fallback;
  }
}

const status = readJson(statusPath, {});
const data = readJson(vesselsPath, []);
const previous = readJson(outputPath, null);
const vessels = Array.isArray(data) ? data : (data.vessels || data.items || data.data || []);
const statusRunId = status.run_id || status.active_run_id || status.summary_run_id || null;
const vesselRunIds = [...new Set(vessels.map(v => v.run_id).filter(Boolean))];
const inferredRunId = vesselRunIds.length === 1 ? vesselRunIds[0] : statusRunId;
const staleReadinessGate = Boolean(statusRunId && inferredRunId && String(statusRunId) !== String(inferredRunId));
const previousStale = Boolean(previous?.run_id && statusRunId && String(previous.run_id) !== String(statusRunId));

const report = {
  version: "17.7.0",
  run_id: statusRunId,
  status_run_id: statusRunId,
  vessels_run_id: inferredRunId,
  previous_readiness_run_id: previous?.run_id || null,
  generated_at: new Date().toISOString(),
  status_generated_at: status.completed_at || status.generated_at || null,
  total: vessels.length,
  salesReady: vessels.filter(v => v.commercial_use_status === "sales_review_ready").length,
  blockedSample: vessels.filter(v => v.commercial_use_status === "do_not_use_for_outreach").length,
  sampleImmediateBlocked: vessels.filter(v => v.commercial_use_status === "do_not_use_for_outreach" && v.is_immediate_candidate).length,
  operatingImmediate: vessels.filter(v => v.is_operating_immediate_candidate).length,
  stale_readiness_gate: staleReadinessGate || previousStale,
  stale_reasons: [
    staleReadinessGate ? "vessels.json run_id does not match status.json run_id" : null,
    previousStale ? "previous readiness-gate-runtime.json run_id does not match current status.json run_id" : null
  ].filter(Boolean),
  ok: !staleReadinessGate && vessels.every(v => !String(v.source_mode || "").includes("sample") || v.commercial_use_status === "do_not_use_for_outreach"),
  note: "This gate is generated for the current status.json run_id and must not be reused across active_run_id changes."
};

fs.mkdirSync("dashboard/api", { recursive: true });
fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));

if (report.stale_readiness_gate) {
  console.error("Readiness gate is stale for the current dataset", report);
  process.exit(1);
}

console.log("Readiness gate generated");
