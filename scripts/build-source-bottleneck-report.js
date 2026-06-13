#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import {
  attachSourceBottleneckSummary,
  buildSourceBottleneckMarkdown,
  buildSourceBottleneckReport,
  SOURCE_BOTTLENECK_REPORT_JSON,
  SOURCE_BOTTLENECK_REPORT_MD
} from "./lib/source-bottlenecks.js";

const ROOT = process.cwd();

function abs(relativePath) {
  return path.join(ROOT, ...relativePath.split("/"));
}

function readJson(relativePath, fallback = {}) {
  try {
    const file = abs(relativePath);
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : fallback;
  } catch (error) {
    return { ...fallback, __parse_error: error.message };
  }
}

function writeJson(relativePath, payload) {
  const file = abs(relativePath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function writeText(relativePath, text) {
  const file = abs(relativePath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, "utf8");
}

const sourceQualityScore = readJson("dashboard/api/source-quality-score.json", { items: [] });
const enrichmentUtilization = readJson("dashboard/api/enrichment-utilization.json", { items: [] });
const bootstrap = readJson("dashboard/api/bootstrap.json", {});
const statusSummary = readJson("dashboard/api/status-summary.json", {});

const report = {
  generated_by: "local",
  is_github_actions: false,
  run_id: statusSummary.run_id || sourceQualityScore.run_id || enrichmentUtilization.run_id || null,
  source_run_id: sourceQualityScore.source_run_id || sourceQualityScore.run_id || null,
  status_run_id: statusSummary.active_run_id || statusSummary.run_id || null,
  active_run_id: statusSummary.active_run_id || statusSummary.run_id || null,
  stale_diagnostic: false,
  stale_reason: "",
  ...buildSourceBottleneckReport({
    sourceQualityScore,
    enrichmentUtilization,
    bootstrap,
    statusSummary,
    generatedAt: new Date().toISOString()
  })
};

writeJson(SOURCE_BOTTLENECK_REPORT_JSON, report);
writeText(SOURCE_BOTTLENECK_REPORT_MD, buildSourceBottleneckMarkdown(report));
writeJson("dashboard/api/source-quality-score.json", attachSourceBottleneckSummary(sourceQualityScore, report));
writeJson("dashboard/api/enrichment-utilization.json", attachSourceBottleneckSummary(enrichmentUtilization, report));

console.log("Source enrichment bottleneck report");
console.log("===================================");
console.log(`report=${SOURCE_BOTTLENECK_REPORT_JSON}`);
console.log(`doc=${SOURCE_BOTTLENECK_REPORT_MD}`);
for (const item of report.items || []) {
  console.log(`${item.source_key}: ${item.bottleneck_stage} (${item.rows_collected}/${item.rows_normalized}/${item.rows_matched_to_vessels})`);
}
