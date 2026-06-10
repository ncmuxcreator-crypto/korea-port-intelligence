#!/usr/bin/env node

import fs from "fs";
import path from "path";

const ROOT = process.cwd();
const DASHBOARD_HTML = path.join(ROOT, "dashboard", "index.html");

function readJson(relativePath) {
  const file = path.join(ROOT, ...relativePath.split("/"));
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function meaningful(value) {
  if (value === undefined || value === null) return false;
  const text = String(value).normalize("NFKC").trim();
  if (!text) return false;
  return ![
    "-",
    "--",
    "0",
    "unknown",
    "UNKNOWN",
    "null",
    "undefined",
    "n/a",
    "N/A",
    "none",
    "확인 필요",
    "미확인",
    "정보 없음",
    "없음",
    "선사 확인 필요",
    "운영사 확인 필요"
  ].includes(text);
}

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function items(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.vessels)) return payload.vessels;
  if (Array.isArray(payload?.candidates)) return payload.candidates;
  if (Array.isArray(payload?.opportunities)) return payload.opportunities;
  return [];
}

function flatten(row = {}) {
  return { ...row, ...(row.vessel_display || {}) };
}

function firstNumber(row, aliases = []) {
  for (const key of aliases) {
    const value = row?.[key] ?? row?.vessel_display?.[key];
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function first(row, aliases = []) {
  const display = row?.vessel_display || {};
  for (const key of aliases) {
    const value = row?.[key] ?? display?.[key];
    if (meaningful(value)) return value;
  }
  return "";
}

function coverage(rows, aliases) {
  const total = rows.length || 0;
  const count = rows.filter(row => meaningful(first(row, aliases))).length;
  return {
    count,
    total,
    percent: total ? Math.round((count / total) * 1000) / 10 : 0
  };
}

function score(row = {}) {
  return Math.max(
    firstNumber(row, ["opportunity_score", "commercial_value_score", "total_sales_priority_score", "cleaning_candidate_score"]),
    firstNumber(row, ["salesScore"])
  );
}

function risk(row = {}) {
  return Math.max(
    firstNumber(row, ["risk_score", "biofouling_risk_score", "biofouling_score", "biofouling_exposure_score", "operational_risk_score"]),
    firstNumber(row, ["compliance_score", "compliance_exposure_score"])
  );
}

function stayHours(row = {}) {
  return Math.max(
    firstNumber(row, ["stay_hours", "current_call_stay_hours", "cumulative_stay_hours", "port_stay_hours", "berth_hours"]),
    firstNumber(row, ["stay_days", "dwell_days"]) * 24
  );
}

function anchorageHours(row = {}) {
  return firstNumber(row, ["anchorage_hours", "waiting_hours", "estimated_waiting_time"]);
}

function hasLongStayRisk(row = {}) {
  return stayHours(row) >= 72 ||
    anchorageHours(row) >= 48 ||
    firstNumber(row, ["waiting_score", "dwell_score"]) >= 60;
}

function hasPortOrEta(row = {}) {
  return meaningful(first(row, ["port_code", "port_name", "port", "current_port", "destination_port", "destination"])) ||
    meaningful(first(row, ["eta", "etb", "ata", "atb", "arrival_time", "predicted_arrival_time"]));
}

function isDeparted(row = {}) {
  const text = String(first(row, ["status_bucket", "status", "operational_status", "port_call_status", "movement_status"])).toLowerCase();
  return meaningful(first(row, ["atd", "actual_departure", "departure_time"])) ||
    /departed|sail|sailed|left|출항|출항완료/.test(text);
}

function strongSignalCodes(row = {}) {
  const value = score(row);
  const riskValue = risk(row);
  const gt = firstNumber(row, ["gt", "grtg", "intrlGrtg", "gross_tonnage"]);
  const repeat = firstNumber(row, ["repeat_call_count", "visit_count_90d", "visits_last_90d", "repeat_caller_score"]);
  const cleaningWindow = firstNumber(row, ["cleaning_window_score", "window_score", "predicted_cleaning_opportunity_score"]);
  const typeText = String(first(row, ["vessel_type", "vessel_type_group", "commercial_segment"])).toLowerCase();
  const signals = [];
  if (value >= 65 || (value >= 70 && (riskValue >= 60 || cleaningWindow >= 65))) signals.push("HIGH_OPPORTUNITY");
  if (hasLongStayRisk(row)) signals.push("LONG_STAY");
  if (riskValue >= 60) signals.push("RISK_OR_COMPLIANCE");
  if (cleaningWindow >= 60) signals.push("CLEANING_WINDOW");
  if (repeat >= 2 || firstNumber(row, ["korea_presence_score"]) >= 70) signals.push("REPEAT_CALLER");
  if ((gt >= 80000 && (value >= 75 || riskValue >= 60 || cleaningWindow >= 65)) ||
    (gt >= 30000 && (value >= 80 || riskValue >= 65 || cleaningWindow >= 70)) ||
    (/bulk|tanker|container|cargo|carrier|pctc|ro-ro|lng|lpg/.test(typeText) && (value >= 80 || riskValue >= 65 || cleaningWindow >= 70))) {
    signals.push("LARGE_HIGH_VALUE");
  }
  return [...new Set(signals)];
}

function projectedSalesTarget(row = {}) {
  return !isDeparted(row) && hasPortOrEta(row) && strongSignalCodes(row).length >= 2;
}

function projectedImmediateTarget(row = {}) {
  const signals = strongSignalCodes(row);
  return projectedSalesTarget(row) &&
    score(row) >= 80 &&
    (signals.includes("LONG_STAY") || signals.includes("RISK_OR_COMPLIANCE") || signals.includes("CLEANING_WINDOW"));
}

function loadVesselRows() {
  const index = readJson("dashboard/api/vessels/index.json");
  const rows = [];
  if (index?.pages?.length) {
    for (const page of index.pages) {
      const payload = readJson(`dashboard/api/vessels/${page}`);
      rows.push(...items(payload).map(flatten));
    }
  }
  if (rows.length) return rows;
  const fallbacks = [
    "dashboard/api/targets/current.json",
    "dashboard/api/candidates/top.json",
    "dashboard/api/arrival-pipeline.json",
    "dashboard/api/staying-vessels.json"
  ];
  for (const relative of fallbacks) rows.push(...items(readJson(relative)).map(flatten));
  return rows;
}

function recordCount(payload) {
  return number(payload?.record_count ?? payload?.total_count ?? payload?.all_vessels_count ?? payload?.total_vessels, items(payload).length);
}

function inspectStartup() {
  const html = fs.existsSync(DASHBOARD_HTML) ? fs.readFileSync(DASHBOARD_HTML, "utf8") : "";
  const loadSummaryBody =
    html.match(/loadSummary=async function\(\)\{([\s\S]*?)\}\s*const renderAllHull/)?.[1] ||
    html.match(/async function loadSummary\(\)\{([\s\S]*?)\nfunction flattenVesselPageRow/)?.[1] ||
    "";
  const firstPaintSegment = loadSummaryBody.split("renderAll()")[0] || loadSummaryBody;
  const startupApiNames = [...firstPaintSegment.matchAll(/api\("([^"]+)","([^"]+)"/g)].map(match => ({ key: match[1], url: match[2] }));
  return {
    startupApiNames,
    heavyDiagnosticStartup: startupApiNames.filter(entry => /imo-recovery-priority|debug|audit|vessels\/page-|all-collected-vessels/.test(entry.url))
  };
}

function fieldCoverageReport(rows) {
  const fields = {
    imo: ["imo", "imo_no", "imoNumber", "imo_number", "ship_imo", "vessel_imo"],
    mmsi: ["mmsi", "mmsi_no", "mmsiNumber", "mmsi_number", "ship_mmsi", "vessel_mmsi"],
    call_sign: ["call_sign", "callsign", "clsgn", "callSign"],
    vessel_type: ["vessel_type", "vessel_type_group", "vsslKndNm", "ship_type"],
    gt: ["gt", "grtg", "intrlGrtg", "gross_tonnage", "grossTonnage"],
    dwt: ["dwt", "deadweight", "deadweight_tonnage"],
    flag: ["flag", "vsslNltyNm", "vsslNltyCd", "nationality"],
    operator: ["operator", "operator_name", "operator_normalized"],
    company: ["shipping_company", "company", "company_name", "owner_operator"],
    operator_display: ["operator_display", "operator", "operator_name", "shipping_company", "company", "company_name", "owner_operator", "owner", "technical_manager", "manager"],
    owner: ["owner", "owner_name", "ship_owner", "registered_owner"],
    manager: ["manager", "manager_name", "ship_manager", "technical_manager"],
    agent: ["agent", "agent_name", "local_agent", "shipping_agent", "satmntEntrpsNm", "entrpsCdNm"],
    eta: ["eta", "eta_candidate", "predicted_arrival_time", "arrival_time"],
    ata: ["ata", "actual_arrival", "arrival_time"],
    berth: ["berth", "berth_name", "berth_no", "berth_code", "laidupFcltyNm"],
    anchorage: ["anchorage", "anchorage_name", "anchorage_zone", "anchorage_area"],
    waiting_score: ["waiting_score", "dwell_score", "stay_score"],
    congestion_score: ["congestion_score", "port_congestion_score", "port_congestion_index"]
  };
  return Object.fromEntries(Object.entries(fields).map(([key, aliases]) => [key, coverage(rows, aliases)]));
}

function bucketCounts(rows, aliases) {
  const counts = {};
  for (const row of rows) {
    const value = first(row, aliases);
    const key = meaningful(value) ? String(value) : "missing";
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((left, right) => right[1] - left[1]).slice(0, 12));
}

function recoveredCountBySource(rows) {
  const counts = {};
  for (const row of rows) {
    const hasIdentity = meaningful(first(row, ["imo", "imo_no", "imo_number"])) || meaningful(first(row, ["mmsi", "mmsi_no", "mmsi_number"]));
    if (!hasIdentity) continue;
    const source = first(row, ["identity_source", "imo_recovery_source", "recovery_source", "identity_match_type"]) || "source_record";
    counts[source] = (counts[source] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((left, right) => right[1] - left[1]));
}

function pipelineIdentityStats() {
  const report = readJson("data/pipeline-report.json") || {};
  const storage = report.storage_status?.supabase || report.supabase_write || {};
  const runtime = report.daily_enrichment_runtime || readJson("dashboard/api/daily-enrichment-runtime.json") || {};
  const recovery = report.imo_recovery_kpis || report.imo_recovery || storage.imo_recovery || {};
  return {
    identity_candidates_saved: number(storage.identityCandidatesSaved ?? report.identityCandidatesSaved, 0),
    imo_recovery_queue_rows_saved: number(storage.imoRecoveryQueueRowsSaved ?? report.imoRecoveryQueueRowsSaved, 0),
    recovered_imo_count_reported: number(recovery.recovered_imo_count ?? recovery.imo_recovered_count ?? report.imo_recovered_count, 0),
    vessel_master_cache_matched_rows: number(runtime.vessel_master_cache?.matched_rows ?? runtime.matched_rows, 0),
    vessel_master_cache_imo_recovered: number(runtime.vessel_master_cache?.imo_recovered_count ?? runtime.imo_recovered_count, 0),
    recovery_queue_status: number(storage.imoRecoveryQueueRowsSaved ?? report.imoRecoveryQueueRowsSaved, 0) > 0
      ? "pending_review_queue_not_verified_identity"
      : "not_created"
  };
}

function identityStats(rows) {
  const pipeline = pipelineIdentityStats();
  return {
    vessels_with_imo_mmsi: rows.filter(row => meaningful(first(row, ["imo", "imo_no", "imo_number"])) && meaningful(first(row, ["mmsi", "mmsi_no", "mmsi_number"]))).length,
    vessels_with_imo_or_mmsi: rows.filter(row => meaningful(first(row, ["imo", "imo_no", "imo_number"])) || meaningful(first(row, ["mmsi", "mmsi_no", "mmsi_number"]))).length,
    call_sign_without_identity: rows.filter(row => meaningful(first(row, ["call_sign", "callsign", "clsgn", "callSign"])) &&
      !meaningful(first(row, ["imo", "imo_no", "imo_number"])) &&
      !meaningful(first(row, ["mmsi", "mmsi_no", "mmsi_number"]))).length,
    recovered_count_by_source: recoveredCountBySource(rows),
    identity_source_counts: bucketCounts(rows, ["identity_source", "imo_recovery_source", "recovery_source"]),
    identity_match_type_counts: bucketCounts(rows, ["identity_match_type", "identity_match_strategy"]),
    identity_recovery_status_counts: bucketCounts(rows, ["identity_recovery_status"]),
    operator_source_counts: bucketCounts(rows, ["operator_source"]),
    ...pipeline
  };
}

function topWarnings({ counts, coverageMap, startup, identity }) {
  const warnings = [];
  const add = message => warnings.push(message);
  if (coverageMap.imo.percent < 50) add(`IMO coverage < 50% (${coverageMap.imo.percent}%)`);
  if (coverageMap.mmsi.percent < 50) add(`MMSI coverage < 50% (${coverageMap.mmsi.percent}%)`);
  if (coverageMap.operator_display.percent < 40) add(`operator/company display coverage < 40% (${coverageMap.operator_display.percent}%)`);
  if (counts.sales_target_ratio > 40) add(`sales_target_ratio > 40% (${counts.sales_target_ratio}%)`);
  if (counts.long_stay_risk_count === 0 && counts.staying_vessels_count > 0) add("long_stay_risk_count = 0 while staying_vessels_count > 0");
  if (identity.vessels_with_imo_or_mmsi === 0 && identity.call_sign_without_identity > 0) add(`call sign exists but no IMO/MMSI recovered (${identity.call_sign_without_identity} rows)`);
  if (identity.identity_candidates_saved > 0 && identity.recovered_imo_count_reported === 0) add("identity candidates are saved but no verified IMO recovery is reported");
  if (identity.imo_recovery_queue_rows_saved > 0 && identity.vessel_master_cache_imo_recovered === 0) add("IMO recovery queue rows are pending review; they did not produce recovered IMO/MMSI");
  if (startup.heavyDiagnosticStartup.length) add(`heavy diagnostic endpoint loads on startup: ${startup.heavyDiagnosticStartup.map(entry => entry.url).join(", ")}`);
  return warnings;
}

function printCoverage(label, entry) {
  console.log(`  - ${label}: ${entry.count}/${entry.total} (${entry.percent}%)`);
}

function main() {
  const bootstrap = readJson("dashboard/api/bootstrap.json") || {};
  const summary = readJson("dashboard/api/dashboard-summary.json") || {};
  const targets = readJson("dashboard/api/targets/current.json") || {};
  const targetCategories = readJson("dashboard/api/targets/categories.json") || {};
  const arrival = readJson("dashboard/api/arrival-pipeline.json") || {};
  const anchorage = readJson("dashboard/api/anchorage-waiting.json") || {};
  const staying = readJson("dashboard/api/staying-vessels.json") || {};
  const vesselRows = loadVesselRows();
  const kpis = bootstrap.kpis || {};
  const categories = Array.isArray(targetCategories.categories) ? targetCategories.categories : [];
  const categoryCount = code => number(categories.find(category => category.code === code)?.count, 0);
  const targetItems = items(targets).map(flatten);
  const gradeCount = label => targetItems.filter(row => String(first(row, ["priority_label", "sales_priority_band", "candidate_band"])).toUpperCase() === label).length;

  const totalVessels = number(kpis.total_vessels ?? bootstrap.total_vessels ?? summary.total_vessels ?? summary.all_vessels_count ?? vesselRows.length, vesselRows.length);
  const projectedSalesTargets = vesselRows.filter(projectedSalesTarget);
  const projectedImmediateTargets = vesselRows.filter(projectedImmediateTarget);
  const projectedLongStayRiskRows = vesselRows.filter(hasLongStayRisk);
  const snapshotSalesTargetCount = number(kpis.sales_target_count ?? bootstrap.sales_target_count ?? summary.sales_target_count ?? recordCount(targets), recordCount(targets));
  const snapshotImmediateTargetCount = number(kpis.immediate_target_count ?? summary.immediate_target_count, 0);
  const snapshotLongStayRiskCount = number(kpis.long_stay_risk_count ?? summary.long_stay_risk_count ?? categoryCount("LONG_STAY_RISK"), categoryCount("LONG_STAY_RISK"));
  const hasDatasetRows = vesselRows.length > 0;
  const salesTargetCount = hasDatasetRows ? projectedSalesTargets.length : snapshotSalesTargetCount;
  const immediateTargetCount = hasDatasetRows ? projectedImmediateTargets.length : snapshotImmediateTargetCount;
  const longStayRiskCount = hasDatasetRows ? projectedLongStayRiskRows.length : snapshotLongStayRiskCount;
  const counts = {
    total_vessels: totalVessels,
    record_count: number(bootstrap.record_count ?? summary.record_count, 0),
    snapshot_sales_target_count: snapshotSalesTargetCount,
    projected_sales_target_count: projectedSalesTargets.length,
    sales_target_count: salesTargetCount,
    sales_target_ratio: totalVessels ? Math.round((salesTargetCount / totalVessels) * 1000) / 10 : 0,
    snapshot_immediate_target_count: snapshotImmediateTargetCount,
    projected_immediate_target_count: projectedImmediateTargets.length,
    immediate_target_count: immediateTargetCount,
    hot_count: number(kpis.hot_count ?? summary.hot_count ?? gradeCount("HOT"), gradeCount("HOT")),
    warm_count: number(kpis.warm_count ?? summary.warm_count ?? gradeCount("WARM"), gradeCount("WARM")),
    low_count: number(kpis.low_count ?? summary.low_count ?? gradeCount("LOW"), gradeCount("LOW")),
    port_count: number(kpis.port_count ?? summary.port_count, 0),
    arrival_pipeline_count: number(kpis.arrival_pipeline_count ?? summary.arrival_pipeline_count ?? recordCount(arrival), recordCount(arrival)),
    anchorage_waiting_count: number(kpis.anchorage_waiting_count ?? summary.anchorage_waiting_count ?? recordCount(anchorage), recordCount(anchorage)),
    staying_vessels_count: number(kpis.staying_vessels_count ?? summary.staying_vessels_count ?? recordCount(staying), recordCount(staying)),
    snapshot_long_stay_risk_count: snapshotLongStayRiskCount,
    projected_long_stay_risk_count: projectedLongStayRiskRows.length,
    long_stay_risk_count: longStayRiskCount,
    high_risk_count: number(kpis.high_risk_count ?? summary.high_risk_count, 0)
  };
  const coverageMap = fieldCoverageReport(vesselRows);
  const identity = identityStats(vesselRows);
  const startup = inspectStartup();
  const warnings = topWarnings({ counts, coverageMap, startup, identity });

  console.log("Data quality audit:");
  console.log("- counts:");
  for (const [key, value] of Object.entries(counts)) console.log(`  - ${key}: ${value}`);
  console.log("- identity recovery:");
  for (const [key, value] of Object.entries(identity)) {
    console.log(`  - ${key}: ${typeof value === "object" ? JSON.stringify(value) : value}`);
  }
  console.log("- field coverage:");
  for (const [key, value] of Object.entries(coverageMap)) printCoverage(key, value);
  console.log("- startup load:");
  console.log(`  - startup API count: ${startup.startupApiNames.length}`);
  console.log(`  - startup APIs: ${startup.startupApiNames.map(entry => `${entry.key}:${entry.url}`).join(", ") || "none"}`);
  console.log(`  - heavy diagnostic startup: ${startup.heavyDiagnosticStartup.length ? startup.heavyDiagnosticStartup.map(entry => entry.url).join(", ") : "none"}`);
  console.log("- warnings:");
  if (!warnings.length) console.log("  - none");
  for (const warning of warnings) console.log(`  - WARNING: ${warning}`);
}

main();
