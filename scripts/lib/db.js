import { createClient } from "@supabase/supabase-js";
import ws from "ws";

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

export async function saveToSupabase(records) {
  const supabase = getSupabase();
  const now = new Date().toISOString();

  const rows = records.map(r => ({
    snapshot_date: now.slice(0, 10),
    vessel_id: r.vessel_id,
    vessel_name: r.vessel_name,
    port: r.port,
    berth: r.berth || null,
    eta: r.eta || null,
    etd: r.etd || null,
    status: r.status,
    operator: r.operator || null,
    risk_score: r.risk_score || 0,
    sales_reason: r.sales_reason || r.reason_codes || [],
    hybrid_entity_key: r.hybrid_entity_key || r.vessel_id,
    payload: r,
    updated_at: r.updated_at || now,
    collected_at: now,
    source: r.source || r.source_mode || "korea-port-hull-intelligence"
  }));

  if (!rows.length) {
    return { recordsSaved: 0, table: "vessel_snapshots", mode: "empty" };
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

  const riskRows = records.map(r => ({
    hybrid_entity_key: r.hybrid_entity_key || r.vessel_id,
    vessel_id: r.vessel_id,
    port: r.port || null,
    total_sales_priority_score: r.total_sales_priority_score || r.cleaning_candidate_score || r.risk_score || 0,
    biofouling_risk_score: r.biofouling_score || r.risk_score || 0,
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
      vessel_id: r.vessel_id,
      event_type: r.is_immediate_candidate ? "immediate_target_snapshot" : "candidate_snapshot",
      port: r.port || null,
      event_at: now,
      payload: r
    }))
    .filter(r => r.hybrid_entity_key);

  for (let index = 0; index < events.length; index += batchSize) {
    const batch = events.slice(index, index + batchSize);
    const { error } = await supabase.from("vessel_events").insert(batch);
    if (error) throw error;
  }

  return { recordsSaved, table: "vessel_snapshots", mode: "append_only", batchSize, entitiesSaved: entities.length, riskRowsSaved: riskRows.length, eventsSaved: events.length };
}
