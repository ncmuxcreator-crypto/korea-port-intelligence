const API_CACHE_SECONDS = 300;

function json(data, init = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": `public, max-age=${API_CACHE_SECONDS}`,
      ...(init.headers || {})
    }
  });
}

function corsHeaders() {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, OPTIONS",
    "access-control-allow-headers": "content-type"
  };
}

function scoreLevel(score = 0) {
  if (score >= 85) return "Critical";
  if (score >= 70) return "High";
  if (score >= 45) return "Medium";
  return "Low";
}

function sortCommercialPriority(records) {
  return records.slice().sort((a, b) =>
    Number(b.is_immediate_candidate) - Number(a.is_immediate_candidate) ||
    (b.total_sales_priority_score || b.cleaning_candidate_score || b.risk_score || 0) - (a.total_sales_priority_score || a.cleaning_candidate_score || a.risk_score || 0) ||
    (b.biofouling_score || 0) - (a.biofouling_score || 0)
  );
}

function normalizeSnapshot(row = {}) {
  const payload = row.payload || row.raw_payload || {};
  const merged = { ...row, ...payload };
  const riskScore = Number(merged.risk_score || merged.biofouling_score || 0);
  const candidateScore = Number(merged.cleaning_candidate_score || merged.total_sales_priority_score || riskScore);
  const sourceMode = merged.source_mode || "supabase_snapshot";
  return {
    vessel_id: merged.vessel_id,
    vessel_name: merged.vessel_name,
    imo: merged.imo || "",
    mmsi: merged.mmsi || "",
    call_sign: merged.call_sign || merged.callsign || "",
    port: merged.port || "Korea",
    berth: merged.berth || "",
    anchorage_zone: merged.anchorage_zone || "",
    status: merged.status || "Observed",
    operator: merged.operator || "",
    destination: merged.destination || "",
    previous_port: merged.previous_port || "",
    next_port: merged.next_port || "",
    vessel_type: merged.vessel_type || "",
    gt: Number(merged.gt || 0),
    eta: merged.eta || "",
    etb: merged.etb || "",
    ata: merged.ata || "",
    atb: merged.atb || "",
    etd: merged.etd || "",
    atd: merged.atd || "",
    stay_hours: Number(merged.stay_hours || 0),
    berth_hours: Number(merged.berth_hours || 0),
    anchorage_hours: Number(merged.anchorage_hours || 0),
    work_window_hours: Number(merged.work_window_hours || 0),
    risk_score: riskScore,
    risk_level: merged.risk_level || scoreLevel(riskScore),
    biofouling_score: Number(merged.biofouling_score || riskScore),
    cii_pressure_score: Number(merged.cii_pressure_score || 0),
    total_sales_priority_score: Number(merged.total_sales_priority_score || candidateScore),
    cleaning_candidate_score: candidateScore,
    is_cleaning_candidate: Boolean(merged.is_cleaning_candidate ?? candidateScore >= 45),
    is_immediate_candidate: Boolean(merged.is_immediate_candidate ?? candidateScore >= 82),
    reason_codes: merged.reason_codes || merged.sales_reason || [],
    sales_reason: merged.sales_reason || merged.reason_codes || [],
    hybrid_entity_key: merged.hybrid_entity_key || merged.vessel_id,
    identification_method: merged.identification_method || (merged.imo ? "IMO" : merged.mmsi ? "MMSI" : "NAME_PORT_FALLBACK"),
    imo_status: merged.imo_status || (merged.imo ? "present" : "missing_low_confidence"),
    compliance_band: merged.compliance_band || (merged.compliance_watch ? "biosecurity_watch" : "standard"),
    compliance_watch: Boolean(merged.compliance_watch),
    gt_group: merged.gt_group || "gt_unknown",
    stay_days_group: merged.stay_days_group || "stay_under_3d",
    operational_risk_flags: merged.operational_risk_flags || [],
    operational_risk_score: Number(merged.operational_risk_score || riskScore),
    operator_fleet_badges: merged.operator_fleet_badges || [],
    actionable_source_row: Boolean(merged.actionable_source_row ?? merged.sales_ready_input ?? true),
    sales_ready_input: Boolean(merged.sales_ready_input ?? merged.actionable_source_row ?? true),
    opportunity_usd: Number(merged.opportunity_usd || 0),
    source: merged.source || "supabase",
    source_mode: sourceMode,
    updated_at: merged.updated_at || merged.collected_at || row.collected_at || new Date().toISOString()
  };
}

async function fetchSupabaseRows(env) {
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_ANON_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return { rows: [], configured: false, error: "missing_supabase_binding" };

  const endpoint = `${url.replace(/\/$/, "")}/rest/v1/vessel_snapshots?select=*&order=collected_at.desc&limit=1000`;
  const res = await fetch(endpoint, {
    headers: {
      apikey: key,
      authorization: `Bearer ${key}`,
      accept: "application/json"
    }
  });
  if (!res.ok) return { rows: [], configured: true, error: `supabase_http_${res.status}` };
  const rows = await res.json();
  return { rows: Array.isArray(rows) ? rows.map(normalizeSnapshot) : [], configured: true, error: null };
}

function latestPerVesselPort(records) {
  const byKey = new Map();
  for (const record of records) {
    const key = `${record.vessel_id || record.vessel_name}|${record.port}`.toUpperCase();
    const old = byKey.get(key);
    if (!old || String(record.updated_at || "") > String(old.updated_at || "")) byKey.set(key, record);
  }
  return [...byKey.values()];
}

function buildHot(records) {
  return sortCommercialPriority(records)
    .filter(v => v.actionable_source_row !== false && (v.is_cleaning_candidate || (v.biofouling_score || 0) >= 65 || (v.operational_risk_score || 0) >= 60))
    .slice(0, 40);
}

function buildPortHeatmap(records) {
  const map = new Map();
  for (const v of records) {
    const port = v.port || "Korea";
    const p = map.get(port) || { port, total: 0, waiting: 0, long_stay: 0, high_biofouling: 0, immediate: 0, score: 0 };
    p.total += 1;
    if ((v.anchorage_hours || 0) >= 12 || /waiting|anchorage|anchor|idle|drifting/i.test(v.status || "")) p.waiting += 1;
    if ((v.stay_hours || 0) >= 168) p.long_stay += 1;
    if ((v.biofouling_score || 0) >= 70) p.high_biofouling += 1;
    if (v.is_immediate_candidate) p.immediate += 1;
    p.score += v.operational_risk_score || v.biofouling_score || 0;
    map.set(port, p);
  }
  return [...map.values()].map(p => ({
    ...p,
    congestion_score: p.total ? Math.min(100, Math.round(p.score / p.total + p.waiting * 4 + p.long_stay * 5 + p.immediate * 8)) : 0
  })).sort((a, b) => b.congestion_score - a.congestion_score);
}

function buildBioTimeline(records) {
  const buckets = [
    { key: "0_3d", label: "0-3 days", min: 0, max: 72 },
    { key: "3_7d", label: "3-7 days", min: 72, max: 168 },
    { key: "7_14d", label: "7-14 days", min: 168, max: 336 },
    { key: "14_21d", label: "14-21 days", min: 336, max: 504 },
    { key: "21d_plus", label: "21+ days", min: 504, max: Infinity }
  ];
  return buckets.map(bucket => {
    const rows = records.filter(v => (v.stay_hours || 0) >= bucket.min && (v.stay_hours || 0) < bucket.max);
    return {
      ...bucket,
      count: rows.length,
      high_biofouling: rows.filter(v => (v.biofouling_score || 0) >= 70).length,
      immediate: rows.filter(v => v.is_immediate_candidate).length,
      avg_biofouling_score: rows.length ? Math.round(rows.reduce((sum, v) => sum + (v.biofouling_score || 0), 0) / rows.length) : 0
    };
  });
}

function buildCommandCenter(records) {
  const hot = buildHot(records);
  return {
    generated_at: new Date().toISOString(),
    focus_question: "Which vessel should HullWiper Korea contact now, and why?",
    hot_count: hot.length,
    full_count: records.length,
    immediate_targets: hot.filter(v => v.is_immediate_candidate).slice(0, 8),
    operational_risk_queue: sortCommercialPriority(records)
      .filter(v => (v.operational_risk_flags || []).length || (v.operational_risk_score || 0) >= 60)
      .slice(0, 12),
    imo_recovery_board: records
      .filter(v => v.imo_status && v.imo_status !== "present")
      .sort((a, b) => (b.total_sales_priority_score || 0) - (a.total_sales_priority_score || 0))
      .slice(0, 12)
      .map(v => ({
        vessel_name: v.vessel_name,
        port: v.port,
        gt: v.gt,
        call_sign: v.call_sign || null,
        hybrid_entity_key: v.hybrid_entity_key,
        identification_method: v.identification_method,
        imo_status: v.imo_status,
        priority: v.imo_recovery_priority || "review",
        score: v.total_sales_priority_score
      })),
    operating_rule: "Worker reads Supabase snapshots at request time; GitHub main is no longer mutated by generated JSON commits."
  };
}

function portCodeFromName(port = "") {
  const text = String(port || "").toLowerCase();
  if (/busan|부산/.test(text)) return "020";
  if (/incheon|인천/.test(text)) return "030";
  if (/yeosu|gwangyang|여수|광양/.test(text)) return "620";
  if (/ulsan|울산/.test(text)) return "820";
  if (/pyeongtaek|dangjin|평택|당진/.test(text)) return "031";
  if (/pohang|포항/.test(text)) return "810";
  if (/masan|jinhae|samcheonpo|hadong|마산|진해|삼천포|하동/.test(text)) return "622";
  return "unknown";
}

function buildPorts(records) {
  const map = new Map();
  for (const v of records) {
    const portName = v.port || "Unknown";
    const portCode = v.port_code || portCodeFromName(portName);
    const key = portCode !== "unknown" ? portCode : portName;
    const p = map.get(key) || { port_code: portCode, port_name: portName, vessel_count: 0, scored_count: 0, candidate_count: 0, immediate_target_count: 0 };
    p.vessel_count += 1;
    if (typeof v.total_sales_priority_score === "number") p.scored_count += 1;
    if (v.is_cleaning_candidate || (v.total_sales_priority_score || 0) >= 60) p.candidate_count += 1;
    if (v.is_immediate_candidate || (v.total_sales_priority_score || 0) >= 80) p.immediate_target_count += 1;
    map.set(key, p);
  }
  return [...map.values()].sort((a, b) => b.immediate_target_count - a.immediate_target_count || b.candidate_count - a.candidate_count || b.vessel_count - a.vessel_count);
}

function recordsForPort(records, portCode) {
  return records.filter(v => String(v.port_code || portCodeFromName(v.port)) === String(portCode));
}

function buildStatus(records, source) {
  const high = records.filter(v => (v.risk_score || 0) >= 70);
  const dataMode = records.length ? "supabase_live_snapshot" : "no_live_data";
  return {
    version: "worker-live-api-v1",
    status: source.error && !records.length ? "degraded" : "success",
    data_mode: dataMode,
    commercial_use_status: records.length ? "review_required" : "not_ready",
    completed_at: new Date().toISOString(),
    record_count: records.length,
    actionable_rows: records.filter(v => v.actionable_source_row !== false).length,
    hot_vessel_count: buildHot(records).length,
    critical_count: records.filter(v => (v.risk_score || 0) >= 85).length,
    high_risk_count: high.length,
    cleaning_candidate_count: records.filter(v => v.is_cleaning_candidate).length,
    immediate_candidate_count: records.filter(v => v.is_immediate_candidate).length,
    opportunity_usd: records.reduce((sum, v) => sum + (v.opportunity_usd || 0), 0),
    frontend_poll_interval_seconds: 900,
    source_runtime: {
      provider: "supabase",
      configured: source.configured,
      error: source.error,
      row_count: records.length
    },
    commercial_command_center: buildCommandCenter(records),
    port_intelligence: buildPorts(records),
    port_congestion_heatmap: buildPortHeatmap(records),
    biofouling_timeline: buildBioTimeline(records)
  };
}

async function apiResponse(pathname, env) {
  const source = await fetchSupabaseRows(env);
  const records = latestPerVesselPort(source.rows);
  if (pathname.endsWith("/status.json")) return json(buildStatus(records, source), { headers: corsHeaders() });
  if (pathname.endsWith("/vessels.json")) return json(records, { headers: corsHeaders() });
  if (pathname.endsWith("/candidates.json")) return json(buildHot(records).filter(v => v.is_cleaning_candidate || (v.total_sales_priority_score || 0) >= 60), { headers: corsHeaders() });
  if (pathname.endsWith("/hot-candidates.json")) return json(buildHot(records), { headers: corsHeaders() });
  if (pathname.endsWith("/ports.json")) return json(buildPorts(records), { headers: corsHeaders() });
  const portMatch = pathname.match(/\/api\/ports\/([^/]+)\/(vessels|candidates|berths)\.json$/);
  if (portMatch) {
    const rows = recordsForPort(records, decodeURIComponent(portMatch[1]));
    if (portMatch[2] === "vessels") return json(rows, { headers: corsHeaders() });
    if (portMatch[2] === "candidates") return json(buildHot(rows), { headers: corsHeaders() });
    return json(rows.filter(v => v.berth).map(v => ({ berth_name: v.berth, vessel_name: v.vessel_name, status: v.status, eta: v.eta, etd: v.etd })), { headers: corsHeaders() });
  }
  if (pathname.endsWith("/hot-vessels.json")) return json(buildHot(records), { headers: corsHeaders() });
  if (pathname.endsWith("/commercial-command-center.json")) return json(buildCommandCenter(records), { headers: corsHeaders() });
  if (pathname.endsWith("/port-congestion-heatmap.json")) return json(buildPortHeatmap(records), { headers: corsHeaders() });
  if (pathname.endsWith("/biofouling-timeline.json")) return json(buildBioTimeline(records), { headers: corsHeaders() });
  return null;
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders() });
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      const response = await apiResponse(url.pathname, env);
      if (response) return response;
    }
    return env.ASSETS.fetch(request);
  }
};
