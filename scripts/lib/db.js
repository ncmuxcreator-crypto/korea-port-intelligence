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
    status: r.status,
    operator: r.operator || null,
    risk_score: r.risk_score || 0,
    updated_at: r.updated_at || now,
    collected_at: now,
    source: "v15.4-korea-port-secret-registry"
  }));

  const { error } = await supabase
    .from("vessel_snapshots")
    .upsert(rows, {
      onConflict: "snapshot_date,vessel_id,port"
    });

  if (error) throw error;
}
