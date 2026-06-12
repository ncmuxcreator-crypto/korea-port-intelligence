const SOURCE_TYPES = {
  PILOTAGE: "PILOTAGE",
  BERTH: "BERTH",
  PNC: "PNC"
};

function hasText(value) {
  return value !== null && value !== undefined && String(value).trim() !== "" && String(value).trim() !== "-";
}

function firstValue(row = {}, keys = []) {
  for (const key of keys) {
    const value = key.split(".").reduce((acc, part) => acc && acc[part], row);
    if (hasText(value)) return String(value).trim();
  }
  return "";
}

function rowEntries(row = {}) {
  return Object.entries(row || {}).filter(([, value]) => hasText(value));
}

function inferByKey(row = {}, pattern) {
  const found = rowEntries(row).find(([key]) => pattern.test(String(key || "")));
  return found ? String(found[1]).trim() : "";
}

function inferVesselName(row = {}) {
  const byKey = inferByKey(row, /vessel|ship|vsl|vssl|선명|모선|紐|좊챸|좊컯/i);
  if (byKey) return byKey;
  const found = rowEntries(row).find(([key, value]) => {
    const text = String(value || "").trim();
    if (/^(source|source_name|source_origin)$/i.test(String(key))) return false;
    if (text.length < 3 || text.length > 60) return false;
    if (/^\d+$/.test(text)) return false;
    if (/^\d{4}-\d{2}-\d{2}/.test(text)) return false;
    return /[A-Za-z]/.test(text) && /\s/.test(text);
  });
  return found ? String(found[1]).trim() : "";
}

function inferTime(row = {}) {
  const byKey = inferByKey(row, /time|date|eta|etb|ata|atb|operation|pilot|예정|일시|시간|쇱떆|쒓컙/i);
  if (byKey && (/\d{4}[-./]\d{1,2}[-./]\d{1,2}/.test(byKey) || /^\d{1,2}:\d{2}$/.test(byKey))) return byKey;
  const found = rowEntries(row).find(([, value]) => {
    const text = String(value || "").trim();
    return /\d{4}[-./]\d{1,2}[-./]\d{1,2}\s+\d{1,2}:\d{2}/.test(text) || /^\d{1,2}:\d{2}$/.test(text);
  });
  return found ? String(found[1]).trim() : "";
}

function inferBerth(row = {}) {
  const byKey = inferByKey(row, /berth|terminal|선석|부두|좎꽍|遺/i);
  if (byKey) return byKey;
  const found = rowEntries(row).find(([, value]) => /^[A-Z]?\d{1,3}[A-Z]?$/i.test(String(value || "").trim()));
  return found ? String(found[1]).trim() : "";
}

function normalizeName(value = "") {
  return String(value || "")
    .normalize("NFKC")
    .trim()
    .toUpperCase()
    .replace(/\b(M\/V|MV|M\.V\.|S\/S|SS)\b/g, "")
    .replace(/[^A-Z0-9가-힣]+/g, "");
}

function normalizeCallSign(value = "") {
  return String(value || "")
    .normalize("NFKC")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function normalizePort(value = "") {
  const text = String(value || "").normalize("NFKC").trim().toUpperCase();
  if (!text) return "";
  if (/BUSAN|PUSAN|부산|020|PNC|PNIT|NEWPORT|신항/.test(text)) return "BUSAN";
  if (/ULSAN|울산|820/.test(text)) return "ULSAN";
  if (/INCHEON|인천|030/.test(text)) return "INCHEON";
  if (/PYEONGTAEK|DANGJIN|평택|당진|031/.test(text)) return "PYEONGTAEK_DANGJIN";
  if (/YEOSU|GWANGYANG|여수|광양|620/.test(text)) return "GWANGYANG_YEOSU";
  if (/DAESAN|대산|621/.test(text)) return "DAESAN";
  if (/POHANG|포항|810/.test(text)) return "POHANG";
  if (/GUNSAN|군산|080/.test(text)) return "GUNSAN";
  if (/MOKPO|목포|070/.test(text)) return "MOKPO";
  return text.replace(/[^A-Z0-9가-힣]+/g, "_");
}

function parseDate(value) {
  if (!hasText(value)) return null;
  const text = String(value).trim();
  if (/^\d{1,2}:\d{2}$/.test(text)) return null;
  const parsed = Date.parse(text.replace(/\./g, "-").replace(/\s+KST$/i, "+09:00"));
  return Number.isFinite(parsed) ? new Date(parsed) : null;
}

function display(record = {}) {
  return record.vessel_display && typeof record.vessel_display === "object" ? record.vessel_display : record;
}

function compactVesselDisplay(record = {}) {
  const d = display(record);
  return {
    vessel_name: d.vessel_name || record.vessel_name || "-",
    imo: d.imo || record.imo || "-",
    mmsi: d.mmsi || record.mmsi || "-",
    call_sign: d.call_sign || record.call_sign || "-",
    operator_display: d.operator_display || d.operator || record.operator_display || record.operator || "-",
    current_port: d.current_port_korean || d.current_port || record.current_port || record.port_name || record.port || "-",
    berth: d.berth || record.berth || record.berth_name || "-",
    eta: d.eta || record.eta || null,
    etb: d.etb || record.etb || null,
    ata: d.ata || record.ata || null,
    atb: d.atb || record.atb || null,
    opportunity_score: d.opportunity_score ?? record.opportunity_score ?? null,
    priority_label: d.priority_label || record.priority_label || "-"
  };
}

function sourceType(row = {}) {
  const text = [
    row.source,
    row.source_name,
    row.source_origin,
    row.pilot_source_origin,
    row.pilot_source_url,
    row.berth_data_source,
    row.pnc_source_url,
    row.secondary_enrichment_source,
    row.enrichment_source
  ].filter(Boolean).join(" ").toLowerCase();
  if (/pilot|pilotage|도선/.test(text) || row.pilot_time || row.pilot_time_text || row.pilot_station) return SOURCE_TYPES.PILOTAGE;
  if (/pnc|pnit|newport/.test(text)) return SOURCE_TYPES.PNC;
  if (/berth|terminal|선석/.test(text) || row.berth || row.berth_name || row.terminal_name) return SOURCE_TYPES.BERTH;
  return "";
}

function normalizeSourceRow(row = {}) {
  const type = sourceType(row);
  if (!type) return null;
  const raw = row.raw_payload && typeof row.raw_payload === "object" ? row.raw_payload : {};
  const rawVesselName = firstValue(row, [
    "vessel_name", "ship_name", "name", "raw_payload.vessel_name", "raw_payload.ship_name",
    "raw_payload.모선명", "raw_payload.선명"
  ]) || firstValue(raw, ["vessel_name", "ship_name", "name"]) || inferVesselName(row) || inferVesselName(raw);
  const rawCallSign = firstValue(row, [
    "call_sign", "callsign", "callSign", "clsgn", "raw_payload.call_sign", "raw_payload.callsign"
  ]);
  const rawPort = firstValue(row, [
    "port_name", "port", "current_port", "port_code", "raw_payload.port_name", "raw_payload.port"
  ]) || (/pnc_source/i.test(String(row.source || row.source_name || "")) ? "부산신항" : "");
  const rawTime = firstValue(row, [
    "pilot_timestamp", "pilot_time", "pilot_time_text", "raw_pilot_time", "movement_time",
    "etb", "atb", "eta", "ata", "operation_start", "operation_end",
    "raw_payload.pilot_time", "raw_payload.pilot_time_text", "raw_payload.etb", "raw_payload.atb"
  ]) || inferTime(row) || inferTime(raw);
  const rawBerth = firstValue(row, ["berth", "berth_name", "terminal_name", "raw_payload.berth", "raw_payload.berth_name", "raw_payload.선석"])
    || inferBerth(row)
    || inferBerth(raw);
  if (!rawVesselName && !rawCallSign && !rawPort && !rawTime && !rawBerth) return null;
  return {
    source_type: type,
    raw_vessel_name: rawVesselName || "-",
    raw_call_sign: rawCallSign || "-",
    raw_port: rawPort || "-",
    raw_time: rawTime || "-",
    raw_berth: rawBerth || "-",
    normalized_name: normalizeName(rawVesselName),
    normalized_call_sign: normalizeCallSign(rawCallSign),
    normalized_port: normalizePort(rawPort),
    parsed_time: parseDate(rawTime),
    source_key: row.source || row.source_name || row.source_origin || "",
    parse_status: row.pilot_time_parse_status || row.parse_status || ""
  };
}

function vesselPort(record = {}) {
  const d = display(record);
  return normalizePort(d.current_port_korean || d.current_port || d.raw_current_port || record.current_port || record.port_name || record.port || record.port_code);
}

function vesselTimes(record = {}) {
  const d = display(record);
  return [d.eta, d.etb, d.ata, d.atb, d.etd, d.atd, record.eta, record.etb, record.ata, record.atb, record.pilot_time, record.movement_time]
    .map(parseDate)
    .filter(Boolean);
}

function scoreCandidate(source, vessel) {
  const d = display(vessel);
  const candidateName = normalizeName(d.vessel_name || vessel.vessel_name);
  const candidateCallSign = normalizeCallSign(d.call_sign || vessel.call_sign);
  const candidatePort = vesselPort(vessel);
  const candidateBerth = normalizeName(d.berth || vessel.berth || vessel.berth_name);
  const sourceBerth = normalizeName(source.raw_berth);
  let score = 0;
  const reasons = [];
  let matchType = "weak";

  if (source.normalized_call_sign && candidateCallSign && source.normalized_call_sign === candidateCallSign) {
    score += 50;
    reasons.push("콜사인 일치");
    matchType = "call_sign";
  }
  if (source.normalized_name && candidateName && source.normalized_name === candidateName) {
    score += 34;
    reasons.push("선명 일치");
    if (matchType === "weak") matchType = "vessel_name";
  }
  if (source.normalized_port && candidatePort && source.normalized_port === candidatePort) {
    score += 16;
    reasons.push("항만 일치");
  } else if (source.normalized_port && candidatePort) {
    score -= 18;
    reasons.push("항만 불일치");
  }
  if (sourceBerth && candidateBerth && sourceBerth === candidateBerth) {
    score += 10;
    reasons.push("선석 일치");
  }
  if (source.parsed_time) {
    const diffs = vesselTimes(vessel).map(time => Math.abs(time.getTime() - source.parsed_time.getTime()) / 36e5);
    if (diffs.length) {
      const best = Math.min(...diffs);
      if (best <= 6) {
        score += 16;
        reasons.push(`시간창 ${Math.round(best * 10) / 10}시간`);
      } else if (best <= 24) {
        score += 10;
        reasons.push(`시간창 ${Math.round(best * 10) / 10}시간`);
      }
    }
  } else if (/^\d{1,2}:\d{2}$/.test(source.raw_time)) {
    score += 4;
    reasons.push("시간만 있음");
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  if (score >= 75 && /call_sign|vessel_name/.test(matchType)) matchType = `${matchType}_auto_candidate`;
  return {
    vessel_display: compactVesselDisplay(vessel),
    match_type: matchType,
    confidence: score,
    reason: reasons.join(" + ") || "일치 근거 부족"
  };
}

function blockerFor(source, matches = []) {
  const best = matches[0];
  if (!best) return "no_candidate_match";
  if (best.confidence >= 75) return "high_confidence_auto_apply_candidate";
  if (!source.normalized_call_sign && !source.normalized_name) return "missing_vessel_identity";
  if (best.reason.includes("항만 불일치")) return "port_conflict";
  if (/^\d{1,2}:\d{2}$/.test(source.raw_time)) return "time_only_missing_date";
  return "below_auto_apply_threshold";
}

function actionFor(bestConfidence, blocker) {
  if (blocker === "high_confidence_auto_apply_candidate") return "고신뢰 매칭 후보입니다. 자동 적용 여부만 확인하세요.";
  if (bestConfidence >= 60) return "검토 후 수동 매칭 또는 자동 적용 승인";
  if (bestConfidence >= 35) return "선명/콜사인/항만을 확인해 수동 매칭";
  return "원천 행의 선명/콜사인/항만 필드 보강 필요";
}

function dedupeKey(source) {
  return [
    source.source_type,
    source.normalized_call_sign,
    source.normalized_name,
    source.normalized_port,
    source.raw_time,
    source.raw_berth
  ].join("|");
}

export function buildPilotageBerthMatchReviewPayload({
  sourceRows = [],
  vessels = [],
  generatedAt = new Date().toISOString(),
  dataMode = "static_snapshot",
  report = {}
} = {}) {
  const normalizedSources = [];
  const seen = new Set();
  for (const row of sourceRows || []) {
    const normalized = normalizeSourceRow(row);
    if (!normalized) continue;
    const key = dedupeKey(normalized);
    if (seen.has(key)) continue;
    seen.add(key);
    normalizedSources.push(normalized);
  }

  const items = [];
  for (const source of normalizedSources) {
    const candidateMatches = (vessels || [])
      .map(vessel => scoreCandidate(source, vessel))
      .filter(match => match.confidence >= 20)
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 5);
    const bestConfidence = candidateMatches[0]?.confidence || 0;
    const blocker = blockerFor(source, candidateMatches);
    if (blocker === "high_confidence_auto_apply_candidate") continue;
    items.push({
      source_type: source.source_type,
      raw_vessel_name: source.raw_vessel_name,
      raw_call_sign: source.raw_call_sign,
      raw_port: source.raw_port,
      raw_time: source.raw_time,
      candidate_matches: candidateMatches,
      best_match_confidence: bestConfidence,
      blocker_reason: blocker,
      recommended_action: actionFor(bestConfidence, blocker)
    });
  }

  items.sort((a, b) => b.best_match_confidence - a.best_match_confidence || a.source_type.localeCompare(b.source_type));
  const countsBySource = items.reduce((acc, item) => {
    acc[item.source_type] = (acc[item.source_type] || 0) + 1;
    return acc;
  }, {});
  const blockerCounts = items.reduce((acc, item) => {
    acc[item.blocker_reason] = (acc[item.blocker_reason] || 0) + 1;
    return acc;
  }, {});

  return {
    schema_version: "1.0",
    generated_at: generatedAt,
    data_mode: dataMode,
    source_run_id: report.run_id || null,
    record_count: items.length,
    item_count: items.length,
    counts_by_source_type: countsBySource,
    blocker_counts: blockerCounts,
    review_policy: {
      high_confidence_auto_apply_threshold: 75,
      review_threshold: "medium_or_low_confidence",
      privacy_note: "Personal pilot names or contact details are not exposed."
    },
    items
  };
}
