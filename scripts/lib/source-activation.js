import { SOURCE_CSV_URL_RECOMMENDED_FIX, diagnoseSourceCsvUrl } from "./source-csv-url.js";

const ULSAN_AUXILIARY_SOURCE_KEYS = new Set([
  "ulsan_core",
  "ulsan_berth_detail",
  "ulsan_cargo_plan",
  "ulsan_berth_operation",
  "ulsan_terminal_process"
]);

const AUXILIARY_SOURCE_KEYS = new Set([
  "source_csv",
  "vessel_spec",
  ...ULSAN_AUXILIARY_SOURCE_KEYS
]);

const ULSAN_AUXILIARY_BUSINESS_IMPACT = "울산 상세 선석/화물/터미널 보강은 지연됨";

const SOURCE_SPECS = [
  {
    key: "source_csv",
    label: "Source CSV",
    collectorKeys: ["source_csv"],
    expectedEnvNames: ["SOURCE_CSV_URL", "ENABLE_SOURCE_CSV"],
    requiredAny: ["SOURCE_CSV_URL"],
    activationEnv: ["ENABLE_SOURCE_CSV"],
    sourceLayer: "auxiliary",
    coreBlocking: false,
    businessImpact: "Verified source CSV enrichment cache may not refresh; existing cache is used if available.",
    fixHint: "Set SOURCE_CSV_URL and ENABLE_SOURCE_CSV=true, or provide a smaller verified vessel reference CSV."
  },
  {
    key: "vessel_spec",
    label: "Vessel specification",
    collectorKeys: ["vessel_spec"],
    expectedEnvNames: ["VESSEL_SPEC_SERVICE_KEY", "VESSEL_SPEC_API_URL"],
    required: ["VESSEL_SPEC_SERVICE_KEY", "VESSEL_SPEC_API_URL"],
    sourceLayer: "auxiliary",
    coreBlocking: false,
    businessImpact: "Vessel particulars such as IMO, MMSI, GT, DWT, flag, and vessel type may remain incomplete.",
    fixHint: "Set VESSEL_SPEC_SERVICE_KEY and VESSEL_SPEC_API_URL."
  },
  {
    key: "pilot_sources",
    label: "Pilot schedule sources",
    collectorPrefix: "pilot_source_",
    expectedEnvNames: ["PILOT_SOURCE_URLS"],
    requiredAny: ["PILOT_SOURCE_URLS"],
    businessImpact: "Pilotage timing and berth-arrival confirmation signals are unavailable.",
    fixHint: "Set PILOT_SOURCE_URLS to one or more allowed pilot schedule URLs."
  },
  {
    key: "berth_sources",
    label: "Berth schedule sources",
    collectorPrefix: "pnc_source_",
    expectedEnvNames: ["BERTH_SOURCE_URLS", "PNC_SOURCE_URLS"],
    requiredAny: ["BERTH_SOURCE_URLS", "PNC_SOURCE_URLS"],
    businessImpact: "Berth assignment and terminal schedule enrichment may be unavailable.",
    fixHint: "Set BERTH_SOURCE_URLS or PNC_SOURCE_URLS. Current collector directly uses PNC_SOURCE_URLS for berth-like feeds."
  },
  {
    key: "mof_ais_dynamic",
    label: "MOF AIS dynamic",
    collectorKeys: ["mof_ais_dynamic"],
    expectedEnvNames: ["MOF_AIS_DYNAMIC_API_URL", "MOF_AIS_DYNAMIC_SERVICE_KEY"],
    required: ["MOF_AIS_DYNAMIC_API_URL", "MOF_AIS_DYNAMIC_SERVICE_KEY"],
    businessImpact: "Live AIS position, speed, slow-steaming, and dwell-time signals remain weak.",
    fixHint: "Set MOF_AIS_DYNAMIC_API_URL and MOF_AIS_DYNAMIC_SERVICE_KEY."
  },
  {
    key: "mof_ais_info",
    label: "MOF AIS info",
    collectorKeys: ["mof_ais_info"],
    expectedEnvNames: ["MOF_AIS_INFO_API_URL", "MOF_AIS_INFO_SERVICE_KEY"],
    required: ["MOF_AIS_INFO_API_URL", "MOF_AIS_INFO_SERVICE_KEY"],
    businessImpact: "AIS vessel identity and static particulars may not enrich vessel_display.",
    fixHint: "Set MOF_AIS_INFO_API_URL and MOF_AIS_INFO_SERVICE_KEY."
  },
  {
    key: "mof_ais_stat",
    label: "MOF AIS stat",
    collectorKeys: ["mof_ais_stat"],
    expectedEnvNames: ["MOF_AIS_STAT_API_URL", "MOF_AIS_STAT_SERVICE_KEY"],
    required: ["MOF_AIS_STAT_API_URL", "MOF_AIS_STAT_SERVICE_KEY"],
    businessImpact: "AIS trend, traffic statistics, and seasonality signals remain unavailable.",
    fixHint: "Set MOF_AIS_STAT_API_URL and MOF_AIS_STAT_SERVICE_KEY."
  },
  {
    key: "ulsan_core",
    label: "Ulsan core",
    collectorKeys: ["ulsan_core"],
    expectedEnvNames: [
      "ULSAN_API_URL",
      "ULSAN_API_KEY",
      "ULSAN_BERTH_DETAIL_API_KEY",
      "ULSAN_CARGO_PLAN_API_KEY",
      "ULSAN_BERTH_OPERATION_API_KEY",
      "ULSAN_TERMINAL_PROCESS_API_KEY"
    ],
    required: ["ULSAN_API_URL"],
    requiredAny: ["ULSAN_API_KEY", "ULSAN_BERTH_DETAIL_API_KEY", "ULSAN_CARGO_PLAN_API_KEY", "ULSAN_BERTH_OPERATION_API_KEY", "ULSAN_TERMINAL_PROCESS_API_KEY"],
    businessImpact: "Ulsan-specific berth, cargo, and terminal process enrichment may not run.",
    fixHint: "Set ULSAN_API_URL and a matching ULSAN_* API key."
  },
  {
    key: "ulsan_berth_detail",
    label: "Ulsan berth detail",
    collectorKeys: ["ulsan_berth_detail"],
    expectedEnvNames: ["ULSAN_BERTH_DETAIL_API_URL", "ULSAN_BERTH_DETAIL_API_KEY", "ULSAN_API_KEY"],
    required: ["ULSAN_BERTH_DETAIL_API_URL"],
    requiredAny: ["ULSAN_BERTH_DETAIL_API_KEY", "ULSAN_API_KEY"],
    businessImpact: "Ulsan berth-level detail enrichment may be skipped.",
    fixHint: "Set ULSAN_BERTH_DETAIL_API_URL and ULSAN_BERTH_DETAIL_API_KEY or ULSAN_API_KEY."
  },
  {
    key: "ulsan_cargo_plan",
    label: "Ulsan cargo plan",
    collectorKeys: ["ulsan_cargo_plan"],
    expectedEnvNames: ["ULSAN_CARGO_PLAN_API_URL", "ULSAN_CARGO_PLAN_API_KEY", "ULSAN_API_KEY"],
    required: ["ULSAN_CARGO_PLAN_API_URL"],
    requiredAny: ["ULSAN_CARGO_PLAN_API_KEY", "ULSAN_API_KEY"],
    businessImpact: "Ulsan cargo-plan signals may be unavailable.",
    fixHint: "Set ULSAN_CARGO_PLAN_API_URL and ULSAN_CARGO_PLAN_API_KEY or ULSAN_API_KEY."
  },
  {
    key: "ulsan_berth_operation",
    label: "Ulsan berth operation",
    collectorKeys: ["ulsan_berth_operation"],
    expectedEnvNames: ["ULSAN_BERTH_OPERATION_API_URL", "ULSAN_BERTH_OPERATION_API_KEY", "ULSAN_API_KEY"],
    required: ["ULSAN_BERTH_OPERATION_API_URL"],
    requiredAny: ["ULSAN_BERTH_OPERATION_API_KEY", "ULSAN_API_KEY"],
    businessImpact: "Ulsan berth operation status may not enrich current vessel state.",
    fixHint: "Set ULSAN_BERTH_OPERATION_API_URL and ULSAN_BERTH_OPERATION_API_KEY or ULSAN_API_KEY."
  },
  {
    key: "ulsan_terminal_process",
    label: "Ulsan terminal process",
    collectorKeys: ["ulsan_terminal_process"],
    expectedEnvNames: ["ULSAN_TERMINAL_PROCESS_API_URL", "ULSAN_TERMINAL_PROCESS_API_KEY", "ULSAN_API_KEY"],
    required: ["ULSAN_TERMINAL_PROCESS_API_URL"],
    requiredAny: ["ULSAN_TERMINAL_PROCESS_API_KEY", "ULSAN_API_KEY"],
    businessImpact: "Ulsan terminal-process signals may be unavailable.",
    fixHint: "Set ULSAN_TERMINAL_PROCESS_API_URL and ULSAN_TERMINAL_PROCESS_API_KEY or ULSAN_API_KEY."
  },
  {
    key: "port_operation",
    label: "Port Operation",
    collectorPrefix: "port_operation_",
    expectedEnvNames: ["PORT_OPERATION_API_URL", "PORT_OPERATION_SERVICE_KEY", "PORT_OPERATION_API_KEY", "DATA_GO_KR_API_KEY", "SERVICE_KEY", "SERVICEKEY", "YGPA_SERVICE_KEY"],
    requiredAny: ["PORT_OPERATION_SERVICE_KEY", "PORT_OPERATION_API_KEY", "DATA_GO_KR_API_KEY", "SERVICE_KEY", "SERVICEKEY", "YGPA_SERVICE_KEY"],
    optional: ["PORT_OPERATION_API_URL"],
    businessImpact: "Arrival/departure and port-call baseline data may not collect.",
    fixHint: "Set PORT_OPERATION_SERVICE_KEY or an accepted fallback key. PORT_OPERATION_API_URL can use the default endpoint."
  }
];

function present(env, name) {
  return Boolean(env?.[name] && String(env[name]).trim());
}

function envPresence(env, names = []) {
  return Object.fromEntries(names.map(name => [
    name,
    {
      present: present(env, name),
      source_type: present(env, name) ? "runtime_env" : "missing",
      value_origin: present(env, name) ? "secret_or_variable_not_distinguishable_at_runtime" : null
    }
  ]));
}

function matchesSource(spec, source = {}) {
  const key = String(source.key || source.source_name || "");
  if (spec.collectorKeys?.includes(key)) return true;
  if (spec.collectorPrefix && key.startsWith(spec.collectorPrefix)) return true;
  return false;
}

function classifyError(source = {}) {
  const text = String(source.error_message || source.error || source.raw_skip_reason || source.skip_reason || source.reason || "").toLowerCase();
  if (source.status === "WRONG_SOURCE_CSV_URL" || source.failure_reason === "wrong_source_csv_url" || text.includes("wrong_source_csv_url")) return "WRONG_SOURCE_CSV_URL";
  if (/api_response_too_large|response too large|source_too_large/.test(text) || source.failure_reason === "api_response_too_large") return "SOURCE_TOO_LARGE";
  if (/parse|json|xml|csv|decode/.test(text)) return "PARSE_FAILED";
  if (/http|timeout|fetch|network|abort|econn|enotfound|status/.test(text) || source.http_status) return "FETCH_FAILED";
  return "FETCH_FAILED";
}

function isSourceCsvTooLarge(item = {}) {
  if (String(item.source_key || item.key || item.source_name || "") !== "source_csv") return false;
  const text = [
    item.status,
    item.skip_reason,
    item.raw_skip_reason,
    item.reason,
    item.error_message,
    item.error,
    item.failure_reason,
    ...(Array.isArray(item.diagnostics) ? item.diagnostics.flatMap(diagnostic => [
      diagnostic?.status,
      diagnostic?.skip_reason,
      diagnostic?.error_message,
      diagnostic?.failure_reason
    ]) : [])
  ].filter(Boolean).join(" ").toLowerCase();
  return /source_too_large|api_response_too_large|response too large/.test(text);
}

function isHttp404Failure(item = {}) {
  const text = [
    item.skip_reason,
    item.raw_skip_reason,
    item.reason,
    item.error_message,
    item.error,
    ...(Array.isArray(item.diagnostics) ? item.diagnostics.flatMap(diagnostic => [
      diagnostic?.skip_reason,
      diagnostic?.error_message,
      diagnostic?.http_status
    ]) : [])
  ].filter(Boolean).join(" ").toLowerCase();
  return /\b404\b|http 404|status 404/.test(text);
}

function utilizationNoteForSource(sourceKey = "", rowsCollected = 0, rowsNormalized = 0) {
  if (rowsCollected > 0 && rowsNormalized === 0) {
    if (sourceKey === "vessel_spec") {
      return "HTTP 200 returned rows, but no rows matched vessel specification aliases. Check raw_sample_keys and parser_blockers.";
    }
    return "Rows were fetched but not converted into normalized enrichment records.";
  }
  if (rowsNormalized > 0) return "Rows were normalized and can contribute to enrichment.";
  return "";
}

export function applySourcePriority(item = {}) {
  const sourceKey = String(item.source_key || item.key || item.source_name || "");
  const isUlsanAuxiliary = ULSAN_AUXILIARY_SOURCE_KEYS.has(sourceKey);
  const isSourceCsv = sourceKey === "source_csv";
  const isAuxiliary = AUXILIARY_SOURCE_KEYS.has(sourceKey);
  const sourceCsvTooLarge = isSourceCsvTooLarge(item);
  const sourceCsvWrongUrl = isSourceCsv && String(item.status || "") === "WRONG_SOURCE_CSV_URL";
  const rowsCollected = Number(item.rows_collected || 0);
  const rowsNormalized = Number(item.rows_normalized || 0);
  const status = sourceCsvWrongUrl ? "WRONG_SOURCE_CSV_URL" : sourceCsvTooLarge ? "SOURCE_TOO_LARGE" : item.status;
  const isFailed = ["FETCH_FAILED", "PARSE_FAILED"].includes(String(status || ""));
  const deferred = isUlsanAuxiliary && isFailed && isHttp404Failure(item);
  const sourceLayer = isAuxiliary ? "auxiliary" : (item.source_layer || "core");
  const coreBlocking = isAuxiliary ? false : item.core_blocking !== false;
  const severity = deferred || sourceCsvTooLarge || sourceCsvWrongUrl
    ? "WARNING"
    : item.severity || (isFailed || status === "PARTIAL" ? "WARNING" : "INFO");
  return {
    ...item,
    status,
    source_layer: sourceLayer,
    core_blocking: coreBlocking,
    severity,
    business_impact: isUlsanAuxiliary ? ULSAN_AUXILIARY_BUSINESS_IMPACT : isSourceCsv ? "Verified source CSV enrichment cache may not refresh; existing cache is used if available." : item.business_impact,
    utilization_note: item.utilization_note || utilizationNoteForSource(sourceKey, rowsCollected, rowsNormalized),
    utilization_status: item.utilization_status || (rowsCollected > 0 && rowsNormalized === 0 ? "FETCHED_NOT_NORMALIZED" : rowsNormalized > 0 ? "NORMALIZED" : "NO_ROWS"),
    fix_status: deferred ? "deferred" : (item.fix_status || (status === "ACTIVE" ? "active" : "needs_action")),
    source_too_large: sourceCsvTooLarge || Boolean(item.source_too_large),
    ...(sourceCsvWrongUrl ? {
      exact_fix_instruction: SOURCE_CSV_URL_RECOMMENDED_FIX,
      fix_hint: SOURCE_CSV_URL_RECOMMENDED_FIX
    } : sourceCsvTooLarge ? {
      exact_fix_instruction: "SOURCE_CSV_URL still points to the large raw CSV. Point it to the lightweight verified vessel reference CSV.",
      fix_hint: "SOURCE_CSV_URL still points to the large raw CSV. Point it to the lightweight verified vessel reference CSV."
    } : deferred ? {
      exact_fix_instruction: "Deferred: 울산 보조 소스 경로는 이후 처리",
      fix_hint: "Deferred: 울산 보조 소스 경로는 이후 처리"
    } : {})
  };
}

export function normalizeSourceCollectionStatusPayload(payload = {}) {
  const items = (Array.isArray(payload.items) ? payload.items : []).map(applySourcePriority);
  const counts = items.reduce((acc, item) => {
    acc[item.status] = (acc[item.status] || 0) + 1;
    return acc;
  }, {});
  const sourceKeysByStatus = status => items
    .filter(item => item.status === status)
    .map(item => item.source_key);
  const failedStatuses = new Set(["FETCH_FAILED", "PARSE_FAILED"]);
  return {
    ...payload,
    record_count: Number(payload.record_count || items.length),
    item_count: items.length,
    status_counts: counts,
    active_sources: sourceKeysByStatus("ACTIVE"),
    not_configured_sources: sourceKeysByStatus("NOT_CONFIGURED"),
    partial_sources: sourceKeysByStatus("PARTIAL"),
    failed_sources: items
      .filter(item => failedStatuses.has(item.status) && item.core_blocking !== false)
      .map(item => item.source_key),
    auxiliary_failed_sources: items
      .filter(item => failedStatuses.has(item.status) && item.core_blocking === false)
      .map(item => item.source_key),
    source_too_large_sources: items
      .filter(item => item.status === "SOURCE_TOO_LARGE")
      .map(item => item.source_key),
    deferred_sources: items
      .filter(item => item.fix_status === "deferred")
      .map(item => item.source_key),
    rows_collected_by_source: Object.fromEntries(items.map(item => [
      item.source_key,
      Number(item.rows_collected || 0)
    ])),
    items
  };
}

function missingRequiredEnv(spec, env) {
  const missing = [];
  if (spec.key === "source_csv" && ["cache_only", "off"].includes(String(env.SOURCE_CSV_MODE || "").toLowerCase())) {
    return present(env, "SOURCE_CSV_URL") ? [] : ["SOURCE_CSV_URL"];
  }
  for (const name of spec.required || []) {
    if (!present(env, name)) missing.push(name);
  }
  if (spec.requiredAny?.length && !spec.requiredAny.some(name => present(env, name))) {
    missing.push(...spec.requiredAny);
  }
  for (const name of spec.activationEnv || []) {
    if (String(env?.[name] || "").toLowerCase() !== "true") missing.push(name);
  }
  return [...new Set(missing)];
}

function activationEnabled(spec, env) {
  if (spec.key === "source_csv" && ["cache_only", "off"].includes(String(env.SOURCE_CSV_MODE || "").toLowerCase())) return false;
  if (!spec.activationEnv?.length) return true;
  return spec.activationEnv.every(name => String(env?.[name] || "").toLowerCase() === "true");
}

function exactFixInstruction(spec, env, missing = []) {
  if (spec.key === "source_csv" && ["cache_only", "off"].includes(String(env.SOURCE_CSV_MODE || "").toLowerCase())) {
    return "Core/auxiliary update does not fetch source_csv. Run reference enrichment with SOURCE_CSV_MODE=refresh to refresh a lightweight source_csv cache.";
  }
  if (spec.key === "source_csv" && present(env, "SOURCE_CSV_URL") && String(env.ENABLE_SOURCE_CSV || "").toLowerCase() !== "true") {
    return "Set ENABLE_SOURCE_CSV=true";
  }
  if (spec.key === "mof_ais_dynamic" && present(env, "MOF_AIS_DYNAMIC_SERVICE_KEY") && !present(env, "MOF_AIS_DYNAMIC_API_URL")) {
    return "Set MOF_AIS_DYNAMIC_API_URL";
  }
  if (spec.key === "mof_ais_info" && present(env, "MOF_AIS_INFO_SERVICE_KEY") && !present(env, "MOF_AIS_INFO_API_URL")) {
    return "Set MOF_AIS_INFO_API_URL";
  }
  if (spec.key === "mof_ais_stat" && present(env, "MOF_AIS_STAT_SERVICE_KEY") && !present(env, "MOF_AIS_STAT_API_URL")) {
    return "Set MOF_AIS_STAT_API_URL";
  }
  if (spec.key.startsWith("ulsan") && missing.some(name => name.includes("_API_URL"))) {
    return "Set matching ULSAN_*_API_URL";
  }
  if (spec.key === "pilot_sources" && missing.includes("PILOT_SOURCE_URLS")) {
    return "Set PILOT_SOURCE_URLS";
  }
  if (spec.key === "berth_sources" && missing.includes("BERTH_SOURCE_URLS") && missing.includes("PNC_SOURCE_URLS")) {
    return "Set BERTH_SOURCE_URLS or PNC_SOURCE_URLS";
  }
  return spec.fixHint;
}

function statusForSpec({ spec, env, sources }) {
  const matched = sources.filter(source => matchesSource(spec, source));
  const missing = missingRequiredEnv(spec, env);
  const rowsCollected = matched.reduce((sum, source) => sum + Number(source.rows_collected || source.row_count || 0), 0);
  const attempted = matched.some(source => source.attempted);
  const skipped = matched.some(source => source.skipped);
  const matchedUrlSource = spec.key === "source_csv"
    ? matched.find(source => source.source_csv_url_status || source.configured_url_sanitized || source.expected_raw_url)
    : null;
  const sourceCsvUrlDiagnostic = spec.key === "source_csv"
    ? (matchedUrlSource ? {
      status: matchedUrlSource.source_csv_url_status || null,
      expected_raw_url: matchedUrlSource.expected_raw_url || null,
      configured_url_sanitized: matchedUrlSource.configured_url_sanitized || null,
      configured_repository: matchedUrlSource.configured_repository || null,
      configured_file_path: matchedUrlSource.configured_file_path || null,
      local_reference_path: matchedUrlSource.local_reference_path || null,
      local_reference_exists: matchedUrlSource.local_reference_exists === true,
      points_to_old_repo: matchedUrlSource.points_to_old_repo === true,
      points_to_different_repo: matchedUrlSource.points_to_different_repo === true,
      points_to_old_source_arrivals_csv: matchedUrlSource.points_to_old_source_arrivals_csv === true,
      points_to_lightweight_verified_reference_csv: matchedUrlSource.points_to_lightweight_verified_reference_csv === true,
      points_to_expected_url: matchedUrlSource.points_to_expected_url === true
    } : diagnoseSourceCsvUrl({ sourceCsvUrl: env.SOURCE_CSV_URL, env }))
    : null;
  const wrongSourceCsvUrl = spec.key === "source_csv" && (
    sourceCsvUrlDiagnostic?.status === "WRONG_SOURCE_CSV_URL" ||
    matched.some(source => String(source.status || "") === "WRONG_SOURCE_CSV_URL" || source.failure_reason === "wrong_source_csv_url")
  );
  const failed = matched.filter(source => source.status === "failed" || source.error || source.error_message);
  let status = "NOT_CONFIGURED";
  let skipReason = null;

  if (missing.length > 0) {
    const anyExpectedPresent = spec.expectedEnvNames.some(name => present(env, name));
    status = anyExpectedPresent ? "PARTIAL" : "NOT_CONFIGURED";
    skipReason = missing.some(name => name.includes("API_URL")) ? "missing_api_url" : "missing_env";
  }
  if (spec.key === "source_csv" && present(env, "SOURCE_CSV_URL") && String(env.ENABLE_SOURCE_CSV || "").toLowerCase() !== "true") {
    status = "SKIPPED";
    skipReason = "disabled_by_default_enable_source_csv_true";
  }
  if (spec.key === "source_csv" && present(env, "SOURCE_CSV_URL") && ["cache_only", "off"].includes(String(env.SOURCE_CSV_MODE || "").toLowerCase())) {
    status = "SKIPPED";
    skipReason = String(env.SOURCE_CSV_MODE || "").toLowerCase() === "off" ? "source_csv_mode_off" : "cache_only_mode";
  }
  if (wrongSourceCsvUrl && !["cache_only", "off"].includes(String(env.SOURCE_CSV_MODE || "").toLowerCase())) {
    status = "WRONG_SOURCE_CSV_URL";
    skipReason = SOURCE_CSV_URL_RECOMMENDED_FIX;
  }
  if (matched.length && skipped && rowsCollected === 0 && status !== "WRONG_SOURCE_CSV_URL") {
    status = missing.length ? status : "SKIPPED";
    skipReason = skipReason || matched.find(source => source.skipped)?.skip_reason || matched.find(source => source.skipped)?.reason || "skipped";
  }
  if (failed.length && status !== "WRONG_SOURCE_CSV_URL") {
    status = classifyError(failed[0]);
    skipReason = failed[0].error_message || failed[0].error || failed[0].skip_reason || "fetch_failed";
  }
  if (attempted && !failed.length && rowsCollected === 0 && status !== "WRONG_SOURCE_CSV_URL") {
    status = "NO_ROWS";
    skipReason = skipReason || "no_rows";
  }
  if (missing.length === 0 && matched.length === 0 && status === "NOT_CONFIGURED") {
    status = "NOT_ATTEMPTED";
    skipReason = "not_registered_collector";
  }
  if (rowsCollected > 0) {
    status = "ACTIVE";
    skipReason = null;
  }
  const fixInstruction = skipReason === "not_registered_collector"
    ? `Register or enable the ${spec.key} collector.`
    : exactFixInstruction(spec, env, missing);

  return applySourcePriority({
    source_key: spec.key,
    source_label: spec.label,
    status,
    expected_env_names: spec.expectedEnvNames,
    env_presence: envPresence(env, spec.expectedEnvNames),
    present_env: spec.expectedEnvNames.filter(name => present(env, name)),
    missing_env: missing,
    value_source: "GitHub secrets vs vars cannot be reliably distinguished from process.env at runtime",
    collector_enabled: (missing.length === 0 && activationEnabled(spec, env)) || rowsCollected > 0,
    collector_attempted: attempted,
    skip_reason: skipReason,
    exact_fix_instruction: status === "WRONG_SOURCE_CSV_URL" ? SOURCE_CSV_URL_RECOMMENDED_FIX : fixInstruction,
    fix_hint: status === "WRONG_SOURCE_CSV_URL" ? SOURCE_CSV_URL_RECOMMENDED_FIX : fixInstruction,
    source_csv_url_status: sourceCsvUrlDiagnostic?.status || undefined,
    expected_raw_url: sourceCsvUrlDiagnostic?.expected_raw_url || undefined,
    configured_url_sanitized: sourceCsvUrlDiagnostic?.configured_url_sanitized || undefined,
    points_to_old_repo: sourceCsvUrlDiagnostic?.points_to_old_repo || undefined,
    points_to_different_repo: sourceCsvUrlDiagnostic?.points_to_different_repo || undefined,
    points_to_old_source_arrivals_csv: sourceCsvUrlDiagnostic?.points_to_old_source_arrivals_csv || undefined,
    points_to_lightweight_verified_reference_csv: sourceCsvUrlDiagnostic?.points_to_lightweight_verified_reference_csv || undefined,
    source_layer: spec.sourceLayer || "core",
    core_blocking: spec.coreBlocking === false ? false : true,
    rows_collected: rowsCollected,
    rows_normalized: matched.reduce((sum, source) => sum + Number(source.rows_normalized || source.normalized_count || 0), 0),
    diagnostics_count: matched.length,
    diagnostics: matched.map(source => ({
      key: source.key || source.source_name,
      status: source.status || null,
      attempted: Boolean(source.attempted),
      skipped: Boolean(source.skipped),
      success: Boolean(source.success),
      rows_collected: Number(source.rows_collected || source.row_count || 0),
      rows_normalized: Number(source.rows_normalized || source.normalized_count || 0),
      skip_reason: source.skip_reason || source.reason || null,
      error_message: source.error_message || source.error || null,
      failure_reason: source.failure_reason || null,
      http_status: source.http_status || null,
      response_size_bytes: Number(source.response_size_bytes || 0) || null,
      max_allowed_bytes: Number(source.max_allowed_bytes || 0) || null,
      response_content_type: source.response_content_type || null,
      content_type: source.content_type || source.response_content_type || null,
      file_name_hint: source.file_name_hint || null,
      source_csv_url_status: source.source_csv_url_status || undefined,
      expected_raw_url: source.expected_raw_url || undefined,
      configured_url_sanitized: source.configured_url_sanitized || undefined,
      configured_repository: source.configured_repository || undefined,
      configured_file_path: source.configured_file_path || undefined,
      local_reference_path: source.local_reference_path || undefined,
      local_reference_exists: source.local_reference_exists === true ? true : undefined,
      points_to_old_repo: source.points_to_old_repo === true ? true : undefined,
      points_to_different_repo: source.points_to_different_repo === true ? true : undefined,
      points_to_old_source_arrivals_csv: source.points_to_old_source_arrivals_csv === true ? true : undefined,
      points_to_lightweight_verified_reference_csv: source.points_to_lightweight_verified_reference_csv === true ? true : undefined,
      points_to_expected_url: source.points_to_expected_url === true ? true : undefined,
      header_row_fields: Array.isArray(source.header_row_fields) ? source.header_row_fields : undefined,
      row_count_estimate: Number(source.row_count_estimate || 0) || undefined,
      raw_sample_keys: Array.isArray(source.raw_sample_keys) ? source.raw_sample_keys : undefined,
      sanitized_raw_samples: Array.isArray(source.sanitized_raw_samples) ? source.sanitized_raw_samples : undefined,
      expected_field_aliases_matched: source.expected_field_aliases_matched || undefined,
      missing_required_fields: source.missing_required_fields || undefined,
      parser_blockers: Array.isArray(source.parser_blockers) ? source.parser_blockers : undefined,
      pilot_rows_with_vessel_name: Number(source.pilot_rows_with_vessel_name || 0) || undefined,
      pilot_rows_with_call_sign: Number(source.pilot_rows_with_call_sign || 0) || undefined,
      pilot_rows_with_port: Number(source.pilot_rows_with_port || 0) || undefined,
      pilot_rows_with_pilot_date: Number(source.pilot_rows_with_pilot_date || 0) || undefined,
      pilot_rows_with_pilot_time: Number(source.pilot_rows_with_pilot_time || 0) || undefined,
      pilot_rows_with_pilot_station: Number(source.pilot_rows_with_pilot_station || 0) || undefined,
      pilot_rows_with_pilot_direction: Number(source.pilot_rows_with_pilot_direction || 0) || undefined,
      time_only_rows: Number(source.time_only_rows || 0) || undefined,
      invalid_time_rows: Number(source.invalid_time_rows || 0) || undefined,
      rows_with_imo: Number(source.rows_with_imo || 0) || undefined,
      rows_with_mmsi: Number(source.rows_with_mmsi || 0) || undefined,
      rows_with_call_sign: Number(source.rows_with_call_sign || 0) || undefined,
      rows_with_gt: Number(source.rows_with_gt || 0) || undefined,
      rows_with_dwt: Number(source.rows_with_dwt || 0) || undefined,
      rows_with_flag: Number(source.rows_with_flag || 0) || undefined,
      rows_with_vessel_type: Number(source.rows_with_vessel_type || 0) || undefined
    })),
    business_impact: spec.businessImpact
  });
}

export function buildSourceCollectionStatus({
  collectorDiagnostics = {},
  report = {},
  generatedAt = new Date().toISOString(),
  env = process.env
} = {}) {
  const sources = Array.isArray(collectorDiagnostics.sources) ? collectorDiagnostics.sources : [];
  const items = SOURCE_SPECS.map(spec => statusForSpec({ spec, env, sources }));
  return normalizeSourceCollectionStatusPayload({
    schema_version: "1.0",
    generated_at: generatedAt,
    run_id: report.run_id || report.active_run_id || null,
    status_run_id: report.run_id || null,
    data_mode: report.data_mode || report.data_mode_detail?.mode || "unknown",
    record_count: items.length,
    items
  });
}

export function printSourceEnvDiagnostics(env = process.env, log = console.log) {
  const names = [
    "SOURCE_CSV_URL",
    "ENABLE_SOURCE_CSV",
    "VESSEL_SPEC_SERVICE_KEY",
    "VESSEL_SPEC_API_URL",
    "PILOT_SOURCE_URLS",
    "BERTH_SOURCE_URLS",
    "PNC_SOURCE_URLS",
    "MOF_AIS_DYNAMIC_SERVICE_KEY",
    "MOF_AIS_DYNAMIC_API_URL",
    "MOF_AIS_INFO_SERVICE_KEY",
    "MOF_AIS_INFO_API_URL",
    "MOF_AIS_STAT_SERVICE_KEY",
    "MOF_AIS_STAT_API_URL",
    "ULSAN_API_KEY",
    "ULSAN_API_URL",
    "ULSAN_BERTH_DETAIL_API_KEY",
    "ULSAN_BERTH_DETAIL_API_URL",
    "ULSAN_CARGO_PLAN_API_KEY",
    "ULSAN_CARGO_PLAN_API_URL",
    "ULSAN_BERTH_OPERATION_API_KEY",
    "ULSAN_BERTH_OPERATION_API_URL",
    "ULSAN_TERMINAL_PROCESS_API_KEY",
    "ULSAN_TERMINAL_PROCESS_API_URL"
  ];
  log("[SOURCE_ENV_DIAGNOSTICS] " + JSON.stringify(Object.fromEntries(names.map(name => [name, present(env, name)]))));
}
