#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const FILES = {
  targetQueue: "dashboard/api/aux/latest/ais-target-queue.json",
  cursor: "dashboard/api/aux/latest/ais-cursor.json",
  cache: "dashboard/api/aux/latest/ais-cache.json",
  targetEnrichment: "dashboard/api/aux/latest/ais-target-enrichment.json",
  patchHints: "dashboard/api/aux/latest/patch-hints.json",
  sourceQuality: "dashboard/api/source-quality-score.json",
  bottleneck: "dashboard/api/enrichment/source-bottleneck-report.json",
  utilization: "dashboard/api/enrichment-utilization.json",
  runner: "scripts/run-update-mode.js",
  collector: "scripts/collectors/korea.js"
};

function abs(relativePath) {
  return path.join(ROOT, ...String(relativePath).split("/"));
}

function readJson(relativePath, fallback = {}) {
  try {
    const file = abs(relativePath);
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : { ...fallback, __missing: true };
  } catch (error) {
    return { ...fallback, __parse_error: error.message };
  }
}

function readText(relativePath) {
  try {
    return fs.readFileSync(abs(relativePath), "utf8");
  } catch {
    return "";
  }
}

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function items(payload = {}) {
  return Array.isArray(payload.items) ? payload.items : [];
}

function sourceItem(payload = {}, sourceKey = "") {
  return items(payload).find(item => item.source_key === sourceKey) || {};
}

function detectCoreGuard() {
  const collector = readText(FILES.collector);
  const runner = readText(FILES.runner);
  const hasCollectorModeGate = /CORE_COLLECTOR_MODES\.has\(COLLECTOR_UPDATE_MODE\)\)\s*return tier === "core"/.test(collector);
  const corePresetKeepsAuxOff = /core:\s*{[\s\S]*UPDATE_MODE:\s*"core"[\s\S]*ENRICHMENT_MODE:\s*"lightweight_apply_cache"/.test(runner);
  return {
    core_fetch_guard_present: hasCollectorModeGate,
    core_preset_cache_only: corePresetKeepsAuxOff,
    core_incorrectly_fetching_ais: !(hasCollectorModeGate && corePresetKeepsAuxOff)
  };
}

const targetQueue = readJson(FILES.targetQueue, { items: [] });
const cursor = readJson(FILES.cursor, {});
const cache = readJson(FILES.cache, { items: [] });
const targetEnrichment = readJson(FILES.targetEnrichment, {});
const patchHints = readJson(FILES.patchHints, { items: [] });
const sourceQuality = readJson(FILES.sourceQuality, { items: [] });
const bottleneck = readJson(FILES.bottleneck, { items: [] });
const utilization = readJson(FILES.utilization, { items: [] });
const guard = detectCoreGuard();
const problems = [];

for (const [label, file] of Object.entries(FILES).filter(([label]) => !["runner", "collector"].includes(label))) {
  const payload = readJson(file, {});
  if (payload.__missing) problems.push(`${label} missing: ${file}`);
  if (payload.__parse_error) problems.push(`${label} parse error: ${payload.__parse_error}`);
}

const batchSize = number(targetEnrichment.batch_size || cursor.batch_size);
const queueSize = number(targetQueue.record_count || targetQueue.item_count || items(targetQueue).length);
const targetsChecked = number(targetEnrichment.targets_checked || targetEnrichment.target_vessels_checked);
const patchItems = items(patchHints).filter(item => ["ais_identity_hint", "ais_dynamic_signal"].includes(item.signal_type));
const reviewItems = patchItems.filter(item => String(item.apply_policy || "").toUpperCase() === "REVIEW");
const sourceQualityInfo = sourceItem(sourceQuality, "mof_ais_info");
const sourceQualityDynamic = sourceItem(sourceQuality, "mof_ais_dynamic");
const bottleneckInfo = sourceItem(bottleneck, "mof_ais_info");
const bottleneckDynamic = sourceItem(bottleneck, "mof_ais_dynamic");
const utilizationInfo = sourceItem(utilization, "mof_ais_info");
const utilizationDynamic = sourceItem(utilization, "mof_ais_dynamic");
const timeoutWarnings = Array.isArray(targetEnrichment.timeout_warnings) ? targetEnrichment.timeout_warnings : [];
const rateLimitWarnings = Array.isArray(targetEnrichment.rate_limit_warnings) ? targetEnrichment.rate_limit_warnings : [];

if (batchSize > 250) problems.push(`batch size too large: ${batchSize}`);
if (queueSize > 0 && batchSize > 0 && targetsChecked > batchSize) problems.push(`targets_checked exceeds batch_size: ${targetsChecked}/${batchSize}`);
if (guard.core_incorrectly_fetching_ais) problems.push("core AIS fetch guard is missing or not detected");
if (targetEnrichment.owner_tier !== "fast_aux") problems.push(`ais-target-enrichment owner_tier=${targetEnrichment.owner_tier || "missing"}`);
if (targetEnrichment.core_may_update !== false) problems.push(`ais-target-enrichment core_may_update=${targetEnrichment.core_may_update}`);

console.log("AIS Enrichment Audit");
console.log("====================");
console.log(`target_queue_size=${queueSize}`);
console.log(`batch_size=${batchSize}`);
console.log(`targets_checked=${targetsChecked}`);
console.log(`ais_info_matches=${number(targetEnrichment.ais_info_matches || targetEnrichment.info_matches)}`);
console.log(`ais_dynamic_matches=${number(targetEnrichment.ais_dynamic_matches || targetEnrichment.dynamic_matches)}`);
console.log(`identity_hints_created=${number(targetEnrichment.identity_hints_created)}`);
console.log(`dynamic_signals_created=${number(targetEnrichment.dynamic_signals_created)}`);
console.log(`patches_appended=${number(targetEnrichment.patches_appended || patchItems.length)}`);
console.log(`review_queue_items=${reviewItems.length}`);
console.log(`cursor_position=${number(cursor.cursor_position)}`);
console.log(`next_cursor=${number(targetEnrichment.next_cursor ?? cursor.next_cursor)}`);
console.log(`coverage_label=${targetEnrichment.coverage_label || "unknown"}`);
console.log(`ais_cache_items=${items(cache).length}`);
console.log(`ais_cache_matched_vessels=${number(cache.matched_vessels)}`);
console.log(`source_quality_info_coverage=${sourceQualityInfo.coverage_label || "-"}`);
console.log(`source_quality_dynamic_coverage=${sourceQualityDynamic.coverage_label || "-"}`);
console.log(`bottleneck_info=${bottleneckInfo.bottleneck_stage || "-"}`);
console.log(`bottleneck_dynamic=${bottleneckDynamic.bottleneck_stage || "-"}`);
console.log(`utilization_info_matched=${number(utilizationInfo.rows_matched_to_vessels ?? utilizationInfo.matched_vessels)}`);
console.log(`utilization_dynamic_matched=${number(utilizationDynamic.rows_matched_to_vessels ?? utilizationDynamic.matched_vessels)}`);
console.log(`timeout_warnings=${timeoutWarnings.length ? timeoutWarnings.join("; ") : "none"}`);
console.log(`rate_limit_warnings=${rateLimitWarnings.length ? rateLimitWarnings.join("; ") : "none"}`);
console.log(`core_fetch_guard_present=${guard.core_fetch_guard_present}`);
console.log(`core_preset_cache_only=${guard.core_preset_cache_only}`);
console.log(`core_incorrectly_fetching_ais=${guard.core_incorrectly_fetching_ais}`);
console.log(`problems=${problems.length ? problems.join("; ") : "none"}`);

if (problems.length) process.exit(1);
