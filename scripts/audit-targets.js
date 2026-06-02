import fs from "fs";
import path from "path";

const ROOT = process.cwd();

function readJson(file, fallback = null) {
  const candidates = [
    path.join(ROOT, file),
    path.join(ROOT, file.replace("dashboard/api/", "dashboard/api/debug/"))
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

function stayHours(v = {}) {
  return number(v.stay_hours || v.current_call_stay_hours || v.cumulative_stay_hours || v.anchorage_hours || v.berth_hours);
}

function hasIdentity(v = {}) {
  return hasValue(v.vessel_name || v.name || v.ship_name) || hasValue(v.imo || v.mmsi || v.call_sign || v.hybrid_entity_key || v.port_call_identity);
}

function hasPort(v = {}) {
  return hasValue(v.port_code || v.port_name || v.port || v.destination_port || v.destination || v.berth_name || v.berth || v.anchorage_name || v.sub_port);
}

function isDeparted(v = {}) {
  const text = String(v.status_bucket || v.operational_status || v.status || v.ledger_status || "").toLowerCase();
  return /departed|departure_completed|출항 완료/.test(text);
}

function hardExcluded(v = {}) {
  const type = String(v.vessel_type || v.vessel_type_group || v.name || "").toLowerCase();
  return v.excluded_from_commercial_targets === true ||
    /sample|demo/.test(String(v.source || v.source_name || v.data_mode || "").toLowerCase()) ||
    /fishing|fishery|trawler|tug|pilot|patrol|government|navy|workboat|barge|dredger|어선|예선|관공선|작업선|준설|순찰|해경/.test(type) ||
    isDeparted(v);
}

function regulatedRoute(v = {}) {
  return Boolean(v.high_regulation_route || v.regulated_route || v.biosecurity_route) ||
    /australia|new zealand|brazil|호주|뉴질랜드|브라질/i.test([v.destination, v.destination_port, v.next_port].filter(Boolean).join(" "));
}

function anchorageSignal(v = {}) {
  const text = [v.status_bucket, v.status, v.port_call_status, v.berth_name, v.berth, v.anchorage_name, v.anchorage_zone, v.location_area, v.area_name].filter(Boolean).join(" ");
  return !isDeparted(v) && (
    Boolean(v.is_anchorage_waiting) ||
    number(v.anchorage_hours || v.estimated_waiting_time) > 0 ||
    /waiting|pre[-\s]?berth|anchorage|anchor|idle|drifting|묘박|정박|대기|접안대기|외항/i.test(text) ||
    (hasValue(v.eta || v.etb || v.predicted_arrival_time) && !hasValue(v.ata || v.atb || v.berth_name || v.berth))
  );
}

function arrivalSignal(v = {}) {
  const text = [v.status_bucket, v.status, v.port_call_status, v.movement_status].filter(Boolean).join(" ");
  return !isDeparted(v) && (
    Boolean(v.predicted_arrival_pipeline || v.pilot_only_arrival_review) ||
    hasValue(v.eta || v.etb || v.arrival_time || v.predicted_arrival_time || v.eta_candidate || v.etb_candidate) ||
    /inbound|arrival|arriving|입항예정|도착예정/i.test(text)
  );
}

function hasSalesSignal(v = {}) {
  return score(v) >= 35 ||
    risk(v) >= 50 ||
    stayHours(v) > 0 ||
    anchorageSignal(v) ||
    arrivalSignal(v) ||
    regulatedRoute(v) ||
    Boolean(v.contact_path_available || v.agent || v.agent_name || v.operator || v.operator_name) ||
    hasPort(v);
}

function immediateSignal(v = {}) {
  const gt = number(v.gt || v.grtg || v.intrlGrtg);
  const priority = String(v.priority_label || v.sales_priority_band || "").toUpperCase();
  return priority === "HOT" ||
    score(v) >= 75 ||
    risk(v) >= 70 ||
    stayHours(v) >= 72 ||
    anchorageSignal(v) ||
    arrivalSignal(v) && score(v) >= 50 ||
    gt >= 30000 ||
    regulatedRoute(v);
}

function removalReason(v = {}) {
  if (!hasIdentity(v)) return "missing_identity";
  if (hardExcluded(v)) return "hard_excluded_or_departed";
  if (!hasPort(v)) return "missing_port";
  if (!hasSalesSignal(v)) return "no_sales_relevant_signal";
  return "included";
}

function countBy(items, fn) {
  return items.reduce((acc, row) => {
    const key = fn(row);
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

const allRows = rows(readJson("dashboard/api/all-collected-vessels.json", []));
const currentTargetsPayload = readJson("dashboard/api/targets/current.json", {});
const currentTargets = rows(currentTargetsPayload);
const anchorageWaiting = rows(readJson("dashboard/api/anchorage-waiting.json", []));
const arrivalPipeline = rows(readJson("dashboard/api/arrival-pipeline.json", []));
const stayingVessels = rows(readJson("dashboard/api/staying-vessels.json", []));
const topCandidates = rows(readJson("dashboard/api/candidates/top.json", []));
const summary = readJson("dashboard/api/dashboard-summary.json", {});

const validIdentity = allRows.filter(hasIdentity);
const validPort = allRows.filter(hasPort);
const highRisk = allRows.filter(row => risk(row) >= 70);
const qualified = allRows.filter(row => hasIdentity(row) && !hardExcluded(row) && hasSalesSignal(row));
const immediate = allRows.filter(row => hasIdentity(row) && !hardExcluded(row) && immediateSignal(row));
const hot = currentTargets.filter(row => String(row.priority_label || row.sales_priority_band || "").toUpperCase() === "HOT" || score(row) >= 80);
const warm = currentTargets.filter(row => String(row.priority_label || row.sales_priority_band || "").toUpperCase() === "WARM" || (score(row) >= 60 && score(row) < 80));
const low = currentTargets.filter(row => !hot.includes(row) && !warm.includes(row));
const removed = countBy(allRows, removalReason);
const removedEntries = Object.entries(removed).filter(([reason]) => reason !== "included").sort((a, b) => b[1] - a[1]);
const ratio = allRows.length ? Math.round((currentTargets.length / allRows.length) * 1000) / 10 : 0;
const opportunityMasterCount = number(summary.opportunity_count || summary.sales_target_count || currentTargetsPayload.opportunity_master_count || topCandidates.length);

console.log("Target funnel:");
console.log(`- all_vessels_count: ${allRows.length}`);
console.log(`- valid_identity_count: ${validIdentity.length}`);
console.log(`- valid_port_count: ${validPort.length}`);
console.log(`- anchorage_waiting_count: ${anchorageWaiting.length}`);
console.log(`- arrival_pipeline_count: ${arrivalPipeline.length}`);
console.log(`- staying_vessels_count: ${stayingVessels.length}`);
console.log(`- high_risk_vessels_count: ${highRisk.length}`);
console.log(`- opportunity_master_count: ${opportunityMasterCount}`);
console.log(`- qualified_sales_target_count: ${qualified.length}`);
console.log(`- immediate_sales_target_count: ${currentTargets.filter(immediateSignal).length || immediate.length}`);
console.log(`- hot_count: ${hot.length}`);
console.log(`- warm_count: ${warm.length}`);
console.log(`- low_count: ${low.length}`);
console.log(`- disqualified_count: ${allRows.length - qualified.length}`);
console.log(`- target_ratio: ${ratio}%`);

console.log("\nTop filter removing vessels:");
console.log(`- ${removedEntries[0]?.[0] || "none"}: ${removedEntries[0]?.[1] || 0}`);

console.log("\nRemoved by filter:");
for (const [reason, count] of removedEntries) console.log(`- ${reason}: ${count}`);

console.log("\nSample excluded vessels:");
allRows
  .filter(row => removalReason(row) !== "included")
  .slice(0, 20)
  .forEach((row, index) => {
    console.log(`${index + 1}. ${row.vessel_name || row.name || row.imo || row.mmsi || "UNKNOWN"} | ${removalReason(row)}`);
  });

if (opportunityMasterCount > 0 && currentTargets.length === 0) {
  console.log("\nZERO CANDIDATE ROOT CONDITION:");
  console.log(`- opportunity_master_count: ${opportunityMasterCount}`);
  console.log(`- exact_filter_condition: ${removedEntries[0]?.[0] || "unknown"}`);
}

if (allRows.length && ratio < 20) {
  console.log("\nWARNING:");
  console.log("- 영업대상 비율이 비정상적으로 낮음");
}
