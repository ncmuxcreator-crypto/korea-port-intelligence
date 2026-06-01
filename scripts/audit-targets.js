import fs from "fs";
import path from "path";

const ROOT = process.cwd();

function readJson(file, fallback = null) {
  const candidates = [
    path.join(ROOT, file.replace("dashboard/api/", "dashboard/api/debug/")),
    path.join(ROOT, file)
  ];
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) return JSON.parse(fs.readFileSync(candidate, "utf8"));
    } catch (error) {
      return { __invalid_json: true, error: error.message };
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
  if (Array.isArray(payload?.immediate_targets)) return payload.immediate_targets;
  return [];
}

function hasValue(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === "number") return Number.isFinite(value) && value > 0;
  return String(value).trim() !== "";
}

function number(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function score(v = {}) {
  return number(v.opportunity_score || v.sales_priority_score || v.commercial_value_score || v.total_sales_priority_score || v.cleaning_candidate_score || v.sales_score);
}

function risk(v = {}) {
  return number(v.risk_score || v.biofouling_exposure_score || v.biofouling_risk_score || v.biofouling_score || v.operational_risk_score);
}

function hasIdentity(v = {}) {
  return hasValue(v.vessel_name || v.name || v.ship_name) || hasValue(v.imo || v.mmsi || v.call_sign || v.hybrid_entity_key || v.port_call_identity);
}

function isDeparted(v = {}) {
  const text = String(v.status_bucket || v.operational_status || v.status || v.ledger_status || "").toLowerCase();
  return /departed|departure_completed|출항 완료/.test(text);
}

function hardExcluded(v = {}) {
  const type = String(v.vessel_type || v.vessel_type_group || v.name || "").toLowerCase();
  return v.excluded_from_commercial_targets === true ||
    /sample|demo/.test(String(v.source || v.source_name || v.data_mode || "").toLowerCase()) ||
    /fishing|fishery|trawler|tug|pilot|patrol|government|navy|workboat|barge|dredger|어선|예선|관공선|작업선|준설/.test(type) ||
    isDeparted(v);
}

function hasPort(v = {}) {
  return hasValue(v.port_code || v.port_name || v.port || v.destination_port || v.destination || v.berth_name || v.berth || v.anchorage_name || v.sub_port);
}

function hasSchedule(v = {}) {
  return hasValue(v.eta || v.etb || v.ata || v.atb || v.etd || v.atd || v.predicted_arrival_time || v.last_seen_at || v.collected_at);
}

function stayHours(v = {}) {
  return number(v.stay_hours || v.current_call_stay_hours || v.cumulative_stay_hours || v.anchorage_hours || v.berth_hours);
}

function regulatedRoute(v = {}) {
  return Boolean(v.high_regulation_route || v.regulated_route || v.biosecurity_route) ||
    /australia|new zealand|brazil|호주|뉴질랜드|브라질/i.test([v.destination, v.destination_port, v.next_port].filter(Boolean).join(" "));
}

function hasSalesSignal(v = {}) {
  return score(v) >= 35 ||
    risk(v) >= 50 ||
    stayHours(v) > 0 ||
    regulatedRoute(v) ||
    Boolean(v.predicted_arrival_pipeline || v.contact_path_available || v.agent || v.agent_name || v.operator || v.operator_name) ||
    (hasPort(v) && hasSchedule(v));
}

function removalReason(v = {}) {
  if (!hasIdentity(v)) return "missing_identity";
  if (hardExcluded(v)) return "hard_excluded_or_departed";
  if (!hasSalesSignal(v)) return "no_sales_relevant_signal";
  return "included";
}

function countBy(rowsToCount, fn) {
  return rowsToCount.reduce((acc, row) => {
    const key = fn(row);
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

const allRows = rows(readJson("dashboard/api/all-collected-vessels.json", []));
const currentTargets = rows(readJson("dashboard/api/targets/current.json", []));
const topCandidates = rows(readJson("dashboard/api/candidates/top.json", []));
const summary = readJson("dashboard/api/dashboard-summary.json", {});

const qualified = allRows.filter(row => hasIdentity(row) && !hardExcluded(row) && hasSalesSignal(row));
const hot = currentTargets.filter(row => String(row.priority_label || row.sales_priority_band || "").toUpperCase() === "HOT" || score(row) >= 80);
const warm = currentTargets.filter(row => String(row.priority_label || row.sales_priority_band || "").toUpperCase() === "WARM" || (score(row) >= 60 && score(row) < 80));
const low = currentTargets.filter(row => !hot.includes(row) && !warm.includes(row));
const removed = countBy(allRows, removalReason);
const ratio = allRows.length ? Math.round((currentTargets.length / allRows.length) * 1000) / 10 : 0;
const opportunityMasterCount = number(summary.opportunity_count || summary.sales_target_count || topCandidates.length);

console.log("Candidate funnel:");
console.log(`- all_vessels_count: ${allRows.length}`);
console.log(`- vessels_with_port: ${allRows.filter(hasPort).length}`);
console.log(`- vessels_with_imo_or_mmsi: ${allRows.filter(row => hasValue(row.imo || row.mmsi)).length}`);
console.log(`- vessels_with_stay_duration: ${allRows.filter(row => stayHours(row) > 0).length}`);
console.log(`- vessels_with_opportunity_score: ${allRows.filter(row => score(row) > 0).length}`);
console.log(`- vessels_with_sales_signal: ${allRows.filter(hasSalesSignal).length}`);
console.log(`- qualified_sales_targets: ${qualified.length}`);
console.log(`- sales_candidates_current_count: ${currentTargets.length}`);
console.log(`- immediate_targets_current_count: ${currentTargets.filter(row => score(row) >= 75 || row.is_immediate_candidate).length}`);
console.log(`- hot_count: ${hot.length}`);
console.log(`- warm_count: ${warm.length}`);
console.log(`- low_count: ${low.length}`);
console.log(`- target_ratio: ${ratio}%`);
console.log(`- dashboard_summary_sales_target_count: ${number(summary.sales_target_count || summary.target_count)}`);

console.log("\nRemoved by filter:");
for (const [reason, count] of Object.entries(removed)) console.log(`- ${reason}: ${count}`);

if (opportunityMasterCount > 0 && currentTargets.length === 0) {
  const reasons = Object.entries(removed)
    .filter(([reason]) => reason !== "included")
    .sort((a, b) => b[1] - a[1]);
  console.log("\nZERO CANDIDATE ROOT CONDITION:");
  console.log(`- opportunity_master_count: ${opportunityMasterCount}`);
  console.log(`- exact_filter_condition: ${reasons[0]?.[0] || "unknown"}`);
}

if (allRows.length && ratio < 20) {
  console.log("\nWARNING:");
  console.log("- target_ratio below 20%. Candidate generation may still be too strict.");
}
