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
    gt: Number(merged.gt || merged.grtg || merged.intrlGrtg || 0),
    grtg: Number(merged.grtg || 0),
    intrlGrtg: Number(merged.intrlGrtg || 0),
    gt_source: merged.gt_source || (Number(merged.grtg || 0) > 0 ? "grtg" : Number(merged.intrlGrtg || 0) > 0 ? "intrlGrtg" : Number(merged.gt || 0) > 0 ? "gt" : "unknown"),
    gt_status: merged.gt_status || (Number(merged.gt || merged.grtg || merged.intrlGrtg || 0) >= Number(merged.commercial_gt_threshold || 5000) ? "target_vessel" : Number(merged.gt || merged.grtg || merged.intrlGrtg || 0) > 0 ? "non_target_small_vessel" : "unknown_gt_review"),
    commercial_gt_threshold: Number(merged.commercial_gt_threshold || 5000),
    meets_commercial_gt_threshold: Boolean(merged.meets_commercial_gt_threshold ?? Number(merged.gt || merged.grtg || merged.intrlGrtg || 0) >= Number(merged.commercial_gt_threshold || 5000)),
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
    is_cleaning_candidate: Boolean(merged.is_cleaning_candidate ?? (Number(merged.gt || 0) >= Number(merged.commercial_gt_threshold || 5000) && candidateScore >= 60)),
    is_immediate_candidate: Boolean(merged.is_immediate_candidate ?? (Number(merged.gt || 0) >= Number(merged.commercial_gt_threshold || 5000) && candidateScore >= 80)),
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
    run_id: merged.run_id || row.run_id || "",
    master_vessel_id: merged.master_vessel_id || merged.hybrid_entity_key || merged.vessel_id,
    data_quality_tier: merged.data_quality_tier || "",
    status_bucket: merged.status_bucket || deriveStatusBucket(merged),
    commercial_relevance_status: merged.commercial_relevance_status || deriveCommercialRelevance(merged),
    candidate_band: merged.candidate_band || merged.sales_priority_band || "low_priority",
    updated_at: merged.updated_at || merged.collected_at || row.collected_at || new Date().toISOString()
  };
}

function deriveStatusBucket(v = {}) {
  const status = String(v.status || "").toLowerCase();
  const now = Date.now();
  const parse = value => {
    const date = value ? new Date(String(value).replace(" ", "T")) : null;
    return date && !Number.isNaN(date.getTime()) ? date.getTime() : null;
  };
  const eta = parse(v.eta);
  const ata = parse(v.ata);
  const etd = parse(v.etd);
  const atd = parse(v.atd);
  if (atd && atd < now && !/waiting|anchorage|anchor|berth|moored|alongside|idle/.test(status)) return "completed_departure";
  if (ata && !atd) return "staying_vessels";
  if (/waiting|anchorage|anchor|idle|drifting/.test(status) || Number(v.anchorage_hours || 0) > 0) return "staying_vessels";
  if (/berth|moored|alongside/.test(status) || v.berth || v.berth_name || v.atb) return "staying_vessels";
  if (eta && eta >= now) return "arrival_pipeline";
  if (etd && etd >= now) return "staying_vessels";
  return "port_call_review";
}

function deriveCommercialRelevance(v = {}) {
  const typeText = `${v.vessel_type || ""} ${v.vessel_name || ""}`.toLowerCase();
  if (/fishing|fishery|trawler|tug|pilot|patrol|government|navy|coast guard|workboat|barge|dredger|어선|예선|관공선|작업선|준설|순찰|해경/.test(typeText)) return "excluded_non_commercial_type";
  if ((v.status_bucket || deriveStatusBucket(v)) === "completed_departure") return "excluded_departure_only";
  const gt = Number(v.gt || v.grtg || v.intrlGrtg || 0);
  if ((v.gt_status || "") === "target_vessel" || gt >= Number(v.commercial_gt_threshold || 5000)) return "target_vessel";
  if ((v.gt_status || "") === "unknown_gt_review" || gt <= 0) return "unknown_gt_review";
  return "non_target_small_vessel";
}

function isMainCommercialVessel(v = {}) {
  return ["target_vessel", "unknown_gt_review"].includes(v.commercial_relevance_status || deriveCommercialRelevance(v));
}

function supabaseBase(env) {
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_ANON_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return { url: url.replace(/\/$/, ""), key };
}

async function supabaseGet(env, path) {
  const base = supabaseBase(env);
  if (!base) {
    return { ok: false, status: 0, rows: [], error: "missing_supabase_binding" };
  }
  const res = await fetch(`${base.url}${path}`, {
    headers: { apikey: base.key, authorization: `Bearer ${base.key}`, accept: "application/json" }
  });
  if (!res.ok) {
    let detail = "";
    try {
      detail = await res.text();
    } catch {
      detail = "";
    }
    return { ok: false, status: res.status, rows: [], error: `supabase_http_${res.status}`, detail: detail.slice(0, 240) };
  }
  const rows = await res.json();
  return { ok: true, status: res.status, rows: Array.isArray(rows) ? rows : [], error: null };
}

async function fetchActivePointer(env) {
  if (!supabaseBase(env)) return { configured: false, active_run_id: null, error: "missing_supabase_binding" };

  const diagnostics = [];
  const active = await supabaseGet(env, "/rest/v1/active_dataset_pointer?select=*&id=eq.current&limit=1");
  diagnostics.push({ source: "active_dataset_pointer", ok: active.ok, status: active.status, row_count: active.rows.length, error: active.error });
  const pointer = active.rows[0] || null;
  if (pointer?.active_run_id) {
    return { configured: true, ...pointer, pointer_source: "active_dataset_pointer", pointer_diagnostics: diagnostics, error: null };
  }

  const promoted = await supabaseGet(env, "/rest/v1/data_collection_runs?select=run_id,promoted_at,finished_at,status,total_rows,all_vessels_count,candidates_count,immediate_targets_count&status=eq.promoted&order=promoted_at.desc.nullslast&order=finished_at.desc.nullslast&limit=1");
  diagnostics.push({ source: "latest_promoted_run", ok: promoted.ok, status: promoted.status, row_count: promoted.rows.length, error: promoted.error });
  const run = promoted.rows[0] || null;
  if (run?.run_id) {
    return {
      configured: true,
      active_run_id: run.run_id,
      active_collected_at: run.finished_at || null,
      promoted_at: run.promoted_at || null,
      is_stale: false,
      pointer_source: "latest_promoted_run",
      pointer_diagnostics: diagnostics,
      fallback_pointer: true,
      error: null
    };
  }

  const latestRun = await supabaseGet(env, "/rest/v1/vessel_snapshots?select=run_id,collected_at&run_id=not.is.null&order=collected_at.desc&limit=1");
  diagnostics.push({ source: "latest_snapshot_run", ok: latestRun.ok, status: latestRun.status, row_count: latestRun.rows.length, error: latestRun.error });
  const snapshotRun = latestRun.rows[0] || null;
  if (snapshotRun?.run_id) {
    return {
      configured: true,
      active_run_id: snapshotRun.run_id,
      active_collected_at: snapshotRun.collected_at || null,
      promoted_at: null,
      is_stale: true,
      pointer_source: "latest_snapshot_run",
      pointer_diagnostics: diagnostics,
      fallback_pointer: true,
      error: null
    };
  }

  const legacy = await supabaseGet(env, "/rest/v1/vessel_snapshots?select=collected_at&order=collected_at.desc&limit=1");
  diagnostics.push({ source: "legacy_latest_snapshots", ok: legacy.ok, status: legacy.status, row_count: legacy.rows.length, error: legacy.error });
  if (legacy.rows.length) {
    return {
      configured: true,
      active_run_id: null,
      active_collected_at: legacy.rows[0]?.collected_at || null,
      promoted_at: null,
      is_stale: true,
      legacy_latest: true,
      pointer_source: "legacy_latest_snapshots",
      pointer_diagnostics: diagnostics,
      fallback_pointer: true,
      error: null
    };
  }

  return {
    configured: true,
    active_run_id: null,
    error: active.error || promoted.error || latestRun.error || legacy.error || "missing_active_dataset",
    pointer_source: "none",
    pointer_diagnostics: diagnostics
  };
}

async function fetchSupabaseRows(env) {
  if (!supabaseBase(env)) return { rows: [], configured: false, error: "missing_supabase_binding" };
  const pointer = await fetchActivePointer(env);
  if (!pointer.active_run_id && !pointer.legacy_latest) return { rows: [], configured: pointer.configured, error: pointer.error || "missing_active_dataset", pointer };

  const query = pointer.legacy_latest
    ? "/rest/v1/vessel_snapshots?select=*&order=collected_at.desc&limit=5000"
    : `/rest/v1/vessel_snapshots?select=*&run_id=eq.${encodeURIComponent(pointer.active_run_id)}&order=collected_at.desc&limit=5000`;
  const response = await supabaseGet(env, query);
  if (!response.ok) return { rows: [], configured: true, error: response.error, pointer };
  return { rows: response.rows.map(normalizeSnapshot), configured: true, error: null, pointer };
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
    .filter(v => v.actionable_source_row !== false && isMainCommercialVessel(v) && (v.is_cleaning_candidate || v.status_bucket === "staying_vessels" || v.status_bucket === "arrival_pipeline" || (v.biofouling_score || 0) >= 65 || (v.operational_risk_score || 0) >= 60))
    .slice(0, 40);
}

function buildPortHeatmap(records) {
  const map = new Map();
  for (const v of records) {
    const port = v.port || "Korea";
    const p = map.get(port) || { port, port_code: v.port_code || portCodeFromName(port), total: 0, waiting: 0, anchorage_vessels: 0, long_stay: 0, long_idle_vessels: 0, high_biofouling: 0, immediate: 0, score: 0, waiting_hours_total: 0, berth_hours_total: 0 };
    p.total += 1;
    if (v.is_anchorage_waiting || (v.anchorage_hours || 0) >= 12 || /waiting|anchorage|anchor|idle|drifting/i.test(v.status || "")) {
      p.waiting += 1;
      p.anchorage_vessels += 1;
    }
    if (v.is_long_idle || (v.stay_hours || 0) >= 168) {
      p.long_stay += 1;
      p.long_idle_vessels += 1;
    }
    if ((v.biofouling_score || 0) >= 70) p.high_biofouling += 1;
    if (v.is_immediate_candidate) p.immediate += 1;
    p.waiting_hours_total += Number(v.anchorage_hours || 0);
    p.berth_hours_total += Number(v.berth_hours || 0);
    p.score += v.port_congestion_score || v.operational_risk_score || v.biofouling_score || 0;
    map.set(port, p);
  }
  return [...map.values()].map(p => ({
    ...p,
    average_waiting_time: p.waiting ? Math.round((p.waiting_hours_total / p.waiting) * 10) / 10 : 0,
    berth_occupancy: p.total ? Math.min(100, Math.round((p.berth_hours_total / Math.max(1, p.total * 24)) * 100)) : 0,
    anchorage_density: p.total ? Math.min(100, Math.round((p.anchorage_vessels / p.total) * 100)) : 0,
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

function buildUnknownImo(records) {
  return sortCommercialPriority(records.filter(v => !v.imo || v.imo_status !== "present"))
    .map(v => ({
      vessel_name: v.vessel_name,
      port_code: v.port_code || portCodeFromName(v.port),
      port_name: v.port_name || v.port,
      call_sign: v.call_sign || "",
      mmsi: v.mmsi || "",
      gt: v.gt || 0,
      hybrid_entity_key: v.hybrid_entity_key,
      master_vessel_id: v.master_vessel_id || v.hybrid_entity_key,
      confidence_band: (v.total_sales_priority_score || 0) >= 80 ? "high_priority_review" : (v.gt || 0) >= 5000 ? "probable" : "unresolved",
      score: v.total_sales_priority_score || 0
    }));
}

function portCodeFromName(port = "") {
  const text = String(port || "").toLowerCase();
  if (/busan|부산/.test(text)) return "020";
  if (/incheon|인천/.test(text)) return "030";
  if (/yeosu|gwangyang|여수|광양/.test(text)) return "620";
  if (/ulsan|울산/.test(text)) return "820";
  if (/pyeongtaek|dangjin|평택|당진/.test(text)) return "031";
  if (/pohang|포항/.test(text)) return "810";
  if (/mokpo|목포/.test(text)) return "070";
  if (/gunsan|군산/.test(text)) return "080";
  if (/daesan|대산/.test(text)) return "621";
  if (/donghae|mukho|동해|묵호/.test(text)) return "120";
  if (/jeju|제주/.test(text)) return "940";
  if (/masan|jinhae|samcheonpo|hadong|tongyeong|geoje|okpo|마산|진해|삼천포|하동|통영|거제|옥포/.test(text)) return "622";
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

function buildVisibilityBuckets(records) {
  const targetVessels = records.filter(isMainCommercialVessel);
  return {
    target_vessels: targetVessels,
    staying_vessels: targetVessels.filter(v => v.status_bucket === "staying_vessels"),
    arrival_pipeline: targetVessels.filter(v => v.status_bucket === "arrival_pipeline"),
    sales_candidates: targetVessels.filter(v => v.commercial_relevance_status === "target_vessel" && (v.is_cleaning_candidate || (v.total_sales_priority_score || 0) >= 60)),
    immediate_targets: targetVessels.filter(v => v.commercial_relevance_status === "target_vessel" && (v.is_immediate_candidate || (v.total_sales_priority_score || 0) >= 80))
  };
}


function buildPortCongestion(records, portCode) {
  return buildPortHeatmap(records).find(p => String(p.port_code || portCodeFromName(p.port)) === String(portCode)) || {
    port_code: portCode,
    total: 0,
    anchorage_vessels: 0,
    long_idle_vessels: 0,
    average_waiting_time: 0,
    berth_occupancy: 0,
    anchorage_density: 0,
    congestion_score: 0
  };
}

function buildAnchorage(records) {
  return sortCommercialPriority(records.filter(v => v.is_anchorage_waiting || (v.anchorage_hours || 0) > 0 || /waiting|anchorage|anchor|idle|drifting/i.test(v.status || "")))
    .map(v => ({
      vessel_id: v.vessel_id,
      vessel_name: v.vessel_name,
      port_code: v.port_code || portCodeFromName(v.port),
      port_name: v.port_name || v.port,
      anchorage_name: v.anchorage_name || v.anchorage_zone || "",
      anchorage_hours: v.anchorage_hours || 0,
      anchorage_days: v.anchorage_days || 0,
      anchorage_density_score: v.anchorage_density_score || 0,
      idle_risk_score: v.idle_risk_score || 0,
      total_sales_priority_score: v.total_sales_priority_score || 0,
      reason_codes: v.reason_codes || []
    }));
}
function buildStatus(records, source) {
  const buckets = buildVisibilityBuckets(records);
  const high = records.filter(v => (v.risk_score || 0) >= 70);
  const dataMode = buckets.target_vessels.length ? "supabase_live_snapshot" : "no_live_data";
  return {
    version: "worker-live-api-v1",
    status: source.error && !records.length ? "degraded" : "success",
    data_mode: dataMode,
    commercial_use_status: records.length ? "review_required" : "not_ready",
    completed_at: new Date().toISOString(),
    record_count: buckets.target_vessels.length,
    all_collected_vessel_count: records.length,
    target_vessel_count: buckets.target_vessels.length,
    staying_vessel_count: buckets.staying_vessels.length,
    arrival_pipeline_count: buckets.arrival_pipeline.length,
    unknown_gt_review_count: buckets.target_vessels.filter(v => v.gt_status === "unknown_gt_review").length,
    non_target_small_vessel_count: records.filter(v => v.gt_status === "non_target_small_vessel").length,
    actionable_rows: buckets.target_vessels.filter(v => v.actionable_source_row !== false).length,
    hot_vessel_count: buildHot(buckets.target_vessels).length,
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
      row_count: records.length,
      active_run_id: source.pointer?.active_run_id || null,
      active_collected_at: source.pointer?.active_collected_at || null,
      promoted_at: source.pointer?.promoted_at || null,
      is_stale: Boolean(source.pointer?.is_stale),
      pointer_source: source.pointer?.pointer_source || "none",
      fallback_pointer: Boolean(source.pointer?.fallback_pointer),
      pointer_diagnostics: source.pointer?.pointer_diagnostics || [],
      stale_warning: source.pointer?.fallback_pointer
        ? "Active dataset pointer is missing or empty; showing latest available Supabase snapshot run."
        : null
    },
    visibility_goal: "commercially_relevant_vessels_not_raw_count",
    target_definition: {
      commercial_gt_threshold: 5000,
      include: ["grtg >= 5000", "intrlGrtg >= 5000", "unknown GT requiring review"],
      exclude_from_main_view: ["GT under 5000", "non-commercial vessel types", "completed departure-only rows"]
    },
    commercial_command_center: buildCommandCenter(buckets.target_vessels),
    port_intelligence: buildPorts(buckets.target_vessels),
    port_congestion_heatmap: buildPortHeatmap(buckets.target_vessels),
    biofouling_timeline: buildBioTimeline(buckets.target_vessels)
  };
}

async function apiResponse(pathname, env) {
  const source = await fetchSupabaseRows(env);
  const allRecords = latestPerVesselPort(source.rows);
  const buckets = buildVisibilityBuckets(allRecords);
  const records = buckets.target_vessels;
  if (pathname.endsWith("/status.json")) return json(buildStatus(allRecords, source), { headers: corsHeaders() });
  if (pathname.endsWith("/all-collected-vessels.json")) return json(allRecords, { headers: corsHeaders() });
  if (pathname.endsWith("/target-vessels.json")) return json(buckets.target_vessels, { headers: corsHeaders() });
  if (pathname.endsWith("/staying-vessels.json")) return json(buckets.staying_vessels, { headers: corsHeaders() });
  if (pathname.endsWith("/arrival-pipeline.json")) return json(buckets.arrival_pipeline, { headers: corsHeaders() });
  if (pathname.endsWith("/vessels.json")) return json(records, { headers: corsHeaders() });
  if (pathname.endsWith("/candidates.json")) return json(buildHot(records).filter(v => v.commercial_relevance_status === "target_vessel" && (v.is_cleaning_candidate || (v.total_sales_priority_score || 0) >= 60)), { headers: corsHeaders() });
  if (pathname.endsWith("/hot-candidates.json")) return json(buildHot(records).filter(v => v.commercial_relevance_status === "target_vessel"), { headers: corsHeaders() });
  if (pathname.endsWith("/master/unknown-imo.json")) return json(buildUnknownImo(records), { headers: corsHeaders() });
  if (pathname.endsWith("/ports.json")) return json(buildPorts(records), { headers: corsHeaders() });
  const portMatch = pathname.match(new RegExp("^/api/ports/([^/]+)/(vessels|candidates|berths|congestion|anchorage)\\.json$"));
  if (portMatch) {
    const rows = recordsForPort(records, decodeURIComponent(portMatch[1]));
    if (portMatch[2] === "vessels") return json(rows, { headers: corsHeaders() });
    if (portMatch[2] === "candidates") return json(buildHot(rows).filter(v => v.commercial_relevance_status === "target_vessel"), { headers: corsHeaders() });
    if (portMatch[2] === "congestion") return json(buildPortCongestion(records, decodeURIComponent(portMatch[1])), { headers: corsHeaders() });
    if (portMatch[2] === "anchorage") return json(buildAnchorage(rows), { headers: corsHeaders() });
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

