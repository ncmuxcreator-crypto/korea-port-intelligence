import fs from "node:fs";

const registryPath = "data/reference/ports_registry.csv";
const statusPath = "dashboard/api/status.json";
const coveragePath = "dashboard/api/coverage-registry.json";

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (quoted && char === "\"" && next === "\"") {
      field += "\"";
      i += 1;
      continue;
    }
    if (char === "\"") {
      quoted = !quoted;
      continue;
    }
    if (!quoted && char === ",") {
      row.push(field);
      field = "";
      continue;
    }
    if (!quoted && (char === "\n" || char === "\r")) {
      if (char === "\r" && next === "\n") i += 1;
      row.push(field);
      if (row.some(value => value !== "")) rows.push(row);
      row = [];
      field = "";
      continue;
    }
    field += char;
  }
  row.push(field);
  if (row.some(value => value !== "")) rows.push(row);
  const [headers = [], ...body] = rows;
  return body.map(values => Object.fromEntries(headers.map((header, index) => [header, values[index] || ""])));
}

function truthy(value) {
  return ["true", "1", "yes", "y"].includes(String(value || "").trim().toLowerCase());
}

function normalize(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function readJson(path, fallback) {
  try {
    return fs.existsSync(path) ? JSON.parse(fs.readFileSync(path, "utf8")) : fallback;
  } catch {
    return fallback;
  }
}

function emptyTierStats(tier) {
  return {
    tier,
    enabled_count: 0,
    attempted_count: 0,
    rows_collected: 0,
    no_data_ports: [],
    not_attempted_ports: []
  };
}

const registry = fs.existsSync(registryPath) ? parseCsv(fs.readFileSync(registryPath, "utf8")) : [];
const enabledPorts = registry.filter(row => truthy(row.enabled) && truthy(row.has_port_operation));
const status = readJson(statusPath, {});
const coverage = readJson(coveragePath, {});
const sources = Array.isArray(status?.collector_diagnostics?.sources) ? status.collector_diagnostics.sources : [];
const portOperationSources = sources.filter(source => String(source.key || source.source_name || "").startsWith("port_operation_"));
const portOperationCollectorEnabled = enabledPorts.length > 0 && (
  portOperationSources.length > 0 ||
  !["source_disabled", "collector_disabled"].includes(String(status?.collector_diagnostics?.port_operation_status || "").toLowerCase())
);
const portOperationSecretPresent = Boolean(process.env.PORT_OPERATION_SERVICE_KEY || process.env.PORT_OPERATION_API_KEY || process.env.SERVICEKEY);
const portOperationApiUrlPresent = Boolean(process.env.PORT_OPERATION_API_URL) ||
  portOperationSources.some(source => source.requested_url_without_service_key || source.requested_url || source.url);
const validationMode = String(process.env.VALIDATION_MODE || (process.env.CI === "true" ? "production" : "local")).toLowerCase();

const sourceMatchesRegistryRow = (source, row) => {
  const sameCode = String(source.prtAgCd || source.portCode || source.port_code || "") === String(row.prtAgCd || row.port_code || "");
  const sourceText = normalize([source.key, source.label, source.portName, source.portNameKo, source.subPort].filter(Boolean).join(" "));
  const registryText = normalize([row.port_name_en, row.port_name_ko, row.sub_port, row.port_group].filter(Boolean).join(" "));
  return sameCode && (!registryText || sourceText.includes(registryText) || registryText.includes(sourceText) || sourceText.includes(normalize(row.port_name_en)));
};

const sourceRowsForPort = row => sources.filter(source => String(source.key || "").startsWith("port_operation_") && (
  sourceMatchesRegistryRow(source, row) ||
  String(source.prtAgCd || source.portCode || source.port_code || "") === String(row.prtAgCd || row.port_code || "")
));

const byTier = { "1": emptyTierStats("1"), "2": emptyTierStats("2"), "3": emptyTierStats("3") };
for (const row of enabledPorts) {
  const tier = String(row.tier || "unknown").trim() || "unknown";
  if (!byTier[tier]) byTier[tier] = emptyTierStats(tier);
  const stats = byTier[tier];
  const matchedSources = sourceRowsForPort(row);
  const attemptedSources = matchedSources.filter(source => source.attempted);
  const rowsCollected = attemptedSources.reduce((sum, source) => sum + Number(source.row_count || source.rows_collected || 0), 0);
  const portLabel = row.port_name_en || row.port_name_ko || row.sub_port || row.prtAgCd || row.port_code;
  stats.enabled_count += 1;
  if (attemptedSources.length) stats.attempted_count += 1;
  else stats.not_attempted_ports.push({ port: portLabel, prtAgCd: row.prtAgCd || row.port_code || "", tier });
  stats.rows_collected += rowsCollected;
  if (attemptedSources.length && rowsCollected === 0) stats.no_data_ports.push({ port: portLabel, prtAgCd: row.prtAgCd || row.port_code || "", tier });
}

const missingAttemptsByTier = Object.fromEntries(Object.entries(byTier).map(([tier, stats]) => [tier, stats.not_attempted_ports.length]));
const portsAttemptedCount = Object.values(byTier).reduce((sum, stats) => sum + stats.attempted_count, 0);
const portsSkippedReason = (() => {
  if (!enabledPorts.length) return "no_enabled_port_operation_ports_in_registry";
  if (!portOperationCollectorEnabled) return "port_operation_collector_disabled";
  if (!portOperationSecretPresent) return validationMode === "local"
    ? "validation_mode_local_missing_PORT_OPERATION_SERVICE_KEY"
    : "missing_PORT_OPERATION_SERVICE_KEY";
  if (!portOperationApiUrlPresent) return "missing_PORT_OPERATION_API_URL";
  if (!portsAttemptedCount) return portOperationSources.length
    ? "collector_reported_sources_but_no_enabled_registry_port_attempted"
    : "port_operation_collector_not_run_or_no_source_logs";
  return null;
})();
const ok = enabledPorts.length > 0 &&
  Object.values(byTier).every(stats => stats.enabled_count === 0 || stats.attempted_count === stats.enabled_count);

const report = {
  version: "17.7.0",
  generated_at: new Date().toISOString(),
  run_id: status.run_id || null,
  status_run_id: status.run_id || null,
  registry_source: registryPath,
  coverage_registry_record_count: coverage.record_count || 0,
  enabled_ports_count: enabledPorts.length,
  tier1_enabled_count: byTier["1"].enabled_count,
  tier2_enabled_count: byTier["2"].enabled_count,
  tier3_enabled_count: byTier["3"].enabled_count,
  tier1_attempted_count: byTier["1"].attempted_count,
  tier2_attempted_count: byTier["2"].attempted_count,
  tier3_attempted_count: byTier["3"].attempted_count,
  tier1_rows_collected: byTier["1"].rows_collected,
  tier2_rows_collected: byTier["2"].rows_collected,
  tier3_rows_collected: byTier["3"].rows_collected,
  port_operation_collector_enabled: portOperationCollectorEnabled,
  port_operation_secret_present: portOperationSecretPresent,
  port_operation_api_url_present: portOperationApiUrlPresent,
  ports_attempted_count: portsAttemptedCount,
  ports_skipped_reason: portsSkippedReason,
  validation_mode: validationMode,
  no_data_ports_by_tier: Object.fromEntries(Object.entries(byTier).map(([tier, stats]) => [tier, stats.no_data_ports])),
  not_attempted_ports_by_tier: Object.fromEntries(Object.entries(byTier).map(([tier, stats]) => [tier, stats.not_attempted_ports])),
  missing_attempts_by_tier: missingAttemptsByTier,
  ok,
  warning: ok ? null : "Enabled Tier 1/2/3 port-operation ports were not all attempted.",
  data_mode: status.data_mode || coverage.data_mode || "unknown"
};

fs.mkdirSync("dashboard/api", { recursive: true });
fs.writeFileSync("dashboard/api/coverage-audit.json", JSON.stringify(report, null, 2));

if (!report.ok) {
  console.error("Coverage audit failed", report);
  process.exit(1);
}

console.log("Coverage audit passed");
