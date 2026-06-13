import fs from "node:fs";
import path from "node:path";
import {
  buildVesselMatchKeys,
  normalizeCallSign,
  normalizeFlag,
  normalizeNumeric,
  normalizeVesselName,
  normalizeVesselType
} from "./normalize.js";
import { SOURCE_CSV_URL_RECOMMENDED_FIX, diagnoseSourceCsvUrl } from "./source-csv-url.js";

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
  "loa",
  "beam",
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
  loa: ["loa", "length", "length_m", "length_overall", "LOA"],
  beam: ["beam", "breadth", "breadth_m", "width", "BEAM"],
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
  return normalizeNumeric(value);
}

function positiveNumberOrNull(value) {
  const parsed = normalizeNumeric(value);
  return parsed !== null && parsed > 0 ? parsed : null;
}

function normalizedBool(value) {
  const text = String(value ?? "").trim().toLowerCase();
  if (!text) return false;
  return ["true", "1", "yes", "y", "verified", "검증", "확인"].includes(text);
}

export function normalizeSourceCsvReferenceRow(row = {}) {
  const vesselName = firstValue(row, "vessel_name");
  const callSign = normalizeCallSign(firstValue(row, "call_sign"));
  const normalizedName = normalizeVesselName(vesselName || firstValue(row, "normalized_vessel_name"));
  const gt = positiveNumberOrNull(firstValue(row, "gt"));
  const dwt = positiveNumberOrNull(firstValue(row, "dwt"));
  const loa = positiveNumberOrNull(firstValue(row, "loa"));
  const beam = positiveNumberOrNull(firstValue(row, "beam"));
  const vesselType = normalizeVesselType(firstValue(row, "vessel_type"));
  const reference = {
    vessel_name: vesselName,
    normalized_vessel_name: normalizedName,
    imo: firstValue(row, "imo"),
    mmsi: firstValue(row, "mmsi"),
    call_sign: callSign,
    operator: firstValue(row, "operator"),
    owner: firstValue(row, "owner"),
    manager: firstValue(row, "manager"),
    vessel_type: vesselType,
    gt,
    dwt,
    flag: normalizeFlag(firstValue(row, "flag")),
    loa,
    beam,
    verified: normalizedBool(firstValue(row, "verified")) || Boolean(firstValue(row, "imo") || firstValue(row, "mmsi") || callSign),
    notes: firstValue(row, "notes"),
    updated_at: firstValue(row, "updated_at"),
    reference_source: "source_csv_cache"
  };
  reference.match_keys = buildVesselMatchKeys(reference);
  const hasIdentifier = hasText(reference.imo) || hasText(reference.mmsi) || hasText(reference.call_sign);
  const hasCommercialField = hasText(reference.operator) || hasText(reference.owner) || hasText(reference.manager) || hasText(reference.vessel_type) || reference.gt !== null || reference.dwt !== null || reference.loa !== null || reference.beam !== null;
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
    rows_with_gt: rows.filter(row => row.gt !== null && row.gt !== undefined && Number(row.gt) > 0).length,
    rows_with_flag: rows.filter(row => hasText(row.flag)).length,
    rows_with_vessel_type: rows.filter(row => hasText(row.vessel_type)).length,
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

function mergedDisplay(record = {}) {
  return record.vessel_display && typeof record.vessel_display === "object"
    ? { ...record, ...record.vessel_display }
    : record;
}

function recordIdentity(record = {}) {
  const data = mergedDisplay(record);
  const identity = {
    imo: String(data.imo || "").trim(),
    mmsi: String(data.mmsi || "").trim(),
    call_sign: normalizeCallSign(data.call_sign || data.callsign || ""),
    normalized_vessel_name: normalizeVesselName(data.vessel_name || data.name || data.normalized_vessel_name || ""),
    gt: numberOrNull(data.gt ?? data.tonnage_summary?.gt),
    vessel_type: normalizeVesselType(data.vessel_type || ""),
    vessel_key: String(data.vessel_key || data.vessel_id || data.imo || data.mmsi || data.call_sign || data.vessel_name || "").trim()
  };
  identity.match_keys = buildVesselMatchKeys({ ...data, ...identity });
  return identity;
}

function findSourceCsvMatch(record = {}, indexes = {}) {
  const identity = recordIdentity(record);
  if (identity.imo && indexes.by_imo?.[identity.imo]) return { reference: indexes.by_imo[identity.imo], match_type: "IMO", confidence: 98 };
  if (identity.mmsi && indexes.by_mmsi?.[identity.mmsi]) return { reference: indexes.by_mmsi[identity.mmsi], match_type: "MMSI", confidence: 96 };
  if (identity.call_sign && indexes.by_call_sign?.[identity.call_sign]) return { reference: indexes.by_call_sign[identity.call_sign], match_type: "CALL_SIGN", confidence: 90 };
  const nameCallKey = identity.normalized_vessel_name && identity.call_sign ? `${identity.normalized_vessel_name}|${identity.call_sign}` : "";
  if (nameCallKey && indexes.by_normalized_vessel_name_call_sign?.[nameCallKey]) {
    return { reference: indexes.by_normalized_vessel_name_call_sign[nameCallKey], match_type: "CALL_SIGN_NAME", confidence: 88 };
  }
  const gtTypeKey = identity.normalized_vessel_name && identity.gt !== null && identity.vessel_type
    ? `${identity.normalized_vessel_name}|${identity.gt}|${identity.vessel_type}`
    : "";
  if (gtTypeKey && indexes.by_normalized_vessel_name_gt_vessel_type?.[gtTypeKey]) {
    return { reference: indexes.by_normalized_vessel_name_gt_vessel_type[gtTypeKey], match_type: "NAME_GT_TYPE", confidence: 86 };
  }
  return null;
}

const SOURCE_CSV_ENRICH_FIELDS = {
  imo: "imo",
  mmsi: "mmsi",
  call_sign: "call_sign",
  operator_display: "operator",
  owner: "owner",
  manager: "manager",
  vessel_type: "vessel_type",
  gt: "gt",
  dwt: "dwt",
  flag: "flag",
  loa: "loa",
  beam: "beam"
};

function currentValue(record = {}, field = "") {
  const data = mergedDisplay(record);
  if (field === "operator_display") return data.operator_display || data.operator || "";
  return data[field];
}

function valueEmpty(value) {
  if (value === null || value === undefined) return true;
  if (typeof value === "number") return !Number.isFinite(value);
  return String(value).trim() === "" || String(value).trim() === "-";
}

function trustedField(record = {}, field = "") {
  const lineage = record.data_lineage?.[field] || record.vessel_display?.data_lineage?.[field] || {};
  return record.manual === true || record.verified === true || lineage.verified === true || Number(lineage.confidence || 0) >= 90;
}

function setRecordField(record = {}, field = "", value) {
  if (field === "operator_display") {
    record.operator_display = value;
    if (valueEmpty(record.operator)) record.operator = value;
  } else {
    record[field] = value;
  }
  if (!record.data_sources || !Array.isArray(record.data_sources)) record.data_sources = Array.isArray(record.data_sources) ? record.data_sources : [];
  if (!record.enrichment_sources || !Array.isArray(record.enrichment_sources)) record.enrichment_sources = Array.isArray(record.enrichment_sources) ? record.enrichment_sources : [];
  if (!record.data_sources.includes("source_csv")) record.data_sources.push("source_csv");
  if (!record.enrichment_sources.includes("source_csv")) record.enrichment_sources.push("source_csv");
}

function setSourceCsvLineage(record = {}, field = "", { confidence = 0, matchType = "", updatedAt = null, verified = false } = {}) {
  if (!record.data_lineage || typeof record.data_lineage !== "object") record.data_lineage = {};
  record.data_lineage[field] = {
    source: "source_csv",
    confidence,
    match_type: matchType,
    updated_at: updatedAt,
    verified: verified === true
  };
}

function compactTarget(record = {}) {
  const data = mergedDisplay(record);
  return {
    vessel_key: recordIdentity(record).vessel_key || `${data.vessel_name || "-"}|${data.current_port || data.port_name || ""}`,
    vessel_name: data.vessel_name || data.name || "-",
    imo: data.imo || "-",
    mmsi: data.mmsi || "-",
    call_sign: data.call_sign || "-",
    current_port: data.current_port_korean || data.current_port || data.port_name || "-",
    operator_display: data.operator_display || data.operator || "-"
  };
}

export function buildSourceCsvIndexPayload({ cache = null, generatedAt = new Date().toISOString() } = {}) {
  const currentCache = cache || readSourceCsvReferenceCache();
  const rows = uniqueReferenceRows(currentCache.items || []);
  const indexes = buildSourceCsvReferenceIndexes(rows);
  return {
    schema_version: "1.0",
    generated_at: generatedAt,
    status: rows.length ? "available" : currentCache.status || "missing",
    record_count: Object.keys(indexes).length,
    item_count: Object.keys(indexes).length,
    source_key: "source_csv",
    cache_status: currentCache.status,
    last_success_at: currentCache.last_success_at || null,
    index_counts: Object.fromEntries(Object.entries(indexes).map(([key, value]) => [key, Object.keys(value).length])),
    indexes: Object.fromEntries(Object.entries(indexes).map(([key, value]) => [key, Object.keys(value)]))
  };
}

export function buildSourceCsvEnrichmentDryRun({ records = [], cache = null, generatedAt = new Date().toISOString(), apply = false } = {}) {
  const currentCache = cache || readSourceCsvReferenceCache();
  const rows = uniqueReferenceRows(currentCache.items || []);
  const indexes = buildSourceCsvReferenceIndexes(rows);
  const counters = {
    matches_by_imo: 0,
    matches_by_mmsi: 0,
    matches_by_call_sign: 0,
    matches_by_name_call_sign: 0,
    matches_by_name_gt_type: 0,
    operator_candidates: 0,
    imo_candidates: 0,
    mmsi_candidates: 0,
    conflicts: 0,
    weak_matches: 0,
    auto_apply_count: 0,
    review_count: 0,
    reject_count: 0
  };
  const applied = [];
  const review = [];
  const rejected = [];
  const sampleLimit = 100;
  const matchedVessels = new Set();
  for (const record of records) {
    if (!record || typeof record !== "object") continue;
    const match = findSourceCsvMatch(record, indexes);
    if (!match) continue;
    matchedVessels.add(compactTarget(record).vessel_key);
    if (match.match_type === "IMO") counters.matches_by_imo += 1;
    else if (match.match_type === "MMSI") counters.matches_by_mmsi += 1;
    else if (match.match_type === "CALL_SIGN") counters.matches_by_call_sign += 1;
    else if (match.match_type === "CALL_SIGN_NAME") counters.matches_by_name_call_sign += 1;
    else if (match.match_type === "NAME_GT_TYPE") counters.matches_by_name_gt_type += 1;

    for (const [field, sourceField] of Object.entries(SOURCE_CSV_ENRICH_FIELDS)) {
      const candidateValue = match.reference[sourceField];
      if (valueEmpty(candidateValue)) continue;
      if (field === "operator_display") counters.operator_candidates += 1;
      if (field === "imo") counters.imo_candidates += 1;
      if (field === "mmsi") counters.mmsi_candidates += 1;
      const current = currentValue(record, field);
      const conflict = !valueEmpty(current) && String(current).trim() !== String(candidateValue).trim();
      const item = {
        source_key: "source_csv",
        field_name: field,
        target_vessel_key: compactTarget(record).vessel_key,
        target_vessel: compactTarget(record),
        match_type: match.match_type,
        match_confidence: match.confidence,
        confidence: match.confidence,
        current_value: valueEmpty(current) ? null : current,
        candidate_value: candidateValue,
        raw_value: candidateValue,
        source_timestamp: match.reference.updated_at || generatedAt,
        lineage: {
          source: "source_csv",
          raw_source: "source_csv",
          normalized_field: field,
          source_row_id: match.reference.imo || match.reference.mmsi || match.reference.call_sign || match.reference.normalized_vessel_name,
          matched_on: match.match_type === "IMO"
            ? ["imo"]
            : match.match_type === "MMSI"
              ? ["mmsi"]
              : match.match_type === "CALL_SIGN"
                ? ["call_sign"]
                : match.match_type === "CALL_SIGN_NAME"
                  ? ["call_sign", "vessel_name"]
                  : match.match_type === "NAME_GT_TYPE"
                    ? ["vessel_name", "gt", "vessel_type"]
                    : []
        }
      };
      if (conflict || trustedField(record, field)) {
        counters.conflicts += conflict ? 1 : 0;
        counters.review_count += 1;
        review.push({
          ...item,
          action: "REVIEW",
          conflict_type: conflict ? (field === "imo" ? "DIFFERENT_IMO" : field === "mmsi" ? "DIFFERENT_MMSI" : "OPERATOR_CONFLICT") : "TRUSTED_CURRENT_VALUE",
          recommended_action: "검증된 현재 값은 자동 덮어쓰지 말고 수동 확인",
          reason: "source_csv candidate conflicts with an existing or trusted field."
        });
      } else if (valueEmpty(current) && match.confidence >= 85) {
        counters.auto_apply_count += 1;
        const appliedItem = { ...item, action: "APPLY", reason: "source_csv supplied a missing field with high-confidence match." };
        applied.push(appliedItem);
        if (apply) {
          setRecordField(record, field, candidateValue);
          setSourceCsvLineage(record, field, {
            confidence: match.confidence,
            matchType: match.match_type,
            updatedAt: match.reference.updated_at || generatedAt,
            verified: match.reference.verified === true
          });
        }
      } else {
        counters.reject_count += 1;
        counters.weak_matches += match.confidence < 85 ? 1 : 0;
        rejected.push({ ...item, action: "REJECT", reason: "source_csv match confidence or target field state is not safe for automatic apply." });
      }
    }
  }
  return {
    schema_version: "1.0",
    generated_at: generatedAt,
    source_key: "source_csv",
    cache_status: currentCache.status,
    usable_reference_rows: rows.length,
    candidate_vessels_checked: records.length,
    matched_vessels: matchedVessels.size,
    ...counters,
    applied_fields: applied.length,
    review_items: review.length,
    rejected_items: rejected.length,
    sample_limit: sampleLimit,
    items: applied.slice(0, sampleLimit),
    applied: applied.slice(0, sampleLimit),
    review: review.slice(0, sampleLimit),
    rejected: rejected.slice(0, sampleLimit)
  };
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

function flattenedDiagnostics(item = {}, diagnostic = {}) {
  const nested = Array.isArray(item.diagnostics) ? item.diagnostics[0] || {} : {};
  return { ...nested, ...diagnostic, ...item };
}

function likelyRawCsv({ responseSizeBytes = 0, headerFields = [], sourceTooLarge = false } = {}) {
  if (sourceTooLarge || responseSizeBytes > 25_000_000) return true;
  const headers = headerFields.map(field => String(field || "").toLowerCase());
  const expectedMatches = REFERENCE_FIELDS.filter(field => headers.includes(field.toLowerCase())).length;
  return headerFields.length > 25 && expectedMatches < 5;
}

function likelyLightweightCsv({ headerFields = [], rows = [] } = {}) {
  if (rows.length > 0) return true;
  const headers = headerFields.map(field => String(field || "").toLowerCase());
  const expectedMatches = REFERENCE_FIELDS.filter(field => headers.includes(field.toLowerCase())).length;
  return expectedMatches >= 5;
}

export function buildSourceCsvSummary({ sourceCollectionStatus = {}, collectorDiagnostics = {}, cache = null, generatedAt = new Date().toISOString() } = {}) {
  const item = findSourceCsvItem(sourceCollectionStatus);
  const diagnostic = sourceCsvDiagnostic(collectorDiagnostics);
  const diag = flattenedDiagnostics(item, diagnostic);
  const sourceCsvMode = String(process.env.SOURCE_CSV_MODE || "").toLowerCase();
  const cacheOnlyMode = sourceCsvMode === "cache_only";
  const offMode = sourceCsvMode === "off";
  const currentCache = cache || readSourceCsvReferenceCache();
  const rows = currentCache.items || [];
  const summary = summarizeSourceCsvReferenceRows(rows);
  const maxAllowedBytes = Number(process.env.MAX_SOURCE_CSV_BYTES || process.env.MAX_API_RESPONSE_BYTES || DEFAULT_MAX_SOURCE_CSV_BYTES);
  const responseSizeBytes = Number(diag.response_size_bytes || 0)
    || responseSizeFromText(item.skip_reason, item.error_message, item.diagnostics, diagnostic);
  const urlDiagnostic = diagnoseSourceCsvUrl({
    sourceCsvUrl: diag.configured_url_sanitized || process.env.SOURCE_CSV_URL,
    cwd: process.cwd()
  });
  const sourceTooLarge = item.status === "SOURCE_TOO_LARGE"
    || diag.failure_reason === "api_response_too_large"
    || Boolean(item.source_too_large)
    || isSourceTooLargeSignal(item.skip_reason, item.error_message, item.diagnostics, diagnostic);
  const previousCacheAvailable = currentCache.status === "available" && summary.usable_reference_rows > 0;
  const cacheAgeHours = currentCache.last_success_at
    ? Math.max(0, (Date.parse(generatedAt) - Date.parse(currentCache.last_success_at)) / 36e5)
    : null;
  const headerFields = Array.isArray(diag.header_row_fields) ? diag.header_row_fields : Array.isArray(diag.sample_keys) ? diag.sample_keys : [];
  const isProbablyRaw = likelyRawCsv({ responseSizeBytes, headerFields, sourceTooLarge });
  const isProbablyLightweight = likelyLightweightCsv({ headerFields, rows });
  const wrongSourceCsvUrl = urlDiagnostic.status === "WRONG_SOURCE_CSV_URL" || item.status === "WRONG_SOURCE_CSV_URL" || diag.source_csv_url_status === "WRONG_SOURCE_CSV_URL";
  const status = wrongSourceCsvUrl && !cacheOnlyMode && !offMode
    ? "WRONG_SOURCE_CSV_URL"
    : offMode
    ? (previousCacheAvailable ? "OFF_PREVIOUS_CACHE" : "OFF_NO_CACHE")
    : cacheOnlyMode
      ? (previousCacheAvailable ? "CACHE_ONLY_PREVIOUS_CACHE" : "CACHE_ONLY_NO_CACHE")
    : sourceTooLarge
    ? (previousCacheAvailable ? "USING_PREVIOUS_CACHE" : "SOURCE_TOO_LARGE")
    : summary.usable_reference_rows > 0
      ? "ACTIVE"
      : (item.status || (currentCache.status === "available" ? "CACHE_AVAILABLE" : "NOT_CONFIGURED"));
  const recommendedFix = offMode
    ? (previousCacheAvailable
      ? "source_csv is disabled for this tier and the previous lightweight cache remains available."
      : "source_csv is disabled for this tier. Run reference enrichment with SOURCE_CSV_MODE=refresh to build the cache.")
    : cacheOnlyMode
    ? (previousCacheAvailable
      ? "Core update is using the previous lightweight source_csv cache. Run heavy enrichment with SOURCE_CSV_MODE=refresh to refresh it."
      : "Core update is cache-only and no source_csv cache exists. Create a smaller verified vessel reference CSV, then run heavy enrichment with SOURCE_CSV_MODE=refresh.")
    : wrongSourceCsvUrl
    ? SOURCE_CSV_URL_RECOMMENDED_FIX
    : sourceTooLarge
    ? "SOURCE_CSV_URL still points to the large raw CSV. Point it to the lightweight verified vessel reference CSV."
    : previousCacheAvailable
      ? "Keep source_csv as a lightweight verified vessel reference cache."
      : "Create a smaller verified vessel reference CSV and set SOURCE_CSV_URL to that file.";
  return {
    schema_version: "1.0",
    generated_at: generatedAt,
    owner_tier: "reference_enrichment",
    core_may_update: false,
    status,
    source_csv_url_status: urlDiagnostic.status,
    expected_raw_url: urlDiagnostic.expected_raw_url,
    configured_url_sanitized: urlDiagnostic.configured_url_sanitized || diag.configured_url_sanitized || null,
    configured_repository: urlDiagnostic.configured_repository || diag.configured_repository || null,
    configured_file_path: urlDiagnostic.configured_file_path || diag.configured_file_path || null,
    local_reference_path: urlDiagnostic.local_reference_path,
    local_reference_exists: urlDiagnostic.local_reference_exists,
    points_to_old_repo: urlDiagnostic.points_to_old_repo,
    points_to_different_repo: urlDiagnostic.points_to_different_repo,
    points_to_old_source_arrivals_csv: urlDiagnostic.points_to_old_source_arrivals_csv,
    points_to_lightweight_verified_reference_csv: urlDiagnostic.points_to_lightweight_verified_reference_csv,
    points_to_expected_url: urlDiagnostic.points_to_expected_url,
    source_csv_mode: sourceCsvMode || "refresh",
    source_layer: item.source_layer || "auxiliary",
    core_blocking: false,
    configured: (item.present_env || []).includes("SOURCE_CSV_URL") || Boolean(urlDiagnostic.configured_url_sanitized || diag.configured_url_sanitized),
    collector_enabled: Boolean(item.collector_enabled),
    collector_attempted: Boolean(item.collector_attempted),
    source_too_large: sourceTooLarge,
    is_probably_large_raw_csv: isProbablyRaw,
    is_probably_lightweight_reference_csv: isProbablyLightweight,
    previous_cache_available: previousCacheAvailable,
    using_previous_cache: (sourceTooLarge || cacheOnlyMode || offMode) && previousCacheAvailable,
    response_size_bytes: responseSizeBytes,
    max_allowed_bytes: maxAllowedBytes,
    head_checked: Boolean(diag.head_checked),
    head_http_status: diag.head_http_status || null,
    content_type: diag.content_type || diag.response_content_type || null,
    file_name_hint: diag.file_name_hint || null,
    header_row_fields: headerFields,
    row_count_estimate: Number(diag.row_count_estimate || 0) || null,
    rows_collected: Number(item.rows_collected || diagnostic.rows_collected || diagnostic.row_count || 0),
    rows_normalized: sourceTooLarge ? 0 : Number(item.rows_normalized || diagnostic.normalized_count || diagnostic.rows_normalized || 0),
    usable_reference_rows: summary.usable_reference_rows,
    rows_with_imo: summary.rows_with_imo,
    rows_with_mmsi: summary.rows_with_mmsi,
    rows_with_call_sign: summary.rows_with_call_sign,
    rows_with_operator: summary.rows_with_operator,
    rows_with_gt: summary.rows_with_gt,
    rows_with_flag: summary.rows_with_flag,
    rows_with_vessel_type: summary.rows_with_vessel_type,
    cache_status: currentCache.status,
    last_success_at: currentCache.last_success_at || null,
    cache_age_hours: cacheAgeHours === null || !Number.isFinite(cacheAgeHours) ? null : Number(cacheAgeHours.toFixed(2)),
    fields_available: summary.fields_available,
    fields_expected: REFERENCE_FIELDS,
    missing_recommended_columns: summary.schema_issues.missing_recommended_columns,
    schema_issues: summary.schema_issues,
    duplicate_issues: summary.duplicate_issues,
    reference_index_counts: Object.fromEntries(Object.entries(buildSourceCsvReferenceIndexes(rows)).map(([key, value]) => [key, Object.keys(value).length])),
    reference_index_keys: Object.fromEntries(Object.entries(buildSourceCsvReferenceIndexes(rows)).map(([key, value]) => [key, Object.keys(value).length])),
    reference_indexes_built: summary.usable_reference_rows > 0,
    recommended_fix: recommendedFix,
    recommendation: recommendedFix
  };
}
