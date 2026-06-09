import { getEnvironmentalSnapshot } from "../lib/environment.js";

export async function fetchRecent(portCode, windowHours = 96, options = {}) {
  const snapshot = await getEnvironmentalSnapshot(portCode, options.lat, options.lon, options);
  return {
    source: snapshot.source || "MOCK",
    items: [{
      port_code: portCode,
      sst_72h_c_avg: snapshot.sstCelsius,
      sst_7d_c_avg: Number(snapshot.sstCelsius || 0) - Number(snapshot.sstAnomalyCelsius || 0),
      sst_anomaly_c: snapshot.sstAnomalyCelsius,
      salinity_psu: snapshot.salinityPsu,
      updated_at: snapshot.updatedAt
    }],
    data_health: {
      source: snapshot.source || "MOCK",
      status: snapshot.quality === "good" ? "healthy" : "estimated",
      window_hours: windowHours,
      missing_sources: snapshot.quality === "missing" ? ["CMEMS", "KOEM", "NOAA"] : [],
      notes: [`환경 데이터 품질: ${snapshot.quality || "estimated"}`]
    }
  };
}

export default { fetchRecent };
