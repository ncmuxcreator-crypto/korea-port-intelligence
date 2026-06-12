import fs from "node:fs";
import path from "node:path";
import { normalizeCallSign, normalizeVesselName } from "./matching.js";

export const SOURCE_CSV_REFERENCE_CACHE_PATH = "data/cache/source-csv-reference-cache.json";
export const SOURCE_CSV_PUBLIC_REFERENCE_PATH = "dashboard/api/cache/source-csv-reference.json";
export const SOURCE_CSV_SUMMARY_PATH = "dashboard/api/aux/source-csv-summary.json";
export const DEFAULT_MAX_SOURCE_CSV_BYTES = 5_000_000;

const REFERENCE_FIELDS = [
  "vessel_name",
  "normalized_vessel_name",
  "imo",
  "mmsi",
  "call_sign",
  "operator",
  "owner",
  "manager",
  "vessel_type",
  "gt",
  "dwt",
  "flag",
  "verified",
  "notes",
  "updated_at"
];

const FIELD_ALIASES = {
  vessel_name: ["vessel_name", "name", "ship_name", "vsl_nm", "vesselName", "Vessel Name"],
  normalized_vessel_name: ["normalized_vessel_name", "normalized_name", "norm_name"],
  imo: ["imo", "imo_no", "imo_number", "imoNumber", "IMO"],
  mmsi: ["mmsi", "MMSI"],
  call_sign: ["call_sign", "callsign", "callSign", "clsgn", "Call Sign"],
  operator: ["operator", "shipping_company", "company", "company_name", "owner_operator"],
  owner: ["owner", "registered_owner"],
  manager: ["manager", "technical_manager", "ship_manager"],
  vessel_type: ["vessel_type", "ship_type", "type", "vesselType"],
  gt: ["gt", "grt", "gross_tonnage", "intrlGrtg", "GT"],
  dwt: ["dwt", "deadweight", "DWT"],
  flag: ["flag", "flag_state"],
  verified: ["verified", "is_verified", "validated"],
  notes: ["notes", "note", "memo"],
  updated_at: ["updated_at", "updatedAt", "last_updated", "lastUpdated"]
};

function hasText(value) {
  return value !== null && value !== undefined && String(value).trim() !== "";
}

function firstValue(row = {}, field) {
  for (const key of FIELD_ALIASES[field] || [field]) {
    if (hasText(row[key])) return String(row[key]).trim();
  }
  return "";
}

function numberOrNull(value) {
  if (!hasText(value)) return null;
  const parsed = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizedBool(value) {
  const text = String(value ?? "").trim().toLowerCase();
  if (!text) return false;
  return ["true", "1", "yes", "y", "verified", "검증", "확인"].includes(text);
}

export function normalizeSourceCsvReferenceRow(row = {}) {
  const vesselName = firstValue(row, "vessel_name");
  const callSign = normalizeCallSign(firstValue(row, "call_sign"));
  const normalizedName = firstValue(row, "normalized_vessel_name") || normalizeVesselName(vesselName);
  const gt = numberOrNull(firstValue(row, "gt"));
  const dwt = numberOrNull(firstValue(row, "dwt"));
  const reference = {
    vessel_name: vesselName,
    normalized_vessel_name: normalizedName,
    imo: firstValue(row, "imo"),
    mmsi: firstValue(row, "mmsi"),
    call_sign: callSign,
    operator: firstValue(row, "operator"),
    owner: firstValue(row, "owner"),
    manager: firstValue(row, "manager"),
    vessel_type: firstValue(row, "vessel_type"),
    gt,
    dwt,
    flag: firstValue(row, "flag"),
    verified: normalizedBool(firstValue(row, "verified")) || Boolean(firstValue(row, "imo") || firstValue(row, "mmsi") || callSign),
    notes: firstValue(row, "notes"),
    updated_at: firstValue(row, "updated_at"),
    reference_source: "source_csv_cache"
  };
  const hasIdentifier = hasText(reference.imo) || hasText(reference.mmsi) || hasText(reference.call_sign);
  const hasCommercialField = hasText(reference.operator) || hasText(reference.owner) || hasText(reference.manager) || hasText(reference.vessel_type) || reference.gt !== null || reference.dwt !== null;
  if (!reference.vessel_name && !reference.normalized_vessel_name && !hasIdentifier) return null;
  if (!hasIdentifier && !hasCommercialField) return null;
  return reference;
}

function uniqueReferenceRows(rows = []) {
  const map = new Map();
  for (const row of rows) {
    const normalized = normalizeSourceCsvReferenceRow(row);
    if (!normalized) continue;
    const key = normalized.imo
      ? `imo:${normalized.imo}`
      : normalized.mmsi
        ? `mmsi:${normalized.mmsi}`
        : normalized.call_sign
          ? `call:${normalized.call_sign}`
          : `name:${normalized.normalized_vessel_name}|${normalized.gt || ""}|${normalized.vessel_type || ""}`;
    if (!map.has(key)) map.set(key, normalized);
  }
  return [...map.values()];
}

export function summarizeSourceCsvReferenceRows(rows = []) {
  const fieldsAvailable = REFERENCE_FIELDS.filter(field => rows.some(row => hasText(row[field]) || row[field] === 0 || row[field] === false || row[field] === true));
  const schema = validateSourceCsvReferenceRows(rows);
  return {
    usable_reference_rows: rows.length,
    rows_with_imo: rows.filter(row => hasText(row.imo)).length,
    rows_with_mmsi: rows.filter(row => hasText(row.mmsi)).length,
    rows_with_call_sign: rows.filter(row => hasText(row.call_sign)).length,
    rows_with_operator: rows.filter(row => hasText(row.operator)).length,
    fields_available: fieldsAvailable,
    schema_issues: schema.schema_issues,
    duplicate_issues: schema.duplicate_issues
  };
}

export function validateSourceCsvReferenceRows(rows = []) {
  const fieldsAvailable = REFERENCE_FIELDS.filter(field => rows.some(row => hasText(row[field]) || row[field] === 0 || row[field] === false || row[field] === true));
  const missingRecommendedColumns = REFERENCE_FIELDS.filter(field => !fieldsAvailable.includes(field));
  const rowsMissingVesselName = rows.filter(row => !hasText(row.vessel_name) && !hasText(row.normalized_vessel_name)).length;
  const rowsMissingAllIdentityKeys = rows.filter(row => !hasText(row.imo) && !hasText(row.mmsi) && !hasText(row.call_sign)).length;
  const duplicateCount = keyFn => {
    const counts = new Map();
    for (const row of rows) {
      const key = keyFn(row);
      if (!key) continue;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    return [...counts.values()].filter(count => count > 1).reduce((sum, count) => sum + count - 1, 0);
  };
  const duplicateImo = duplicateCount(row => hasText(row.imo) ? String(row.imo).trim() : "");
  const duplicateMmsi = duplicateCount(row => hasText(row.mmsi) ? String(row.mmsi).trim() : "");
  const duplicateCallSignName = duplicateCount(row => {
    if (!hasText(row.call_sign) || !hasText(row.normalized_vessel_name || row.vessel_name)) return "";
    return `${row.call_sign}|${row.normalized_vessel_name || normalizeVesselName(row.vessel_name)}`;
  });
  return {
    fields_available: fieldsAvailable,
    missing_recommended_columns: missingRecommendedColumns,
    schema_issues: {
      missing_recommended_columns: missingRecommendedColumns,
      rows_missing_vessel_name: rowsMissingVesselName,
      rows_missing_all_identity_keys: rowsMissingAllIdentityKeys
    },
    duplicate_issues: {
      duplicate_imo: duplicateImo,
      duplicate_mmsi: duplicateMmsi,
      duplicate_call_sign_vessel_name: duplicateCallSignName
    }
  };
}

export function buildSourceCsvReferenceIndexes(rows = []) {
  const normalizedRows = uniqueReferenceRows(rows);
  const indexes = {
    by_imo: {},
    by_mmsi: {},
    by_call_sign: {},
    by_normalized_vessel_name_call_sign: {},
    by_normalized_vessel_name_gt_vessel_type: {}
  };
  for (const row of normalizedRows) {
    if (row.imo) indexes.by_imo[row.imo] = row;
    if (row.mmsi) indexes.by_mmsi[row.mmsi] = row;
    if (row.call_sign) indexes.by_call_sign[row.call_sign] = row;
    if (row.normalized_vessel_name && row.call_sign) {
      indexes.by_normalized_vessel_name_call_sign[`${row.normalized_vessel_name}|${row.call_sign}`] = row;
    }
    if (row.normalized_vessel_name && row.gt !== null && row.vessel_type) {
      indexes.by_normalized_vessel_name_gt_vessel_type[`${row.normalized_vessel_name}|${row.gt}|${row.vessel_type}`] = row;
    }
  }
  return indexes;
}

export function readSourceCsvReferenceCache(filePath = SOURCE_CSV_REFERENCE_CACHE_PATH) {
  try {
    if (!fs.existsSync(filePath)) return { status: "missing", items: [], last_success_at: null };
    const payload = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const items = uniqueReferenceRows(payload.items || payload.rows || []);
    return {
      status: items.length ? "available" : "empty",
      items,
      last_success_at: payload.last_success_at || payload.generated_at || null,
      generated_at: payload.generated_at || null
    };
  } catch (error) {
    return { status: "invalid", items: [], last_success_at: null, error: error.message };
  }
}

export function buildSourceCsvReferencePayload({ cache = null, generatedAt = new Date().toISOString() } = {}) {
  const currentCache = cache || readSourceCsvReferenceCache();
  const rows = uniqueReferenceRows(currentCache.items || []);
  const summary = summarizeSourceCsvReferenceRows(rows);
  return {
    schema_version: "1.0",
    generated_at: generatedAt,
    data_mode: rows.length ? "cache" : "empty",
    status: rows.length ? "available" : currentCache.status || "missing",
    record_count: rows.length,
    item_count: rows.length,
    last_success_at: currentCache.last_success_at || null,
    fields: REFERENCE_FIELDS,
    summary,
    items: rows
  };
}

export function updateSourceCsvReferenceCache({ sourceRows = [], generatedAt = new Date().toISOString(), filePath = SOURCE_CSV_REFERENCE_CACHE_PATH } = {}) {
  const items = uniqueReferenceRows(sourceRows);
  if (!items.length) return readSourceCsvReferenceCache(filePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const payload = {
    schema_version: "1.0",
    generated_at: generatedAt,
    last_success_at: generatedAt,
    record_count: items.length,
    item_count: items.length,
    fields: REFERENCE_FIELDS,
    items
  };
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));
  return { status: "available", items, last_success_at: generatedAt, generated_at: generatedAt };
}

function findSourceCsvItem(sourceCollectionStatus = {}) {
  return (sourceCollectionStatus.items || []).find(item => item.source_key === "source_csv") || {};
}

function sourceCsvDiagnostic(collectorDiagnostics = {}) {
  return (collectorDiagnostics.sources || []).find(source => String(source.key || source.source_name || "") === "source_csv") || {};
}

function isSourceTooLargeSignal(...values) {
  const text = values.flatMap(value => {
    if (!value) return [];
    if (Array.isArray(value)) return value.map(item => JSON.stringify(item));
    if (typeof value === "object") return Object.values(value).map(item => String(item ?? ""));
    return [String(value)];
  }).join(" ").toLowerCase();
  return /source_too_large|api_response_too_large|response too large|api response too large/.test(text);
}

function responseSizeFromText(...values) {
  const text = values.flatMap(value => {
    if (!value) return [];
    if (Array.isArray(value)) return value.map(item => JSON.stringify(item));
    if (typeof value === "object") return Object.values(value).map(item => String(item ?? ""));
    return [String(value)];
  }).join(" ");
  const match = text.match(/(?:response|api response).*?too large:\s*([0-9,]+)\s*bytes/i)
    || text.match(/([0-9,]+)\s*bytes/i);
  if (!match) return 0;
  const parsed = Number(String(match[1]).replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

export function buildSourceCsvSummary({ sourceCollectionStatus = {}, collectorDiagnostics = {}, cache = null, generatedAt = new Date().toISOString() } = {}) {
  const item = findSourceCsvItem(sourceCollectionStatus);
  const diagnostic = sourceCsvDiagnostic(collectorDiagnostics);
  const currentCache = cache || readSourceCsvReferenceCache();
  const rows = currentCache.items || [];
  const summary = summarizeSourceCsvReferenceRows(rows);
  const maxAllowedBytes = Number(process.env.MAX_SOURCE_CSV_BYTES || process.env.MAX_API_RESPONSE_BYTES || DEFAULT_MAX_SOURCE_CSV_BYTES);
  const responseSizeBytes = Number(diagnostic.response_size_bytes || item.response_size_bytes || 0)
    || responseSizeFromText(item.skip_reason, item.error_message, item.diagnostics, diagnostic);
  const sourceTooLarge = item.status === "SOURCE_TOO_LARGE"
    || diagnostic.failure_reason === "api_response_too_large"
    || Boolean(item.source_too_large)
    || isSourceTooLargeSignal(item.skip_reason, item.error_message, item.diagnostics, diagnostic);
  const previousCacheAvailable = currentCache.status === "available" && summary.usable_reference_rows > 0;
  const cacheAgeHours = currentCache.last_success_at
    ? Math.max(0, (Date.parse(generatedAt) - Date.parse(currentCache.last_success_at)) / 36e5)
    : null;
  const recommendedFix = sourceTooLarge
    ? "Create a smaller verified vessel reference CSV and set SOURCE_CSV_URL to that file."
    : previousCacheAvailable
      ? "Keep source_csv as a lightweight verified vessel reference cache."
      : "Create a smaller verified vessel reference CSV and set SOURCE_CSV_URL to that file.";
  return {
    schema_version: "1.0",
    generated_at: generatedAt,
    status: sourceTooLarge ? "SOURCE_TOO_LARGE" : (item.status || (currentCache.status === "available" ? "CACHE_AVAILABLE" : "NOT_CONFIGURED")),
    source_layer: item.source_layer || "auxiliary",
    core_blocking: false,
    configured: (item.present_env || []).includes("SOURCE_CSV_URL"),
    collector_enabled: Boolean(item.collector_enabled),
    collector_attempted: Boolean(item.collector_attempted),
    source_too_large: sourceTooLarge,
    previous_cache_available: previousCacheAvailable,
    using_previous_cache: sourceTooLarge && previousCacheAvailable,
    response_size_bytes: responseSizeBytes,
    max_allowed_bytes: maxAllowedBytes,
    rows_collected: Number(item.rows_collected || diagnostic.rows_collected || diagnostic.row_count || 0),
    rows_normalized: sourceTooLarge ? 0 : Number(item.rows_normalized || diagnostic.normalized_count || diagnostic.rows_normalized || 0),
    usable_reference_rows: summary.usable_reference_rows,
    rows_with_imo: summary.rows_with_imo,
    rows_with_mmsi: summary.rows_with_mmsi,
    rows_with_call_sign: summary.rows_with_call_sign,
    rows_with_operator: summary.rows_with_operator,
    cache_status: currentCache.status,
    last_success_at: currentCache.last_success_at || null,
    cache_age_hours: cacheAgeHours === null || !Number.isFinite(cacheAgeHours) ? null : Number(cacheAgeHours.toFixed(2)),
    fields_available: summary.fields_available,
    fields_expected: REFERENCE_FIELDS,
    missing_recommended_columns: summary.schema_issues.missing_recommended_columns,
    schema_issues: summary.schema_issues,
    duplicate_issues: summary.duplicate_issues,
    reference_index_keys: Object.fromEntries(Object.entries(buildSourceCsvReferenceIndexes(rows)).map(([key, value]) => [key, Object.keys(value).length])),
    reference_indexes_built: summary.usable_reference_rows > 0,
    recommended_fix: recommendedFix,
    recommendation: recommendedFix
  };
}
