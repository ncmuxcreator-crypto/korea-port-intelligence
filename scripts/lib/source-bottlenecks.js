export const SOURCE_BOTTLENECK_REPORT_JSON = "dashboard/api/enrichment/source-bottleneck-report.json";
export const SOURCE_BOTTLENECK_REPORT_MD = "docs/SOURCE_ENRICHMENT_BOTTLENECK_REPORT.md";

const DEFAULT_ENRICHMENT_SOURCE_KEYS = [
  "source_csv",
  "pilot_sources",
  "berth_sources",
  "vessel_spec",
  "mof_ais_info",
  "mof_ais_dynamic"
];

const STAGES = new Set([
  "FETCH_BLOCKED",
  "NORMALIZE_BLOCKED",
  "MATCH_BLOCKED",
  "PATCH_BLOCKED",
  "DISPLAY_BLOCKED",
  "COVERAGE_LIMITED"
]);

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function asItems(payload = {}) {
  return Array.isArray(payload?.items) ? payload.items : [];
}

function sourceItem(payload = {}, sourceKey = "") {
  return asItems(payload).find(item => item.source_key === sourceKey) || {};
}

function unique(values = []) {
  return [...new Set(values.filter(value => value !== undefined && value !== null && String(value).trim() !== "").map(value => String(value).trim()))];
}

function sourceKeys(sourceQualityScore = {}, enrichmentUtilization = {}) {
  return unique([
    ...DEFAULT_ENRICHMENT_SOURCE_KEYS,
    ...asItems(sourceQualityScore).map(item => item.source_key),
    ...asItems(enrichmentUtilization).map(item => item.source_key)
  ]).filter(key => key && key !== "port_operation");
}

function stageCounts(items = []) {
  return items.reduce((acc, item) => {
    const stage = item.bottleneck_stage || "UNKNOWN";
    acc[stage] = (acc[stage] || 0) + 1;
    return acc;
  }, {});
}

function sourceRows({ quality = {}, utilization = {} } = {}) {
  return {
    rows_collected: number(quality.rows_collected ?? utilization.source_rows_collected ?? utilization.rows_collected),
    rows_normalized: number(quality.rows_normalized ?? utilization.rows_normalized),
    rows_matched_to_vessels: number(quality.rows_matched_to_vessels ?? utilization.rows_matched_to_vessels ?? utilization.matched_vessels),
    patches_created: number(
      utilization.patch_hints_created ??
      utilization.enrichment_patches_created ??
      utilization.enrichment_patches_created_count
    ),
    vessel_display_records_updated: number(utilization.vessel_display_records_updated)
  };
}

function sourceBlockerReason({ sourceKey = "", quality = {}, utilization = {}, stage = "" } = {}) {
  const explicit = quality.blocker_reason || utilization.blocker_reason || "";
  if (explicit) return explicit;
  if (sourceKey === "source_csv") return "SOURCE_CSV_URL still points to a large raw CSV or exceeds MAX_SOURCE_CSV_BYTES.";
  if (sourceKey === "vessel_spec") return "HTTP/fetch can succeed, but parser aliases or response shape do not produce normalized rows.";
  if (sourceKey === "pilot_sources") return "Rows are collected and normalized, but no high-confidence vessel match exists yet.";
  if (sourceKey === "berth_sources") return "PNC/berth rows are collected and normalized, but no high-confidence vessel match exists yet.";
  if (["mof_ais_info", "mof_ais_dynamic"].includes(sourceKey)) return "MOF AIS enrichment is currently smoke-level compared with the vessel universe.";
  return stage ? `Classified at ${stage}.` : "";
}

function recommendedNextAction(sourceKey = "", stage = "") {
  if (sourceKey === "source_csv") {
    return "Point SOURCE_CSV_URL to a lightweight verified reference CSV and run reference_enrichment only.";
  }
  if (sourceKey === "pilot_sources") {
    return "Strengthen call_sign, vessel_name, normalized_port, and time-window matching before applying weak matches.";
  }
  if (sourceKey === "berth_sources") {
    return "Strengthen PNC vessel name, vessel code, berth, terminal, and port matching before applying identity fields.";
  }
  if (sourceKey === "vessel_spec") {
    return "Inspect raw_sample_keys and add parser aliases or nested response handling.";
  }
  if (["mof_ais_info", "mof_ais_dynamic"].includes(sourceKey)) {
    return "Expand target-based AIS enrichment for sales targets and contact-now vessels.";
  }
  if (stage === "PATCH_BLOCKED") return "Create safe enrichment patches from matched rows.";
  if (stage === "DISPLAY_BLOCKED") return "Propagate created patches into vessel_display and compact business outputs.";
  return "Review source-specific diagnostics and refresh the owning tier.";
}

function classifyStage({ sourceKey = "", rows = {}, quality = {}, utilization = {}, totalVessels = 0 } = {}) {
  const blocker = String(quality.blocker_reason || utilization.blocker_reason || quality.recommended_fix || "").toLowerCase();
  const status = String(quality.status || utilization.status || "").toUpperCase();
  const collected = rows.rows_collected;
  const normalized = rows.rows_normalized;
  const matched = rows.rows_matched_to_vessels;
  const patches = rows.patches_created;
  const displayUpdated = rows.vessel_display_records_updated;

  if (sourceKey === "source_csv") {
    if (/too large|source_too_large|source_csv_url|response.*large|max_source_csv_bytes|source_too_large|fetch_failed|source_too_large/i.test(blocker) ||
      ["SOURCE_TOO_LARGE", "FETCH_FAILED"].includes(status) ||
      (collected <= 0 && normalized <= 0)) {
      return "FETCH_BLOCKED";
    }
  }

  if (sourceKey === "vessel_spec" && normalized <= 0 && (collected > 0 || /http 200|alias|schema|parser|wrong_schema|nested/.test(blocker))) {
    return "NORMALIZE_BLOCKED";
  }

  if (["pilot_sources", "berth_sources"].includes(sourceKey) && collected > 0 && normalized > 0 && matched <= 0) {
    return "MATCH_BLOCKED";
  }

  if (["mof_ais_info", "mof_ais_dynamic"].includes(sourceKey) &&
    collected > 0 &&
    normalized > 0 &&
    matched > 0 &&
    totalVessels > Math.max(100, collected) &&
    collected <= 10) {
    return "COVERAGE_LIMITED";
  }

  if (collected <= 0 && normalized <= 0 && matched <= 0) return "FETCH_BLOCKED";
  if (collected > 0 && normalized <= 0) return "NORMALIZE_BLOCKED";
  if (normalized > 0 && matched <= 0) return "MATCH_BLOCKED";
  if (patches > 0 && displayUpdated <= 0) return "DISPLAY_BLOCKED";
  if (matched > 0 && patches <= 0) return "PATCH_BLOCKED";
  if (matched > 0 && totalVessels > 0 && collected > 0 && collected <= Math.max(10, totalVessels * 0.1)) return "COVERAGE_LIMITED";
  return "PATCH_BLOCKED";
}

function evidenceFor({ sourceKey = "", rows = {}, quality = {}, utilization = {}, totalVessels = 0, stage = "" } = {}) {
  const evidence = [
    `rows_collected=${rows.rows_collected}`,
    `rows_normalized=${rows.rows_normalized}`,
    `rows_matched_to_vessels=${rows.rows_matched_to_vessels}`,
    `patches_created=${rows.patches_created}`,
    `vessel_display_records_updated=${rows.vessel_display_records_updated}`
  ];
  if (totalVessels) evidence.push(`total_vessels=${totalVessels}`);
  if (sourceKey === "source_csv" && stage === "FETCH_BLOCKED") {
    evidence.push("source_csv cannot produce usable reference rows before fetch/body-size guard completes");
  }
  if (sourceKey === "vessel_spec" && stage === "NORMALIZE_BLOCKED") {
    evidence.push("vessel_spec fetch/HTTP can succeed but normalized parser output is empty");
  }
  if (["pilot_sources", "berth_sources"].includes(sourceKey) && stage === "MATCH_BLOCKED") {
    evidence.push("normalized auxiliary rows exist but no current vessel match is confirmed");
  }
  if (["mof_ais_info", "mof_ais_dynamic"].includes(sourceKey) && stage === "COVERAGE_LIMITED") {
    evidence.push("MOF AIS rows are smoke-level compared with the vessel universe");
  }
  const blocker = quality.blocker_reason || utilization.blocker_reason;
  if (blocker) evidence.push(`blocker=${blocker}`);
  return evidence;
}

export function buildSourceBottleneckReport({
  sourceQualityScore = {},
  enrichmentUtilization = {},
  bootstrap = {},
  statusSummary = {},
  generatedAt = new Date().toISOString()
} = {}) {
  const totalVessels = number(
    enrichmentUtilization.total_vessels ??
    bootstrap.kpis?.total_vessels ??
    bootstrap.total_vessels ??
    statusSummary.total_rows ??
    statusSummary.record_count
  );
  const items = sourceKeys(sourceQualityScore, enrichmentUtilization).map(sourceKey => {
    const quality = sourceItem(sourceQualityScore, sourceKey);
    const utilization = sourceItem(enrichmentUtilization, sourceKey);
    const rows = sourceRows({ quality, utilization });
    const stage = classifyStage({ sourceKey, rows, quality, utilization, totalVessels });
    const safeStage = STAGES.has(stage) ? stage : "PATCH_BLOCKED";
    const blockerReason = sourceBlockerReason({ sourceKey, quality, utilization, stage: safeStage });
    return {
      source_key: sourceKey,
      bottleneck_stage: safeStage,
      evidence: evidenceFor({ sourceKey, rows, quality, utilization, totalVessels, stage: safeStage }),
      ...rows,
      blocker_reason: blockerReason,
      recommended_next_action: recommendedNextAction(sourceKey, safeStage)
    };
  });

  return {
    schema_version: "1.0",
    generated_at: generatedAt,
    owner_tier: "mixed",
    core_may_update: "classification_only",
    load_strategy: "lazy",
    startup_safe: false,
    source_quality_run_id: sourceQualityScore.run_id || sourceQualityScore.source_run_id || null,
    enrichment_utilization_run_id: enrichmentUtilization.run_id || enrichmentUtilization.source_run_id || null,
    status_summary_run_id: statusSummary.active_run_id || statusSummary.run_id || statusSummary.status_run_id || null,
    total_vessels: totalVessels,
    source_count: items.length,
    record_count: items.length,
    item_count: items.length,
    stage_counts: stageCounts(items),
    items
  };
}

export function attachSourceBottleneckSummary(payload = {}, report = {}) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return payload;
  const bySource = new Map(asItems(report).map(item => [item.source_key, item]));
  return {
    ...payload,
    source_bottleneck_summary: {
      generated_at: report.generated_at || null,
      report_endpoint: SOURCE_BOTTLENECK_REPORT_JSON,
      stage_counts: report.stage_counts || {},
      items: asItems(report)
    },
    items: Array.isArray(payload.items)
      ? payload.items.map(item => {
        const bottleneck = bySource.get(item.source_key);
        const matched = number(item.rows_matched_to_vessels ?? item.matched_vessels);
        const appliedSamples = Array.isArray(item.sample_enriched_vessels) ? item.sample_enriched_vessels : [];
        const contradictorySamples = matched <= 0
          ? appliedSamples.filter(sample => Array.isArray(sample.fields_added) && sample.fields_added.length > 0)
          : [];
        const normalizedSamples = contradictorySamples.length
          ? {
            sample_enriched_vessels: appliedSamples.filter(sample => !contradictorySamples.includes(sample)),
            candidate_samples: [
              ...(Array.isArray(item.candidate_samples) ? item.candidate_samples : []),
              ...contradictorySamples.map(sample => ({
                ...sample,
                sample_basis: "candidate_visible_fields_not_source_matched"
              }))
            ],
            count_inconsistency: false,
            count_inconsistency_resolved: true,
            count_inconsistency_note: "Moved visible candidate samples out of sample_enriched_vessels because source matched count is zero.",
            sample_basis: "candidate_visible_fields"
          }
          : {};
        return bottleneck
          ? {
            ...item,
            ...normalizedSamples,
            bottleneck_stage: bottleneck.bottleneck_stage,
            bottleneck_evidence: bottleneck.evidence,
            bottleneck_recommended_next_action: bottleneck.recommended_next_action
          }
          : item;
      })
      : payload.items
  };
}

function markdownTable(headers, rows) {
  return [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map(row => `| ${headers.map(header => String(row[header] ?? "-").replace(/\n/g, " ")).join(" | ")} |`)
  ].join("\n");
}

export function buildSourceBottleneckMarkdown(report = {}) {
  const rows = asItems(report).map(item => ({
    source_key: item.source_key,
    bottleneck_stage: item.bottleneck_stage,
    collected: item.rows_collected,
    normalized: item.rows_normalized,
    matched: item.rows_matched_to_vessels,
    patches: item.patches_created,
    display: item.vessel_display_records_updated,
    next_action: item.recommended_next_action
  }));
  return `# Source Enrichment Bottleneck Report

Generated at: ${report.generated_at || "-"}

Source quality run: ${report.source_quality_run_id || "-"}

Enrichment utilization run: ${report.enrichment_utilization_run_id || "-"}

Status summary run: ${report.status_summary_run_id || "-"}

Total vessels: ${report.total_vessels ?? "-"}

Stage counts: ${JSON.stringify(report.stage_counts || {})}

${markdownTable(["source_key", "bottleneck_stage", "collected", "normalized", "matched", "patches", "display", "next_action"], rows)}
`;
}
