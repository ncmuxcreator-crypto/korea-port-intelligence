export async function fetchRecent(portCode, windowHours = 96) {
  return {
    source: "BUOY",
    items: [],
    data_health: {
      source: "BUOY",
      status: "degraded",
      window_hours: windowHours,
      missing_sources: ["KHOA_BUOY"],
      notes: ["부이 adapter 준비됨, 실제 API 연결 대기"]
    }
  };
}

export default { fetchRecent };
