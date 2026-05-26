import fs from "fs";

const required = [
  "data/latest-lite.json",
  "data/pipeline-report.json",
  "dashboard/api/vessels.json",
  "dashboard/api/status.json",
  "dashboard/index.html",
  "dashboard/api/hot-vessels.json",
  "dashboard/api/commercial-command-center.json",
  "dashboard/api/port-congestion-heatmap.json",
  "dashboard/api/biofouling-timeline.json",
  "dashboard/api/candidates.json",
  "dashboard/api/backend-ops.json",
  "dashboard/api/candidate-changes.json",
  ".github/workflows/longterm-update.yml",
  ".github/workflows/longterm-update-v2.yml",
  ".github/workflows/actions-health-check.yml",
  ".github/workflows/push-smoke-test.yml",
  "wrangler.jsonc",
  "src/worker.js"
];

for (const file of required) {
  if (!fs.existsSync(file)) {
    throw new Error(`Missing required output: ${file}`);
  }
}

const data = JSON.parse(fs.readFileSync("data/latest-lite.json", "utf8"));
const report = JSON.parse(fs.readFileSync("data/pipeline-report.json", "utf8"));
const vessels = JSON.parse(fs.readFileSync("dashboard/api/vessels.json", "utf8"));

if (!Array.isArray(data)) {
  throw new Error("Invalid latest-lite.json");
}

if (!report.status || typeof report.record_count !== "number") {
  throw new Error("Invalid pipeline-report.json");
}

for (const item of data) {
  if (!item.vessel_id || !item.vessel_name || !item.port) {
    throw new Error("Missing required vessel fields");
  }
  for (const field of ["eta", "etb", "ata", "atb", "etd", "atd"]) {
    if (!(field in item)) {
      throw new Error(`Missing schedule field ${field} for ${item.vessel_name || item.vessel_id}`);
    }
  }
  for (const field of ["stay_hours", "berth_hours", "anchorage_hours", "work_window_hours", "biofouling_score", "cii_pressure_score", "total_sales_priority_score", "reason_codes"]) {
    if (!(field in item)) {
      throw new Error(`Missing intelligence field ${field} for ${item.vessel_name || item.vessel_id}`);
    }
  }
  for (const field of ["hybrid_entity_key", "identification_method", "imo_status", "gt_group", "stay_days_group"]) {
    if (!(field in item)) {
      throw new Error(`Missing commercial command-center field ${field} for ${item.vessel_name || item.vessel_id}`);
    }
  }
}

const priorityPorts = report?.data_strategy?.priority_ports || [];
const requiredPriorityPorts = ["Busan", "Yeosu/Gwangyang", "Ulsan", "Pyeongtaek-Dangjin", "Hadong/Samcheonpo", "Pohang"];
for (const port of requiredPriorityPorts) {
  if (!priorityPorts.includes(port)) {
    throw new Error(`Missing priority port in data strategy: ${port}`);
  }
}

if (!String(report?.data_strategy?.vts_architecture || "").includes("Integrated VTS")) {
  throw new Error("VTS architecture must be integrated/national, not Yeosu-only");
}

if (report.data_mode === "sample_only" && report?.candidate_ops?.current_candidate_count !== 0) {
  throw new Error("Sample-only mode must not expose operating candidates");
}

for (const vessel of vessels) {
  const isSample = String(vessel.source_mode || "").includes("sample");
  if (isSample && vessel.commercial_use_status !== "do_not_use_for_outreach") {
    throw new Error(`Sample vessel is not blocked from outreach: ${vessel.vessel_name || vessel.vessel_id}`);
  }
  if (isSample && (vessel.is_operating_candidate || vessel.is_operating_immediate_candidate)) {
    throw new Error(`Sample vessel is exposed as operating candidate: ${vessel.vessel_name || vessel.vessel_id}`);
  }
}



const status = JSON.parse(fs.readFileSync("dashboard/api/status.json", "utf8"));
if (!status.candidate_ops || !status.backend_health || !status.seven_pack_summary) {
  throw new Error("Missing stability bundle outputs");
}
if (!status.backend_stability_batch || !status.runtime_budget || !status.master_db_roadmap) {
  throw new Error("Missing v17.7 backend stability batch outputs");
}
if (!status.collector_diagnostics || typeof status.collector_diagnostics.attempted_count !== "number") {
  throw new Error("Missing collector diagnostics");
}
if (!status.commercial_command_center || !Array.isArray(status.port_congestion_heatmap) || !Array.isArray(status.biofouling_timeline)) {
  throw new Error("Missing commercial command-center frontend outputs");
}
if (typeof status.actionable_rows !== "number" || typeof status.collector_diagnostics?.actionable_row_count !== "number") {
  throw new Error("Missing actionable_rows collector metric");
}

const workflow = fs.readFileSync(".github/workflows/longterm-update.yml", "utf8");
if (!/on:\s*[\s\S]*workflow_dispatch:/.test(workflow) || !/schedule:/.test(workflow)) {
  throw new Error("Workflow trigger configuration is incomplete");
}
if (!workflow.includes("runs-on: ubuntu-latest") || workflow.includes("runs-on: self-hosted")) {
  throw new Error("Longterm workflow must use ubuntu-latest and must not use self-hosted runners");
}
if (!workflow.includes("group: ${{ github.workflow }}-${{ github.ref }}") || !workflow.includes("cancel-in-progress: true")) {
  throw new Error("Longterm workflow concurrency must be isolated by workflow and ref");
}
if (!workflow.includes("timeout-minutes: 12")) {
  throw new Error("Longterm workflow job timeout must be 12 minutes");
}
for (const marker of ["github.run_id", "github.ref", "runner.os", "github.workflow", "timestamp=$(date -u"]) {
  if (!workflow.includes(marker)) throw new Error(`Missing workflow start diagnostic: ${marker}`);
}
if (!workflow.includes("SOURCE_CSV_URL") || !workflow.includes("ULSAN_BERTH_DETAIL_API_KEY") || workflow.includes("YGPA_ARRIVAL_API_KEY") || workflow.includes("YGPA_SERVICE_KEY")) {
  throw new Error("Workflow public API secret coverage is incomplete");
}
const koreaCollector = fs.readFileSync("scripts/collectors/korea.js", "utf8");
if (!koreaCollector.includes("VsslEtrynd5/Info5") || !koreaCollector.includes("CargHarborUse2/Info")) {
  throw new Error("Collector must use VsslEtrynd5 parent records and CargHarborUse2 enrichment endpoint");
}
if (/key:\s*["']port_facility["']/.test(koreaCollector)) {
  throw new Error("CargHarborUse2 must not be used as a standalone port_facility collector");
}
if (!koreaCollector.includes("prtAgCd") || !koreaCollector.includes("etryptYear") || !koreaCollector.includes("etryptCo") || !koreaCollector.includes("clsgn")) {
  throw new Error("CargHarborUse2 enrichment must use prtAgCd, etryptYear, etryptCo and clsgn parent keys");
}
const secretsFile = fs.readFileSync("scripts/lib/secrets.js", "utf8");
if (!secretsFile.includes("SOURCE_CSV_URL") || /YGPA_|ygpa/.test(secretsFile)) {
  throw new Error("Secret catalog must include SOURCE_CSV_URL and ignore YGPA-specific sources");
}
if (/git push origin HEAD:main|git commit -m "auto: refresh/.test(workflow)) {
  throw new Error("Longterm workflow must not auto-commit generated files to main");
}
if (!workflow.includes("npx wrangler deploy") || !workflow.includes("CLOUDFLARE_API_TOKEN") || !workflow.includes("CLOUDFLARE_ACCOUNT_ID")) {
  throw new Error("Workflow must deploy the Cloudflare Worker with Cloudflare GitHub secrets");
}

const wrangler = JSON.parse(fs.readFileSync("wrangler.jsonc", "utf8"));
if (wrangler.assets?.directory !== "./dashboard" || wrangler.assets?.binding !== "ASSETS") {
  throw new Error("Cloudflare Workers assets must point to ./dashboard with ASSETS binding");
}
const worker = fs.readFileSync("src/worker.js", "utf8");
if (!worker.includes("vessel_snapshots") || !worker.includes("SUPABASE_URL") || !worker.includes("env.ASSETS.fetch")) {
  throw new Error("Worker must serve dashboard assets and live Supabase API routes");
}
const healthWorkflow = fs.readFileSync(".github/workflows/actions-health-check.yml", "utf8");
if (!healthWorkflow.includes("runs-on: ubuntu-latest") || !healthWorkflow.includes("workflow_dispatch") || !healthWorkflow.includes("timeout-minutes: 3")) {
  throw new Error("Actions health-check workflow is incomplete");
}
const pushSmokeWorkflow = fs.readFileSync(".github/workflows/push-smoke-test.yml", "utf8");
if (!pushSmokeWorkflow.includes("name: Push Smoke Test") || !pushSmokeWorkflow.includes("push:") || !pushSmokeWorkflow.includes("runs-on: ubuntu-latest")) {
  throw new Error("Push smoke test workflow is incomplete");
}
const workflowV2 = fs.readFileSync(".github/workflows/longterm-update-v2.yml", "utf8");
if (!workflowV2.includes("name: Longterm Update V2") || !workflowV2.includes("runs-on: ubuntu-latest") || !workflowV2.includes("group: ${{ github.workflow }}-${{ github.ref }}")) {
  throw new Error("Longterm Update V2 bypass workflow is incomplete");
}
if (!workflowV2.includes("push:") || !workflowV2.includes("branches:") || !workflowV2.includes("- main")) {
  throw new Error("Longterm Update V2 must support push-triggered bypass runs on main");
}
if (/paths:|paths-ignore:/.test(workflowV2)) {
  throw new Error("Longterm Update V2 push bypass must not use path filters");
}
if (/git push origin HEAD:main|git commit -m "auto: refresh|runs-on: self-hosted/.test(workflowV2)) {
  throw new Error("Longterm Update V2 must not use self-hosted runners or auto-commit generated files");
}
if (!workflowV2.includes("continue-on-error: true") || !workflowV2.includes("Skip Cloudflare deploy notice")) {
  throw new Error("Longterm Update V2 must keep bypass diagnostics running even when optional checks fail");
}

console.log("[HWK] validation success");
