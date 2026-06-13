import { pathToFileURL } from "node:url";
import path from "node:path";

const ROOT = process.cwd();
const mode = String(process.argv[2] || "core").toLowerCase();

const presets = {
  core: {
    UPDATE_MODE: "core",
    ENRICHMENT_MODE: "lightweight_apply_cache",
    DISCOVERY_MODE: "off",
    DB_AUDIT_MODE: "off",
    SOURCE_CSV_MODE: "cache_only",
    RUN_HEAVY_AUDITS: "false",
    RUN_DISCOVERY: "false",
    RUN_DB_CLEANUP_AUDIT: "false",
    RUN_DATA_UTILIZATION_AUDIT: "false",
    RUN_HIDDEN_FEATURE_AUDIT: "false"
  },
  fast_aux: {
    UPDATE_MODE: "fast_aux",
    ENRICHMENT_MODE: "lightweight",
    DISCOVERY_MODE: "off",
    DB_AUDIT_MODE: "off",
    SOURCE_CSV_MODE: "off",
    RUN_HEAVY_AUDITS: "false"
  },
  reference_enrichment: {
    UPDATE_MODE: "reference_enrichment",
    ENRICHMENT_MODE: "full",
    DISCOVERY_MODE: "off",
    DB_AUDIT_MODE: "off",
    SOURCE_CSV_MODE: "refresh",
    ENABLE_SOURCE_CSV: "true",
    RUN_HEAVY_AUDITS: "true"
  },
  enrichment: {
    UPDATE_MODE: "reference_enrichment",
    ENRICHMENT_MODE: "full",
    DISCOVERY_MODE: "off",
    DB_AUDIT_MODE: "off",
    SOURCE_CSV_MODE: "refresh",
    ENABLE_SOURCE_CSV: "true",
    RUN_HEAVY_AUDITS: "true"
  },
  discovery_audit: {
    UPDATE_MODE: "discovery_audit",
    DISCOVERY_MODE: "full",
    DB_AUDIT_MODE: "full",
    RUN_DISCOVERY: "true",
    RUN_DB_CLEANUP_AUDIT: "true",
    RUN_DATA_UTILIZATION_AUDIT: "true",
    RUN_HEAVY_AUDITS: "true"
  },
  audit: {
    UPDATE_MODE: "discovery_audit",
    DISCOVERY_MODE: "full",
    DB_AUDIT_MODE: "full",
    RUN_DISCOVERY: "true",
    RUN_DB_CLEANUP_AUDIT: "true",
    RUN_DATA_UTILIZATION_AUDIT: "true",
    RUN_HEAVY_AUDITS: "true"
  }
};

for (const [key, value] of Object.entries(presets[mode] || presets.core)) {
  process.env[key] = value;
}

process.argv[2] = "scripts/update.js";
await import(pathToFileURL(path.resolve(ROOT, "scripts/with-env.js")));
