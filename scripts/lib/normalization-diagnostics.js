function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function sourceKey(record = {}) {
  return String(record.source || record.source_key || record.source_name || "unknown").trim() || "unknown";
}

function groupedRecords(records = []) {
  const groups = new Map();
  for (const record of records) {
    if (!record || typeof record !== "object") continue;
    const key = sourceKey(record);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(record);
  }
  return groups;
}

function missingFields({ rows = 0, rowsWithVesselName = 0, rowsWithNormalizedName = 0, rowsWithCallSign = 0, rowsWithPort = 0, rowsWithMatchKeys = 0 } = {}) {
  return [
    { field: "vessel_name", missing_rows: Math.max(0, rows - rowsWithVesselName) },
    { field: "normalized_vessel_name", missing_rows: Math.max(0, rows - rowsWithNormalizedName) },
    { field: "call_sign", missing_rows: Math.max(0, rows - rowsWithCallSign) },
    { field: "normalized_port", missing_rows: Math.max(0, rows - rowsWithPort) },
    { field: "match_keys", missing_rows: Math.max(0, rows - rowsWithMatchKeys) }
  ].filter(item => item.missing_rows > 0)
    .sort((a, b) => b.missing_rows - a.missing_rows)
    .slice(0, 5);
}

function sampleFromRecords(records = []) {
  return records.slice(0, 5).map(record => ({
    before: {
      raw_source_keys: Array.isArray(record.raw_source_keys) ? record.raw_source_keys.slice(0, 30) : [],
      raw_port: record.raw_port || "",
      raw_berth_name: record.raw_berth_name || "",
      raw_terminal_name: record.raw_terminal_name || ""
    },
    after: {
      vessel_name: record.vessel_name || "",
      normalized_vessel_name: record.normalized_vessel_name || "",
      call_sign: record.call_sign || "",
      normalized_port: record.normalized_port || "",
      berth_key: record.berth_key || "",
      terminal_name: record.terminal_name || "",
      match_keys: record.match_keys || {}
    }
  }));
}

function sourceItem(diag = {}, records = []) {
  const rowsIn = number(diag.rows_collected || diag.row_count || records.length);
  const rowsNormalized = number(diag.rows_normalized || diag.normalized_count || records.length);
  const rowsWithVesselName = number(diag.rows_with_vessel_name, records.filter(record => String(record.vessel_name || "").trim()).length);
  const rowsWithNormalizedName = number(diag.rows_with_normalized_vessel_name, records.filter(record => String(record.normalized_vessel_name || "").trim()).length);
  const rowsWithCallSign = number(diag.rows_with_call_sign, records.filter(record => String(record.call_sign || "").trim()).length);
  const rowsWithPort = number(diag.rows_with_normalized_port, records.filter(record => String(record.normalized_port || "").trim()).length);
  const rowsWithMatchKeys = number(diag.rows_with_match_keys, records.filter(record => Object.keys(record.match_keys || {}).length > 0).length);
  return {
    source_key: diag.key || diag.source_name || (records[0] ? sourceKey(records[0]) : "unknown"),
    source_label: diag.label || "",
    source_profile: diag.source_profile || records[0]?.source_profile || "",
    status: diag.status || "unknown",
    rows_in: rowsIn,
    rows_normalized: rowsNormalized,
    rows_with_vessel_name: rowsWithVesselName,
    rows_with_normalized_vessel_name: rowsWithNormalizedName,
    rows_with_call_sign: rowsWithCallSign,
    rows_with_normalized_port: rowsWithPort,
    rows_with_match_keys: rowsWithMatchKeys,
    rows_time_only: number(diag.rows_time_only || diag.time_only_rows, records.filter(record => record.pilot_time_parse_status === "time_only_missing_date").length),
    rows_invalid_time: number(diag.rows_invalid_time || diag.invalid_time_rows, records.filter(record => record.pilot_time_parse_status === "invalid_date_time").length),
    top_missing_fields: missingFields({
      rows: rowsNormalized,
      rowsWithVesselName,
      rowsWithNormalizedName,
      rowsWithCallSign,
      rowsWithPort,
      rowsWithMatchKeys
    }),
    sample_before_after: Array.isArray(diag.sample_before_after) && diag.sample_before_after.length
      ? diag.sample_before_after.slice(0, 5)
      : sampleFromRecords(records)
  };
}

function ownerTierForSource(sourceKey = "") {
  const key = String(sourceKey || "");
  if (key.startsWith("port_operation_") || key === "port_operation" || key === "merged_port_operation") return "core";
  if (key === "source_csv") return "reference_enrichment";
  return "fast_aux";
}

export function buildNormalizationDiagnosticsPayload({ records = [], collectorDiagnostics = {}, generatedAt = new Date().toISOString() } = {}) {
  const groups = groupedRecords(records);
  const diagnosticSources = Array.isArray(collectorDiagnostics.sources) ? collectorDiagnostics.sources : [];
  const seen = new Set();
  const items = [];
  for (const diag of diagnosticSources) {
    const key = String(diag.key || diag.source_name || "unknown");
    seen.add(key);
    items.push(sourceItem(diag, groups.get(key) || []));
  }
  for (const [key, sourceRecords] of groups.entries()) {
    if (seen.has(key)) continue;
    items.push(sourceItem({ key, status: "normalized_from_records" }, sourceRecords));
  }
  const ownerTiers = [...new Set(items.map(item => ownerTierForSource(item.source_key)))];
  return {
    schema_version: "1.0",
    generated_at: generatedAt,
    owner_tier: ownerTiers.length === 1 ? ownerTiers[0] : "mixed",
    owner_tiers: ownerTiers,
    core_may_update: ownerTiers.includes("core"),
    data_mode: "derived_from_collector_rows",
    record_count: items.length,
    item_count: items.length,
    totals: {
      rows_in: items.reduce((sum, item) => sum + number(item.rows_in), 0),
      rows_normalized: items.reduce((sum, item) => sum + number(item.rows_normalized), 0),
      rows_with_match_keys: items.reduce((sum, item) => sum + number(item.rows_with_match_keys), 0),
      rows_time_only: items.reduce((sum, item) => sum + number(item.rows_time_only), 0),
      rows_invalid_time: items.reduce((sum, item) => sum + number(item.rows_invalid_time), 0)
    },
    items
  };
}
