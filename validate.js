export async function collectKoreaData({ apiSources = [] } = {}) {
  const enabled = new Set(apiSources.filter(s => s.enabled).map(s => s.key));
  const sourceMode = enabled.size ? "api_ready_sample_snapshot" : "sample_snapshot";
  const now = new Date().toISOString();

  return [
    {
      vessel_id: "IMO-9876543",
      vessel_name: "MV HF ZHOUSHAN",
      port: "Busan",
      status: "Waiting",
      operator: "Sample Operator",
      destination: "Australia",
      vessel_type: "Capesize",
      days_in_korea: 21,
      speed: 2,
      risk_score: 95,
      updated_at: now,
      source_mode: sourceMode,
      api_ready: [...enabled]
    },
    {
      vessel_id: "IMO-8111222",
      vessel_name: "MAERSK DEMO",
      port: "Ulsan",
      status: "At Berth",
      operator: "Maersk",
      destination: "Singapore",
      vessel_type: "Container",
      days_in_korea: 5,
      speed: 10,
      risk_score: 35,
      updated_at: now,
      source_mode: sourceMode,
      api_ready: [...enabled]
    },
    {
      vessel_id: "IMO-7000001",
      vessel_name: "YEOSU TARGET",
      port: "Yeosu",
      status: "Waiting",
      operator: "Demo Operator",
      destination: "Brazil",
      vessel_type: "VLCC",
      days_in_korea: 16,
      speed: 1,
      risk_score: 90,
      updated_at: now,
      source_mode: sourceMode,
      api_ready: [...enabled]
    }
  ];
}
