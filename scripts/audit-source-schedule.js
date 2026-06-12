#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { buildSourceSchedulePayload, SOURCE_SCHEDULE_PATH } from "./lib/source-schedule.js";

const ROOT = process.cwd();

function readJson(relativePath, fallback = null) {
  const filePath = path.join(ROOT, relativePath);
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    return { _read_error: error.message };
  }
}

function writeJson(relativePath, payload) {
  const filePath = path.join(ROOT, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));
}

const existing = readJson(SOURCE_SCHEDULE_PATH, null);
const sourceCollectionStatus = readJson("dashboard/api/source-collection-status.json", {}) || {};
const sourceQualityScore = readJson("dashboard/api/source-quality-score.json", {}) || {};
const auxiliaryCacheStatus = readJson("dashboard/api/aux/cache-status.json", {}) || {};
const bootstrap = readJson("dashboard/api/bootstrap.json", {}) || {};
const status = readJson("dashboard/api/status-summary.json", readJson("dashboard/api/status.json", {}) || {}) || {};
const storageEfficiencyReport = readJson("dashboard/api/storage-efficiency-report.json", {}) || {};
const sourceHealthRuntime = readJson("dashboard/api/source-health-runtime.json", {}) || {};

const generatedAt = sourceCollectionStatus.generated_at
  || bootstrap.generated_at
  || status.generated_at
  || new Date().toISOString();

const payload = existing?.items
  ? existing
  : buildSourceSchedulePayload({
      sourceCollectionStatus,
      sourceQualityScore,
      auxiliaryCacheStatus,
      previousSchedule: {},
      diagnostics: {
        bootstrap,
        status,
        sourceCollectionStatus,
        sourceHealthRuntime,
        storageEfficiencyReport
      },
      generatedAt,
      dataMode: sourceCollectionStatus.data_mode || bootstrap.data_mode || status.data_mode || "static_snapshot",
      report: status
    });

if (!existing?.items) {
  writeJson(SOURCE_SCHEDULE_PATH, payload);
}

console.log("Auxiliary Source Priority Schedule Audit");
console.log("========================================");
console.log(`generated_at=${payload.generated_at || "-"}`);
console.log(`source_run_id=${payload.source_run_id || payload.run_id || "-"}`);
console.log(`record_count=${payload.record_count || 0}`);
console.log(`should_run_count=${payload.should_run_count || 0}`);
console.log(`skipped_count=${payload.skipped_count || 0}`);
console.log(`tier_counts=${JSON.stringify(payload.tier_counts || {})}`);
console.log("");
console.log("Source | Tier | Frequency | Last Attempt | Last Success | Should Run | Skip Reason | Status | Quality | Rows");

for (const item of payload.items || []) {
  console.log([
    item.source_key,
    item.tier,
    item.update_frequency,
    item.last_attempt_at || "-",
    item.last_success_at || "-",
    item.should_run_now ? "yes" : "no",
    item.skip_reason || "-",
    item.status || "-",
    item.quality_label || "-",
    Number(item.rows_collected || 0)
  ].join(" | "));
}

const runnableAux = (payload.items || []).filter(item => item.source_layer === "auxiliary" && item.should_run_now);
const skippedAux = (payload.items || []).filter(item => item.source_layer === "auxiliary" && !item.should_run_now);
console.log("");
console.log(`Auxiliary runnable now: ${runnableAux.map(item => item.source_key).join(", ") || "-"}`);
console.log(`Auxiliary skipped this window: ${skippedAux.map(item => item.source_key).join(", ") || "-"}`);

const staleDiagnostics = (payload.items || []).filter(item => item.source_layer === "diagnostic" && item.should_run_now);
if (staleDiagnostics.length) {
  console.log("");
  console.log(`WARN: ${staleDiagnostics.length} low-frequency diagnostic source(s) are due to run.`);
}
