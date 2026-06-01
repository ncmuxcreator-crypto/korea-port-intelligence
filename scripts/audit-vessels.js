import fs from "fs";

const SUPABASE_URL = String(process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const REST_URL = SUPABASE_URL ? `${SUPABASE_URL}/rest/v1` : "";
const MAX_ROWS = positiveInt(process.env.AUDIT_VESSELS_MAX_ROWS, 25000);
const PAGE_SIZE = Math.min(1000, positiveInt(process.env.AUDIT_VESSELS_PAGE_SIZE, 1000));

const warnings = [];

function positiveInt(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback;
}

function clean(value) {
  return String(value ?? "").normalize("NFKC").trim();
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeName(value) {
  return clean(value)
    .toUpperCase()
    .replace(/^(M\/V|M\.V\.|MV|M\/T|MT|S\/S|SS)\s+/, "")
    .replace(/[^A-Z0-9가-힣]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function firstValue(row = {}, keys = []) {
  for (const key of keys) {
    const value = row?.[key];
    if (clean(value)) return value;
  }
  return "";
}

function rows(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.vessels)) return payload.vessels;
  if (Array.isArray(payload?.candidates)) return payload.candidates;
  if (Array.isArray(payload?.opportunities)) return payload.opportunities;
  if (Array.isArray(payload?.rows)) return payload.rows;
  return [];
}

function readJson(path, fallback = {}) {
  try {
    return fs.existsSync(path) ? JSON.parse(fs.readFileSync(path, "utf8")) : fallback;
  } catch (error) {
    warnings.push(`${path} is invalid JSON: ${error.message}`);
    return fallback;
  }
}

function parseContentRange(value) {
  const match = clean(value).match(/\/(\d+|\*)$/);
  if (!match || match[1] === "*") return null;
  const count = Number(match[1]);
  return Number.isFinite(count) ? count : null;
}

function urlFor(table, params = {}) {
  const url = new URL(`${REST_URL}/${table}`);
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    url.searchParams.append(key, value);
  }
  return url.toString();
}

async function rest(table, params = {}, options = {}) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return { ok: false, rows: [], count: null, error: "missing_supabase_env", status: 0 };
  }
  const response = await fetch(urlFor(table, params), {
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      accept: "application/json",
      ...options.headers
    }
  });
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
    rows: Array.isArray(body) ? body : [],
    count: parseContentRange(response.headers.get("content-range")),
    error: response.ok ? null : body?.message || body?.details || body?.hint || text || `http_${response.status}`
  };
}

async function fetchRows(table, { filters = {}, order = "", limit = null, maxRows = MAX_ROWS } = {}) {
  const out = [];
  let total = null;
  for (let offset = 0; offset < maxRows; offset += PAGE_SIZE) {
    const params = { select: "*", ...filters };
    if (order) params.order = order;
    if (limit) params.limit = String(limit);
    const rangeEnd = Math.min(offset + PAGE_SIZE - 1, maxRows - 1);
    const result = await rest(table, params, {
      headers: {
        prefer: offset === 0 ? "count=exact" : undefined,
        range: `${offset}-${rangeEnd}`
      }
    });
    if (!result.ok) return { ok: false, rows: out, count: total, sampled: false, error: result.error, status: result.status };
    if (offset === 0) total = result.count;
    out.push(...result.rows);
    if (limit || result.rows.length < PAGE_SIZE) break;
  }
  return { ok: true, rows: out, count: total ?? out.length, sampled: Number.isFinite(total) ? out.length < total : false };
}

async function countRows(table, filters = {}) {
  const result = await rest(table, { select: "*", ...filters }, {
    headers: { prefer: "count=exact", range: "0-0" }
  });
  return { ok: result.ok, count: result.ok ? result.count ?? result.rows.length : null, error: result.error, status: result.status };
}

async function latestRun() {
  const active = await fetchRows("active_dataset_pointer", { filters: { id: "eq.current" }, limit: 1, maxRows: 1 });
  const activeRunId = active.rows[0]?.active_run_id || "";
  if (activeRunId) {
    const runRows = await fetchRows("data_collection_runs", { filters: { run_id: `eq.${activeRunId}` }, limit: 1, maxRows: 1 });
    return { source: "active_dataset_pointer", run_id: activeRunId, row: runRows.rows[0] || {}, active_row: active.rows[0] || {} };
  }

  const latestRuns = await fetchRows("data_collection_runs", { order: "started_at.desc.nullslast", limit: 50, maxRows: 50 });
  const row = latestRuns.rows.find(item =>
    ["promoted", "completed", "promotable"].includes(clean(item.status).toLowerCase()) ||
    item.supabase_promoted === true ||
    item.promotion_status === "promoted"
  ) || latestRuns.rows[0] || {};
  return { source: "data_collection_runs", run_id: row.run_id || "", row, active_row: {} };
}

function score(row = {}) {
  return Number(
    row.commercial_value_score ??
    row.total_sales_priority_score ??
    row.cleaning_candidate_score ??
    row.lead_priority_score ??
    row.opportunity_score ??
    0
  );
}

function isDepartedRecord(row = {}) {
  const status = [
    row.status_bucket,
    row.operational_status,
    row.status,
    row.opportunity_status
  ].map(value => clean(value).toLowerCase()).join(" ");
  return /departed|left|completed|출항|완료/.test(status) || Boolean(row.atd);
}

function isHardCandidateExcluded(row = {}) {
  const text = [
    row.vessel_name,
    row.canonical_name,
    row.source,
    row.source_name,
    row.data_mode,
    row.commercial_relevance_status,
    row.exclusion_reason
  ].filter(Boolean).join(" ");
  return /sample|demo|fallback|synthetic/i.test(text) ||
    row.excluded_from_commercial_targets === true ||
    row.commercial_relevance_status === "excluded_non_commercial_type";
}

function hasCommercialRank(row = {}) {
  return Number.isFinite(Number(row.global_percentile)) || Number.isFinite(Number(row.port_percentile));
}

function withinCommercialPercentile(row = {}, limit) {
  const global = Number(row.global_percentile);
  const port = Number(row.port_percentile);
  return (Number.isFinite(global) && global <= limit) || (Number.isFinite(port) && port <= limit);
}

function hasCurrentOrNearTermWorkFeasibility(row = {}) {
  const status = clean(row.status_bucket || row.operational_status || row.status).toLowerCase();
  return Number(row.work_feasibility_score || row.cleaning_window_score || 0) >= 35 ||
    Number(row.work_window_hours || row.predicted_work_window_hours || 0) > 0 ||
    ["arrived_staying", "berthed", "anchorage_waiting"].includes(status) ||
    Boolean(row.is_anchorage_waiting) ||
    (Number(row.stay_hours || row.cumulative_stay_hours || 0) > 0 && !row.atd);
}

function isImmediateTargetRecord(row = {}) {
  if (isHardCandidateExcluded(row) || isDepartedRecord(row)) return false;
  if (row.is_immediate_candidate === true || ["critical", "immediate_target"].includes(clean(row.candidate_band))) return true;
  return score(row) >= 75 && withinCommercialPercentile(row, 10) && hasCurrentOrNearTermWorkFeasibility(row);
}

function isSalesTargetRecord(row = {}) {
  if (isHardCandidateExcluded(row) || isDepartedRecord(row)) return false;
  if (isImmediateTargetRecord(row)) return true;
  if (clean(row.candidate_band) === "sales_target") return true;
  return score(row) >= 65 && withinCommercialPercentile(row, 20);
}

function candidateExclusionReason(row = {}) {
  if (isHardCandidateExcluded(row)) return clean(row.exclusion_reason || row.commercial_relevance_status) || "hard_excluded";
  if (isDepartedRecord(row)) return "departed_or_atd_present";
  if (score(row) < 65) return "commercial_value_score < 65";
  if (!hasCommercialRank(row)) return "missing_candidate_rank: requires global_percentile or port_percentile before percentile filter";
  if (!withinCommercialPercentile(row, 20)) return "missing_or_outside_percentile: requires global_percentile <= 20 OR port_percentile <= 20";
  if (score(row) >= 75 && !hasCurrentOrNearTermWorkFeasibility(row)) return "immediate_only_blocked: missing current/near-term work feasibility";
  return "not_removed_by_sales_filter";
}

function groupBy(rowsToGroup, keyFn, { requireDifferent = null, limit = 20 } = {}) {
  const groups = new Map();
  for (const row of rowsToGroup) {
    const key = clean(keyFn(row));
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return [...groups.entries()]
    .filter(([, values]) => values.length > 1)
    .filter(([, values]) => !requireDifferent || new Set(values.map(requireDifferent).map(clean).filter(Boolean)).size > 1)
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, limit)
    .map(([key, values]) => ({ key, rows: values }));
}

function vesselType(row = {}) {
  return clean(firstValue(row, ["vessel_type_group", "vessel_type", "ship_type", "type"])).toUpperCase();
}

function vesselName(row = {}) {
  return clean(firstValue(row, ["vessel_name", "canonical_name", "normalized_vessel_name", "normalized_name", "ship_name", "name"]));
}

function imo(row = {}) {
  return clean(row.imo || row.imo_no).replace(/\D/g, "");
}

function mmsi(row = {}) {
  return clean(row.mmsi).replace(/\D/g, "");
}

function vesselIdentityQuality(masterRows = []) {
  const duplicateImo = groupBy(masterRows, imo);
  const duplicateMmsiNoImo = groupBy(masterRows.filter(row => !imo(row)), mmsi);
  const duplicateNameType = groupBy(masterRows, row => `${normalizeName(vesselName(row))}|${vesselType(row)}`);
  return {
    duplicate_imo_groups: duplicateImo,
    duplicate_mmsi_without_imo_groups: duplicateMmsiNoImo,
    duplicate_name_type_groups: duplicateNameType,
    vessels_missing_imo: masterRows.filter(row => !imo(row)).length,
    vessels_missing_mmsi: masterRows.filter(row => !mmsi(row)).length,
    vessels_missing_both_imo_mmsi: masterRows.filter(row => !imo(row) && !mmsi(row)).length
  };
}

function suspiciousDuplicateGroups(masterRows = []) {
  return {
    same_imo_different_names: groupBy(masterRows, imo, { requireDifferent: vesselName, limit: 20 }),
    same_mmsi_different_names: groupBy(masterRows, mmsi, { requireDifferent: vesselName, limit: 20 }),
    same_name_different_identity: groupBy(masterRows, row => normalizeName(vesselName(row)), {
      requireDifferent: row => `${imo(row) || "-"}|${mmsi(row) || "-"}`,
      limit: 20
    })
  };
}

function candidateFunnel(snapshotRows = [], opportunityCount, salesCurrentCount, immediateCurrentCount) {
  const steps = [
    { name: "all_vessels", rows: snapshotRows, condition: "all latest vessel_snapshots" },
    { name: "opportunity_score > 0", rows: snapshotRows.filter(row => score(row) > 0), condition: "commercialScore(record) > 0" },
    { name: "commercial_score >= 65", rows: snapshotRows.filter(row => score(row) >= 65), condition: "commercialScore(record) >= 65" },
    { name: "not_hard_excluded", rows: snapshotRows.filter(row => score(row) >= 65 && !isHardCandidateExcluded(row)), condition: "!isHardCandidateExcluded(record)" },
    { name: "not_departed", rows: snapshotRows.filter(row => score(row) >= 65 && !isHardCandidateExcluded(row) && !isDepartedRecord(row)), condition: "!isDepartedRecord(record)" },
    { name: "has commercial rank", rows: snapshotRows.filter(row => score(row) >= 65 && !isHardCandidateExcluded(row) && !isDepartedRecord(row) && hasCommercialRank(row)), condition: "global_percentile exists OR port_percentile exists" },
    { name: "sales percentile <= 20", rows: snapshotRows.filter(row => score(row) >= 65 && !isHardCandidateExcluded(row) && !isDepartedRecord(row) && hasCommercialRank(row) && withinCommercialPercentile(row, 20)), condition: "global_percentile <= 20 OR port_percentile <= 20" },
    { name: "sales target predicate", rows: snapshotRows.filter(isSalesTargetRecord), condition: "isSalesTargetRecord(record)" },
    { name: "immediate target predicate", rows: snapshotRows.filter(isImmediateTargetRecord), condition: "isImmediateTargetRecord(record)" }
  ];

  const removalSteps = [];
  for (let index = 1; index < steps.length; index += 1) {
    removalSteps.push({
      step: steps[index].name,
      condition: steps[index].condition,
      before_count: steps[index - 1].rows.length,
      after_count: steps[index].rows.length,
      removed_count: Math.max(0, steps[index - 1].rows.length - steps[index].rows.length)
    });
  }

  const removedReasons = snapshotRows
    .filter(row => score(row) >= 65 && !isSalesTargetRecord(row))
    .reduce((acc, row) => {
      const reason = candidateExclusionReason(row);
      acc[reason] = (acc[reason] || 0) + 1;
      return acc;
    }, {});

  return {
    opportunity_master_count: opportunityCount,
    vessels_with_opportunity_score: snapshotRows.filter(row => score(row) > 0).length,
    vessels_passing_hot_threshold: snapshotRows.filter(row => score(row) >= 75).length,
    vessels_passing_warm_threshold: snapshotRows.filter(row => score(row) >= 65).length,
    filtering_steps: removalSteps,
    sales_candidates_current_count: salesCurrentCount,
    immediate_targets_current_count: immediateCurrentCount,
    expected_sales_candidates_from_snapshots: steps.find(step => step.name === "sales target predicate")?.rows.length || 0,
    expected_immediate_targets_from_snapshots: steps.find(step => step.name === "immediate target predicate")?.rows.length || 0,
    removed_reason_counts: removedReasons,
    zero_candidate_cause: zeroCandidateCause({ snapshotRows, opportunityCount, salesCurrentCount, steps })
  };
}

function zeroCandidateCause({ snapshotRows, opportunityCount, salesCurrentCount, steps }) {
  if (!(Number(opportunityCount || 0) > 0 && Number(salesCurrentCount || 0) === 0)) return null;
  if (!snapshotRows.length) return "opportunity_master > 0 but vessel_snapshots for latest_successful_run_id are empty";
  const salesStep = steps.find(step => step.name === "sales target predicate");
  if (salesStep?.rows.length > 0) return "records pass isSalesTargetRecord(record), but sales_candidates_current is empty for the audited run_id";
  for (const step of steps.slice(1)) {
    if (step.rows.length === 0) return `first zero-count filter: ${step.condition}`;
  }
  const topReason = Object.entries(snapshotRows
    .filter(row => score(row) >= 65)
    .map(candidateExclusionReason)
    .reduce((acc, reason) => {
      acc[reason] = (acc[reason] || 0) + 1;
      return acc;
    }, {})).sort((a, b) => b[1] - a[1])[0];
  return topReason ? `dominant removal condition: ${topReason[0]}` : "no row satisfies isSalesTargetRecord(record)";
}

function runIdFromStatic(payload = {}) {
  return clean(payload.run_id || payload.active_run_id || payload.latest_successful_run_id || payload.status_run_id || payload.summary_run_id || payload.status?.active_run_id);
}

function topOpportunitiesCount(payload = {}) {
  return rows(payload.opportunities || payload).length;
}

function staticMismatchAudit({ run, snapshotCount, opportunityCount }) {
  const summary = readJson("dashboard/api/dashboard-summary.json", {});
  const status = readJson("dashboard/api/status.json", {});
  const top = readJson("dashboard/api/candidates/top.json", {});
  const jsonRunId = runIdFromStatic(summary) || runIdFromStatic(status);
  const jsonRecordCount = numberOrNull(summary.record_count);
  const jsonAllCount = numberOrNull(summary.all_vessels_count ?? status.all_vessels_count);
  const topCount = topOpportunitiesCount(top);
  const statusMode = clean(status.data_mode || summary.data_mode || summary.status?.data_mode);

  const checks = [
    {
      label: "run_id",
      db: run.run_id || "unknown",
      json: jsonRunId || "missing",
      mismatch: Boolean(run.run_id && jsonRunId && run.run_id !== jsonRunId),
      reason: "static JSON run_id differs from active/promoted DB run"
    },
    {
      label: "vessel_count",
      db: snapshotCount,
      json: jsonAllCount ?? jsonRecordCount ?? "missing",
      mismatch: Number(snapshotCount || 0) > 0 && Number(jsonAllCount ?? jsonRecordCount ?? 0) === 0,
      reason: "static JSON has placeholder/zero vessel count while DB has promoted vessels"
    },
    {
      label: "record_count",
      db: run.row?.target_vessels_count ?? snapshotCount,
      json: jsonRecordCount ?? "missing",
      mismatch: Number(snapshotCount || 0) > 0 && Number(jsonRecordCount ?? 0) === 0,
      reason: "dashboard-summary.record_count is zero while DB has live vessels"
    },
    {
      label: "opportunity_count",
      db: opportunityCount,
      json: topCount,
      mismatch: Number(opportunityCount || 0) > 0 && Number(topCount || 0) === 0,
      reason: "candidates/top.json opportunities are empty while opportunity_master has rows"
    },
    {
      label: "status.data_mode",
      db: run.row?.status || run.row?.promotion_status || "promoted/active",
      json: statusMode || "missing",
      mismatch: Number(snapshotCount || 0) > 0 && /no_live_data|sample|placeholder/i.test(statusMode),
      reason: "status data_mode indicates no live data while DB has promoted real data"
    }
  ];

  for (const check of checks) {
    if (check.mismatch) warnings.push(`${check.label}: ${check.reason}`);
  }

  return { summary, status, top, checks, jsonRunId, jsonRecordCount, jsonAllCount, topCount, statusMode };
}

function printGroup(group) {
  return {
    key: group.key,
    count: group.rows.length,
    examples: group.rows.slice(0, 5).map(row => ({
      vessel_name: vesselName(row),
      imo: imo(row) || "-",
      mmsi: mmsi(row) || "-",
      type: vesselType(row) || "-",
      master_vessel_id: row.master_vessel_id || row.vessel_id || "-"
    }))
  };
}

function printDuplicateGroups(title, groups, limit = 20) {
  console.log(`- ${title}: ${groups.length}`);
  for (const group of groups.slice(0, limit)) {
    console.log(`  - ${JSON.stringify(printGroup(group))}`);
  }
}

function printSection(title) {
  console.log("");
  console.log(title);
  console.log("-".repeat(title.length));
}

async function main() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    warnings.push("SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing; DB sections will be unavailable.");
  }

  const run = await latestRun();
  const runFilter = run.run_id ? { run_id: `eq.${run.run_id}` } : {};
  const [
    vesselSnapshots,
    vesselMaster,
    portCalls,
    opportunities,
    dashboardSnapshots,
    salesCurrent,
    immediateCurrent
  ] = await Promise.all([
    fetchRows("vessel_snapshots", { filters: runFilter }),
    fetchRows("vessel_master"),
    countRows("port_call_master", runFilter),
    fetchRows("opportunity_master", { filters: runFilter }),
    fetchRows("dashboard_summary_snapshots", { filters: runFilter, limit: 1, maxRows: 1 }),
    countRows("sales_candidates_current", runFilter),
    countRows("immediate_targets_current", runFilter)
  ]);

  const snapshotRows = vesselSnapshots.rows;
  const masterRows = vesselMaster.rows;
  const masterIds = new Set(masterRows.map(row => clean(row.master_vessel_id || row.vessel_id)).filter(Boolean));
  const linkedMasterCount = snapshotRows.filter(row => masterIds.has(clean(row.master_vessel_id || row.vessel_id))).length;
  const runSourceRows = numberOrNull(run.row?.source_rows_collected ?? run.row?.raw_collected_rows ?? run.row?.total_rows);
  const runNormalizedRows = numberOrNull(run.row?.normalized_rows);
  const runAllVessels = numberOrNull(run.row?.all_vessels_count);
  const vesselMasterCount = vesselMaster.count ?? masterRows.length;
  const duplicateReduction = Math.max(0, Number(runSourceRows ?? snapshotRows.length) - Number(runNormalizedRows ?? snapshotRows.length));
  const identity = vesselIdentityQuality(masterRows);
  const suspicious = suspiciousDuplicateGroups(masterRows);
  const funnel = candidateFunnel(snapshotRows, opportunities.count ?? opportunities.rows.length, salesCurrent.count, immediateCurrent.count);
  const mismatch = staticMismatchAudit({
    run,
    snapshotCount: vesselSnapshots.count ?? snapshotRows.length,
    opportunityCount: opportunities.count ?? opportunities.rows.length
  });

  console.log("Vessel Data Integrity Audit");
  console.log("===========================");
  console.log(`mode: ${SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY ? "supabase" : "static_only"}`);
  console.log(`latest_successful_run_id: ${run.run_id || "unknown"}`);
  console.log(`latest_run_source: ${run.source || "unknown"}`);

  printSection("1. Raw to normalized vessel flow");
  console.log(`- source_rows_collected: ${runSourceRows ?? "unknown"}`);
  console.log(`- normalized_rows: ${runNormalizedRows ?? "unknown"}`);
  console.log(`- all_vessels_count: ${runAllVessels ?? vesselSnapshots.count ?? snapshotRows.length}`);
  console.log(`- vessel_master_count: ${vesselMasterCount ?? "unknown"}`);
  console.log(`- duplicate_reduction_count: ${duplicateReduction}`);

  printSection("2. Vessel identity quality");
  console.log(`- duplicate IMO in vessel_master: ${identity.duplicate_imo_groups.length}`);
  console.log(`- duplicate MMSI where IMO is null: ${identity.duplicate_mmsi_without_imo_groups.length}`);
  console.log(`- duplicate normalized_vessel_name + vessel_type: ${identity.duplicate_name_type_groups.length}`);
  console.log(`- vessels missing IMO: ${identity.vessels_missing_imo}`);
  console.log(`- vessels missing MMSI: ${identity.vessels_missing_mmsi}`);
  console.log(`- vessels missing both IMO and MMSI: ${identity.vessels_missing_both_imo_mmsi}`);

  printSection("3. Latest run consistency");
  console.log(`- latest_successful_run_id: ${run.run_id || "unknown"}`);
  console.log(`- vessel_snapshots count: ${vesselSnapshots.count ?? snapshotRows.length}`);
  console.log(`- vessel_master linked count: ${linkedMasterCount}`);
  console.log(`- port_call_master count: ${portCalls.count ?? "unknown"}`);
  console.log(`- opportunity_master count: ${opportunities.count ?? opportunities.rows.length}`);
  console.log(`- dashboard_summary_snapshots record_count: ${dashboardSnapshots.rows[0]?.record_count ?? "missing"}`);
  console.log(`- active_dataset_pointer run_id: ${run.active_row?.active_run_id || (run.source === "active_dataset_pointer" ? run.run_id : "missing")}`);

  printSection("4. Candidate funnel");
  console.log(`- opportunity_master count: ${funnel.opportunity_master_count}`);
  console.log(`- vessels with opportunity_score: ${funnel.vessels_with_opportunity_score}`);
  console.log(`- vessels passing HOT threshold: ${funnel.vessels_passing_hot_threshold}`);
  console.log(`- vessels passing WARM threshold: ${funnel.vessels_passing_warm_threshold}`);
  console.log("- vessels removed by each filter:");
  for (const step of funnel.filtering_steps) {
    console.log(`  - ${step.step}: before=${step.before_count}, after=${step.after_count}, removed=${step.removed_count}, condition=${step.condition}`);
  }
  console.log(`- sales_candidates_current count: ${funnel.sales_candidates_current_count ?? "unknown"}`);
  console.log(`- immediate_targets_current count: ${funnel.immediate_targets_current_count ?? "unknown"}`);
  console.log(`- expected_sales_candidates_from_snapshots: ${funnel.expected_sales_candidates_from_snapshots}`);
  console.log(`- expected_immediate_targets_from_snapshots: ${funnel.expected_immediate_targets_from_snapshots}`);
  if (funnel.zero_candidate_cause) {
    console.log(`- ZERO CANDIDATE CAUSE: ${funnel.zero_candidate_cause}`);
    console.log("- exact filter: !isHardCandidateExcluded(record) AND !isDepartedRecord(record) AND (isImmediateTargetRecord(record) OR candidate_band='sales_target' OR (commercialScore(record)>=65 AND (global_percentile<=20 OR port_percentile<=20)))");
  }
  console.log("- high score removed reason counts:");
  const reasons = Object.entries(funnel.removed_reason_counts).sort((a, b) => b[1] - a[1]);
  if (!reasons.length) console.log("  - none");
  for (const [reason, count] of reasons) console.log(`  - ${reason}: ${count}`);

  printSection("5. DB vs static JSON mismatch");
  console.log(`- latest DB run_id: ${run.run_id || "unknown"}`);
  console.log(`- dashboard/api/dashboard-summary.json run_id: ${mismatch.jsonRunId || "missing"}`);
  console.log(`- DB vessel count: ${vesselSnapshots.count ?? snapshotRows.length}`);
  console.log(`- JSON record_count: ${mismatch.jsonRecordCount ?? "missing"}`);
  console.log(`- JSON all_vessels_count: ${mismatch.jsonAllCount ?? "missing"}`);
  console.log(`- DB opportunity count: ${opportunities.count ?? opportunities.rows.length}`);
  console.log(`- candidates/top.json opportunity count: ${mismatch.topCount}`);
  console.log(`- status.data_mode: ${mismatch.statusMode || "missing"}`);
  for (const check of mismatch.checks) {
    console.log(`  - ${check.label}: DB=${check.db}, JSON=${check.json}, ${check.mismatch ? "MISMATCH" : "match"}${check.mismatch ? `, reason=${check.reason}` : ""}`);
  }

  printSection("6. Suspicious duplicate groups");
  printDuplicateGroups("same IMO with different names", suspicious.same_imo_different_names);
  printDuplicateGroups("same MMSI with different names", suspicious.same_mmsi_different_names);
  printDuplicateGroups("same name with different IMO/MMSI", suspicious.same_name_different_identity);

  printSection("Warnings");
  if (!warnings.length) {
    console.log("- none");
  } else {
    for (const warning of warnings) console.log(`- WARNING: ${warning}`);
  }
}

main().catch(error => {
  console.error("Vessel Data Integrity Audit");
  console.error("===========================");
  console.error(`CRITICAL: ${error?.stack || error?.message || String(error)}`);
  process.exit(1);
});
