#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const REPORT_JSON = "dashboard/api/enrichment/enrichment-verification-report.json";
const REPORT_MD = "docs/ENRICHMENT_VERIFICATION_REPORT.md";

const REQUIRED_FILES = [
  "dashboard/api/enrichment-utilization.json",
  "dashboard/api/enrichment/summary.json",
  "dashboard/api/enrichment/applied.json",
  "dashboard/api/enrichment/review-queue.json",
  "dashboard/api/source-quality-score.json",
  "dashboard/api/bootstrap.json",
  "dashboard/api/sales/actions.json",
  "dashboard/api/targets/current.json",
  "dashboard/api/watchlist/current.json",
  "dashboard/api/aux/pilotage-summary.json",
  "dashboard/api/aux/berth-summary.json",
  "dashboard/api/aux/source-csv-summary.json",
  "dashboard/api/aux/vessel-spec-summary.json"
];

const DISPLAY_ENDPOINTS = [
  "dashboard/api/bootstrap.json",
  "dashboard/api/sales/actions.json",
  "dashboard/api/targets/current.json",
  "dashboard/api/watchlist/current.json"
];

function abs(relativePath) {
  return path.join(ROOT, ...relativePath.split("/"));
}

function readJson(relativePath, fallback = {}) {
  const file = abs(relativePath);
  try {
    if (!fs.existsSync(file)) {
      return { ...fallback, __missing: true, __path: relativePath };
    }
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    return { ...fallback, __parse_error: error.message, __path: relativePath };
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

function asItems(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.top_candidates)) return payload.top_candidates;
  if (Array.isArray(payload?.targets)) return payload.targets;
  return [];
}

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function pct(numerator, denominator) {
  const n = toNumber(numerator);
  const d = toNumber(denominator);
  return d > 0 ? Math.round((n / d) * 1000) / 10 : 0;
}

function firstDefined(...values) {
  return values.find(value => value !== undefined && value !== null && value !== "");
}

function getRunId(payload) {
  return firstDefined(payload?.run_id, payload?.source_run_id, payload?.snapshot_context?.run_id, null);
}

function getActiveRunId(payload) {
  return firstDefined(payload?.active_run_id, payload?.snapshot_context?.active_run_id, payload?.run_id, null);
}

function getLatestRunId(payload) {
  return firstDefined(payload?.latest_successful_run_id, payload?.snapshot_context?.latest_successful_run_id, payload?.run_id, null);
}

function listVesselPages() {
  const dir = abs("dashboard/api/vessels");
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(name => /^page-\d+\.json$/.test(name))
    .sort((a, b) => Number(a.match(/\d+/)?.[0] || 0) - Number(b.match(/\d+/)?.[0] || 0))
    .map(name => `dashboard/api/vessels/${name}`);
}

function signalDisplay(vesselDisplay, key) {
  const signal = vesselDisplay?.[key];
  if (!signal || typeof signal !== "object") return false;
  if (key === "pilotage_signal") return signal.has_pilotage === true;
  if (key === "berth_signal") return signal.has_berth_info === true || signal.has_berth === true || signal.has_berth_signal === true;
  return false;
}

function vesselDisplayOf(item) {
  return item?.vessel_display && typeof item.vessel_display === "object" ? item.vessel_display : item;
}

function compactVesselSample(item, endpoint, key) {
  const d = vesselDisplayOf(item);
  return {
    endpoint,
    vessel_name: d?.vessel_name || item?.vessel_name || "-",
    imo: d?.imo || "-",
    mmsi: d?.mmsi || "-",
    call_sign: d?.call_sign || "-",
    current_port: d?.current_port_korean || d?.current_port || "-",
    operator_display: d?.operator_display || d?.operator || "-",
    signal: d?.[key] || null
  };
}

function collectDisplaySignals() {
  const endpoints = [...DISPLAY_ENDPOINTS, ...listVesselPages()];
  const result = {
    endpoints_checked: endpoints.length,
    item_count: 0,
    pilotage_signal_display_count: 0,
    berth_signal_display_count: 0,
    pilotage_samples: [],
    berth_samples: []
  };

  for (const endpoint of endpoints) {
    const payload = readJson(endpoint, {});
    const items = asItems(payload);
    result.item_count += items.length;
    for (const item of items) {
      const display = vesselDisplayOf(item);
      if (signalDisplay(display, "pilotage_signal")) {
        result.pilotage_signal_display_count += 1;
        if (result.pilotage_samples.length < 5) result.pilotage_samples.push(compactVesselSample(item, endpoint, "pilotage_signal"));
      }
      if (signalDisplay(display, "berth_signal")) {
        result.berth_signal_display_count += 1;
        if (result.berth_samples.length < 5) result.berth_samples.push(compactVesselSample(item, endpoint, "berth_signal"));
      }
    }
  }

  return result;
}

function sourceItem(sourceQuality, ...keys) {
  const items = asItems(sourceQuality);
  return items.find(item => keys.includes(item.source_key)) || {};
}

function countApplied(applied, fieldName) {
  return asItems(applied).filter(item => item.field_name === fieldName || item.field === fieldName).length;
}

function findLossStage({ normalizedRows, matchedRows, appliedCount, displayCount }) {
  if (toNumber(normalizedRows) <= 0) return "normalized source row";
  if (toNumber(matchedRows) <= 0) return "match engine";
  if (toNumber(appliedCount) <= 0 && toNumber(displayCount) <= 0) return "enrichment patch";
  if (toNumber(displayCount) <= 0) return "vessel_display builder / output writer";
  return "not_lost";
}

function freshnessRows(files, reference) {
  return files.map(file => {
    const payload = readJson(file, {});
    const generatedAt = payload.generated_at || null;
    const runId = getRunId(payload);
    const activeRunId = getActiveRunId(payload);
    const latestSuccessfulRunId = getLatestRunId(payload);
    const staleDiagnostic = Boolean(payload.stale_diagnostic)
      || Boolean(payload.__missing)
      || Boolean(payload.__parse_error)
      || (reference.generated_at && generatedAt && generatedAt !== reference.generated_at)
      || (reference.run_id && runId && runId !== reference.run_id);
    const staleReason = payload.__missing
      ? "file_missing"
      : payload.__parse_error
        ? `parse_error: ${payload.__parse_error}`
        : payload.stale_reason
          || (reference.generated_at && generatedAt && generatedAt !== reference.generated_at ? "generated_at differs from bootstrap" : null)
          || (reference.run_id && runId && runId !== reference.run_id ? "run_id differs from bootstrap" : null)
          || null;

    return {
      file,
      generated_at: generatedAt,
      run_id: runId,
      active_run_id: activeRunId,
      latest_successful_run_id: latestSuccessfulRunId,
      stale_diagnostic: staleDiagnostic,
      stale_reason: staleReason
    };
  });
}

function markdownTable(headers, rows) {
  const line = `| ${headers.join(" | ")} |`;
  const sep = `| ${headers.map(() => "---").join(" | ")} |`;
  const body = rows.map(row => `| ${headers.map(header => String(row[header] ?? "-").replace(/\n/g, " ")).join(" | ")} |`);
  return [line, sep, ...body].join("\n");
}

function buildMarkdown(report) {
  const freshness = report.freshness.files.map(row => ({
    file: row.file,
    generated_at: row.generated_at || "-",
    run_id: row.run_id || "-",
    stale: row.stale_diagnostic ? "yes" : "no",
    reason: row.stale_reason || "-"
  }));
  const critical = report.critical_issues.length
    ? report.critical_issues.map(issue => `- ${issue.feature}: ${issue.problem} (lost_stage: ${issue.loss_stage || "-"})`).join("\n")
    : "- 없음";
  const warnings = report.warnings.length
    ? report.warnings.map(warning => `- ${warning.feature}: ${warning.problem}`).join("\n")
    : "- 없음";
  const working = report.verified_working_enrichments.length
    ? report.verified_working_enrichments.map(item => `- ${item}`).join("\n")
    : "- 없음";
  const blocked = report.blocked_enrichments.length
    ? report.blocked_enrichments.map(item => `- ${item.feature}: ${item.reason}`).join("\n")
    : "- 없음";

  return `# Enrichment Verification Report

Generated at: ${report.generated_at}

Reference run: ${report.reference_context.run_id || "-"}

Summary score: ${report.summary_score}

Status: ${report.status}

## Critical Issues

${critical}

## Warnings

${warnings}

## Verified Working Enrichments

${working}

## Blocked Enrichments

${blocked}

## Freshness

${markdownTable(["file", "generated_at", "run_id", "stale", "reason"], freshness)}

## Pilotage Propagation

- Rows collected: ${report.pilotage.rows_collected}
- Rows normalized: ${report.pilotage.rows_normalized}
- Rows matched to vessels: ${report.pilotage.rows_matched_to_vessels}
- Signal count: ${report.pilotage.pilotage_signal_count}
- Display count: ${report.pilotage.pilotage_signal_display_count}
- Loss stage: ${report.pilotage.loss_stage}

## Berth / PNC Propagation

- Rows collected: ${report.berth.rows_collected}
- Rows normalized: ${report.berth.rows_normalized}
- Rows matched to vessels: ${report.berth.rows_matched_to_vessels}
- Signal count: ${report.berth.berth_signal_count}
- Display count: ${report.berth.berth_signal_display_count}
- Loss stage: ${report.berth.loss_stage}

## Source CSV

- Status: ${report.source_csv.status}
- Source too large: ${report.source_csv.source_too_large}
- Response size bytes: ${report.source_csv.response_size_bytes}
- Previous cache available: ${report.source_csv.previous_cache_available}
- Using previous cache: ${report.source_csv.using_previous_cache}
- Usable reference rows: ${report.source_csv.usable_reference_rows}
- Recommended fix: ${report.source_csv.recommended_fix || "-"}

## Vessel Spec

- Status: ${report.vessel_spec.status}
- HTTP status: ${report.vessel_spec.http_status || "-"}
- Rows collected: ${report.vessel_spec.rows_collected}
- Rows normalized: ${report.vessel_spec.rows_normalized}
- Parser blocker: ${report.vessel_spec.parser_blocker || "-"}
- Sanitized sample keys: ${(report.vessel_spec.sanitized_raw_sample_keys || []).join(", ") || "-"}

## MOF AIS

- Info coverage label: ${report.mof_ais.info.coverage_label || "-"}
- Dynamic coverage label: ${report.mof_ais.dynamic.coverage_label || "-"}
- Recommendation: ${report.mof_ais.recommendation || "-"}

## Next Fixes

${report.next_fixes.map(item => `- ${item}`).join("\n") || "- 없음"}
`;
}

const bootstrap = readJson("dashboard/api/bootstrap.json", {});
const utilization = readJson("dashboard/api/enrichment-utilization.json", {});
const enrichmentSummary = readJson("dashboard/api/enrichment/summary.json", {});
const applied = readJson("dashboard/api/enrichment/applied.json", { items: [] });
const sourceQuality = readJson("dashboard/api/source-quality-score.json", { items: [] });
const pilotageSummary = readJson("dashboard/api/aux/pilotage-summary.json", {});
const berthSummary = readJson("dashboard/api/aux/berth-summary.json", {});
const sourceCsvSummary = readJson("dashboard/api/aux/source-csv-summary.json", {});
const vesselSpecSummary = readJson("dashboard/api/aux/vessel-spec-summary.json", {});
const displaySignals = collectDisplaySignals();

const referenceContext = {
  generated_at: bootstrap.generated_at || null,
  run_id: getRunId(bootstrap),
  active_run_id: getActiveRunId(bootstrap),
  latest_successful_run_id: getLatestRunId(bootstrap),
  total_vessels: toNumber(bootstrap.kpis?.total_vessels ?? bootstrap.total_vessels)
};

const allFiles = [...REQUIRED_FILES, ...listVesselPages()];
const freshness = freshnessRows(allFiles, referenceContext);

const pilotSource = sourceItem(sourceQuality, "pilot_sources", "pilotage", "pilot");
const berthSource = sourceItem(sourceQuality, "berth_sources", "pnc", "PNC_SOURCE_URLS");
const sourceCsv = sourceItem(sourceQuality, "source_csv");
const vesselSpec = sourceItem(sourceQuality, "vessel_spec");
const mofAisInfo = sourceItem(sourceQuality, "mof_ais_info");
const mofAisDynamic = sourceItem(sourceQuality, "mof_ais_dynamic");

const pilotage = {
  rows_collected: toNumber(firstDefined(pilotageSummary.raw_pilot_rows, pilotageSummary.rows_collected, pilotSource.rows_collected)),
  rows_normalized: toNumber(firstDefined(pilotageSummary.normalized_pilot_rows, pilotageSummary.rows_normalized, pilotSource.rows_normalized)),
  rows_matched_to_vessels: toNumber(firstDefined(pilotageSummary.matched_vessels, pilotageSummary.rows_matched_to_vessels, pilotSource.rows_matched_to_vessels)),
  pilotage_signal_count: toNumber(firstDefined(pilotageSummary.pilotage_signal_count, utilization.pilotage_signal_count, bootstrap.kpis?.pilotage_detected_count)),
  pilotage_signal_display_count: toNumber(firstDefined(utilization.pilotage_signal_display_count, displaySignals.pilotage_signal_display_count)),
  matched_by_call_sign: toNumber(pilotageSummary.matched_by_call_sign),
  matched_by_vessel_name: toNumber(pilotageSummary.matched_by_vessel_name),
  unmatched_pilot_rows: toNumber(pilotageSummary.unmatched_pilot_rows),
  samples: displaySignals.pilotage_samples
};
pilotage.loss_stage = findLossStage({
  normalizedRows: pilotage.rows_normalized,
  matchedRows: pilotage.rows_matched_to_vessels || pilotage.pilotage_signal_count,
  appliedCount: countApplied(applied, "pilotage_signal"),
  displayCount: pilotage.pilotage_signal_display_count
});

const berth = {
  rows_collected: toNumber(firstDefined(berthSummary.raw_rows, berthSummary.rows_collected, berthSource.rows_collected)),
  rows_normalized: toNumber(firstDefined(berthSummary.normalized_rows, berthSummary.rows_normalized, berthSource.rows_normalized)),
  rows_matched_to_vessels: toNumber(firstDefined(berthSummary.matched_vessels, berthSummary.rows_matched_to_vessels, berthSource.rows_matched_to_vessels)),
  berth_signal_count: toNumber(firstDefined(berthSummary.berth_signal_count, utilization.berth_signal_count, bootstrap.kpis?.berth_info_detected_count)),
  berth_signal_display_count: toNumber(firstDefined(utilization.berth_signal_display_count, displaySignals.berth_signal_display_count)),
  rows_with_terminal: toNumber(berthSummary.rows_with_terminal),
  rows_with_berth: toNumber(berthSummary.rows_with_berth),
  matched_by_call_sign: toNumber(berthSummary.matched_by_call_sign),
  matched_by_vessel_name: toNumber(berthSummary.matched_by_vessel_name),
  unmatched_rows: toNumber(berthSummary.unmatched_rows),
  samples: displaySignals.berth_samples
};
berth.loss_stage = findLossStage({
  normalizedRows: berth.rows_normalized,
  matchedRows: berth.rows_matched_to_vessels || berth.berth_signal_count,
  appliedCount: countApplied(applied, "berth_signal"),
  displayCount: berth.berth_signal_display_count
});

const sourceCsvReport = {
  status: firstDefined(sourceCsvSummary.status, sourceCsv.status, "UNKNOWN"),
  source_too_large: Boolean(sourceCsvSummary.source_too_large || sourceCsv.status === "SOURCE_TOO_LARGE" || sourceCsv.blocker_reason === "SOURCE_TOO_LARGE"),
  response_size_bytes: toNumber(firstDefined(sourceCsvSummary.response_size_bytes, sourceCsv.response_size_bytes)),
  previous_cache_available: Boolean(sourceCsvSummary.previous_cache_available),
  using_previous_cache: Boolean(sourceCsvSummary.using_previous_cache),
  usable_reference_rows: toNumber(sourceCsvSummary.usable_reference_rows),
  rows_with_imo: toNumber(sourceCsvSummary.rows_with_imo),
  rows_with_mmsi: toNumber(sourceCsvSummary.rows_with_mmsi),
  rows_with_operator: toNumber(sourceCsvSummary.rows_with_operator),
  recommended_fix: firstDefined(sourceCsvSummary.recommended_fix, sourceCsv.recommended_fix)
};

const vesselSpecReport = {
  status: firstDefined(vesselSpecSummary.status, vesselSpec.status, "UNKNOWN"),
  http_status: firstDefined(vesselSpecSummary.http_status, vesselSpec.http_status, null),
  rows_collected: toNumber(firstDefined(vesselSpecSummary.rows_collected, vesselSpec.rows_collected)),
  rows_normalized: toNumber(firstDefined(vesselSpecSummary.rows_normalized, vesselSpec.rows_normalized)),
  parser_blocker: firstDefined(vesselSpecSummary.parser_blocker, vesselSpec.parser_blocker, vesselSpec.blocker_reason, null),
  sanitized_raw_sample_keys: vesselSpecSummary.sanitized_raw_sample_keys || vesselSpec.raw_sample_keys || [],
  utilization_score: toNumber(vesselSpec.utilization_score)
};

const totalVessels = referenceContext.total_vessels;
const mofAis = {
  info: {
    rows_collected: toNumber(mofAisInfo.rows_collected),
    coverage_label: mofAisInfo.coverage_label || (toNumber(mofAisInfo.rows_collected) <= 10 && totalVessels > 100 ? "SMOKE_LEVEL" : mofAisInfo.quality_label || null),
    recommendation: mofAisInfo.recommended_fix || mofAisInfo.recommendation || null
  },
  dynamic: {
    rows_collected: toNumber(mofAisDynamic.rows_collected),
    coverage_label: mofAisDynamic.coverage_label || (toNumber(mofAisDynamic.rows_collected) <= 10 && totalVessels > 100 ? "SMOKE_LEVEL" : mofAisDynamic.quality_label || null),
    recommendation: mofAisDynamic.recommended_fix || mofAisDynamic.recommendation || null
  },
  recommendation: "Enrich sales targets first, then detail eligible top 100; do not enrich all detected vessels in one run."
};

const criticalIssues = [];
const warnings = [];
const verifiedWorking = [];
const blocked = [];
const nextFixes = [];

if (pilotage.pilotage_signal_count > 0 && pilotage.pilotage_signal_display_count === 0) {
  criticalIssues.push({
    feature: "pilotage_signal",
    severity: "CRITICAL",
    problem: "Pilotage matches/signals exist, but no vessel_display output contains pilotage_signal.",
    loss_stage: pilotage.loss_stage
  });
  nextFixes.push("Connect pilotage enrichment patches to buildVesselDisplay output writer for vessels, sales actions, targets, watchlist, and bootstrap.");
} else if (pilotage.pilotage_signal_display_count > 0) {
  verifiedWorking.push(`Pilotage signal visible in ${pilotage.pilotage_signal_display_count} display records.`);
}

if (berth.berth_signal_count > 0 && berth.berth_signal_display_count === 0) {
  criticalIssues.push({
    feature: "berth_signal",
    severity: "CRITICAL",
    problem: "Berth/PNC matches/signals exist, but no vessel_display output contains berth_signal.",
    loss_stage: berth.loss_stage
  });
  nextFixes.push("Connect berth/PNC enrichment patches to buildVesselDisplay and compact output mappers.");
} else if (berth.berth_signal_display_count > 0) {
  verifiedWorking.push(`Berth signal visible in ${berth.berth_signal_display_count} display records.`);
}

for (const row of freshness) {
  if (row.stale_diagnostic) {
    warnings.push({
      feature: "freshness",
      severity: "WARNING",
      problem: `${row.file} is stale or missing context: ${row.stale_reason || "unknown"}`
    });
  }
}

if (sourceCsvReport.source_too_large) {
  verifiedWorking.push("source_csv oversized response is isolated from the core update.");
  if (!sourceCsvReport.recommended_fix) {
    warnings.push({
      feature: "source_csv",
      severity: "WARNING",
      problem: "SOURCE_TOO_LARGE is present but recommended_fix is missing."
    });
  }
  if (sourceCsvReport.usable_reference_rows > 0 && !sourceCsvReport.previous_cache_available) {
    warnings.push({
      feature: "source_csv",
      severity: "WARNING",
      problem: "usable_reference_rows exists but previous_cache_available is not marked."
    });
  }
  blocked.push({
    feature: "source_csv",
    reason: `Configured source is too large (${sourceCsvReport.response_size_bytes || 0} bytes); use a smaller verified vessel reference CSV.`
  });
}

if (vesselSpecReport.http_status === 200 && vesselSpecReport.rows_normalized === 0) {
  if (!vesselSpecReport.parser_blocker) {
    warnings.push({
      feature: "vessel_spec",
      severity: "WARNING",
      problem: "HTTP 200 with rows_normalized=0 but parser_blocker is missing."
    });
  }
  if (!vesselSpecReport.sanitized_raw_sample_keys.length) {
    warnings.push({
      feature: "vessel_spec",
      severity: "WARNING",
      problem: "HTTP 200 with rows_normalized=0 but sanitized raw sample keys are missing."
    });
  }
  if (vesselSpecReport.utilization_score >= 60) {
    warnings.push({
      feature: "vessel_spec",
      severity: "WARNING",
      problem: "vessel_spec has zero normalized rows but is scored as high utilization."
    });
  }
  blocked.push({
    feature: "vessel_spec",
    reason: vesselSpecReport.parser_blocker || "Parser blocker is not classified."
  });
}

for (const [label, source] of [["mof_ais_info", mofAis.info], ["mof_ais_dynamic", mofAis.dynamic]]) {
  if (source.rows_collected <= 10 && totalVessels > 100) {
    if (source.coverage_label !== "SMOKE_LEVEL") {
      warnings.push({
        feature: label,
        severity: "WARNING",
        problem: "Rows collected <= 10 while total_vessels > 100, but coverage_label is not SMOKE_LEVEL."
      });
    }
    if (!String(source.recommendation || mofAis.recommendation).toLowerCase().includes("target")) {
      warnings.push({
        feature: label,
        severity: "WARNING",
        problem: "Smoke-level AIS source lacks target-based expansion recommendation."
      });
    }
  }
}

if (enrichmentSummary.__missing || enrichmentSummary.__parse_error) {
  blocked.push({
    feature: "enrichment_summary",
    reason: enrichmentSummary.__missing ? "summary file missing" : enrichmentSummary.__parse_error
  });
}

const summaryScore = Math.max(0, 100 - criticalIssues.length * 25 - warnings.length * 5 - blocked.length * 3);
const status = criticalIssues.length ? "CRITICAL" : warnings.length ? "WARNING" : "PASS";

const report = {
  schema_version: "1.0",
  generated_at: new Date().toISOString(),
  data_mode: "verification",
  status,
  summary_score: summaryScore,
  reference_context: referenceContext,
  freshness: {
    stale_file_count: freshness.filter(row => row.stale_diagnostic).length,
    files: freshness
  },
  pilotage,
  berth,
  source_csv: sourceCsvReport,
  vessel_spec: vesselSpecReport,
  mof_ais: mofAis,
  display_scan: displaySignals,
  critical_issues: criticalIssues,
  warnings,
  verified_working_enrichments: verifiedWorking,
  blocked_enrichments: blocked,
  next_fixes: [...new Set(nextFixes)]
};

writeJson(REPORT_JSON, report);
writeText(REPORT_MD, buildMarkdown(report));

console.log("Enrichment Verification");
console.log("=======================");
console.log(`status=${report.status}`);
console.log(`summary_score=${report.summary_score}`);
console.log(`critical_issues=${report.critical_issues.length}`);
console.log(`warnings=${report.warnings.length}`);
console.log(`stale_files=${report.freshness.stale_file_count}`);
console.log(`pilotage_signal_count=${report.pilotage.pilotage_signal_count}`);
console.log(`pilotage_signal_display_count=${report.pilotage.pilotage_signal_display_count}`);
console.log(`berth_signal_count=${report.berth.berth_signal_count}`);
console.log(`berth_signal_display_count=${report.berth.berth_signal_display_count}`);
console.log(`report=${REPORT_JSON}`);
console.log(`doc=${REPORT_MD}`);
