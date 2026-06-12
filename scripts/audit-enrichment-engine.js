#!/usr/bin/env node

import fs from "fs";
import path from "path";

const ROOT = process.cwd();

function filePath(relativePath) {
  return path.join(ROOT, ...relativePath.split("/"));
}

function readJson(relativePath, fallback = {}) {
  const file = filePath(relativePath);
  try {
    if (!fs.existsSync(file)) return { ...fallback, _error: "not_found", _path: file };
    return { ...JSON.parse(fs.readFileSync(file, "utf8")), _path: file };
  } catch (error) {
    return { ...fallback, _error: error.message, _path: file };
  }
}

function rows(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.items)) return payload.items;
  return [];
}

function countBy(items, key) {
  const counts = new Map();
  for (const item of items) {
    const value = item[key] || "unknown";
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

function printCounts(title, counts, limit = 12) {
  console.log(title);
  if (!counts.length) {
    console.log("- none");
    return;
  }
  for (const [key, count] of counts.slice(0, limit)) {
    console.log(`- ${key}: ${count}`);
  }
}

const candidates = readJson("dashboard/api/enrichment/candidates.json", { items: [] });
const applied = readJson("dashboard/api/enrichment/applied.json", { items: [] });
const review = readJson("dashboard/api/enrichment/review-queue.json", { items: [] });
const summary = readJson("dashboard/api/enrichment/summary.json", {});
const sourceQuality = readJson("dashboard/api/source-quality-score.json", { items: [] });
const sourceCollection = readJson("dashboard/api/source-collection-status.json", { items: [] });

const candidateRows = rows(candidates);
const appliedRows = rows(applied);
const reviewRows = rows(review);
const rejectedRows = candidateRows.filter(item => item.action === "REJECT");
const conflicts = candidateRows.filter(item =>
  item.action === "REVIEW" &&
  item.current_value !== null &&
  item.current_value !== undefined &&
  item.candidate_value !== null &&
  item.candidate_value !== undefined &&
  JSON.stringify(item.current_value) !== JSON.stringify(item.candidate_value)
);

console.log("Source Data Enrichment Engine Audit");
console.log("===================================");
console.log(`summary path: ${summary._path || "-"}`);
console.log(`generated_at: ${summary.generated_at || candidates.generated_at || "-"}`);
console.log(`source rows available: ${rows(sourceCollection).reduce((sum, item) => sum + Number(item.rows_collected || 0), 0).toLocaleString("ko-KR")}`);
console.log(`normalized rows: ${rows(sourceCollection).reduce((sum, item) => sum + Number(item.rows_normalized || 0), 0).toLocaleString("ko-KR")}`);
console.log(`candidates generated: ${candidateRows.length.toLocaleString("ko-KR")}`);
console.log(`auto applied: ${appliedRows.length.toLocaleString("ko-KR")}`);
console.log(`review required: ${reviewRows.length.toLocaleString("ko-KR")}`);
console.log(`rejected: ${rejectedRows.length.toLocaleString("ko-KR")}`);
console.log(`conflicts: ${conflicts.length.toLocaleString("ko-KR")}`);
console.log(`vessels enriched: ${Number(summary.vessels_enriched || 0).toLocaleString("ko-KR")}`);

console.log("");
printCounts("Candidates by source:", countBy(candidateRows, "source_key"));
console.log("");
printCounts("Candidates by field:", countBy(candidateRows, "field_name"));
console.log("");
printCounts("Applied by source:", countBy(appliedRows, "source_key"));
console.log("");
printCounts("Review by source:", countBy(reviewRows, "source_key"));

console.log("\nExamples:");
for (const item of candidateRows.slice(0, 10)) {
  console.log(`- ${item.action} ${item.source_key}.${item.field_name} -> ${item.target_vessel_key} (${item.match_type} ${item.match_confidence}) ${item.reason}`);
}

const problems = [];
for (const payload of [
  ["candidates", candidates],
  ["applied", applied],
  ["review-queue", review],
  ["summary", summary]
]) {
  if (payload[1]._error) problems.push(`${payload[0]} endpoint error: ${payload[1]._error}`);
}
if (candidateRows.length === 0 && rows(sourceQuality).some(item => Number(item.rows_normalized || 0) > 0 || Number(item.rows_matched_to_vessels || 0) > 0)) {
  problems.push("source quality has usable rows but enrichment candidates are empty");
}
for (const item of candidateRows.slice(0, 100)) {
  for (const field of ["candidate_id", "source_key", "target_vessel_key", "match_type", "field_name", "action", "lineage"]) {
    if (!(field in item)) problems.push(`candidate missing ${field}: ${item.candidate_id || item.field_name || "unknown"}`);
  }
}
if (summary.total_candidates !== undefined && Number(summary.total_candidates) !== candidateRows.length) {
  problems.push(`summary total_candidates mismatch: ${summary.total_candidates} != ${candidateRows.length}`);
}
if (summary.auto_applied !== undefined && Number(summary.auto_applied) !== appliedRows.length) {
  problems.push(`summary auto_applied mismatch: ${summary.auto_applied} != ${appliedRows.length}`);
}
if (summary.needs_review !== undefined && Number(summary.needs_review) !== reviewRows.length) {
  problems.push(`summary needs_review mismatch: ${summary.needs_review} != ${reviewRows.length}`);
}

if (problems.length) {
  console.log("\nProblems:");
  for (const problem of [...new Set(problems)].slice(0, 30)) console.log(`- ${problem}`);
  process.exit(1);
}
