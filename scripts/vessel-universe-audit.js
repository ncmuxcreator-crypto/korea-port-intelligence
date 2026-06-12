import fs from "fs";
import path from "path";
import { createClient } from "@supabase/supabase-js";

const ROOT = process.cwd();
const OUT_MD = path.join(ROOT, "docs", "vessel-universe-audit.md");
const OUT_JSON = path.join(ROOT, "docs", "vessel-universe-audit.json");

function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, file), "utf8"));
  } catch {
    return fallback;
  }
}

function rows(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.data)) return value.data;
  if (Array.isArray(value?.vessels)) return value.vessels;
  return [];
}

function hasValue(value) {
  return value !== null && value !== undefined && String(value).trim() !== "";
}

function normalize(value) {
  return String(value || "")
    .normalize("NFKC")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9가-힣]+/g, "");
}

function score(record = {}) {
  return Number(record.commercial_value_score || record.total_sales_priority_score || record.cleaning_candidate_score || 0);
}

function isDeparted(record = {}) {
  const status = String(record.status_bucket || record.status || "").toLowerCase();
  return status === "departed" || (hasValue(record.atd) && !record.is_staying_vessel && !record.is_anchorage_waiting);
}

function portCallKey(record = {}, index = 0) {
  return normalize(
    record.port_call_id ||
    record.port_call_identity ||
    record.port_call_key ||
    `${record.port_code || record.port || record.port_name || ""}|${record.etryptYear || ""}|${record.etryptCo || ""}|${record.call_sign || record.clsgn || ""}|${record.ata || record.eta || ""}|${record.vessel_name || ""}` ||
    `ROW-${index}`
  );
}

function vesselKey(record = {}, index = 0) {
  return normalize(
    record.master_vessel_id ||
    record.vessel_identity ||
    record.imo ||
    record.mmsi ||
    record.call_sign ||
    record.clsgn ||
    `${record.vessel_name || ""}|${record.gt || record.grtg || record.intrlGrtg || ""}|${record.vessel_type_group || record.vessel_type || ""}` ||
    `ROW-${index}`
  );
}

function groupCount(records, keyFn) {
  const map = new Map();
  for (const record of records) {
    const key = keyFn(record) || "unknown";
    map.set(key, (map.get(key) || 0) + 1);
  }
  return [...map.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || String(a.key).localeCompare(String(b.key)));
}

function gtBand(record = {}) {
  const gt = Number(record.gt || record.grtg || record.intrlGrtg || 0);
  if (!gt) return "unknown_gt";
  if (gt < 5000) return "gt_under_5000";
  if (gt < 30000) return "gt_5000_29999";
  if (gt < 80000) return "gt_30000_79999";
  return "gt_80000_plus";
}

function sourceAuditFrom(report = {}, sourceLogs = []) {
  const fromLogs = sourceLogs.map(log => ({
    source_name: log.source_name || log.source || "unknown",
    source_rows_collected: Number(log.rows_collected || 0),
    source_rows_normalized: Number(log.rows_normalized || 0),
    source_rows_discarded: Math.max(0, Number(log.rows_collected || 0) - Number(log.rows_normalized || 0)),
    source_rows_failed: log.status === "failed" ? Number(log.rows_collected || 0) : 0,
    status: log.status || "unknown",
    error_message: log.error_message || null
  }));
  if (fromLogs.length) return fromLogs;

  const diagnostics = report.collector_diagnostics || {};
  const sourceRows = diagnostics.source_rows || diagnostics.sources || diagnostics.source_health || [];
  if (Array.isArray(sourceRows) && sourceRows.length) {
    return sourceRows.map(source => ({
      source_name: source.source_name || source.key || source.source || "unknown",
      source_rows_collected: Number(source.rows_collected || source.row_count || source.rows || 0),
      source_rows_normalized: Number(source.rows_normalized || source.normalized_rows || 0),
      source_rows_discarded: Number(source.rows_discarded || 0),
      source_rows_failed: Number(source.rows_failed || 0),
      status: source.status || "unknown",
      error_message: source.error_message || source.error || null
    }));
  }

  const apiSources = Array.isArray(report.api_sources) ? report.api_sources : [];
  return apiSources.map(source => ({
    source_name: source.key || source.label || "unknown",
    source_rows_collected: 0,
    source_rows_normalized: 0,
    source_rows_discarded: 0,
    source_rows_failed: source.enabled && source.status !== "ok" ? 1 : 0,
    status: source.status || (source.enabled ? "enabled_no_row_diagnostics" : "not_configured"),
    error_message: Array.isArray(source.missing) && source.missing.length ? `missing: ${source.missing.join(", ")}` : null
  }));
}

async function fetchAll(client, table, query = q => q) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const to = from + 999;
    const { data, error } = await query(client.from(table).select("*").range(from, to));
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

async function loadSupabaseDataset() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !key) return null;

  const client = createClient(url, key, { auth: { persistSession: false } });
  const pointerResult = await client
    .from("active_dataset_pointer")
    .select("*")
    .limit(1)
    .maybeSingle();
  if (pointerResult.error) throw pointerResult.error;
  const runId = pointerResult.data?.active_run_id;
  if (!runId) return null;

  const vesselSnapshots = await fetchAll(client, "vessel_snapshots", q => q.eq("run_id", runId));
  const sourceLogs = await fetchAll(client, "source_collection_logs", q => q.eq("run_id", runId));
  const portCallCount = await client.from("port_call_master").select("*", { count: "exact", head: true }).eq("run_id", runId);
  const vesselMasterCount = await client.from("vessel_master").select("*", { count: "exact", head: true });
  const runResult = await client.from("data_collection_runs").select("*").eq("run_id", runId).maybeSingle();

  return {
    source: "supabase_active_dataset",
    run_id: runId,
    records: vesselSnapshots,
    source_logs: sourceLogs,
    data_collection_run: runResult.data || null,
    port_call_master_count: portCallCount.count ?? null,
    master_vessel_count: vesselMasterCount.count ?? null
  };
}

function loadLocalDataset() {
  const report = readJson("data/pipeline-report.json", {});
  const allCollected = rows(readJson("dashboard/api/all-collected-vessels.json", []));
  const vessels = rows(readJson("dashboard/api/vessels.json", []));
  const target = rows(readJson("dashboard/api/target-vessels.json", []));
  const status = readJson("dashboard/api/status.json", {});
  const records = allCollected.length ? allCollected : vessels.length ? vessels : target;
  return {
    source: "local_static_outputs",
    run_id: report.run_id || status.run_id || null,
    records,
    report,
    status,
    source_logs: [],
    port_call_master_count: null,
    master_vessel_count: null
  };
}

function buildAudit(dataset) {
  const records = rows(dataset.records);
  const report = dataset.report || dataset.status || {};
  const activeRecords = records.filter(record => !isDeparted(record));
  const portCallKeys = new Set(activeRecords.map(portCallKey).filter(Boolean));
  const vesselKeys = new Set(activeRecords.map(vesselKey).filter(Boolean));
  const countFunnel = report.count_funnel || {};
  const rawRows = Number(countFunnel.raw_api_rows || report.raw_collected_vessel_count || report.raw_collected_rows || records.length);
  const normalizedRows = Number(countFunnel.normalized_rows || report.all_collected_vessel_count || report.normalized_rows || records.length);
  const uniquePortCalls = Number(countFunnel.unique_port_calls || portCallKeys.size);
  const uniqueVessels = Number(countFunnel.unique_vessels || vesselKeys.size);
  const duplicateRowsRemoved = Math.max(0, normalizedRows - uniquePortCalls);
  const scoreRows = activeRecords.filter(record => score(record) > 0);
  const salesTargets = activeRecords.filter(record => score(record) >= 65 && !isDeparted(record));
  const immediateTargets = activeRecords.filter(record => score(record) >= 75 && !isDeparted(record));
  const watchlist = activeRecords.filter(record => score(record) >= 50 && score(record) < 65 && !isDeparted(record));

  const identity = {
    master_vessel_count: dataset.master_vessel_count,
    imo_known_count: activeRecords.filter(record => hasValue(record.imo)).length,
    imo_missing_count: activeRecords.filter(record => !hasValue(record.imo)).length,
    call_sign_known_count: activeRecords.filter(record => hasValue(record.call_sign || record.clsgn)).length,
    vessel_name_only_count: activeRecords.filter(record => hasValue(record.vessel_name) && !hasValue(record.imo) && !hasValue(record.mmsi) && !hasValue(record.call_sign || record.clsgn)).length
  };

  const dashboard = {
    full_vessel_table_source: "/api/vessels?group=all -> vesselGroupRows(allRecords, 'all')",
    sales_target_table_source: "/api/vessels?group=target -> vesselGroupRows(allRecords, 'target') -> sales candidates only",
    immediate_target_source: "/api/candidates/top.json -> dashboard_summary_snapshots.candidate_summary.immediate_targets or buildVisibilityBuckets().immediate_targets",
    current_risk: "Summary fallback can display stored port_summary counts until the next successful run rewrites dashboard_summary_snapshots."
  };

  const suspected = [];
  if (dataset.source === "local_static_outputs") suspected.push("Local dashboard/api outputs are stale/no-live-data and cannot prove production vessel counts.");
  if (records.length === 0) suspected.push("No local all_vessels rows are available for row-level audit.");
  if (normalizedRows && uniquePortCalls && uniquePortCalls > normalizedRows) suspected.push("unique_port_calls exceeds normalized_rows; key generation should be checked.");
  if (salesTargets.length > activeRecords.length * 0.3) suspected.push("Sales target ratio exceeds 30%; target qualification may be too broad.");
  if (dataset.port_call_master_count !== null && dataset.port_call_master_count < uniquePortCalls * 0.8) suspected.push("port_call_master_count is below 80% of inferred unique port calls.");

  return {
    generated_at: new Date().toISOString(),
    dataset_source: dataset.source,
    run_id: dataset.run_id,
    collection_counts: sourceAuditFrom(report, dataset.source_logs),
    deduplication_counts: {
      raw_rows: rawRows,
      normalized_rows: normalizedRows,
      active_rows_after_departure_filter: activeRecords.length,
      duplicate_rows_removed: duplicateRowsRemoved,
      unique_port_calls: uniquePortCalls,
      unique_vessels: uniqueVessels
    },
    port_call_audit: {
      port_call_master_count: dataset.port_call_master_count,
      inferred_unique_port_calls: uniquePortCalls,
      coverage_percent: dataset.port_call_master_count && uniquePortCalls ? Math.round((dataset.port_call_master_count / uniquePortCalls) * 100) : null
    },
    vessel_identity_audit: identity,
    all_vessels_audit: {
      all_vessels_count: activeRecords.length,
      by_port: groupCount(activeRecords, record => record.port_name || record.port || record.port_code).slice(0, 50),
      by_vessel_type: groupCount(activeRecords, record => record.vessel_type_group || record.vessel_type || "unknown").slice(0, 30),
      by_gt_band: groupCount(activeRecords, gtBand)
    },
    target_vessel_audit: {
      scored_vessels_count: scoreRows.length,
      watchlist_count: watchlist.length,
      sales_target_count: salesTargets.length,
      immediate_target_count: immediateTargets.length,
      target_ratio: activeRecords.length ? Number((salesTargets.length / activeRecords.length).toFixed(3)) : 0
    },
    dashboard_audit: dashboard,
    suspected_counting_issues: suspected,
    recommended_fixes: [
      "Run this audit in GitHub Actions with Supabase secrets after every successful collection.",
      "Compare source_collection_logs rows_collected with vessel_snapshots active rows for the same run_id.",
      "Keep /api/vessels?group=all and /api/vessels?group=target counts separate in UI labels.",
      "Regenerate dashboard_summary_snapshots after the port metric label change so old port_summary values disappear.",
      "Add port_call_id coverage as a hard promotion diagnostic if it falls below 80%."
    ]
  };
}

function table(rowsToRender = [], columns = ["key", "count"]) {
  if (!rowsToRender.length) return "_No rows available._";
  return [
    `| ${columns.join(" | ")} |`,
    `| ${columns.map(() => "---").join(" | ")} |`,
    ...rowsToRender.map(row => `| ${columns.map(column => String(row[column] ?? "")).join(" | ")} |`)
  ].join("\n");
}

function renderMarkdown(audit) {
  return `# Vessel Universe Audit Report

Generated: ${audit.generated_at}

Dataset source: ${audit.dataset_source}

Run ID: ${audit.run_id || "unknown"}

## Collection Counts

${table(audit.collection_counts, ["source_name", "source_rows_collected", "source_rows_normalized", "source_rows_discarded", "source_rows_failed", "status"])}

## Deduplication Counts

${table(Object.entries(audit.deduplication_counts).map(([key, count]) => ({ key, count })))}

## Port Call Audit

${table(Object.entries(audit.port_call_audit).map(([key, count]) => ({ key, count: count ?? "unknown" })))}

## Vessel Identity Audit

${table(Object.entries(audit.vessel_identity_audit).map(([key, count]) => ({ key, count: count ?? "unknown" })))}

## All Vessels Breakdown

All vessels count: ${audit.all_vessels_audit.all_vessels_count}

### By Port

${table(audit.all_vessels_audit.by_port.slice(0, 25))}

### By Vessel Type

${table(audit.all_vessels_audit.by_vessel_type.slice(0, 25))}

### By GT Band

${table(audit.all_vessels_audit.by_gt_band)}

## Target Vessel Audit

${table(Object.entries(audit.target_vessel_audit).map(([key, count]) => ({ key, count })))}

## Dashboard Audit

${table(Object.entries(audit.dashboard_audit).map(([key, count]) => ({ key, count })))}

## Suspected Counting Issues

${audit.suspected_counting_issues.length ? audit.suspected_counting_issues.map(item => `- ${item}`).join("\n") : "- No obvious counting issue detected in the audited dataset."}

## Recommended Fixes

${audit.recommended_fixes.map(item => `- ${item}`).join("\n")}
`;
}

async function main() {
  let dataset = null;
  try {
    dataset = await loadSupabaseDataset();
  } catch (error) {
    dataset = null;
    console.warn(`[Korea Port Intelligence] Supabase audit skipped: ${error.message}`);
  }
  if (!dataset) dataset = loadLocalDataset();

  const audit = buildAudit(dataset);
  fs.mkdirSync(path.dirname(OUT_MD), { recursive: true });
  fs.writeFileSync(OUT_JSON, JSON.stringify(audit, null, 2));
  fs.writeFileSync(OUT_MD, renderMarkdown(audit));
  console.log(`[Korea Port Intelligence] Vessel universe audit written to ${path.relative(ROOT, OUT_MD)}`);
  console.log(JSON.stringify({
    dataset_source: audit.dataset_source,
    run_id: audit.run_id,
    all_vessels_count: audit.all_vessels_audit.all_vessels_count,
    unique_port_calls: audit.deduplication_counts.unique_port_calls,
    unique_vessels: audit.deduplication_counts.unique_vessels,
    sales_target_count: audit.target_vessel_audit.sales_target_count,
    immediate_target_count: audit.target_vessel_audit.immediate_target_count,
    suspected_counting_issues: audit.suspected_counting_issues
  }, null, 2));
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
