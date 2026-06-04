import fs from "fs";
import { normalizePort } from "./lib/port-statistics.js";

const SUPABASE_URL = String(process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const REST_URL = SUPABASE_URL ? `${SUPABASE_URL}/rest/v1` : "";
const PAGE_SIZE = 1000;

const findings = [];

function readJson(file, fallback = null) {
  for (const candidate of [file, file.replace("dashboard/api/", "dashboard/api/debug/")]) {
    try {
      if (fs.existsSync(candidate)) return JSON.parse(fs.readFileSync(candidate, "utf8"));
    } catch (error) {
      return { __invalid_json: true, __error: error.message };
    }
  }
  return fallback;
}

function rows(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.vessels)) return payload.vessels;
  if (Array.isArray(payload?.candidates)) return payload.candidates;
  if (Array.isArray(payload?.opportunities)) return payload.opportunities;
  if (Array.isArray(payload?.ports)) return payload.ports;
  return [];
}

function numberOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizedName(value) {
  return String(value || "")
    .normalize("NFKC")
    .toUpperCase()
    .replace(/[^A-Z0-9가-힣]+/g, "");
}

function clean(value) {
  const text = String(value ?? "").trim();
  return text ? text : "";
}

function identityKeys(row = {}) {
  const keys = [];
  const imo = clean(row.imo || row.imo_no);
  const mmsi = clean(row.mmsi);
  const master = clean(row.master_vessel_id || row.entity_id || row.hybrid_entity_key || row.vessel_id);
  const name = normalizedName(row.vessel_name || row.canonical_name || row.normalized_name || row.entity_id);
  if (imo) keys.push(`IMO:${imo}`);
  if (mmsi) keys.push(`MMSI:${mmsi}`);
  if (master) keys.push(`MASTER:${master}`);
  if (name) keys.push(`NAME:${name}`);
  return keys;
}

function indexRows(sourceRows = []) {
  const map = new Map();
  for (const row of sourceRows) {
    for (const key of identityKeys(row)) {
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(row);
    }
  }
  return map;
}

function matchedRows(index, item) {
  const seen = new Set();
  const out = [];
  for (const key of identityKeys(item)) {
    for (const row of index.get(key) || []) {
      const id = row.id || row.master_vessel_id || row.opportunity_id || row.explainability_id || row.evaluation_id || JSON.stringify(row).slice(0, 80);
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(row);
    }
  }
  return out;
}

async function rest(path) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return { ok: false, rows: [], count: null, error: "missing_supabase_env" };
  const response = await fetch(`${SUPABASE_URL}${path}`, {
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      prefer: "count=exact"
    }
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : [];
  } catch {
    data = [];
  }
  const range = response.headers.get("content-range") || "";
  const count = range.includes("/") ? Number(range.split("/").pop()) : Array.isArray(data) ? data.length : null;
  return { ok: response.ok, rows: Array.isArray(data) ? data : [], count, error: response.ok ? null : text || response.statusText };
}

async function fetchRows(table, { select = "*", filters = "", maxRows = 5000, order = "" } = {}) {
  const out = [];
  for (let offset = 0; offset < maxRows; offset += PAGE_SIZE) {
    const params = [`select=${encodeURIComponent(select)}`];
    if (filters) params.push(filters.replace(/^&/, ""));
    if (order) params.push(`order=${encodeURIComponent(order)}`);
    params.push(`limit=${PAGE_SIZE}`);
    params.push(`offset=${offset}`);
    const result = await rest(`/rest/v1/${table}?${params.join("&")}`);
    if (!result.ok) return { ...result, rows: out };
    out.push(...result.rows);
    if (result.rows.length < PAGE_SIZE) return { ok: true, rows: out, count: result.count ?? out.length, error: null };
  }
  return { ok: true, rows: out, count: out.length, sampled: true, error: null };
}

function printLine({ ui, json, db, status, reason = "" }) {
  console.log(`${ui} | JSON: ${json} | DB: ${db} | ${status}${reason ? ` | ${reason}` : ""}`);
}

function addFinding(level, ui, reason) {
  findings.push({ level, ui, reason });
}

function compareNumber(ui, jsonSource, jsonValue, dbSource, dbValue, { tolerance = 0 } = {}) {
  const j = numberOrNull(jsonValue);
  const d = numberOrNull(dbValue);
  const match = j !== null && d !== null && Math.abs(j - d) <= tolerance;
  printLine({
    ui,
    json: `${jsonSource}=${j ?? "missing"}`,
    db: `${dbSource}=${d ?? "missing"}`,
    status: match ? "match" : "mismatch",
    reason: match ? "" : "visible KPI is not fully aligned"
  });
  if (!match) addFinding("warning", ui, `JSON ${j ?? "missing"} vs DB ${d ?? "missing"}`);
}

function dashboardSalesTargetCount(sourceRows = []) {
  return sourceRows.filter(row => {
    const score = numberOrNull(row.commercial_value_score ?? row.total_sales_priority_score ?? row.cleaning_candidate_score ?? row.opportunity_score);
    if (score === null || score < 65) return false;
    const statusText = [
      row.status_bucket,
      row.vessel_status,
      row.status,
      row.opportunity_status
    ].map(value => String(value || "").toLowerCase()).join(" ");
    return !/departed|left|completed|excluded|제외|출항완료/.test(statusText);
  }).length;
}

function hasReason(row = {}) {
  return Boolean(
    clean(row.why_now) ||
    clean(row.why_scored_high) ||
    clean(row.recommended_action) ||
    clean(row.explanation_ko) ||
    (Array.isArray(row.score_reasons) && row.score_reasons.length) ||
    (Array.isArray(row.reason_codes) && row.reason_codes.length) ||
    (Array.isArray(row.rule_hits) && row.rule_hits.length) ||
    (row.payload && Object.keys(row.payload || {}).length)
  );
}

function generatedAt(payload = {}) {
  return payload.generated_at || payload.completed_at || payload.status?.generated_at || null;
}

function dateValue(value) {
  const time = Date.parse(value || "");
  return Number.isFinite(time) ? time : null;
}

async function main() {
  const summary = readJson("dashboard/api/dashboard-summary.json", {});
  const status = readJson("dashboard/api/status.json", {});
  const salesPriority = readJson("dashboard/api/intelligence/sales-priority.json", {});
  const allCollected = readJson("dashboard/api/all-collected-vessels.json", []);
  const targetVessels = readJson("dashboard/api/target-vessels.json", []);
  const staticAllRows = rows(allCollected);
  const staticTargetRows = rows(targetVessels);

  const activePointer = await fetchRows("active_dataset_pointer", { filters: "id=eq.current", maxRows: 1 });
  const activeRunId = activePointer.rows[0]?.active_run_id || summary.active_run_id || status.active_run_id || summary.run_id;
  const latestRun = activeRunId
    ? await fetchRows("data_collection_runs", { filters: `run_id=eq.${encodeURIComponent(activeRunId)}`, maxRows: 1 })
    : await fetchRows("data_collection_runs", { filters: "status=in.(completed,promoted)", order: "finished_at.desc.nullslast", maxRows: 1 });
  const run = latestRun.rows[0] || {};
  const runId = activeRunId || run.run_id || summary.run_id || status.run_id;
  const runFilter = `run_id=eq.${encodeURIComponent(runId || "")}`;

  const [
    vesselSnapshots,
    vesselMaster,
    opportunityMaster,
    explainabilitySnapshots,
    ruleEvaluations,
    portSummaryCurrent
  ] = await Promise.all([
    fetchRows("vessel_snapshots", { filters: runFilter, maxRows: 6000 }),
    fetchRows("vessel_master", { maxRows: 6000 }),
    fetchRows("opportunity_master", { filters: runFilter, maxRows: 6000 }),
    fetchRows("explainability_snapshots", { filters: runFilter, maxRows: 6000 }),
    fetchRows("rule_evaluations", { filters: runFilter, maxRows: 6000 }),
    fetchRows("port_summary_current", { filters: runFilter, maxRows: 1000 })
  ]);

  const salesCurrent = await fetchRows("sales_candidates_current", { filters: runFilter, maxRows: 6000 });
  const immediateCurrent = await fetchRows("immediate_targets_current", { filters: runFilter, maxRows: 6000 });

  console.log("End-to-End Dashboard Truth Audit");
  console.log("================================");
  console.log(`run_id: ${runId || "unknown"}`);
  console.log(`db_available: ${Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY)}`);
  console.log("");

  console.log("1. Dashboard visible numbers");
  compareNumber("총 선박", "dashboard-summary.all_vessels_count", summary.all_vessels_count, "vessel_snapshots latest run", vesselSnapshots.rows.length);
  compareNumber("영업대상", "dashboard-summary.record_count", summary.record_count, "data_collection_runs.target_vessels_count", run.target_vessels_count ?? staticTargetRows.length);
  compareNumber("영업 후보", "dashboard-summary.sales_target_count", summary.sales_target_count, "sales_candidates_current", salesCurrent.rows.length);
  compareNumber("즉시영업후보", "dashboard-summary.immediate_target_count", summary.immediate_target_count, "immediate_targets_current", immediateCurrent.rows.length);
  compareNumber("항만 수", "dashboard-summary.port_count", summary.port_count, "port_summary_current normalized ports", portSummaryCurrent.rows.length || rows(summary.ports).length);
  console.log("");

  console.log("2. Sales priority cards");
  const masterIndex = indexRows(vesselMaster.rows);
  const snapshotIndex = indexRows(vesselSnapshots.rows);
  const opportunityIndex = indexRows(opportunityMaster.rows);
  const explainabilityIndex = indexRows(explainabilitySnapshots.rows);
  const ruleIndex = indexRows(ruleEvaluations.rows);
  const priorityItems = rows(salesPriority);
  const seenImo = new Set();
  const seenMmsi = new Set();
  for (const item of priorityItems) {
    const label = `${item.rank || "?"}. ${item.vessel_name || "unknown"}`;
    const imo = clean(item.imo);
    const mmsi = clean(item.mmsi);
    if (imo && seenImo.has(imo)) addFinding("error", label, `duplicate IMO ${imo}`);
    if (mmsi && seenMmsi.has(mmsi)) addFinding("error", label, `duplicate MMSI ${mmsi}`);
    if (imo) seenImo.add(imo);
    if (mmsi) seenMmsi.add(mmsi);

    const masterMatch = matchedRows(masterIndex, item);
    const snapshotMatch = matchedRows(snapshotIndex, item);
    const opportunityMatch = matchedRows(opportunityIndex, item).filter(row => numberOrNull(row.commercial_value_score ?? row.lead_priority_score ?? row.predicted_cleaning_opportunity_score) !== null);
    const reasonMatch = [
      ...matchedRows(explainabilityIndex, item),
      ...matchedRows(ruleIndex, item)
    ].some(hasReason);
    const supported = masterMatch.length && snapshotMatch.length && opportunityMatch.length && reasonMatch && clean(item.reason_summary);
    printLine({
      ui: label,
      json: "dashboard/api/intelligence/sales-priority.json",
      db: [
        `vessel_master=${masterMatch.length ? "yes" : "no"}`,
        `vessel_snapshots=${snapshotMatch.length ? "yes" : "no"}`,
        `opportunity_master=${opportunityMatch.length ? "yes" : "no"}`,
        `explainability/rules=${reasonMatch ? "yes" : "no"}`
      ].join(", "),
      status: supported ? "match" : "mismatch",
      reason: supported ? "" : "sales priority card is not fully DB-backed"
    });
    if (!supported) addFinding("error", label, "sales priority card is not fully DB-backed");
  }
  if (!priorityItems.length) addFinding("warning", "오늘의 영업 우선순위", "no visible sales priority cards");
  console.log("");

  console.log("3. Port summary");
  const normalizedPorts = new Map();
  let unknownCount = 0;
  let missingPort = 0;
  for (const row of vesselSnapshots.rows) {
    const raw = clean(row.port_code || row.port_name || row.port);
    if (!raw) {
      missingPort += 1;
      continue;
    }
    const port = normalizePort(raw);
    const key = port.port_code || port.port_name || "UNKNOWN";
    normalizedPorts.set(key, port);
    if (key === "UNKNOWN") unknownCount += 1;
  }
  const summaryPortNames = rows(summary.ports).map(port => port.display_name || port.port_name).filter(Boolean);
  const duplicateDisplayNames = summaryPortNames.filter((name, index) => summaryPortNames.indexOf(name) !== index);
  compareNumber("항만 표시 수", "dashboard-summary.port_count", summary.port_count, "normalized unique port count", normalizedPorts.size);
  printLine({
    ui: "항만 별칭 정규화",
    json: `display_names=${summaryPortNames.length}`,
    db: `duplicates=${duplicateDisplayNames.length}, unknown=${unknownCount}, missing_port=${missingPort}`,
    status: duplicateDisplayNames.length ? "mismatch" : "match",
    reason: duplicateDisplayNames.length ? `duplicate aliases: ${duplicateDisplayNames.join(", ")}` : "aliases normalized"
  });
  if (duplicateDisplayNames.length) addFinding("error", "항만 별칭 정규화", duplicateDisplayNames.join(", "));
  console.log("");

  console.log("4. Hidden intelligence sections");
  const visibleIntelligence = [
    ["오늘의 영업 우선순위", "dashboard/api/intelligence/sales-priority.json"],
    ["리스크 분석", "dashboard/api/intelligence/risk-summary.json"],
    ["예측 신호", "dashboard/api/intelligence/prediction-summary.json"],
    ["점수 설명", "dashboard/api/intelligence/explainability.json"],
    ["항로 인사이트", "dashboard/api/intelligence/route-summary.json"],
    ["선사/운영사 인사이트", "dashboard/api/intelligence/operator-summary.json"],
    ["상업 기회", "dashboard/api/intelligence/commercial-summary.json"]
  ];
  for (const [label, file] of visibleIntelligence) {
    const payload = readJson(file, null);
    const ok = payload && !payload.__invalid_json && numberOrNull(payload.record_count) !== null && Number(payload.record_count) > 0 && clean(payload.source_table) && clean(payload.generated_at);
    printLine({
      ui: label,
      json: file,
      db: payload?.source_table || "missing",
      status: ok ? "match" : "mismatch",
      reason: ok ? "" : "visible intelligence section missing generated_at/source_table/record_count"
    });
    if (!ok) addFinding("warning", label, "visible intelligence section is empty or incomplete");
  }
  console.log("");

  console.log("5. Staleness check");
  const dbFinished = dateValue(run.finished_at || run.promoted_at);
  const summaryGenerated = dateValue(generatedAt(summary));
  const statusGenerated = dateValue(generatedAt(status));
  const fallbackUsed = Boolean(summary.fallback_used || status.fallback_used || String(summary.data_mode || status.data_mode || "").includes("sample"));
  const staleSummary = dbFinished && summaryGenerated && summaryGenerated + 60_000 < dbFinished;
  const staleStatus = dbFinished && statusGenerated && statusGenerated + 60_000 < dbFinished;
  const staticAllMismatch = staticAllRows.length && numberOrNull(run.all_vessels_count) !== null && staticAllRows.length !== Number(run.all_vessels_count);
  const staticTargetMismatch = staticTargetRows.length && numberOrNull(run.target_vessels_count) !== null && staticTargetRows.length !== Number(run.target_vessels_count);
  for (const check of [
    ["dashboard-summary generated_at", staleSummary, `json=${generatedAt(summary) || "missing"} db=${run.finished_at || run.promoted_at || "missing"}`],
    ["status generated_at", staleStatus, `json=${generatedAt(status) || "missing"} db=${run.finished_at || run.promoted_at || "missing"}`],
    ["fallback while DB live", fallbackUsed && vesselSnapshots.rows.length > 0, `fallback_used=${fallbackUsed}`],
    ["static all-vessels count", staticAllMismatch, `static=${staticAllRows.length} db=${run.all_vessels_count}`],
    ["static target-vessels count", staticTargetMismatch, `static=${staticTargetRows.length} db=${run.target_vessels_count}`]
  ]) {
    printLine({
      ui: check[0],
      json: "static dashboard JSON",
      db: "latest successful DB run",
      status: check[1] ? "mismatch" : "match",
      reason: check[1] ? check[2] : ""
    });
    if (check[1]) addFinding("warning", check[0], check[2]);
  }

  console.log("");
  console.log("Findings");
  console.log("--------");
  if (!findings.length) {
    console.log("No unsupported visible dashboard fields found.");
  } else {
    for (const finding of findings) console.log(`- ${finding.level.toUpperCase()} ${finding.ui}: ${finding.reason}`);
  }

  const errors = findings.filter(finding => finding.level === "error");
  if (errors.length) process.exitCode = 1;
}

main().catch(error => {
  console.error(error?.stack || error?.message || error);
  process.exit(1);
});
