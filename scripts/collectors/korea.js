const SOURCE_TIMEOUT_MS = Number(process.env.SOURCE_TIMEOUT_MS || 10000);
const MAX_OUTPUT_ROWS = Number(process.env.MAX_OUTPUT_ROWS || 500);

let diagnostics = {
  generated_at: null,
  attempted_count: 0,
  success_count: 0,
  failed_count: 0,
  skipped_count: 0,
  real_row_count: 0,
  fallback_used: false,
  sources: []
};

const FIELD_ALIASES = {
  vessel_name: ["vessel_name", "ship_name", "shipNm", "vsslNm", "vslNm", "vesselNm", "VSL_NM", "VSSL_NM", "shipName"],
  imo: ["imo", "imo_no", "imoNo", "IMO", "IMO_NO"],
  mmsi: ["mmsi", "MMSI"],
  call_sign: ["call_sign", "callSign", "callsign", "CALL_SIGN", "clsgn"],
  port: ["port", "port_name", "portNm", "prtNm", "PORT_NM", "portName", "portCode"],
  berth: ["berth", "berth_name", "berthNm", "brthNm", "BERTH_NM", "facilityNm", "terminalNm"],
  anchorage_zone: ["anchorage_zone", "anchorage", "anchorZone", "anchorageNm"],
  status: ["status", "movement_status", "shipStatus", "sttus", "statusNm", "vsslStatus"],
  operator: ["operator", "company", "shippingCompany", "agent", "agentNm", "carrierNm", "shipCompany"],
  destination: ["destination", "dest", "next_port_country", "DEST", "destNm", "destinationPort"],
  previous_port: ["previous_port", "prevPort", "last_port", "prevPortNm"],
  next_port: ["next_port", "nextPort", "nextPortNm"],
  vessel_type: ["vessel_type", "ship_type", "shipType", "vsslKnd", "shipKnd", "TYPE", "vesselType"],
  gt: ["gt", "gross_tonnage", "grt", "grossTon", "GT"],
  eta: ["eta", "ETA", "etaDate", "estimatedArrival", "arrPlanDt", "arrivalPlanDt", "etaDt"],
  etb: ["etb", "ETB", "estimatedBerthing", "berthPlanDt", "etbDt"],
  ata: ["ata", "ATA", "actualArrival", "arrDt", "arrivalDt"],
  atb: ["atb", "ATB", "actualBerthing", "berthDt"],
  etd: ["etd", "ETD", "estimatedDeparture", "depPlanDt", "departurePlanDt", "etdDt"],
  atd: ["atd", "ATD", "actualDeparture", "depDt", "departureDt"],
  speed: ["speed", "sog", "SOG"]
};

function env(name) {
  return process.env[name] && String(process.env[name]).trim();
}

function hasEmbeddedKey(urlValue) {
  try {
    const url = new URL(urlValue);
    return ["serviceKey", "ServiceKey", "service_key", "key", "apiKey", "api_key"].some(key => url.searchParams.has(key));
  } catch {
    return false;
  }
}

function canAttempt(source) {
  return Boolean(source.url && (source.serviceKey || hasEmbeddedKey(source.url)));
}

function firstValue(row, aliases) {
  for (const key of aliases) {
    if (row[key] !== undefined && row[key] !== null && String(row[key]).trim() !== "") return row[key];
  }
  const lowerMap = new Map(Object.keys(row).map(key => [key.toLowerCase(), key]));
  for (const key of aliases) {
    const actual = lowerMap.get(String(key).toLowerCase());
    if (actual && row[actual] !== undefined && row[actual] !== null && String(row[actual]).trim() !== "") return row[actual];
  }
  return "";
}

function normalizeDate(value) {
  if (!value) return "";
  const text = String(value).trim();
  if (!text) return "";
  if (/^\d{8}$/.test(text)) return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)} 00:00`;
  if (/^\d{12}$/.test(text)) return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)} ${text.slice(8, 10)}:${text.slice(10, 12)}`;
  if (/^\d{14}$/.test(text)) return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)} ${text.slice(8, 10)}:${text.slice(10, 12)}`;
  return text.replace("T", " ").replace(/:\d{2}\.\d{3}Z$/, "");
}

function toNumber(value) {
  const n = Number(String(value ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function allSourceConfigs() {
  const vtsBase = env("MOF_VTS_API_BASE");
  const vtsKey = env("MOF_VTS_SERVICE_KEY");
  const vtsCodes = (env("MOF_VTS_PORT_CODES") || "BUSAN,YEOSU,GWANGYANG,ULSAN,PYEONGTAEK,POHANG,HADONG,MASAN,INCHEON")
    .split(/[,\s]+/)
    .map(code => code.trim())
    .filter(Boolean);

  return [
    { key: "port_operation", label: "PORT-MIS port operation", url: env("PORT_OPERATION_API_URL"), serviceKey: env("PORT_OPERATION_SERVICE_KEY") },
    { key: "port_facility", label: "Port facility", url: env("PORT_FACILITY_API_URL"), serviceKey: env("PORT_FACILITY_SERVICE_KEY") },
    { key: "ulsan_core", label: "Ulsan core", url: env("ULSAN_API_URL"), serviceKey: env("ULSAN_API_KEY") },
    { key: "ulsan_berth_detail", label: "Ulsan berth detail", url: env("ULSAN_BERTH_DETAIL_API_URL"), serviceKey: env("ULSAN_BERTH_DETAIL_API_KEY") },
    { key: "ulsan_cargo_plan", label: "Ulsan cargo plan", url: env("ULSAN_CARGO_PLAN_API_URL"), serviceKey: env("ULSAN_CARGO_PLAN_API_KEY") },
    { key: "ulsan_berth_operation", label: "Ulsan berth operation", url: env("ULSAN_BERTH_OPERATION_API_URL"), serviceKey: env("ULSAN_BERTH_OPERATION_API_KEY") },
    { key: "ulsan_terminal_process", label: "Ulsan terminal process", url: env("ULSAN_TERMINAL_PROCESS_API_URL"), serviceKey: env("ULSAN_TERMINAL_PROCESS_API_KEY") },
    { key: "mof_ais_dynamic", label: "MOF AIS dynamic", url: env("MOF_AIS_DYNAMIC_API_URL"), serviceKey: env("MOF_AIS_DYNAMIC_SERVICE_KEY") },
    { key: "mof_ais_info", label: "MOF AIS info", url: env("MOF_AIS_INFO_API_URL"), serviceKey: env("MOF_AIS_INFO_SERVICE_KEY") },
    { key: "mof_ais_stat", label: "MOF AIS stat", url: env("MOF_AIS_STAT_API_URL"), serviceKey: env("MOF_AIS_STAT_SERVICE_KEY") },
    { key: "korea_public_data", label: "Korea public data fallback", url: env("KOREA_PORTMIS_BASE_URL"), serviceKey: env("PORTMIS_API_KEY") || env("PORT_MIS_API_KEY") || env("DATA_GO_KR_API_KEY") || env("SERVICE_KEY") },
    ...((vtsBase && vtsKey) ? vtsCodes.map(code => ({ key: `mof_vts_${code.toLowerCase()}`, label: `Integrated VTS ${code}`, url: vtsBase, serviceKey: vtsKey, portCode: code })) : [])
  ];
}

function buildUrl(source) {
  const url = new URL(source.url);
  if (source.serviceKey && !["serviceKey", "ServiceKey", "service_key", "key", "apiKey", "api_key"].some(key => url.searchParams.has(key))) {
    url.searchParams.set("serviceKey", source.serviceKey);
  }
  if (!url.searchParams.has("_type")) url.searchParams.set("_type", "json");
  if (!url.searchParams.has("pageNo")) url.searchParams.set("pageNo", "1");
  if (!url.searchParams.has("numOfRows")) url.searchParams.set("numOfRows", String(Math.min(MAX_OUTPUT_ROWS, 100)));
  if (source.portCode && !url.searchParams.has("portCode")) url.searchParams.set("portCode", source.portCode);
  return url;
}

async function fetchText(source) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SOURCE_TIMEOUT_MS);
  try {
    const url = buildUrl(source);
    const started = Date.now();
    const res = await fetch(url, { signal: controller.signal, headers: { accept: "application/json, text/xml, */*" } });
    const text = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return { text, url, latency_ms: Date.now() - started };
  } finally {
    clearTimeout(timer);
  }
}

function flattenJson(value) {
  if (Array.isArray(value)) return value.flatMap(flattenJson);
  if (!value || typeof value !== "object") return [];
  const preferred = value.items?.item || value.response?.body?.items?.item || value.body?.items?.item || value.data || value.list || value.result || value.records;
  if (preferred) return flattenJson(preferred);
  const arrays = Object.values(value).filter(Array.isArray);
  if (arrays.length) return arrays.flatMap(flattenJson);
  return [value];
}

function parseXmlRows(text) {
  const rows = [];
  for (const match of text.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)) {
    const row = {};
    for (const field of match[1].matchAll(/<([^!?\/][^>\s]*)[^>]*>([\s\S]*?)<\/\1>/g)) {
      row[field[1]] = field[2].replace(/<!\[CDATA\[|\]\]>/g, "").trim();
    }
    if (Object.keys(row).length) rows.push(row);
  }
  return rows;
}

function parseRows(text) {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return flattenJson(JSON.parse(trimmed)).filter(row => row && typeof row === "object");
  return parseXmlRows(trimmed);
}

function normalizeStatus(value) {
  const text = String(value || "").trim();
  if (/berth|alongside|moored/i.test(text)) return "At Berth";
  if (/anchor|waiting|idle|drifting/i.test(text)) return "Waiting";
  if (/expected|schedule|planned/i.test(text)) return "Expected";
  if (/departure|departed/i.test(text)) return "Departed";
  return text || "Observed";
}

function normalizePort(value, fallback = "") {
  const text = String(value || fallback || "").trim();
  if (/busan/i.test(text)) return "Busan";
  if (/yeosu/i.test(text)) return "Yeosu";
  if (/gwangyang/i.test(text)) return "Gwangyang";
  if (/ulsan/i.test(text)) return "Ulsan";
  if (/pyeongtaek|dangjin/i.test(text)) return "Pyeongtaek-Dangjin";
  if (/pohang/i.test(text)) return "Pohang";
  if (/hadong|samcheonpo/i.test(text)) return "Hadong/Samcheonpo";
  if (/masan|jinhae/i.test(text)) return "Masan/Jinhae";
  if (/incheon/i.test(text)) return "Incheon";
  return text || "Korea";
}

function normalizeRow(row, source, now) {
  const vesselName = String(firstValue(row, FIELD_ALIASES.vessel_name)).trim();
  const imo = String(firstValue(row, FIELD_ALIASES.imo)).trim();
  const mmsi = String(firstValue(row, FIELD_ALIASES.mmsi)).trim();
  const callSign = String(firstValue(row, FIELD_ALIASES.call_sign)).trim();
  const port = normalizePort(firstValue(row, FIELD_ALIASES.port), source.portCode);
  if (!vesselName && !imo && !mmsi && !callSign) return null;

  return {
    vessel_id: imo ? `IMO-${imo}` : mmsi ? `MMSI-${mmsi}` : callSign ? `CALL-${callSign}` : `${vesselName}-${port}`,
    vessel_name: vesselName || imo || mmsi || callSign,
    imo,
    mmsi,
    call_sign: callSign,
    port,
    berth: String(firstValue(row, FIELD_ALIASES.berth)).trim(),
    anchorage_zone: String(firstValue(row, FIELD_ALIASES.anchorage_zone)).trim(),
    status: normalizeStatus(firstValue(row, FIELD_ALIASES.status)),
    operator: String(firstValue(row, FIELD_ALIASES.operator)).trim(),
    destination: String(firstValue(row, FIELD_ALIASES.destination)).trim(),
    previous_port: String(firstValue(row, FIELD_ALIASES.previous_port)).trim(),
    next_port: String(firstValue(row, FIELD_ALIASES.next_port)).trim(),
    vessel_type: String(firstValue(row, FIELD_ALIASES.vessel_type)).trim() || "Unknown",
    gt: toNumber(firstValue(row, FIELD_ALIASES.gt)),
    eta: normalizeDate(firstValue(row, FIELD_ALIASES.eta)),
    etb: normalizeDate(firstValue(row, FIELD_ALIASES.etb)),
    ata: normalizeDate(firstValue(row, FIELD_ALIASES.ata)),
    atb: normalizeDate(firstValue(row, FIELD_ALIASES.atb)),
    etd: normalizeDate(firstValue(row, FIELD_ALIASES.etd)),
    atd: normalizeDate(firstValue(row, FIELD_ALIASES.atd)),
    speed: toNumber(firstValue(row, FIELD_ALIASES.speed)),
    risk_score: 45,
    source: source.key,
    source_label: source.label,
    source_mode: "real_public_api_snapshot",
    data_confidence: "source_configured",
    raw_source_keys: Object.keys(row).slice(0, 40),
    updated_at: now
  };
}

function dedupe(records) {
  const seen = new Set();
  const output = [];
  for (const record of records) {
    const key = [record.vessel_id, record.port, record.eta, record.ata, record.berth].join("|").toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(record);
  }
  return output.slice(0, MAX_OUTPUT_ROWS);
}

async function collectRealRows() {
  const now = new Date().toISOString();
  const records = [];
  diagnostics = { generated_at: now, attempted_count: 0, success_count: 0, failed_count: 0, skipped_count: 0, real_row_count: 0, fallback_used: false, sources: [] };

  for (const source of allSourceConfigs()) {
    const diag = { key: source.key, label: source.label, attempted: false, skipped: false, success: false, row_count: 0, normalized_count: 0 };
    if (!source.url) {
      diag.skipped = true;
      diag.reason = "missing_url";
      diagnostics.skipped_count += 1;
      diagnostics.sources.push(diag);
      continue;
    }
    if (!canAttempt(source)) {
      diag.skipped = true;
      diag.reason = "missing_service_key_or_embedded_key";
      diagnostics.skipped_count += 1;
      diagnostics.sources.push(diag);
      continue;
    }
    diag.attempted = true;
    diagnostics.attempted_count += 1;
    try {
      const { text, url, latency_ms } = await fetchText(source);
      const rows = parseRows(text);
      diag.success = true;
      diag.latency_ms = latency_ms;
      diag.row_count = rows.length;
      diag.url_host = url.host;
      for (const row of rows) {
        const normalized = normalizeRow(row, source, now);
        if (normalized) records.push(normalized);
      }
      diag.normalized_count = records.filter(record => record.source === source.key).length;
      diagnostics.success_count += 1;
    } catch (error) {
      diag.error = error?.message || String(error);
      diagnostics.failed_count += 1;
    }
    diagnostics.sources.push(diag);
  }
  const deduped = dedupe(records);
  diagnostics.real_row_count = deduped.length;
  return deduped;
}

function sampleRows(apiSources = []) {
  const enabled = new Set(apiSources.filter(s => s.enabled).map(s => s.key));
  const sourceMode = enabled.size ? "api_ready_sample_snapshot" : "sample_snapshot";
  const now = new Date().toISOString();
  return [
    { vessel_id: "IMO-9876543", vessel_name: "MV HF ZHOUSHAN", port: "Busan", berth: "Outer Anchorage", anchorage_zone: "Busan OPL", status: "Waiting", operator: "Sample Operator", destination: "Australia", previous_port: "Port Hedland", next_port: "Brisbane", vessel_type: "Capesize", gt: 93000, eta: "2026-05-04 08:00", etb: "2026-05-27 10:00", ata: "2026-05-04 07:40", atb: "", etd: "2026-05-29 18:00", atd: "", days_in_korea: 21, speed: 2, risk_score: 95, source: "integrated_vts_sample", updated_at: now, source_mode: sourceMode, api_ready: [...enabled] },
    { vessel_id: "IMO-8111222", vessel_name: "MAERSK DEMO", port: "Ulsan", berth: "Industrial Berth", anchorage_zone: "", status: "At Berth", operator: "Maersk", destination: "Singapore", previous_port: "Shanghai", next_port: "Singapore", vessel_type: "Container", gt: 76000, eta: "2026-05-20 09:00", etb: "2026-05-20 16:00", ata: "2026-05-20 08:45", atb: "2026-05-20 16:20", etd: "2026-05-25 21:00", atd: "", days_in_korea: 5, speed: 10, risk_score: 35, source: "ulsan_port_schedule_sample", updated_at: now, source_mode: sourceMode, api_ready: [...enabled] },
    { vessel_id: "IMO-7000001", vessel_name: "YEOSU TARGET", port: "Yeosu", berth: "Outer Anchorage", anchorage_zone: "D", status: "Waiting", operator: "Demo Operator", destination: "Brazil", previous_port: "Singapore", next_port: "Brazil", vessel_type: "VLCC", gt: 160000, eta: "2026-05-09 03:00", etb: "", ata: "2026-05-09 02:35", atb: "", etd: "2026-05-31 12:00", atd: "", days_in_korea: 16, speed: 1, risk_score: 90, source: "integrated_vts_sample", updated_at: now, source_mode: sourceMode, api_ready: [...enabled] }
  ];
}

export async function collectKoreaData({ apiSources = [] } = {}) {
  const realRows = await collectRealRows();
  diagnostics.fallback_used = realRows.length === 0;
  return realRows.length ? realRows : sampleRows(apiSources);
}

export function getCollectorDiagnostics() {
  return diagnostics;
}
