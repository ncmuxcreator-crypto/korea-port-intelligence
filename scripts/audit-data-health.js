import fs from "fs";
import { buildPortStatistics, detectPortFieldNames } from "./lib/port-statistics.js";

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
  const status = readJson(staticOutput("dashboard/api/status.json"), {});
  const summary = readJson(staticOutput("dashboard/api/dashboard-summary.json"), {});
  const staticVessels = rows(readJson(staticOutput("dashboard/api/all-collected-vessels.json"), []));
  const staticPortStats = buildPortStatistics(staticVessels, summary.port_statistics_generated_at || summary.generated_at || new Date().toISOString());
  const summaryPorts = rows(summary.ports).length ? rows(summary.ports) : rows(readJson(staticOutput("dashboard/api/ports.json"), []));
  const portStatsForAudit = rows(summary.ports).length ? {
    port_count: Number(summary.port_count ?? summaryPorts.length),
    ports: summaryPorts,
    port_statistics_status: summary.port_statistics_status || "completed",
    port_statistics_error: summary.port_statistics_error || null,
    unknown_port_count: Number(summary.unknown_port_count ?? (summaryPorts.find(port => port.port_code === "UNKNOWN")?.vessel_count || 0)),
    vessels_missing_port_field: Number((summary.vessels_missing_port_field ?? staticPortStats.vessels_missing_port_field) || 0),
    port_field_names_found: summary.port_field_names_found || detectPortFieldNames(staticVessels)
  } : staticPortStats;
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
    active_run_vessel_count: activeRows.count || 0,
    latest_completed_run_vessel_count: latestCompletedRows.count || 0,
    static_all_collected_vessel_count: staticVessels.length,
    missing_output_files: missingOutputFiles,
    frontend_will_use: frontendDataSource,
    port_statistics: {
      record_count: Number(summary.record_count || status.record_count || staticVessels.length || 0),
      port_count: portStatsForAudit.port_count,
      port_statistics_status: portStatsForAudit.port_statistics_status,
      port_statistics_error: portStatsForAudit.port_statistics_error,
      unknown_port_count: portStatsForAudit.unknown_port_count,
      vessels_missing_port_field: portStatsForAudit.vessels_missing_port_field,
      port_field_names_found: portStatsForAudit.port_field_names_found,
      top_ports: portStatsForAudit.ports.slice(0, 5).map(port => ({
        port_name: port.port_name,
        port_code: port.port_code,
        vessel_count: Number(port.vessel_count || port.total_vessels || 0)
      }))
    },
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
  console.log("Port statistics:");
  console.log(`- status: ${output.port_statistics.port_statistics_status}`);
  console.log(`- record_count: ${output.port_statistics.record_count}`);
  console.log(`- port_count: ${output.port_statistics.port_count}`);
  console.log(`- unknown_port_count: ${output.port_statistics.unknown_port_count}`);
  console.log(`- missing_port_field: ${output.port_statistics.vessels_missing_port_field}`);
  console.log(`- port field names found in sample vessels: ${output.port_statistics.port_field_names_found.join(",") || "none"}`);
  console.log("- top ports:");
  output.port_statistics.top_ports.forEach((port, index) => {
    console.log(`  ${index + 1}. ${port.port_name}: ${port.vessel_count}`);
  });
  console.log(JSON.stringify(output, null, 2));
}

main().catch(error => {
  console.error(`[HWK] data health audit failed: ${error?.message || String(error)}`);
  process.exit(1);
});
