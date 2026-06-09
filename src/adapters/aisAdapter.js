export async function fetchRecent(portCode, windowHours = 96, options = {}) {
  const items = Array.isArray(options.mockRows) ? options.mockRows.filter(row => !portCode || row.port_code === portCode || row.port_name_ko === portCode) : [];
  return {
    source: "AIS",
    items,
    data_health: {
      source: "AIS",
      status: items.length ? "mock" : "degraded",
      window_hours: windowHours,
      missing_sources: items.length ? [] : ["MOF_AIS_DYNAMIC"],
      notes: items.length ? ["mock seed 사용"] : ["AIS adapter 준비됨, 실제 API 연결 대기"]
    }
  };
}

export default { fetchRecent };
