import fs from "fs";
import path from "path";

const ROOT = process.cwd();
const STORAGE_REPORT_PATH = path.join(ROOT, "dashboard", "api", "storage-efficiency-report.json");
const PLAN_JSON_PATH = path.join(ROOT, "dashboard", "api", "db-cleanup-plan.json");
const PLAN_DOC_PATH = path.join(ROOT, "docs", "DB_CLEANUP_PLAN.md");

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

function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function writeJson(filePath, payload) {
  ensureDir(filePath);
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function writeText(filePath, text) {
  ensureDir(filePath);
  fs.writeFileSync(filePath, text.endsWith("\n") ? text : `${text}\n`, "utf8");
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function sumObjectNumbers(value = {}) {
  if (!value || typeof value !== "object") return 0;
  return Object.values(value).reduce((sum, rowCount) => sum + number(rowCount), 0);
}

function escapeSql(value = "") {
  return String(value).replace(/'/g, "''");
}

function isProtected(item = {}) {
  return item.protected === true ||
    item.protection_status === "BLOCKED_BY_PROTECTION_RULE" ||
    item.cleanup_risk_level === "NEVER_DELETE" ||
    item.cleanup_safety === "BLOCKED";
}

function isSafeCandidate(item = {}) {
  if (isProtected(item)) return false;
  const safety = String(item.cleanup_safety || item.cleanup_risk_level || "").toUpperCase();
  return ["SAFE_CLEANUP_CANDIDATE", "RETAIN_SHORT_TERM"].includes(safety);
}

function candidateRows(item = {}) {
  if (item.row_counts_by_table) return sumObjectNumbers(item.row_counts_by_table);
  return number(item.row_count);
}

function classifyStorageImpact(rows = 0) {
  if (!rows) return "0 rows; storage impact not estimated";
  if (rows < 1000) return "low; exact storage bytes unavailable";
  if (rows < 10000) return "medium; exact storage bytes unavailable";
  return "high; exact storage bytes unavailable";
}

function protectedData(report = {}) {
  const fromReport = asArray(report.protected_data).map(item => ({
    type: item.type || "protected",
    identifier: item.identifier || item.table_name || item.table || "-",
    reason: item.reason || "Protected by cleanup audit.",
    protected: true
  }));
  const protectedTables = asArray(report.table_inventory)
    .filter(isProtected)
    .map(row => ({
      type: "table",
      identifier: row.table_name,
      row_count: row.row_count ?? null,
      reason: row.cleanup_risk_level === "NEVER_DELETE"
        ? "Never delete table."
        : "Blocked by protection rule.",
      protected: true
    }));
  const protectedRuns = asArray(report.db_context?.protected_run_ids).map(runId => ({
    type: "run_id",
    identifier: runId,
    reason: "Active/latest successful dataset run; must remain available for rollback and serving continuity.",
    protected: true
  }));
  const seen = new Set();
  return [...fromReport, ...protectedTables, ...protectedRuns].filter(item => {
    const key = `${item.type}|${item.identifier}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function safeCleanupCandidates(report = {}) {
  const candidates = [];
  for (const item of asArray(report.cleanup_candidates)) {
    if (isSafeCandidate(item)) {
      candidates.push({
        type: item.run_id ? "run" : "table",
        run_id: item.run_id || null,
        table_name: item.table_name || item.table || null,
        reason: item.reason || item.cleanup_risk_level || "Cleanup candidate from audit.",
        row_count_estimate: candidateRows(item),
        row_counts_by_table: item.row_counts_by_table || null,
        cleanup_safety: item.cleanup_safety || item.cleanup_risk_level || "SAFE_CLEANUP_CANDIDATE",
        review_required: true
      });
    }
  }
  return candidates;
}

function manualReviewCandidates(report = {}) {
  const manual = [
    ...asArray(report.manual_review_required).map(item => ({
      type: "audit_issue",
      severity: item.severity || "MANUAL_REVIEW",
      identifier: item.issue || item.message || "-",
      reason: "Manual audit issue requires review before cleanup."
    })),
    ...asArray(report.table_inventory)
      .filter(row => row.cleanup_risk_level === "NEEDS_MANUAL_REVIEW")
      .map(row => ({
        type: "table",
        severity: "MANUAL_REVIEW",
        identifier: row.table_name,
        row_count: row.row_count ?? null,
        reason: "Table is not automatically safe to clean."
      })),
    ...asArray(report.duplicate_findings)
      .filter(row => number(row.duplicate_count) > 0)
      .map(row => ({
        type: "duplicate",
        severity: "MANUAL_REVIEW",
        identifier: `${row.table}:${row.check}`,
        row_count: row.duplicate_count,
        reason: "Duplicate cleanup needs quarantine/review before deletion."
      })),
    ...asArray(report.orphan_findings)
      .filter(row => number(row.orphan_count) > 0)
      .map(row => ({
        type: "orphan",
        severity: row.severity || "WARNING",
        identifier: `${row.table}:${row.type}`,
        row_count: row.orphan_count,
        reason: "Orphan rows require relationship check before deletion."
      }))
  ];
  const seen = new Set();
  return manual.filter(item => {
    const key = `${item.type}|${item.identifier}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function blockedCandidates(report = {}) {
  return [
    ...asArray(report.cleanup_candidates)
      .filter(isProtected)
      .map(item => ({
        type: item.run_id ? "run" : "table",
        identifier: item.run_id || item.table_name || item.table || "-",
        row_count_estimate: candidateRows(item),
        reason: item.reason || "Blocked by protection rule."
      })),
    ...asArray(report.table_inventory)
      .filter(isProtected)
      .map(row => ({
        type: "table",
        identifier: row.table_name,
        row_count_estimate: number(row.row_count),
        reason: row.cleanup_risk_level || row.protection_status || "Blocked."
      }))
  ];
}

function commentedSqlLine(sql = "") {
  return sql ? `-- ${sql}` : "--";
}

function sqlPreviewForSafeCandidates(candidates = [], report = {}) {
  const protectedRunIds = asArray(report.db_context?.protected_run_ids);
  const latestRunId = report.db_context?.latest_successful_run_id || "<latest_successful_run_id>";
  const activeRunId = report.db_context?.active_run_id || "<active_run_id>";
  const lines = [
    "-- REVIEW-ONLY SQL PREVIEW",
    "-- All destructive statements are commented out intentionally.",
    "-- Uncomment manually only after backup, row-count verification, and approval.",
    "--",
    "-- BEGIN;"
  ];

  for (const candidate of candidates.slice(0, 40)) {
    if (candidate.run_id) {
      lines.push("--");
      lines.push(`-- Candidate run_id: ${candidate.run_id}`);
      lines.push(`-- Reason: ${candidate.reason}`);
      const rowCounts = candidate.row_counts_by_table || {};
      for (const table of RUN_TABLES) {
        const rows = number(rowCounts[table]);
        if (!rows) continue;
        lines.push(commentedSqlLine(`DELETE FROM public.${table}`));
        lines.push(commentedSqlLine(`WHERE run_id = '${escapeSql(candidate.run_id)}'`));
        lines.push(commentedSqlLine(`  AND run_id NOT IN ('${escapeSql(activeRunId)}', '${escapeSql(latestRunId)}'${protectedRunIds.map(id => `, '${escapeSql(id)}'`).join("")}); -- estimated rows ${rows}`));
      }
      continue;
    }
    if (candidate.table_name) {
      lines.push("--");
      lines.push(`-- Candidate table: ${candidate.table_name}`);
      lines.push(`-- Reason: ${candidate.reason}`);
      lines.push(commentedSqlLine(`-- Table-level cleanup requires a reviewed retention predicate before use.`));
      lines.push(commentedSqlLine(`DELETE FROM public.${candidate.table_name}`));
      lines.push(commentedSqlLine(`WHERE <reviewed_retention_predicate>`));
      lines.push(commentedSqlLine(`  AND COALESCE(run_id, '') NOT IN ('${escapeSql(activeRunId)}', '${escapeSql(latestRunId)}'${protectedRunIds.map(id => `, '${escapeSql(id)}'`).join("")}); -- estimated rows ${candidate.row_count_estimate || 0}`));
    }
  }
  lines.push("--");
  lines.push("-- COMMIT;");
  return lines;
}

function buildPlan(report = {}) {
  const safe = safeCleanupCandidates(report);
  const estimatedRowsRemovable = safe.reduce((sum, item) => sum + number(item.row_count_estimate), 0);
  const sqlPreview = sqlPreviewForSafeCandidates(safe, report);
  return {
    schema_version: "1.0",
    generated_at: new Date().toISOString(),
    source_endpoint: "dashboard/api/storage-efficiency-report.json",
    source_generated_at: report.generated_at || null,
    source_run_id: report.run_id || report.db_context?.latest_run_id || null,
    execution_mode: "review_only",
    destructive_sql_executed: false,
    safety_notice: "This plan does not delete data. All SQL preview lines are commented out.",
    summary: {
      db_health_score: report.db_health_score ?? null,
      total_tables_checked: report.summary?.total_tables_checked ?? null,
      total_rows_estimated: report.summary?.total_rows_estimated ?? null,
      safe_cleanup_candidate_count: safe.length,
      manual_review_candidate_count: manualReviewCandidates(report).length,
      blocked_candidate_count: blockedCandidates(report).length,
      estimated_rows_removable: estimatedRowsRemovable,
      estimated_storage_impact: classifyStorageImpact(estimatedRowsRemovable)
    },
    protected_data: protectedData(report),
    safe_cleanup_candidates: safe,
    manual_review_candidates: manualReviewCandidates(report),
    blocked_candidates: blockedCandidates(report),
    estimated_rows_removable: estimatedRowsRemovable,
    estimated_storage_impact: {
      status: "estimated_from_rows_only",
      label: classifyStorageImpact(estimatedRowsRemovable),
      note: "Supabase table byte estimates were not available in the source report, so storage impact is row-count based."
    },
    sql_preview: sqlPreview,
    review_checklist: [
      "Confirm active_run_id and latest_successful_run_id are protected.",
      "Take a database backup or export before applying any cleanup.",
      "Run SELECT COUNT(*) with the same WHERE predicates before uncommenting DELETE statements.",
      "Apply cleanup in small batches and validate dashboard/api/bootstrap.json after each batch.",
      "Keep vessel_master, active_dataset_pointer, current serving rows, and commercial history protected."
    ]
  };
}

function mdTable(headers = [], rows = []) {
  const line = `| ${headers.join(" | ")} |`;
  const sep = `| ${headers.map(() => "---").join(" | ")} |`;
  const body = rows.map(row => `| ${row.map(value => String(value ?? "-").replace(/\|/g, "\\|")).join(" | ")} |`);
  return [line, sep, ...body].join("\n");
}

function renderMarkdown(plan = {}) {
  const lines = [];
  lines.push("# DB Cleanup Execution Plan");
  lines.push("");
  lines.push("> Review-only plan. No data was deleted, and all destructive SQL is commented out.");
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(mdTable(
    ["Metric", "Value"],
    [
      ["Generated at", plan.generated_at],
      ["Source generated at", plan.source_generated_at || "-"],
      ["Source run id", plan.source_run_id || "-"],
      ["DB health score", plan.summary.db_health_score ?? "-"],
      ["Safe cleanup candidates", plan.summary.safe_cleanup_candidate_count],
      ["Manual review candidates", plan.summary.manual_review_candidate_count],
      ["Blocked candidates", plan.summary.blocked_candidate_count],
      ["Estimated rows removable", plan.summary.estimated_rows_removable],
      ["Estimated storage impact", plan.summary.estimated_storage_impact]
    ]
  ));
  lines.push("");
  lines.push("## Protected Data");
  lines.push("");
  lines.push(mdTable(
    ["Type", "Identifier", "Rows", "Reason"],
    plan.protected_data.slice(0, 60).map(item => [item.type, item.identifier, item.row_count ?? "-", item.reason])
  ));
  lines.push("");
  lines.push("## Safe Cleanup Candidates");
  lines.push("");
  lines.push(mdTable(
    ["Type", "Identifier", "Rows", "Reason"],
    plan.safe_cleanup_candidates.slice(0, 80).map(item => [item.type, item.run_id || item.table_name, item.row_count_estimate, item.reason])
  ));
  if (!plan.safe_cleanup_candidates.length) lines.push("\nNo safe cleanup candidates were detected.");
  lines.push("");
  lines.push("## Manual Review Candidates");
  lines.push("");
  lines.push(mdTable(
    ["Type", "Severity", "Identifier", "Rows", "Reason"],
    plan.manual_review_candidates.slice(0, 80).map(item => [item.type, item.severity || "MANUAL_REVIEW", item.identifier, item.row_count ?? "-", item.reason])
  ));
  if (!plan.manual_review_candidates.length) lines.push("\nNo manual review candidates were detected.");
  lines.push("");
  lines.push("## Blocked Candidates");
  lines.push("");
  lines.push(mdTable(
    ["Type", "Identifier", "Rows", "Reason"],
    plan.blocked_candidates.slice(0, 80).map(item => [item.type, item.identifier, item.row_count_estimate ?? "-", item.reason])
  ));
  lines.push("");
  lines.push("## Estimated Rows Removable");
  lines.push("");
  lines.push(`- ${plan.estimated_rows_removable.toLocaleString("en-US")} rows`);
  lines.push(`- ${plan.estimated_storage_impact.label}`);
  lines.push(`- ${plan.estimated_storage_impact.note}`);
  lines.push("");
  lines.push("## SQL Preview");
  lines.push("");
  lines.push("```sql");
  lines.push(...plan.sql_preview);
  lines.push("```");
  lines.push("");
  lines.push("## Review Checklist");
  lines.push("");
  for (const item of plan.review_checklist) lines.push(`- [ ] ${item}`);
  lines.push("");
  return lines.join("\n");
}

function printPlan(plan = {}) {
  console.log("DB Cleanup Execution Plan");
  console.log("=========================");
  console.log(`mode=${plan.execution_mode}`);
  console.log(`destructive_sql_executed=${plan.destructive_sql_executed}`);
  console.log(`safe_cleanup_candidates=${plan.summary.safe_cleanup_candidate_count}`);
  console.log(`manual_review_candidates=${plan.summary.manual_review_candidate_count}`);
  console.log(`blocked_candidates=${plan.summary.blocked_candidate_count}`);
  console.log(`estimated_rows_removable=${plan.summary.estimated_rows_removable}`);
  console.log(`storage_impact=${plan.summary.estimated_storage_impact}`);
  console.log(`wrote=${path.relative(ROOT, PLAN_JSON_PATH)}`);
  console.log(`wrote=${path.relative(ROOT, PLAN_DOC_PATH)}`);
}

const report = readJson(STORAGE_REPORT_PATH);
if (!report) {
  console.error(`Missing or invalid ${path.relative(ROOT, STORAGE_REPORT_PATH)}. Run npm run audit:db-cleanup or npm run update first.`);
  process.exit(1);
}

const plan = buildPlan(report);
writeJson(PLAN_JSON_PATH, plan);
writeText(PLAN_DOC_PATH, renderMarkdown(plan));
printPlan(plan);
