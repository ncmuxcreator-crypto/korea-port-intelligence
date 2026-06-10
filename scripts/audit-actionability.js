import fs from "fs";

function readJson(path, fallback = {}) {
  try {
    return JSON.parse(fs.readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

function rows(payload = {}) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.items)) return payload.items;
  if (Array.isArray(payload.data)) return payload.data;
  if (Array.isArray(payload.rows)) return payload.rows;
  if (Array.isArray(payload.opportunities)) return payload.opportunities;
  return [];
}

function categoryRows(payload = {}) {
  return Array.isArray(payload.categories)
    ? payload.categories.flatMap(category => rows(category).map(item => ({
      ...item,
      category_code: category.code,
      category_label: category.label
    })))
    : [];
}

function hasValue(value) {
  const text = String(value ?? "").trim();
  return Boolean(text) && text !== "-" && !/^(unknown|n\/a|null|undefined|확인 필요|미확인)$/i.test(text);
}

function vesselKey(row = {}) {
  const display = row.vessel_display || {};
  const value = [
    row.imo,
    display.imo,
    row.mmsi,
    display.mmsi,
    row.call_sign,
    display.call_sign,
    row.vessel_name,
    display.vessel_name,
    row.watch_name
  ].find(hasValue) || "";
  return String(value || "").trim().toUpperCase() || JSON.stringify(row).slice(0, 80);
}

function actionabilityCategory(row = {}) {
  const category = String(row.actionability_category || row.action_type || row.primary_category_code || row.category_code || "").toUpperCase();
  if (["CONTACT_NOW", "VERIFY_CONTACT", "MONITOR", "HOLD"].includes(category)) return category;
  const codes = Array.isArray(row.target_categories) ? row.target_categories.map(item => String(item.code || "").toUpperCase()) : [];
  for (const code of ["CONTACT_NOW", "VERIFY_CONTACT", "MONITOR", "HOLD"]) {
    if (codes.includes(code)) return code;
  }
  return "UNCLASSIFIED";
}

function number(...values) {
  for (const value of values) {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

function missingFields(row = {}) {
  const display = row.vessel_display || {};
  const explicit = Array.isArray(row.missing_action_fields) ? row.missing_action_fields : [];
  const fields = [...explicit];
  if (!hasValue(row.operator_display || row.operator || display.operator_display || display.operator)) fields.push("operator_display");
  if (!hasValue(row.agent || row.local_agent || display.agent)) fields.push("local_agent");
  if (!hasValue(row.call_sign || row.callsign || display.call_sign)) fields.push("call_sign");
  if (!hasValue(row.imo || display.imo)) fields.push("imo");
  return [...new Set(fields)];
}

const bootstrap = readJson("dashboard/api/bootstrap.json", {});
const targets = readJson("dashboard/api/targets/current.json", {});
const salesActions = readJson("dashboard/api/sales/actions.json", {});
const categories = readJson("dashboard/api/targets/categories.json", {});
const candidatesTop = readJson("dashboard/api/candidates/top.json", {});

const merged = new Map();
for (const row of [
  ...rows(targets),
  ...rows(salesActions),
  ...categoryRows(categories),
  ...rows(candidatesTop)
]) {
  merged.set(vesselKey(row), { ...(merged.get(vesselKey(row)) || {}), ...row });
}

const items = [...merged.values()];
const counts = { CONTACT_NOW: 0, VERIFY_CONTACT: 0, MONITOR: 0, HOLD: 0, UNCLASSIFIED: 0 };
const blockerCounts = {};
const missingCounts = { operator_display: 0, local_agent: 0, call_sign: 0, imo: 0 };
let highOpportunityNotContactNow = 0;

for (const item of items) {
  const category = actionabilityCategory(item);
  counts[category] = (counts[category] || 0) + 1;
  for (const field of missingFields(item)) {
    if (field in missingCounts) missingCounts[field] += 1;
  }
  const blockers = Array.isArray(item.actionability_blockers) ? item.actionability_blockers : [];
  for (const blocker of blockers.length ? blockers : category === "CONTACT_NOW" ? [] : ["unclassified_blocker"]) {
    blockerCounts[blocker] = (blockerCounts[blocker] || 0) + 1;
  }
  const score = number(item.opportunity_score, item.sales_priority_score, item.commercial_value_score, item.vessel_display?.opportunity_score);
  const priority = String(item.priority_label || item.sales_priority_band || item.vessel_display?.priority_label || "").toUpperCase();
  if ((score >= 65 || ["HOT", "WARM"].includes(priority)) && category !== "CONTACT_NOW") highOpportunityNotContactNow += 1;
}

const totalCandidates = items.length;
const salesCandidatesCurrent = number(bootstrap.kpis?.sales_target_count, targets.record_count, rows(targets).length);
const topBlocker = Object.entries(blockerCounts).sort((a, b) => b[1] - a[1])[0] || ["-", 0];
const warnings = [];

if (salesCandidatesCurrent > 0 && counts.CONTACT_NOW === 0) warnings.push("sales_candidates_current > 0 but CONTACT_NOW = 0");
if (counts.VERIFY_CONTACT === 0 && (missingCounts.operator_display > 0 || missingCounts.local_agent > 0)) warnings.push("VERIFY_CONTACT = 0 while contact/company fields are missing");
if (totalCandidates && counts.MONITOR / totalCandidates > 0.8) warnings.push("MONITOR > 80% of candidates");

console.log("Sales actionability audit:");
console.log(`- total candidates: ${totalCandidates}`);
console.log(`- CONTACT_NOW count: ${counts.CONTACT_NOW}`);
console.log(`- VERIFY_CONTACT count: ${counts.VERIFY_CONTACT}`);
console.log(`- MONITOR count: ${counts.MONITOR}`);
console.log(`- HOLD count: ${counts.HOLD}`);
console.log(`- top blocker preventing CONTACT_NOW: ${topBlocker[0]} (${topBlocker[1]})`);
console.log(`- missing operator count: ${missingCounts.operator_display}`);
console.log(`- missing agent count: ${missingCounts.local_agent}`);
console.log(`- missing call sign count: ${missingCounts.call_sign}`);
console.log(`- missing IMO count: ${missingCounts.imo}`);
console.log(`- high opportunity but not CONTACT_NOW count: ${highOpportunityNotContactNow}`);
if (warnings.length) {
  console.log("- warnings:");
  for (const warning of warnings) console.log(`  - ${warning}`);
}
