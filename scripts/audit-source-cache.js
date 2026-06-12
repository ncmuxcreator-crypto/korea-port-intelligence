#!/usr/bin/env node

import fs from "node:fs";
import {
  AUXILIARY_SOURCE_CACHE_STATUS_PATH,
  AUXILIARY_SOURCE_CACHE_PATH,
  buildAuxiliarySourceCacheStatusPayload,
  readAuxiliarySourceCacheStatus
} from "./lib/auxiliary-source-cache.js";

function readJson(filePath, fallback = null) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    return { _read_error: error.message };
  }
}

function sourceSummaries() {
  return {
    source_csv: readJson("dashboard/api/aux/source-csv-summary.json", {}),
    pilot_sources: readJson("dashboard/api/aux/pilotage-summary.json", {}),
    berth_sources: readJson("dashboard/api/aux/berth-summary.json", {}),
    vessel_spec: readJson("dashboard/api/aux/vessel-spec-summary.json", {}),
    mof_ais_info: readJson("dashboard/api/aux/ais-info-summary.json", {}),
    mof_ais_dynamic: readJson("dashboard/api/aux/ais-dynamic-summary.json", {})
  };
}

const existing = readJson(AUXILIARY_SOURCE_CACHE_STATUS_PATH, null);
const payload = existing?._read_error || !existing
  ? buildAuxiliarySourceCacheStatusPayload({
      sourceCollectionStatus: readJson("dashboard/api/source-collection-status.json", {}) || {},
      summaries: sourceSummaries(),
      previousCache: readAuxiliarySourceCacheStatus(AUXILIARY_SOURCE_CACHE_PATH),
      generatedAt: readJson("dashboard/api/bootstrap.json", {})?.generated_at || new Date().toISOString(),
      dataMode: readJson("dashboard/api/bootstrap.json", {})?.data_mode || "static_snapshot",
      report: readJson("dashboard/api/status-summary.json", {}) || {}
    })
  : existing;

console.log("Auxiliary Source Cache Audit");
console.log("============================");
console.log(`generated_at=${payload.generated_at || "-"}`);
console.log(`source_run_id=${payload.source_run_id || payload.run_id || "-"}`);
console.log(`record_count=${payload.record_count || 0}`);
console.log(`current_cache_count=${payload.current_cache_count || 0}`);
console.log(`using_previous_cache_count=${payload.using_previous_cache_count || 0}`);
console.log(`stale_cache_warning_count=${payload.stale_cache_warning_count || 0}`);
console.log("");
console.log("Source | Attempt | Last Success | Success Records | Age Hours | Previous Cache | Stale | Blocker");
for (const item of payload.items || []) {
  console.log([
    item.source_key,
    item.current_attempt_status || "-",
    item.last_success_at || "-",
    item.last_success_record_count ?? 0,
    item.cache_age_hours ?? "-",
    item.using_previous_cache ? "yes" : "no",
    item.cache_stale_warning ? "yes" : "no",
    item.blocker_reason || "-"
  ].join(" | "));
}

const blockers = (payload.items || []).filter(item => item.blocker_reason);
if (blockers.length) {
  console.log("");
  console.log("Recommended fixes:");
  for (const item of blockers) {
    console.log(`- ${item.source_key}: ${item.recommended_fix || item.blocker_reason}`);
  }
}

const emptyFailed = (payload.items || []).filter(item => item.cache_status === "EMPTY" && ["FETCH_FAILED", "PARSE_FAILED", "SOURCE_TOO_LARGE"].includes(item.current_attempt_status));
if (emptyFailed.length) {
  console.log("");
  console.log("Warnings:");
  for (const item of emptyFailed) {
    console.log(`- ${item.source_key}: current attempt failed and no previous useful cache is available yet.`);
  }
}
