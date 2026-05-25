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
    updated_at: r.updated_at || now,
    collected_at: now,
    source: r.source || r.source_mode || "korea-port-hull-intelligence"
  }));

  if (!rows.length) {
    return { recordsSaved: 0, table: "vessel_snapshots", mode: "empty" };
  }

  const { error } = await supabase
    .from("vessel_snapshots")
    .upsert(rows, {
      onConflict: "snapshot_date,vessel_id,port"
    });

  if (error) throw error;
  return { recordsSaved: rows.length, table: "vessel_snapshots", mode: "upsert" };
}
