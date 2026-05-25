export async function collectBusanData() {
  return [
    {
      vessel_id: "IMO-9876543",
      vessel_name: "MV HF ZHOUSHAN",
      imo: "9876543",
      port: "Busan",
      berth: "Anchorage",
      eta: "2026-05-24",
      status: "Waiting",
      operator: "Sample Operator",
      vessel_type: "Capesize",
      destination: "Australia",
      days_in_korea: 21,
      source: "busan_collector"
    }
  ];
}
