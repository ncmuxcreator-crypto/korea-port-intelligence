#!/usr/bin/env node

import fs from "fs";
import path from "path";

const ROOT = process.cwd();

function readJson(relativePath) {
  const file = path.join(ROOT, ...relativePath.split("/"));
  if (!fs.existsSync(file)) return { exists: false, data: null, error: "missing" };
  try {
    return { exists: true, data: JSON.parse(fs.readFileSync(file, "utf8")), error: "" };
  } catch (error) {
    return { exists: true, data: null, error: error?.message || String(error) };
  }
}

function items(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.categories)) return payload.categories.flatMap(category => Array.isArray(category.items) ? category.items : []);
  if (Array.isArray(payload?.ports)) return payload.ports;
  return [];
}

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function schemaStatus(relativePath, requiredArrayField = "items") {
  const result = readJson(relativePath);
  if (!result.exists) return { path: relativePath, status: "MISSING_ENDPOINT", record_count: 0, error: "file missing" };
  if (result.error) return { path: relativePath, status: "INVALID_JSON", record_count: 0, error: result.error };
  const data = result.data;
  if (!data || typeof data !== "object" || Array.isArray(data)) return { path: relativePath, status: "SCHEMA_MISMATCH", record_count: 0, error: "root object required" };
  if (!Array.isArray(data[requiredArrayField])) return { path: relativePath, status: "SCHEMA_MISMATCH", record_count: number(data.record_count, 0), error: `${requiredArrayField} array missing` };
  if (!Number.isFinite(Number(data.record_count))) return { path: relativePath, status: "SCHEMA_MISMATCH", record_count: data[requiredArrayField].length, error: "numeric record_count missing" };
  return { path: relativePath, status: data[requiredArrayField].length ? "ACTIVE" : "EMPTY_VALID", record_count: Number(data.record_count), error: "" };
}

function main() {
  const bootstrap = readJson("dashboard/api/bootstrap.json").data || {};
  const summary = readJson("dashboard/api/dashboard-summary.json").data || {};
  const targets = readJson("dashboard/api/targets/current.json").data || {};
  const categories = readJson("dashboard/api/targets/categories.json").data || {};
  const portsPayload = readJson("dashboard/api/ports.json").data || [];
  const kpis = bootstrap.kpis || {};
  const targetItems = items(targets);
  const categoryRows = Array.isArray(categories.categories) ? categories.categories : [];
  const categoryCount = code => number(categoryRows.find(category => category.code === code)?.count, 0);
  const totalVessels = number(kpis.total_vessels ?? bootstrap.total_vessels ?? summary.total_vessels ?? summary.all_vessels_count, 0);
  const salesTargetCount = number(kpis.sales_target_count ?? summary.sales_target_count ?? targets.record_count, targetItems.length);
  const immediateTargetCount = number(kpis.immediate_target_count ?? summary.immediate_target_count, targetItems.filter(item => item.is_immediate_candidate).length);
  const monitorCount = number(kpis.monitor_count ?? summary.monitor_count ?? categoryCount("MONITOR"), 0);
  const longStayRiskCount = number(kpis.long_stay_risk_count ?? summary.long_stay_risk_count ?? categoryCount("LONG_STAY_RISK"), 0);
  const stayingCount = number(kpis.staying_vessels_count ?? summary.staying_vessels_count, 0);
  const anchorageCount = number(kpis.anchorage_waiting_count ?? summary.anchorage_waiting_count, 0);
  const ports = Array.isArray(portsPayload) ? portsPayload : items(portsPayload);
  const portSemantics = ports.map(port => ({
    port: port.display_name || port.port_name || port.port_code || "UNKNOWN",
    hot_count: number(port.hot_count ?? port.hot_candidate_count, 0),
    hot_candidate_count: number(port.hot_candidate_count ?? port.hot_count, 0),
    immediate_target_count: number(port.immediate_target_count ?? port.immediate_count ?? port.immediate_targets, 0),
    semantics: port.hot_count_semantics || "not declared"
  })).slice(0, 12);
  const endpointChecks = [
    schemaStatus("dashboard/api/sales/conversion-pipeline.json"),
    schemaStatus("dashboard/api/watchlist/current.json")
  ];
  const salesTargetRatio = totalVessels ? Math.round((salesTargetCount / totalVessels) * 1000) / 10 : 0;
  const immediateRatio = totalVessels ? Math.round((immediateTargetCount / totalVessels) * 1000) / 10 : 0;
  const warnings = [];
  if (salesTargetRatio > 40) warnings.push(`sales_target_ratio too broad: ${salesTargetRatio}%`);
  if (salesTargetRatio > 0 && salesTargetRatio < 20) warnings.push(`sales_target_ratio low: ${salesTargetRatio}%`);
  if (immediateRatio > 15) warnings.push(`immediate_target_ratio too broad: ${immediateRatio}%`);
  if (longStayRiskCount === 0 && (stayingCount > 0 || anchorageCount > 0)) warnings.push("long_stay_risk_count is 0 while staying/anchorage signals exist");
  if (portSemantics.some(row => row.semantics === "not declared" && row.hot_count === row.immediate_target_count && row.hot_count > 0)) warnings.push("port hot_count may still mean immediate_target_count");
  for (const endpoint of endpointChecks) {
    if (!["ACTIVE", "EMPTY_VALID"].includes(endpoint.status)) warnings.push(`${endpoint.path}: ${endpoint.status} ${endpoint.error}`);
  }

  console.log("Classification consistency audit:");
  console.log("- target ratios:");
  console.log(`  - total_vessels: ${totalVessels}`);
  console.log(`  - sales_target_count: ${salesTargetCount}`);
  console.log(`  - sales_target_ratio: ${salesTargetRatio}%`);
  console.log(`  - immediate_target_count: ${immediateTargetCount}`);
  console.log(`  - immediate_target_ratio: ${immediateRatio}%`);
  console.log(`  - monitor_count: ${monitorCount}`);
  console.log(`  - long_stay_risk_count: ${longStayRiskCount}`);
  console.log(`  - staying_vessels_count: ${stayingCount}`);
  console.log(`  - anchorage_waiting_count: ${anchorageCount}`);
  console.log("- target category counts:");
  for (const category of categoryRows) console.log(`  - ${category.code}: ${number(category.count, 0)}`);
  console.log("- port hot/immediate semantics:");
  for (const row of portSemantics) {
    console.log(`  - ${row.port}: hot=${row.hot_count}, hot_candidate=${row.hot_candidate_count}, immediate=${row.immediate_target_count}, semantics=${row.semantics}`);
  }
  console.log("- endpoint mapping:");
  for (const endpoint of endpointChecks) {
    console.log(`  - ${endpoint.path}: ${endpoint.status}, record_count=${endpoint.record_count}${endpoint.error ? `, error=${endpoint.error}` : ""}`);
  }
  console.log("- warnings:");
  if (!warnings.length) console.log("  - none");
  for (const warning of warnings) console.log(`  - WARNING: ${warning}`);
}

main();
