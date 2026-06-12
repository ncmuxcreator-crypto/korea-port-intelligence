import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

export const REPORT_JSON = "dashboard/api/enrichment/vessel-display-propagation-report.json";
export const REPORT_MD = "docs/VESSEL_DISPLAY_PROPAGATION_REPORT.md";

const DISPLAY_ENDPOINTS = [
  "dashboard/api/bootstrap.json",
  "dashboard/api/sales/actions.json",
  "dashboard/api/targets/current.json",
  "dashboard/api/watchlist/current.json"
];

function abs(relativePath) {
  return path.join(ROOT, ...String(relativePath).split("/"));
}

export function readJson(relativePath, fallback = {}) {
  try {
    const file = abs(relativePath);
    if (!fs.existsSync(file)) return { ...fallback, __missing: true, __path: relativePath };
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    return { ...fallback, __parse_error: error.message, __path: relativePath };
  }
}

function readDiagnosticJson(relativePath, fallback = {}) {
  const main = readJson(relativePath, fallback);
  const debugPath = String(relativePath).replace(/^dashboard\/api\//, "dashboard/api/debug/");
  const debug = debugPath === relativePath ? null : readJson(debugPath, null);
  if (!debug || debug.__missing || debug.__parse_error) return main;
  if (main.__missing || main.__parse_error) return debug;
  const debugGenerated = Date.parse(debug.generated_at || debug.tier_index_generated_at || "");
  const mainGenerated = Date.parse(main.generated_at || main.tier_index_generated_at || "");
  if (Number.isFinite(debugGenerated) && (!Number.isFinite(mainGenerated) || debugGenerated >= mainGenerated)) return debug;
  return main;
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

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function rows(payload = {}) {
  if (Array.isArray(payload)) return payload;
  return [
    ...asArray(payload.items),
    ...asArray(payload.records),
    ...asArray(payload.targets),
    ...asArray(payload.watchlist),
    ...asArray(payload.candidates),
    ...asArray(payload.top_candidates),
    ...asArray(payload.sales_priority),
    ...asArray(payload.contact_today),
    ...asArray(payload.opportunities)
  ].filter(Boolean);
}

function listVesselPages() {
  const dir = abs("dashboard/api/vessels");
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(name => /^page-\d+\.json$/.test(name))
    .sort((a, b) => Number(a.match(/\d+/)?.[0] || 0) - Number(b.match(/\d+/)?.[0] || 0))
    .map(name => `dashboard/api/vessels/${name}`);
}

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function hasText(value) {
  if (value === undefined || value === null) return false;
  const text = String(value).trim();
  return Boolean(text) && !["-", "unknown", "null", "undefined", "none"].includes(text.toLowerCase());
}

function runId(payload = {}) {
  return payload.active_run_id || payload.run_id || payload.status_run_id || payload.source_run_id || null;
}

function display(item = {}) {
  return item?.vessel_display && typeof item.vessel_display === "object" ? item.vessel_display : item;
}

function signalSource(signal = {}) {
  return String(signal.source || signal.pilotage_source || signal.berth_source || signal.data_source || "").toLowerCase();
}

function isPilotageConfirmed(signal = {}) {
  if (!signal || typeof signal !== "object") return false;
  return signal.has_pilotage === true &&
    signal.placeholder !== true &&
    String(signal.match_type || "").toLowerCase() !== "none" &&
    number(signal.confidence ?? signal.pilotage_confidence) > 0;
}

function isPilotagePlaceholder(signal = {}) {
  return signal && typeof signal === "object" && !isPilotageConfirmed(signal);
}

function isAuxBerthConfirmed(signal = {}) {
  if (!signal || typeof signal !== "object") return false;
  if (signal.placeholder === true) return false;
  if (signal.has_berth_info !== true && signal.has_berth !== true) return false;
  if (String(signal.signal_strength || "").toUpperCase() === "BASELINE") return false;
  if (String(signal.match_type || "").toLowerCase() === "none") return false;
  return !/^(?:port_operation|core|core_field)$/.test(signalSource(signal));
}

function isBerthBaseline(item = {}) {
  const d = display(item);
  const signal = d.berth_signal || {};
  if (isAuxBerthConfirmed(signal)) return false;
  return hasText(d.berth) ||
    hasText(d.terminal) ||
    String(signal.signal_strength || "").toUpperCase() === "BASELINE" ||
    String(signal.match_type || "").toUpperCase() === "CORE_FIELD";
}

function isBerthPlaceholder(signal = {}) {
  return signal && typeof signal === "object" && signal.placeholder === true;
}

function sourceItem(payload = {}, sourceKey = "") {
  return asArray(payload.items).find(item => item.source_key === sourceKey) || {};
}

function utilItem(payload = {}, sourceKey = "") {
  return asArray(payload.items).find(item => item.source_key === sourceKey) || {};
}

function collectOutputScan() {
  const endpoints = [...DISPLAY_ENDPOINTS, ...listVesselPages()];
  const result = {
    files_checked: endpoints.length,
    records_scanned: 0,
    pilotage_signal_display_count: 0,
    pilotage_placeholders: 0,
    aux_confirmed_berth_count: 0,
    baseline_berth_count: 0,
    berth_placeholders: 0,
    samples: {
      pilotage_confirmed: [],
      aux_berth_confirmed: [],
      baseline_berth: []
    }
  };

  for (const endpoint of endpoints) {
    const payload = readJson(endpoint, {});
    for (const item of rows(payload)) {
      const d = display(item);
      result.records_scanned += 1;
      if (isPilotageConfirmed(d.pilotage_signal)) {
        result.pilotage_signal_display_count += 1;
        if (result.samples.pilotage_confirmed.length < 5) result.samples.pilotage_confirmed.push({ endpoint, vessel_name: d.vessel_name || "-", signal: d.pilotage_signal });
      } else if (isPilotagePlaceholder(d.pilotage_signal)) {
        result.pilotage_placeholders += 1;
      }
      if (isAuxBerthConfirmed(d.berth_signal)) {
        result.aux_confirmed_berth_count += 1;
        if (result.samples.aux_berth_confirmed.length < 5) result.samples.aux_berth_confirmed.push({ endpoint, vessel_name: d.vessel_name || "-", signal: d.berth_signal });
      } else if (isBerthBaseline(item)) {
        result.baseline_berth_count += 1;
        if (result.samples.baseline_berth.length < 5) result.samples.baseline_berth.push({ endpoint, vessel_name: d.vessel_name || "-", berth: d.berth || null, terminal: d.terminal || null, signal: d.berth_signal || null });
      } else if (isBerthPlaceholder(d.berth_signal)) {
        result.berth_placeholders += 1;
      }
    }
  }

  result.berth_info_detected_count = result.aux_confirmed_berth_count + result.baseline_berth_count;
  return result;
}

function sampleContradictions(utilization = {}) {
  return asArray(utilization.items).filter(item => {
    const samples = asArray(item.sample_enriched_vessels);
    return number(item.matched_vessels) === 0 &&
      samples.some(sample => asArray(sample.fields_added).length > 0);
  }).map(item => item.source_key);
}

function markdownTable(headers, rows) {
  return [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map(row => `| ${headers.map(header => String(row[header] ?? "-").replace(/\n/g, " ")).join(" | ")} |`)
  ].join("\n");
}

function buildMarkdown(report) {
  const sourceRows = Object.entries(report.source_quality_counts_by_source).map(([source, item]) => ({
    source,
    collected: item.rows_collected,
    normalized: item.rows_normalized,
    matched: item.rows_matched_to_vessels,
    blocker: item.blocker_reason || "-"
  }));
  const utilRows = Object.entries(report.enrichment_utilization_counts_by_source).map(([source, item]) => ({
    source,
    matched: item.rows_matched_to_vessels ?? item.matched_vessels,
    patches: item.enrichment_patches_created,
    display: item.vessel_display_records_updated,
    sample_basis: item.sample_basis || "-"
  }));
  return `# Vessel Display Propagation Report

Generated at: ${report.generated_at}

Status: ${report.status}

## Tier Pointer

- status-summary run_id: ${report.tier_pointer_status.status_summary_run_id || "-"}
- update-tiers core_run_id: ${report.tier_pointer_status.update_tiers_core_run_id || "-"}
- core pointer matches status-summary: ${report.tier_pointer_status.core_pointer_matches_status_summary}
- core pointer source: ${report.tier_pointer_status.core_pointer_source || "-"}

## Output Scan

- pilotage confirmed: ${report.output_scan_counts.pilotage_signal_display_count}
- pilotage placeholders: ${report.output_scan_counts.pilotage_placeholders}
- aux confirmed berth: ${report.output_scan_counts.aux_confirmed_berth_count}
- baseline berth: ${report.output_scan_counts.baseline_berth_count}
- berth placeholders: ${report.output_scan_counts.berth_placeholders}

## Source Quality

${markdownTable(["source", "collected", "normalized", "matched", "blocker"], sourceRows)}

## Enrichment Utilization

${markdownTable(["source", "matched", "patches", "display", "sample_basis"], utilRows)}

## Issues

${report.critical_issues.length ? report.critical_issues.map(issue => `- CRITICAL: ${issue}`).join("\n") : "- No critical issues"}
${report.warnings.length ? `\n${report.warnings.map(issue => `- WARNING: ${issue}`).join("\n")}` : ""}

## Remaining Blockers

${report.remaining_blockers.length ? report.remaining_blockers.map(item => `- ${item.source_key}: ${item.blocker_reason}`).join("\n") : "- none"}
`;
}

export function scanLiveConsistency({ writeReport = false } = {}) {
  const statusSummary = readJson("dashboard/api/status-summary.json", {});
  const updateTiers = readDiagnosticJson("dashboard/api/runtime/update-tiers.json", {});
  const sourceQuality = readDiagnosticJson("dashboard/api/source-quality-score.json", { items: [] });
  const utilization = readDiagnosticJson("dashboard/api/enrichment-utilization.json", { items: [] });
  const bootstrap = readJson("dashboard/api/bootstrap.json", {});
  const outputScan = collectOutputScan();

  const statusRunId = runId(statusSummary);
  const updateCoreRunId = updateTiers.core_run_id || runId(updateTiers);
  const productionStatusExists = statusSummary.generated_by === "github_actions" &&
    (statusSummary.data_mode === "live" || statusSummary.dataset_promotion_status === "promoted" || statusSummary.supabase_write_status === "completed");
  const localPromotedOverProduction = productionStatusExists &&
    updateTiers.generated_by === "local" &&
    updateTiers.local_preview !== true;
  const contradictions = sampleContradictions(utilization);
  const critical = [];
  const warnings = [];

  if (productionStatusExists && statusRunId && updateCoreRunId && statusRunId !== updateCoreRunId) {
    critical.push(`production status-summary run_id ${statusRunId} differs from update-tiers core_run_id ${updateCoreRunId}`);
  }
  if (localPromotedOverProduction) critical.push("local run is promoted as active production core pointer");
  for (const sourceKey of contradictions) {
    critical.push(`${sourceKey} has matched_vessels=0 but sample_enriched_vessels contains applied samples`);
  }

  const sourceQualityCounts = Object.fromEntries(asArray(sourceQuality.items).map(item => [item.source_key, {
    rows_collected: number(item.rows_collected),
    rows_normalized: number(item.rows_normalized),
    rows_matched_to_vessels: number(item.rows_matched_to_vessels),
    blocker_reason: item.blocker_reason || "",
    match_blockers: item.match_blockers || []
  }]));
  const utilizationCounts = Object.fromEntries(asArray(utilization.items).map(item => [item.source_key, {
    matched_vessels: number(item.matched_vessels),
    rows_matched_to_vessels: number(item.rows_matched_to_vessels ?? item.matched_vessels),
    enrichment_patches_created: number(item.enrichment_patches_created),
    vessel_display_records_updated: number(item.vessel_display_records_updated),
    ui_visible_records: number(item.ui_visible_records),
    count_inconsistency: item.count_inconsistency === true,
    sample_basis: item.sample_basis || (number(item.matched_vessels) > 0 ? "matched_records" : "unmatched_records")
  }]));

  for (const sourceKey of ["pilot_sources", "berth_sources"]) {
    const qualityMatched = sourceQualityCounts[sourceKey]?.rows_matched_to_vessels ?? 0;
    const utilMatched = utilizationCounts[sourceKey]?.rows_matched_to_vessels ?? 0;
    if (qualityMatched !== utilMatched) {
      critical.push(`${sourceKey} matched count mismatch: source-quality=${qualityMatched}, enrichment-utilization=${utilMatched}`);
    }
  }

  const bootstrapKpis = bootstrap.kpis || {};
  const bootstrapPilotage = number(bootstrapKpis.pilotage_detected_count ?? bootstrap.pilotage_detected_count);
  const bootstrapAuxBerth = number(bootstrapKpis.aux_confirmed_berth_count ?? bootstrap.aux_confirmed_berth_count);
  const bootstrapBaselineBerth = number(bootstrapKpis.baseline_berth_count ?? bootstrap.baseline_berth_count);
  const bootstrapBerthTotal = number(bootstrapKpis.berth_info_detected_count ?? bootstrap.berth_info_detected_count);
  if (bootstrapPilotage !== outputScan.pilotage_signal_display_count) {
    critical.push(`bootstrap pilotage_detected_count=${bootstrapPilotage} differs from output scan=${outputScan.pilotage_signal_display_count}`);
  }
  if (bootstrapAuxBerth !== outputScan.aux_confirmed_berth_count) {
    critical.push(`bootstrap aux_confirmed_berth_count=${bootstrapAuxBerth} differs from output scan=${outputScan.aux_confirmed_berth_count}`);
  }
  if (bootstrapBaselineBerth !== outputScan.baseline_berth_count) {
    warnings.push(`bootstrap baseline_berth_count=${bootstrapBaselineBerth} differs from output scan=${outputScan.baseline_berth_count}`);
  }
  if (bootstrapBerthTotal !== outputScan.berth_info_detected_count) {
    warnings.push(`bootstrap berth_info_detected_count=${bootstrapBerthTotal} differs from output scan=${outputScan.berth_info_detected_count}`);
  }
  if (updateTiers.mixed_tier_status === true) warnings.push("mixed tiers are documented");
  if (sourceQuality.generated_by === "local" && sourceQuality.reused_from_cache !== true) {
    warnings.push("source-quality-score was generated locally without reused_from_cache=true");
  }

  const remainingBlockers = asArray(sourceQuality.items)
    .filter(item => item.blocker_reason)
    .map(item => ({ source_key: item.source_key, blocker_reason: item.blocker_reason, match_blockers: item.match_blockers || [] }));

  const report = {
    schema_version: "1.0",
    generated_at: new Date().toISOString(),
    status: critical.length ? "CRITICAL" : warnings.length ? "WARNING" : "OK",
    tier_pointer_status: {
      status_summary_run_id: statusRunId,
      update_tiers_core_run_id: updateCoreRunId,
      production_core_run_id: updateTiers.production_core_run_id || null,
      local_preview_run_id: updateTiers.local_preview_run_id || updateTiers.local_run_id || updateTiers.local_core_run_id || null,
      core_pointer_source: updateTiers.core_pointer_source || "",
      core_pointer_matches_status_summary: updateTiers.core_pointer_matches_status_summary ?? Boolean(statusRunId && updateCoreRunId && statusRunId === updateCoreRunId),
      generated_by_mismatch: Boolean(statusSummary.generated_by && updateTiers.core_generated_by && statusSummary.generated_by !== updateTiers.core_generated_by),
      local_run_promoted_over_production: localPromotedOverProduction
    },
    source_quality_counts_by_source: sourceQualityCounts,
    enrichment_utilization_counts_by_source: utilizationCounts,
    output_scan_counts: outputScan,
    bootstrap_counts: {
      pilotage_detected_count: bootstrapPilotage,
      aux_confirmed_berth_count: bootstrapAuxBerth,
      baseline_berth_count: bootstrapBaselineBerth,
      berth_info_detected_count: bootstrapBerthTotal
    },
    berth_signal_semantics_breakdown: {
      aux_confirmed: outputScan.aux_confirmed_berth_count,
      baseline_core_field: outputScan.baseline_berth_count,
      placeholders: outputScan.berth_placeholders
    },
    pilotage_signal_semantics_breakdown: {
      matched_confirmed: outputScan.pilotage_signal_display_count,
      placeholders: outputScan.pilotage_placeholders,
      unmatched: Math.max(0, number(sourceItem(sourceQuality, "pilot_sources").rows_normalized) - outputScan.pilotage_signal_display_count)
    },
    count_inconsistencies_found: contradictions,
    count_inconsistencies_fixed: contradictions.length === 0,
    remaining_blockers: remainingBlockers,
    critical_issues: critical,
    warnings,
    recommended_fix: critical.length
      ? "Run npm run update:core after the live consistency patch and refresh fast_aux/reference_enrichment if source-level mismatches remain."
      : "none"
  };

  if (writeReport) {
    writeJson(REPORT_JSON, report);
    writeText(REPORT_MD, buildMarkdown(report));
  }
  return report;
}
