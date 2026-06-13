const NULL_MARKERS = new Set([
  "",
  "-",
  "--",
  "N/A",
  "NA",
  "NULL",
  "NONE",
  "UNKNOWN",
  "UNKN",
  "NIL",
  "NO DATA",
  "诱몄긽",
  "誘몄긽",
  "?놁쓬",
  "없음"
]);

const VESSEL_PREFIX_PATTERN = /^(?:M\s*\/?\s*V|M\.?\s*V\.?|MV|M\s*\/?\s*T|M\.?\s*T\.?|MT|S\s*\/?\s*S|S\.?\s*S\.?|SS|T\s*\/?\s*V|T\.?\s*V\.?|TV)\s+/i;

export const FIELD_ALIAS_GROUPS = {
  vessel_name: [
    "vessel_name", "ship_name", "shipNm", "shipname", "shipName", "vsslNm", "vslNm", "vesselNm",
    "VSL_NM", "VSSL_NM", "vsslEngNm", "vsslKrnNm", "name", "Vessel Name", "紐⑥꽑紐?", "?좊컯紐?", "?좊챸"
  ],
  normalized_vessel_name: ["normalized_vessel_name", "normalized_name", "norm_name"],
  call_sign: ["call_sign", "callSign", "callsign", "CALL_SIGN", "clsgn", "vsslCallSgn", "Call Sign", "?몄텧遺??", "肄쒖궗??"],
  port: ["port", "port_name", "portNm", "prtNm", "PORT_NM", "portName", "portCode", "prtAgCd", "current_port", "??쭔", "??챸", "?낇빆??", "異쒗빆??"],
  berth: ["berth", "berth_name", "berthNm", "berthNo", "brthNm", "BERTH_NM", "facilityNm", "terminalNm", "?좎꽍", "?좎꽍紐?", "?묒븞?좎꽍", "?쒖꽕紐?", "怨꾩꽑??", "遺??", "?묒븞吏"],
  terminal: ["terminal", "terminal_name", "terminalName", "terminalNm", "tmnlNm", "TERMINAL_NM", "?곕???", "遺??", "?곕??먮챸"],
  eta: ["eta", "ETA", "etaDate", "estimatedArrival", "arrPlanDt", "arrivalPlanDt", "etaDt", "?낇빆?덉젙", "?낇빆?덉젙?쇱떆"],
  etb: ["etb", "ETB", "estimatedBerthing", "berthPlanDt", "etbDt", "?묒븞?덉젙", "?묒븞?덉젙?쇱떆", "怨꾩꽑?덉젙?쇱떆"],
  ata: ["ata", "ATA", "actualArrival", "arrDt", "arrivalDt", "etryptDt", "ETRYPT_DT", "?낇빆?쇱떆", "?낇빆?쇱옄", "?낇빆?쒓컙"],
  atb: ["atb", "ATB", "actualBerthing", "berthDt", "?묒븞?쇱떆", "怨꾩꽑?쇱떆"],
  etd: ["etd", "ETD", "estimatedDeparture", "depPlanDt", "departurePlanDt", "etdDt", "tkoffPrrrnDt", "TKOFF_PRRRN_DT", "異쒗빆?덉젙", "異쒗빆?덉젙?쇱떆"],
  atd: ["atd", "ATD", "actualDeparture", "depDt", "departureDt", "tkoffDt", "TKOFF_DT", "異쒗빆?쇱떆", "異쒗빆?쇱옄"],
  imo: ["imo", "imo_no", "imoNo", "IMO", "IMO_NO", "imoNumber", "shipNo", "vesselNo", "?좊컯踰덊샇", "援?젣?댁궗湲곌뎄踰덊샇"],
  mmsi: ["mmsi", "MMSI", "MMSI_NO", "mmsiNo", "mmsi_no"],
  gt: ["grossTonnage", "gt", "tonnage", "gross_tonnage", "grt", "grossTon", "GT", "grtg", "intrlGrtg", "珥앺넠??", "GRT"],
  dwt: ["dwt", "deadweight", "deadWeight", "DWT", "?ы솕以묐웾??", "?ы솕以묐웾?ㅼ닔", "?ы솕?ㅼ닔"],
  flag: ["flag", "nationality", "flagState", "flag_state", "shipNationality", "援?쟻", "?좎쟻援?"],
  vessel_type: ["vesselType", "vessel_type", "shipType", "ship_type", "type", "vsslKnd", "vsslKndNm", "vsslKndCd", "VSSL_KND_NM", "VSSL_KND_CD", "shipKnd", "TYPE", "?좎쥌", "?좊컯醫낅쪟", "?좊컯醫낅쪟紐?", "?좊컯醫낅쪟肄붾뱶"],
  loa: ["loa", "length", "length_m", "length_overall", "LOA", "lengthOverall", "shipLength", "vsslLt", "?꾩옣", "?좊컯湲몄씠"],
  beam: ["beam", "breadth", "breadth_m", "width", "BEAM", "shipBreadth", "vsslWidth", "??", "?좏룺"]
};

const PORT_DEFINITIONS = [
  {
    normalized_port: "BUSAN",
    port_code: "020",
    port_name: "Busan",
    aliases: ["020", "BUSAN", "PUSAN", "KRPUS", "PNC", "BUSAN NEW PORT", "PUSAN NEW PORT", "遺??", "遺?고빆", "遺?곗떊??", "?좏빆"]
  },
  {
    normalized_port: "YEOSU",
    port_code: "620",
    port_name: "Yeosu",
    aliases: ["YEOSU", "?ъ닔"]
  },
  {
    normalized_port: "GWANGYANG",
    port_code: "620",
    port_name: "Gwangyang",
    aliases: ["620", "GWANGYANG", "KWANGYANG", "KRKAN", "愿묒뼇", "YEOSU/GWANGYANG", "YEOSU_GWANGYANG"]
  },
  {
    normalized_port: "ULSAN",
    port_code: "820",
    port_name: "Ulsan",
    aliases: ["820", "ULSAN", "KRUSN", "?몄궛"]
  },
  {
    normalized_port: "PYEONGTAEK_DANGJIN",
    port_code: "031",
    port_name: "Pyeongtaek-Dangjin",
    aliases: ["031", "PYEONGTAEK", "DANGJIN", "PYEONGTAEK DANGJIN", "PYEONGTAEK-DANGJIN", "?됲깮", "?뱀쭊", "?됲깮쨌?뱀쭊"]
  },
  {
    normalized_port: "POHANG",
    port_code: "810",
    port_name: "Pohang",
    aliases: ["810", "POHANG", "?ы빆"]
  },
  {
    normalized_port: "INCHEON",
    port_code: "030",
    port_name: "Incheon",
    aliases: ["030", "INCHEON", "?몄쿇"]
  },
  {
    normalized_port: "MASAN_CHANGWON",
    port_code: "622",
    port_name: "Masan/Changwon",
    aliases: ["622", "MASAN", "CHANGWON", "MASAN CHANGWON", "MASAN/CHANGWON", "MASAN_JINHAE", "JINHAE", "留덉궛", "李쎌썝"]
  }
];

const TERMINAL_DEFINITIONS = [
  { terminal: "PNC", aliases: ["PNC", "PNIT", "PUSAN NEW PORT", "BUSAN NEW PORT", "遺?곗떊??PNC", "遺?곗떊??"] },
  { terminal: "BNCT", aliases: ["BNCT"] },
  { terminal: "HJNC", aliases: ["HJNC"] },
  { terminal: "HPNT", aliases: ["HPNT", "HYUNDAI PUSAN NEWPORT", "HYUNDAI BUSAN NEWPORT"] },
  { terminal: "DPCT", aliases: ["DPCT"] },
  { terminal: "BPT", aliases: ["BPT"] },
  { terminal: "GAMMAN", aliases: ["GAMMAN", "媛먮쭔"] },
  { terminal: "SINSEONDAE", aliases: ["SINSEONDAE", "?좎꽑?"] },
  { terminal: "JASEONGDAE", aliases: ["JASEONGDAE", "?먯꽦?"] }
];

function text(value = "") {
  return String(value ?? "").normalize("NFKC").trim();
}

function upper(value = "") {
  return text(value).toUpperCase();
}

function aliasKey(value = "") {
  return upper(value).replace(/[^\p{L}\p{N}]+/gu, "");
}

function collapseSpaces(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function isNullishText(value = "") {
  const raw = upper(value);
  return NULL_MARKERS.has(raw) || NULL_MARKERS.has(raw.replace(/[\s\-/]+/g, ""));
}

function portAliasMap() {
  const map = new Map();
  for (const definition of PORT_DEFINITIONS) {
    for (const alias of definition.aliases) {
      const key = aliasKey(alias);
      if (key) map.set(key, definition);
    }
  }
  return map;
}

function terminalAliasMap() {
  const map = new Map();
  for (const definition of TERMINAL_DEFINITIONS) {
    for (const alias of definition.aliases) {
      const key = aliasKey(alias);
      if (key) map.set(key, definition.terminal);
    }
  }
  return map;
}

const PORT_ALIAS_MAP = portAliasMap();
const TERMINAL_ALIAS_MAP = terminalAliasMap();

export function pickFirst(row = {}, aliases = []) {
  if (!row || typeof row !== "object") return "";
  const direct = aliases.find(key => row[key] !== undefined && row[key] !== null && String(row[key]).trim() !== "");
  if (direct) return row[direct];
  const lowerMap = new Map(Object.keys(row).map(key => [String(key).trim().toLowerCase(), key]));
  for (const alias of aliases) {
    const matched = lowerMap.get(String(alias).trim().toLowerCase());
    if (matched && row[matched] !== undefined && row[matched] !== null && String(row[matched]).trim() !== "") return row[matched];
  }
  return "";
}

export function pickAlias(row = {}, field = "") {
  return pickFirst(row, FIELD_ALIAS_GROUPS[field] || [field]);
}

export function normalizeVesselName(value = "") {
  if (isNullishText(value)) return "";
  let normalized = upper(value)
    .replace(/[-/]+/g, " ")
    .replace(/[._,;:()[\]{}"'`~!@#$%^&*=+?<>\\|]+/g, " ");
  for (let index = 0; index < 3; index += 1) {
    normalized = normalized.replace(VESSEL_PREFIX_PATTERN, "");
  }
  normalized = normalized.replace(/[^A-Z0-9\uAC00-\uD7A3]+/g, " ");
  return collapseSpaces(normalized);
}

export function normalizeCallSign(value = "") {
  if (isNullishText(value)) return "";
  const normalized = upper(value).replace(/[\s\-/]+/g, "").replace(/[^A-Z0-9]+/g, "");
  if (isNullishText(normalized)) return "";
  return normalized;
}

export function normalizePort(value = "") {
  const raw = typeof value === "object" && value !== null
    ? pickAlias(value, "port") || value.normalized_port || value.port_code || value.prtAgCd || ""
    : value;
  const rawPort = text(raw);
  if (!rawPort || isNullishText(rawPort)) {
    return {
      raw_port: rawPort,
      normalized_port: "",
      port_code: "",
      port_name: "",
      display_name: "",
      is_known: false
    };
  }
  const compact = aliasKey(rawPort);
  const exact = PORT_ALIAS_MAP.get(compact);
  const partial = exact || PORT_DEFINITIONS.find(definition =>
    definition.aliases.some(alias => {
      const key = aliasKey(alias);
      return key && compact.includes(key);
    })
  );
  if (partial) {
    return {
      raw_port: rawPort,
      normalized_port: partial.normalized_port,
      port_code: partial.port_code,
      port_name: partial.port_name,
      display_name: partial.port_name,
      is_known: true
    };
  }
  const fallback = collapseSpaces(upper(rawPort).replace(/[_-]+/g, " "));
  return {
    raw_port: rawPort,
    normalized_port: fallback.replace(/\s+/g, "_"),
    port_code: "",
    port_name: fallback,
    display_name: fallback,
    is_known: false
  };
}

export function normalizeTerminal(value = "") {
  const raw = text(value);
  if (!raw || isNullishText(raw)) return "";
  const compact = aliasKey(raw);
  const exact = TERMINAL_ALIAS_MAP.get(compact);
  if (exact) return exact;
  for (const [key, terminal] of TERMINAL_ALIAS_MAP.entries()) {
    if (key && compact.includes(key)) return terminal;
  }
  return collapseSpaces(upper(raw).replace(/[_/-]+/g, " "))
    .replace(/\b(?:TERMINAL|TMNL|BERTH|BTH|NO|NUMBER)\b/g, "")
    .replace(/[^A-Z0-9\uAC00-\uD7A3]+/g, " ")
    .trim();
}

export function normalizeBerth(value = "") {
  const rawBerth = text(value);
  if (!rawBerth || isNullishText(rawBerth)) {
    return { terminal: "", berth: "", normalized_berth: "", raw_berth: rawBerth };
  }
  const terminal = normalizeTerminal(rawBerth);
  let berth = collapseSpaces(upper(rawBerth).replace(/[_/-]+/g, " "));
  if (terminal) berth = collapseSpaces(berth.replace(new RegExp(`\\b${terminal}\\b`, "gi"), ""));
  berth = berth
    .replace(/\b(?:TERMINAL|TMNL|BERTH|BTH|NO|NUMBER)\b/g, "")
    .replace(/[^A-Z0-9\uAC00-\uD7A3]+/g, " ")
    .trim();
  const normalizedBerth = [terminal, berth].filter(Boolean).join("_") || terminal || berth;
  return {
    terminal,
    berth,
    normalized_berth: normalizedBerth,
    raw_berth: rawBerth
  };
}

function contextYear(context = {}) {
  const source = context.year || context.reference_year || context.generated_at || context.date || context.referenceDate || new Date();
  if (Number(source) >= 1900) return Number(source);
  const parsed = new Date(source);
  return Number.isFinite(parsed.getTime()) ? parsed.getFullYear() : new Date().getFullYear();
}

function parseDateCandidate(candidate = "") {
  const raw = String(candidate || "").trim();
  if (!raw) return null;
  let textValue = raw.replace(/\s+/g, " ").trim();
  const korean = textValue.match(/^(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일(?:\s*(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (korean) {
    const [, year, month, day, hour = "00", minute = "00", second = "00"] = korean;
    textValue = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")} ${hour.padStart(2, "0")}:${minute}:${second}`;
  }
  const isoish = textValue.includes("T") ? textValue : textValue.replace(" ", "T");
  const withZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(isoish) ? isoish : `${isoish}+09:00`;
  const date = new Date(withZone);
  return Number.isFinite(date.getTime()) ? date : null;
}

export function normalizeDateTime(value = "", context = {}) {
  const raw = text(value);
  const empty = {
    parsed_timestamp: null,
    timestamp: null,
    iso: null,
    epoch_ms: null,
    time_text: "",
    raw_time_text: raw,
    time_only_missing_date: false,
    parse_status: raw ? "invalid" : "missing"
  };
  if (!raw) return empty;
  if (/^(?:[01]?\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(raw)) {
    return {
      ...empty,
      time_text: raw,
      time_only_missing_date: true,
      parse_status: "time_only"
    };
  }
  let candidate = raw;
  if (/^\d{8}$/.test(raw)) {
    candidate = `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)} 00:00`;
  } else if (/^\d{12}$/.test(raw) || /^\d{14}$/.test(raw)) {
    candidate = `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)} ${raw.slice(8, 10)}:${raw.slice(10, 12)}:${raw.slice(12, 14) || "00"}`;
  } else {
    const monthDay = raw.match(/^(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (monthDay) {
      const [, month, day, hour, minute, second = "00"] = monthDay;
      candidate = `${contextYear(context)}-${month.padStart(2, "0")}-${day.padStart(2, "0")} ${hour.padStart(2, "0")}:${minute}:${second}`;
    }
  }
  const parsed = parseDateCandidate(candidate);
  if (!parsed) return empty;
  const iso = parsed.toISOString();
  return {
    parsed_timestamp: iso,
    timestamp: iso,
    iso,
    epoch_ms: parsed.getTime(),
    time_text: raw,
    raw_time_text: raw,
    time_only_missing_date: false,
    parse_status: "parsed"
  };
}

export function normalizeNumeric(value = "") {
  if (value === null || value === undefined || isNullishText(value)) return null;
  const cleaned = String(value).normalize("NFKC").replace(/,/g, "").replace(/[^\d.+-]/g, "");
  if (!cleaned || cleaned === "-" || cleaned === "." || cleaned === "+") return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

export function normalizeFlag(value = "") {
  if (isNullishText(value)) return "";
  return collapseSpaces(upper(value).replace(/[_/-]+/g, " "));
}

export function normalizeVesselType(value = "") {
  if (isNullishText(value)) return "";
  return collapseSpaces(upper(value).replace(/[_/-]+/g, " ").replace(/[^A-Z0-9\uAC00-\uD7A3]+/g, " "));
}

function firstNonEmpty(...values) {
  return values.find(value => value !== undefined && value !== null && String(value).trim() !== "") ?? "";
}

function cleanIdentifier(value = "") {
  return upper(value).replace(/[^A-Z0-9]+/g, "");
}

export function buildVesselMatchKeys(row = {}) {
  const callSign = normalizeCallSign(firstNonEmpty(pickAlias(row, "call_sign"), row.call_sign, row.callsign, row.clsgn));
  const vesselName = normalizeVesselName(firstNonEmpty(row.vessel_name, row.name, row.ship_name, pickAlias(row, "vessel_name"), row.normalized_vessel_name, row.normalized_name));
  const portIdentity = normalizePort(firstNonEmpty(row.normalized_port, row.port_code, row.prtAgCd, row.port_name, row.port, row.current_port, pickAlias(row, "port")));
  const port = portIdentity.normalized_port;
  const gt = normalizeNumeric(firstNonEmpty(row.gt, row.grtg, row.intrlGrtg, row.grossTonnage, row.tonnage, pickAlias(row, "gt")));
  const vesselType = normalizeVesselType(firstNonEmpty(row.vessel_type, row.ship_type, row.vesselType, row.vsslKndNm, row.vsslKndCd, pickAlias(row, "vessel_type")));
  const imo = cleanIdentifier(firstNonEmpty(row.imo, row.imo_no, row.imoNo, pickAlias(row, "imo"))).replace(/^IMO/, "");
  const mmsi = cleanIdentifier(firstNonEmpty(row.mmsi, row.mmsi_no, row.mmsiNo, pickAlias(row, "mmsi")));
  const keys = {};
  if (callSign) keys.call_sign = callSign;
  if (callSign && port) keys.call_sign_port = `${callSign}|${port}`;
  if (vesselName) keys.vessel_name = vesselName;
  if (vesselName && port) keys.vessel_name_port = `${vesselName}|${port}`;
  if (vesselName && gt !== null && vesselType) keys.vessel_name_gt_type = `${vesselName}|${gt}|${vesselType}`;
  if (imo) keys.imo = imo;
  if (mmsi) keys.mmsi = mmsi;
  return keys;
}
