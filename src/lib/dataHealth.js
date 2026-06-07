function hasValue(value) {
  return value !== undefined && value !== null && String(value).trim() !== "" && String(value).trim() !== "-";
}

function firstNonEmpty(...values) {
  return values.find(value => hasValue(value)) ?? "";
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function vesselDedupeKey(record = {}) {
  const imo = firstNonEmpty(record.imo, record.imo_no, record.vessel_display?.imo);
  if (imo) return `IMO:${String(imo).toUpperCase().trim()}`;
  const mmsi = firstNonEmpty(record.mmsi, record.vessel_display?.mmsi);
  if (mmsi) return `MMSI:${String(mmsi).toUpperCase().trim()}`;
  const vesselName = firstNonEmpty(record.vessel_name, record.name, record.ship_name, record.vessel_display?.vessel_name, "UNKNOWN");
  const portCode = firstNonEmpty(record.port_code, record.portCode, record.port_name, record.port, record.vessel_display?.current_port, "UNKNOWN");
  return `NAME_PORT:${String(vesselName).normalize("NFKC").toUpperCase().replace(/\s+/g, " ").trim()}|${String(portCode).toUpperCase().trim()}`;
}

function invalidDateFields(record = {}) {
  const fields = ["eta", "etb", "ata", "atb", "etd", "atd", "updated_at", "last_seen_at"];
  return fields.filter(field => {
    const value = record[field];
    if (!hasValue(value)) return false;
    const parsed = Date.parse(String(value).replace(" ", "T"));
    return Number.isNaN(parsed);
  });
}

function invalidLatLon(record = {}) {
  const lat = finiteNumber(firstNonEmpty(record.lat, record.latitude, record.y));
  const lon = finiteNumber(firstNonEmpty(record.lon, record.lng, record.longitude, record.x));
  if (lat === null && lon === null) return false;
  return lat === null || lon === null || lat < -90 || lat > 90 || lon < -180 || lon > 180;
}

function scoreIsNan(record = {}) {
  const fields = [
    "biofoulingRiskScore",
    "hullGrowthIndex",
    "cleaningOpportunityScore",
    "biofouling_risk_score",
    "hull_growth_index",
    "cleaning_opportunity_score",
    "opportunity_score",
    "risk_score"
  ];
  return fields.some(field => record[field] !== undefined && record[field] !== null && String(record[field]).trim() !== "" && !Number.isFinite(Number(record[field])));
}

export function validateVesselRecords(records = []) {
  const issues = [];
  const duplicateKeys = new Map();
  let missingIdentityCount = 0;
  let missingPortCodeCount = 0;
  let invalidDateCount = 0;
  let invalidLatLonCount = 0;
  let abnormalAnchorageCount = 0;
  let scoreNanCount = 0;

  for (const [index, record] of (records || []).entries()) {
    const key = vesselDedupeKey(record);
    duplicateKeys.set(key, (duplicateKeys.get(key) || 0) + 1);
    const missingImo = !hasValue(record.imo || record.imo_no || record.vessel_display?.imo);
    const missingMmsi = !hasValue(record.mmsi || record.vessel_display?.mmsi);
    if (missingImo && missingMmsi) {
      missingIdentityCount += 1;
      issues.push({ severity: "WARNING", type: "MISSING_IMO_MMSI", index, vessel_key: key });
    }
    if (!hasValue(record.port_code || record.portCode || record.port_name || record.port || record.vessel_display?.current_port)) {
      missingPortCodeCount += 1;
      issues.push({ severity: "WARNING", type: "MISSING_PORT_CODE", index, vessel_key: key });
    }
    const badDates = invalidDateFields(record);
    if (badDates.length) {
      invalidDateCount += 1;
      issues.push({ severity: "WARNING", type: "DATE_PARSE_FAILED", index, vessel_key: key, fields: badDates });
    }
    if (invalidLatLon(record)) {
      invalidLatLonCount += 1;
      issues.push({ severity: "WARNING", type: "LAT_LON_RANGE", index, vessel_key: key });
    }
    const anchorageHours = finiteNumber(firstNonEmpty(record.anchorageHours, record.anchorage_hours));
    if (anchorageHours !== null && (anchorageHours < 0 || anchorageHours > 8760)) {
      abnormalAnchorageCount += 1;
      issues.push({ severity: "WARNING", type: "ABNORMAL_ANCHORAGE_HOURS", index, vessel_key: key, value: anchorageHours });
    }
    if (scoreIsNan(record)) {
      scoreNanCount += 1;
      issues.push({ severity: "CRITICAL", type: "SCORE_NAN", index, vessel_key: key });
    }
  }

  const duplicateGroups = [...duplicateKeys.entries()]
    .filter(([, count]) => count > 1)
    .map(([key, count]) => ({ key, count }));

  return {
    status: issues.some(issue => issue.severity === "CRITICAL") ? "warning" : "ok",
    total_rows: records.length,
    issue_count: issues.length,
    missing_imo_mmsi_count: missingIdentityCount,
    missing_port_code_count: missingPortCodeCount,
    date_parse_failed_count: invalidDateCount,
    lat_lon_range_error_count: invalidLatLonCount,
    abnormal_anchorage_hours_count: abnormalAnchorageCount,
    score_nan_count: scoreNanCount,
    duplicate_vessel_key_count: duplicateGroups.length,
    duplicate_groups: duplicateGroups.slice(0, 20),
    issues: issues.slice(0, 100)
  };
}
