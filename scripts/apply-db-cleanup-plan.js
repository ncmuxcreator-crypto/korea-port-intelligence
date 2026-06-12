import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const PLAN_PATH = path.join(ROOT, "dashboard", "api", "db-cleanup-plan.json");
const REPORT_JSON_PATH = path.join(ROOT, "dashboard", "api", "db-cleanup-execution-report.json");
const REPORT_MD_PATH = path.join(ROOT, "docs", "DB_CLEANUP_EXECUTION_REPORT.md");
const BACKUP_ROOT = path.join(ROOT, "data", "db-cleanup-backups");

const RUN_TABLES = [
  "vessel_snapshots",
  "port_call_master",
  "opportunity_master",
  "risk_history",
  "feature_snapshots",
  "explainability_snapshots",
  "rule_evaluations",
  "port_congestion_snapshots",
  "source_collection_logs"
];

const args = new Set(process.argv.slice(2));
const APPLY = args.has("--apply");
const MAX_RUNS = numberArg("--max-runs", 5);
const MAX_ROWS = numberArg("--max-rows", 1000);

const SUPABASE_URL = String(process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const REST_URL = SUPABASE_URL ? `${SUPABASE_URL}/rest/v1` : "";

function numberArg(name, fallback) {
  const prefix = `${name}=`;
  const arg = process.argv.find(item => item.startsWith(prefix));
  if (!arg) return fallback;
  const value = Number(arg.slice(prefix.length));
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function nowIso() {
  return new Date().toISOString();
}

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, payload) {
  ensureDir(filePath);
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function writeText(filePath, text) {
  ensureDir(filePath);
  fs.writeFileSync(filePath, text.endsWith("\n") ? text : `${text}\n`, "utf8");
}

function clean(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseContentRange(value) {
  const text = String(value || "");
  const match = text.match(/\/(\d+)$/);
  return match ? Number(match[1]) : null;
}

function escapeUrlValue(value) {
  return encodeURIComponent(String(value));
}

function sqlSafeIdentifier(value) {
  return RUN_TABLES.includes(value) ? value : null;
}

function protectedRunIds(plan = {}) {
  const ids = new Set();
  for (const item of Array.isArray(plan.protected_data) ? plan.protected_data : []) {
    if (item.type === "run_id" || item.type === "active_dataset_pointer" || item.type === "latest_successful_run") {
      if (item.identifier) ids.add(String(item.identifier));
    }
  }
  if (plan.source_run_id) ids.add(String(plan.source_run_id));
  return ids;
}

function safeRunCandidates(plan = {}) {
  const protectedIds = protectedRunIds(plan);
  return (Array.isArray(plan.safe_cleanup_candidates) ? plan.safe_cleanup_candidates : [])
    .filter(item => item && item.type === "run" && item.run_id)
    .filter(item => !protectedIds.has(String(item.run_id)))
    .filter(item => String(item.cleanup_safety || "").toUpperCase() === "SAFE_CLEANUP_CANDIDATE")
    .slice(0, MAX_RUNS);
}

async function rest(method, table, query = "", options = {}) {
  if (!REST_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return { ok: false, status: 0, body: null, rows: [], count: null, error: "missing_supabase_env" };
  }
  const url = `${REST_URL}/${table}${query ? `?${query}` : ""}`;
  const headers = {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    accept: "application/json",
    ...options.headers
  };
  const response = await fetch(url, { method, headers });
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return {
    ok: response.ok,
    status: response.status,
    body,
    rows: Array.isArray(body) ? body : [],
    count: parseContentRange(response.headers.get("content-range")),
    error: response.ok ? null : (body?.message || body?.details || body?.hint || text || "request_failed")
  };
}

async function countRows(table, runId) {
  return rest("GET", table, `select=*&run_id=eq.${escapeUrlValue(runId)}`, {
    headers: { prefer: "count=exact", range: "0-0" }
  });
}

async function fetchRows(table, runId, limit) {
  return rest("GET", table, `select=*&run_id=eq.${escapeUrlValue(runId)}&limit=${limit}`, {
    headers: { range: `0-${Math.max(0, limit - 1)}` }
  });
}

async function deleteRows(table, runId) {
  return rest("DELETE", table, `run_id=eq.${escapeUrlValue(runId)}`, {
    headers: { prefer: "return=minimal" }
  });
}

function backupPathFor(startedAt, runId, table) {
  const safeRun = String(runId).replace(/[^a-zA-Z0-9_-]/g, "_");
  const safeTable = String(table).replace(/[^a-zA-Z0-9_-]/g, "_");
  return path.join(BACKUP_ROOT, startedAt, safeRun, `${safeTable}.json`);
}

async function processCandidate(candidate, startedAt) {
  const runId = candidate.run_id;
  const rowCounts = candidate.row_counts_by_table || {};
  const tableResults = [];
  for (const table of RUN_TABLES) {
    if (!sqlSafeIdentifier(table)) continue;
    const estimated = number(rowCounts[table]);
    if (!estimated) continue;
    const before = await countRows(table, runId);
    const beforeCount = before.ok ? number(before.count ?? before.rows.length) : null;
    const result = {
      table,
      run_id: runId,
      estimated_rows: estimated,
      before_count: beforeCount,
      backup_file: null,
      skipped: false,
      skip_reason: null,
      deleted: false,
      delete_status: null,
      after_count: null,
      error: before.error
    };
    if (!before.ok) {
      result.skipped = true;
      result.skip_reason = before.error || "count_failed";
      tableResults.push(result);
      continue;
    }
    if (beforeCount > MAX_ROWS) {
      result.skipped = true;
      result.skip_reason = `row_count_exceeds_max_rows_${MAX_ROWS}`;
      tableResults.push(result);
      continue;
    }
    if (beforeCount > 0) {
      const rows = await fetchRows(table, runId, beforeCount);
      if (!rows.ok) {
        result.skipped = true;
        result.skip_reason = rows.error || "backup_fetch_failed";
        tableResults.push(result);
        continue;
      }
      const backupFile = backupPathFor(startedAt, runId, table);
      writeJson(backupFile, {
        schema_version: "1.0",
        generated_at: nowIso(),
        run_id: runId,
        table,
        row_count: rows.rows.length,
        rows: rows.rows
      });
      result.backup_file = path.relative(ROOT, backupFile).replace(/\\/g, "/");
    }
    if (!APPLY) {
      result.skipped = true;
      result.skip_reason = "dry_run";
      tableResults.push(result);
      continue;
    }
    const deleted = await deleteRows(table, runId);
    result.deleted = deleted.ok;
    result.delete_status = deleted.status;
    result.error = deleted.error;
    const after = await countRows(table, runId);
    result.after_count = after.ok ? number(after.count ?? after.rows.length) : null;
    tableResults.push(result);
  }
  return {
    run_id: runId,
    reason: candidate.reason,
    row_count_estimate: number(candidate.row_count_estimate),
    tables: tableResults
  };
}

function markdownReport(report = {}) {
  const lines = [
    "# DB Cleanup Execution Report",
    "",
    `- Generated at: ${report.generated_at}`,
    `- Mode: ${report.mode}`,
    `- Applied: ${report.apply}`,
    `- Supabase configured: ${report.supabase_configured}`,
    `- Candidate runs selected: ${report.candidate_runs_selected}`,
    `- Tables touched: ${report.tables_touched}`,
    `- Rows backed up: ${report.rows_backed_up}`,
    `- Rows deleted estimate: ${report.rows_deleted_estimate}`,
    "",
    "## Safety",
    "",
    "- Only run-level candidates from db-cleanup-plan.json are eligible.",
    "- Active/latest/protected run ids are excluded.",
    "- Table-level cleanup, orphan cleanup, and duplicate cleanup are not executed by this script.",
    "- Rows are exported to data/db-cleanup-backups before deletion.",
    "",
    "## Results",
    "",
    "| Run | Table | Before | After | Backup | Status |",
    "| --- | --- | ---: | ---: | --- | --- |"
  ];
  for (const candidate of report.results || []) {
    for (const table of candidate.tables || []) {
      const status = table.deleted ? "deleted" : table.skip_reason || table.error || "checked";
      lines.push(`| ${candidate.run_id} | ${table.table} | ${table.before_count ?? "-"} | ${table.after_count ?? "-"} | ${table.backup_file || "-"} | ${status} |`);
    }
  }
  return lines.join("\n");
}

async function main() {
  const startedAt = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  const plan = readJson(PLAN_PATH);
  const candidates = safeRunCandidates(plan || {});
  const report = {
    schema_version: "1.0",
    generated_at: nowIso(),
    mode: APPLY ? "apply" : "dry_run",
    apply: APPLY,
    source_plan: "dashboard/api/db-cleanup-plan.json",
    source_plan_generated_at: plan?.generated_at || null,
    source_run_id: plan?.source_run_id || null,
    supabase_configured: Boolean(REST_URL && SUPABASE_SERVICE_ROLE_KEY),
    max_runs: MAX_RUNS,
    max_rows_per_table: MAX_ROWS,
    candidate_runs_selected: candidates.length,
    tables_touched: 0,
    rows_backed_up: 0,
    rows_deleted_estimate: 0,
    results: [],
    warnings: []
  };

  if (!plan) {
    report.warnings.push("db-cleanup-plan.json is missing or invalid.");
  }
  if (!report.supabase_configured) {
    report.warnings.push("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. No production data was changed.");
  }
  if (!candidates.length) {
    report.warnings.push("No safe run-level cleanup candidates selected.");
  }

  if (report.supabase_configured && candidates.length) {
    for (const candidate of candidates) {
      const result = await processCandidate(candidate, startedAt);
      report.results.push(result);
    }
  }

  for (const candidate of report.results) {
    for (const table of candidate.tables || []) {
      if (table.before_count !== null && table.before_count !== undefined) report.tables_touched += 1;
      if (table.backup_file) report.rows_backed_up += number(table.before_count);
      if (table.deleted) report.rows_deleted_estimate += number(table.before_count);
    }
  }

  writeJson(REPORT_JSON_PATH, report);
  writeText(REPORT_MD_PATH, markdownReport(report));

  console.log(`DB cleanup execution report written: ${path.relative(ROOT, REPORT_JSON_PATH)}`);
  console.log(`mode=${report.mode}`);
  console.log(`supabase_configured=${report.supabase_configured}`);
  console.log(`candidate_runs_selected=${report.candidate_runs_selected}`);
  console.log(`tables_touched=${report.tables_touched}`);
  console.log(`rows_backed_up=${report.rows_backed_up}`);
  console.log(`rows_deleted_estimate=${report.rows_deleted_estimate}`);
  for (const warning of report.warnings) console.log(`WARNING ${warning}`);
  if (APPLY && report.warnings.some(item => item.includes("Missing SUPABASE"))) {
    process.exitCode = 1;
  }
}

main().catch(error => {
  console.error(`CRITICAL DB cleanup execution failed: ${error?.message || String(error)}`);
  process.exitCode = 1;
});
