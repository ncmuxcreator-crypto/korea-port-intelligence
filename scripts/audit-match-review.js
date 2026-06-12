#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { buildPilotageBerthMatchReviewPayload } from "./lib/match-review.js";

const REVIEW_PATH = "dashboard/api/review/pilotage-berth-matches.json";

function readJson(filePath, fallback = null) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    return { _read_error: error.message };
  }
}

function vesselRecords() {
  const dir = "dashboard/api/vessels";
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(name => /^page-\d+\.json$/.test(name))
    .sort((a, b) => Number(a.match(/\d+/)?.[0] || 0) - Number(b.match(/\d+/)?.[0] || 0))
    .flatMap(name => readJson(path.join(dir, name), {})?.items || []);
}

function sourceRowsFromDiagnostics() {
  const rows = [];
  const status = readJson("dashboard/api/source-collection-status.json", {}) || {};
  for (const item of status.items || []) {
    if (!["pilot_sources", "berth_sources"].includes(item.source_key)) continue;
    for (const diagnostic of item.diagnostics || []) {
      for (const sample of diagnostic.sanitized_raw_samples || []) {
        rows.push({
          ...sample,
          source: diagnostic.key || item.source_key,
          source_name: item.source_key,
          source_origin: item.source_key === "pilot_sources" ? "pilot_schedule" : "berth_sources"
        });
      }
    }
  }
  return rows;
}

const existing = readJson(REVIEW_PATH, null);
const payload = existing?._read_error || !existing
  ? buildPilotageBerthMatchReviewPayload({
      sourceRows: sourceRowsFromDiagnostics(),
      vessels: vesselRecords(),
      generatedAt: readJson("dashboard/api/bootstrap.json", {})?.generated_at || new Date().toISOString(),
      dataMode: readJson("dashboard/api/bootstrap.json", {})?.data_mode || "static_snapshot",
      report: readJson("dashboard/api/status-summary.json", {}) || {}
    })
  : existing;

console.log("Pilotage / Berth Match Review Audit");
console.log("====================================");
console.log(`generated_at=${payload.generated_at || "-"}`);
console.log(`source_run_id=${payload.source_run_id || payload.run_id || "-"}`);
console.log(`record_count=${payload.record_count || 0}`);
console.log(`item_count=${payload.item_count || 0}`);
console.log(`counts_by_source_type=${JSON.stringify(payload.counts_by_source_type || {})}`);
console.log(`blocker_counts=${JSON.stringify(payload.blocker_counts || {})}`);

const items = payload.items || [];
const withCandidates = items.filter(item => (item.candidate_matches || []).length > 0).length;
const noCandidates = items.length - withCandidates;
const highConfidenceInQueue = items.filter(item => Number(item.best_match_confidence || 0) >= 75).length;
console.log(`with_candidate_matches=${withCandidates}`);
console.log(`no_candidate_matches=${noCandidates}`);
console.log(`high_confidence_items_in_review=${highConfidenceInQueue}`);

console.log("");
console.log("Top review items:");
for (const item of items.slice(0, 10)) {
  console.log([
    item.source_type,
    item.raw_vessel_name,
    item.raw_call_sign,
    item.raw_port,
    item.raw_time,
    item.best_match_confidence,
    item.blocker_reason
  ].join(" | "));
}

if (highConfidenceInQueue > 0) {
  console.log("");
  console.log("WARN: High-confidence items remain in the review queue; auto-apply threshold logic should be checked.");
}
