import { SOURCE_QUALITY_KEYS } from "./source-quality-score.js";

const FIELD_GROUPS = {
  source_csv: ["imo", "mmsi", "call_sign", "operator_display", "owner", "manager", "vessel_type", "gt", "dwt", "flag"],
  pilot_sources: ["pilotage_signal", "pilotage_time", "pilot_station", "pilotage_direction"],
  berth_sources: ["berth", "terminal", "etb", "atb", "berth_signal"],
  vessel_spec: ["imo", "mmsi", "call_sign", "vessel_type", "gt", "dwt", "flag"],
  mof_ais_info: ["imo", "mmsi", "call_sign", "vessel_name", "vessel_type"],
  mof_ais_dynamic: ["mmsi", "lat", "lon", "speed", "course", "last_seen_at"],
  port_operation: ["vessel_name", "current_port", "eta", "ata", "etd", "atd", "berth", "operator_display"]
};

const SOURCE_ALIASES = {
  source_csv: ["source_csv", "csv", "verified_csv"],
  pilot_sources: ["pilot_sources", "pilotage", "pilot_schedule_events", "pilot"],
  berth_sources: ["berth_sources", "pnc", "berth", "terminal"],
  vessel_spec: ["vessel_spec", "vessel specification"],
  mof_ais_info: ["mof_ais_info", "ais_info"],
  mof_ais_dynamic: ["mof_ais_dynamic", "ais_dynamic"],
  port_operation: ["port_operation", "port-mis", "port_mis", "merged port operation"]
};

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function hasValue(value) {
  if (value === undefined || value === null) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "number") return Number.isFinite(value);
  const text = String(value).trim();
  return text !== "" && text !== "-";
}

function unique(values = []) {
  return [...new Set(values.filter(hasValue).map(value => String(value).trim()))];
}

function display(row = {}) {
  return row.vessel_display && typeof row.vessel_display === "object"
    ? { ...row, ...row.vessel_display }
    : row;
}

function vesselKey(row = {}) {
  const d = display(row);
  const key = [d.imo, d.mmsi, d.call_sign, d.vessel_id, d.master_vessel_id]
    .find(value => hasValue(value));
  return String(key || `${d.vessel_name || row.vessel_name || "unknown"}|${d.current_port_korean || d.current_port || d.port_name || ""}`).trim();
}

function dedupeRecords(records = []) {
  const map = new Map();
  for (const row of records || []) {
    const key = vesselKey(row);
    if (!key) continue;
    if (!map.has(key)) map.set(key, row);
  }
  return [...map.values()];
}

function rowSources(row = {}) {
  const d = display(row);
  return unique([
    ...(Array.isArray(d.data_sources) ? d.data_sources : []),
    ...(Array.isArray(d.enrichment_sources) ? d.enrichment_sources : []),
    d.data_source,
    d.source,
    d.identity_source,
    d.operator_source,
    d.berth_source,
    d.arrival_window_source
  ]).map(value => value.toLowerCase());
}

function sourceMatchesRow(row = {}, sourceKey = "") {
  const aliases = SOURCE_ALIASES[sourceKey] || [sourceKey];
  const sources = rowSources(row);
  return sources.some(source => aliases.some(alias => source.includes(alias.toLowerCase())));
}

function sourceQualityByKey(sourceQualityScore = {}) {
  return new Map((sourceQualityScore.items || []).map(item => [item.source_key, item]));
}

function countDisplayField(records = [], field) {
  return records.filter(row => hasValue(display(row)[field])).length;
}

function countPilotageSignals(records = []) {
  return records.filter(row => display(row).pilotage_signal?.has_pilotage === true).length;
}

function countBerthSignals(records = []) {
  return records.filter(row => {
    const d = display(row);
    return hasValue(d.berth_source) || d.berth_signal?.has_berth === true || d.berth_signal?.has_berth_info === true;
  }).length;
}

function compactSample(row = {}, fields = []) {
  const d = display(row);
  return {
    vessel_key: vesselKey(row),
    vessel_name: d.vessel_name || row.vessel_name || "-",
    imo: d.imo || "-",
    mmsi: d.mmsi || "-",
    call_sign: d.call_sign || "-",
    current_port: d.current_port_korean || d.current_port || d.port_name || "-",
    operator_display: d.operator_display || d.operator || d.company || "-",
    fields_added: fields.filter(field => {
      if (field === "pilotage_signal") return d.pilotage_signal?.has_pilotage === true;
      return hasValue(d[field]);
    })
  };
}

function sourceSamples(records = [], sourceKey = "", fields = []) {
  const direct = records
    .filter(row => sourceMatchesRow(row, sourceKey))
    .map(row => compactSample(row, fields))
    .filter(sample => sample.fields_added.length > 0);
  if (direct.length) return direct.slice(0, 5);

  if (sourceKey === "pilot_sources") {
    return records
      .filter(row => display(row).pilotage_signal?.has_pilotage === true)
      .map(row => compactSample(row, fields))
      .slice(0, 5);
  }

  if (sourceKey === "berth_sources") {
    return records
      .filter(row => hasValue(display(row).berth))
      .map(row => compactSample(row, ["berth"]))
      .slice(0, 5);
  }

  return [];
}

function fieldCountsForSource(records = [], sourceKey = "", fields = [], matchedVessels = 0) {
  const counts = {};
  for (const field of fields) {
    if (field === "pilotage_signal") {
      counts[field] = countPilotageSignals(records);
    } else if (sourceKey === "berth_sources" && ["berth", "berth_signal"].includes(field)) {
      counts[field] = Math.min(Math.max(matchedVessels, countBerthSignals(records)), countDisplayField(records, "berth"));
    } else if (sourceKey === "port_operation") {
      counts[field] = records.filter(row => sourceMatchesRow(row, sourceKey) && hasValue(display(row)[field])).length;
    } else {
      counts[field] = records.filter(row => sourceMatchesRow(row, sourceKey) && hasValue(display(row)[field])).length;
    }
  }
  return Object.fromEntries(Object.entries(counts).filter(([, count]) => count > 0));
}

function blockedFields({ sourceKey, quality = {}, fieldCounts = {}, displayCounts = {} }) {
  const blocked = [];
  const fields = FIELD_GROUPS[sourceKey] || [];
  if (quality.blocker_reason) {
    for (const field of fields) {
      if (!fieldCounts[field]) blocked.push({ field, reason: quality.blocker_reason });
    }
  }
  if (["mof_ais_info", "vessel_spec", "source_csv"].includes(sourceKey)) {
    for (const field of ["imo", "mmsi", "dwt", "flag"]) {
      if (fields.includes(field) && number(displayCounts[field]) === 0 && !blocked.some(item => item.field === field)) {
        blocked.push({ field, reason: "identifier_or_spec_field_not_visible_in_current_vessel_display" });
      }
    }
  }
  return blocked.slice(0, 12);
}

function sourceMatchedCount({ sourceKey, quality = {}, bootstrapKpis = {}, records = [] }) {
  if (sourceKey === "pilot_sources") {
    return Math.max(
      number(quality.rows_matched_to_vessels),
      number(bootstrapKpis.pilotage_detected_count),
      countPilotageSignals(records)
    );
  }
  if (sourceKey === "berth_sources") {
    return Math.max(
      number(quality.rows_matched_to_vessels),
      number(bootstrapKpis.berth_info_detected_count),
      countBerthSignals(records)
    );
  }
  if (sourceKey === "port_operation") {
    return Math.min(records.length, number(quality.rows_matched_to_vessels));
  }
  return number(quality.rows_matched_to_vessels);
}

export function buildEnrichmentUtilizationPayload({
  records = [],
  sourceQualityScore = {},
  bootstrapKpis = {},
  report = {},
  generatedAt = new Date().toISOString(),
  dataMode = "static_snapshot"
} = {}) {
  const dedupedRecords = dedupeRecords(records);
  const qualityMap = sourceQualityByKey(sourceQualityScore);
  const displayCounts = {
    operator_display: countDisplayField(dedupedRecords, "operator_display"),
    imo: countDisplayField(dedupedRecords, "imo"),
    mmsi: countDisplayField(dedupedRecords, "mmsi"),
    dwt: countDisplayField(dedupedRecords, "dwt"),
    flag: countDisplayField(dedupedRecords, "flag")
  };

  const items = SOURCE_QUALITY_KEYS.map(sourceKey => {
    const quality = qualityMap.get(sourceKey) || {};
    const fields = unique([...(FIELD_GROUPS[sourceKey] || []), ...(quality.fields_contributed || [])]);
    const matchedVessels = sourceMatchedCount({ sourceKey, quality, bootstrapKpis, records: dedupedRecords });
    const fieldCounts = fieldCountsForSource(dedupedRecords, sourceKey, fields, matchedVessels);
    const fieldsAdded = Object.entries(fieldCounts).map(([field, count]) => ({ field, count }));
    const fieldsUpdated = fieldsAdded.filter(item => item.count > 0);
    const fieldsBlocked = blockedFields({ sourceKey, quality, fieldCounts, displayCounts });
    const samples = sourceSamples(dedupedRecords, sourceKey, fields);
    const blockerParts = unique([
      quality.blocker_reason,
      matchedVessels > 0 && samples.length === 0 ? "matched_source_rows_not_attributed_to_vessel_display_samples" : ""
    ]);
    return {
      source_key: sourceKey,
      matched_vessels: matchedVessels,
      fields_added: fieldsAdded,
      fields_updated: fieldsUpdated,
      fields_blocked: fieldsBlocked,
      sample_enriched_vessels: samples,
      blocker_reason: blockerParts.join("; "),
      quality_label: quality.quality_label || "",
      utilization_score: quality.utilization_score ?? null
    };
  });

  const vesselsEnrichedBySource = Object.fromEntries(items.map(item => [item.source_key, item.matched_vessels]));
  const fieldsRecoveredBySource = Object.fromEntries(items.map(item => [
    item.source_key,
    Object.fromEntries(item.fields_added.map(field => [field.field, field.count]))
  ]));
  const enrichmentFailures = items
    .filter(item => item.blocker_reason || item.fields_blocked.length)
    .map(item => ({
      source_key: item.source_key,
      blocker_reason: item.blocker_reason || item.fields_blocked.map(field => `${field.field}:${field.reason}`).join(", "),
      quality_label: item.quality_label || "UNKNOWN"
    }));

  const pilotageDisplayCount = countPilotageSignals(dedupedRecords);
  const berthDisplayCount = countBerthSignals(dedupedRecords);
  return {
    schema_version: "1.0",
    generated_at: generatedAt,
    data_mode: dataMode,
    source_run_id: sourceQualityScore.source_run_id || report.run_id || null,
    total_vessels: number(bootstrapKpis.total_vessels || bootstrapKpis.detail_eligible_vessel_count || dedupedRecords.length),
    display_vessel_count: dedupedRecords.length,
    vessels_enriched_by_source: vesselsEnrichedBySource,
    fields_recovered_by_source: fieldsRecoveredBySource,
    pilotage_signal_count: Math.max(pilotageDisplayCount, number(bootstrapKpis.pilotage_detected_count)),
    pilotage_signal_display_count: pilotageDisplayCount,
    berth_signal_count: Math.max(berthDisplayCount, number(bootstrapKpis.berth_info_detected_count)),
    berth_signal_display_count: berthDisplayCount,
    operator_recovered_count: displayCounts.operator_display,
    imo_recovered_count: displayCounts.imo,
    mmsi_recovered_count: displayCounts.mmsi,
    dwt_recovered_count: displayCounts.dwt,
    flag_recovered_count: displayCounts.flag,
    enrichment_failures: enrichmentFailures,
    record_count: items.length,
    item_count: items.length,
    items
  };
}
