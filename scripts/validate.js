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
  "dashboard/api/all-collected-vessels.json",
  "dashboard/api/target-vessels.json",
  "dashboard/api/staying-vessels.json",
  "dashboard/api/arrival-pipeline.json",
  "dashboard/api/imo-recovery-queue.json",
  "dashboard/api/imo-recovery-priority.json",
  "dashboard/api/high-value-targets.json",
  "dashboard/api/unknown-gt-review.json",
  "dashboard/api/high-value-low-confidence.json",
  "dashboard/api/congestion-watchlist.json",
  "dashboard/api/agent-followup-queue.json",
  "dashboard/api/quality/basic-info-coverage.json",
  "dashboard/api/review/basic-info-missing.json",
  "dashboard/api/candidate-summary.json",
  "dashboard/api/contact-queue.json",
  "dashboard/api/hot-candidates.json",
  "dashboard/api/ports.json",
  "dashboard/api/coverage-registry.json",
  "dashboard/api/backend-ops.json",
  "dashboard/api/candidate-changes.json",
  ".github/workflows/longterm-update.yml",
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
  for (const field of ["stay_hours", "current_call_stay_hours", "cumulative_stay_hours", "cumulative_stay_days", "berth_hours", "anchorage_hours", "work_window_hours", "biofouling_score", "cii_pressure_score", "total_sales_priority_score", "reason_codes"]) {
    if (!(field in item)) {
      throw new Error(`Missing intelligence field ${field} for ${item.vessel_name || item.vessel_id}`);
    }
  }
  for (const field of ["hybrid_entity_key", "identification_method", "imo_status", "gt_group", "stay_days_group"]) {
    if (!(field in item)) {
      throw new Error(`Missing commercial command-center field ${field} for ${item.vessel_name || item.vessel_id}`);
    }
  }
  for (const field of ["master_vessel_id", "normalized_vessel_name", "identity_match_strategy", "identity_confidence", "identity_confidence_band"]) {
    if (!(field in item)) {
      throw new Error(`Missing vessel identity resolution field ${field} for ${item.vessel_name || item.vessel_id}`);
    }
  }
  for (const field of ["commercial_gt_threshold", "meets_commercial_gt_threshold"]) {
    if (!(field in item)) {
      throw new Error(`Missing commercial GT field ${field} for ${item.vessel_name || item.vessel_id}`);
    }
  }
  for (const field of ["grtg", "intrlGrtg", "gt_source", "gt_status", "status_bucket", "commercial_relevance_status"]) {
    if (!(field in item)) {
      throw new Error(`Missing commercial visibility field ${field} for ${item.vessel_name || item.vessel_id}`);
    }
  }
  for (const field of ["vessel_type_group", "commercial_signal_flags", "commercial_signal_strength", "imo_recovery_score", "imo_recovery_priority"]) {
    if (!(field in item)) {
      throw new Error(`Missing commercial enrichment field ${field} for ${item.vessel_name || item.vessel_id}`);
    }
  }
  for (const field of ["commercial_value_score", "commercial_value_band", "data_confidence_score", "data_confidence_band", "vessel_value_score", "sales_accessibility_score"]) {
    if (!(field in item)) {
      throw new Error(`Missing commercial value field ${field} for ${item.vessel_name || item.vessel_id}`);
    }
  }
  for (const field of ["operator_normalized", "agent_normalized", "destination_port", "vessel_basic_info_completeness_score", "vessel_basic_info_missing_fields", "vessel_spec_enrichment_priority"]) {
    if (!(field in item)) {
      throw new Error(`Missing basic vessel information field ${field} for ${item.vessel_name || item.vessel_id}`);
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

if (["sample_only", "degraded_sample_only"].includes(report.data_mode)) {
  throw new Error("Sample/demo data modes are not allowed in generated outputs");
}
if (report.data_mode === "no_live_data" && (report.record_count !== 0 || report.actionable_rows !== 0 || report?.candidate_ops?.current_candidate_count !== 0)) {
  throw new Error("No-live-data mode must expose zero vessels, zero actionable rows, and zero candidates");
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
if (status.collector_diagnostics?.fallback_used && (status.data_mode !== "no_live_data" || status.status !== "degraded_sample_only")) {
  throw new Error("Collector fallback must publish no_live_data with degraded_sample_only status");
}
for (const forbidden of ["MV HF ZHOUSHAN", "MAERSK DEMO", "YEOSU TARGET", "integrated_vts_sample", "sample_snapshot"]) {
  const haystack = [
    JSON.stringify(vessels),
    fs.existsSync("dashboard/api/status.json") ? fs.readFileSync("dashboard/api/status.json", "utf8") : ""
  ].join("\n");
  if (haystack.includes(forbidden)) throw new Error(`Forbidden sample/demo vessel marker found: ${forbidden}`);
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
const longtermJobTimeouts = workflow.match(/^\s{4}timeout-minutes:\s*30\s*$/gm) || [];
if (!longtermJobTimeouts.length) {
  throw new Error("Longterm workflow job timeout must be 30 minutes");
}
if (!workflow.includes("MAX_CHILD_ENRICHMENT_ROWS") || !workflow.includes("MAX_SOURCE_ROWS") || !workflow.includes("MAX_OUTPUT_ROWS: 10000") || !workflow.includes("MAX_SOURCE_ROWS: 5000") || !workflow.includes("MAX_TARGET_VESSELS: 5000") || !workflow.includes("MAX_CANDIDATES: 1000") || !workflow.includes("MAX_CHILD_ENRICHMENT_ROWS: 24") || !workflow.includes("PORT_OPERATION_NUM_OF_ROWS: 50") || !workflow.includes("PORT_OPERATION_MAX_PAGES: 20") || !workflow.includes('PORT_OPERATION_DEGB_VALUES: "I,O"') || !workflow.includes("ENABLE_SOURCE_CSV") || !workflow.includes("COLLECTOR_DEBUG_VERBOSE") || workflow.includes("COLLECTOR_DEBUG_ONLY: port_operation_busan") || !workflow.includes("SOURCE_TIMEOUT_MS: 30000") || !workflow.includes("COLLECTOR_RUNTIME_BUDGET_MS: 720000") || !workflow.includes("timeout-minutes: 20")) {
  throw new Error("Longterm workflow must bound collector runtime and child enrichment");
}
for (const marker of ["github.run_id", "github.ref", "runner.os", "github.workflow", "timestamp=$(date -u"]) {
  if (!workflow.includes(marker)) throw new Error(`Missing workflow start diagnostic: ${marker}`);
}
if (!workflow.includes("SOURCE_CSV_URL") || !workflow.includes("ULSAN_BERTH_DETAIL_API_KEY") || workflow.includes("YGPA_ARRIVAL_API_KEY") || workflow.includes("YGPA_SERVICE_KEY")) {
  throw new Error("Workflow public API secret coverage is incomplete");
}
const koreaCollector = fs.readFileSync("scripts/collectors/korea.js", "utf8");
const sampleCollectorBlockers = [
  /MV HF ZHOUSHAN/.test(koreaCollector) ? "MV HF ZHOUSHAN marker in scripts/collectors/korea.js" : null,
  /MAERSK DEMO/.test(koreaCollector) ? "MAERSK DEMO marker in scripts/collectors/korea.js" : null,
  /YEOSU TARGET/.test(koreaCollector) ? "YEOSU TARGET marker in scripts/collectors/korea.js" : null,
  /function sampleRows/.test(koreaCollector) ? "function sampleRows in scripts/collectors/korea.js" : null,
  fs.existsSync("scripts/collectors/sample.js") ? "scripts/collectors/sample.js still exists" : null,
  fs.existsSync("scripts/collectors/busan.js") ? "scripts/collectors/busan.js still exists" : null
].filter(Boolean);
if (sampleCollectorBlockers.length) {
  throw new Error(`Sample/demo collectors and fallback vessels must be removed: ${sampleCollectorBlockers.join("; ")}`);
}
if (!koreaCollector.includes("VsslEtrynd5/Info5") || !koreaCollector.includes("CargHarborUse2/Info")) {
  throw new Error("Collector must use VsslEtrynd5 parent records and CargHarborUse2 enrichment endpoint");
}
if (!koreaCollector.includes("PORT_OPERATION_API_URL") || !koreaCollector.includes("PORT_FACILITY_API_URL")) {
  throw new Error("Collector must allow env overrides for PORT_OPERATION_API_URL and PORT_FACILITY_API_URL");
}
for (const envMarker of ["PORT_OPERATION_API_KEY", "SERVICEKEY", "runtimeEnvDiagnostics", "COLLECTOR_DEBUG_ONLY"]) {
  if (!koreaCollector.includes(envMarker)) throw new Error(`Collector must debug env naming mismatch: ${envMarker}`);
}
if (/key:\s*["']port_facility["']/.test(koreaCollector)) {
  throw new Error("CargHarborUse2 must not be used as a standalone port_facility collector");
}
if (!koreaCollector.includes("prtAgCd") || !koreaCollector.includes("etryptYear") || !koreaCollector.includes("etryptCo") || !koreaCollector.includes("clsgn")) {
  throw new Error("CargHarborUse2 enrichment must use prtAgCd, etryptYear, etryptCo and clsgn parent keys");
}
for (const portCode of ["020", "030", "620", "820", "031", "810", "622", "070", "080", "621", "120", "940"]) {
  if (!koreaCollector.includes(`"${portCode}"`)) throw new Error(`Missing Korean port authority code: ${portCode}`);
}
for (const param of ["sde", "ede", "deGb", "numOfRows", "requested_url_without_service_key", "resultCode", "resultMsg", "totalCount", "http_status", "pages_attempted", "page_summaries"]) {
  if (!koreaCollector.includes(param)) throw new Error(`Missing PORT-MIS request/diagnostic field: ${param}`);
}
for (const param of ["raw_response_preview", "service_key_variant", "serviceKeyVariants", "COLLECTOR_DEBUG_VERBOSE"]) {
  if (!koreaCollector.includes(param)) throw new Error(`Missing PORT-MIS debug field: ${param}`);
}
if (!koreaCollector.includes("MAX_CHILD_ENRICHMENT_ROWS") || !koreaCollector.includes("skipped_by_limit")) {
  throw new Error("CargHarborUse2 enrichment must be bounded to keep update runtime under control");
}
if (!koreaCollector.includes("MAX_SOURCE_ROWS") || !koreaCollector.includes("COLLECTOR_RUNTIME_BUDGET_MS") || !koreaCollector.includes("ENABLE_SOURCE_CSV")) {
  throw new Error("Collector must bound per-source rows, runtime, and optional CSV ingestion");
}
if (!koreaCollector.includes("PORT_OPERATION_NUM_OF_ROWS") || !koreaCollector.includes('"50"') || !koreaCollector.includes("PORT_OPERATION_MAX_PAGES") || !koreaCollector.includes("PORT_OPERATION_DEGB_VALUES") || !koreaCollector.includes("addDaysCompact(-3)") || !koreaCollector.includes("addDaysCompact(7)") || !koreaCollector.includes("grtg") || !koreaCollector.includes("intrlGrtg")) {
  throw new Error("Port Operation collector must support official-safe 50-row paging");
}
if (!koreaCollector.includes("noTypeParam")) {
  throw new Error("PORT-MIS XML-capable APIs must not force _type=json");
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
if (!workflow.includes("./api.cloudflare-upload-skip") || workflow.includes("dashboard/api.cloudflare-upload-skip")) {
  throw new Error("Cloudflare deploy must skip generated dashboard/api JSON assets");
}
const assetsIgnore = fs.existsSync(".assetsignore") ? fs.readFileSync(".assetsignore", "utf8") : "";
if (!assetsIgnore.includes("dashboard/api/**") || !assetsIgnore.includes("api/**")) {
  throw new Error("Cloudflare assets ignore must exclude generated API JSON files");
}

const wrangler = JSON.parse(fs.readFileSync("wrangler.jsonc", "utf8"));
if (wrangler.assets?.directory !== "./dashboard" || wrangler.assets?.binding !== "ASSETS") {
  throw new Error("Cloudflare Workers assets must point to ./dashboard with ASSETS binding");
}
if (!Array.isArray(wrangler.assets?.run_worker_first) || !wrangler.assets.run_worker_first.includes("/api/*")) {
  throw new Error("Cloudflare Worker must run before static assets for /api/* routes");
}
const worker = fs.readFileSync("src/worker.js", "utf8");
if (!worker.includes("vessel_snapshots") || !worker.includes("SUPABASE_URL") || !worker.includes("env.ASSETS.fetch")) {
  throw new Error("Worker must serve dashboard assets and live Supabase API routes");
}
if (!worker.includes("cumulative_stay_hours") || !worker.includes("CUMULATIVE_STAY_90D_PLUS")) {
  throw new Error("Worker must preserve cumulative stay beyond short port-call windows");
}
for (const route of ["/dashboard-summary.json", "/api/vessels/", "pageRows", "/candidates/top.json", "/ports.json", "/candidates.json", "/hot-candidates.json", "/target-vessels.json", "/staying-vessels.json", "/arrival-pipeline.json", "/predicted-arrivals.json", "/lead-pipeline.json", "/alert-candidates.json", "/imo-recovery-queue.json", "/high-value-targets.json", "/review/unknown-gt.json", "/review/high-value-low-confidence.json", "/review/congestion-watchlist.json", "target-vessels|staying-vessels|arrivals", "/api/ports/", "congestion", "anchorage", "/master/unknown-imo.json", "active_dataset_pointer"]) {
  if (!worker.includes(route)) throw new Error(`Worker missing port-first API route marker: ${route}`);
}
const referenceDictionaries = fs.readFileSync("scripts/lib/reference-dictionaries.js", "utf8");
for (const marker of ["classifyAnchorage", "classifyBerth", "normalizeVesselType", "\\uB0A8\\uC678\\uD56D", "ANCH", "O A", "bulk_carrier", "pctc", "vesselMasterSeed", "berthAliases", "terminalAliases"]) {
  if (!referenceDictionaries.includes(marker)) throw new Error(`Reference dictionary enrichment missing marker: ${marker}`);
}
const gdriveLib = fs.readFileSync("scripts/lib/gdrive.js", "utf8");
if (!gdriveLib.includes("supportsAllDrives=true") || !gdriveLib.includes("normalizeFolderId") || !gdriveLib.includes("Buffer.from(value, \"base64\")")) {
  throw new Error("Google Drive archive helper must support shared drives, folder URLs, and base64 service account secrets");
}
const dbLib = fs.readFileSync("scripts/lib/db.js", "utf8");
if (!dbLib.includes("SUPABASE_BATCH_SIZE") || !dbLib.includes("batchSize")) {
  throw new Error("Supabase writes must be batched to avoid long single upserts");
}
if (!dbLib.includes('.from("vessel_snapshots")') || !dbLib.includes(".insert(batch)") || dbLib.includes("onConflict: \"snapshot_date,vessel_id,port\"")) {
  throw new Error("Supabase vessel_snapshots must be append-only, not latest-state upsert only");
}
if (!dbLib.includes('.from("vessel_entities")') || !dbLib.includes('.from("risk_history")') || !dbLib.includes('.from("vessel_events")') || !dbLib.includes('.from("data_collection_runs")') || !dbLib.includes('.from("active_dataset_pointer")') || !dbLib.includes('.from("enrichment_match_candidates")') || !dbLib.includes('.from("commercial_leads")')) {
  throw new Error("Supabase persistence must update collection runs, active pointer, vessel_entities, risk_history, and vessel_events");
}
const schema = fs.readFileSync("supabase/schema.sql", "utf8");
for (const marker of ["data_collection_runs", "active_dataset_pointer", "vessel_master", "vessel_aliases", "vessel_identity_candidates", "vessel_entities", "vessel_events", "risk_history", "port_congestion_snapshots", "anchorage_clusters", "berth_occupancy_history", "route_patterns", "vessel_route_history", "predicted_arrivals", "enrichment_match_candidates", "commercial_leads", "operator_master", "agent_master", "contact_master", "operator_contact_history", "operator_fleet_opportunities", "agent_operator_links", "berth_aliases", "terminal_aliases", "payload jsonb", "hybrid_entity_key", "run_id", "master_vessel_id", "commercial_value_score", "data_confidence_score", "lead_status", "auto_lead_created", "lead_created_reason", "contact_path_status", "contact_priority", "contact_path_label_ko", "contact_readiness_score", "last_contacted_at", "follow_up_due", "quote_status", "notes", "lead_priority_score", "why_now", "candidate_summary_ko", "recommended_action", "action_priority", "recommended_contact_path", "recommended_department", "recommended_email_draft", "recommended_followup_date", "prediction_error_hours", "alert_candidate", "predicted_congestion_score", "anchorage_probability", "predicted_work_window_hours", "biofouling_exposure_score", "biofouling_exposure_band", "biofouling_exposure_reasons", "predicted_cleaning_opportunity_score", "cleaning_opportunity_band", "opportunity_summary", "repeat_caller_score", "repeat_operator_score", "fleet_opportunity_score", "fleet_cleaning_probability", "fleet_cleaning_probability_band", "forecast_window_days", "fleet_alert", "average_biofouling_exposure", "average_congestion_exposure", "target_vessels_count", "validation_status", "drop constraint if exists vessel_snapshots_snapshot_date_vessel_id_port_key"]) {
  if (!schema.includes(marker)) throw new Error(`Supabase schema missing historical persistence marker: ${marker}`);
}
for (const file of ["data/reference/ports.csv", "data/reference/berths.csv", "data/reference/berth_aliases.csv", "data/reference/terminal_aliases.csv", "data/reference/anchorages.csv", "data/reference/vessel_types.csv", "data/reference/operators.csv", "data/reference/agents.csv", "data/reference/agent_operator_mapping.csv", "data/reference/vessel_master_seed.csv"]) {
  if (!fs.existsSync(file)) throw new Error(`Missing CSV reference dictionary: ${file}`);
}
const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));
if (packageJson.scripts?.["gdrive:check"] && !fs.existsSync("scripts/gdrive-check.js")) {
  throw new Error("Google Drive check script is registered but scripts/gdrive-check.js is missing");
}
const healthWorkflow = fs.readFileSync(".github/workflows/actions-health-check.yml", "utf8");
if (!healthWorkflow.includes("runs-on: ubuntu-latest") || !healthWorkflow.includes("workflow_dispatch") || !healthWorkflow.includes("timeout-minutes: 3")) {
  throw new Error("Actions health-check workflow is incomplete");
}
const pushSmokeWorkflow = fs.readFileSync(".github/workflows/push-smoke-test.yml", "utf8");
if (!pushSmokeWorkflow.includes("name: Push Smoke Test") || !pushSmokeWorkflow.includes("push:") || !pushSmokeWorkflow.includes("runs-on: ubuntu-latest")) {
  throw new Error("Push smoke test workflow is incomplete");
}

console.log("[HWK] validation success");
