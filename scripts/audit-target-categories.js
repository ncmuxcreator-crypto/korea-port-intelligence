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
  if (Array.isArray(payload.vessels)) return payload.vessels;
  return [];
}

const categoriesPayload = readJson("dashboard/api/targets/categories.json", null);
const targetsPayload = readJson("dashboard/api/targets/current.json", {});
const bootstrap = readJson("dashboard/api/bootstrap.json", {});
const arrival = readJson("dashboard/api/arrival-pipeline.json", {});
const anchorage = readJson("dashboard/api/anchorage-waiting.json", {});
const staying = readJson("dashboard/api/staying-vessels.json", {});

const targetRows = rows(targetsPayload);
const categories = Array.isArray(categoriesPayload?.categories) ? categoriesPayload.categories : [];
const categoryCounts = Object.fromEntries(categories.map(category => [category.code, Number(category.count || rows(category).length || 0)]));
const qualifiedTargets = Number(targetsPayload.record_count || targetRows.length || 0);
const totalVessels = Number(bootstrap.kpis?.total_vessels || bootstrap.record_count || targetsPayload.all_vessels_count || 0);
const hotCount = targetRows.filter(row => String(row.priority_label || row.sales_priority_band || "").toUpperCase() === "HOT").length;
const arrivalCount = Number(arrival.record_count || rows(arrival).length || bootstrap.kpis?.arrival_pipeline_count || 0);
const anchorageCount = Number(anchorage.record_count || rows(anchorage).length || bootstrap.kpis?.anchorage_waiting_count || 0);
const stayingCount = Number(staying.record_count || rows(staying).length || bootstrap.kpis?.staying_vessels_count || 0);

const codes = categories.map(category => category.code);
const categorySets = targetRows.map(item => new Set((Array.isArray(item.target_categories) ? item.target_categories : []).map(category => category.code).filter(Boolean)));

const overlap = {};
for (const left of codes) {
  overlap[left] = {};
  for (const right of codes) {
    overlap[left][right] = categorySets.filter(set => set.has(left) && set.has(right)).length;
  }
}

const holdReasons = {};
for (const item of targetRows.filter(row => (row.target_categories || []).some(category => category.code === "HOLD"))) {
  const reason = (item.target_categories || []).find(category => category.code === "HOLD")?.reason || item.primary_category?.reason || "unknown";
  holdReasons[reason] = (holdReasons[reason] || 0) + 1;
}

const missingCompanyTargets = targetRows.filter(row => {
  const display = row.vessel_display || {};
  return ![
    row.operator, row.operator_name, row.owner, row.owner_name, row.manager, row.manager_name, row.agent, row.agent_name,
    display.operator, display.owner, display.manager
  ].some(value => value !== undefined && value !== null && String(value).trim() && String(value).trim() !== "-");
}).length;

const warnings = [];
const targetRatio = totalVessels ? qualifiedTargets / totalVessels : 0;
if (totalVessels && targetRatio < 0.2) warnings.push("영업대상 비율이 비정상적으로 낮음");
if (hotCount > 0 && !categoryCounts.CONTACT_NOW) warnings.push("CONTACT_NOW = 0 while HOT > 0");
if (arrivalCount > 0 && !categoryCounts.PRE_ARRIVAL) warnings.push("PRE_ARRIVAL = 0 while arrival_pipeline has data");
if ((anchorageCount > 0 || stayingCount > 0) && !categoryCounts.ANCHORAGE_OPPORTUNITY) warnings.push("ANCHORAGE_OPPORTUNITY = 0 while anchorage/staying data exists");
if (missingCompanyTargets > 0 && !categoryCounts.VERIFY_CONTACT) warnings.push("VERIFY_CONTACT = 0 while operator/agent fields are missing");
if (!categoriesPayload) warnings.push("targets/categories.json is missing");

console.log("Target category audit:");
console.log(`- total vessels: ${totalVessels}`);
console.log(`- qualified targets: ${qualifiedTargets}`);
console.log("- category counts:");
for (const category of categories) {
  console.log(`  - ${category.code}: ${Number(category.count || 0)} (${category.label || ""})`);
}
console.log("- overlap matrix:");
for (const code of codes) {
  console.log(`  - ${code}: ${JSON.stringify(overlap[code] || {})}`);
}
console.log(`- HOLD count: ${categoryCounts.HOLD || 0}`);
console.log(`- HOLD reasons: ${JSON.stringify(holdReasons)}`);
console.log(`- CONTACT_NOW count: ${categoryCounts.CONTACT_NOW || 0}`);
console.log(`- PRE_ARRIVAL count: ${categoryCounts.PRE_ARRIVAL || 0}`);
console.log(`- ANCHORAGE_OPPORTUNITY count: ${categoryCounts.ANCHORAGE_OPPORTUNITY || 0}`);
console.log(`- VERIFY_CONTACT count: ${categoryCounts.VERIFY_CONTACT || 0}`);
if (warnings.length) {
  console.log("- warnings:");
  for (const warning of warnings) console.log(`  - ${warning}`);
}
