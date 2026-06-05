#!/usr/bin/env node

import fs from "fs";

const WATCHLIST_PATH = "dashboard/api/watchlist/current.json";

function readJson(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing watchlist endpoint: ${filePath}`);
  }
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function rows(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
}

function countBy(items, field, value) {
  return items.filter(item => String(item?.[field] || "").toUpperCase() === value).length;
}

const payload = readJson(WATCHLIST_PATH);
const items = rows(payload);
const watchlistCount = Number.isFinite(Number(payload.record_count)) ? Number(payload.record_count) : items.length;
const activeWatchlistCount = items.filter(item => String(item.priority || "").toUpperCase() !== "LOW").length;
const vesselsWithChanges = items.filter(item =>
  String(item.watch_type || "").toUpperCase() === "VESSEL" &&
  Array.isArray(item.change_events) &&
  item.change_events.length > 0
).length;
const operatorWatchlistCount = countBy(items, "watch_type", "OPERATOR");
const fleetWatchlistCount = countBy(items, "watch_type", "FLEET");
const portWatchlistCount = countBy(items, "watch_type", "PORT");

console.log("Watchlist audit");
console.log("===============");
console.log(`watchlist_count: ${watchlistCount}`);
console.log(`active_watchlist_count: ${activeWatchlistCount}`);
console.log(`vessels_with_changes: ${vesselsWithChanges}`);
console.log(`operator_watchlist_count: ${operatorWatchlistCount}`);
console.log(`fleet_watchlist_count: ${fleetWatchlistCount}`);
console.log(`port_watchlist_count: ${portWatchlistCount}`);
console.log(`generated_at: ${payload.generated_at || "-"}`);
console.log(`data_mode: ${payload.data_mode || "-"}`);

const missingFields = items.flatMap((item, index) => {
  const required = ["watch_type", "watch_name", "priority", "current_status", "current_port", "opportunity_score", "risk_score", "compliance_score", "last_seen_at", "change_events"];
  return required
    .filter(field => !(field in item))
    .map(field => `item ${index + 1} missing ${field}`);
});

if (missingFields.length) {
  console.error("\nSchema issues:");
  for (const issue of missingFields.slice(0, 20)) console.error(`- ${issue}`);
  process.exitCode = 1;
}
