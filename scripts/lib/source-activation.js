const SOURCE_SPECS = [
  {
    key: "source_csv",
    label: "Source CSV",
    collectorKeys: ["source_csv"],
    expectedEnvNames: ["SOURCE_CSV_URL", "ENABLE_SOURCE_CSV"],
    requiredAny: ["SOURCE_CSV_URL"],
    activationEnv: ["ENABLE_SOURCE_CSV"],
    businessImpact: "Identity, operator, and manually corrected vessel fields may not enrich generated snapshots.",
    fixHint: "Set SOURCE_CSV_URL and ENABLE_SOURCE_CSV=true."
  },
  {
    key: "vessel_spec",
    label: "Vessel specification",
    collectorKeys: ["vessel_spec"],
    expectedEnvNames: ["VESSEL_SPEC_SERVICE_KEY", "VESSEL_SPEC_API_URL"],
    required: ["VESSEL_SPEC_SERVICE_KEY", "VESSEL_SPEC_API_URL"],
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
  if (/parse|json|xml|csv|decode/.test(text)) return "PARSE_FAILED";
  if (/http|timeout|fetch|network|abort|econn|enotfound|status/.test(text) || source.http_status) return "FETCH_FAILED";
  return "FETCH_FAILED";
}

function missingRequiredEnv(spec, env) {
  const missing = [];
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
  if (!spec.activationEnv?.length) return true;
  return spec.activationEnv.every(name => String(env?.[name] || "").toLowerCase() === "true");
}

function exactFixInstruction(spec, env, missing = []) {
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
  if (matched.length && skipped && rowsCollected === 0) {
    status = missing.length ? status : "SKIPPED";
    skipReason = skipReason || matched.find(source => source.skipped)?.skip_reason || matched.find(source => source.skipped)?.reason || "skipped";
  }
  if (failed.length) {
    status = classifyError(failed[0]);
    skipReason = failed[0].error_message || failed[0].error || failed[0].skip_reason || "fetch_failed";
  }
  if (attempted && !failed.length && rowsCollected === 0) {
    status = "NO_ROWS";
    skipReason = skipReason || "no_rows";
  }
  if (rowsCollected > 0) {
    status = "ACTIVE";
    skipReason = null;
  }

  return {
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
    exact_fix_instruction: exactFixInstruction(spec, env, missing),
    fix_hint: exactFixInstruction(spec, env, missing),
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
      http_status: source.http_status || null
    })),
    business_impact: spec.businessImpact
  };
}

export function buildSourceCollectionStatus({
  collectorDiagnostics = {},
  report = {},
  generatedAt = new Date().toISOString(),
  env = process.env
} = {}) {
  const sources = Array.isArray(collectorDiagnostics.sources) ? collectorDiagnostics.sources : [];
  const items = SOURCE_SPECS.map(spec => statusForSpec({ spec, env, sources }));
  const counts = items.reduce((acc, item) => {
    acc[item.status] = (acc[item.status] || 0) + 1;
    return acc;
  }, {});
  const sourceKeysByStatus = status => items
    .filter(item => item.status === status)
    .map(item => item.source_key);
  const failedStatuses = new Set(["FETCH_FAILED", "PARSE_FAILED"]);
  return {
    schema_version: "1.0",
    generated_at: generatedAt,
    run_id: report.run_id || report.active_run_id || null,
    status_run_id: report.run_id || null,
    data_mode: report.data_mode || report.data_mode_detail?.mode || "unknown",
    record_count: items.length,
    item_count: items.length,
    status_counts: counts,
    active_sources: sourceKeysByStatus("ACTIVE"),
    not_configured_sources: sourceKeysByStatus("NOT_CONFIGURED"),
    partial_sources: sourceKeysByStatus("PARTIAL"),
    failed_sources: items
      .filter(item => failedStatuses.has(item.status))
      .map(item => item.source_key),
    rows_collected_by_source: Object.fromEntries(items.map(item => [
      item.source_key,
      Number(item.rows_collected || 0)
    ])),
    items
  };
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
