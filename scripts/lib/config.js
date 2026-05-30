import fs from "fs";
import path from "path";
import { detectSecrets } from "./secrets.js";

export const REQUIRED_ENV_VARS = [
  "PORT_OPERATION_SERVICE_KEY",
  "PORT_OPERATION_API_URL",
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY"
];

const PORTS_REGISTRY_PATH = path.join("data", "reference", "ports_registry.csv");

function boolEnv(name, fallback = false) {
  const value = process.env[name];
  if (value === undefined || value === "") return fallback;
  return /^(1|true|yes|y|on)$/i.test(String(value));
}

function numberEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function present(name) {
  return Boolean(process.env[name] && String(process.env[name]).trim());
}

function parseCsv(text) {
  const lines = String(text || "").replace(/^\uFEFF/, "").split(/\r?\n/).filter(line => line.trim());
  if (lines.length < 2) return [];
  const parseLine = line => {
    const cells = [];
    let cell = "";
    let quoted = false;
    for (let index = 0; index < line.length; index += 1) {
      const char = line[index];
      const next = line[index + 1];
      if (char === '"' && quoted && next === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        quoted = !quoted;
      } else if (char === "," && !quoted) {
        cells.push(cell.trim());
        cell = "";
      } else {
        cell += char;
      }
    }
    cells.push(cell.trim());
    return cells;
  };
  const headers = parseLine(lines[0]);
  return lines.slice(1).map(line => {
    const values = parseLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, values[index] || ""]));
  });
}

export function loadPortsRegistry(file = PORTS_REGISTRY_PATH) {
  if (!fs.existsSync(file)) return [];
  return parseCsv(fs.readFileSync(file, "utf8"));
}

export function runtimeLimits() {
  return {
    SOURCE_TIMEOUT_MS: numberEnv("SOURCE_TIMEOUT_MS", 30000),
    UPDATE_TIMEOUT_MS: numberEnv("UPDATE_TIMEOUT_MS", 900000),
    COLLECTOR_RUNTIME_BUDGET_MS: numberEnv("COLLECTOR_RUNTIME_BUDGET_MS", 720000),
    MAX_PORTS_PER_RUN: numberEnv("MAX_PORTS_PER_RUN", 50),
    MAX_OUTPUT_ROWS: numberEnv("MAX_OUTPUT_ROWS", 10000),
    MAX_SOURCE_ROWS: numberEnv("MAX_SOURCE_ROWS", 5000),
    MAX_TARGET_VESSELS: numberEnv("MAX_TARGET_VESSELS", 5000),
    MAX_CANDIDATES: numberEnv("MAX_CANDIDATES", 1000),
    MAX_CHILD_ENRICHMENT_ROWS: numberEnv("MAX_CHILD_ENRICHMENT_ROWS", 100),
    MAX_IMO_RECOVERY_CALLS: numberEnv("MAX_IMO_RECOVERY_CALLS", 100),
    MAX_API_RESPONSE_BYTES: numberEnv("MAX_API_RESPONSE_BYTES", 25000000),
    PORT_OPERATION_NUM_OF_ROWS: numberEnv("PORT_OPERATION_NUM_OF_ROWS", 50),
    PORT_OPERATION_MAX_PAGES: numberEnv("PORT_OPERATION_MAX_PAGES", 20),
    SOURCE_MAX_RETRIES: numberEnv("SOURCE_MAX_RETRIES", 2),
    MATCH_TIME_WINDOW_HOURS: numberEnv("MATCH_TIME_WINDOW_HOURS", 48),
    STRONG_TIME_MATCH_HOURS: numberEnv("STRONG_TIME_MATCH_HOURS", 6),
    ENABLE_SOURCE_CSV: boolEnv("ENABLE_SOURCE_CSV", false),
    COLLECTOR_DEBUG_VERBOSE: boolEnv("COLLECTOR_DEBUG_VERBOSE", false),
    DB_STORAGE_MODE: process.env.DB_STORAGE_MODE || "lean",
    DB_ANALYTICS_SCOPE: process.env.DB_ANALYTICS_SCOPE || "candidate",
    DB_FOUNDATION_WRITE_MODE: process.env.DB_FOUNDATION_WRITE_MODE || "minimal",
    DB_RETENTION_CLEANUP: boolEnv("DB_RETENTION_CLEANUP", true)
  };
}

export function configDiagnostics() {
  const secrets = detectSecrets();
  const ports = loadPortsRegistry();
  const enabledPorts = ports.filter(row => /^(1|true|yes|y)$/i.test(String(row.enabled || "true")) && /^(1|true|yes|y)$/i.test(String(row.has_port_operation || "true")));
  const enabledSources = secrets.filter(source => source.enabled).map(source => source.key);
  const enrichmentSources = secrets
    .filter(source => source.enabled && ["pilotage", "berth", "port_master", "ulsan", "vts", "ais", "ais_master", "ais_stats", "vessel_master"].includes(source.type))
    .map(source => source.key);
  const missingRequiredConfig = REQUIRED_ENV_VARS.filter(name => !present(name));
  const validationMode = String(process.env.VALIDATION_MODE || (process.env.CI === "true" ? "production" : "local")).toLowerCase();
  const servingMode = process.env.SERVING_MODE || (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY ? "worker_supabase" : "static_json_fallback");
  return {
    generated_at: new Date().toISOString(),
    environment: process.env.UPDATE_MODE || process.env.NODE_ENV || "local",
    validation_mode: validationMode,
    serving_mode: servingMode,
    production_data_source: servingMode === "worker_supabase" ? "supabase_active_dataset" : "static_json_fallback",
    config_types: {
      secrets: "API keys and credentials only",
      csv_registry: "port/source metadata from data/reference CSV files",
      env_vars: "runtime limits and feature toggles",
      code_defaults: "safe fallback values only"
    },
    required_env_vars: REQUIRED_ENV_VARS,
    missing_required_config: missingRequiredConfig,
    required_config_ok: missingRequiredConfig.length === 0,
    secrets_present: Object.fromEntries(REQUIRED_ENV_VARS.map(name => [name, present(name)])),
    enabled_sources: enabledSources,
    enabled_enrichment_sources: enrichmentSources,
    sources: secrets.map(source => ({
      key: source.key,
      type: source.type,
      status: source.status,
      enabled: source.enabled,
      missing: source.missing
    })),
    ports_registry_path: PORTS_REGISTRY_PATH,
    ports_registry_rows: ports.length,
    enabled_ports_count: enabledPorts.length,
    enabled_ports: enabledPorts.map(row => ({
      port_code: row.port_code || row.prtAgCd,
      prtAgCd: row.prtAgCd || row.port_code,
      port_name_ko: row.port_name_ko,
      port_name_en: row.port_name_en,
      tier: row.tier,
      commercial_priority: row.commercial_priority
    })),
    active_runtime_limits: runtimeLimits()
  };
}

export function validateRequiredConfig({ throwOnMissing = true } = {}) {
  const diagnostics = configDiagnostics();
  if (throwOnMissing && diagnostics.missing_required_config.length) {
    throw new Error(`Missing required runtime config: ${diagnostics.missing_required_config.join(", ")}`);
  }
  return diagnostics;
}
