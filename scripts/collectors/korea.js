import fs from "node:fs";
import path from "node:path";
import {
  normalizeVesselName as sharedNormalizeVesselName,
  normalizeCallSign,
  normalizeBerthName,
  normalizeTerminalName,
  scoreMatch,
  matchConfidenceBand as sharedMatchConfidenceBand
} from "../lib/matching.js";
import {
  buildVesselMatchKeys,
  normalizeBerth as normalizeBerthIdentity,
  normalizeDateTime,
  normalizeFlag,
  normalizeImo,
  normalizeNumeric,
  normalizePort as normalizePortIdentity,
  normalizeTerminal as normalizeTerminalIdentity,
  normalizeVesselType
} from "../lib/normalize.js";
import { DEFAULT_PORT_OPERATION_API_URL } from "../lib/runtime-config-audit.js";
import { SOURCE_SCHEDULE_PATH, sourceScheduleDecisionForKey } from "../lib/source-schedule.js";
import { VERIFIED_SOURCE_CSV_PATH, diagnoseSourceCsvUrl } from "../lib/source-csv-url.js";

const SOURCE_TIMEOUT_MS = Number(process.env.SOURCE_TIMEOUT_MS || 25000);
const MAX_OUTPUT_ROWS = Number(process.env.MAX_OUTPUT_ROWS || 10000);
const MAX_SOURCE_ROWS = Number(process.env.MAX_SOURCE_ROWS || 5000);
const MAX_PORTS_PER_RUN = Number(process.env.MAX_PORTS_PER_RUN || 50);
const MAX_CHILD_ENRICHMENT_ROWS = Number(process.env.PORT_FACILITY_MAX_REQUESTS || process.env.MAX_CHILD_ENRICHMENT_ROWS || 150);
const VESSEL_SPEC_MAX_REQUESTS = Number(process.env.VESSEL_SPEC_MAX_REQUESTS || 150);
const MAX_API_RESPONSE_BYTES = Number(process.env.MAX_API_RESPONSE_BYTES || 25000000);
const MAX_SOURCE_CSV_BYTES = Number(process.env.SOURCE_CSV_MAX_BYTES || process.env.MAX_SOURCE_CSV_BYTES || 5242880);
const COLLECTOR_RUNTIME_BUDGET_MS = Number(process.env.COLLECTOR_RUNTIME_BUDGET_MS || 300000);
const SOURCE_MAX_RETRIES = Number(process.env.SOURCE_MAX_RETRIES || 2);
const DEFAULT_CARGO_HARBOR_USE_API_URL = "http://apis.data.go.kr/1192000/CargHarborUse2/Info";
const DEFAULT_VESSEL_SPEC_API_URL = "http://apis.data.go.kr/1192000/SicsVsslManp3/Info3";
const DEFAULT_ULSAN_OPERATION = "getVtsBaseVslNvgtInfo";
const PORTS_REGISTRY_PATH = path.join("data", "reference", "ports_registry.csv");
const LIGHTWEIGHT_CSV_DEFAULT_PATHS = [
  "data/source/lightweight.csv",
  "data/source/source_lightweight.csv",
  "data/source_csv_lightweight.csv",
  "public/data/source_lightweight.csv",
  "dashboard/api/cache/source-csv-reference.json",
  "dashboard/api/cache/source-csv-index.json",
  "data/cache/source-csv-reference-cache.json"
];
const DEFAULT_PORT_REGISTRY = [
  { port_code: "020", prtAgCd: "020", port_name_ko: "부산항", port_name_en: "Busan", port_group: "Busan", sub_port: "부산항", tier: "1", commercial_focus: "container,cruise,repair,anchorage", has_port_operation: "true", has_pilot_source: "true", has_berth_source: "true", has_vts: "true", anchorage_relevance: "high", commercial_priority: "high", enabled: "true" },
  { port_code: "030", prtAgCd: "030", port_name_ko: "인천항", port_name_en: "Incheon", port_group: "Incheon", sub_port: "인천항", tier: "1", commercial_focus: "container,bulk,passenger", has_port_operation: "true", has_pilot_source: "true", has_berth_source: "true", has_vts: "true", anchorage_relevance: "medium", commercial_priority: "high", enabled: "true" },
  { port_code: "031", prtAgCd: "031", port_name_ko: "평택·당진항", port_name_en: "Pyeongtaek-Dangjin", port_group: "Pyeongtaek-Dangjin", sub_port: "평택·당진항", tier: "1", commercial_focus: "pctc,bulk,industrial", has_port_operation: "true", has_pilot_source: "true", has_berth_source: "true", has_vts: "true", anchorage_relevance: "medium", commercial_priority: "high", enabled: "true" },
  { port_code: "620", prtAgCd: "620", port_name_ko: "여수·광양항", port_name_en: "Yeosu/Gwangyang", port_group: "Yeosu/Gwangyang", sub_port: "여수·광양항", tier: "1", commercial_focus: "bulk,tanker,resource,anchorage", has_port_operation: "true", has_pilot_source: "true", has_berth_source: "true", has_vts: "true", anchorage_relevance: "high", commercial_priority: "high", enabled: "true" },
  { port_code: "810", prtAgCd: "810", port_name_ko: "포항항", port_name_en: "Pohang", port_group: "Pohang", sub_port: "포항항", tier: "1", commercial_focus: "bulk,steel,coal,ore", has_port_operation: "true", has_pilot_source: "true", has_berth_source: "true", has_vts: "true", anchorage_relevance: "medium", commercial_priority: "high", enabled: "true" },
  { port_code: "820", prtAgCd: "820", port_name_ko: "울산항", port_name_en: "Ulsan", port_group: "Ulsan", sub_port: "울산항", tier: "1", commercial_focus: "tanker,industrial,energy", has_port_operation: "true", has_pilot_source: "true", has_berth_source: "true", has_vts: "true", anchorage_relevance: "high", commercial_priority: "high", enabled: "true" },
  { port_code: "621", prtAgCd: "621", port_name_ko: "대산항", port_name_en: "Daesan", port_group: "Daesan", sub_port: "대산항", tier: "2", commercial_focus: "tanker,chemical,industrial", has_port_operation: "true", has_pilot_source: "true", has_berth_source: "false", has_vts: "true", anchorage_relevance: "medium", commercial_priority: "medium_high", enabled: "true" },
  { port_code: "622", prtAgCd: "622", port_name_ko: "하동·삼천포항", port_name_en: "Hadong/Samcheonpo", port_group: "South Gyeongsang", sub_port: "하동·삼천포항", tier: "2", commercial_focus: "coal,bulk,resource", has_port_operation: "true", has_pilot_source: "false", has_berth_source: "false", has_vts: "true", anchorage_relevance: "medium", commercial_priority: "medium_high", enabled: "true" },
  { port_code: "622", prtAgCd: "622", port_name_ko: "마산·진해항", port_name_en: "Masan/Jinhae", port_group: "South Gyeongsang", sub_port: "마산·진해항", tier: "2", commercial_focus: "general_cargo,shipyard,industrial", has_port_operation: "true", has_pilot_source: "false", has_berth_source: "false", has_vts: "true", anchorage_relevance: "medium", commercial_priority: "medium", enabled: "true" },
  { port_code: "622", prtAgCd: "622", port_name_ko: "통영항", port_name_en: "Tongyeong", port_group: "South Gyeongsang", sub_port: "통영항", tier: "2", commercial_focus: "industrial,shipyard,small_lng", has_port_operation: "true", has_pilot_source: "false", has_berth_source: "false", has_vts: "true", anchorage_relevance: "low", commercial_priority: "medium", enabled: "true" },
  { port_code: "622", prtAgCd: "622", port_name_ko: "거제·옥포항", port_name_en: "Geoje/Okpo", port_group: "South Gyeongsang", sub_port: "거제·옥포항", tier: "2", commercial_focus: "shipyard,repair,offshore", has_port_operation: "true", has_pilot_source: "false", has_berth_source: "false", has_vts: "true", anchorage_relevance: "medium", commercial_priority: "medium_high", enabled: "true" },
  { port_code: "070", prtAgCd: "070", port_name_ko: "목포항", port_name_en: "Mokpo", port_group: "Mokpo", sub_port: "목포항", tier: "2", commercial_focus: "general_cargo,passenger,shipyard", has_port_operation: "true", has_pilot_source: "false", has_berth_source: "false", has_vts: "true", anchorage_relevance: "low", commercial_priority: "medium", enabled: "true" },
  { port_code: "080", prtAgCd: "080", port_name_ko: "군산항", port_name_en: "Gunsan", port_group: "Gunsan", sub_port: "군산항", tier: "2", commercial_focus: "bulk,general_cargo,industrial", has_port_operation: "true", has_pilot_source: "false", has_berth_source: "false", has_vts: "true", anchorage_relevance: "medium", commercial_priority: "medium", enabled: "true" },
  { port_code: "120", prtAgCd: "120", port_name_ko: "동해·묵호항", port_name_en: "Donghae/Mukho", port_group: "Donghae/Mukho", sub_port: "동해·묵호항", tier: "2", commercial_focus: "bulk,cement,coal", has_port_operation: "true", has_pilot_source: "false", has_berth_source: "false", has_vts: "true", anchorage_relevance: "medium", commercial_priority: "medium", enabled: "true" },
  { port_code: "940", prtAgCd: "940", port_name_ko: "제주항", port_name_en: "Jeju", port_group: "Jeju", sub_port: "제주항", tier: "3", commercial_focus: "passenger,cruise,general_cargo", has_port_operation: "true", has_pilot_source: "false", has_berth_source: "false", has_vts: "false", anchorage_relevance: "low", commercial_priority: "medium_low", enabled: "true" },
  { port_code: "120", prtAgCd: "120", port_name_ko: "속초항", port_name_en: "Sokcho", port_group: "Donghae/Mukho", sub_port: "속초항", tier: "3", commercial_focus: "cruise,passenger,general_cargo", has_port_operation: "true", has_pilot_source: "false", has_berth_source: "false", has_vts: "false", anchorage_relevance: "low", commercial_priority: "medium_low", enabled: "true" },
  { port_code: "031", prtAgCd: "031", port_name_ko: "보령항", port_name_en: "Boryeong", port_group: "Pyeongtaek-Dangjin", sub_port: "보령항", tier: "3", commercial_focus: "coal,industrial,bulk", has_port_operation: "true", has_pilot_source: "false", has_berth_source: "false", has_vts: "false", anchorage_relevance: "medium", commercial_priority: "medium", enabled: "true" },
  { port_code: "030", prtAgCd: "030", port_name_ko: "영흥 터미널", port_name_en: "Yeongheung", port_group: "Incheon", sub_port: "영흥 터미널", tier: "3", commercial_focus: "coal,lng,industrial", has_port_operation: "true", has_pilot_source: "false", has_berth_source: "false", has_vts: "false", anchorage_relevance: "medium", commercial_priority: "medium", enabled: "true" },
  { port_code: "621", prtAgCd: "621", port_name_ko: "태안 터미널", port_name_en: "Taean", port_group: "Daesan", sub_port: "태안 터미널", tier: "3", commercial_focus: "coal,bulk,industrial", has_port_operation: "true", has_pilot_source: "false", has_berth_source: "false", has_vts: "false", anchorage_relevance: "medium", commercial_priority: "medium", enabled: "true" },
  { port_code: "031", prtAgCd: "031", port_name_ko: "당진 산업터미널", port_name_en: "Dangjin Industrial Terminals", port_group: "Pyeongtaek-Dangjin", sub_port: "당진 산업터미널", tier: "3", commercial_focus: "steel,bulk,industrial", has_port_operation: "true", has_pilot_source: "false", has_berth_source: "false", has_vts: "true", anchorage_relevance: "medium", commercial_priority: "medium_high", enabled: "true" },
  { port_code: "820", prtAgCd: "820", port_name_ko: "Smaller LNG/Industrial Terminals", port_name_en: "Smaller LNG/Industrial Terminals", port_group: "Industrial Terminals", sub_port: "LNG/industrial terminals", tier: "3", commercial_focus: "lng,lpg,chemical,industrial", has_port_operation: "true", has_pilot_source: "false", has_berth_source: "false", has_vts: "true", anchorage_relevance: "medium", commercial_priority: "medium", enabled: "true" }
];

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
let portsRegistryCache = null;
let sourceScheduleCache = undefined;
const COLLECTOR_UPDATE_MODE = String(process.env.UPDATE_MODE || "core").toLowerCase();
const CORE_COLLECTOR_MODES = new Set(["core", "core_update"]);
const FAST_AUX_COLLECTOR_MODES = new Set(["fast_aux"]);
const REFERENCE_ENRICHMENT_COLLECTOR_MODES = new Set(["reference_enrichment"]);

function sourceCsvMode() {
  return String(process.env.SOURCE_CSV_MODE || "").trim().toLowerCase();
}

function sourceCsvCoreCandidate() {
  const mode = sourceCsvMode();
  return ["lightweight", "raw", "full", "off"].includes(mode);
}

function fileUrlFromPath(filePath) {
  return `file:///${path.resolve(filePath).replace(/\\/g, "/").replace(/^\/+/, "")}`;
}

function resolveLightweightCsvSource() {
  const explicitUrl = env("SOURCE_LIGHTWEIGHT_CSV_URL");
  if (explicitUrl) return { status: "found", type: "url", url: explicitUrl, path_or_url: explicitUrl };
  const explicitPath = env("SOURCE_LIGHTWEIGHT_CSV_PATH");
  if (explicitPath) {
    const absolute = path.isAbsolute(explicitPath) ? explicitPath : path.join(process.cwd(), explicitPath);
    if (fs.existsSync(absolute)) return { status: "found", type: path.extname(absolute).toLowerCase() === ".json" ? "cache" : "path", localPath: absolute, url: fileUrlFromPath(absolute), path_or_url: path.relative(process.cwd(), absolute).replace(/\\/g, "/") || absolute, bytes: fs.statSync(absolute).size };
    return { status: "missing", reason: "LIGHTWEIGHT_CSV_NOT_FOUND", path_or_url: explicitPath };
  }
  for (const relativePath of LIGHTWEIGHT_CSV_DEFAULT_PATHS) {
    const absolute = path.join(process.cwd(), relativePath);
    if (fs.existsSync(absolute)) return { status: "found", type: path.extname(absolute).toLowerCase() === ".json" ? "cache" : "path", localPath: absolute, url: fileUrlFromPath(absolute), path_or_url: relativePath, bytes: fs.statSync(absolute).size };
  }
  return { status: "missing", reason: "LIGHTWEIGHT_CSV_NOT_FOUND", searched_paths: LIGHTWEIGHT_CSV_DEFAULT_PATHS };
}

function lightweightCacheRowCount(localPath) {
  try {
    const payload = JSON.parse(fs.readFileSync(localPath, "utf8"));
    if (Array.isArray(payload.items)) return payload.items.length;
    if (Array.isArray(payload.rows)) return payload.rows.length;
    return Number(payload.item_count || payload.record_count || 0) || 0;
  } catch {
    return 0;
  }
}

function collectorSourceTier(source = {}) {
  const key = String(source.key || source.source_name || "");
  if (key.startsWith("port_operation_") || key === "port_operation") return "core";
  if (key === "source_csv") return sourceCsvCoreCandidate() ? "core" : "reference_enrichment";
  if (key === "vessel_spec") return "fast_aux";
  if (
    key.startsWith("pilot_source_") ||
    key.startsWith("pnc_source_") ||
    key.startsWith("mof_ais_") ||
    key.startsWith("ulsan_")
  ) return "fast_aux";
  return "fast_aux";
}

function collectorSourceAllowedForMode(source = {}) {
  if (!COLLECTOR_UPDATE_MODE || COLLECTOR_UPDATE_MODE === "scheduled") return true;
  const tier = collectorSourceTier(source);
  if (CORE_COLLECTOR_MODES.has(COLLECTOR_UPDATE_MODE)) return tier === "core";
  if (FAST_AUX_COLLECTOR_MODES.has(COLLECTOR_UPDATE_MODE)) return tier === "fast_aux";
  if (REFERENCE_ENRICHMENT_COLLECTOR_MODES.has(COLLECTOR_UPDATE_MODE)) return tier === "reference_enrichment";
  if (COLLECTOR_UPDATE_MODE === "discovery_audit") return false;
  return true;
}

function collectorModeRequiresPortOperation() {
  return CORE_COLLECTOR_MODES.has(COLLECTOR_UPDATE_MODE) || !COLLECTOR_UPDATE_MODE || COLLECTOR_UPDATE_MODE === "scheduled";
}

function loadSourceSchedule() {
  if (sourceScheduleCache !== undefined) return sourceScheduleCache;
  try {
    sourceScheduleCache = fs.existsSync(SOURCE_SCHEDULE_PATH)
      ? JSON.parse(fs.readFileSync(SOURCE_SCHEDULE_PATH, "utf8"))
      : null;
  } catch {
    sourceScheduleCache = null;
  }
  return sourceScheduleCache;
}

function sourceScheduleSkipDecision(source = {}) {
  if (
    FAST_AUX_COLLECTOR_MODES.has(COLLECTOR_UPDATE_MODE) &&
    ["vessel_spec", "port_facility_child_enrichment"].includes(String(source.key || ""))
  ) {
    return null;
  }
  if (
    String(source.key || "") === "source_csv" &&
    (["off", "raw", "full", "lightweight"].includes(sourceCsvMode()) || (
      sourceCsvMode() === "refresh" &&
      REFERENCE_ENRICHMENT_COLLECTOR_MODES.has(COLLECTOR_UPDATE_MODE)
    ))
  ) {
    return null;
  }
  const schedule = loadSourceSchedule();
  if (!schedule?.items) return null;
  const decision = sourceScheduleDecisionForKey(source.key, schedule);
  if (!decision || decision.source_layer === "core" || decision.should_run_now !== false) return null;
  return decision;
}

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
  agent: ["agent", "agentNm", "agency", "shipAgent", "satmntEntrpsNm", "entrpsCdNm", "SATMNT_ENTRPS_NM", "ENTRPS_CD_NM", "신고업체", "신고업체명", "대리점", "선박대리점"],
  destination: ["destination", "dest", "next_port_country", "DEST", "destNm", "destinationPort", "dstnPrtNm", "목적지", "차항지", "다음항"],
  previous_port: ["previous_port", "prevPort", "last_port", "prevPortNm", "전항", "이전항"],
  next_port: ["next_port", "nextPort", "nextPortNm", "차항", "다음항", "예정항"],
  vessel_type: ["vessel_type", "ship_type", "shipType", "vsslKnd", "vsslKndNm", "vsslKndCd", "VSSL_KND_NM", "VSSL_KND_CD", "shipKnd", "TYPE", "vesselType", "선종", "선박종류", "선박종류명", "선박종류코드"],
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

const TERMINAL_ALIASES = ["terminal_name", "terminal", "terminalNm", "tmnlNm", "TERMINAL_NM", "터미널", "터미널명"];
const BERTH_STATUS_ALIASES = ["berth_status", "berthStatus", "berthSttus", "operationStatus", "oprSttus", "작업상태", "선석상태", "운영상태"];
const CARGO_WORKLOAD_ALIASES = ["cargo_workload_proxy", "cargoQty", "cargoTon", "cargoVolume", "작업물량", "화물량", "하역량"];
const PILOT_TIME_ALIASES = ["pilot_time", "pilotTime", "pilotDt", "pilotDate", "도선시간", "도선일시", "예정시간", "movement_time", "movementTime", "시간"];
const PILOT_DIRECTION_ALIASES = ["pilot_direction", "direction", "inout", "inOut", "io", "입출항", "구분", "도선구분", "movement_type"];
const PILOT_STATION_ALIASES = ["pilot_station", "station", "pilotStation", "도선점", "도선구", "승선지", "하선지"];
const PILOT_DATE_ALIASES = ["pilot_date", "pilotDateOnly", "date", "schedule_date", "movement_date", "도선일자", "예정일자", "일자"];
const ALL_PILOT_TIME_ALIASES = [...new Set([...PILOT_TIME_ALIASES, "도선시간", "도선일시", "예정시간", "movement_time", "movementTime", "시간"])];
const ALL_PILOT_DIRECTION_ALIASES = [...new Set([...PILOT_DIRECTION_ALIASES, "입출항", "구분", "도선구분", "movement_type"])];
const ALL_PILOT_STATION_ALIASES = [...new Set([...PILOT_STATION_ALIASES, "도선점", "도선구", "승선지", "하선지"])];
const ALL_PILOT_DATE_ALIASES = [...new Set(PILOT_DATE_ALIASES)];

const LIGHTWEIGHT_CSV_SCHEMA_ALIASES = {
  vessel_identity: ["vessel_name", "ship_name", "name", "\uC120\uBA85", "imo", "imo_no", "IMO", "mmsi", "MMSI", "call_sign", "callsign", "\uD638\uCD9C\uBD80\uD638"],
  vessel_spec: ["gt", "gross_tonnage", "\uCD1D\uD1A4\uC218", "dwt", "\uC7AC\uD654\uC911\uB7C9\uD1A4"],
  port_status: ["port", "port_name", "\uD56D\uB9CC", "berth", "berth_name", "\uC120\uC11D", "anchorage", "\uC815\uBC15\uC9C0", "eta", "etb", "ata", "atd", "status", "\uC0C1\uD0DC", "last_seen", "observed_at", "updated_at"]
};

const PNC_FIELD_ALIASES = {
  vessel_name: [
    "vessel_name", "vesselName", "ship_name", "shipName", "vslNm", "vsslNm",
    "vessel", "ship", "VSL_NM", "VSSL_NM", "모선명", "선명", "선박명"
  ],
  call_sign: [
    "call_sign", "callSign", "callsign", "callSignNo", "clsgn", "vsslCallSgn",
    "CALL_SIGN", "호출부호", "콜사인"
  ],
  terminal_vessel_code: [
    "terminal_vessel_code", "vessel_code", "vesselCode", "vslCd", "VSL_CD",
    "pnc_vessel_code", "mother_vessel_code", "모선코드"
  ],
  terminal: [
    "terminal", "terminal_name", "terminalName", "terminalNm", "tmnlNm",
    "TERMINAL_NM", "터미널", "터미널명"
  ],
  berth: [
    "berth", "berth_name", "berthName", "berthNm", "brthNm", "berthNo",
    "BERTH_NM", "선석", "선석명", "접안지", "부두"
  ],
  eta: ["eta", "ETA", "estimatedArrival", "arrivalPlanDt", "arrPlanDt", "입항예정", "입항예정일시"],
  etb: ["etb", "ETB", "estimatedBerthing", "berthPlanDt", "접안예정", "접안예정일시"],
  ata: ["ata", "ATA", "actualArrival", "arrivalDt", "arrDt", "입항일시"],
  atb: ["atb", "ATB", "actualBerthing", "berthDt", "접안일시"],
  operation_start: [
    "operation_start", "operationStart", "workStart", "cargoStart", "startTime",
    "작업시작", "작업시작일시"
  ],
  operation_end: [
    "operation_end", "operationEnd", "workEnd", "cargoEnd", "endTime",
    "작업종료", "작업종료일시"
  ],
  operation: ["operation", "operation_type", "workType", "cargoType", "작업", "작업구분"],
  port: ["port", "port_name", "portName", "prtNm", "portCode", "prtAgCd", "항만", "항명"],
  status: ["status", "berth_status", "operationStatus", "workStatus", "상태", "작업상태"]
};

const PNC_REQUIRED_FIELD_GROUPS = {
  vessel_identity: ["vessel_name", "call_sign"],
  berth_context: ["terminal", "berth"],
  timing: ["eta", "etb", "ata", "atb", "operation_start", "operation_end"]
};

function addFieldAliases(field, aliases = []) {
  if (!FIELD_ALIASES[field]) FIELD_ALIASES[field] = [];
  FIELD_ALIASES[field] = [...new Set([...FIELD_ALIASES[field], ...aliases].filter(Boolean))];
}

addFieldAliases("vessel_name", ["vsslKorNm", "vsslEngNm"]);
addFieldAliases("imo", ["imoNo"]);
addFieldAliases("call_sign", ["clsgn", "befClsgn"]);
addFieldAliases("vessel_type", ["vsslKnd", "vsslKndNm", "vsslKndCd"]);
addFieldAliases("flag", ["vsslNlty"]);
addFieldAliases("gt", ["intrlGrtg", "grtg", "international_gt"]);
addFieldAliases("grtg", ["grtg"]);
addFieldAliases("intrlGrtg", ["intrlGrtg", "international_gt"]);
addFieldAliases("loa", ["vsslTotLt", "vsslLt"]);
addFieldAliases("beam", ["shdth"]);
addFieldAliases("berth", ["laidupFcltyNm", "fcltyNm", "facilityNm", "facility_name"]);
addFieldAliases("operator", ["entrpsCdNm", "operator_or_agent_candidate"]);
addFieldAliases("status", ["movement_status", "nvgtSttus", "vslSts", "shipStatus"]);
addFieldAliases("eta", ["eta", "ETA", "etrPlanDt", "arrPlanDt"]);
addFieldAliases("etb", ["etb", "ETB", "berthPlanDt"]);
addFieldAliases("ata", ["ata", "ATA", "etrDt", "arrivalDt"]);
addFieldAliases("atb", ["atb", "ATB", "berthDt"]);
addFieldAliases("etd", ["etd", "ETD", "tkoffPrrrnDt", "departurePlanDt"]);
addFieldAliases("atd", ["atd", "ATD", "tkoffDt", "departureDt"]);
addFieldAliases("vessel_name", ["name", "\uC120\uBA85"]);
addFieldAliases("call_sign", ["callsign", "\uD638\uCD9C\uBD80\uD638"]);
addFieldAliases("gt", ["gross_tonnage", "\uCD1D\uD1A4\uC218"]);
addFieldAliases("dwt", ["\uC7AC\uD654\uC911\uB7C9\uD1A4"]);
addFieldAliases("port", ["\uD56D\uB9CC"]);
addFieldAliases("berth", ["\uC120\uC11D"]);
addFieldAliases("anchorage_zone", ["anchorage", "\uC815\uBC15\uC9C0"]);
addFieldAliases("status", ["\uC0C1\uD0DC"]);
addFieldAliases("received_at", ["last_seen", "observed_at", "updated_at"]);

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

function parseReferenceCsv(text) {
  const lines = String(text || "").replace(/^\uFEFF/, "").split(/\r?\n/).filter(line => line.trim());
  if (lines.length < 2) return [];
  const parseLine = line => {
    const cells = [];
    let current = "";
    let quoted = false;
    for (let index = 0; index < line.length; index += 1) {
      const char = line[index];
      const next = line[index + 1];
      if (char === '"' && quoted && next === '"') {
        current += '"';
        index += 1;
      } else if (char === '"') {
        quoted = !quoted;
      } else if (char === "," && !quoted) {
        cells.push(current.trim());
        current = "";
      } else {
        current += char;
      }
    }
    cells.push(current.trim());
    return cells;
  };
  const headers = parseLine(lines[0]);
  return lines.slice(1).map(line => {
    const values = parseLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, values[index] || ""]));
  });
}

function truthyFlag(value) {
  return /^(1|true|yes|y)$/i.test(String(value || "").trim());
}

function slug(value = "") {
  return String(value || "")
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function loadPortsRegistry() {
  if (portsRegistryCache) return portsRegistryCache;
  if (!fs.existsSync(PORTS_REGISTRY_PATH)) {
    portsRegistryCache = DEFAULT_PORT_REGISTRY;
    return portsRegistryCache;
  }
  const rows = parseReferenceCsv(fs.readFileSync(PORTS_REGISTRY_PATH, "utf8"));
  portsRegistryCache = rows.length ? rows : DEFAULT_PORT_REGISTRY;
  return portsRegistryCache;
}

function portRegistryRows() {
  return loadPortsRegistry()
    .map(row => ({
      ...row,
      prtAgCd: row.prtAgCd || row.port_code,
      port_code: row.port_code || row.prtAgCd,
      port_name_en: row.port_name_en || row.port_name || row.port_group || row.sub_port,
      port_name_ko: row.port_name_ko || row.port_name_en || row.port_name || row.port_group || row.sub_port,
      enabled: row.enabled === "" ? "true" : row.enabled
    }))
    .filter(row => row.prtAgCd);
}

function buildPortCoverageRegistryDiagnostics(ports = configuredPortOperationPorts()) {
  const registry = portRegistryRows();
  const enabledRegistry = registry.filter(row => truthyFlag(row.enabled));
  const uniqueAttemptCodes = new Set(ports.map(port => port.code).filter(Boolean));
  return {
    registry_path: PORTS_REGISTRY_PATH,
    registry_rows_count: registry.length,
    enabled_ports_count: enabledRegistry.length,
    enabled_port_operation_rows_count: enabledRegistry.filter(row => truthyFlag(row.has_port_operation)).length,
    tier1_ports_count: enabledRegistry.filter(row => String(row.tier) === "1").length,
    tier2_ports_count: enabledRegistry.filter(row => String(row.tier) === "2").length,
    tier3_ports_count: enabledRegistry.filter(row => String(row.tier) === "3").length,
    unique_prtAgCd_count: uniqueAttemptCodes.size,
    unique_prtAgCd: [...uniqueAttemptCodes].sort()
  };
}

function runtimeEnvDiagnostics() {
  return {
    PORT_OPERATION_API_URL: Boolean(process.env.PORT_OPERATION_API_URL),
    PORT_OPERATION_SERVICE_KEY: Boolean(process.env.PORT_OPERATION_SERVICE_KEY),
    PORT_OPERATION_API_KEY: Boolean(process.env.PORT_OPERATION_API_KEY),
    PORT_FACILITY_API_URL: Boolean(process.env.PORT_FACILITY_API_URL),
    PORT_FACILITY_SERVICE_KEY: Boolean(process.env.PORT_FACILITY_SERVICE_KEY),
    PORT_FACILITY_API_KEY: Boolean(process.env.PORT_FACILITY_API_KEY),
    VESSEL_SPEC_API_URL: Boolean(process.env.VESSEL_SPEC_API_URL),
    VESSEL_SPEC_SERVICE_KEY: Boolean(process.env.VESSEL_SPEC_SERVICE_KEY),
    ULSAN_API_URL: Boolean(process.env.ULSAN_API_URL),
    ULSAN_API_OPERATION: Boolean(process.env.ULSAN_API_OPERATION),
    ULSAN_API_KEY: Boolean(process.env.ULSAN_API_KEY),
    SERVICE_KEY: Boolean(process.env.SERVICE_KEY),
    SERVICEKEY: Boolean(process.env.SERVICEKEY),
    YGPA_SERVICE_KEY: Boolean(process.env.YGPA_SERVICE_KEY),
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

function collectorSkipReason(reason = "", { validationMode = "" } = {}) {
  const text = String(reason || "").toLowerCase();
  const mode = String(validationMode || process.env.VALIDATION_MODE || (process.env.CI === "true" ? "production" : "local")).toLowerCase();
  if (text.includes("missing_port_operation_service_key_and_api_url") || text.includes("missing_service_key_and_api_url")) return "missing_service_key_and_api_url";
  if (text.includes("no_enabled") || text.includes("enabled_ports_count_zero")) return "no_enabled_ports";
  if (text.includes("collector_disabled") || text.includes("source_disabled")) return "collector_disabled";
  if (text.includes("source_schedule")) return "source_schedule_window_not_due";
  if (text.includes("validation_mode_blocks")) return "validation_mode_blocks_collection";
  if ((text.includes("missing_port_operation_service_key") || text.includes("missing_service_key") || text.includes("embedded_key")) && mode === "local") return "local_no_secret_mode";
  if (text.includes("missing_port_operation_service_key") || text.includes("missing_service_key") || text.includes("embedded_key")) return "missing_service_key";
  if (text.includes("missing_port_operation_api_url") || text.includes("missing_api_url") || text.includes("missing_url")) return "missing_api_url";
  if (mode === "local" && !envAny("PORT_OPERATION_SERVICE_KEY", "PORT_OPERATION_API_KEY", "DATA_GO_KR_API_KEY", "SERVICE_KEY", "SERVICEKEY", "YGPA_SERVICE_KEY")) return "local_no_secret_mode";
  return "unknown_error";
}

function portOperationPreflightFailureReason(failures = [], { validationMode = "" } = {}) {
  const normalized = failures.map(value => String(value || "").toLowerCase());
  const missingServiceKey = normalized.some(value => value.includes("missing_port_operation_service_key"));
  const missingApiUrl = normalized.some(value => value.includes("missing_port_operation_api_url"));
  if (missingServiceKey && missingApiUrl) return "missing_service_key_and_api_url";
  return collectorSkipReason(failures[0], { validationMode });
}

function sourceCsvEnabled() {
  const mode = sourceCsvMode();
  if (mode === "off" || mode === "raw" || mode === "full") return false;
  if (mode && !["lightweight", "refresh", "cache_only"].includes(mode)) return false;
  if (mode === "cache_only") return false;
  return String(process.env.ENABLE_SOURCE_CSV || "").toLowerCase() === "true";
}

function sourceCsvUrl() {
  const mode = sourceCsvMode();
  if (mode === "lightweight") return resolveLightweightCsvSource().url || "";
  if (mode === "refresh") return env("SOURCE_LIGHTWEIGHT_CSV_URL") || env("SOURCE_CSV_URL") || "";
  return env("SOURCE_LIGHTWEIGHT_CSV_URL") || env("SOURCE_CSV_URL") || "";
}

function vesselSpecUrl() {
  return env("VESSEL_SPEC_API_URL") || (env("VESSEL_SPEC_SERVICE_KEY") ? DEFAULT_VESSEL_SPEC_API_URL : "");
}

function ulsanVesselOperationUrl() {
  const base = env("ULSAN_API_URL");
  if (!base) return "";
  const operation = env("ULSAN_API_OPERATION") || DEFAULT_ULSAN_OPERATION;
  const normalizedBase = base.replace(/\/+$/, "");
  if (new RegExp(`${operation}\\/?$`, "i").test(normalizedBase)) return normalizedBase;
  return `${normalizedBase}/${String(operation).replace(/^\/+/, "")}`;
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

function compactDateMs(value) {
  const text = String(value || "").trim();
  if (!/^\d{8}$/.test(text)) return NaN;
  const year = Number(text.slice(0, 4));
  const month = Number(text.slice(4, 6));
  const day = Number(text.slice(6, 8));
  return Date.UTC(year, month - 1, day);
}

function configuredPortOperationPorts() {
  const raw = env("PORT_OPERATION_PORT_CODES") || env("PORT_MIS_PORT_CODES");
  const registryRows = portRegistryRows()
    .filter(row => truthyFlag(row.enabled) && truthyFlag(row.has_port_operation))
    .map(row => ({
      name: slug(row.port_group || row.port_name_en || row.sub_port || row.prtAgCd),
      code: row.prtAgCd,
      portCode: row.port_code || row.prtAgCd,
      portName: row.port_group || row.port_name_en || row.port_name_ko || row.sub_port || row.prtAgCd,
      portNameKo: row.port_name_ko || row.port_name_en || row.sub_port || row.prtAgCd,
      portGroup: row.port_group || row.port_name_en || row.port_name_ko || row.prtAgCd,
      subPort: row.sub_port || row.port_name_en || row.port_name_ko || "",
      tier: row.tier || "",
      commercialFocus: row.commercial_focus || "",
      commercialPriority: row.commercial_priority || "",
      anchorageRelevance: row.anchorage_relevance || ""
    }));
  const registry = [...registryRows.reduce((map, port) => {
    const existing = map.get(port.code);
    if (!existing) {
      map.set(port.code, port);
      return map;
    }
    existing.subPort = [...new Set([existing.subPort, port.subPort].filter(Boolean).join("/").split("/").map(value => value.trim()).filter(Boolean))].join("/");
    existing.commercialFocus = [...new Set([existing.commercialFocus, port.commercialFocus].filter(Boolean).join(",").split(",").map(value => value.trim()).filter(Boolean))].join(",");
    existing.commercialPriority = existing.commercialPriority === "high" || port.commercialPriority !== "high" ? existing.commercialPriority : port.commercialPriority;
    existing.anchorageRelevance = existing.anchorageRelevance === "high" || port.anchorageRelevance !== "high" ? existing.anchorageRelevance : port.anchorageRelevance;
    return map;
  }, new Map()).values()];
  const applyPortLimit = ports => ports.slice(0, Math.max(1, MAX_PORTS_PER_RUN));
  if (!raw) return applyPortLimit(registry);
  const mapped = [...registry];
  for (const part of raw.split(/[,\n]+/).map(v => v.trim()).filter(Boolean)) {
    const [name, code] = part.split(/[:=]/).map(v => v?.trim()).filter(Boolean);
    if (name && code) {
      mapped.push({
        name: slug(name),
        code,
        portCode: code,
        portName: name,
        portNameKo: name,
        portGroup: name,
        subPort: name,
        tier: "override",
        commercialFocus: "env_override",
        commercialPriority: "override",
        anchorageRelevance: ""
      });
    } else if (name) {
      mapped.push({
        name: slug(name),
        code: name,
        portCode: name,
        portName: name,
        portNameKo: name,
        portGroup: name,
        subPort: name,
        tier: "override",
        commercialFocus: "env_override",
        commercialPriority: "override",
        anchorageRelevance: ""
      });
    }
  }
  return applyPortLimit(mapped);
}

function buildCollectorPreflight() {
  const validationMode = String(process.env.VALIDATION_MODE || (process.env.CI === "true" ? "production" : "local")).toLowerCase();
  const registryExists = fs.existsSync(PORTS_REGISTRY_PATH);
  const registry = registryExists ? parseReferenceCsv(fs.readFileSync(PORTS_REGISTRY_PATH, "utf8")) : [];
  const normalizedRegistry = portRegistryRows();
  const enabledRegistry = normalizedRegistry.filter(row => truthyFlag(row.enabled) && truthyFlag(row.has_port_operation));
  const ports = configuredPortOperationPorts();
  const sde = env("PORT_OPERATION_START_DATE") || addDaysCompact(-3);
  const ede = env("PORT_OPERATION_END_DATE") || addDaysCompact(7);
  const sdeMs = compactDateMs(sde);
  const edeMs = compactDateMs(ede);
  const numOfRows = Number(env("PORT_OPERATION_NUM_OF_ROWS") || 50);
  const maxPages = Number(env("PORT_OPERATION_MAX_PAGES") || 20);
  const serviceKey = envAny("PORT_OPERATION_SERVICE_KEY", "PORT_OPERATION_API_KEY", "DATA_GO_KR_API_KEY", "SERVICE_KEY", "SERVICEKEY", "YGPA_SERVICE_KEY");
  const apiUrl = env("PORT_OPERATION_API_URL") || DEFAULT_PORT_OPERATION_API_URL;
  const directions = (env("PORT_OPERATION_DEGB_VALUES") || "I,O")
    .split(/[,\s]+/)
    .map(value => value.trim())
    .filter(Boolean);
  const portOperationCollectorEnabled = ports.length > 0 && directions.length > 0;
  const failures = [];
  if (!serviceKey) failures.push("missing_PORT_OPERATION_SERVICE_KEY");
  if (!registryExists) failures.push("ports_registry_csv_missing");
  if (registryExists && !registry.length) failures.push("ports_registry_csv_empty");
  if (!enabledRegistry.length) failures.push("enabled_ports_count_zero");
  if (!portOperationCollectorEnabled) failures.push("port_operation_collector_disabled");
  if (!Number.isFinite(sdeMs) || !Number.isFinite(edeMs) || sdeMs > edeMs) failures.push("invalid_PORT_OPERATION_date_window");
  if (!Number.isFinite(numOfRows) || numOfRows <= 0) failures.push("invalid_PORT_OPERATION_NUM_OF_ROWS");
  if (!Number.isFinite(maxPages) || maxPages <= 0) failures.push("invalid_PORT_OPERATION_MAX_PAGES");
  const preflightFailureReason = portOperationPreflightFailureReason(failures, { validationMode });
  return {
    ok: failures.length === 0,
    failures,
    raw_preflight_failure_reason: failures[0] || null,
    preflight_failure_reason: failures.length ? preflightFailureReason : null,
    port_operation_collector_enabled: portOperationCollectorEnabled,
    port_operation_secret_present: Boolean(serviceKey),
    port_operation_api_url_present: Boolean(env("PORT_OPERATION_API_URL")),
    port_operation_api_url_effective: Boolean(apiUrl),
    port_operation_api_url_default_used: !env("PORT_OPERATION_API_URL"),
    ports_registry_path: PORTS_REGISTRY_PATH,
    ports_registry_loaded: registryExists && registry.length > 0,
    ports_registry_rows_count: registry.length,
    enabled_ports_count: enabledRegistry.length,
    enabled_ports_loaded_count: enabledRegistry.length,
    enabled_ports_passed_to_collector_count: ports.length,
    ports_attempted_count: 0,
    ports_skipped_reason: failures.length ? preflightFailureReason : null,
    validation_mode: validationMode,
    date_window: { sde, ede, valid: Number.isFinite(sdeMs) && Number.isFinite(edeMs) && sdeMs <= edeMs },
    numOfRows,
    maxPages,
    deGb_values: directions,
    first_5_ports_to_attempt: ports.slice(0, 5).map(port => ({
      prtAgCd: port.code,
      port_code: port.portCode,
      port_name: port.portName,
      port_name_ko: port.portNameKo,
      tier: port.tier,
      sub_port: port.subPort
    })),
    planned_port_operation_sources: ports.flatMap(port => directions.map(deGb => ({
      key: `port_operation_${port.name}_${deGb.toLowerCase()}`,
      source_name: `port_operation_${port.name}_${deGb.toLowerCase()}`,
      label: `PORT-MIS VsslEtrynd5 ${port.portName} ${deGb}`,
      prtAgCd: port.code,
      port_code: port.portCode,
      port_name: port.portName,
      deGb,
      skipped: true,
      attempted: false,
      skip_reason: failures.length ? preflightFailureReason : null,
      reason: failures.length ? preflightFailureReason : null,
      raw_skip_reason: failures[0] || null
    })))
  };
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
  const variants = [];
  try {
    const decoded = decodeURIComponent(raw);
    if (decoded && decoded !== raw) variants.push({ name: "decoded", value: decoded });
  } catch {
    // Keep only the provided key.
  }
  variants.push({ name: "as_provided", value: raw });
  return variants;
}

function parseCsvLine(line = "") {
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
  } else {
    const firstLine = trimmed.split(/\r?\n/, 1)[0] || "";
    if (firstLine.includes(",")) {
      meta.header_fields = parseCsvLine(firstLine).map(field => String(field || "").trim()).filter(Boolean).slice(0, 80);
      meta.row_count_estimate = Math.max(0, trimmed.split(/\r?\n/).filter(Boolean).length - 1);
    }
  }
  return meta;
}

function fileNameHintFromResponse(url, headers) {
  const disposition = headers.get("content-disposition") || "";
  const match = disposition.match(/filename\*?=(?:UTF-8''|")?([^";]+)/i);
  if (match) return decodeURIComponent(match[1]).replace(/[\\/?#].*$/, "").slice(0, 120);
  try {
    return path.basename(new URL(url).pathname).slice(0, 120) || null;
  } catch {
    return null;
  }
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

function lightweightCsvSchemaStatus(headers = []) {
  const normalizedHeaders = new Set(headers.map(header => String(header || "").trim().toLowerCase()).filter(Boolean));
  const hasAny = aliases => aliases.some(alias => normalizedHeaders.has(String(alias || "").trim().toLowerCase()));
  const groups = {
    vessel_identity: hasAny(LIGHTWEIGHT_CSV_SCHEMA_ALIASES.vessel_identity),
    vessel_spec: hasAny(LIGHTWEIGHT_CSV_SCHEMA_ALIASES.vessel_spec),
    port_status: hasAny(LIGHTWEIGHT_CSV_SCHEMA_ALIASES.port_status)
  };
  return {
    ok: groups.vessel_identity && (groups.port_status || groups.vessel_spec),
    groups,
    header_fields: headers
  };
}

function isPncSourceConfig(source = {}) {
  return String(source.key || "").startsWith("pnc_source_");
}

function pncValue(row = {}, field) {
  return firstValue(row, PNC_FIELD_ALIASES[field] || []);
}

function safeTextSample(value) {
  const text = String(value ?? "").replace(/[\r\n\t]+/g, " ").trim();
  return text.length > 120 ? `${text.slice(0, 117)}...` : text;
}

function sanitizeSourceSample(row = {}) {
  const entries = Object.entries(row || {}).slice(0, 30).map(([key, value]) => {
    if (/token|secret|service.?key|api.?key|password|auth|url/i.test(key)) return [key, "[redacted]"];
    return [key, safeTextSample(value)];
  });
  return Object.fromEntries(entries);
}

function pncAliasDiagnostics(rawRows = [], normalizedRows = []) {
  const aliasMatched = Object.fromEntries(Object.entries(PNC_FIELD_ALIASES).map(([field, aliases]) => [
    field,
    rawRows.some(row => Boolean(firstValue(row, aliases)))
  ]));
  const missingRequiredFields = Object.fromEntries(Object.entries(PNC_REQUIRED_FIELD_GROUPS).map(([group, fields]) => [
    group,
    fields.filter(field => !aliasMatched[field])
  ]));
  const blockers = [];
  if (!aliasMatched.vessel_name && !aliasMatched.call_sign) blockers.push("missing_vessel_name_or_call_sign_alias");
  if (!aliasMatched.berth && !aliasMatched.terminal) blockers.push("missing_berth_or_terminal_alias");
  if (!aliasMatched.eta && !aliasMatched.etb && !aliasMatched.ata && !aliasMatched.atb) blockers.push("missing_arrival_or_berth_time_alias");
  return {
    raw_sample_keys: [...new Set(rawRows.slice(0, 5).flatMap(row => Object.keys(row || {})))].slice(0, 80),
    sanitized_raw_samples: rawRows.slice(0, 5).map(sanitizeSourceSample),
    expected_field_aliases_matched: aliasMatched,
    missing_required_fields: missingRequiredFields,
    parser_blockers: normalizedRows.length ? [] : blockers
  };
}

function vesselSpecAliasDiagnostics(rawRows = [], normalizedRows = []) {
  const aliasGroups = {
    vessel_name: FIELD_ALIASES.vessel_name,
    imo: FIELD_ALIASES.imo,
    call_sign: FIELD_ALIASES.call_sign,
    vessel_type: FIELD_ALIASES.vessel_type,
    gt: FIELD_ALIASES.gt,
    international_gt: FIELD_ALIASES.intrlGrtg,
    net_tonnage: ["net_tonnage", "ntng", "NTNG"],
    flag: FIELD_ALIASES.flag,
    loa: FIELD_ALIASES.loa,
    beam: FIELD_ALIASES.beam,
    draft: ["draft", "vsslDrft", "VSSL_DRFT"],
    built_date: ["built_date", "vsslCnstrDt", "VSSL_CNSTR_DT"]
  };
  const aliasMatched = Object.fromEntries(Object.entries(aliasGroups).map(([field, aliases]) => [
    field,
    rawRows.some(row => Boolean(firstValue(row, aliases)))
  ]));
  const blockers = [];
  if (!aliasMatched.vessel_name && !aliasMatched.imo && !aliasMatched.call_sign) {
    blockers.push("missing_identity_alias");
  }
  if (!aliasMatched.imo && !aliasMatched.call_sign) {
    blockers.push("missing_identifier_alias");
  }
  if (!aliasMatched.gt && !aliasMatched.international_gt && !aliasMatched.vessel_type && !aliasMatched.flag && !aliasMatched.loa && !aliasMatched.beam) {
    blockers.push("missing_specification_alias");
  }
  if (!rawRows.length) blockers.push("empty_response_rows");
  return {
    raw_sample_keys: [...new Set(rawRows.slice(0, 5).flatMap(row => Object.keys(row || {})))].slice(0, 80),
    sanitized_raw_samples: rawRows.slice(0, 5).map(sanitizeSourceSample),
    expected_field_aliases_matched: aliasMatched,
    parser_alias_coverage: aliasMatched,
    missing_required_fields: {
      identity: Object.entries(aliasMatched).filter(([field, matched]) => ["vessel_name", "imo", "call_sign"].includes(field) && !matched).map(([field]) => field),
      specification: Object.entries(aliasMatched).filter(([field, matched]) => ["vessel_type", "gt", "international_gt", "flag", "loa", "beam", "draft"].includes(field) && !matched).map(([field]) => field)
    },
    parser_blockers: normalizedRows.length ? [] : blockers
  };
}

function normalizeDate(value) {
  const text = String(value || "").trim();
  const normalized = normalizeDateTime(value);
  if (!normalized.timestamp) return "";
  if (/^\d{8}$/.test(text)) return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)} 00:00`;
  if (/^\d{12}$/.test(text)) return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)} ${text.slice(8, 10)}:${text.slice(10, 12)}`;
  if (/^\d{14}$/.test(text)) return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)} ${text.slice(8, 10)}:${text.slice(10, 12)}`;
  return text.replace("T", " ").replace(/:\d{2}\.\d{3}Z$/, "");
}

function isPilotTimeOnly(value) {
  const text = String(value || "").trim();
  return /^(?:[01]?\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(text);
}

function pilotDatePart(value) {
  const normalized = normalizeDate(value);
  const match = String(normalized || "").match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : "";
}

function isParseablePilotTimestamp(value) {
  const text = String(value || "").trim();
  if (!text || isPilotTimeOnly(text) || !/^\d{4}-\d{2}-\d{2}/.test(text)) return false;
  const parsed = new Date(text.replace(" ", "T"));
  return Number.isFinite(parsed.getTime());
}

function normalizePilotTime(value, dateValue = "") {
  const raw = String(value || "").trim();
  const rawDate = String(dateValue || "").trim();
  const fallback = {
    raw_pilot_time: raw,
    pilot_date: pilotDatePart(rawDate),
    pilot_time_text: raw,
    pilot_time_local: "",
    pilot_timestamp: "",
    parse_status: raw ? "invalid_date_time" : "missing"
  };
  if (!raw) return fallback;
  const dateTime = normalizeDateTime(raw);
  const normalized = normalizeDate(raw);
  const localTime = dateTime.time_only_missing_date ? dateTime.time_text : (isPilotTimeOnly(normalized) ? normalized : "");
  if (localTime) {
    const datePart = pilotDatePart(rawDate);
    if (datePart) {
      const combined = `${datePart} ${localTime}`;
      return {
        raw_pilot_time: raw,
        pilot_date: datePart,
        pilot_time_text: raw,
        pilot_time_local: localTime,
        pilot_timestamp: combined,
        parse_status: "parsed_date_time"
      };
    }
    return {
      raw_pilot_time: raw,
      pilot_date: "",
      pilot_time_text: raw,
      pilot_time_local: localTime,
      pilot_timestamp: "",
      parse_status: "time_only_missing_date"
    };
  }
  if (isParseablePilotTimestamp(normalized)) {
    return {
      raw_pilot_time: raw,
      pilot_date: pilotDatePart(normalized),
      pilot_time_text: raw,
      pilot_time_local: "",
      pilot_timestamp: normalized,
      parse_status: "parsed_full_timestamp"
    };
  }
  return fallback;
}

function toNumber(value) {
  return normalizeNumeric(value) ?? 0;
}

function sourceType(source = {}) {
  if (source.key === "source_csv") return "lightweight_reference";
  if (String(source.key || "").startsWith("pilot_source_")) return "pilot_schedule";
  if (source.key === "vessel_spec") return "identity";
  if (isPncSourceConfig(source)) return "schedule_or_berth";
  if (source.key === "mof_ais_dynamic") return "movement_only";
  if (source.key === "mof_ais_info") return "identity";
  if (source.key === "mof_ais_stat") return "traffic_stat";
  if (String(source.key || "").startsWith("mof_vts_")) return "vts_movement";
  if (String(source.key || "").startsWith("port_operation_")) return "schedule_or_berth";
  if (/berth|operation|cargo|terminal|port_operation/i.test(source.key || "")) return "schedule_or_berth";
  return "public_api";
}

function hasScheduleSignal(record = {}) {
  return Boolean(record.eta || record.etb || record.ata || record.atb || record.etd || record.atd || record.eta_candidate || record.etb_candidate || record.etd_candidate || record.pilot_time || record.pilot_time_text || record.berth);
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
  if (type === "pilot_schedule") {
    adapted.status = firstValue(row, FIELD_ALIASES.status) || "Pilot schedule";
    adapted.port = firstValue(row, FIELD_ALIASES.port) || source.portName || source.portCode || "";
  }
  if (isPncSourceConfig(source)) {
    adapted.status = firstValue(row, FIELD_ALIASES.status) || pncValue(row, "status") || "PNC berth schedule";
    adapted.port = firstValue(row, FIELD_ALIASES.port) || pncValue(row, "port") || source.portName || source.portCode || "";
  }
  return adapted;
}

function allSourceConfigs() {
  const vtsBase = env("MOF_VTS_API_BASE");
  const vtsKey = env("MOF_VTS_SERVICE_KEY");
  const sde = env("PORT_OPERATION_START_DATE") || addDaysCompact(-3);
  const ede = env("PORT_OPERATION_END_DATE") || addDaysCompact(7);
  const portOperationUrl = env("PORT_OPERATION_API_URL") || DEFAULT_PORT_OPERATION_API_URL;
  const portOperationKey = envAny("PORT_OPERATION_SERVICE_KEY", "PORT_OPERATION_API_KEY", "DATA_GO_KR_API_KEY", "SERVICE_KEY", "SERVICEKEY", "YGPA_SERVICE_KEY");
  const portOperationDirections = (env("PORT_OPERATION_DEGB_VALUES") || "I,O")
    .split(/[,\s]+/)
    .map(value => value.trim())
    .filter(Boolean);
  const portOperationPorts = configuredPortOperationPorts();
  diagnostics.port_registry = buildPortCoverageRegistryDiagnostics(portOperationPorts);
  const portOperationSources = portOperationPorts.flatMap(port => portOperationDirections.map(deGb => ({
    key: `port_operation_${port.name}_${deGb.toLowerCase()}`,
    label: `PORT-MIS VsslEtrynd5 ${port.portName} ${deGb}`,
    url: portOperationUrl,
    serviceKey: portOperationKey,
    serviceKeyVariants: serviceKeyVariants(portOperationKey),
    portName: port.portName,
    portNameKo: port.portNameKo,
    portGroup: port.portGroup,
    subPort: port.subPort,
    portTier: port.tier,
    commercialFocus: port.commercialFocus,
    commercialPriority: port.commercialPriority,
    anchorageRelevance: port.anchorageRelevance,
    prtAgCd: port.code,
    portCode: port.portCode,
    noTypeParam: true,
    defaultParams: {
      prtAgCd: port.code,
      sde,
      ede,
      deGb,
      pageNo: "1",
      numOfRows: env("PORT_OPERATION_NUM_OF_ROWS") || "50"
    }
  })));
  diagnostics.port_operation_collection_plan = {
    port_operation_collector_enabled: portOperationPorts.length > 0,
    port_operation_secret_present: Boolean(portOperationKey),
    port_operation_api_url_present: Boolean(env("PORT_OPERATION_API_URL")),
    port_operation_api_url_default_used: !env("PORT_OPERATION_API_URL"),
    port_operation_api_url_effective: Boolean(portOperationUrl),
    enabled_ports_loaded_count: portRegistryRows().filter(row => truthyFlag(row.enabled) && truthyFlag(row.has_port_operation)).length,
    enabled_ports_passed_to_collector_count: portOperationPorts.length,
    port_operation_source_count: portOperationSources.length,
    deGb_values: portOperationDirections,
    ports_skipped_reason: portOperationPorts.length === 0
      ? "no_enabled_port_operation_ports_in_registry"
      : !portOperationKey
        ? "missing_PORT_OPERATION_SERVICE_KEY"
        : !portOperationUrl
          ? "missing_PORT_OPERATION_API_URL"
          : null,
    first_5_ports_to_attempt: portOperationPorts.slice(0, 5).map(port => ({
      prtAgCd: port.code,
      port_code: port.portCode,
      port_name: port.portName,
      port_name_ko: port.portNameKo,
      tier: port.tier,
      sub_port: port.subPort
    }))
  };
  const vtsCodes = (env("MOF_VTS_PORT_CODES") || "BUSAN,YEOSU,GWANGYANG,ULSAN,PYEONGTAEK,POHANG,HADONG,MASAN,INCHEON")
    .split(/[,\s]+/)
    .map(code => code.trim())
    .filter(Boolean);
  const pncSources = (env("PNC_SOURCE_URLS") || "")
    .split(/[,\n]+/)
    .map((url, index) => url.trim() ? {
      key: `pnc_source_${index + 1}`,
      label: `PNC berth/schedule ${index + 1}`,
      url: url.trim(),
      serviceKey: null,
      noKeyRequired: true,
      portName: "Busan",
      portCode: "020",
      maxRows: Math.min(MAX_SOURCE_ROWS, 500)
    } : null)
    .filter(Boolean);
  const pilotSources = (env("PILOT_SOURCE_URLS") || "")
    .split(/[,\n]+/)
    .map((url, index) => url.trim() ? {
      key: `pilot_source_${index + 1}`,
      label: `Pilot schedule ${index + 1}`,
      url: url.trim(),
      serviceKey: null,
      noKeyRequired: true,
      maxRows: Math.min(MAX_SOURCE_ROWS, 1000)
    } : null)
    .filter(Boolean);

  const lightweightCsv = resolveLightweightCsvSource();
  return [
    {
      key: "source_csv",
      label: "Lightweight verified vessel reference CSV",
      url: sourceCsvEnabled() ? sourceCsvUrl() : "",
      localPath: sourceCsvMode() === "lightweight" ? lightweightCsv.localPath : null,
      path_or_url: sourceCsvMode() === "lightweight" ? lightweightCsv.path_or_url : null,
      lightweight_resolve_status: sourceCsvMode() === "lightweight" ? lightweightCsv.status : null,
      lightweight_source_type: sourceCsvMode() === "lightweight" ? lightweightCsv.type : null,
      lightweight_bytes: sourceCsvMode() === "lightweight" ? lightweightCsv.bytes : null,
      serviceKey: null,
      noKeyRequired: true,
      disabledReason: "disabled_by_default_enable_source_csv_true",
      maxRows: MAX_SOURCE_ROWS
    },
    { key: "vessel_spec", label: "MOF vessel specification SicsVsslManp3 Info3", url: vesselSpecUrl(), serviceKey: env("VESSEL_SPEC_SERVICE_KEY"), maxRows: Math.min(Number(env("VESSEL_SPEC_PER_PAGE") || 50), 50) },
    {
      key: "port_facility_child_enrichment",
      label: "CargHarborUse2 child enrichment",
      url: env("PORT_FACILITY_API_URL") || DEFAULT_CARGO_HARBOR_USE_API_URL,
      serviceKey: envAny("PORT_FACILITY_SERVICE_KEY", "PORT_FACILITY_API_KEY", "PORT_OPERATION_SERVICE_KEY", "PORT_OPERATION_API_KEY", "DATA_GO_KR_API_KEY", "SERVICE_KEY", "SERVICEKEY"),
      noTypeParam: true,
      maxRows: 50
    },
    ...portOperationSources,
    ...pilotSources,
    { key: "ulsan_vessel_operation", label: "Ulsan vessel operation", url: ulsanVesselOperationUrl(), serviceKey: env("ULSAN_API_KEY"), defaultParams: { numOfRows: env("ULSAN_NUM_OF_ROWS") || "100" }, maxRows: Math.min(Number(env("ULSAN_MAX_ROWS") || MAX_SOURCE_ROWS), MAX_SOURCE_ROWS) },
    { key: "ulsan_berth_detail", label: "Ulsan berth detail", url: env("ULSAN_BERTH_DETAIL_API_URL"), serviceKey: envAny("ULSAN_BERTH_DETAIL_API_KEY", "ULSAN_API_KEY") },
    { key: "ulsan_cargo_plan", label: "Ulsan cargo plan", url: env("ULSAN_CARGO_PLAN_API_URL"), serviceKey: envAny("ULSAN_CARGO_PLAN_API_KEY", "ULSAN_API_KEY") },
    { key: "ulsan_berth_operation", label: "Ulsan berth operation", url: env("ULSAN_BERTH_OPERATION_API_URL"), serviceKey: envAny("ULSAN_BERTH_OPERATION_API_KEY", "ULSAN_API_KEY") },
    { key: "ulsan_terminal_process", label: "Ulsan terminal process", url: env("ULSAN_TERMINAL_PROCESS_API_URL"), serviceKey: envAny("ULSAN_TERMINAL_PROCESS_API_KEY", "ULSAN_API_KEY") },
    ...pncSources,
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

function looksLikeHtmlErrorPage(text = "", contentType = "") {
  const type = String(contentType || "").toLowerCase();
  const body = String(text || "").trim().toLowerCase();
  if (!body || !type.includes("html")) return false;
  if (/<table\b/i.test(body)) return false;
  return body.includes("<title>오류페이지</title>") ||
    body.includes("error.png") ||
    body.includes("error page") ||
    body.includes("exception") ||
    body.includes("service error");
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isTransientCollectorError(error = {}) {
  const status = Number(error.http_status || 0);
  const message = String(error?.message || error?.name || "").toLowerCase();
  return status === 429 ||
    status >= 500 ||
    message.includes("timeout") ||
    message.includes("abort") ||
    message.includes("network") ||
    message.includes("fetch failed") ||
    error?.name === "AbortError";
}

function isPermanentCollectorError(error = {}) {
  const status = Number(error.http_status || 0);
  const message = String(error?.message || "").toLowerCase();
  return status === 400 ||
    status === 401 ||
    status === 403 ||
    message.includes("missing_service_key") ||
    message.includes("missing service key") ||
    message.includes("invalid schema");
}

async function fetchText(source, extraParams = {}) {
  const variants = source.serviceKeyVariants?.length ? source.serviceKeyVariants : [{ name: "default", value: source.serviceKey }];
  let lastError = null;
  for (const variant of variants) {
    const sourceVariant = { ...source, serviceKey: variant.value };
    for (let attempt = 0; attempt <= SOURCE_MAX_RETRIES; attempt += 1) {
      try {
        const result = await fetchTextOnce(sourceVariant, extraParams);
        return { ...result, service_key_variant: variant.name, retry_count: attempt };
      } catch (error) {
        lastError = error;
        error.retry_count = attempt;
        if (isPermanentCollectorError(error) || !isTransientCollectorError(error) || attempt >= SOURCE_MAX_RETRIES) break;
        await sleep(Math.min(5000, 500 * (2 ** attempt)));
      }
    }
    if (!source.serviceKeyVariants?.length) break;
  }
  throw lastError || new Error("request_failed");
}

async function fetchHeadMetadata(url, source = {}) {
  if (String(source?.key || "") !== "source_csv") return { checked: false };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.min(SOURCE_TIMEOUT_MS, 10000));
  try {
    const started = Date.now();
    const res = await fetch(url, {
      method: "HEAD",
      signal: controller.signal,
      headers: { accept: "text/csv, application/json, text/xml, */*" }
    });
    return {
      checked: true,
      ok: res.ok,
      http_status: res.status,
      content_type: res.headers.get("content-type") || "",
      content_length: Number(res.headers.get("content-length") || 0),
      file_name_hint: fileNameHintFromResponse(url, res.headers),
      latency_ms: Date.now() - started
    };
  } catch (error) {
    return {
      checked: false,
      error: error?.message || String(error)
    };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchTextOnce(source, extraParams = {}) {
  const controller = new AbortController();
  const timeoutMs = Math.max(1000, Number(source?.timeoutMs || SOURCE_TIMEOUT_MS));
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const url = buildUrl(source, extraParams);
    const started = Date.now();
    const maxResponseBytes = source?.key === "source_csv" ? MAX_SOURCE_CSV_BYTES : MAX_API_RESPONSE_BYTES;
    if (source?.key === "source_csv" && source.localPath) {
      const stats = fs.statSync(source.localPath);
      if (maxResponseBytes > 0 && stats.size > maxResponseBytes) {
        const error = new Error(`Lightweight CSV too large: ${stats.size} bytes`);
        error.failure_reason = "LIGHTWEIGHT_CSV_TOO_LARGE";
        error.response_size_bytes = stats.size;
        error.max_allowed_bytes = maxResponseBytes;
        error.response_content_type = "text/csv; source=local-checkout";
        error.file_name_hint = path.basename(source.localPath);
        throw error;
      }
      const text = fs.readFileSync(source.localPath, "utf8");
      const responseSizeBytes = Buffer.byteLength(text, "utf8");
      return {
        text,
        url,
        http_status: 200,
        response_content_type: "text/csv; source=local-checkout",
        file_name_hint: path.basename(source.localPath),
        response_size_bytes: responseSizeBytes,
        max_allowed_bytes: maxResponseBytes,
        head_checked: false,
        head_http_status: null,
        head_latency_ms: null,
        latency_ms: Date.now() - started,
        result_meta: resultMeta(text)
      };
    }
    if (source?.key === "source_csv") {
      const urlDiagnostic = diagnoseSourceCsvUrl({ sourceCsvUrl: String(url), cwd: process.cwd() });
      if (
        urlDiagnostic.points_to_lightweight_verified_reference_csv &&
        urlDiagnostic.local_reference_exists &&
        !urlDiagnostic.points_to_old_repo &&
        !urlDiagnostic.points_to_old_source_arrivals_csv
      ) {
        const localPath = path.join(process.cwd(), VERIFIED_SOURCE_CSV_PATH);
        const text = fs.readFileSync(localPath, "utf8");
        const responseSizeBytes = Buffer.byteLength(text, "utf8");
        if (maxResponseBytes > 0 && responseSizeBytes > maxResponseBytes) {
          const error = new Error(`API response too large: ${responseSizeBytes} bytes`);
          error.failure_reason = "api_response_too_large";
          error.response_size_bytes = responseSizeBytes;
          error.max_allowed_bytes = maxResponseBytes;
          error.response_content_type = "text/csv; source=local-checkout";
          error.file_name_hint = path.basename(VERIFIED_SOURCE_CSV_PATH);
          throw error;
        }
        return {
          text,
          url,
          http_status: 200,
          response_content_type: "text/csv; source=local-checkout",
          file_name_hint: path.basename(VERIFIED_SOURCE_CSV_PATH),
          response_size_bytes: responseSizeBytes,
          max_allowed_bytes: maxResponseBytes,
          head_checked: false,
          head_http_status: null,
          head_latency_ms: null,
          latency_ms: Date.now() - started,
          result_meta: resultMeta(text)
        };
      }
    }
    const head = await fetchHeadMetadata(url, source);
    if (head.checked && maxResponseBytes > 0 && head.content_length > maxResponseBytes) {
      const error = new Error(`API response too large: ${head.content_length} bytes`);
      error.failure_reason = "api_response_too_large";
      error.response_size_bytes = head.content_length;
      error.max_allowed_bytes = maxResponseBytes;
      error.response_content_type = head.content_type;
      error.file_name_hint = head.file_name_hint;
      error.head_checked = true;
      error.head_http_status = head.http_status || null;
      error.head_latency_ms = head.latency_ms || null;
      throw error;
    }
    const res = await fetch(url, { signal: controller.signal, headers: { accept: "application/json, text/csv, text/xml, */*" } });
    const contentType = res.headers.get("content-type") || head.content_type || "";
    const contentLength = Number(res.headers.get("content-length") || head.content_length || 0);
    const fileNameHint = fileNameHintFromResponse(url, res.headers) || head.file_name_hint;
    if (maxResponseBytes > 0 && contentLength > maxResponseBytes) {
      const error = new Error(`API response too large: ${contentLength} bytes`);
      error.failure_reason = "api_response_too_large";
      error.response_size_bytes = contentLength;
      error.max_allowed_bytes = maxResponseBytes;
      error.response_content_type = contentType;
      error.file_name_hint = fileNameHint;
      throw error;
    }
    const buffer = await res.arrayBuffer();
    if (maxResponseBytes > 0 && buffer.byteLength > maxResponseBytes) {
      const error = new Error(`API response too large: ${buffer.byteLength} bytes`);
      error.failure_reason = "api_response_too_large";
      error.response_size_bytes = buffer.byteLength;
      error.max_allowed_bytes = maxResponseBytes;
      error.response_content_type = contentType;
      error.file_name_hint = fileNameHint;
      throw error;
    }
    const text = decodeResponse(buffer, contentType);
    if (looksLikeHtmlErrorPage(text, contentType)) {
      const error = new Error("API returned an HTML error page");
      error.failure_reason = "html_error_response";
      error.http_status = res.status;
      error.response_content_type = contentType;
      error.response_text = text.slice(0, 500);
      throw error;
    }
    if (!res.ok) {
      const error = new Error(`HTTP ${res.status}`);
      error.http_status = res.status;
      error.response_content_type = contentType;
      error.response_text = text.slice(0, 500);
      throw error;
    }
    return {
      text,
      url,
      http_status: res.status,
      response_content_type: contentType,
      file_name_hint: fileNameHint,
      response_size_bytes: contentLength || buffer.byteLength,
      max_allowed_bytes: maxResponseBytes,
      head_checked: head.checked,
      head_http_status: head.http_status || null,
      head_latency_ms: head.latency_ms || null,
      latency_ms: Date.now() - started,
      result_meta: resultMeta(text)
    };
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

function readJsonSafe(relativePath, fallback = null) {
  try {
    const filePath = path.join(process.cwd(), relativePath);
    return fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, "utf8")) : fallback;
  } catch {
    return fallback;
  }
}

function payloadItems(payload = {}) {
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.vessels)) return payload.vessels;
  if (Array.isArray(payload?.records)) return payload.records;
  if (Array.isArray(payload?.top_candidates)) return payload.top_candidates;
  return [];
}

function loadAuxCandidateRecords() {
  const paths = [
    "dashboard/api/target-vessels.json",
    "dashboard/api/candidates.json",
    "dashboard/api/candidates/top.json",
    "dashboard/api/sales/actions.json",
    "dashboard/api/all-collected-vessels.json",
    "dashboard/api/vessels/page-1.json"
  ];
  const seen = new Set();
  const records = [];
  for (const relativePath of paths) {
    for (const item of payloadItems(readJsonSafe(relativePath, {}))) {
      const display = item?.vessel_display && typeof item.vessel_display === "object" ? item.vessel_display : {};
      const row = { ...display, ...item };
      const callSign = normalizeCallSign(row.canonical_call_sign || row.call_sign || row.callsign || row.clsgn || display.call_sign);
      const name = sharedNormalizeVesselName(row.vessel_name || row.name || display.vessel_name || "");
      const key = [
        row.imo || display.imo || "",
        row.mmsi || display.mmsi || "",
        callSign,
        row.port_call_identity || row.port_call_id || "",
        name
      ].join("|").toUpperCase();
      if (!key.replace(/\|/g, "") || seen.has(key)) continue;
      seen.add(key);
      records.push({
        ...row,
        canonical_call_sign: callSign,
        call_sign: callSign || row.call_sign || display.call_sign || "",
        normalized_vessel_name: name,
        source_snapshot_path: relativePath
      });
    }
  }
  return records;
}

function auxCandidatePriority(record = {}) {
  let score = 0;
  const label = String(record.priority_label || record.priority_label_ko || record.actionability_category || "").toUpperCase();
  if (/HOT|즉시|CONTACT_NOW/.test(label)) score += 100;
  if (/WARM|VERIFY_CONTACT|연락처/.test(label)) score += 70;
  if (record.is_sales_target || record.sales_target || record.qualified_sales_target) score += 60;
  if (record.vessel_spec_enrichment_priority || !record.imo || !record.gt || !record.vessel_type || !record.flag) score += 25;
  score += Math.min(50, Number(record.opportunity_score || record.vessel_display?.opportunity_score || 0));
  return score;
}

function portFacilityParamsFromRecord(record = {}) {
  const identity = String(record.port_call_identity || record.port_call_id || "").trim();
  const pipe = identity.match(/^([^|]+)\|([^|]+)\|([^|]+)\|([^|]+)$/);
  const dashed = identity.match(/-(\d{3})-(\d{3})-(\d{4})-([A-Z0-9]+)-([A-Z0-9]+)$/i);
  const prtAgCd = String(record.prtAgCd || record.prt_ag_cd || record.port_authority_code || (pipe ? pipe[1] : "") || (dashed ? dashed[2] : "") || "").trim();
  const etryptYear = String(record.etryptYear || record.etrypt_year || record.entry_year || (pipe ? pipe[2] : "") || (dashed ? dashed[3] : "") || "").trim();
  const etryptCo = String(record.etryptCo || record.etrypt_co || record.entry_count || (pipe ? pipe[3] : "") || (dashed ? dashed[4] : "") || "").trim();
  const clsgn = normalizeCallSign(record.canonical_call_sign || record.call_sign || record.clsgn || (pipe ? pipe[4] : "") || (dashed ? dashed[5] : ""));
  const missing = [];
  if (!prtAgCd) missing.push("missing_prtAgCd");
  if (!etryptYear) missing.push("missing_etryptYear");
  if (!etryptCo) missing.push("missing_etryptCo");
  if (!clsgn) missing.push("missing_clsgn");
  return { params: missing.length ? null : { prtAgCd, etryptYear, etryptCo, clsgn }, missing };
}

function vesselSpecParamsFromRecord(record = {}) {
  const clsgn = normalizeCallSign(record.canonical_call_sign || record.call_sign || record.clsgn || record.vessel_display?.call_sign);
  const vsslNm = String(record.vessel_name || record.vessel_display?.vessel_name || "").trim();
  return clsgn ? { clsgn, ...(vsslNm ? { vsslNm } : {}) } : null;
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

function parseHtmlRows(text, limit = MAX_SOURCE_ROWS) {
  const clean = value => String(value || "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
  const rows = [];
  for (const tableMatch of String(text || "").matchAll(/<table\b[\s\S]*?<\/table>/gi)) {
    const tableRows = [...tableMatch[0].matchAll(/<tr\b[\s\S]*?<\/tr>/gi)].map(match => match[0]);
    if (tableRows.length < 2) continue;
    const headers = [...tableRows[0].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(match => clean(match[1]));
    if (!headers.length) continue;
    for (const rowHtml of tableRows.slice(1)) {
      const cells = [...rowHtml.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(match => clean(match[1]));
      if (!cells.length) continue;
      rows.push(Object.fromEntries(headers.map((header, index) => [header || `col_${index + 1}`, cells[index] || ""])));
      if (rows.length >= limit) return rows;
    }
  }
  return rows;
}

function parseRows(text, limit = MAX_SOURCE_ROWS) {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return expandRowsWithDetails(flattenJson(JSON.parse(trimmed)).filter(row => row && typeof row === "object")).slice(0, limit);
  if (/<table\b/i.test(trimmed)) return parseHtmlRows(trimmed, limit);
  if (trimmed.startsWith("<")) return parseXmlRows(trimmed).slice(0, limit);
  if (/^[^\n,]+,/.test(trimmed) || trimmed.includes("\n")) {
    const csvRows = parseCsvRows(trimmed, limit);
    if (csvRows.length) return csvRows;
  }
  return parseXmlRows(trimmed).slice(0, limit);
}

async function fetchPagedRows(source, rowLimit, deadline = Infinity) {
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
    latency_ms: firstPage.latency_ms || 0,
    retry_count: firstPage.retry_count || 0,
    resultCode: firstPage.result_meta?.resultCode || null,
    totalCount: firstPage.result_meta?.totalCount || null,
    requested_url_without_service_key: maskServiceKey(firstPage.url)
  }];

  let last = firstPage;
  if (shouldPage) {
    for (let pageNo = 2; pageNo <= totalPagesToCollect; pageNo += 1) {
      if (rows.length >= rowLimit) break;
      if (Date.now() + Math.min(SOURCE_TIMEOUT_MS, 10000) > deadline) break;
      const page = await fetchText(source, { pageNo });
      const pageRows = parseRows(page.text, Math.max(1, rowLimit - rows.length));
      rows.push(...pageRows);
      pageSummaries.push({
        pageNo,
        row_count: pageRows.length,
        http_status: page.http_status,
        latency_ms: page.latency_ms || 0,
        retry_count: page.retry_count || 0,
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
    retry_count: pageSummaries.reduce((sum, page) => sum + Number(page.retry_count || 0), 0),
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
      (isPortOperation && pageSummaries.length < totalPagesToCollect) ||
      rows.length >= rowLimit
    )
  };
}

function smokeFailureReason(error = {}) {
  if (error.failure_reason) return error.failure_reason;
  if (error.http_status) return `smoke_http_status_${error.http_status}`;
  const message = String(error?.message || "unknown_error").trim();
  return message ? `smoke_${message.replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "").toLowerCase()}` : "smoke_unknown_error";
}

function shouldSkipFullPortOperationAfterSmokeFailure(reason = "") {
  return Boolean(String(reason || "").trim());
}

async function runPortOperationSmokeTest(sources = []) {
  const source = sources.find(candidate =>
    String(candidate.key || "").startsWith("port_operation_") &&
    String(candidate.portTier || candidate.tier || "") === "1"
  ) || sources.find(candidate => String(candidate.key || "").startsWith("port_operation_"));
  const startedAt = new Date().toISOString();
  if (!source) {
    return {
      smoke_test_status: "failed",
      smoke_test_failure_reason: "smoke_no_port_operation_source_available",
      started_at: startedAt,
      finished_at: new Date().toISOString()
    };
  }
  try {
    const smokeTimeoutMs = Math.min(SOURCE_TIMEOUT_MS, Math.max(1000, Number(env("PORT_OPERATION_SMOKE_TIMEOUT_MS") || 8000)));
    const response = await fetchText({ ...source, timeoutMs: smokeTimeoutMs }, { pageNo: "1", numOfRows: "1" });
    let rows = [];
    let parseErrorMessage = null;
    try {
      rows = parseRows(response.text, 1);
    } catch (parseError) {
      parseErrorMessage = parseError?.message || String(parseError);
      parseError.failure_reason = "smoke_parse_failed";
      throw parseError;
    }
    const resultCode = response.result_meta?.resultCode !== undefined
      ? String(response.result_meta.resultCode).trim()
      : null;
    const resultMsg = response.result_meta?.resultMsg || null;
    if (resultCode && !["0", "00", "000", "NORMAL_CODE", "INFO-000"].includes(resultCode.toUpperCase())) {
      const error = new Error(`Port Operation smoke test API resultCode ${resultCode}: ${resultMsg || "unknown"}`);
      error.failure_reason = `smoke_api_result_code_${resultCode}`;
      error.http_status = response.http_status;
      throw error;
    }
    const totalCount = response.result_meta?.totalCount !== undefined
      ? Number(response.result_meta.totalCount)
      : null;
    const validEmptyResponse = rows.length === 0 &&
      (totalCount === 0 || /<response\b|<body\b|^{|\[/i.test(String(response.text || "").trim()));
    if (rows.length === 0 && !validEmptyResponse) {
      const error = new Error("Port Operation smoke test returned an invalid empty response.");
      error.failure_reason = "smoke_empty_response_invalid";
      error.http_status = response.http_status;
      throw error;
    }
    const finishedAt = new Date().toISOString();
    return {
      smoke_test_status: "passed",
      smoke_test_failure_reason: null,
      started_at: startedAt,
      finished_at: finishedAt,
      duration_ms: Math.max(0, new Date(finishedAt).getTime() - new Date(startedAt).getTime()),
      source_name: source.key,
      label: source.label,
      prtAgCd: source.prtAgCd || null,
      port_code: source.portCode || null,
      port_name: source.portName || null,
      deGb: source.defaultParams?.deGb || null,
      http_status: response.http_status,
      response_content_type: response.response_content_type || null,
      latency_ms: response.latency_ms,
      item_count: rows.length,
      total_count: Number.isFinite(totalCount) ? totalCount : null,
      valid_empty_response: validEmptyResponse,
      result_meta: response.result_meta || {},
      requested_url_without_service_key: maskServiceKey(response.url),
      redacted_response_sample: {
        request_url_without_service_key: maskServiceKey(response.url),
        response_status: response.http_status,
        response_content_type: response.response_content_type || null,
        first_500_chars: String(response.text || "").slice(0, 500),
        parsed_item_count: rows.length,
        parse_error: parseErrorMessage
      },
      service_key_variant: response.service_key_variant || null,
      retry_count: response.retry_count || 0
    };
  } catch (error) {
    const finishedAt = new Date().toISOString();
    return {
      smoke_test_status: "failed",
      smoke_test_failure_reason: smokeFailureReason(error),
      error_message: error?.message || String(error),
      started_at: startedAt,
      finished_at: finishedAt,
      duration_ms: Math.max(0, new Date(finishedAt).getTime() - new Date(startedAt).getTime()),
      source_name: source.key,
      label: source.label,
      prtAgCd: source.prtAgCd || null,
      port_code: source.portCode || null,
      port_name: source.portName || null,
      deGb: source.defaultParams?.deGb || null,
      http_status: error?.http_status || null,
      response_preview: error?.response_text || null,
      redacted_response_sample: {
        request_url_without_service_key: source?.url ? maskServiceKey(buildUrl(source, { pageNo: "1", numOfRows: "1" })) : null,
        response_status: error?.http_status || null,
        response_content_type: error?.response_content_type || null,
        first_500_chars: error?.response_text || null,
        parsed_item_count: 0,
        parse_error: error?.failure_reason === "smoke_parse_failed" ? (error?.message || String(error)) : null
      }
    };
  }
}

function normalizeStatus(value) {
  const text = String(value || "").trim();
  if (/berth|alongside|moored/i.test(text)) return "At Berth";
  if (/anchor|waiting|idle|drifting/i.test(text)) return "Waiting";
  if (/expected|schedule|planned/i.test(text)) return "Expected";
  if (/departure|departed/i.test(text)) return "Departed";
  return text || "Observed";
}

function portNameForCode(code = "") {
  const text = String(code || "").trim();
  if (!text) return "";
  const row = portRegistryRows().find(item => String(item.prtAgCd || item.port_code) === text || String(item.port_code) === text);
  return row?.port_name_en || row?.port_name_ko || "";
}

function normalizePort(value, fallback = "") {
  const text = String(value || fallback || "").trim();
  const registryName = portNameForCode(text);
  if (registryName) return registryName;
  const identity = normalizePortIdentity(text);
  if (identity.is_known && identity.display_name) return identity.display_name;
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
  if (/sokcho/i.test(text)) return "Sokcho";
  if (/boryeong/i.test(text)) return "Boryeong";
  if (/yeongheung/i.test(text)) return "Yeongheung";
  if (/taean/i.test(text)) return "Taean";
  return text || "Unknown";
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
  if (/sokcho|속초/.test(text)) return "120";
  if (/boryeong|보령/.test(text)) return "031";
  if (/yeongheung|영흥/.test(text)) return "030";
  if (/taean|태안/.test(text)) return "621";
  if (/masan|jinhae|samcheonpo|hadong|tongyeong|geoje|okpo|마산|진해|삼천포|하동|통영|거제|옥포/.test(text)) return "622";
  return "";
}

function normalizeMatchText(value = "") {
  return sharedNormalizeVesselName(value);
}

function normalizeVesselName(value = "") {
  return sharedNormalizeVesselName(value);
}

function normalizeBerthTerminalAlias(value = "") {
  return normalizeBerthName(value) || normalizeTerminalName(value);
  const text = normalizeMatchText(value)
    .replace(/BUSANNEWPORT|NEWPORT|PNC|PUSANNEWPORT/g, "BUSANNEWPORT")
    .replace(/ULSANTERMINAL|UTT|UOTT|JANGSAENGPO|ONSAN|MIPO/g, match => `ULSAN${match}`)
    .replace(/BERTH|BTH|선석|부두|터미널|TERMINAL|TMNL/g, "")
    .replace(/NO|NUMBER|번/g, "");
  return text;
}

function matchConfidenceBand(score = 0) {
  return sharedMatchConfidenceBand(score).toLowerCase();
}

function matchResult(score, reasons = [], matchedFields = {}) {
  const cleanReasons = [...new Set(reasons.filter(Boolean))];
  const clamped = Math.max(0, Math.min(100, score));
  return {
    score: clamped,
    method: cleanReasons.join("+") || "no_match",
    reasons: cleanReasons,
    confidence: matchConfidenceBand(clamped),
    matched_fields: matchedFields
  };
}

function parseDateMs(value) {
  if (!value) return null;
  const text = String(value).trim().replace(" ", "T");
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date.getTime();
}

function isTier2EnrichmentRecord(record = {}) {
  const key = String(record.source_key || record.source || "");
  return key === "source_csv" || key === "source_csv_lightweight" || key.startsWith("ulsan_") || key.startsWith("pnc_source_");
}

function isPortOperationRecord(record = {}) {
  return String(record.source || "").startsWith("port_operation_");
}

function isPilotScheduleRecord(record = {}) {
  return String(record.source || "").startsWith("pilot_source_") || record.source_origin === "pilot_schedule";
}

function isPncRecord(record = {}) {
  return String(record.source || "").startsWith("pnc_source_");
}

function isSourceCsvLightweightRecord(record = {}) {
  return ["source_csv", "source_csv_lightweight"].includes(String(record.source_key || record.source || ""));
}

function isUlsanEnrichmentRecord(record = {}) {
  return String(record.source || "").startsWith("ulsan_");
}

function timeWindowScore(left = {}, right = {}) {
  const leftTimes = [left.ata, left.eta, left.etb, left.atb, left.etd, left.atd, left.eta_candidate, left.etb_candidate, left.etd_candidate, left.pilot_time, left.movement_time].map(parseDateMs).filter(Boolean);
  const rightTimes = [right.ata, right.eta, right.etb, right.atb, right.etd, right.atd, right.eta_candidate, right.etb_candidate, right.etd_candidate, right.pilot_time, right.movement_time].map(parseDateMs).filter(Boolean);
  if (!leftTimes.length || !rightTimes.length) return 0;
  for (const a of leftTimes) {
    for (const b of rightTimes) {
      const diff = Math.abs(a - b);
      if (diff <= 24 * 36e5) return 18;
      if (diff <= 48 * 36e5) return 10;
    }
  }
  return -10;
}

function pilotDirection(value = "") {
  const text = String(value || "").trim().toLowerCase();
  if (/inbound|arrival|arrive|입항|입선|도착|착/.test(text)) return "inbound";
  if (/outbound|departure|depart|출항|출선|출발|이안/.test(text)) return "outbound";
  return text || "unknown";
}

function pilotTimeWindowScore(ledger = {}, pilot = {}) {
  const pilotTime = parseDateMs(pilot.pilot_time || pilot.movement_time || pilot.eta_candidate || pilot.etb_candidate);
  if (!pilotTime) return 0;
  const direction = pilotDirection(pilot.pilot_direction || pilot.movement_type);
  const ledgerTimes = direction === "outbound"
    ? [ledger.etd, ledger.atd, ledger.etd_candidate]
    : [ledger.eta, ledger.ata, ledger.etb, ledger.eta_candidate, ledger.etb_candidate];
  const parsed = ledgerTimes.map(parseDateMs).filter(Boolean);
  if (!parsed.length) return 6;
  const bestDiff = Math.min(...parsed.map(value => Math.abs(value - pilotTime)));
  if (bestDiff <= 24 * 36e5) return 18;
  if (bestDiff <= 48 * 36e5) return 10;
  return -10;
}

function pilotMatchScore(ledger = {}, pilot = {}) {
  const shared = scoreMatch(ledger, pilot, {
    timeWindowHours: Number(process.env.MATCH_TIME_WINDOW_HOURS || 48),
    strongTimeMatchHours: Number(process.env.STRONG_TIME_MATCH_HOURS || 6)
  });
  let score = shared.score;
  const methods = [...shared.reasons];
  if (normalizeCallSign(ledger.call_sign) && normalizeCallSign(pilot.call_sign) && normalizeCallSign(ledger.call_sign) === normalizeCallSign(pilot.call_sign)) {
    score += 12;
    methods.push("pilot_call_sign_priority");
  }
  if (shared.matched_fields?.call_sign && shared.matched_fields?.port) {
    score += 8;
    methods.push("pilot_call_sign_port_priority");
  }
  if (shared.matched_fields?.vessel_name && shared.matched_fields?.port) {
    score += 18;
    methods.push("pilot_vessel_name_port_priority");
  }
  const timeScore = pilotTimeWindowScore(ledger, pilot);
  if (timeScore >= 18) methods.push("time_window_24h");
  else if (timeScore > 0) methods.push("time_window_48h");
  score += Math.max(0, timeScore - 10);
  return matchResult(score, methods, shared.matched_fields);
}

function mergePilotSchedule(record = {}, matches = []) {
  if (!matches.length) return record;
  const best = matches[0];
  const pilot = best.record;
  const direction = pilotDirection(pilot.pilot_direction || pilot.movement_type);
  const pilotTime = pilot.pilot_time || pilot.movement_time || "";
  const outboundSoon = direction === "outbound" && parseDateMs(pilotTime) && parseDateMs(pilotTime) > Date.now();
  const pilotBerth = pilot.berth_name || pilot.berth || pilot.terminal_name || pilot.laidupFcltyNm || "";
  const identitySafe = best.score >= 75 && (best.matched_fields?.call_sign || best.reasons?.includes("call_sign_exact"));
  const next = {
    ...record,
    imo: record.imo || (identitySafe ? pilot.imo || "" : ""),
    mmsi: record.mmsi || (identitySafe ? pilot.mmsi || "" : ""),
    call_sign: record.call_sign || (identitySafe ? pilot.call_sign || "" : ""),
    pilot_schedule_matched: true,
    pilot_match_method: best.method,
    pilot_match_confidence: best.score,
    pilot_match_reasons: best.reasons,
    pilot_matched_fields: best.matched_fields || {},
    pilot_match_score: best.score,
    match_score: Math.max(Number(record.match_score || 0), best.score),
    match_confidence: matchConfidenceBand(Math.max(Number(record.match_score || 0), best.score)),
    match_reasons: [...new Set([...(record.match_reasons || []), ...best.reasons])],
    pilot_source_url: pilot.source_url || "",
    pilot_last_seen_at: pilot.updated_at || new Date().toISOString(),
    pilot_time: record.pilot_time || pilotTime,
    pilot_time_text: record.pilot_time_text || pilot.pilot_time_text || pilot.raw_pilot_time || "",
    pilot_time_local: record.pilot_time_local || pilot.pilot_time_local || "",
    pilot_timestamp: record.pilot_timestamp || pilot.pilot_timestamp || pilotTime,
    raw_pilot_time: record.raw_pilot_time || pilot.raw_pilot_time || "",
    pilot_time_parse_status: record.pilot_time_parse_status || pilot.pilot_time_parse_status || pilot.parse_status || "",
    pilot_direction: record.pilot_direction || direction,
    pilot_station: record.pilot_station || pilot.pilot_station,
    berth_name: record.berth_name || record.berth || pilotBerth,
    berth: record.berth || record.berth_name || pilotBerth,
    berth_source: (record.berth_name || record.berth) ? record.berth_source : pilotBerth ? "pilot_schedule" : record.berth_source,
    movement_time: record.movement_time || pilotTime,
    movement_type: record.movement_type || direction,
    schedule_confidence: Math.max(Number(record.schedule_confidence || 0), best.score),
    berth_timing_confidence: Math.max(Number(record.berth_timing_confidence || 0), best.score),
    pilot_source_origin: "pilot_schedule",
    source_row_id: pilot.raw_row_identity || `${pilot.source}|${pilot.vessel_name}|${pilot.pilot_time || pilot.movement_time || ""}`,
    raw_source_payload: pilot.raw_payload || pilot.payload || pilot,
    source_children: [...new Set([...(record.source_children || []), pilot.source])],
    reason_codes: [...new Set([...(record.reason_codes || []), "PILOT_SCHEDULE_MATCHED"])]
  };
  if (direction === "inbound" && pilotTime) {
    next.eta_candidate = next.eta_candidate || pilotTime;
    next.etb_candidate = next.etb_candidate || pilotTime;
    next.eta_source = next.eta_source || "pilot_schedule";
    next.etb_source = next.etb_source || "pilot_schedule";
    next.arrival_window_source = next.arrival_window_source || "pilot_schedule";
    next.arrival_window = next.arrival_window || {
      basis: "pilotage_time",
      time: pilotTime,
      direction: "INBOUND",
      source: "pilot_schedule",
      confidence: best.score
    };
    next.arrival_timing_confidence = Math.max(Number(next.arrival_timing_confidence || 0), best.score);
  }
  if (direction === "outbound" && pilotTime) {
    next.etd_candidate = next.etd_candidate || pilotTime;
    next.etd_source = next.etd_source || "pilot_schedule";
    next.departure_timing_confidence = Math.max(Number(next.departure_timing_confidence || 0), best.score);
    next.outbound_pilot_scheduled = true;
    if (outboundSoon) next.work_window_status = "closing_by_pilot_schedule";
  }
  return next;
}

function makePilotOnlyRecord(record = {}) {
  const direction = pilotDirection(record.pilot_direction || record.movement_type);
  const pilotTimestamp = record.pilot_timestamp || record.pilot_time || record.movement_time || "";
  return {
    ...record,
    source_origin: "pilot_schedule",
    ledger_status: "pilot_only_pending_port_operation",
    status_bucket: direction === "outbound" ? "unknown" : "arriving_soon",
    pilot_only_arrival_review: true,
    eta_candidate: direction === "inbound" && pilotTimestamp ? pilotTimestamp : record.eta_candidate,
    etb_candidate: direction === "inbound" && pilotTimestamp ? record.etb_candidate || pilotTimestamp : record.etb_candidate,
    eta_source: direction === "inbound" && pilotTimestamp ? "pilot_schedule" : record.eta_source,
    etb_source: direction === "inbound" && pilotTimestamp ? "pilot_schedule" : record.etb_source,
    schedule_confidence: Math.max(Number(record.schedule_confidence || 0), 45),
    data_confidence: "pilot_only_schedule_review",
    actionable_source_row: true,
    sales_ready_input: true,
    reason_codes: [...new Set([...(record.reason_codes || []), "PILOT_ONLY_ARRIVAL_REVIEW"])]
  };
}

function buildPilotDiagnostics(pilotRows = [], matchedPilotKeys = new Set(), pilotOnlyRows = []) {
  const sources = new Set(pilotRows.map(row => row.source).filter(Boolean));
  const matchedCount = pilotRows.filter(row => matchedPilotKeys.has(row.raw_row_identity || `${row.source}|${row.vessel_name}|${row.pilot_time}`)).length;
  const withValue = key => pilotRows.filter(row => String(row[key] || "").trim()).length;
  const timeOnlyRows = pilotRows.filter(row => row.pilot_time_parse_status === "time_only_missing_date").length;
  const invalidTimeRows = pilotRows.filter(row => row.pilot_time_parse_status === "invalid_date_time").length;
  const unmatchedSamples = pilotRows
    .filter(row => !matchedPilotKeys.has(row.raw_row_identity || `${row.source}|${row.vessel_name}|${row.pilot_time}`))
    .slice(0, 20)
    .map(row => ({
      vessel_name: row.vessel_name || "",
      call_sign: row.call_sign || "",
      port: row.port || row.port_name || "",
      pilot_time_text: row.pilot_time_text || row.raw_pilot_time || "",
      reason: !row.call_sign && !row.vessel_name
        ? "missing_vessel_identity"
        : !row.port && !row.port_code
          ? "missing_port"
          : "below_match_threshold"
    }));
  return {
    pilot_sources_attempted: sources.size,
    pilot_sources_success: sources.size,
    pilot_rows_collected: pilotRows.length,
    pilot_rows_normalized: pilotRows.length,
    pilot_rows_with_vessel_name: withValue("vessel_name"),
    pilot_rows_with_call_sign: withValue("call_sign"),
    pilot_rows_with_port: withValue("port"),
    pilot_rows_with_pilot_date: withValue("pilot_date"),
    pilot_rows_with_pilot_time: pilotRows.filter(row => String(row.pilot_time || row.pilot_time_text || "").trim()).length,
    pilot_rows_with_pilot_station: withValue("pilot_station"),
    pilot_rows_with_pilot_direction: withValue("pilot_direction"),
    time_only_rows: timeOnlyRows,
    invalid_time_rows: invalidTimeRows,
    time_only_rows_discarded: 0,
    pilot_rows_matched_to_port_operation: matchedCount,
    unmatched_pilot_rows: Math.max(0, pilotRows.length - matchedCount),
    match_blockers: unmatchedSamples,
    pilot_only_rows: pilotOnlyRows.length,
    pilot_match_rate: pilotRows.length ? Math.round((matchedCount / pilotRows.length) * 100) : 0,
    eta_filled_from_pilot_count: pilotRows.filter(row => pilotDirection(row.pilot_direction) === "inbound").length,
    etb_filled_from_pilot_count: pilotRows.filter(row => pilotDirection(row.pilot_direction) === "inbound").length,
    atb_filled_from_pilot_count: pilotRows.filter(row => row.atb_source === "pilot_schedule").length,
    cleaning_window_updated_by_pilot_count: pilotRows.filter(row => pilotDirection(row.pilot_direction) === "outbound").length
  };
}

function applyPilotSchedule(records = []) {
  const ledgerRecords = records.filter(isPortOperationRecord);
  const pilotRows = records.filter(isPilotScheduleRecord);
  const otherRows = records.filter(record => !isPortOperationRecord(record) && !isPilotScheduleRecord(record));
  if (!pilotRows.length) {
    diagnostics.pilot_schedule = buildPilotDiagnostics([], new Set(), []);
    Object.assign(diagnostics, diagnostics.pilot_schedule);
    return records;
  }
  const matchedPilotKeys = new Set();
  const enrichedLedger = ledgerRecords.map(record => {
    const matches = pilotRows
      .map(pilot => ({ ...pilotMatchScore(record, pilot), record: pilot }))
      .filter(match => match.score >= 55)
      .sort((a, b) => b.score - a.score)
      .slice(0, 2);
    for (const match of matches) matchedPilotKeys.add(match.record.raw_row_identity || `${match.record.source}|${match.record.vessel_name}|${match.record.pilot_time}`);
    return mergePilotSchedule(record, matches);
  });
  const pilotOnlyRows = pilotRows
    .filter(row => !matchedPilotKeys.has(row.raw_row_identity || `${row.source}|${row.vessel_name}|${row.pilot_time}`))
    .map(makePilotOnlyRecord);
  diagnostics.pilot_schedule = buildPilotDiagnostics(pilotRows, matchedPilotKeys, pilotOnlyRows);
  Object.assign(diagnostics, diagnostics.pilot_schedule);
  return [...enrichedLedger, ...pilotOnlyRows, ...otherRows];
}

function enrichmentMatchScore(ledger = {}, enrichment = {}) {
  const shared = scoreMatch(ledger, enrichment, {
    timeWindowHours: Number(process.env.MATCH_TIME_WINDOW_HOURS || 48),
    strongTimeMatchHours: Number(process.env.STRONG_TIME_MATCH_HOURS || 6)
  });
  let score = shared.score;
  const methods = [...shared.reasons];
  const ledgerPort = String(ledger.port_code || portCodeFromName(ledger.port || ledger.port_name) || "");
  if (isPncRecord(enrichment) && ledgerPort === "020") {
    score += 12;
    methods.push("port_group_busan_pnc");
    if (shared.matched_fields?.call_sign) {
      score += 8;
      methods.push("pnc_call_sign_busan_priority");
    }
    if (shared.matched_fields?.vessel_name) {
      score += 8;
      methods.push("pnc_vessel_name_busan_priority");
    }
  } else if (isUlsanEnrichmentRecord(enrichment) && ledgerPort === "820") {
    score += 12;
    methods.push("port_group_ulsan");
  }
  if (isSourceCsvLightweightRecord(enrichment)) {
    if (ledger.imo && enrichment.imo && String(ledger.imo) === String(enrichment.imo)) {
      score += 35;
      methods.push("source_csv_imo");
    } else if (ledger.mmsi && enrichment.mmsi && String(ledger.mmsi) === String(enrichment.mmsi)) {
      score += 30;
      methods.push("source_csv_mmsi");
    } else if (normalizeCallSign(ledger.call_sign) && normalizeCallSign(enrichment.call_sign) && normalizeCallSign(ledger.call_sign) === normalizeCallSign(enrichment.call_sign)) {
      score += shared.matched_fields?.vessel_name ? 25 : 15;
      methods.push(shared.matched_fields?.vessel_name ? "source_csv_call_sign_name" : "source_csv_call_sign");
    } else if (shared.matched_fields?.vessel_name && shared.matched_fields?.port) {
      score += 12;
      methods.push("source_csv_name_port");
    }
  }
  const timeScore = timeWindowScore(ledger, enrichment);
  if (timeScore >= 18) methods.push("time_window_24h");
  else if (timeScore > 0) methods.push("time_window_48h");
  score += Math.max(0, timeScore - 10);
  return matchResult(score, methods, shared.matched_fields);
}

function mergeSecondaryEnrichment(record = {}, matches = []) {
  if (!matches.length) {
    return {
      ...record,
      secondary_enrichment_matched: false,
      enrichment_confidence: Number(record.enrichment_confidence || 0),
      enrichment_source: record.enrichment_source || "",
      berth_data_source: record.berth_data_source || "",
      berth_match_method: record.berth_match_method || "none",
      berth_match_confidence: Number(record.berth_match_confidence || 0),
      match_score: Number(record.match_score || 0),
      match_confidence: record.match_confidence || "unmatched",
      match_reasons: record.match_reasons || []
    };
  }
  const best = matches[0];
  const enrichment = best.record;
  const sourceNames = [...new Set(matches.map(match => match.record.source).filter(Boolean))];
  const sourceLabels = [...new Set(matches.map(match => match.record.source_label || match.record.source).filter(Boolean))];
  const terminalActivityText = [enrichment.terminal_activity, enrichment.berth_status, enrichment.status].filter(Boolean).join(" ");
  const terminalActive = /active|working|cargo|loading|discharging|작업|하역|운영|진행/i.test(terminalActivityText);
  const csvMatch = matches.find(match => isSourceCsvLightweightRecord(match.record));
  const csv = csvMatch?.record || {};
  return {
    ...record,
    imo: record.imo || csv.imo || "",
    mmsi: record.mmsi || csv.mmsi || "",
    call_sign: record.call_sign || csv.call_sign || "",
    gt: record.gt || csv.gt || 0,
    grtg: record.grtg || csv.grtg || csv.gt || 0,
    intrlGrtg: record.intrlGrtg || csv.intrlGrtg || csv.gt || 0,
    dwt: record.dwt || csv.dwt || 0,
    vessel_type: record.vessel_type && record.vessel_type !== "UNKNOWN" ? record.vessel_type : (csv.vessel_type || record.vessel_type),
    flag: record.flag || csv.flag || "",
    berth: record.berth || enrichment.berth,
    berth_name: record.berth_name || enrichment.berth_name || enrichment.berth,
    terminal_name: record.terminal_name || enrichment.terminal_name,
    berth_status: record.berth_status || enrichment.berth_status || enrichment.status,
    berth_occupancy_proxy: Math.max(Number(record.berth_occupancy_proxy || 0), terminalActive ? 70 : best.score >= 70 ? 45 : 25),
    etb: record.etb || enrichment.etb,
    atb: record.atb || enrichment.atb,
    etd: record.etd || enrichment.etd,
    operation_start: record.operation_start || enrichment.operation_start,
    operation_end: record.operation_end || enrichment.operation_end,
    operation_type: record.operation_type || enrichment.operation_type,
    cargo_workload_proxy: Math.max(Number(record.cargo_workload_proxy || 0), Number(enrichment.cargo_workload_proxy || 0)),
    terminal_activity: record.terminal_activity || enrichment.terminal_activity || (terminalActive ? "active" : ""),
    secondary_enrichment_matched: true,
    source_csv_lightweight_enriched: Boolean(csvMatch),
    enrichment_source: sourceNames.join(","),
    enrichment_sources: sourceNames,
    enrichment_confidence: Math.max(Number(record.enrichment_confidence || 0), best.score),
    berth_data_source: sourceLabels.join(", "),
    berth_match_method: best.method,
    berth_match_confidence: best.score,
    berth_match_reasons: best.reasons,
    berth_signal: {
      has_berth_info: true,
      source: isPncRecord(enrichment) ? "PNC" : (sourceLabels[0] || "berth_sources"),
      terminal: record.terminal_name || enrichment.terminal_name || null,
      berth: record.berth || enrichment.berth || enrichment.berth_name || null,
      eta: record.eta || enrichment.eta || null,
      etb: record.etb || enrichment.etb || null,
      ata: record.ata || enrichment.ata || null,
      atb: record.atb || enrichment.atb || null,
      operation_start: record.operation_start || enrichment.operation_start || null,
      operation_end: record.operation_end || enrichment.operation_end || null,
      match_type: best.method,
      confidence: best.score
    },
    matched_fields: { ...(record.matched_fields || {}), ...(best.matched_fields || {}) },
    source_row_id: enrichment.raw_row_identity || `${enrichment.source}|${enrichment.vessel_name}|${enrichment.berth_name || enrichment.terminal_name || ""}`,
    raw_source_payload: enrichment.raw_payload || enrichment.payload || enrichment,
    match_score: Math.max(Number(record.match_score || 0), best.score),
    match_confidence: matchConfidenceBand(Math.max(Number(record.match_score || 0), best.score)),
    match_reasons: [...new Set([...(record.match_reasons || []), ...best.reasons])],
    source_children: [...new Set([...(record.source_children || []), ...sourceNames])],
    reason_codes: [...new Set([...(record.reason_codes || []), "BERTH_ENRICHMENT_MATCHED"])]
  };
}

function buildSecondaryEnrichmentDiagnostics(enrichmentRows = [], matchedBySource = new Map()) {
  const pncRows = enrichmentRows.filter(isPncRecord);
  const ulsanRows = enrichmentRows.filter(isUlsanEnrichmentRecord);
  const pncSources = new Set(pncRows.map(row => row.source));
  const ulsanSources = new Set(ulsanRows.map(row => row.source));
  const countMatched = rows => rows.filter(row => matchedBySource.has(row.raw_row_identity || `${row.source}|${row.vessel_name}|${row.berth_name}`)).length;
  const confidenceCounts = [...matchedBySource.values()].reduce((acc, match) => {
    const confidence = String(match.confidence || match.match_confidence || "").toLowerCase();
    if (confidence === "high") acc.high += 1;
    else if (confidence === "medium") acc.medium += 1;
    else if (confidence === "low") acc.low += 1;
    return acc;
  }, { high: 0, medium: 0, low: 0 });
  const pncMatched = countMatched(pncRows);
  const ulsanMatched = countMatched(ulsanRows);
  const matchedTotal = countMatched(enrichmentRows);
  const pncMatches = [...matchedBySource.values()].filter(match => isPncRecord(match.record));
  const pncMatchedByCallSign = pncMatches.filter(match => (match.reasons || []).includes("call_sign_exact")).length;
  const pncMatchedByName = pncMatches.filter(match => (match.reasons || []).some(reason => /vessel_name/.test(reason))).length;
  const pncMatchedByPortOnly = pncMatches.filter(match => {
    const reasons = match.reasons || [];
    return reasons.includes("same_port") && !reasons.includes("call_sign_exact") && !reasons.some(reason => /vessel_name/.test(reason));
  }).length;
  const countWith = (rows, predicate) => rows.filter(predicate).length;
  const pncUnmatchedSamples = pncRows
    .filter(row => !matchedBySource.has(row.raw_row_identity || `${row.source}|${row.vessel_name}|${row.berth_name}`))
    .slice(0, 10)
    .map(row => ({
      vessel_name: row.vessel_name || "",
      call_sign: row.call_sign || "",
      terminal: row.terminal_name || "",
      berth: row.berth_name || row.berth || "",
      reason: !row.vessel_name && !row.call_sign
        ? "missing_identity_for_safe_match"
        : !row.port_code && !row.port
          ? "missing_port"
          : "below_match_threshold"
    }));
  return {
    pnc_sources_attempted: pncSources.size,
    pnc_sources_success: new Set(pncRows.map(row => row.source).filter(Boolean)).size,
    pnc_rows_collected: pncRows.length,
    pnc_rows_normalized: pncRows.length,
    pnc_rows_with_vessel_name: countWith(pncRows, row => Boolean(row.vessel_name)),
    pnc_rows_with_call_sign: countWith(pncRows, row => Boolean(row.call_sign)),
    pnc_rows_with_terminal: countWith(pncRows, row => Boolean(row.terminal_name)),
    pnc_rows_with_berth: countWith(pncRows, row => Boolean(row.berth || row.berth_name)),
    pnc_rows_with_eta: countWith(pncRows, row => Boolean(row.eta)),
    pnc_rows_with_etb: countWith(pncRows, row => Boolean(row.etb)),
    pnc_rows_with_ata: countWith(pncRows, row => Boolean(row.ata)),
    pnc_rows_with_atb: countWith(pncRows, row => Boolean(row.atb)),
    pnc_rows_matched: pncMatched,
    pnc_matched_by_call_sign: pncMatchedByCallSign,
    pnc_matched_by_name: pncMatchedByName,
    pnc_matched_by_port_only: pncMatchedByPortOnly,
    pnc_unmatched_rows: Math.max(0, pncRows.length - pncMatched),
    pnc_sample_unmatched_reasons: pncUnmatchedSamples,
    pnc_match_rate: pncRows.length ? Math.round((pncMatched / pncRows.length) * 100) : 0,
    ulsan_sources_attempted: ulsanSources.size,
    ulsan_sources_success: new Set(ulsanRows.map(row => row.source).filter(Boolean)).size,
    ulsan_rows_collected: ulsanRows.length,
    ulsan_rows_matched: ulsanMatched,
    ulsan_match_rate: ulsanRows.length ? Math.round((ulsanMatched / ulsanRows.length) * 100) : 0,
    berth_rows_collected: enrichmentRows.length,
    berth_rows_matched: matchedTotal,
    berth_match_rate: enrichmentRows.length ? Math.round((matchedTotal / enrichmentRows.length) * 100) : 0,
    enrichment_rows_matched: matchedTotal,
    enrichment_rows_unmatched: Math.max(0, enrichmentRows.length - matchedTotal),
    enrichment_high_confidence_matches: confidenceCounts.high,
    enrichment_medium_confidence_matches: confidenceCounts.medium,
    enrichment_low_confidence_matches: confidenceCounts.low
  };
}

function applySecondaryEnrichment(records = []) {
  const ledgerRecords = records.filter(isPortOperationRecord);
  const enrichmentRows = records.filter(isTier2EnrichmentRecord);
  const passthrough = records.filter(record => !isPortOperationRecord(record) && !isTier2EnrichmentRecord(record));
  if (!ledgerRecords.length || !enrichmentRows.length) {
    diagnostics.secondary_enrichment = buildSecondaryEnrichmentDiagnostics(enrichmentRows, new Map());
    Object.assign(diagnostics, diagnostics.secondary_enrichment);
    return [...ledgerRecords.map(record => mergeSecondaryEnrichment(record, [])), ...passthrough];
  }
  const matchedBySource = new Map();
  const enrichedLedger = ledgerRecords.map(record => {
    const matches = enrichmentRows
      .map(enrichment => ({ ...enrichmentMatchScore(record, enrichment), record: enrichment }))
      .filter(match => match.score >= 55)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);
    for (const match of matches) {
      matchedBySource.set(match.record.raw_row_identity || `${match.record.source}|${match.record.vessel_name}|${match.record.berth_name}`, match);
    }
    return mergeSecondaryEnrichment(record, matches);
  });
  diagnostics.secondary_enrichment = buildSecondaryEnrichmentDiagnostics(enrichmentRows, matchedBySource);
  Object.assign(diagnostics, diagnostics.secondary_enrichment);
  return [...enrichedLedger, ...passthrough];
}

function normalizeRow(row, source, now) {
  const adapted = adaptSourceRecord(row, source);
  const sourceProfile = sourceType(source);
  const pncSource = isPncSourceConfig(source);
  const vesselName = String(firstValue(adapted, FIELD_ALIASES.vessel_name) || (pncSource ? pncValue(adapted, "vessel_name") : "")).trim();
  const imo = String(firstValue(adapted, FIELD_ALIASES.imo)).trim();
  const mmsi = String(firstValue(adapted, FIELD_ALIASES.mmsi)).trim();
  const rawCallSign = firstValue(adapted, FIELD_ALIASES.call_sign) || (pncSource ? pncValue(adapted, "call_sign") : "");
  const callSign = normalizeCallSign(rawCallSign);
  const portOperationSource = String(source.key || "").startsWith("port_operation_");
  const terminalVesselCodeRaw = pncSource ? String(pncValue(adapted, "terminal_vessel_code")).trim() : "";
  const terminalVesselCodeNormalized = normalizeCallSign(terminalVesselCodeRaw);
  const terminalCodeMatchesCallSign = Boolean(callSign && terminalVesselCodeNormalized && callSign === terminalVesselCodeNormalized);
  const rawPortValue = firstValue(adapted, FIELD_ALIASES.port) || (pncSource ? pncValue(adapted, "port") : "") || source.portName || source.portCode || source.prtAgCd || "";
  const portIdentity = normalizePortIdentity(rawPortValue || source.portCode);
  const port = portIdentity.display_name || normalizePort(rawPortValue, source.portCode);
  const pncBerth = pncSource ? String(pncValue(adapted, "berth")).trim() : "";
  const pncTerminal = pncSource ? String(pncValue(adapted, "terminal")).trim() : "";
  const pncEta = pncSource ? normalizeDate(pncValue(adapted, "eta")) : "";
  const pncEtb = pncSource ? normalizeDate(pncValue(adapted, "etb")) : "";
  const pncAta = pncSource ? normalizeDate(pncValue(adapted, "ata")) : "";
  const pncAtb = pncSource ? normalizeDate(pncValue(adapted, "atb")) : "";
  const pncOperationStart = pncSource ? normalizeDate(pncValue(adapted, "operation_start")) : "";
  const pncOperationEnd = pncSource ? normalizeDate(pncValue(adapted, "operation_end")) : "";
  const pncOperation = pncSource ? String(pncValue(adapted, "operation")).trim() : "";
  const pncHasUsefulContext = Boolean(terminalVesselCodeRaw || pncBerth || pncTerminal || pncEta || pncEtb || pncAta || pncAtb || pncOperationStart || pncOperationEnd || pncOperation);
  if (!vesselName && !imo && !mmsi && !callSign && !pncHasUsefulContext) return null;
  const rawPilotDate = firstValue(adapted, ALL_PILOT_DATE_ALIASES);
  const rawPilotTime = firstValue(adapted, ALL_PILOT_TIME_ALIASES);
  const pilotTimeInfo = normalizePilotTime(rawPilotTime || rawPilotDate, rawPilotDate);

  const vsslKndCd = rawValue(adapted, ["vsslKndCd", "VSSL_KND_CD", "shipKindCode", "vesselKindCode", "선박종류코드"]);
  const vsslKndNm = rawValue(adapted, ["vsslKndNm", "VSSL_KND_NM", "shipKindName", "vesselKindName", "선박종류명"]);
  const rawBerthValue = String(firstValue(adapted, FIELD_ALIASES.berth) || pncBerth).trim();
  const rawTerminalValue = String(rawValue(adapted, TERMINAL_ALIASES) || pncTerminal).trim();
  const berthIdentity = normalizeBerthIdentity([rawTerminalValue, rawBerthValue].filter(Boolean).join(" "));
  const normalizedTerminal = normalizeTerminalIdentity(rawTerminalValue || rawBerthValue) || berthIdentity.terminal || rawTerminalValue;
  const vesselType = normalizeVesselType(vsslKndNm || firstValue(adapted, FIELD_ALIASES.vessel_type) || vsslKndCd || "Unknown");
  const facilityName = String(rawValue(adapted, ["facility_name", "laidupFcltyNm", "laidup_fclty_nm", "LAYDUP_FCLTY_NM", "fcltyNm", "facilityNm"])).trim();
  const operatorOrAgentCandidate = String(rawValue(adapted, ["operator_or_agent_candidate", "entrpsCdNm", "ENTRPS_CD_NM", "satmntEntrpsNm", "SATMNT_ENTRPS_NM"])).trim();
  const cargoOperationHint = String(rawValue(adapted, ["cargo_operation_hint", "lnlNm", "LNL_NM", "cargoNm", "cargoName", "cargoType", "operation_type"])).trim();
  const internationalGt = toNumber(rawValue(adapted, ["international_gt", "intrlGrtg", "INTRL_GRTG"]));
  const netTonnage = toNumber(rawValue(adapted, ["net_tonnage", "ntng", "NTNG"]));
  const draft = toNumber(rawValue(adapted, ["draft", "vsslDrft", "VSSL_DRFT"]));
  const length = toNumber(rawValue(adapted, ["length", "vsslLt", "VSSL_LT"]));
  const depth = toNumber(rawValue(adapted, ["depth", "vsslDp", "VSSL_DP"]));
  const previousCallSign = normalizeCallSign(rawValue(adapted, ["previous_call_sign", "befClsgn", "BEF_CLSGN"]));
  const builtDate = String(rawValue(adapted, ["built_date", "vsslCnstrDt", "VSSL_CNSTR_DT"])).trim();
  const newbuildFlag = String(rawValue(adapted, ["newbuild_flag", "nwshipAt", "NWSHIP_AT"])).trim();
  const rawEta = firstValue(adapted, FIELD_ALIASES.eta) || (pncSource ? pncValue(adapted, "eta") : "");
  const rawEtb = firstValue(adapted, FIELD_ALIASES.etb) || (pncSource ? pncValue(adapted, "etb") : "");
  const rawAta = firstValue(adapted, FIELD_ALIASES.ata) || (pncSource ? pncValue(adapted, "ata") : "");
  const rawAtb = firstValue(adapted, FIELD_ALIASES.atb) || (pncSource ? pncValue(adapted, "atb") : "");
  const rawEtd = firstValue(adapted, FIELD_ALIASES.etd);
  const rawAtd = firstValue(adapted, FIELD_ALIASES.atd);
  const rawNextPortEta = firstValue(adapted, FIELD_ALIASES.next_port_eta);
  const timeParseStatuses = {
    eta: normalizeDateTime(rawEta).parse_status,
    etb: normalizeDateTime(rawEtb).parse_status,
    ata: normalizeDateTime(rawAta).parse_status,
    atb: normalizeDateTime(rawAtb).parse_status,
    etd: normalizeDateTime(rawEtd).parse_status,
    atd: normalizeDateTime(rawAtd).parse_status,
    next_port_eta: normalizeDateTime(rawNextPortEta).parse_status,
    pilot_time: pilotTimeInfo.parse_status
  };
  const record = {
    vessel_id: imo ? `IMO-${imo}` : mmsi ? `MMSI-${mmsi}` : callSign ? `CALL-${callSign}` : vesselName ? `${vesselName}-${port}` : `PNC-${port}-${pncTerminal || pncBerth || source.key}`,
    vessel_name: vesselName || imo || mmsi || callSign,
    normalized_vessel_name: normalizeVesselName(vesselName || imo || mmsi || callSign),
    imo,
    mmsi,
    raw_call_sign: rawCallSign || callSign,
    canonical_call_sign: callSign,
    call_sign: callSign,
    call_sign_source: callSign ? (portOperationSource ? "port_operation" : source.key) : "",
    call_sign_confidence: callSign ? (portOperationSource ? 100 : 80) : 0,
    call_sign_valid: Boolean(callSign),
    canonical_vessel_key: imo ? `IMO|${imo}` : mmsi ? `MMSI|${mmsi}` : callSign ? `CALL|${callSign}` : normalizeVesselName(vesselName || ""),
    terminal_vessel_code: terminalVesselCodeRaw,
    terminal_vessel_code_normalized: terminalVesselCodeNormalized,
    possible_call_sign: terminalCodeMatchesCallSign ? terminalVesselCodeNormalized : "",
    possible_call_sign_confidence: terminalCodeMatchesCallSign ? 70 : 0,
    terminal_vessel_code_classification: terminalVesselCodeRaw
      ? terminalCodeMatchesCallSign ? "matches_canonical_call_sign" : "terminal_vessel_code_not_call_sign"
      : "",
    port,
    normalized_port: portIdentity.normalized_port,
    raw_port: portIdentity.raw_port || rawPortValue,
    port_code: source.prtAgCd || rawValue(adapted, ["prtAgCd", "portCode", "prtCd"]) || portIdentity.port_code || portCodeFromName(port),
    port_name: port,
    port_name_ko: source.portNameKo || port,
    port_group: source.portGroup || port,
    sub_port: source.subPort || "",
    port_tier: source.portTier || "",
    commercial_focus: source.commercialFocus || "",
    commercial_priority: source.commercialPriority || "",
    anchorage_relevance: source.anchorageRelevance || "",
    berth: berthIdentity.berth || rawBerthValue,
    berth_name: berthIdentity.berth || rawBerthValue,
    facility_name: facilityName || berthIdentity.berth || rawBerthValue,
    anchorage_zone: String(firstValue(adapted, FIELD_ALIASES.anchorage_zone)).trim(),
    anchorage_name: String(firstValue(adapted, FIELD_ALIASES.anchorage_zone)).trim(),
    laidupFcltyNm: String(rawValue(adapted, ["laidupFcltyNm", "laidup_fclty_nm", "LAYDUP_FCLTY_NM", "계선시설명", "계선장명", "시설명", "fcltyNm", "facilityNm"])).trim(),
    facility_code: String(rawValue(adapted, ["laidupFcltyCd", "laidup_fclty_cd", "LAYDUP_FCLTY_CD", "fcltyCd", "facilityCd", "시설코드"])).trim(),
    status: normalizeStatus(firstValue(adapted, FIELD_ALIASES.status)),
    operator: String(firstValue(adapted, FIELD_ALIASES.operator)).trim(),
    operator_or_agent_candidate: operatorOrAgentCandidate,
    agent: String(firstValue(adapted, FIELD_ALIASES.agent)).trim(),
    agent_name: String(firstValue(adapted, FIELD_ALIASES.agent)).trim(),
    agent_source: firstValue(adapted, FIELD_ALIASES.agent) ? "port_operation" : "",
    satmntEntrpsNm: String(rawValue(adapted, ["satmntEntrpsNm", "SATMNT_ENTRPS_NM", "신고업체명", "신고업체"])).trim(),
    entrpsCdNm: String(rawValue(adapted, ["entrpsCdNm", "ENTRPS_CD_NM", "업체코드명", "업체명"])).trim(),
    destination: String(firstValue(adapted, FIELD_ALIASES.destination)).trim(),
    previous_port: String(firstValue(adapted, FIELD_ALIASES.previous_port)).trim(),
    next_port: String(firstValue(adapted, FIELD_ALIASES.next_port)).trim(),
    vessel_type: vesselType || "UNKNOWN",
    vsslKndCd,
    vsslKndNm,
    gt: toNumber(firstValue(adapted, FIELD_ALIASES.gt)),
    grtg: toNumber(firstValue(adapted, FIELD_ALIASES.grtg)),
    intrlGrtg: toNumber(firstValue(adapted, FIELD_ALIASES.intrlGrtg)),
    international_gt: internationalGt,
    net_tonnage: netTonnage,
    dwt: toNumber(firstValue(adapted, FIELD_ALIASES.dwt)),
    loa: toNumber(firstValue(adapted, FIELD_ALIASES.loa)),
    beam: toNumber(firstValue(adapted, FIELD_ALIASES.beam)),
    draft,
    length,
    depth,
    built_date: builtDate,
    previous_call_sign: previousCallSign,
    newbuild_flag: newbuildFlag,
    flag: normalizeFlag(firstValue(adapted, FIELD_ALIASES.flag)),
    terminal_name: normalizedTerminal,
    raw_terminal_name: rawTerminalValue,
    raw_berth_name: rawBerthValue,
    berth_key: berthIdentity.normalized_berth || normalizeBerthTerminalAlias([
      firstValue(adapted, FIELD_ALIASES.berth),
      rawValue(adapted, ["laidupFcltyNm", "laidup_fclty_nm", "LAYDUP_FCLTY_NM", "계선시설명", "계선장명", "시설명", "fcltyNm", "facilityNm"]),
      rawValue(adapted, TERMINAL_ALIASES),
      rawValue(adapted, ALL_PILOT_STATION_ALIASES)
    ].filter(Boolean).join(" ")),
    berth_status: rawValue(adapted, BERTH_STATUS_ALIASES) || pncOperation,
    terminal_activity: rawValue(adapted, ["terminal_activity", "terminalActivity", "작업구분", "작업내용", "하역상태", ...BERTH_STATUS_ALIASES]) || pncOperation,
    cargo_operation_hint: cargoOperationHint,
    cargo_workload_proxy: toNumber(firstValue(adapted, CARGO_WORKLOAD_ALIASES)),
    pilot_time: pilotTimeInfo.pilot_timestamp,
    movement_time: pilotTimeInfo.pilot_timestamp,
    pilot_date: pilotTimeInfo.pilot_date,
    pilot_time_text: pilotTimeInfo.pilot_time_text,
    pilot_time_local: pilotTimeInfo.pilot_time_local,
    pilot_timestamp: pilotTimeInfo.pilot_timestamp,
    raw_pilot_time: pilotTimeInfo.raw_pilot_time,
    pilot_time_parse_status: pilotTimeInfo.parse_status,
    pilot_direction: pilotDirection(firstValue(adapted, ALL_PILOT_DIRECTION_ALIASES)),
    movement_type: pilotDirection(firstValue(adapted, ALL_PILOT_DIRECTION_ALIASES)),
    pilot_station: rawValue(adapted, ALL_PILOT_STATION_ALIASES),
    pilot_source_url: source.url || "",
    eta: normalizeDate(rawEta) || pncEta,
    etb: normalizeDate(rawEtb) || pncEtb,
    ata: normalizeDate(rawAta) || pncAta,
    atb: normalizeDate(rawAtb) || pncAtb,
    etd: normalizeDate(rawEtd),
    atd: normalizeDate(rawAtd),
    time_parse_statuses: timeParseStatuses,
    operation_start: pncOperationStart,
    operation_end: pncOperationEnd,
    operation_type: pncOperation,
    next_port_eta: normalizeDate(rawNextPortEta),
    destination_eta: normalizeDate(rawNextPortEta),
    speed: toNumber(firstValue(adapted, FIELD_ALIASES.speed)),
    lat: toNumber(firstValue(adapted, FIELD_ALIASES.lat)),
    lon: toNumber(firstValue(adapted, FIELD_ALIASES.lon)),
    course: toNumber(firstValue(adapted, FIELD_ALIASES.course)),
    heading: toNumber(firstValue(adapted, FIELD_ALIASES.heading)),
    risk_score: 45,
    source: source.key === "source_csv" ? "source_csv_lightweight" : source.key,
    source_key: source.key,
    source_priority: source.key === "source_csv" ? 40 : 100,
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
  if (source.key === "source_csv") {
    const csvDedupeKey = record.imo
      ? `IMO|${record.imo}`
      : record.mmsi
        ? `MMSI|${record.mmsi}`
        : record.call_sign && record.normalized_vessel_name
          ? `CALL_NAME|${record.call_sign}|${record.normalized_vessel_name}`
          : `NAME_PORT|${record.normalized_vessel_name || record.vessel_name}|${record.normalized_port || record.port}`;
    record.source = "source_csv_lightweight";
    record.source_key = "source_csv";
    record.source_priority = 40;
    record.source_mode = "lightweight_csv_optional";
    record.reference_source = "source_csv_lightweight";
    record.identity_source = "source_csv_lightweight";
    record.port_call_identity = csvDedupeKey;
    record.raw_row_identity = `source_csv_lightweight|${csvDedupeKey}`;
    record.vessel_identity = csvDedupeKey;
  }
  record.gt = record.gt || record.grtg || record.intrlGrtg || 0;
  record.match_keys = buildVesselMatchKeys(record);
  if (sourceProfile === "pilot_schedule") {
    record.source_origin = "pilot_schedule";
    record.ledger_status = "pilot_schedule_pending_match";
    if (record.pilot_direction === "inbound" && record.pilot_time) {
      record.eta_candidate = record.pilot_time;
      record.etb_candidate = record.pilot_time;
      record.eta_source = "pilot_schedule";
      record.etb_source = "pilot_schedule";
      record.status_bucket = "arriving_soon";
    }
    if (record.pilot_direction === "outbound" && record.pilot_time) {
      record.etd_candidate = record.pilot_time;
      record.etd_source = "pilot_schedule";
    }
  }
  if (pncSource) {
    record.source_origin = "pnc_berth";
    record.ledger_status = "pnc_berth_pending_match";
    record.berth_source = "PNC";
    record.berth_data_source = "PNC";
    record.berth_parse_status = vesselName || callSign
      ? "normalized_with_identity"
      : pncHasUsefulContext
        ? "normalized_without_identity"
        : "missing_required_context";
  }
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
  const priorityOf = record => Number(record.source_priority || (String(record.source || record.source_key || "").includes("source_csv") ? 40 : 100));
  if (priorityOf(incoming) > priorityOf(existing)) {
    return mergePortCallRecord(incoming, existing);
  }
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
  merged.secondary_enrichment_matched = Boolean(existing.secondary_enrichment_matched || incoming.secondary_enrichment_matched);
  merged.enrichment_confidence = Math.max(Number(existing.enrichment_confidence || 0), Number(incoming.enrichment_confidence || 0));
  merged.berth_match_confidence = Math.max(Number(existing.berth_match_confidence || 0), Number(incoming.berth_match_confidence || 0));
  merged.match_score = Math.max(Number(existing.match_score || 0), Number(incoming.match_score || 0), Number(existing.pilot_match_score || 0), Number(incoming.pilot_match_score || 0), Number(existing.berth_match_confidence || 0), Number(incoming.berth_match_confidence || 0));
  merged.match_confidence = matchConfidenceBand(merged.match_score);
  merged.match_reasons = [...new Set([...(existing.match_reasons || []), ...(incoming.match_reasons || []), ...(existing.pilot_match_reasons || []), ...(incoming.pilot_match_reasons || []), ...(existing.berth_match_reasons || []), ...(incoming.berth_match_reasons || [])])];
  merged.enrichment_source = [...new Set([existing.enrichment_source, incoming.enrichment_source].filter(Boolean).join(",").split(",").map(value => value.trim()).filter(Boolean))].join(",");
  merged.enrichment_sources = [...new Set([...(existing.enrichment_sources || []), ...(incoming.enrichment_sources || [])])];
  merged.berth_data_source = [...new Set([existing.berth_data_source, incoming.berth_data_source].filter(Boolean).join(",").split(",").map(value => value.trim()).filter(Boolean))].join(", ");
  merged.berth_match_method = existing.berth_match_method && existing.berth_match_method !== "none" ? existing.berth_match_method : incoming.berth_match_method;
  merged.berth_occupancy_proxy = Math.max(Number(existing.berth_occupancy_proxy || 0), Number(incoming.berth_occupancy_proxy || 0));
  merged.terminal_activity = existing.terminal_activity || incoming.terminal_activity || "";
  merged.facility_name = existing.facility_name || incoming.facility_name || "";
  merged.operator_or_agent_candidate = existing.operator_or_agent_candidate || incoming.operator_or_agent_candidate || "";
  merged.cargo_operation_hint = existing.cargo_operation_hint || incoming.cargo_operation_hint || "";
  merged.port_facility_berth_signal = Boolean(existing.port_facility_berth_signal || incoming.port_facility_berth_signal);
  merged.port_facility_operator_candidate = existing.port_facility_operator_candidate || incoming.port_facility_operator_candidate || "";
  merged.berth_status = existing.berth_status || incoming.berth_status || "";
  merged.terminal_name = existing.terminal_name || incoming.terminal_name || "";
  merged.match_keys = buildVesselMatchKeys(merged);
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
  const clsgn = normalizeCallSign(rawValue(row, ["clsgn", "callSign", "call_sign", "CALL_SIGN"]) || record.canonical_call_sign || record.call_sign);
  if (!prtAgCd || !etryptYear || !etryptCo || !clsgn) return null;
  return { prtAgCd, etryptYear, etryptCo, clsgn };
}

function mergeCargoHarborUse(record, rows = []) {
  const detail = rows.find(row => row && typeof row === "object") || {};
  if (!Object.keys(detail).length) return record;
  const facilityUseTime = normalizeDate(rawValue(detail, ["facility_use_time", "etryndDt", "ETRYND_DT"]));
  const declarationTime = normalizeDate(rawValue(detail, ["declaration_time", "satmntDt", "SATMNT_DT"]));
  const paymentDueTime = normalizeDate(rawValue(detail, ["payment_due_time", "dedtDt", "DEDT_DT"]));
  const nextPortArrivalTime = normalizeDate(rawValue(detail, ["next_port_arrival_time", "aprtfEtryptDt", "APRTF_ETRYPT_DT"]));
  const facilityName = String(rawValue(detail, ["facility_name", "laidupFcltyNm", "laidup_fclty_nm", "LAYDUP_FCLTY_NM", "fcltyNm", "facilityNm"])).trim();
  const operatorCandidate = String(rawValue(detail, ["operator_or_agent_candidate", "entrpsCdNm", "ENTRPS_CD_NM", "satmntEntrpsNm", "SATMNT_ENTRPS_NM"])).trim();
  const cargoHint = String(rawValue(detail, ["cargo_operation_hint", "lnlNm", "LNL_NM", "cargoNm", "cargoName", "cargoType", "operation_type"])).trim();
  const enriched = {
    ...record,
    berth: record.berth || String(firstValue(detail, FIELD_ALIASES.berth)).trim(),
    facility_name: record.facility_name || facilityName,
    berth_place_code: record.berth_place_code || String(rawValue(detail, ["berth_place_code", "laidupPlaceCd", "LAIDUP_PLACE_CD"])).trim(),
    berth_place_sub_code: record.berth_place_sub_code || String(rawValue(detail, ["berth_place_sub_code", "laidupPlaceSubCd", "LAIDUP_PLACE_SUB_CD"])).trim(),
    facility_use_time: record.facility_use_time || facilityUseTime,
    declaration_time: record.declaration_time || declarationTime,
    payment_due_time: record.payment_due_time || paymentDueTime,
    next_port_arrival_time: record.next_port_arrival_time || nextPortArrivalTime,
    charge_type: record.charge_type || String(rawValue(detail, ["charge_type", "chrgeKndNm", "CHRGE_KND_NM"])).trim(),
    use_code: record.use_code || String(rawValue(detail, ["use_code", "useSe", "USE_SE"])).trim(),
    use_type: record.use_type || String(rawValue(detail, ["use_type", "useSeNm", "USE_SE_NM"])).trim(),
    total_fee: record.total_fee || toNumber(rawValue(detail, ["total_fee", "totRntfee", "TOT_RNTFEE"])),
    freight_ton: record.freight_ton || toNumber(rawValue(detail, ["freight_ton", "cychgTon", "CYCHG_TON"])),
    base_charge: record.base_charge || toNumber(rawValue(detail, ["base_charge", "bassChrge", "BASS_CHRGE"])),
    status: record.status === "Observed" ? normalizeStatus(firstValue(detail, FIELD_ALIASES.status)) : record.status,
    eta: record.eta || normalizeDate(firstValue(detail, FIELD_ALIASES.eta)),
    etb: record.etb || normalizeDate(firstValue(detail, FIELD_ALIASES.etb)),
    ata: record.ata || normalizeDate(firstValue(detail, FIELD_ALIASES.ata)),
    atb: record.atb || normalizeDate(firstValue(detail, FIELD_ALIASES.atb)),
    etd: record.etd || normalizeDate(firstValue(detail, FIELD_ALIASES.etd)),
    atd: record.atd || normalizeDate(firstValue(detail, FIELD_ALIASES.atd)),
    operator: record.operator || String(firstValue(detail, FIELD_ALIASES.operator)).trim(),
    operator_or_agent_candidate: record.operator_or_agent_candidate || operatorCandidate,
    agent: record.agent || String(firstValue(detail, FIELD_ALIASES.agent)).trim(),
    agent_name: record.agent_name || record.agent || String(firstValue(detail, FIELD_ALIASES.agent)).trim(),
    agent_source: record.agent_source || (firstValue(detail, FIELD_ALIASES.agent) ? "port_facility" : ""),
    satmntEntrpsNm: record.satmntEntrpsNm || String(rawValue(detail, ["satmntEntrpsNm", "SATMNT_ENTRPS_NM", "신고업체명", "신고업체"])).trim(),
    entrpsCdNm: record.entrpsCdNm || String(rawValue(detail, ["entrpsCdNm", "ENTRPS_CD_NM", "업체코드명", "업체명"])).trim(),
    dwt: record.dwt || toNumber(firstValue(detail, FIELD_ALIASES.dwt)),
    loa: record.loa || toNumber(firstValue(detail, FIELD_ALIASES.loa)),
    beam: record.beam || toNumber(firstValue(detail, FIELD_ALIASES.beam)),
    flag: record.flag || normalizeFlag(firstValue(detail, FIELD_ALIASES.flag)),
    destination: record.destination || String(firstValue(detail, FIELD_ALIASES.destination)).trim(),
    cargo_operation_hint: record.cargo_operation_hint || cargoHint,
    port_facility_berth_signal: Boolean(String(firstValue(detail, FIELD_ALIASES.berth) || rawValue(detail, ["laidupFcltyNm", "fcltyNm", "facilityNm"])).trim()),
    port_facility_operator_candidate: record.operator_or_agent_candidate || operatorCandidate,
    berth_signal: {
      ...(record.berth_signal && typeof record.berth_signal === "object" ? record.berth_signal : {}),
      has_berth_info: Boolean(facilityName || record.berth || record.berth_name),
      source: "port_facility",
      signal_strength: "AUX_CONFIRMED",
      match_type: "CANONICAL_CALL_SIGN_ENTRY_COUNT",
      confidence: Number(record.berth_match_confidence || 92),
      berth: facilityName || record.berth || record.berth_name || null,
      facility_name: facilityName || null,
      facility_use_time: facilityUseTime || null,
      berth_place_code: String(rawValue(detail, ["laidupPlaceCd", "LAIDUP_PLACE_CD"])).trim() || null,
      berth_place_sub_code: String(rawValue(detail, ["laidupPlaceSubCd", "LAIDUP_PLACE_SUB_CD"])).trim() || null
    },
    data_lineage: {
      ...(record.data_lineage && typeof record.data_lineage === "object" ? record.data_lineage : {}),
      port_facility: {
        source: "port_facility",
        match_type: "CANONICAL_CALL_SIGN_ENTRY_COUNT",
        confidence: Number(record.berth_match_confidence || 92)
      }
    },
    source_children: [...(record.source_children || []), "carg_harbor_use"],
    cargo_harbor_use_count: rows.length,
    cargo_harbor_use_enriched: true,
    raw_cargo_harbor_use_keys: Object.keys(detail).slice(0, 80)
  };
  enriched.match_keys = buildVesselMatchKeys(enriched);
  return enriched;
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

function vesselSpecFieldsFromNormalized(normalized = {}) {
  return {
    imo: normalizeImo(normalized.imo || normalized.imo_no || normalized.imoNo),
    gt: toNumber(normalized.gt || normalized.grtg),
    international_gt: toNumber(normalized.international_gt || normalized.intrlGrtg),
    net_tonnage: toNumber(normalized.net_tonnage),
    vessel_type: normalizeVesselType(normalized.vessel_type || normalized.vsslKndNm || normalized.vsslKnd || ""),
    flag: normalizeFlag(normalized.flag || normalized.vsslNlty || ""),
    loa: toNumber(normalized.loa),
    beam: toNumber(normalized.beam),
    draft: toNumber(normalized.draft),
    length: toNumber(normalized.length),
    depth: toNumber(normalized.depth),
    built_date: normalized.built_date || "",
    previous_call_sign: normalizeCallSign(normalized.previous_call_sign || "")
  };
}

function mergeVesselSpecHint(record = {}, normalized = {}, rows = []) {
  const fields = vesselSpecFieldsFromNormalized(normalized);
  const enriched = {
    ...record,
    vessel_spec_hint: true,
    vessel_spec_enriched: true,
    vessel_spec_rows: rows.length,
    vessel_spec_match_type: "CANONICAL_CALL_SIGN",
    vessel_spec_confidence: 92,
    enrichment_confidence: Math.max(Number(record.enrichment_confidence || 0), 92),
    data_lineage: {
      ...(record.data_lineage && typeof record.data_lineage === "object" ? record.data_lineage : {}),
      vessel_spec: {
        source: "vessel_spec",
        match_type: "CANONICAL_CALL_SIGN",
        confidence: 92
      }
    },
    source_children: [...new Set([...(record.source_children || []), "vessel_spec"])]
  };
  for (const [field, value] of Object.entries(fields)) {
    if (value === null || value === undefined || String(value).trim?.() === "") continue;
    if (field === "imo" && !value) continue;
    if (field === "gt" && !Number(value)) continue;
    if (enriched[field] === undefined || enriched[field] === null || String(enriched[field]).trim() === "" || Number(enriched[field]) === 0) {
      enriched[field] = value;
    }
  }
  enriched.match_keys = buildVesselMatchKeys(enriched);
  return enriched;
}

async function collectPortFacilityChildEnrichment(source, now, deadline) {
  const queue = loadAuxCandidateRecords()
    .map(record => ({ record, ...portFacilityParamsFromRecord(record), priority: auxCandidatePriority(record) }))
    .sort((a, b) => b.priority - a.priority);
  const unique = new Map();
  for (const item of queue) {
    const key = item.params
      ? [item.params.prtAgCd, item.params.etryptYear, item.params.etryptCo, item.params.clsgn].join("|")
      : `missing:${item.missing.join(",")}:${item.record.vessel_name || item.record.call_sign || unique.size}`;
    if (!unique.has(key)) unique.set(key, item);
  }
  const selected = [...unique.values()].slice(0, Math.max(1, MAX_CHILD_ENRICHMENT_ROWS));
  const records = [];
  const statuses = new Map();
  let attempted = 0;
  let success = 0;
  let rowsCollected = 0;
  let rowsNormalized = 0;
  let skippedByLimit = Math.max(0, unique.size - selected.length);
  let httpStatus = null;
  const rawSampleKeys = new Set();
  const sanitizedRawSamples = [];
  for (const item of selected) {
    if (Date.now() + Math.min(SOURCE_TIMEOUT_MS, 10000) > deadline) {
      statuses.set("skipped:runtime_budget_exceeded", (statuses.get("skipped:runtime_budget_exceeded") || 0) + 1);
      break;
    }
    if (!item.params) {
      const reason = item.missing[0] || "missing_parent_keys";
      statuses.set(reason, (statuses.get(reason) || 0) + 1);
      continue;
    }
    attempted += 1;
    try {
      const { text, http_status, url } = await fetchText(source, item.params);
      httpStatus = http_status || httpStatus;
      const rows = parseRows(text, 50);
      rowsCollected += rows.length;
      for (const row of rows.slice(0, 3)) {
        Object.keys(row || {}).forEach(key => rawSampleKeys.add(key));
        if (sanitizedRawSamples.length < 3) sanitizedRawSamples.push(sanitizeSourceSample(row));
      }
      const enriched = mergeCargoHarborUse(item.record, rows);
      enriched.source = source.key;
      enriched.source_label = source.label;
      enriched.berth_match_confidence = rows.length ? 92 : 0;
      enriched.berth_match_method = rows.length ? "CANONICAL_CALL_SIGN_ENTRY_COUNT" : "";
      enriched.requested_url_without_service_key = maskServiceKey(url);
      if (rows.length) {
        success += 1;
        rowsNormalized += 1;
      }
      records.push(enriched);
      statuses.set(rows.length ? "success" : "no_rows", (statuses.get(rows.length ? "success" : "no_rows") || 0) + 1);
    } catch (error) {
      httpStatus = error?.http_status || httpStatus;
      statuses.set(`failed:${error?.message || "request_failed"}`, (statuses.get(`failed:${error?.message || "request_failed"}`) || 0) + 1);
    }
  }
  return {
    records,
    diagnostic: {
      key: source.key,
      label: source.label,
      source_name: source.key,
      source_profile: "port_facility_child_enrichment",
      status: attempted ? "success" : "skipped",
      attempted: attempted > 0,
      skipped: attempted === 0,
      success: success > 0,
      row_count: rowsCollected,
      normalized_count: rowsNormalized,
      rows_collected: rowsCollected,
      rows_normalized: rowsNormalized,
      rows_matched: rowsNormalized,
      actionable_count: rowsNormalized,
      http_status: httpStatus,
      owner_tier: "fast_aux",
      core_may_update: false,
      raw_sample_keys: [...rawSampleKeys].slice(0, 80),
      sanitized_raw_samples: sanitizedRawSamples,
      child_enrichment: {
        key: "port_facility_enrichment",
        rule: "CargHarborUse2 is called only with parent prtAgCd + etryptYear + etryptCo + clsgn from VsslEtrynd5.",
        attempted,
        success,
        rows: rowsCollected,
        normalized: rowsNormalized,
        skipped_by_limit: skippedByLimit,
        max_total_attempts: MAX_CHILD_ENRICHMENT_ROWS,
        rows_with_facility_hint: records.filter(record => record.facility_name || record.port_facility_berth_signal).length,
        rows_with_operator_candidate: records.filter(record => record.operator_or_agent_candidate || record.port_facility_operator_candidate).length,
        rows_with_cargo_hint: records.filter(record => record.cargo_operation_hint).length,
        statuses: Object.fromEntries(statuses)
      }
    }
  };
}

async function collectVesselSpecByCallSign(source, now, deadline) {
  const queue = loadAuxCandidateRecords()
    .filter(record => vesselSpecParamsFromRecord(record))
    .sort((a, b) => Number(Boolean(b.vessel_spec_enrichment_priority)) - Number(Boolean(a.vessel_spec_enrichment_priority)) || auxCandidatePriority(b) - auxCandidatePriority(a));
  const unique = new Map();
  for (const record of queue) {
    const params = vesselSpecParamsFromRecord(record);
    if (params?.clsgn && !unique.has(params.clsgn)) unique.set(params.clsgn, { record, params });
  }
  const selected = [...unique.values()].slice(0, Math.max(1, VESSEL_SPEC_MAX_REQUESTS));
  const records = [];
  const statuses = new Map();
  let attempted = 0;
  let success = 0;
  let rowsCollected = 0;
  let rowsNormalized = 0;
  let matched = 0;
  let conflictCount = 0;
  let httpStatus = null;
  const rawRows = [];
  for (const item of selected) {
    if (Date.now() + Math.min(SOURCE_TIMEOUT_MS, 10000) > deadline) {
      statuses.set("skipped:runtime_budget_exceeded", (statuses.get("skipped:runtime_budget_exceeded") || 0) + 1);
      break;
    }
    attempted += 1;
    try {
      const { text, http_status } = await fetchText(source, item.params);
      httpStatus = http_status || httpStatus;
      const rows = parseRows(text, 50);
      rawRows.push(...rows.slice(0, 5));
      rowsCollected += rows.length;
      const normalizedRows = rows.map(row => normalizeRow(row, source, now)).filter(Boolean);
      rowsNormalized += normalizedRows.length;
      const exact = normalizedRows.filter(row => normalizeCallSign(row.call_sign || row.canonical_call_sign) === item.params.clsgn);
      const imoValues = [...new Set(exact.map(row => normalizeImo(row.imo)).filter(Boolean))];
      if (imoValues.length > 1) {
        conflictCount += 1;
        statuses.set("needs_review:conflicting_imo", (statuses.get("needs_review:conflicting_imo") || 0) + 1);
        continue;
      }
      const matchedRow = exact[0];
      if (!matchedRow) {
        statuses.set("no_exact_call_sign_match", (statuses.get("no_exact_call_sign_match") || 0) + 1);
        continue;
      }
      const currentName = sharedNormalizeVesselName(item.record.vessel_name || "");
      const responseName = sharedNormalizeVesselName(matchedRow.vessel_name || "");
      if (currentName && responseName && currentName !== responseName && !currentName.includes(responseName) && !responseName.includes(currentName)) {
        statuses.set("needs_review:vessel_name_conflict", (statuses.get("needs_review:vessel_name_conflict") || 0) + 1);
        continue;
      }
      matched += 1;
      success += 1;
      records.push(mergeVesselSpecHint(item.record, matchedRow, rows));
      statuses.set("success", (statuses.get("success") || 0) + 1);
    } catch (error) {
      httpStatus = error?.http_status || httpStatus;
      statuses.set(`failed:${error?.message || "request_failed"}`, (statuses.get(`failed:${error?.message || "request_failed"}`) || 0) + 1);
    }
  }
  const normalizedSampleRows = records.slice(0, 5);
  return {
    records,
    diagnostic: {
      key: source.key,
      label: source.label,
      source_name: source.key,
      source_profile: "vessel_spec",
      status: attempted ? "success" : "skipped",
      attempted: attempted > 0,
      skipped: attempted === 0,
      success: success > 0,
      row_count: rowsCollected,
      normalized_count: rowsNormalized,
      rows_collected: rowsCollected,
      rows_normalized: rowsNormalized,
      rows_matched: matched,
      actionable_count: matched,
      http_status: httpStatus,
      owner_tier: "fast_aux",
      core_may_update: false,
      query_strategy: "canonical_call_sign_clsgn",
      max_requests: VESSEL_SPEC_MAX_REQUESTS,
      requests_attempted: attempted,
      rows_matched_to_vessels: matched,
      matched_by_call_sign: matched,
      conflict_count: conflictCount,
      ...vesselSpecAliasDiagnostics(rawRows, normalizedSampleRows),
      rows_with_imo: records.filter(record => String(record.imo || "").trim()).length,
      rows_with_call_sign: records.filter(record => String(record.call_sign || "").trim()).length,
      rows_with_flag: records.filter(record => String(record.flag || "").trim()).length,
      rows_with_gt: records.filter(record => Number(record.gt || record.grtg || record.intrlGrtg || 0) > 0).length,
      rows_with_international_gt: records.filter(record => Number(record.international_gt || record.intrlGrtg || 0) > 0).length,
      rows_with_loa: records.filter(record => Number(record.loa || record.length || 0) > 0).length,
      rows_with_beam: records.filter(record => Number(record.beam || 0) > 0).length,
      rows_with_draft: records.filter(record => Number(record.draft || 0) > 0).length,
      rows_with_vessel_type: records.filter(record => String(record.vessel_type || "").trim()).length,
      statuses: Object.fromEntries(statuses)
    }
  };
}

async function collectRealRows() {
  const now = new Date().toISOString();
  const deadline = Date.now() + COLLECTOR_RUNTIME_BUDGET_MS;
  const records = [];
  let totalChildEnrichmentAttempts = 0;
  diagnostics = { generated_at: now, attempted_count: 0, success_count: 0, failed_count: 0, skipped_count: 0, real_row_count: 0, actionable_row_count: 0, fallback_used: false, env_presence: runtimeEnvDiagnostics(), sources: [] };
  const preflight = buildCollectorPreflight();
  diagnostics.preflight = preflight;
  diagnostics.preflight_status = preflight.ok ? "passed" : "failed";
  diagnostics.preflight_failure_reason = preflight.preflight_failure_reason;
  diagnostics.skip_reason = preflight.ok ? null : preflight.preflight_failure_reason;
  diagnostics.port_operation_collection_plan = preflight;
  diagnostics.coverage = {
    ...(diagnostics.coverage || {}),
    ...preflight,
    successful_ports_count: 0,
    failed_ports_count: 0,
    no_data_ports_count: 0,
    port_operation_rows_by_port: {},
    port_operation_skip_reason_breakdown: preflight.ok ? {} : { [preflight.preflight_failure_reason]: diagnostics.skipped_count || preflight.planned_port_operation_sources.length || 1 }
  };
  const requiresPortOperation = collectorModeRequiresPortOperation();
  if (!preflight.ok && requiresPortOperation) {
    diagnostics.fallback_used = true;
    diagnostics.skipped_count = preflight.enabled_ports_passed_to_collector_count * Math.max(1, preflight.deGb_values.length);
    diagnostics.sources = preflight.planned_port_operation_sources.map(source => ({
      ...source,
      started_at: now,
      finished_at: now,
      duration_ms: 0,
      status: "skipped",
      success: false,
      row_count: 0,
      normalized_count: 0,
      rows_collected: 0,
      rows_normalized: 0,
      rows_matched: 0,
      actionable_count: 0,
      retry_count: 0,
      error_message: null
    }));
    const error = new Error(`Collector preflight failed: ${preflight.preflight_failure_reason}`);
    error.preflight = preflight;
    throw error;
  } else if (!requiresPortOperation) {
    diagnostics.preflight_status = "skipped_for_tier";
    diagnostics.preflight_failure_reason = null;
    diagnostics.skip_reason = null;
    diagnostics.port_operation_collection_plan = {
      ...diagnostics.port_operation_collection_plan,
      tier_skip: true,
      tier_skip_reason: `${COLLECTOR_UPDATE_MODE || "scheduled"} does not own port_operation collection`
    };
    diagnostics.coverage = {
      ...(diagnostics.coverage || {}),
      tier_skip: true,
      tier_skip_reason: `${COLLECTOR_UPDATE_MODE || "scheduled"} does not own port_operation collection`,
      port_operation_skip_reason_breakdown: {}
    };
  }
  if (env("COLLECTOR_DEBUG_ONLY") || debugVerboseEnabled()) {
    console.log("[Korea Port Intelligence] collector env presence", JSON.stringify(runtimeEnvDiagnostics()));
  }

  const debugOnly = env("COLLECTOR_DEBUG_ONLY");
  const configuredSources = allSourceConfigs().filter(collectorSourceAllowedForMode);
  diagnostics.collector_tier_filter = {
    update_mode: COLLECTOR_UPDATE_MODE || "scheduled",
    allowed_source_count: configuredSources.length,
    allowed_source_tiers: [...new Set(configuredSources.map(collectorSourceTier))]
  };
  const needsPortOperationSmokeTest = configuredSources.some(source => collectorSourceTier(source) === "core");
  const smokeTest = needsPortOperationSmokeTest
    ? await runPortOperationSmokeTest(configuredSources)
    : {
      smoke_test_status: "skipped_for_tier",
      smoke_test_failure_reason: null,
      started_at: now,
      finished_at: now,
      duration_ms: 0
    };
  diagnostics.port_operation_smoke_test = smokeTest;
  diagnostics.smoke_test_status = smokeTest.smoke_test_status;
  diagnostics.smoke_test_failure_reason = smokeTest.smoke_test_failure_reason || null;
  if (needsPortOperationSmokeTest && smokeTest.smoke_test_status !== "passed") {
    diagnostics.smoke_test_non_blocking = true;
    diagnostics.smoke_test_recovery_action = "continue_full_port_operation_collection";
    diagnostics.attempted_count += 1;
    diagnostics.failed_count += 1;
    diagnostics.sources = [
      {
        key: "port_operation_smoke_test",
        source_name: "port_operation_smoke_test",
        label: "Port Operation smoke test",
        source_profile: "schedule_or_berth",
        attempted: true,
        skipped: false,
        success: false,
        status: "failed",
        started_at: smokeTest.started_at || now,
        finished_at: smokeTest.finished_at || new Date().toISOString(),
        duration_ms: smokeTest.duration_ms || 0,
        row_count: 0,
        normalized_count: 0,
        rows_collected: 0,
        rows_normalized: 0,
        rows_matched: 0,
        retry_count: smokeTest.retry_count || 0,
        error_message: smokeTest.error_message || smokeTest.smoke_test_failure_reason,
        smoke_test_status: smokeTest.smoke_test_status,
        smoke_test_failure_reason: smokeTest.smoke_test_failure_reason,
        http_status: smokeTest.http_status || null,
        prtAgCd: smokeTest.prtAgCd || null
      }
    ];
    diagnostics.coverage.port_operation_smoke_test_warning = smokeTest.smoke_test_failure_reason;
    if (shouldSkipFullPortOperationAfterSmokeFailure(smokeTest.smoke_test_failure_reason)) {
      const skippedSources = preflight.planned_port_operation_sources.map(source => ({
        ...source,
        started_at: now,
        finished_at: now,
        duration_ms: 0,
        status: "skipped",
        success: false,
        row_count: 0,
        normalized_count: 0,
        rows_collected: 0,
        rows_normalized: 0,
        rows_matched: 0,
        actionable_count: 0,
        retry_count: 0,
        skip_reason: "unknown_error",
        reason: "unknown_error",
        raw_skip_reason: smokeTest.smoke_test_failure_reason
      }));
      diagnostics.skipped_count += skippedSources.length;
      diagnostics.sources.push(...skippedSources);
      diagnostics.coverage.port_operation_skip_reason_breakdown = {
        unknown_error: skippedSources.length
      };
      diagnostics.real_row_count = 0;
      diagnostics.actionable_row_count = 0;
      diagnostics.partial_failure = false;
      diagnostics.partial_failure_policy = "full Port Operation collection skipped after global smoke-test failure";
      return [];
    }
  }

  for (const source of configuredSources.filter(source => !debugOnly || source.key === debugOnly)) {
    const diag = {
      key: source.key,
      label: source.label,
      source_name: source.key,
      started_at: new Date().toISOString(),
      finished_at: null,
      duration_ms: 0,
      status: "pending",
      source_profile: sourceType(source),
      attempted: false,
      skipped: false,
      success: false,
      row_count: 0,
      normalized_count: 0,
      rows_collected: 0,
      rows_normalized: 0,
      rows_matched: 0,
      actionable_count: 0,
      retry_count: 0,
      error_message: null,
      prtAgCd: source.prtAgCd || null,
      sde: source.defaultParams?.sde || null,
      ede: source.defaultParams?.ede || null
    };
    const finishDiag = status => {
      diag.status = status;
      diag.finished_at = new Date().toISOString();
      diag.duration_ms = Math.max(0, new Date(diag.finished_at).getTime() - new Date(diag.started_at).getTime());
      diag.rows_collected = Number(diag.rows_collected || diag.row_count || 0);
      diag.rows_normalized = Number(diag.rows_normalized || diag.normalized_count || 0);
      diag.rows_matched = Number(diag.rows_matched || diag.actionable_count || 0);
      diag.rows_skipped = Math.max(0, diag.rows_collected - diag.rows_normalized);
      return diag;
    };
    if (Date.now() > deadline) {
      diag.skipped = true;
      diag.reason = collectorSkipReason("runtime_budget_exceeded");
      diag.skip_reason = diag.reason;
      diag.raw_skip_reason = "runtime_budget_exceeded";
      diagnostics.skipped_count += 1;
      diagnostics.sources.push(finishDiag("skipped"));
      continue;
    }
    const scheduleSkip = sourceScheduleSkipDecision(source);
    if (scheduleSkip) {
      diag.skipped = true;
      diag.reason = collectorSkipReason("source_schedule_window_not_due");
      diag.skip_reason = scheduleSkip.skip_reason || "source_schedule_window_not_due";
      diag.raw_skip_reason = "source_schedule_window_not_due";
      diag.source_schedule = {
        source_key: scheduleSkip.source_key,
        tier: scheduleSkip.tier,
        update_frequency: scheduleSkip.update_frequency,
        last_attempt_at: scheduleSkip.last_attempt_at || null,
        last_success_at: scheduleSkip.last_success_at || null,
        next_attempt_at: scheduleSkip.next_attempt_at || null,
        should_run_now: false
      };
      diagnostics.skipped_count += 1;
      diagnostics.sources.push(finishDiag("skipped"));
      continue;
    }
    if (source.key === "source_csv") {
      diag.mode = sourceCsvMode() || "refresh";
      diag.max_bytes = MAX_SOURCE_CSV_BYTES;
      diag.path_or_url = source.path_or_url || source.url || null;
      diag.optional_source = true;
      diag.core_blocking = false;
      if (["raw", "full"].includes(sourceCsvMode())) {
        diag.skipped = true;
        diag.reason = "RAW_CSV_DISABLED_IN_CORE";
        diag.skip_reason = "RAW_CSV_DISABLED_IN_CORE";
        diag.raw_skip_reason = "RAW_CSV_DISABLED_IN_CORE";
        diagnostics.skipped_count += 1;
        diagnostics.sources.push(finishDiag("skipped"));
        continue;
      }
      if (sourceCsvMode() === "off") {
        diag.skipped = true;
        diag.reason = "SOURCE_CSV_DISABLED";
        diag.skip_reason = "SOURCE_CSV_DISABLED";
        diag.raw_skip_reason = "SOURCE_CSV_DISABLED";
        diagnostics.skipped_count += 1;
        diagnostics.sources.push(finishDiag("skipped"));
        continue;
      }
      if (sourceCsvMode() === "lightweight" && source.lightweight_resolve_status !== "found") {
        diag.skipped = true;
        diag.reason = "LIGHTWEIGHT_CSV_NOT_FOUND";
        diag.skip_reason = "LIGHTWEIGHT_CSV_NOT_FOUND";
        diag.raw_skip_reason = "LIGHTWEIGHT_CSV_NOT_FOUND";
        diag.searched_paths = LIGHTWEIGHT_CSV_DEFAULT_PATHS;
        diagnostics.skipped_count += 1;
        diagnostics.sources.push(finishDiag("skipped"));
        continue;
      }
      if (sourceCsvMode() === "lightweight" && source.lightweight_source_type === "cache" && CORE_COLLECTOR_MODES.has(COLLECTOR_UPDATE_MODE)) {
        diag.path_or_url = source.path_or_url || null;
        diag.bytes = Number(source.lightweight_bytes || 0) || null;
        diag.max_bytes = MAX_SOURCE_CSV_BYTES;
        if (MAX_SOURCE_CSV_BYTES > 0 && Number(source.lightweight_bytes || 0) > MAX_SOURCE_CSV_BYTES) {
          diag.skipped = true;
          diag.reason = "LIGHTWEIGHT_CSV_TOO_LARGE";
          diag.skip_reason = "LIGHTWEIGHT_CSV_TOO_LARGE";
          diag.raw_skip_reason = "LIGHTWEIGHT_CSV_TOO_LARGE";
          diagnostics.skipped_count += 1;
          diagnostics.sources.push(finishDiag("skipped"));
          continue;
        }
        const cacheRows = lightweightCacheRowCount(source.localPath);
        diag.skipped = true;
        diag.reason = "LIGHTWEIGHT_CSV_REFERENCE_CACHE_REUSED";
        diag.skip_reason = "LIGHTWEIGHT_CSV_REFERENCE_CACHE_REUSED";
        diag.raw_skip_reason = "LIGHTWEIGHT_CSV_REFERENCE_CACHE_REUSED";
        diag.rows_collected = cacheRows;
        diag.row_count = cacheRows;
        diag.rows_normalized = cacheRows;
        diag.normalized_count = cacheRows;
        diag.optional_source = true;
        diag.core_blocking = false;
        diagnostics.skipped_count += 1;
        diagnostics.sources.push(finishDiag("warning"));
        continue;
      }
    }
    if (!source.url) {
      diag.skipped = true;
      diag.reason = collectorSkipReason(source.disabledReason || "missing_url");
      diag.skip_reason = diag.reason;
      diag.raw_skip_reason = source.disabledReason || "missing_url";
      diagnostics.skipped_count += 1;
      diagnostics.sources.push(finishDiag("skipped"));
      continue;
    }
    if (source.key === "source_csv" && sourceCsvMode() !== "lightweight") {
      const urlDiagnostic = diagnoseSourceCsvUrl({ sourceCsvUrl: source.url, cwd: process.cwd() });
      diag.source_csv_url_status = urlDiagnostic.status;
      diag.expected_raw_url = urlDiagnostic.expected_raw_url;
      diag.configured_url_sanitized = urlDiagnostic.configured_url_sanitized;
      diag.configured_repository = urlDiagnostic.configured_repository;
      diag.configured_file_path = urlDiagnostic.configured_file_path;
      diag.local_reference_path = urlDiagnostic.local_reference_path;
      diag.local_reference_exists = urlDiagnostic.local_reference_exists;
      diag.points_to_old_repo = urlDiagnostic.points_to_old_repo;
      diag.points_to_different_repo = urlDiagnostic.points_to_different_repo;
      diag.points_to_old_source_arrivals_csv = urlDiagnostic.points_to_old_source_arrivals_csv;
      diag.points_to_lightweight_verified_reference_csv = urlDiagnostic.points_to_lightweight_verified_reference_csv;
      diag.points_to_expected_url = urlDiagnostic.points_to_expected_url;
      diag.recommended_fix = urlDiagnostic.recommended_fix;
      if (urlDiagnostic.status === "WRONG_SOURCE_CSV_URL") {
        diag.skipped = true;
        diag.reason = "wrong_source_csv_url";
        diag.skip_reason = "WRONG_SOURCE_CSV_URL";
        diag.raw_skip_reason = urlDiagnostic.reasons.join("; ") || "wrong_source_csv_url";
        diag.failure_reason = "wrong_source_csv_url";
        diag.error_message = urlDiagnostic.recommended_fix;
        diagnostics.skipped_count += 1;
        diagnostics.sources.push(finishDiag("WRONG_SOURCE_CSV_URL"));
        continue;
      }
    }
    if (!canAttempt(source)) {
      diag.skipped = true;
      diag.reason = collectorSkipReason("missing_service_key_or_embedded_key");
      diag.skip_reason = diag.reason;
      diag.raw_skip_reason = "missing_service_key_or_embedded_key";
      diagnostics.skipped_count += 1;
      diagnostics.sources.push(finishDiag("skipped"));
      continue;
    }
    if (source.key === "port_facility_child_enrichment") {
      diag.attempted = true;
      diagnostics.attempted_count += 1;
      try {
        const child = await collectPortFacilityChildEnrichment(source, now, deadline);
        records.push(...child.records);
        Object.assign(diag, child.diagnostic);
        diag.success = Number(diag.rows_normalized || 0) > 0;
        if (diag.success) diagnostics.success_count += 1;
        else diagnostics.skipped_count += 1;
        diagnostics.sources.push(finishDiag(diag.success ? "success" : "skipped"));
      } catch (error) {
        diag.error = error?.message || String(error);
        diag.error_message = diag.error;
        diagnostics.failed_count += 1;
        diagnostics.sources.push(finishDiag("failed"));
      }
      continue;
    }
    if (source.key === "vessel_spec") {
      diag.attempted = true;
      diagnostics.attempted_count += 1;
      try {
        const spec = await collectVesselSpecByCallSign(source, now, deadline);
        records.push(...spec.records);
        Object.assign(diag, spec.diagnostic);
        diag.success = Number(diag.rows_normalized || 0) > 0;
        if (diag.success) diagnostics.success_count += 1;
        else diagnostics.skipped_count += 1;
        diagnostics.sources.push(finishDiag(diag.success ? "success" : "skipped"));
      } catch (error) {
        diag.error = error?.message || String(error);
        diag.error_message = diag.error;
        diagnostics.failed_count += 1;
        diagnostics.sources.push(finishDiag("failed"));
      }
      continue;
    }
    diag.attempted = true;
    diagnostics.attempted_count += 1;
    try {
      const rowLimit = Math.max(1, Math.min(Number(source.maxRows || MAX_SOURCE_ROWS), MAX_SOURCE_ROWS));
      const { text, url, http_status, latency_ms, result_meta, service_key_variant, retry_count, rows, pages_attempted, page_summaries, pagination_total_count, pagination_total_pages_expected, pagination_pages_collected, pagination_rows_collected, pagination_truncated, response_content_type, file_name_hint, response_size_bytes, max_allowed_bytes, head_checked, head_http_status, head_latency_ms } = await fetchPagedRows(source, rowLimit, deadline);
      diag.success = true;
      diag.latency_ms = latency_ms;
      diag.http_status = http_status;
      diag.retry_count = retry_count || 0;
      diag.requested_url_without_service_key = maskServiceKey(url);
      diag.service_key_variant = service_key_variant;
      if (debugVerboseEnabled()) diag.raw_response_preview = text.slice(0, 500);
      diag.resultCode = result_meta?.resultCode || null;
      diag.resultMsg = result_meta?.resultMsg || null;
      diag.totalCount = result_meta?.totalCount !== undefined ? Number(result_meta.totalCount) || result_meta.totalCount : null;
      diag.response_content_type = response_content_type || null;
      diag.content_type = response_content_type || null;
      diag.file_name_hint = file_name_hint || null;
      diag.response_size_bytes = Number(response_size_bytes || 0) || null;
      diag.max_allowed_bytes = Number(max_allowed_bytes || 0) || null;
      diag.head_checked = Boolean(head_checked);
      diag.head_http_status = head_http_status || null;
      diag.head_latency_ms = head_latency_ms || null;
      diag.header_row_fields = result_meta?.header_fields || [];
      diag.row_count_estimate = result_meta?.row_count_estimate ?? null;
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
      if (source.key === "source_csv") {
        diag.mode = sourceCsvMode() || "lightweight";
        diag.path_or_url = source.path_or_url || source.url || null;
        diag.bytes = Number(response_size_bytes || 0) || null;
        diag.max_bytes = Number(max_allowed_bytes || MAX_SOURCE_CSV_BYTES);
        const schema = lightweightCsvSchemaStatus(diag.sample_keys.length ? diag.sample_keys : (result_meta?.header_fields || []));
        diag.lightweight_schema = schema;
        if (!schema.ok) {
          diag.skipped = true;
          diag.success = false;
          diag.reason = "LIGHTWEIGHT_CSV_SCHEMA_INSUFFICIENT";
          diag.skip_reason = "LIGHTWEIGHT_CSV_SCHEMA_INSUFFICIENT";
          diag.raw_skip_reason = "LIGHTWEIGHT_CSV_SCHEMA_INSUFFICIENT";
          diagnostics.skipped_count += 1;
          diagnostics.sources.push(finishDiag("skipped"));
          continue;
        }
      }
      let childAttempted = 0;
      let childSuccess = 0;
      let childRows = 0;
      let childNormalized = 0;
      let childSkippedByLimit = 0;
      const childStatuses = new Map();
      for (const row of rows) {
        let normalized = normalizeRow(row, source, now);
        if (normalized && String(source.key || "").startsWith("port_operation_") && !CORE_COLLECTOR_MODES.has(COLLECTOR_UPDATE_MODE)) {
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
      const sourceRecords = records.filter(record => (record.source_key || record.source) === source.key);
      diag.normalized_count = sourceRecords.length;
      diag.rows_normalized = sourceRecords.length;
      diag.rows_with_vessel_name = sourceRecords.filter(record => String(record.vessel_name || "").trim()).length;
      diag.rows_with_normalized_vessel_name = sourceRecords.filter(record => String(record.normalized_vessel_name || "").trim()).length;
      diag.rows_with_call_sign = sourceRecords.filter(record => String(record.call_sign || "").trim()).length;
      diag.rows_with_normalized_port = sourceRecords.filter(record => String(record.normalized_port || "").trim()).length;
      diag.rows_with_match_keys = sourceRecords.filter(record => Object.keys(record.match_keys || {}).length > 0).length;
      diag.rows_time_only = sourceRecords.filter(record =>
        record.pilot_time_parse_status === "time_only_missing_date" ||
        Object.values(record.time_parse_statuses || {}).includes("time_only")
      ).length;
      diag.rows_invalid_time = sourceRecords.filter(record =>
        record.pilot_time_parse_status === "invalid_date_time" ||
        Object.values(record.time_parse_statuses || {}).includes("invalid")
      ).length;
      diag.sample_before_after = sourceRecords.slice(0, 5).map(record => ({
        before: {
          raw_source_keys: record.raw_source_keys || [],
          raw_port: record.raw_port || "",
          raw_berth_name: record.raw_berth_name || "",
          raw_terminal_name: record.raw_terminal_name || ""
        },
        after: {
          vessel_name: record.vessel_name || "",
          normalized_vessel_name: record.normalized_vessel_name || "",
          call_sign: record.call_sign || "",
          normalized_port: record.normalized_port || "",
          berth_key: record.berth_key || "",
          terminal_name: record.terminal_name || "",
          match_keys: record.match_keys || {}
        }
      }));
      if (isPncSourceConfig(source)) {
        Object.assign(diag, pncAliasDiagnostics(rows, sourceRecords));
      }
      if (String(source.key || "").startsWith("pilot_source_")) {
        diag.pilot_rows_with_vessel_name = sourceRecords.filter(record => String(record.vessel_name || "").trim()).length;
        diag.pilot_rows_with_call_sign = sourceRecords.filter(record => String(record.call_sign || "").trim()).length;
        diag.pilot_rows_with_port = sourceRecords.filter(record => String(record.port || record.port_name || "").trim()).length;
        diag.pilot_rows_with_pilot_date = sourceRecords.filter(record => String(record.pilot_date || "").trim()).length;
        diag.pilot_rows_with_pilot_time = sourceRecords.filter(record => String(record.pilot_time || record.pilot_time_text || "").trim()).length;
        diag.pilot_rows_with_pilot_station = sourceRecords.filter(record => String(record.pilot_station || "").trim()).length;
        diag.pilot_rows_with_pilot_direction = sourceRecords.filter(record => String(record.pilot_direction || record.movement_type || "").trim()).length;
        diag.time_only_rows = sourceRecords.filter(record => record.pilot_time_parse_status === "time_only_missing_date").length;
        diag.invalid_time_rows = sourceRecords.filter(record => record.pilot_time_parse_status === "invalid_date_time").length;
      }
      if (source.key === "vessel_spec") {
        Object.assign(diag, vesselSpecAliasDiagnostics(rows, sourceRecords));
        diag.rows_with_imo = sourceRecords.filter(record => String(record.imo || "").trim()).length;
        diag.rows_with_call_sign = sourceRecords.filter(record => String(record.call_sign || "").trim()).length;
        diag.rows_with_flag = sourceRecords.filter(record => String(record.flag || "").trim()).length;
        diag.rows_with_gt = sourceRecords.filter(record => Number(record.gt || record.grtg || record.intrlGrtg || 0) > 0).length;
        diag.rows_with_international_gt = sourceRecords.filter(record => Number(record.international_gt || record.intrlGrtg || 0) > 0).length;
        diag.rows_with_loa = sourceRecords.filter(record => Number(record.loa || record.length || 0) > 0).length;
        diag.rows_with_beam = sourceRecords.filter(record => Number(record.beam || 0) > 0).length;
        diag.rows_with_draft = sourceRecords.filter(record => Number(record.draft || 0) > 0).length;
        diag.rows_with_vessel_type = sourceRecords.filter(record => String(record.vessel_type || record.vsslKndNm || "").trim()).length;
      }
      if (source.key === "ulsan_vessel_operation") {
        diag.ulsan_rows_with_vessel_name = sourceRecords.filter(record => String(record.vessel_name || "").trim()).length;
        diag.ulsan_rows_with_call_sign = sourceRecords.filter(record => String(record.call_sign || "").trim()).length;
        diag.ulsan_rows_with_port = sourceRecords.filter(record => String(record.port || record.port_name || record.normalized_port || "").trim()).length;
        diag.ulsan_rows_with_berth = sourceRecords.filter(record => String(record.berth || record.berth_name || record.terminal_name || "").trim()).length;
        diag.ulsan_rows_with_time = sourceRecords.filter(record => record.eta || record.etb || record.ata || record.atb || record.etd || record.atd).length;
      }
      diag.actionable_count = sourceRecords.filter(record => record.actionable_source_row).length;
      diag.rows_matched = diag.actionable_count;
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
          rows_with_facility_hint: sourceRecords.filter(record => record.facility_name || record.port_facility_berth_signal).length,
          rows_with_operator_candidate: sourceRecords.filter(record => record.operator_or_agent_candidate || record.port_facility_operator_candidate).length,
          rows_with_cargo_hint: sourceRecords.filter(record => record.cargo_operation_hint).length,
          statuses: Object.fromEntries(childStatuses)
        };
      }
      if (diag.row_count > 0 && diag.normalized_count === 0) {
        diag.warning = "source_returned_rows_but_no_vessel_identity_fields_matched";
      }
      if (source.key === "source_csv" && diag.normalized_count === 0) {
        diag.success = false;
        diag.warning = "LIGHTWEIGHT_CSV_NORMALIZED_ROWS_ZERO";
        diag.reason = "LIGHTWEIGHT_CSV_NORMALIZED_ROWS_ZERO";
        diagnostics.skipped_count += 1;
        diagnostics.sources.push(finishDiag("warning"));
        continue;
      }
      diagnostics.success_count += 1;
      finishDiag("success");
    } catch (error) {
      diag.error = error?.message || String(error);
      diag.error_message = diag.error;
      diag.failure_reason = error?.failure_reason || null;
      diag.response_size_bytes = Number(error?.response_size_bytes || 0) || null;
      diag.max_allowed_bytes = Number(error?.max_allowed_bytes || 0) || null;
      diag.bytes = Number(error?.response_size_bytes || 0) || null;
      diag.max_bytes = Number(error?.max_allowed_bytes || MAX_SOURCE_CSV_BYTES) || null;
      diag.response_content_type = error?.response_content_type || null;
      diag.content_type = error?.response_content_type || null;
      diag.file_name_hint = error?.file_name_hint || null;
      diag.head_checked = Boolean(error?.head_checked);
      diag.head_http_status = error?.head_http_status || null;
      diag.head_latency_ms = error?.head_latency_ms || null;
      diag.http_status = error?.http_status || null;
      diag.retry_count = error?.retry_count || 0;
      if (source.key === "source_csv") {
        diag.optional_source = true;
        diag.core_blocking = false;
        diag.skipped = true;
        diag.reason = error?.failure_reason === "LIGHTWEIGHT_CSV_TOO_LARGE" || error?.failure_reason === "api_response_too_large"
          ? "LIGHTWEIGHT_CSV_TOO_LARGE"
          : "LIGHTWEIGHT_CSV_PARSE_FAILED";
        diag.skip_reason = diag.reason;
        diag.raw_skip_reason = diag.error_message;
        diagnostics.skipped_count += 1;
        diagnostics.sources.push(finishDiag(error?.failure_reason === "LIGHTWEIGHT_CSV_TOO_LARGE" || error?.failure_reason === "api_response_too_large" ? "skipped" : "failed_optional"));
        continue;
      }
      diagnostics.failed_count += 1;
      finishDiag("failed");
    }
    diagnostics.sources.push(diag);
  }
  const pilotAppliedRecords = applyPilotSchedule(records);
  const enrichedRecords = applySecondaryEnrichment(pilotAppliedRecords);
  const deduped = dedupe(enrichedRecords);
  diagnostics.real_row_count = deduped.length;
  diagnostics.actionable_row_count = deduped.filter(record => record.actionable_source_row).length;
  diagnostics.count_funnel = {
    ...(diagnostics.count_funnel || {}),
    pilot_schedule_rows: records.filter(isPilotScheduleRecord).length,
    pilot_only_arrival_review: deduped.filter(record => record.pilot_only_arrival_review).length,
    pilot_matched_port_calls: deduped.filter(record => record.pilot_schedule_matched).length,
    tier2_enrichment_rows: records.filter(isTier2EnrichmentRecord).length,
    secondary_enrichment_matched_port_calls: deduped.filter(record => record.secondary_enrichment_matched).length,
    target_vessels_5000gt_plus: deduped.filter(record => Number(record.gt || record.grtg || record.intrlGrtg || 0) >= 5000).length,
    unknown_gt_review: deduped.filter(record => !Number(record.gt || record.grtg || record.intrlGrtg || 0)).length,
    excluded_under_5000gt: deduped.filter(record => {
      const gt = Number(record.gt || record.grtg || record.intrlGrtg || 0);
      return gt > 0 && gt < 5000;
    }).length
  };
  const portOperationDiagnostics = diagnostics.sources.filter(source => String(source.key || "").startsWith("port_operation_"));
  const portOperationAttempted = portOperationDiagnostics.filter(source => source.attempted);
  diagnostics.coverage = {
    ...(diagnostics.port_registry || {}),
    ...(diagnostics.port_operation_collection_plan || {}),
    ports_attempted_count: new Set(portOperationAttempted.map(source => source.prtAgCd).filter(Boolean)).size,
    port_operation_sources_attempted_count: portOperationAttempted.length,
    port_operation_sources_skipped_count: portOperationDiagnostics.filter(source => source.skipped).length,
    port_operation_skip_reason_breakdown: portOperationDiagnostics.reduce((acc, source) => {
      if (!source.skipped) return acc;
      const reason = source.skip_reason || source.reason || source.error_message || source.status || "unknown_error";
      acc[reason] = (acc[reason] || 0) + 1;
      return acc;
    }, {}),
    successful_ports_count: new Set(portOperationDiagnostics.filter(source => source.success && Number(source.row_count || 0) > 0).map(source => source.prtAgCd).filter(Boolean)).size,
    failed_ports_count: new Set(portOperationDiagnostics.filter(source => source.error).map(source => source.prtAgCd).filter(Boolean)).size,
    no_data_ports_count: new Set(portOperationDiagnostics.filter(source => source.success && Number(source.row_count || 0) === 0).map(source => source.prtAgCd).filter(Boolean)).size,
    port_operation_rows_by_port: Object.fromEntries([...new Set(portOperationDiagnostics.map(source => source.prtAgCd).filter(Boolean))].map(code => [
      code,
      portOperationDiagnostics.filter(source => source.prtAgCd === code).reduce((sum, source) => sum + Number(source.row_count || 0), 0)
    ])),
    target_vessels_by_port: Object.fromEntries([...new Set(deduped.map(record => record.port_code).filter(Boolean))].map(code => [
      code,
      deduped.filter(record => record.port_code === code && Number(record.gt || record.grtg || record.intrlGrtg || 0) >= 5000).length
    ])),
    candidates_by_port: Object.fromEntries([...new Set(deduped.map(record => record.port_code).filter(Boolean))].map(code => [
      code,
      deduped.filter(record => record.port_code === code && Number(record.commercial_value_score || record.total_sales_priority_score || 0) >= 50).length
    ]))
  };
  Object.assign(diagnostics, diagnostics.coverage);
  diagnostics.partial_failure = diagnostics.failed_count > 0 && diagnostics.success_count > 0;
  diagnostics.partial_failure_policy = "failed enrichment/source collectors do not remove Port Operation vessels or stop the pipeline";
  return deduped;
}

export async function collectKoreaData({ apiSources = [] } = {}) {
  const realRows = await collectRealRows();
  diagnostics.fallback_used = realRows.length === 0;
  if (process.env.CI && collectorModeRequiresPortOperation() && diagnostics.attempted_count === 0) {
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

