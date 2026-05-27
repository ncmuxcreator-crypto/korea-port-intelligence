import { createClient } from "@supabase/supabase-js";
import ws from "ws";
import { randomUUID } from "node:crypto";

export function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }

  return createClient(url, key, {
    realtime: {
      transport: ws
    }
  });
}

export function createRunId() {
  return `run_${new Date().toISOString().replace(/[-:.TZ]/g, "")}_${randomUUID().slice(0, 8)}`;
}

function shouldPromoteRun(records = [], diagnostics = {}) {
  const attempted = Number(diagnostics.attempted_count || 0);
  const portOperationSuccess = (diagnostics.sources || []).filter(source =>
    String(source.key || "").startsWith("port_operation_") && source.success && Number(source.normalized_count || 0) > 0
  ).length;
  const parseFailures = Number(diagnostics.failed_count || 0);
  const totalFinished = Number(diagnostics.success_count || 0) + parseFailures;
  const parseErrorRate = totalFinished ? parseFailures / totalFinished : 0;
  return {
    promotable: attempted > 0 && portOperationSuccess >= 1 && records.filter(r => ["target_vessel", "unknown_gt_review"].includes(r.commercial_relevance_status)).length > 0 && parseErrorRate < 0.5,
    attempted,
    portOperationSuccess,
    parseErrorRate
  };
}

export async function saveToSupabase(records, options = {}) {
  const supabase = getSupabase();
  const now = new Date().toISOString();
  const runId = options.runId || createRunId();
  const diagnostics = options.diagnostics || {};
  const promotion = shouldPromoteRun(records, diagnostics);
  const runStatus = options.status === "failed" ? "failed" : promotion.promotable ? "promotable" : records.length ? "degraded_not_promoted" : "no_live_data";

  await supabase.from("data_collection_runs").insert({
    run_id: runId,
    started_at: options.startedAt || now,
    finished_at: now,
    status: runStatus,
    source_summary: diagnostics,
    total_rows: Number(diagnostics.real_row_count || records.length || 0),
    raw_collected_rows: Number(diagnostics.real_row_count || records.length || 0),
    normalized_rows: records.length,
    all_vessels_count: records.length,
    target_vessels_count: records.filter(r => ["target_vessel", "unknown_gt_review"].includes(r.commercial_relevance_status)).length,
    gt_5000_plus_count: records.filter(r => r.gt_status === "target_vessel").length,
    unknown_gt_review_count: records.filter(r => r.gt_status === "unknown_gt_review").length,
    staying_vessels_count: records.filter(r => r.status_bucket === "staying_vessels").length,
    arrival_pipeline_count: records.filter(r => r.status_bucket === "arrival_pipeline").length,
    scored_vessels_count: records.filter(r => typeof r.total_sales_priority_score === "number").length,
    candidates_count: records.filter(r => (r.commercial_value_score || r.total_sales_priority_score || 0) >= 60 || r.is_cleaning_candidate).length,
    sales_candidates_count: records.filter(r => (r.commercial_value_score || r.total_sales_priority_score || 0) >= 60 || r.is_cleaning_candidate).length,
    immediate_targets_count: records.filter(r => (r.commercial_value_score || r.total_sales_priority_score || 0) >= 80 || r.is_immediate_candidate).length,
    imo_missing_count: records.filter(r => !r.imo).length,
    imo_recovered_count: records.filter(r => r.vessel_master_seed_match && r.imo).length,
    high_value_low_confidence_count: records.filter(r => (r.commercial_value_score || 0) >= 60 && (r.data_confidence_score || 0) < 60).length,
    actionable_rows: records.filter(r => r.actionable_source_row !== false).length,
    validation_status: promotion.promotable ? "passed" : "not_promoted",
    error_summary: { error: options.error || null, promotion }
  });

  const rows = records.map(r => ({
    run_id: runId,
    snapshot_date: now.slice(0, 10),
    master_vessel_id: r.hybrid_entity_key || r.vessel_id,
    vessel_id: r.vessel_id,
    vessel_name: r.vessel_name,
    port: r.port,
    port_code: r.port_code || null,
    port_name: r.port_name || r.port || null,
    berth: r.berth || null,
    berth_name: r.berth_name || r.berth || null,
    anchorage_name: r.anchorage_name || r.anchorage_zone || null,
    call_sign: r.call_sign || null,
    imo: r.imo || null,
    mmsi: r.mmsi || null,
    vessel_type: r.vessel_type || null,
    gt: r.gt || null,
    eta: r.eta || null,
    ata: r.ata || null,
    etb: r.etb || null,
    atb: r.atb || null,
    etd: r.etd || null,
    atd: r.atd || null,
    stay_hours: r.stay_hours || 0,
    berth_hours: r.berth_hours || 0,
    anchorage_hours: r.anchorage_hours || 0,
    status: r.status,
    operator: r.operator || null,
    data_quality_tier: r.data_quality_tier || null,
    risk_score: r.risk_score || 0,
    total_sales_priority_score: r.total_sales_priority_score || 0,
    commercial_value_score: r.commercial_value_score || r.total_sales_priority_score || 0,
    commercial_value_band: r.commercial_value_band || r.sales_priority_band || "low_priority",
    data_confidence_score: r.data_confidence_score || 0,
    candidate_band: r.sales_priority_band || "low_priority",
    sales_reason: r.sales_reason || r.reason_codes || [],
    reason_codes: r.reason_codes || [],
    hybrid_entity_key: r.hybrid_entity_key || r.vessel_id,
    payload: r,
    updated_at: r.updated_at || now,
    collected_at: now,
    source: r.source || r.source_mode || "korea-port-hull-intelligence",
    source_name: r.source || r.source_label || r.source_mode || "korea-port-hull-intelligence"
  }));

  if (!rows.length) {
    return { runId, recordsSaved: 0, table: "vessel_snapshots", mode: "empty", promoted: false, promotion };
  }

  let recordsSaved = 0;
  const batchSize = Number(process.env.SUPABASE_BATCH_SIZE || 100);
  for (let index = 0; index < rows.length; index += batchSize) {
    const batch = rows.slice(index, index + batchSize);
    const { error } = await supabase
      .from("vessel_snapshots")
      .insert(batch);
    if (error) throw error;
    recordsSaved += batch.length;
  }

  const entities = records.map(r => ({
    hybrid_entity_key: r.hybrid_entity_key || r.vessel_id,
    vessel_id: r.vessel_id,
    vessel_name: r.vessel_name,
    imo: r.imo || null,
    mmsi: r.mmsi || null,
    call_sign: r.call_sign || null,
    vessel_type: r.vessel_type || null,
    gt: r.gt || null,
    operator: r.operator || null,
    last_seen_at: now,
    payload: r
  })).filter(r => r.hybrid_entity_key);

  for (let index = 0; index < entities.length; index += batchSize) {
    const batch = entities.slice(index, index + batchSize);
    const { error } = await supabase
      .from("vessel_entities")
      .upsert(batch, { onConflict: "hybrid_entity_key" });
    if (error) throw error;
  }

  let masterRows = records.map(r => ({
    master_vessel_id: r.hybrid_entity_key || r.vessel_id,
    imo: r.imo || null,
    mmsi: r.mmsi || null,
    call_sign: r.call_sign || null,
    canonical_name: r.vessel_name,
    normalized_name: String(r.vessel_name || "").trim().toUpperCase(),
    vessel_type: r.vessel_type || null,
    vessel_type_group: r.vessel_type_group || null,
    gt: r.gt || null,
    dwt: r.dwt || null,
    loa: r.loa || null,
    beam: r.beam || null,
    operator: r.operator || null,
    operator_normalized: String(r.operator || "").trim().toUpperCase() || null,
    flag: r.flag || null,
    identity_confidence: r.identification_method === "IMO" ? 95 : r.identification_method === "MMSI" ? 85 : r.identification_method === "HYBRID_CALLSIGN_NAME_GT" ? 70 : 40,
    imo_status: r.imo_status || (r.imo ? "present" : "missing"),
    last_seen: now,
    updated_at: now,
    payload: r
  })).filter(r => r.master_vessel_id);

  const existingMasters = new Map();
  for (let index = 0; index < masterRows.length; index += batchSize) {
    const ids = masterRows.slice(index, index + batchSize).map(row => row.master_vessel_id);
    if (!ids.length) continue;
    const { data, error } = await supabase
      .from("vessel_master")
      .select("master_vessel_id,imo,mmsi,call_sign,canonical_name,normalized_name,vessel_type,vessel_type_group,gt,dwt,loa,beam,operator,operator_normalized,flag,identity_confidence,imo_status,first_seen")
      .in("master_vessel_id", ids);
    if (error) throw error;
    for (const row of data || []) existingMasters.set(row.master_vessel_id, row);
  }

  masterRows = masterRows.map(row => {
    const old = existingMasters.get(row.master_vessel_id);
    if (!old) return row;
    const oldConfidence = Number(old.identity_confidence || 0);
    const newConfidence = Number(row.identity_confidence || 0);
    const keepOldIdentity = oldConfidence > newConfidence;
    return {
      ...row,
      imo: row.imo || old.imo || null,
      mmsi: row.mmsi || old.mmsi || null,
      call_sign: row.call_sign || old.call_sign || null,
      canonical_name: keepOldIdentity ? old.canonical_name || row.canonical_name : row.canonical_name || old.canonical_name,
      normalized_name: keepOldIdentity ? old.normalized_name || row.normalized_name : row.normalized_name || old.normalized_name,
      vessel_type: row.vessel_type || old.vessel_type || null,
      vessel_type_group: row.vessel_type_group || old.vessel_type_group || null,
      gt: row.gt || old.gt || null,
      dwt: row.dwt || old.dwt || null,
      loa: row.loa || old.loa || null,
      beam: row.beam || old.beam || null,
      operator: row.operator || old.operator || null,
      operator_normalized: row.operator_normalized || old.operator_normalized || null,
      flag: row.flag || old.flag || null,
      identity_confidence: Math.max(oldConfidence, newConfidence),
      imo_status: row.imo_status || old.imo_status || null,
      first_seen: old.first_seen || row.first_seen
    };
  });

  for (let index = 0; index < masterRows.length; index += batchSize) {
    const batch = masterRows.slice(index, index + batchSize);
    const { error } = await supabase.from("vessel_master").upsert(batch, { onConflict: "master_vessel_id" });
    if (error) throw error;
  }

  const aliases = records
    .filter(r => r.vessel_name && (r.hybrid_entity_key || r.vessel_id))
    .map(r => ({
      alias_name: r.vessel_name,
      normalized_alias_name: String(r.vessel_name || "").trim().toUpperCase(),
      master_vessel_id: r.hybrid_entity_key || r.vessel_id,
      source: r.source || "collector",
      confidence: r.identification_method === "IMO" ? 95 : r.identification_method === "MMSI" ? 85 : 60,
      last_seen: now
    }));

  for (let index = 0; index < aliases.length; index += batchSize) {
    const batch = aliases.slice(index, index + batchSize);
    const { error } = await supabase.from("vessel_aliases").upsert(batch, { onConflict: "alias_name,master_vessel_id,source" });
    if (error) throw error;
  }

  const identityCandidates = records
    .filter(r => !r.imo)
    .map(r => ({
      run_id: runId,
      hybrid_entity_key: r.hybrid_entity_key || r.vessel_id,
      vessel_id: r.vessel_id,
      raw_vessel_name: r.vessel_name,
      normalized_name: String(r.vessel_name || "").trim().toUpperCase(),
      call_sign: r.call_sign || null,
      mmsi: r.mmsi || null,
      gt: r.gt || null,
      port_code: r.port_code || null,
      likely_master_vessel_id: null,
      confidence: Number(r.gt || 0) >= 5000 || (r.total_sales_priority_score || 0) >= 60 ? 60 : 40,
      resolution_status: Number(r.gt || 0) >= 5000 || (r.total_sales_priority_score || 0) >= 60 ? "manual_review_priority" : "unresolved",
      likely_imo_candidates: [],
      confidence_band: Number(r.gt || 0) >= 5000 || (r.total_sales_priority_score || 0) >= 60 ? "manual_review_priority" : "unresolved",
      manual_review_required: Number(r.gt || 0) >= 5000 || (r.total_sales_priority_score || 0) >= 60,
      payload: r
    }));

  for (let index = 0; index < identityCandidates.length; index += batchSize) {
    const batch = identityCandidates.slice(index, index + batchSize);
    const { error } = await supabase.from("vessel_identity_candidates").insert(batch);
    if (error) throw error;
  }

  const riskRows = records.map(r => ({
    run_id: runId,
    master_vessel_id: r.hybrid_entity_key || r.vessel_id,
    hybrid_entity_key: r.hybrid_entity_key || r.vessel_id,
    vessel_id: r.vessel_id,
    port: r.port || null,
    total_sales_priority_score: r.total_sales_priority_score || r.cleaning_candidate_score || r.risk_score || 0,
    commercial_value_score: r.commercial_value_score || r.total_sales_priority_score || r.cleaning_candidate_score || r.risk_score || 0,
    data_confidence_score: r.data_confidence_score || 0,
    biofouling_risk_score: r.biofouling_risk_score || r.biofouling_score || r.risk_score || 0,
    performance_proxy_score: r.performance_proxy_score || 0,
    congestion_exposure_score: r.congestion_exposure_score || 0,
    cleaning_window_score: r.cleaning_window_score || 0,
    compliance_pressure_score: r.compliance_pressure_score || 0,
    commercial_fit_score: r.commercial_fit_score || 0,
    candidate_band: r.sales_priority_band || "low_priority",
    reason_codes: r.reason_codes || [],
    collected_at: now,
    payload: r
  })).filter(r => r.hybrid_entity_key);

  for (let index = 0; index < riskRows.length; index += batchSize) {
    const batch = riskRows.slice(index, index + batchSize);
    const { error } = await supabase.from("risk_history").insert(batch);
    if (error) throw error;
  }

  const events = records
    .filter(r => r.is_cleaning_candidate || r.is_immediate_candidate || (r.total_sales_priority_score || 0) >= 60)
    .map(r => ({
      hybrid_entity_key: r.hybrid_entity_key || r.vessel_id,
      master_vessel_id: r.hybrid_entity_key || r.vessel_id,
      run_id: runId,
      vessel_id: r.vessel_id,
      event_type: r.is_immediate_candidate ? "SCORE_INCREASED" : "LONG_IDLE_DETECTED",
      event_time: now,
      port_code: r.port_code || null,
      berth_name: r.berth_name || r.berth || null,
      confidence: r.candidate_confidence || 50,
      source_name: r.source || null,
      port: r.port || null,
      payload: r
    }))
    .filter(r => r.hybrid_entity_key);

  for (let index = 0; index < events.length; index += batchSize) {
    const batch = events.slice(index, index + batchSize);
    const { error } = await supabase.from("vessel_events").insert(batch);
    if (error) throw error;
  }

  const byPort = new Map();
  for (const r of records) {
    const key = r.port_code || r.port || "unknown";
    const current = byPort.get(key) || { port_code: r.port_code || null, port_name: r.port_name || r.port || null, total_vessels: 0, anchorage_vessels: 0, long_idle_vessels: 0, waiting_hours_total: 0, berth_hours_total: 0, score_total: 0 };
    current.total_vessels += 1;
    if (r.is_anchorage_waiting || (r.anchorage_hours || 0) > 0) current.anchorage_vessels += 1;
    if (r.is_long_idle) current.long_idle_vessels += 1;
    current.waiting_hours_total += Number(r.anchorage_hours || 0);
    current.berth_hours_total += Number(r.berth_hours || 0);
    current.score_total += Number(r.port_congestion_score || 0);
    byPort.set(key, current);
  }

  const congestionRows = [...byPort.values()].map(p => ({
    port_code: p.port_code,
    run_id: runId,
    port_name: p.port_name,
    total_vessels: p.total_vessels,
    anchorage_vessels: p.anchorage_vessels,
    long_idle_vessels: p.long_idle_vessels,
    average_waiting_hours: p.anchorage_vessels ? Math.round((p.waiting_hours_total / p.anchorage_vessels) * 10) / 10 : 0,
    berth_occupancy_proxy: p.total_vessels ? Math.min(100, Math.round((p.berth_hours_total / Math.max(1, p.total_vessels * 24)) * 100)) : 0,
    anchorage_density_score: p.total_vessels ? Math.min(100, Math.round((p.anchorage_vessels / p.total_vessels) * 100)) : 0,
    port_congestion_score: p.total_vessels ? Math.min(100, Math.round(p.score_total / p.total_vessels)) : 0,
    collected_at: now,
    payload: p
  }));

  for (let index = 0; index < congestionRows.length; index += batchSize) {
    const batch = congestionRows.slice(index, index + batchSize);
    const { error } = await supabase.from("port_congestion_snapshots").insert(batch);
    if (error) throw error;
  }

  let promoted = false;
  if (promotion.promotable) {
    const { error } = await supabase.from("active_dataset_pointer").upsert({
      id: "current",
      active_run_id: runId,
      active_collected_at: now,
      promoted_at: now,
      data_age_minutes: 0,
      is_stale: false
    }, { onConflict: "id" });
    if (error) throw error;
    await supabase.from("data_collection_runs").update({ status: "promoted", promoted_at: now }).eq("run_id", runId);
    promoted = true;
  }

  return { runId, recordsSaved, table: "vessel_snapshots", mode: "append_only", promoted, promotion, batchSize, entitiesSaved: entities.length, masterRowsSaved: masterRows.length, identityCandidatesSaved: identityCandidates.length, riskRowsSaved: riskRows.length, eventsSaved: events.length, congestionRowsSaved: congestionRows.length };
}
