const SOURCE_TIMEOUT_MS = Number(process.env.SOURCE_TIMEOUT_MS || 25000);
const MAX_OUTPUT_ROWS = Number(process.env.MAX_OUTPUT_ROWS || 10000);
const MAX_SOURCE_ROWS = Number(process.env.MAX_SOURCE_ROWS || 5000);
const MAX_CHILD_ENRICHMENT_ROWS = Number(process.env.MAX_CHILD_ENRICHMENT_ROWS || 10);
const COLLECTOR_RUNTIME_BUDGET_MS = Number(process.env.COLLECTOR_RUNTIME_BUDGET_MS || 300000);
const DEFAULT_PORT_OPERATION_API_URL = "http://apis.data.go.kr/1192000/VsslEtrynd5/Info5";
const DEFAULT_CARGO_HARBOR_USE_API_URL = "http://apis.data.go.kr/1192000/CargHarborUse2/Info";
const DEFAULT_PORT_OPERATION_CODES = {
  busan: "020",
  incheon: "030",
  yeosu_gwangyang: "620",
  ulsan: "820",
  pyeongtaek_dangjin: "031",
  pohang: "810",
  masan_jinhae: "622",
  samcheonpo_hadong: "622",
  mokpo: "070",
  gunsan: "080",
  daesan: "621",
  donghae_mukho: "120",
  jeju: "940",
  tongyeong: "622",
  geoje_okpo: "622"
};

let diagnostics = {
  generated_at: null,
  attempted_count: 0,
  success_count: 0,
  failed_count: 0,
  skipped_count: 0,
  real_row_count: 0,
  actionable_row_count: 0,
  fallback_used: false,
  sources: []
};

const FIELD_ALIASES = {
  vessel_name: ["vessel_name", "ship_name", "shipNm", "shipname", "shipName", "vsslNm", "vslNm", "vesselNm", "VSL_NM", "VSSL_NM", "vsslEngNm", "vsslKrnNm", "선박명", "선명"],
  imo: ["imo", "imo_no", "imoNo", "IMO", "IMO_NO", "imoNumber", "imo번호", "IMO번호"],
  mmsi: ["mmsi", "MMSI", "mmsiNo", "mmsi_no"],
  call_sign: ["call_sign", "callSign", "callsign", "CALL_SIGN", "clsgn", "호출부호", "콜사인"],
  port: ["port", "port_name", "portNm", "prtNm", "PORT_NM", "portName", "portCode", "prtAgCd", "항만", "항명", "입항항", "출항항"],
  berth: ["berth", "berth_name", "berthNm", "brthNm", "BERTH_NM", "facilityNm", "terminalNm", "계선장", "선석", "부두", "접안지"],
  anchorage_zone: ["anchorage_zone", "anchorage", "anchorZone", "anchorageNm", "정박지", "묘박지", "대기지"],
  status: ["status", "movement_status", "shipStatus", "sttus", "statusNm", "vsslStatus", "상태", "입출항상태"],
  operator: ["operator", "company", "shippingCompany", "carrierNm", "shipCompany", "owner", "선사", "운항사", "선박회사"],
  agent: ["agent", "agentNm", "agency", "shipAgent", "대리점", "선박대리점"],
  destination: ["destination", "dest", "next_port_country", "DEST", "destNm", "destinationPort", "dstnPrtNm", "목적지", "차항지", "다음항"],
  previous_port: ["previous_port", "prevPort", "last_port", "prevPortNm", "전항", "이전항"],
  next_port: ["next_port", "nextPort", "nextPortNm", "차항", "다음항", "예정항"],
  vessel_type: ["vessel_type", "ship_type", "shipType", "vsslKnd", "shipKnd", "TYPE", "vesselType", "선종", "선박종류"],
  gt: ["gt", "gross_tonnage", "grt", "grossTon", "GT", "grtg", "intrlGrtg", "총톤수", "GRT"],
  grtg: ["grtg", "grt", "gross_tonnage", "grossTon", "GT", "총톤수", "GRT"],
  intrlGrtg: ["intrlGrtg", "internationalGrossTonnage", "intl_gt", "국제총톤수"],
  dwt: ["dwt", "DWT", "deadweight", "deadWeight", "재화중량톤수", "재화톤수"],
  loa: ["loa", "LOA", "lengthOverall", "shipLength", "vsslLt", "전장", "선박길이"],
  beam: ["beam", "BEAM", "breadth", "shipBreadth", "vsslWidth", "폭", "선폭"],
  flag: ["flag", "flagState", "nationality", "shipNationality", "국적", "선적국"],
  eta: ["eta", "ETA", "etaDate", "estimatedArrival", "arrPlanDt", "arrivalPlanDt", "etaDt", "입항예정일시", "입항예정"],
  etb: ["etb", "ETB", "estimatedBerthing", "berthPlanDt", "etbDt", "접안예정일시", "계선예정일시"],
  ata: ["ata", "ATA", "actualArrival", "arrDt", "arrivalDt", "etryptDt", "ETRYPT_DT", "입항일시", "입항일자", "입항시간"],
  atb: ["atb", "ATB", "actualBerthing", "berthDt", "접안일시", "계선일시"],
  etd: ["etd", "ETD", "estimatedDeparture", "depPlanDt", "departurePlanDt", "etdDt", "tkoffPrrrnDt", "TKOFF_PRRRN_DT", "출항예정일시", "출항예정"],
  atd: ["atd", "ATD", "actualDeparture", "depDt", "departureDt", "tkoffDt", "TKOFF_DT", "출항일시", "출항일자"],
  next_port_eta: ["next_port_eta", "destination_eta", "dstnEtryptDt", "DSTN_ETRYPT_DT", "차항입항예정일시", "목적항입항예정일시"],
  speed: ["speed", "sog", "SOG", "속력", "속도"],
  lat: ["lat", "latitude", "LAT", "위도"],
  lon: ["lon", "lng", "longitude", "LON", "LONGITUDE", "경도"],
  course: ["course", "cog", "COG", "침로"],
  heading: ["heading", "hdg", "HDG", "HEDING", "헤딩"],
  received_at: ["received_at", "receivedAt", "수신시각", "수신시간"]
};
function env(name) {
  return process.env[name] && String(process.env[name]).trim();
}

function envAny(...names) {
  for (const name of names) {
    const value = env(name);
    if (value) return value;
  }
  return "";
}

function runtimeEnvDiagnostics() {
  return {
    PORT_OPERATION_API_URL: Boolean(process.env.PORT_OPERATION_API_URL),
    PORT_OPERATION_SERVICE_KEY: Boolean(process.env.PORT_OPERATION_SERVICE_KEY),
    PORT_OPERATION_API_KEY: Boolean(process.env.PORT_OPERATION_API_KEY),
    PORT_FACILITY_API_URL: Boolean(process.env.PORT_FACILITY_API_URL),
    PORT_FACILITY_SERVICE_KEY: Boolean(process.env.PORT_FACILITY_SERVICE_KEY),
    PORT_FACILITY_API_KEY: Boolean(process.env.PORT_FACILITY_API_KEY),
    SERVICE_KEY: Boolean(process.env.SERVICE_KEY),
    SERVICEKEY: Boolean(process.env.SERVICEKEY),
    DATA_GO_KR_API_KEY: Boolean(process.env.DATA_GO_KR_API_KEY),
    COLLECTOR_DEBUG_ONLY: process.env.COLLECTOR_DEBUG_ONLY || ""
  };
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
  return Boolean(source.url && (source.noKeyRequired || source.serviceKey || hasEmbeddedKey(source.url)));
}

function sourceCsvEnabled() {
  return String(process.env.ENABLE_SOURCE_CSV || "").toLowerCase() === "true";
}

function debugVerboseEnabled() {
  return String(process.env.COLLECTOR_DEBUG_VERBOSE || "").toLowerCase() === "true";
}

function formatDateCompact(date = new Date()) {
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  return `${yyyy}${mm}${dd}`;
}

function addDaysCompact(days) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return formatDateCompact(date);
}

function configuredPortOperationCodes() {
  const raw = env("PORT_OPERATION_PORT_CODES") || env("PORT_MIS_PORT_CODES");
  if (!raw) return DEFAULT_PORT_OPERATION_CODES;
  const mapped = { ...DEFAULT_PORT_OPERATION_CODES };
  for (const part of raw.split(/[,\n]+/).map(v => v.trim()).filter(Boolean)) {
    const [name, code] = part.split(/[:=]/).map(v => v?.trim()).filter(Boolean);
    if (name && code) mapped[name.toLowerCase().replace(/[^a-z0-9]+/g, "_")] = code;
  }
  return mapped;
}

function maskServiceKey(url) {
  const copy = new URL(url);
  for (const key of ["serviceKey", "ServiceKey", "service_key", "key", "apiKey", "api_key"]) {
    if (copy.searchParams.has(key)) copy.searchParams.set(key, "***");
  }
  return copy.toString();
}

function serviceKeyVariants(value) {
  const raw = String(value || "").trim();
  if (!raw) return [];
  const variants = [{ name: "as_provided", value: raw }];
  try {
    const decoded = decodeURIComponent(raw);
    if (decoded && decoded !== raw) variants.push({ name: "decoded", value: decoded });
  } catch {
    // Keep only the provided key.
  }
  return variants;
}

function resultMeta(text) {
  const trimmed = String(text || "").trim();
  const meta = {};
  if (trimmed.startsWith("<")) {
    for (const key of ["resultCode", "resultMsg", "totalCount"]) {
      const match = trimmed.match(new RegExp(`<${key}\\b[^>]*>([\\s\\S]*?)<\\/${key}>`, "i"));
      if (match) meta[key] = match[1].replace(/<!\[CDATA\[|\]\]>/g, "").trim();
    }
  } else if (trimmed.startsWith("{")) {
    try {
      const json = JSON.parse(trimmed);
      const header = json.response?.header || json.header || {};
      const body = json.response?.body || json.body || {};
      meta.resultCode = header.resultCode || json.resultCode;
      meta.resultMsg = header.resultMsg || json.resultMsg;
      meta.totalCount = body.totalCount || json.totalCount;
    } catch {
      // Diagnostics only; ignore malformed metadata.
    }
  }
  return meta;
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

function rawValue(row, keys) {
  return String(firstValue(row, keys) || "").trim();
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

function sourceType(source = {}) {
  if (source.key === "mof_ais_dynamic") return "movement_only";
  if (source.key === "mof_ais_info") return "identity";
  if (source.key === "mof_ais_stat") return "traffic_stat";
  if (String(source.key || "").startsWith("mof_vts_")) return "vts_movement";
  if (String(source.key || "").startsWith("port_operation_")) return "schedule_or_berth";
  if (/berth|operation|cargo|terminal|port_operation/i.test(source.key || "")) return "schedule_or_berth";
  return "public_api";
}

function hasScheduleSignal(record = {}) {
  return Boolean(record.eta || record.etb || record.ata || record.atb || record.etd || record.atd || record.berth);
}

function isMovementOnlyRecord(record = {}) {
  return Boolean(record.mmsi && !record.vessel_name && !record.imo && !record.call_sign && !hasScheduleSignal(record));
}

function isActionableRecord(record = {}) {
  if (String(record.source_profile || "") === "movement_only" || isMovementOnlyRecord(record)) return false;
  if (!record.port || record.port === "Korea") return false;
  if (hasScheduleSignal(record)) return true;
  if (record.vessel_name && (record.imo || record.call_sign || record.gt || record.operator)) return true;
  return false;
}

function adaptSourceRecord(row, source) {
  const type = sourceType(source);
  const adapted = { ...row };
  if (String(source.key || "").startsWith("port_operation_")) {
    adapted.prtAgCd = adapted.prtAgCd || source.prtAgCd;
    adapted.port = adapted.port || source.portName || source.prtAgCd;
  }
  if (type === "movement_only" || type === "vts_movement") {
    adapted.status = firstValue(row, FIELD_ALIASES.status) || "Observed movement";
    adapted.port = firstValue(row, FIELD_ALIASES.port) || source.portCode || "";
  }
  if (type === "identity") {
    adapted.status = firstValue(row, FIELD_ALIASES.status) || "Identity observed";
  }
  if (type === "traffic_stat") {
    adapted.status = firstValue(row, FIELD_ALIASES.status) || "Traffic statistic";
  }
  return adapted;
}

function allSourceConfigs() {
  const vtsBase = env("MOF_VTS_API_BASE");
  const vtsKey = env("MOF_VTS_SERVICE_KEY");
  const sde = env("PORT_OPERATION_START_DATE") || addDaysCompact(-3);
  const ede = env("PORT_OPERATION_END_DATE") || addDaysCompact(7);
  const portOperationUrl = env("PORT_OPERATION_API_URL") || DEFAULT_PORT_OPERATION_API_URL;
  const portOperationKey = envAny("PORT_OPERATION_SERVICE_KEY", "PORT_OPERATION_API_KEY", "DATA_GO_KR_API_KEY", "SERVICE_KEY", "SERVICEKEY");
  const portOperationDirections = (env("PORT_OPERATION_DEGB_VALUES") || "I,O")
    .split(/[,\s]+/)
    .map(value => value.trim())
    .filter(Boolean);
  const portOperationSources = Object.entries(configuredPortOperationCodes()).flatMap(([name, code]) => portOperationDirections.map(deGb => ({
    key: `port_operation_${name}_${deGb.toLowerCase()}`,
    label: `PORT-MIS VsslEtrynd5 ${name} ${deGb}`,
    url: portOperationUrl,
    serviceKey: portOperationKey,
    serviceKeyVariants: serviceKeyVariants(portOperationKey),
    portName: name,
    prtAgCd: code,
    noTypeParam: true,
    defaultParams: {
      prtAgCd: code,
      sde,
      ede,
      deGb,
      pageNo: "1",
      numOfRows: env("PORT_OPERATION_NUM_OF_ROWS") || "50"
    }
  })));
  const vtsCodes = (env("MOF_VTS_PORT_CODES") || "BUSAN,YEOSU,GWANGYANG,ULSAN,PYEONGTAEK,POHANG,HADONG,MASAN,INCHEON")
    .split(/[,\s]+/)
    .map(code => code.trim())
    .filter(Boolean);

  return [
    { key: "source_csv", label: "Core external snapshot CSV", url: sourceCsvEnabled() ? env("SOURCE_CSV_URL") : "", serviceKey: null, noKeyRequired: true, disabledReason: "disabled_by_default_enable_source_csv_true", maxRows: MAX_SOURCE_ROWS },
    ...portOperationSources,
    { key: "ulsan_core", label: "Ulsan core", url: env("ULSAN_API_URL"), serviceKey: env("ULSAN_API_KEY") },
    { key: "ulsan_berth_detail", label: "Ulsan berth detail", url: env("ULSAN_BERTH_DETAIL_API_URL"), serviceKey: env("ULSAN_BERTH_DETAIL_API_KEY") },
    { key: "ulsan_cargo_plan", label: "Ulsan cargo plan", url: env("ULSAN_CARGO_PLAN_API_URL"), serviceKey: env("ULSAN_CARGO_PLAN_API_KEY") },
    { key: "ulsan_berth_operation", label: "Ulsan berth operation", url: env("ULSAN_BERTH_OPERATION_API_URL"), serviceKey: env("ULSAN_BERTH_OPERATION_API_KEY") },
    { key: "ulsan_terminal_process", label: "Ulsan terminal process", url: env("ULSAN_TERMINAL_PROCESS_API_URL"), serviceKey: env("ULSAN_TERMINAL_PROCESS_API_KEY") },
    { key: "mof_ais_dynamic", label: "MOF AIS dynamic", url: env("MOF_AIS_DYNAMIC_API_URL"), serviceKey: env("MOF_AIS_DYNAMIC_SERVICE_KEY"), maxRows: Math.min(Number(env("MOF_AIS_DYNAMIC_PER_PAGE") || MAX_SOURCE_ROWS), MAX_SOURCE_ROWS) },
    { key: "mof_ais_info", label: "MOF AIS info", url: env("MOF_AIS_INFO_API_URL"), serviceKey: env("MOF_AIS_INFO_SERVICE_KEY"), maxRows: Math.min(Number(env("MOF_AIS_INFO_PER_PAGE") || MAX_SOURCE_ROWS), MAX_SOURCE_ROWS) },
    { key: "mof_ais_stat", label: "MOF AIS stat", url: env("MOF_AIS_STAT_API_URL"), serviceKey: env("MOF_AIS_STAT_SERVICE_KEY"), maxRows: Math.min(Number(env("MOF_AIS_STAT_PER_PAGE") || MAX_SOURCE_ROWS), MAX_SOURCE_ROWS) },
    { key: "korea_public_data", label: "Korea public data auxiliary source", url: env("KOREA_PORTMIS_BASE_URL"), serviceKey: env("PORTMIS_API_KEY") || env("PORT_MIS_API_KEY") || env("DATA_GO_KR_API_KEY") || env("SERVICE_KEY") || env("SERVICEKEY") },
    ...((vtsBase && vtsKey) ? vtsCodes.map(code => ({ key: `mof_vts_${code.toLowerCase()}`, label: `Integrated VTS ${code}`, url: vtsBase, serviceKey: vtsKey, portCode: code })) : [])
  ];
}

function buildUrl(source, extraParams = {}) {
  const url = new URL(source.url);
  if (source.serviceKey && !["serviceKey", "ServiceKey", "service_key", "key", "apiKey", "api_key"].some(key => url.searchParams.has(key))) {
    url.searchParams.set("serviceKey", source.serviceKey);
  }
  if (!source.noKeyRequired) {
    if (!source.noTypeParam && !url.searchParams.has("_type")) url.searchParams.set("_type", "json");
    if (!url.searchParams.has("pageNo")) url.searchParams.set("pageNo", "1");
    if (!url.searchParams.has("numOfRows")) url.searchParams.set("numOfRows", String(Math.min(MAX_OUTPUT_ROWS, 100)));
    if (source.portCode && !url.searchParams.has("portCode")) url.searchParams.set("portCode", source.portCode);
  }
  for (const [key, value] of Object.entries(source.defaultParams || {})) {
    if (value !== undefined && value !== null && String(value).trim() !== "") url.searchParams.set(key, String(value).trim());
  }
  for (const [key, value] of Object.entries(extraParams)) {
    if (value !== undefined && value !== null && String(value).trim() !== "") url.searchParams.set(key, String(value).trim());
  }
  return url;
}

function decodeResponse(buffer, contentType = "") {
  const declared = String(contentType || "").toLowerCase();
  const candidates = declared.includes("euc-kr") || declared.includes("ks_c_5601") || declared.includes("cp949")
    ? ["euc-kr", "utf-8"]
    : ["utf-8", "euc-kr"];
  for (const encoding of candidates) {
    try {
      const text = new TextDecoder(encoding).decode(buffer);
      return text;
    } catch {
      // Try the next encoding.
    }
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(buffer);
}

async function fetchText(source, extraParams = {}) {
  const variants = source.serviceKeyVariants?.length ? source.serviceKeyVariants : [{ name: "default", value: source.serviceKey }];
  let lastError = null;
  for (const variant of variants) {
    const sourceVariant = { ...source, serviceKey: variant.value };
    try {
      const result = await fetchTextOnce(sourceVariant, extraParams);
      return { ...result, service_key_variant: variant.name };
    } catch (error) {
      lastError = error;
      if (!source.serviceKeyVariants?.length) break;
    }
  }
  throw lastError || new Error("request_failed");
}

async function fetchTextOnce(source, extraParams = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SOURCE_TIMEOUT_MS);
  try {
    const url = buildUrl(source, extraParams);
    const started = Date.now();
    const res = await fetch(url, { signal: controller.signal, headers: { accept: "application/json, text/csv, text/xml, */*" } });
    const buffer = await res.arrayBuffer();
    const text = decodeResponse(buffer, res.headers.get("content-type") || "");
    if (!res.ok) {
      const error = new Error(`HTTP ${res.status}`);
      error.http_status = res.status;
      error.response_text = text.slice(0, 500);
      throw error;
    }
    return { text, url, http_status: res.status, latency_ms: Date.now() - started, result_meta: resultMeta(text) };
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

function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function expandDetailRows(row = {}) {
  const details = row.details?.detail ?? row.detail ?? row.details;
  const detailRows = asArray(details).filter(detail => detail && typeof detail === "object" && !Array.isArray(detail));
  if (!detailRows.length) return [row];
  const { details: _details, detail: _detail, ...parent } = row;
  return detailRows.map((detail, index) => ({
    ...parent,
    ...detail,
    _detail_rows_flattened: true,
    _detail_row_index: index + 1,
    _detail_row_count: detailRows.length
  }));
}

function expandRowsWithDetails(rows = []) {
  return rows.flatMap(row => row && typeof row === "object" ? expandDetailRows(row) : []);
}

function parseXmlRows(text) {
  const rows = [];
  for (const match of text.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)) {
    const row = {};
    const body = match[1];
    const detailRows = [];
    for (const detailMatch of body.matchAll(/<detail\b[^>]*>([\s\S]*?)<\/detail>/gi)) {
      const detail = {};
      for (const field of detailMatch[1].matchAll(/<([^!?\/][^>\s]*)[^>]*>([\s\S]*?)<\/\1>/g)) {
        const value = field[2].replace(/<!\[CDATA\[|\]\]>/g, "").trim();
        if (!/<[^>]+>/.test(value)) detail[field[1]] = value;
      }
      if (Object.keys(detail).length) detailRows.push(detail);
    }
    for (const field of body.matchAll(/<([^!?\/][^>\s]*)[^>]*>([\s\S]*?)<\/\1>/g)) {
      const value = field[2].replace(/<!\[CDATA\[|\]\]>/g, "").trim();
      if (!/<[^>]+>/.test(value)) row[field[1]] = value;
    }
    if (detailRows.length) {
      detailRows.forEach((detail, index) => rows.push({
        ...row,
        ...detail,
        _detail_rows_flattened: true,
        _detail_row_index: index + 1,
        _detail_row_count: detailRows.length
      }));
    } else if (Object.keys(row).length) rows.push(row);
  }
  if (rows.length) return rows;
  const containers = ["row", "list", "data", "record"];
  for (const tag of containers) {
    for (const match of text.matchAll(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "gi"))) {
      const row = {};
      for (const field of match[1].matchAll(/<([^!?\/][^>\s]*)[^>]*>([\s\S]*?)<\/\1>/g)) {
        const value = field[2].replace(/<!\[CDATA\[|\]\]>/g, "").trim();
        if (!/<[^>]+>/.test(value)) row[field[1]] = value;
      }
      if (Object.keys(row).length) rows.push(row);
    }
    if (rows.length) return rows;
  }
  return rows;
}

function parseCsvRows(text, limit = MAX_SOURCE_ROWS) {
  const rows = [];
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter(line => line.trim());
  if (lines.length < 2) return rows;
  const parseLine = line => {
    const out = [];
    let current = "";
    let quoted = false;
    for (let i = 0; i < line.length; i += 1) {
      const char = line[i];
      const next = line[i + 1];
      if (char === '"' && quoted && next === '"') {
        current += '"';
        i += 1;
      } else if (char === '"') {
        quoted = !quoted;
      } else if (char === "," && !quoted) {
        out.push(current.trim());
        current = "";
      } else {
        current += char;
      }
    }
    out.push(current.trim());
    return out;
  };
  const headers = parseLine(lines[0]);
  for (const line of lines.slice(1, limit + 1)) {
    const values = parseLine(line);
    const row = {};
    headers.forEach((header, index) => {
      row[header] = values[index] ?? "";
    });
    rows.push(row);
  }
  return rows;
}

function parseRows(text, limit = MAX_SOURCE_ROWS) {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return expandRowsWithDetails(flattenJson(JSON.parse(trimmed)).filter(row => row && typeof row === "object")).slice(0, limit);
  if (trimmed.startsWith("<")) return parseXmlRows(trimmed).slice(0, limit);
  if (/^[^\n,]+,/.test(trimmed) || trimmed.includes("\n")) {
    const csvRows = parseCsvRows(trimmed, limit);
    if (csvRows.length) return csvRows;
  }
  return parseXmlRows(trimmed).slice(0, limit);
}

async function fetchPagedRows(source, rowLimit) {
  const firstPage = await fetchText(source);
  const rows = parseRows(firstPage.text, rowLimit);
  const pageSize = Number(source.defaultParams?.numOfRows || 0) || rowLimit;
  const totalCount = Number(firstPage.result_meta?.totalCount || rows.length || 0);
  const maxPages = Math.max(1, Number(env("PORT_OPERATION_MAX_PAGES") || 20));
  const isPortOperation = String(source.key || "").startsWith("port_operation_");
  const totalPagesExpected = totalCount ? Math.ceil(totalCount / Math.max(1, pageSize)) : 1;
  const totalPagesToCollect = isPortOperation ? Math.min(maxPages, totalPagesExpected) : 1;
  const shouldPage = isPortOperation && totalPagesToCollect > 1;
  const pageSummaries = [{
    pageNo: Number(source.defaultParams?.pageNo || 1),
    row_count: rows.length,
    http_status: firstPage.http_status,
    resultCode: firstPage.result_meta?.resultCode || null,
    totalCount: firstPage.result_meta?.totalCount || null,
    requested_url_without_service_key: maskServiceKey(firstPage.url)
  }];

  let last = firstPage;
  if (shouldPage) {
    for (let pageNo = 2; pageNo <= totalPagesToCollect; pageNo += 1) {
      if (rows.length >= rowLimit) break;
      const page = await fetchText(source, { pageNo });
      const pageRows = parseRows(page.text, Math.max(1, rowLimit - rows.length));
      rows.push(...pageRows);
      pageSummaries.push({
        pageNo,
        row_count: pageRows.length,
        http_status: page.http_status,
        resultCode: page.result_meta?.resultCode || null,
        totalCount: page.result_meta?.totalCount || null,
        requested_url_without_service_key: maskServiceKey(page.url)
      });
      last = page;
      if (!pageRows.length) break;
    }
  }

  return {
    ...last,
    text: firstPage.text,
    url: firstPage.url,
    http_status: firstPage.http_status,
    latency_ms: pageSummaries.reduce((sum, page) => sum + Number(page.latency_ms || 0), firstPage.latency_ms || 0),
    result_meta: firstPage.result_meta,
    service_key_variant: firstPage.service_key_variant || last.service_key_variant,
    rows: rows.slice(0, rowLimit),
    pages_attempted: pageSummaries.length,
    page_summaries: pageSummaries,
    pagination_total_count: totalCount || rows.length,
    pagination_total_pages_expected: totalPagesExpected,
    pagination_pages_collected: pageSummaries.length,
    pagination_rows_collected: rows.length,
    pagination_truncated: Boolean(
      (totalCount && rows.length < totalCount) ||
      (isPortOperation && totalPagesExpected > maxPages) ||
      rows.length >= rowLimit
    )
  };
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
  if (text === "020" || /busan/i.test(text)) return "Busan";
  if (text === "030" || /incheon/i.test(text)) return "Incheon";
  if (text === "620" || /yeosu_gwangyang/i.test(text)) return "Yeosu/Gwangyang";
  if (text === "820" || /ulsan/i.test(text)) return "Ulsan";
  if (text === "031" || /pyeongtaek_dangjin/i.test(text)) return "Pyeongtaek-Dangjin";
  if (text === "810" || /pohang/i.test(text)) return "Pohang";
  if (text === "622" || /masan_jinhae/i.test(text)) return "Masan/Jinhae";
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


function portCodeFromName(port = "") {
  const text = String(port || "").toLowerCase();
  if (/busan|부산/.test(text)) return "020";
  if (/incheon|인천/.test(text)) return "030";
  if (/yeosu|gwangyang|여수|광양/.test(text)) return "620";
  if (/ulsan|울산/.test(text)) return "820";
  if (/pyeongtaek|dangjin|평택|당진/.test(text)) return "031";
  if (/pohang|포항/.test(text)) return "810";
  if (/mokpo|목포/.test(text)) return "070";
  if (/gunsan|군산/.test(text)) return "080";
  if (/daesan|대산/.test(text)) return "621";
  if (/donghae|mukho|동해|묵호/.test(text)) return "120";
  if (/jeju|제주/.test(text)) return "940";
  if (/masan|jinhae|samcheonpo|hadong|tongyeong|geoje|okpo|마산|진해|삼천포|하동|통영|거제|옥포/.test(text)) return "622";
  return "";
}
function normalizeRow(row, source, now) {
  const adapted = adaptSourceRecord(row, source);
  const sourceProfile = sourceType(source);
  const vesselName = String(firstValue(adapted, FIELD_ALIASES.vessel_name)).trim();
  const imo = String(firstValue(adapted, FIELD_ALIASES.imo)).trim();
  const mmsi = String(firstValue(adapted, FIELD_ALIASES.mmsi)).trim();
  const callSign = String(firstValue(adapted, FIELD_ALIASES.call_sign)).trim();
  const port = normalizePort(firstValue(adapted, FIELD_ALIASES.port), source.portCode);
  if (!vesselName && !imo && !mmsi && !callSign) return null;

  const record = {
    vessel_id: imo ? `IMO-${imo}` : mmsi ? `MMSI-${mmsi}` : callSign ? `CALL-${callSign}` : `${vesselName}-${port}`,
    vessel_name: vesselName || imo || mmsi || callSign,
    imo,
    mmsi,
    call_sign: callSign,
    port,
    port_code: source.prtAgCd || rawValue(adapted, ["prtAgCd", "portCode", "prtCd"]) || portCodeFromName(port),
    port_name: port,
    berth: String(firstValue(adapted, FIELD_ALIASES.berth)).trim(),
    berth_name: String(firstValue(adapted, FIELD_ALIASES.berth)).trim(),
    anchorage_zone: String(firstValue(adapted, FIELD_ALIASES.anchorage_zone)).trim(),
    anchorage_name: String(firstValue(adapted, FIELD_ALIASES.anchorage_zone)).trim(),
    laidupFcltyNm: String(rawValue(adapted, ["laidupFcltyNm", "laidup_fclty_nm", "LAYDUP_FCLTY_NM", "계선시설명", "계선장명", "시설명", "fcltyNm", "facilityNm"])).trim(),
    facility_code: String(rawValue(adapted, ["laidupFcltyCd", "laidup_fclty_cd", "LAYDUP_FCLTY_CD", "fcltyCd", "facilityCd", "시설코드"])).trim(),
    status: normalizeStatus(firstValue(adapted, FIELD_ALIASES.status)),
    operator: String(firstValue(adapted, FIELD_ALIASES.operator)).trim(),
    agent: String(firstValue(adapted, FIELD_ALIASES.agent)).trim(),
    destination: String(firstValue(adapted, FIELD_ALIASES.destination)).trim(),
    previous_port: String(firstValue(adapted, FIELD_ALIASES.previous_port)).trim(),
    next_port: String(firstValue(adapted, FIELD_ALIASES.next_port)).trim(),
    vessel_type: String(firstValue(adapted, FIELD_ALIASES.vessel_type)).trim() || "Unknown",
    gt: toNumber(firstValue(adapted, FIELD_ALIASES.gt)),
    grtg: toNumber(firstValue(adapted, FIELD_ALIASES.grtg)),
    intrlGrtg: toNumber(firstValue(adapted, FIELD_ALIASES.intrlGrtg)),
    dwt: toNumber(firstValue(adapted, FIELD_ALIASES.dwt)),
    loa: toNumber(firstValue(adapted, FIELD_ALIASES.loa)),
    beam: toNumber(firstValue(adapted, FIELD_ALIASES.beam)),
    flag: String(firstValue(adapted, FIELD_ALIASES.flag)).trim(),
    eta: normalizeDate(firstValue(adapted, FIELD_ALIASES.eta)),
    etb: normalizeDate(firstValue(adapted, FIELD_ALIASES.etb)),
    ata: normalizeDate(firstValue(adapted, FIELD_ALIASES.ata)),
    atb: normalizeDate(firstValue(adapted, FIELD_ALIASES.atb)),
    etd: normalizeDate(firstValue(adapted, FIELD_ALIASES.etd)),
    atd: normalizeDate(firstValue(adapted, FIELD_ALIASES.atd)),
    next_port_eta: normalizeDate(firstValue(adapted, FIELD_ALIASES.next_port_eta)),
    destination_eta: normalizeDate(firstValue(adapted, FIELD_ALIASES.next_port_eta)),
    speed: toNumber(firstValue(adapted, FIELD_ALIASES.speed)),
    lat: toNumber(firstValue(adapted, FIELD_ALIASES.lat)),
    lon: toNumber(firstValue(adapted, FIELD_ALIASES.lon)),
    course: toNumber(firstValue(adapted, FIELD_ALIASES.course)),
    heading: toNumber(firstValue(adapted, FIELD_ALIASES.heading)),
    risk_score: 45,
    source: source.key,
    source_label: source.label,
    source_profile: sourceProfile,
    detail_rows_flattened: Boolean(adapted._detail_rows_flattened),
    detail_row_index: adapted._detail_row_index || null,
    detail_row_count: adapted._detail_row_count || null,
    source_mode: "real_public_api_snapshot",
    data_confidence: "source_configured",
    raw_source_keys: Object.keys(row).slice(0, 80),
    prt_ag_cd: rawValue(row, ["prtAgCd", "prt_ag_cd", "PRT_AG_CD"]),
    etrypt_year: rawValue(row, ["etryptYear", "etrypt_year", "ETRYPT_YEAR"]),
    etrypt_co: rawValue(row, ["etryptCo", "etrypt_co", "ETRYPT_CO"]),
    de_gb: rawValue(row, ["deGb", "DE_GB"]) || source.defaultParams?.deGb || "",
    raw_row_identity: "",
    port_call_identity: "",
    vessel_identity: "",
    updated_at: now
  };
  const eventTime = record.atd || record.etd || record.ata || record.eta || record.next_port_eta || "";
  record.port_call_identity = [
    record.prt_ag_cd || record.port_code,
    record.etrypt_year,
    record.etrypt_co,
    record.call_sign
  ].map(value => String(value || "").trim().toUpperCase()).join("|");
  if (!record.port_call_identity.replace(/\|/g, "")) {
    record.port_call_identity = [
      record.port_code || record.port,
      record.call_sign || record.vessel_name,
      eventTime
    ].map(value => String(value || "").trim().toUpperCase()).join("|");
  }
  record.raw_row_identity = [
    record.prt_ag_cd || record.port_code,
    record.etrypt_year,
    record.etrypt_co,
    record.call_sign,
    record.de_gb,
    record.detail_row_index || "",
    eventTime
  ].map(value => String(value || "").trim().toUpperCase()).join("|");
  record.vessel_identity = record.imo
    ? `IMO-${record.imo}`
    : record.mmsi
      ? `MMSI-${record.mmsi}`
      : record.call_sign
        ? `CALL-${record.call_sign}`
        : [record.vessel_name, record.gt || record.grtg || record.intrlGrtg || "", record.vessel_type || ""].map(value => String(value || "").trim().toUpperCase()).join("|");
  record.gt = record.gt || record.grtg || record.intrlGrtg || 0;
  record.actionable_source_row = isActionableRecord(record);
  record.sales_ready_input = record.actionable_source_row;
  if (!record.actionable_source_row && isMovementOnlyRecord(record)) {
    record.data_confidence = "movement_only_not_sales_ready";
  }
  return record;
}

function mergeValue(current, next) {
  return current !== undefined && current !== null && String(current).trim() !== "" && current !== 0 ? current : next;
}

function mergePortCallRecord(existing, incoming) {
  const merged = { ...existing };
  for (const [key, value] of Object.entries(incoming)) {
    if (["source", "source_label", "source_profile", "de_gb", "raw_row_identity", "raw_source_references", "source_children"].includes(key)) continue;
    merged[key] = mergeValue(merged[key], value);
  }
  merged.eta = mergeValue(merged.eta, incoming.eta);
  merged.etb = mergeValue(merged.etb, incoming.etb);
  merged.ata = mergeValue(merged.ata, incoming.ata);
  merged.atb = mergeValue(merged.atb, incoming.atb);
  merged.etd = mergeValue(merged.etd, incoming.etd);
  merged.atd = mergeValue(merged.atd, incoming.atd);
  merged.next_port_eta = mergeValue(merged.next_port_eta, incoming.next_port_eta);
  merged.destination_eta = mergeValue(merged.destination_eta, incoming.destination_eta);
  merged.gt = Math.max(Number(merged.gt || 0), Number(incoming.gt || 0));
  merged.grtg = Math.max(Number(merged.grtg || 0), Number(incoming.grtg || 0));
  merged.intrlGrtg = Math.max(Number(merged.intrlGrtg || 0), Number(incoming.intrlGrtg || 0));
  merged.source = existing.source === incoming.source ? existing.source : "merged_port_operation";
  merged.source_label = "Merged Port Operation port call";
  merged.source_profile = existing.source_profile || incoming.source_profile;
  merged.de_gb_values = [...new Set([...(existing.de_gb_values || [existing.de_gb].filter(Boolean)), incoming.de_gb].filter(Boolean))];
  merged.raw_source_references = [
    ...(existing.raw_source_references || [existing.raw_row_identity].filter(Boolean)),
    incoming.raw_row_identity
  ].filter(Boolean);
  merged.source_children = [...new Set([...(existing.source_children || []), ...(incoming.source_children || [])])];
  merged.raw_row_count = Number(existing.raw_row_count || 1) + 1;
  merged.detail_rows_flattened_count = Number(existing.detail_rows_flattened_count || (existing.detail_rows_flattened ? 1 : 0)) + (incoming.detail_rows_flattened ? 1 : 0);
  merged.detail_rows_flattened = Boolean(merged.detail_rows_flattened_count);
  merged.actionable_source_row = Boolean(existing.actionable_source_row || incoming.actionable_source_row);
  merged.sales_ready_input = Boolean(existing.sales_ready_input || incoming.sales_ready_input);
  return merged;
}

function dedupe(records) {
  const rawSeen = new Set();
  const portCalls = new Map();
  const vessels = new Set();
  let duplicateRawRows = 0;

  for (const record of records) {
    if (record.raw_row_identity && rawSeen.has(record.raw_row_identity)) {
      duplicateRawRows += 1;
      continue;
    }
    if (record.raw_row_identity) rawSeen.add(record.raw_row_identity);
    if (record.vessel_identity) vessels.add(record.vessel_identity);
    const key = String(record.port_call_identity || [record.vessel_id, record.port, record.eta, record.ata, record.berth].join("|")).toLowerCase();
    const existing = portCalls.get(key);
    portCalls.set(key, existing ? mergePortCallRecord(existing, record) : {
      ...record,
      raw_row_count: 1,
      de_gb_values: [record.de_gb].filter(Boolean),
      raw_source_references: [record.raw_row_identity].filter(Boolean),
      detail_rows_flattened_count: record.detail_rows_flattened ? 1 : 0
    });
  }

  const merged = [...portCalls.values()];
  const capped = merged.slice(0, MAX_OUTPUT_ROWS);
  diagnostics.count_funnel = {
    raw_api_rows: records.length,
    detail_rows_flattened: records.filter(record => record.detail_rows_flattened).length,
    normalized_rows: records.length,
    duplicate_raw_rows: duplicateRawRows,
    unique_port_calls: merged.length,
    unique_vessels: vessels.size,
    capped_by_limit: merged.length > MAX_OUTPUT_ROWS,
    cap_name: merged.length > MAX_OUTPUT_ROWS ? "MAX_OUTPUT_ROWS" : null,
    cap_value: MAX_OUTPUT_ROWS
  };
  return capped;
}

function cargoHarborUseParams(row = {}, record = {}) {
  const prtAgCd = rawValue(row, ["prtAgCd", "prt_ag_cd", "PRT_AG_CD"]) || record.prt_ag_cd;
  const etryptYear = rawValue(row, ["etryptYear", "etrypt_year", "ETRYPT_YEAR"]) || record.etrypt_year;
  const etryptCo = rawValue(row, ["etryptCo", "etrypt_co", "ETRYPT_CO"]) || record.etrypt_co;
  const clsgn = rawValue(row, ["clsgn", "callSign", "call_sign", "CALL_SIGN"]) || record.call_sign;
  if (!prtAgCd || !etryptYear || !etryptCo || !clsgn) return null;
  return { prtAgCd, etryptYear, etryptCo, clsgn };
}

function mergeCargoHarborUse(record, rows = []) {
  const detail = rows.find(row => row && typeof row === "object") || {};
  if (!Object.keys(detail).length) return record;
  return {
    ...record,
    berth: record.berth || String(firstValue(detail, FIELD_ALIASES.berth)).trim(),
    status: record.status === "Observed" ? normalizeStatus(firstValue(detail, FIELD_ALIASES.status)) : record.status,
    eta: record.eta || normalizeDate(firstValue(detail, FIELD_ALIASES.eta)),
    etb: record.etb || normalizeDate(firstValue(detail, FIELD_ALIASES.etb)),
    ata: record.ata || normalizeDate(firstValue(detail, FIELD_ALIASES.ata)),
    atb: record.atb || normalizeDate(firstValue(detail, FIELD_ALIASES.atb)),
    etd: record.etd || normalizeDate(firstValue(detail, FIELD_ALIASES.etd)),
    atd: record.atd || normalizeDate(firstValue(detail, FIELD_ALIASES.atd)),
    operator: record.operator || String(firstValue(detail, FIELD_ALIASES.operator)).trim(),
    agent: record.agent || String(firstValue(detail, FIELD_ALIASES.agent)).trim(),
    dwt: record.dwt || toNumber(firstValue(detail, FIELD_ALIASES.dwt)),
    loa: record.loa || toNumber(firstValue(detail, FIELD_ALIASES.loa)),
    beam: record.beam || toNumber(firstValue(detail, FIELD_ALIASES.beam)),
    flag: record.flag || String(firstValue(detail, FIELD_ALIASES.flag)).trim(),
    destination: record.destination || String(firstValue(detail, FIELD_ALIASES.destination)).trim(),
    source_children: [...(record.source_children || []), "carg_harbor_use"],
    cargo_harbor_use_count: rows.length,
    cargo_harbor_use_enriched: true,
    raw_cargo_harbor_use_keys: Object.keys(detail).slice(0, 80)
  };
}

async function enrichWithCargoHarborUse(rawRow, record, now) {
  const params = cargoHarborUseParams(rawRow, record);
  if (!params) return { record, status: "missing_parent_keys", row_count: 0, normalized_count: 0 };
  const source = {
    key: "port_facility_enrichment",
    label: "CargHarborUse2 child enrichment",
    url: env("PORT_FACILITY_API_URL") || DEFAULT_CARGO_HARBOR_USE_API_URL,
    serviceKey: envAny("PORT_FACILITY_SERVICE_KEY", "PORT_FACILITY_API_KEY", "PORT_OPERATION_SERVICE_KEY", "PORT_OPERATION_API_KEY", "DATA_GO_KR_API_KEY", "SERVICE_KEY", "SERVICEKEY"),
    noTypeParam: true
  };
  if (!canAttempt(source)) return { record, status: "missing_service_key_or_embedded_key", row_count: 0, normalized_count: 0 };
  try {
    const { text, http_status, result_meta, url } = await fetchText(source, params);
    const rows = parseRows(text, 5);
    const enriched = mergeCargoHarborUse(record, rows);
    enriched.actionable_source_row = isActionableRecord(enriched);
    enriched.sales_ready_input = enriched.actionable_source_row;
    enriched.updated_at = enriched.updated_at || now;
    return {
      record: enriched,
      status: "success",
      row_count: rows.length,
      normalized_count: rows.length ? 1 : 0,
      http_status,
      result_meta,
      requested_url_without_service_key: maskServiceKey(url)
    };
  } catch (error) {
    return { record, status: `failed:${error?.message || String(error)}`, row_count: 0, normalized_count: 0, http_status: error?.http_status || null };
  }
}

async function collectRealRows() {
  const now = new Date().toISOString();
  const deadline = Date.now() + COLLECTOR_RUNTIME_BUDGET_MS;
  const records = [];
  let totalChildEnrichmentAttempts = 0;
  diagnostics = { generated_at: now, attempted_count: 0, success_count: 0, failed_count: 0, skipped_count: 0, real_row_count: 0, actionable_row_count: 0, fallback_used: false, env_presence: runtimeEnvDiagnostics(), sources: [] };
  if (env("COLLECTOR_DEBUG_ONLY") || debugVerboseEnabled()) {
    console.log("[HWK] collector env presence", JSON.stringify(runtimeEnvDiagnostics()));
  }

  const debugOnly = env("COLLECTOR_DEBUG_ONLY");
  for (const source of allSourceConfigs().filter(source => !debugOnly || source.key === debugOnly)) {
    const diag = {
      key: source.key,
      label: source.label,
      source_profile: sourceType(source),
      attempted: false,
      skipped: false,
      success: false,
      row_count: 0,
      normalized_count: 0,
      actionable_count: 0,
      prtAgCd: source.prtAgCd || null,
      sde: source.defaultParams?.sde || null,
      ede: source.defaultParams?.ede || null
    };
    if (Date.now() > deadline) {
      diag.skipped = true;
      diag.reason = "runtime_budget_exceeded";
      diagnostics.skipped_count += 1;
      diagnostics.sources.push(diag);
      continue;
    }
    if (!source.url) {
      diag.skipped = true;
      diag.reason = source.disabledReason || "missing_url";
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
      const rowLimit = Math.max(1, Math.min(Number(source.maxRows || MAX_SOURCE_ROWS), MAX_SOURCE_ROWS));
      const { text, url, http_status, latency_ms, result_meta, service_key_variant, rows, pages_attempted, page_summaries, pagination_total_count, pagination_total_pages_expected, pagination_pages_collected, pagination_rows_collected, pagination_truncated } = await fetchPagedRows(source, rowLimit);
      diag.success = true;
      diag.latency_ms = latency_ms;
      diag.http_status = http_status;
      diag.requested_url_without_service_key = maskServiceKey(url);
      diag.service_key_variant = service_key_variant;
      if (debugVerboseEnabled()) diag.raw_response_preview = text.slice(0, 500);
      diag.resultCode = result_meta?.resultCode || null;
      diag.resultMsg = result_meta?.resultMsg || null;
      diag.totalCount = result_meta?.totalCount !== undefined ? Number(result_meta.totalCount) || result_meta.totalCount : null;
      diag.pages_attempted = pages_attempted;
      diag.totalPages_expected = pagination_total_pages_expected;
      diag.pages_collected = pagination_pages_collected;
      diag.rows_collected = pagination_rows_collected;
      diag.page_summaries = page_summaries;
      diag.pagination_total_count = pagination_total_count;
      diag.row_count = rows.length;
      diag.max_rows = rowLimit;
      diag.truncated = pagination_truncated || rows.length >= rowLimit;
      diag.capped_by_limit = rows.length >= rowLimit;
      diag.cap_name = rows.length >= rowLimit ? "MAX_SOURCE_ROWS" : null;
      diag.cap_value = rows.length >= rowLimit ? rowLimit : null;
      diag.url_host = url.host;
      diag.sample_keys = rows[0] && typeof rows[0] === "object" ? Object.keys(rows[0]).slice(0, 30) : [];
      let childAttempted = 0;
      let childSuccess = 0;
      let childRows = 0;
      let childNormalized = 0;
      let childSkippedByLimit = 0;
      const childStatuses = new Map();
      for (const row of rows) {
        let normalized = normalizeRow(row, source, now);
        if (normalized && String(source.key || "").startsWith("port_operation_")) {
          if (totalChildEnrichmentAttempts >= MAX_CHILD_ENRICHMENT_ROWS) {
            childSkippedByLimit += 1;
            childStatuses.set("skipped:enrichment_limit", (childStatuses.get("skipped:enrichment_limit") || 0) + 1);
            records.push(normalized);
            continue;
          }
          childAttempted += 1;
          totalChildEnrichmentAttempts += 1;
          const child = await enrichWithCargoHarborUse(row, normalized, now);
          normalized = child.record;
          childRows += child.row_count || 0;
          childNormalized += child.normalized_count || 0;
          if (child.status === "success") childSuccess += 1;
          childStatuses.set(child.status, (childStatuses.get(child.status) || 0) + 1);
        }
        if (normalized) records.push(normalized);
      }
      const sourceRecords = records.filter(record => record.source === source.key);
      diag.normalized_count = sourceRecords.length;
      diag.actionable_count = sourceRecords.filter(record => record.actionable_source_row).length;
      diag.detail_rows_flattened_count = sourceRecords.filter(record => record.detail_rows_flattened).length;
      diag.detail_rows_missing_time_count = sourceRecords.filter(record => record.detail_rows_flattened && !record.eta && !record.etd && !record.ata && !record.atd && !record.etb && !record.atb).length;
      diag.ata_detected_count = sourceRecords.filter(record => record.ata).length;
      diag.atd_detected_count = sourceRecords.filter(record => record.atd).length;
      diag.etd_detected_count = sourceRecords.filter(record => record.etd).length;
      diag.eta_detected_count = sourceRecords.filter(record => record.eta).length;
      if (String(source.key || "").startsWith("port_operation_")) {
        diag.child_enrichment = {
          key: "port_facility_enrichment",
          rule: "CargHarborUse2 is called only with parent prtAgCd + etryptYear + etryptCo + clsgn from VsslEtrynd5.",
          attempted: childAttempted,
          success: childSuccess,
          rows: childRows,
          normalized: childNormalized,
          skipped_by_limit: childSkippedByLimit,
          max_total_attempts: MAX_CHILD_ENRICHMENT_ROWS,
          statuses: Object.fromEntries(childStatuses)
        };
      }
      if (diag.row_count > 0 && diag.normalized_count === 0) {
        diag.warning = "source_returned_rows_but_no_vessel_identity_fields_matched";
      }
      diagnostics.success_count += 1;
    } catch (error) {
      diag.error = error?.message || String(error);
      diag.http_status = error?.http_status || null;
      diagnostics.failed_count += 1;
    }
    diagnostics.sources.push(diag);
  }
  const deduped = dedupe(records);
  diagnostics.real_row_count = deduped.length;
  diagnostics.actionable_row_count = deduped.filter(record => record.actionable_source_row).length;
  diagnostics.count_funnel = {
    ...(diagnostics.count_funnel || {}),
    target_vessels_5000gt_plus: deduped.filter(record => Number(record.gt || record.grtg || record.intrlGrtg || 0) >= 5000).length,
    unknown_gt_review: deduped.filter(record => !Number(record.gt || record.grtg || record.intrlGrtg || 0)).length,
    excluded_under_5000gt: deduped.filter(record => {
      const gt = Number(record.gt || record.grtg || record.intrlGrtg || 0);
      return gt > 0 && gt < 5000;
    }).length
  };
  return deduped;
}

export async function collectKoreaData({ apiSources = [] } = {}) {
  const realRows = await collectRealRows();
  diagnostics.fallback_used = realRows.length === 0;
  if (process.env.CI && diagnostics.attempted_count === 0) {
    throw new Error(`No collectors attempted. Runtime env presence: ${JSON.stringify(runtimeEnvDiagnostics())}`);
  }
  if (process.env.CI && process.env.COLLECTOR_DEBUG_ONLY && realRows.length === 0) {
    throw new Error(`Debug collector produced no real rows. Runtime env presence: ${JSON.stringify(runtimeEnvDiagnostics())}`);
  }
  return realRows;
}

export function getCollectorDiagnostics() {
  return diagnostics;
}

