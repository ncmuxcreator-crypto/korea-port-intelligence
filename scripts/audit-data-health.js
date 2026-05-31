import fs from "fs";
import { retentionCutoff, retentionPolicyFromEnv } from "./lib/db/retention.js";

const REQUIRED_OUTPUTS = [
  "dashboard/api/status.json",
  "dashboard/api/dashboard-summary.json",
  "dashboard/api/vessels.json",
  "dashboard/api/all-collected-vessels.json",
  "dashboard/api/target-vessels.json",
  "dashboard/api/staying-vessels.json",
  "dashboard/api/arrival-pipeline.json",
  "dashboard/api/congestion-watchlist.json",
  "dashboard/api/agent-followup-queue.json"
];

const COUNT_TABLES = [
  "vessel_snapshots",
  "port_call_master",
  "dashboard_summary_snapshots",
  "data_collection_runs",
  "port_snapshot_daily",
  "port_daily_summary",
  "port_weekly_summary",
  "port_monthly_summary",
  "vessel_snapshot_daily",
  "commercial_opportunity_daily",
  "sales_candidates_current",
  "commercial_leads",
  "active_dataset_pointer"
];

function readJson(path, fallback = null) {
  try {
    return fs.existsSync(path) ? JSON.parse(fs.readFileSync(path, "utf8")) : fallback;
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

function staticOutput(path) {
  const debugPath = path.replace("dashboard/api/", "dashboard/api/debug/");
  return fs.existsSync(path) ? path : fs.existsSync(debugPath) ? debugPath : path;
}

function supabaseConfig() {
  const url = String(process.env.SUPABASE_URL || "").replace(/\/+$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || "";
  return url && key ? { url, key } : null;
}

async function supabaseGet(path) {
  const config = supabaseConfig();
  if (!config) return { ok: false, rows: [], error: "missing_supabase_config", status: 0 };
  try {
    const response = await fetch(`${config.url}${path}`, {
      headers: {
        apikey: config.key,
        authorization: `Bearer ${config.key}`,
        accept: "application/json",
        prefer: "count=exact"
      }
    });
    const text = await response.text();
    let rowsPayload = [];
    try {
      rowsPayload = text ? JSON.parse(text) : [];
    } catch {
      rowsPayload = [];
    }
    const contentRange = response.headers.get("content-range") || "";
    const count = contentRange.includes("/") ? Number(contentRange.split("/").pop()) : Array.isArray(rowsPayload) ? rowsPayload.length : 0;
    return {
      ok: response.ok,
      status: response.status,
      rows: Array.isArray(rowsPayload) ? rowsPayload : [],
      count: Number.isFinite(count) ? count : 0,
      error: response.ok ? null : `supabase_http_${response.status}`
    };
  } catch (error) {
    return { ok: false, rows: [], count: 0, status: 0, error: error?.message || String(error) };
  }
}

async function main() {
  const retention = retentionPolicyFromEnv();
  const status = readJson(staticOutput("dashboard/api/status.json"), {});
  const summary = readJson(staticOutput("dashboard/api/dashboard-summary.json"), {});
  const staticVessels = rows(readJson(staticOutput("dashboard/api/all-collected-vessels.json"), []));
  const missingOutputFiles = REQUIRED_OUTPUTS.filter(file => !fs.existsSync(file) && !fs.existsSync(file.replace("dashboard/api/", "dashboard/api/debug/")));

  const activePointer = await supabaseGet("/rest/v1/active_dataset_pointer?select=*&id=eq.current&limit=1");
  const latestCompletedRun = await supabaseGet("/rest/v1/data_collection_runs?select=run_id,status,finished_at,promoted_at,total_rows,raw_collected_rows,normalized_rows,all_vessels_count,target_vessels_count&status=in.(completed,promoted)&or=(all_vessels_count.gt.0,total_rows.gt.0,raw_collected_rows.gt.0,normalized_rows.gt.0)&order=finished_at.desc.nullslast&order=promoted_at.desc.nullslast&limit=1");
  const latestRun = await supabaseGet("/rest/v1/data_collection_runs?select=run_id,status,finished_at,promoted_at,total_rows,raw_collected_rows,normalized_rows,all_vessels_count,target_vessels_count&order=finished_at.desc.nullslast&limit=1");

  const activeRunId = activePointer.rows[0]?.active_run_id || null;
  let activeRows = { ok: false, count: 0, rows: [], error: activeRunId ? null : "missing_active_run_id" };
  if (activeRunId) {
    activeRows = await supabaseGet(`/rest/v1/vessel_snapshots?select=run_id&run_id=eq.${encodeURIComponent(activeRunId)}&limit=1`);
  }

  const latestCompletedRunId = latestCompletedRun.rows[0]?.run_id || null;
  let latestCompletedRows = { ok: false, count: 0, rows: [], error: latestCompletedRunId ? null : "missing_latest_completed_run_id" };
  if (latestCompletedRunId) {
    latestCompletedRows = await supabaseGet(`/rest/v1/vessel_snapshots?select=run_id&run_id=eq.${encodeURIComponent(latestCompletedRunId)}&limit=1`);
  }

  const tableCounts = {};
  for (const table of COUNT_TABLES) {
    const response = await supabaseGet(`/rest/v1/${table}?select=*&limit=1`);
    tableCounts[table] = {
      ok: response.ok,
      count: response.count,
      error: response.error
    };
  }

  const portSnapshotOldest = await supabaseGet("/rest/v1/port_snapshot_daily?select=snapshot_date,run_id,port_code,sub_port&order=snapshot_date.asc&limit=1");
  const portSnapshotNewest = await supabaseGet("/rest/v1/port_snapshot_daily?select=snapshot_date,run_id,port_code,sub_port&order=snapshot_date.desc&limit=1");
  const portSnapshotCleanupCandidates = await supabaseGet(`/rest/v1/port_snapshot_daily?select=run_id,snapshot_date&snapshot_date=lt.${retentionCutoff(retention.portRunSnapshotDays, true)}&limit=1`);
  const vesselHistoryRows = await supabaseGet("/rest/v1/vessel_snapshot_daily?select=snapshot_date,port_call_id&limit=1");
  const vesselVisitRows = await supabaseGet("/rest/v1/port_call_master?select=port_call_id,last_seen&limit=1");
  const candidateHistoryRows = await supabaseGet("/rest/v1/commercial_opportunity_daily?select=snapshot_date,opportunity_id&limit=1");
  const salesPipelineRows = await supabaseGet("/rest/v1/commercial_leads?select=lead_id,updated_at&limit=1");

  const retentionAudit = {
    policy: {
      profile: retention.profile,
      port_run_snapshot_days: retention.portRunSnapshotDays,
      port_run_snapshot_keep_runs: retention.portRunSnapshotKeepRuns,
      vessel_visits_days: retention.portCallMasterDays,
      opportunity_score_days: retention.opportunityScoreDays,
      candidate_history_days: retention.candidateHistoryDays,
      sales_pipeline_days: retention.salesPipelineDays
    },
    port_snapshot_count: tableCounts.port_snapshot_daily?.count || 0,
    oldest_port_snapshot: portSnapshotOldest.rows[0] || null,
    newest_port_snapshot: portSnapshotNewest.rows[0] || null,
    vessel_history_count: (vesselHistoryRows.count || 0) + (vesselVisitRows.count || 0),
    vessel_snapshot_history_count: vesselHistoryRows.count || 0,
    vessel_visit_count: vesselVisitRows.count || 0,
    candidate_history_count: (candidateHistoryRows.count || 0) + (tableCounts.sales_candidates_current?.count || 0),
    opportunity_score_history_count: candidateHistoryRows.count || 0,
    sales_pipeline_history_count: salesPipelineRows.count || 0,
    cleanup_candidates: {
      port_snapshot_daily: {
        cutoff_date: retentionCutoff(retention.portRunSnapshotDays, true),
        count: portSnapshotCleanupCandidates.count || 0,
        sample: portSnapshotCleanupCandidates.rows[0] || null,
        action: "compact_into_port_daily_weekly_monthly_summary_then_delete_detail_rows",
        protected: ["active_dataset_pointer target", "latest successful promoted runs", "vessel history tables"]
      }
    }
  };

  const frontendDataSource = activeRunId && activeRows.count > 0
    ? "active"
    : latestCompletedRunId && latestCompletedRows.count > 0
      ? "fallback_latest_completed"
      : staticVessels.length > 0
        ? "static_json"
        : "sample_or_degraded";

  const output = {
    generated_at: new Date().toISOString(),
    validation_mode: process.env.VALIDATION_MODE || null,
    supabase_config_present: Boolean(supabaseConfig()),
    active_dataset_pointer: activePointer.rows[0] || null,
    latest_completed_run: latestCompletedRun.rows[0] || null,
    latest_run: latestRun.rows[0] || null,
    row_counts_by_table: tableCounts,
    retention_audit: retentionAudit,
    active_run_vessel_count: activeRows.count || 0,
    latest_completed_run_vessel_count: latestCompletedRows.count || 0,
    static_all_collected_vessel_count: staticVessels.length,
    missing_output_files: missingOutputFiles,
    frontend_will_use: frontendDataSource,
    dashboard_status: {
      status: status.status || null,
      data_mode: status.data_mode || null,
      fallback_used: Boolean(status.fallback_used || summary.fallback_used),
      fallback_reason: status.fallback_reason || summary.fallback_reason || null,
      record_count: Number(status.record_count || summary.record_count || 0),
      user_message: status.user_message || summary.user_message || null
    }
  };

  console.log("=== Data Health Audit ===");
  console.log(`frontend_will_use=${output.frontend_will_use}`);
  console.log(`active_run_id=${activeRunId || ""}`);
  console.log(`active_run_vessel_count=${output.active_run_vessel_count}`);
  console.log(`latest_completed_run_id=${latestCompletedRunId || ""}`);
  console.log(`latest_completed_run_vessel_count=${output.latest_completed_run_vessel_count}`);
  console.log(`static_all_collected_vessel_count=${output.static_all_collected_vessel_count}`);
  console.log(`missing_output_files=${missingOutputFiles.join(",")}`);
  console.log(`row_counts_by_table=${JSON.stringify(tableCounts)}`);
  console.log(`port_snapshot_count=${retentionAudit.port_snapshot_count}`);
  console.log(`oldest_port_snapshot=${JSON.stringify(retentionAudit.oldest_port_snapshot)}`);
  console.log(`newest_port_snapshot=${JSON.stringify(retentionAudit.newest_port_snapshot)}`);
  console.log(`vessel_history_count=${retentionAudit.vessel_history_count}`);
  console.log(`candidate_history_count=${retentionAudit.candidate_history_count}`);
  console.log(`cleanup_candidates=${JSON.stringify(retentionAudit.cleanup_candidates)}`);
  console.log(JSON.stringify(output, null, 2));
}

main().catch(error => {
  console.error(`[HWK] data health audit failed: ${error?.message || String(error)}`);
  process.exit(1);
});
