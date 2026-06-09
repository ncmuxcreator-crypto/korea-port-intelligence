export async function fetchRecent(portCode, windowHours = 96, options = {}) {
  const items = Array.isArray(options.mockRows) ? options.mockRows.filter(row => !portCode || row.port_code === portCode || row.port_name_ko === portCode) : [];
  return {
    source: "Port-MIS",
    items,
    data_health: {
      source: "Port-MIS",
      status: items.length ? "mock" : "degraded",
      window_hours: windowHours,
      missing_sources: items.length ? [] : ["PORT_OPERATION_API"],
      notes: items.length ? ["mock seed 사용"] : ["Port-MIS adapter 준비됨, 실제 API 연결 대기"]
    }
  };
}

export default { fetchRecent };
