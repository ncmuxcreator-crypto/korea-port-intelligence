#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const GENERATED_AT = new Date().toISOString();
const GENERATED_BY = process.env.GITHUB_ACTIONS === "true" || process.env.GITHUB_RUN_ID || process.env.GITHUB_WORKFLOW
  ? "github_actions"
  : "local";
const IS_GITHUB_ACTIONS = GENERATED_BY === "github_actions";

const OUT_DIR = path.join(ROOT, "dashboard", "api", "discovery");
const DOC_DIR = path.join(ROOT, "docs");

const PRODUCT_AREAS = {
  sales: "영업 실행",
  vessel: "선박 인텔리전스",
  portFleet: "항만·선대 인텔리전스",
  data: "데이터 소스·Enrichment",
  system: "시스템 진단",
  overview: "요약 / 현황판"
};

const SOURCE_DEFINITIONS = [
  {
    source_key: "port_operation",
    source_name: "Port Operation / Port-MIS",
    expected_env_names: ["PORT_OPERATION_API_URL", "PORT_OPERATION_SERVICE_KEY"],
    required_endpoint_or_url: "PORT_OPERATION_API_URL or default public endpoint",
    required_parameters: ["service key", "port code", "date/page parameters if supported"],
    expected_response_format: "Public port operation rows with vessel, port, ETA/ATA/ETD/ATD, berth fields",
    expected_fields: ["vessel_name", "call_sign", "port", "eta", "ata", "etd", "atd", "berth", "gt", "vessel_type"],
    product_value: "Core vessel universe, current port, sales target timing",
    enrichment_fields_possible: ["current_port", "eta", "ata", "etd", "atd", "berth", "gt", "vessel_type"]
  },
  {
    source_key: "source_csv",
    source_name: "Verified Reference CSV",
    expected_env_names: ["SOURCE_CSV_URL", "ENABLE_SOURCE_CSV"],
    required_endpoint_or_url: "SOURCE_CSV_URL",
    required_parameters: ["small verified CSV", "ENABLE_SOURCE_CSV=true"],
    expected_response_format: "CSV with verified vessel identity and company fields",
    expected_fields: ["vessel_name", "imo", "mmsi", "call_sign", "operator", "owner", "manager", "vessel_type", "gt", "dwt", "flag"],
    product_value: "Identity and operator enrichment",
    enrichment_fields_possible: ["imo", "mmsi", "operator_display", "owner", "manager", "vessel_type", "gt", "dwt", "flag"]
  },
  {
    source_key: "pilot_sources",
    source_name: "Pilotage Sources",
    expected_env_names: ["PILOT_SOURCE_URLS"],
    required_endpoint_or_url: "PILOT_SOURCE_URLS",
    required_parameters: ["source URL list", "parser aliases for time/station/direction"],
    expected_response_format: "Pilotage schedule rows",
    expected_fields: ["vessel_name", "call_sign", "port", "pilot_time", "pilot_station", "pilot_direction"],
    product_value: "Arrival/departure timing signal and action urgency",
    enrichment_fields_possible: ["pilotage_signal", "arrival_departure_timing_signal"]
  },
  {
    source_key: "berth_sources",
    source_name: "Berth / Terminal Sources",
    expected_env_names: ["BERTH_SOURCE_URLS", "PNC_SOURCE_URLS"],
    required_endpoint_or_url: "BERTH_SOURCE_URLS or PNC_SOURCE_URLS",
    required_parameters: ["source URL list", "berth/terminal parser aliases"],
    expected_response_format: "Berth, terminal, and operation status rows",
    expected_fields: ["vessel_name", "call_sign", "berth", "terminal", "etb", "atb", "operation_status"],
    product_value: "Berth readiness, terminal context, operator fallback",
    enrichment_fields_possible: ["berth", "terminal", "berth_signal", "operator_display"]
  },
  {
    source_key: "PNC_SOURCE_URLS",
    source_name: "PNC Berth Feed",
    expected_env_names: ["PNC_SOURCE_URLS"],
    required_endpoint_or_url: "PNC_SOURCE_URLS",
    required_parameters: ["PNC feed URL list"],
    expected_response_format: "Terminal berth/operation feed",
    expected_fields: ["vessel_name", "call_sign", "terminal", "berth", "operator", "route", "operation_status"],
    product_value: "Busan/terminal berth enrichment",
    enrichment_fields_possible: ["berth", "terminal", "operator_display", "route", "operation_status"]
  },
  {
    source_key: "mof_ais_info",
    source_name: "MOF AIS Info",
    expected_env_names: ["MOF_AIS_INFO_API_URL", "MOF_AIS_INFO_SERVICE_KEY"],
    required_endpoint_or_url: "MOF_AIS_INFO_API_URL",
    required_parameters: ["service key", "MMSI/IMO/name query"],
    expected_response_format: "AIS static vessel info",
    expected_fields: ["imo", "mmsi", "call_sign", "vessel_name", "vessel_type", "flag", "gt", "dwt"],
    product_value: "IMO/MMSI and vessel specification enrichment",
    enrichment_fields_possible: ["imo", "mmsi", "call_sign", "vessel_type", "flag", "gt", "dwt"]
  },
  {
    source_key: "mof_ais_dynamic",
    source_name: "MOF AIS Dynamic",
    expected_env_names: ["MOF_AIS_DYNAMIC_API_URL", "MOF_AIS_DYNAMIC_SERVICE_KEY"],
    required_endpoint_or_url: "MOF_AIS_DYNAMIC_API_URL",
    required_parameters: ["service key", "position/time query"],
    expected_response_format: "AIS position and movement rows",
    expected_fields: ["mmsi", "lat", "lon", "speed", "course", "last_seen_at", "destination"],
    product_value: "Fresh movement, anchorage, slow steaming, destination signal",
    enrichment_fields_possible: ["last_seen_at", "movement_status", "anchorage", "sensitive_route"]
  },
  {
    source_key: "mof_ais_stat",
    source_name: "MOF AIS Statistics",
    expected_env_names: ["MOF_AIS_STAT_API_URL", "MOF_AIS_STAT_SERVICE_KEY"],
    required_endpoint_or_url: "MOF_AIS_STAT_API_URL",
    required_parameters: ["service key", "period/stat query"],
    expected_response_format: "AIS statistics/visit aggregates",
    expected_fields: ["mmsi", "visit_count", "dwell_time", "route_history"],
    product_value: "Repeat caller and Korea presence scoring",
    enrichment_fields_possible: ["repeat_caller_signal", "korea_presence_score", "route_signal"]
  },
  {
    source_key: "vessel_spec",
    source_name: "Vessel Specification",
    expected_env_names: ["VESSEL_SPEC_API_URL", "VESSEL_SPEC_SERVICE_KEY"],
    required_endpoint_or_url: "VESSEL_SPEC_API_URL",
    required_parameters: ["service key", "vessel identity query"],
    expected_response_format: "Static vessel specification rows",
    expected_fields: ["imo", "mmsi", "call_sign", "vessel_type", "gt", "dwt", "flag", "loa", "beam"],
    product_value: "Tonnage and commercial-size classification",
    enrichment_fields_possible: ["gt", "dwt", "flag", "loa", "beam", "tonnage_summary"]
  },
  {
    source_key: "VTS",
    source_name: "VTS",
    expected_env_names: ["MOF_VTS_API_URL", "MOF_VTS_SERVICE_KEY", "VTS_SOURCE_URLS"],
    required_endpoint_or_url: "VTS source URL if configured",
    required_parameters: ["source URL/key if available"],
    expected_response_format: "Vessel traffic observations",
    expected_fields: ["mmsi", "call_sign", "vessel_name", "lat", "lon", "speed", "course", "observed_at"],
    product_value: "Waiting, anchorage, loitering and congestion signal",
    enrichment_fields_possible: ["anchorage", "movement_status", "waiting_hours", "congestion_score"]
  },
  {
    source_key: "port_facility",
    source_name: "Port Facility",
    expected_env_names: ["PORT_FACILITY_API_URL", "PORT_FACILITY_SERVICE_KEY"],
    required_endpoint_or_url: "PORT_FACILITY_API_URL if configured",
    required_parameters: ["service key", "port/facility query"],
    expected_response_format: "Port facility/berth metadata",
    expected_fields: ["port_code", "port_name", "berth", "terminal", "facility_name", "capacity"],
    product_value: "Port/berth context and map labels",
    enrichment_fields_possible: ["port_facility_context", "terminal_context", "berth_context"]
  },
  {
    source_key: "ulsan_core",
    source_name: "Ulsan Core",
    expected_env_names: ["ULSAN_API_URL", "ULSAN_API_KEY"],
    required_endpoint_or_url: "ULSAN_API_URL",
    required_parameters: ["Ulsan API URL/key"],
    expected_response_format: "Ulsan port rows",
    expected_fields: ["vessel_name", "berth", "cargo", "terminal"],
    product_value: "Ulsan-specific berth/cargo enrichment",
    enrichment_fields_possible: ["berth", "terminal", "cargo_context"]
  },
  {
    source_key: "ulsan_berth_detail",
    source_name: "Ulsan Berth Detail",
    expected_env_names: ["ULSAN_BERTH_DETAIL_API_URL", "ULSAN_BERTH_DETAIL_API_KEY"],
    required_endpoint_or_url: "ULSAN_BERTH_DETAIL_API_URL",
    required_parameters: ["Ulsan berth detail URL/key"],
    expected_response_format: "Ulsan berth detail rows",
    expected_fields: ["berth", "terminal", "operation_status"],
    product_value: "Ulsan berth precision",
    enrichment_fields_possible: ["berth", "terminal", "berth_signal"]
  },
  {
    source_key: "ulsan_cargo_plan",
    source_name: "Ulsan Cargo Plan",
    expected_env_names: ["ULSAN_CARGO_PLAN_API_URL", "ULSAN_CARGO_PLAN_API_KEY"],
    required_endpoint_or_url: "ULSAN_CARGO_PLAN_API_URL",
    required_parameters: ["Ulsan cargo plan URL/key"],
    expected_response_format: "Cargo plan rows",
    expected_fields: ["vessel_name", "cargo", "schedule"],
    product_value: "Cargo and operation planning signal",
    enrichment_fields_possible: ["cargo_context", "operation_status"]
  },
  {
    source_key: "ulsan_berth_operation",
    source_name: "Ulsan Berth Operation",
    expected_env_names: ["ULSAN_BERTH_OPERATION_API_URL", "ULSAN_BERTH_OPERATION_API_KEY"],
    required_endpoint_or_url: "ULSAN_BERTH_OPERATION_API_URL",
    required_parameters: ["Ulsan berth operation URL/key"],
    expected_response_format: "Berth operation rows",
    expected_fields: ["berth", "operation_status", "vessel_name"],
    product_value: "Ulsan operation status",
    enrichment_fields_possible: ["operation_status", "berth_signal"]
  },
  {
    source_key: "ulsan_terminal_process",
    source_name: "Ulsan Terminal Process",
    expected_env_names: ["ULSAN_TERMINAL_PROCESS_API_URL", "ULSAN_TERMINAL_PROCESS_API_KEY"],
    required_endpoint_or_url: "ULSAN_TERMINAL_PROCESS_API_URL",
    required_parameters: ["Ulsan terminal process URL/key"],
    expected_response_format: "Terminal process rows",
    expected_fields: ["terminal", "process_status", "vessel_name"],
    product_value: "Terminal activity enrichment",
    enrichment_fields_possible: ["terminal", "operation_status"]
  }
];

const FIELD_GROUPS = {
  identity: ["vessel_name", "normalized_vessel_name", "imo", "mmsi", "call_sign"],
  specification: ["gt", "dwt", "vessel_type", "flag", "loa", "beam"],
  operational: ["current_port", "eta", "etb", "ata", "atd", "berth", "terminal", "anchorage", "movement_status", "pilotage_signal", "berth_signal"],
  commercial: ["operator", "owner", "manager", "fleet_group", "contact_status", "quote_readiness", "sales_priority"],
  risk_compliance: ["biofouling_risk", "cleaning_window", "compliance_exposure", "sensitive_route", "CII_fuel_impact"]
};

const PRODUCT_FEATURE_HINTS = [
  ["sales-actions", "오늘의 영업 액션", "sales", ["sales/actions", "agent-followup", "verification-queue"]],
  ["conversion-pipeline", "영업 전환 파이프라인", "sales", ["conversion-pipeline"]],
  ["quote-opportunities", "견적 기회 빌더", "sales", ["quote-opportunities"]],
  ["watchlist", "관심 선박", "sales", ["watchlist/current"]],
  ["target-categories", "영업 대상 카테고리", "sales", ["targets/categories", "targets/current"]],
  ["vessel-pages", "전체 선박 페이지", "vessel", ["vessels/index", "vessels/page-"]],
  ["arrival-pipeline", "입항 예정", "vessel", ["arrival-pipeline", "predicted-arrivals"]],
  ["anchorage-waiting", "묘박/대기", "vessel", ["anchorage-waiting"]],
  ["staying-vessels", "장기 체류", "vessel", ["staying-vessels"]],
  ["biofouling-risk", "부착생물 위험", "vessel", ["biofouling", "biofouling-risk"]],
  ["cleaning-window", "클리닝 적기", "vessel", ["cleaning-window"]],
  ["compliance-exposure", "Compliance 노출도", "vessel", ["compliance-exposure", "compliance-opportunities"]],
  ["opportunity-memory", "반복 영업 기회", "sales", ["opportunity-memory"]],
  ["fleet-intelligence", "선대 인텔리전스", "portFleet", ["fleet-intelligence"]],
  ["fleet-penetration", "선대 침투율", "portFleet", ["fleet-penetration"]],
  ["fleet-gap-finder", "선대 기회 갭", "portFleet", ["fleet-gap-finder"]],
  ["fleet-dna", "선대 DNA", "portFleet", ["fleet-dna"]],
  ["agent-intelligence", "에이전트 인텔리전스", "portFleet", ["agent-intelligence", "agent-relationship"]],
  ["revenue-forecast", "예상 매출 기회", "portFleet", ["revenue-forecast"]],
  ["port-dna", "항만 DNA", "portFleet", ["port-dna"]],
  ["port-demand-radar", "항만 수요 레이더", "portFleet", ["port-demand-radar"]],
  ["port-seasonality", "항만 계절성", "portFleet", ["port-seasonality"]],
  ["enrichment-engine", "Source Data Enrichment", "data", ["enrichment/candidates", "enrichment/applied", "enrichment/review-queue", "enrichment/summary"]],
  ["source-quality", "Source Quality Score", "data", ["source-quality-score"]],
  ["source-capability-matrix", "Source Capability Matrix", "data", ["source-capability-matrix"]],
  ["enrichment-utilization", "보조 소스 활용률", "data", ["enrichment-utilization"]],
  ["source-cache", "Auxiliary Source Cache", "data", ["aux/cache-status"]],
  ["source-schedule", "Auxiliary Source Schedule", "data", ["aux/source-schedule"]],
  ["db-cleanup-plan", "DB Cleanup Plan", "system", ["db-cleanup-plan", "storage-efficiency-report"]],
  ["diagnostics", "데이터 품질·시스템 진단", "system", ["status", "source-collection-status", "endpoint-manifest", "data-quality"]]
];

function readText(relativePath, fallback = "") {
  try {
    const filePath = path.join(ROOT, relativePath);
    return fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : fallback;
  } catch {
    return fallback;
  }
}

function readJson(relativePath, fallback = null) {
  try {
    const filePath = path.join(ROOT, relativePath);
    return fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, "utf8")) : fallback;
  } catch (error) {
    return { __parse_error: error.message };
  }
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeJson(relativePath, payload) {
  const filePath = path.join(ROOT, relativePath);
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2) + "\n", "utf8");
}

function withDiscoveryTierMetadata(payload = {}, runId = null) {
  const sourceRunId = payload.source_run_id || payload.run_id || runId || null;
  return {
    ...payload,
    schema_version: payload.schema_version || "1.0",
    generated_at: payload.generated_at || GENERATED_AT,
    generated_by: payload.generated_by || GENERATED_BY,
    is_github_actions: payload.is_github_actions ?? IS_GITHUB_ACTIONS,
    run_id: payload.run_id || runId || null,
    status_run_id: payload.status_run_id || sourceRunId,
    active_run_id: payload.active_run_id || sourceRunId,
    latest_successful_run_id: payload.latest_successful_run_id || null,
    source_run_id: sourceRunId,
    owner_tier: "discovery_audit",
    core_may_update: false,
    stale_diagnostic: payload.stale_diagnostic ?? false,
    stale_reason: payload.stale_reason || ""
  };
}

function writeMarkdown(relativePath, content) {
  const filePath = path.join(ROOT, relativePath);
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, content.trimEnd() + "\n", "utf8");
}

function listFiles(dir, predicate = () => true) {
  const root = path.join(ROOT, dir);
  if (!fs.existsSync(root)) return [];
  const out = [];
  const walk = current => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (!["node_modules", ".git"].includes(entry.name)) walk(full);
      } else if (entry.isFile()) {
        const rel = path.relative(ROOT, full).replace(/\\/g, "/");
        if (predicate(rel)) out.push(rel);
      }
    }
  };
  walk(root);
  return out.sort();
}

function rows(payload) {
  if (Array.isArray(payload)) return payload;
  for (const key of ["items", "data", "vessels", "candidates", "ports", "categories", "endpoints"]) {
    if (Array.isArray(payload?.[key])) return payload[key];
  }
  return [];
}

function productArea(areaKey) {
  return PRODUCT_AREAS[areaKey] || PRODUCT_AREAS.overview;
}

function normalizeId(value = "") {
  return String(value)
    .replace(/^dashboard\/api\//, "")
    .replace(/\.json$/, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}

function classifyEndpoint(pathValue = "") {
  if (/sales\//.test(pathValue)) return "Sales action";
  if (/targets\//.test(pathValue)) return "Targeting";
  if (/watchlist\//.test(pathValue)) return "Watchlist";
  if (/vessels\//.test(pathValue) || /vessels\.json$/.test(pathValue)) return "Vessel detail";
  if (/ports|port-|port_/.test(pathValue)) return "Port intelligence";
  if (/fleet|operator|agent/.test(pathValue)) return "Fleet intelligence";
  if (/revenue|quote|conversion/.test(pathValue)) return "Revenue intelligence";
  if (/compliance|cleaning|biofouling|risk/.test(pathValue)) return "Compliance / cleaning window";
  if (/contact|memory|relationship/.test(pathValue)) return "Contact / memory";
  if (/aux\//.test(pathValue)) return "Auxiliary source summary";
  if (/enrichment/.test(pathValue)) return "Enrichment";
  if (/status|health|quality|debug|audit|diagnostic|source-|storage|db-cleanup|endpoint-manifest/.test(pathValue)) return "Diagnostic";
  return "Core summary";
}

function discoverUiReferences(html) {
  const endpoints = [...new Set([...html.matchAll(/dashboard\/api\/[A-Za-z0-9_./-]+?\.json/g)].map(match => match[0]))];
  const titles = [...new Set([...html.matchAll(/(?:id|class)="([^"]+)"/g)].map(match => match[1]).slice(0, 300))];
  const sectionTexts = [...new Set([...html.matchAll(/>([^<]{2,60})</g)]
    .map(match => match[1].replace(/\s+/g, " ").trim())
    .filter(text => /영업|선박|항만|데이터|리스크|Compliance|Biofouling|진단|브리핑|관심|견적|선대|클리닝/.test(text)))];
  const placeholders = [];
  const placeholderPatterns = [/데이터 준비 중/g, /확인 중/g, /0건/g, /coming soon/gi, /placeholder/gi, /TODO/gi, /hidden/gi, /display:none/gi, /disabled/gi, /mock/gi, /sample/gi];
  for (const pattern of placeholderPatterns) {
    for (const match of html.matchAll(pattern)) {
      placeholders.push({
        section_title: match[0],
        dom_id_or_class: "",
        intended_feature: "UI placeholder or hidden state",
        referenced_endpoint: "",
        matching_endpoint_found: false,
        endpoint_has_data: false,
        reason_not_visible: "Placeholder/hidden marker found in dashboard HTML.",
        recommended_reconnect_action: "Map to an existing summary endpoint if data exists; otherwise keep as empty state."
      });
    }
  }
  return { endpoints, titles, sectionTexts, placeholders: placeholders.slice(0, 120) };
}

function endpointVisibility(endpoint, uiEndpointSet) {
  if (uiEndpointSet.has(endpoint.path)) return "VISIBLE_OR_REFERENCED";
  if (endpoint.source_layer === "diagnostic") return "DIAGNOSTIC_ONLY";
  if (endpoint.record_count > 0 || endpoint.item_count > 0) return "HIDDEN_OR_LAZY";
  return "NOT_VISIBLE";
}

function endpointStatus(endpoint, visibility) {
  if (!endpoint.exists || endpoint.valid_json === false) return "BROKEN_ENDPOINT";
  if (endpoint.status === "STALE") return "STALE_SUMMARY";
  if (endpoint.status === "EMPTY_VALID" || Number(endpoint.record_count || 0) === 0 && Number(endpoint.item_count || 0) === 0) return "EMPTY_VALID";
  if (endpoint.status === "TOO_LARGE") return "TOO_HEAVY_NEEDS_SUMMARY";
  if (visibility === "DIAGNOSTIC_ONLY") return "TECHNICAL_DIAGNOSTIC_ONLY";
  if (visibility === "HIDDEN_OR_LAZY") return "ENDPOINT_EXISTS_UI_MISSING";
  return "ACTIVE_VISIBLE";
}

function featureFromHint(hint, endpoints, ui) {
  const [id, name, areaKey, patterns] = hint;
  const matched = endpoints.filter(endpoint => patterns.some(pattern => endpoint.path.includes(pattern) || endpoint.key?.includes(pattern)));
  const existingUiSections = ui.sectionTexts.filter(text => name.includes(text) || text.includes(name.replace(/\s+/g, " ").split(" ")[0])).slice(0, 10);
  const recordCount = matched.reduce((sum, endpoint) => sum + Number(endpoint.record_count || 0), 0);
  const itemCount = matched.reduce((sum, endpoint) => sum + Number(endpoint.item_count || 0), 0);
  const hasEndpoint = matched.length > 0;
  const hasUi = existingUiSections.length > 0 || matched.some(endpoint => endpoint.current_visibility === "VISIBLE_OR_REFERENCED");
  let status = "DISCUSSED_NOT_IMPLEMENTED";
  if (hasEndpoint && hasUi) status = "ACTIVE_VISIBLE";
  else if (hasEndpoint && recordCount + itemCount > 0) status = "DEVELOPED_HIDDEN";
  else if (hasEndpoint) status = "EMPTY_VALID";
  return {
    feature_id: id,
    feature_name: name,
    product_area: productArea(areaKey),
    discovery_source: hasEndpoint ? "endpoint-manifest" : "UI/docs/scripts inference",
    existing_endpoint_paths: matched.map(endpoint => endpoint.path),
    existing_ui_sections: existingUiSections,
    existing_components_or_functions: [],
    existing_scripts_or_audits: [],
    data_status: matched.some(endpoint => endpoint.status === "TOO_LARGE") ? "TOO_LARGE" : matched.some(endpoint => endpoint.status === "EMPTY_VALID") ? "EMPTY_VALID" : hasEndpoint ? "HAS_DATA_OR_VALID_ENDPOINT" : "NOT_FOUND",
    record_count: recordCount,
    item_count: itemCount,
    valid_json: matched.length ? matched.every(endpoint => endpoint.valid_json !== false) : false,
    startup_safe: matched.some(endpoint => endpoint.startup_safe === true),
    load_strategy: [...new Set(matched.map(endpoint => endpoint.load_strategy).filter(Boolean))].join(",") || "unknown",
    current_visibility: hasUi ? "VISIBLE_OR_REFERENCED" : hasEndpoint ? "HIDDEN_OR_LAZY" : "NOT_VISIBLE",
    implementation_status: status,
    reason_hidden_or_incomplete: hasEndpoint && !hasUi ? "Endpoint exists but no obvious UI section reference was found in dashboard/index.html." : hasEndpoint ? "" : "Only inferred from scripts/docs/env names.",
    business_value: businessValueFor(id),
    recommended_next_action: nextActionFor(status, matched)
  };
}

function businessValueFor(id) {
  if (/quote|revenue|conversion|sales|target|watchlist/.test(id)) return "Direct sales execution and prioritization.";
  if (/fleet|operator|agent/.test(id)) return "Account/fleet level commercial planning.";
  if (/port/.test(id)) return "Port-level prioritization and opportunity sizing.";
  if (/enrichment|source|data/.test(id)) return "Improves confidence, identity coverage, and source utilization.";
  if (/compliance|cleaning|biofouling|risk/.test(id)) return "Turns operational/risk signals into service opportunities.";
  return "Improves dashboard completeness and decision confidence.";
}

function nextActionFor(status, endpoints = []) {
  if (status === "ACTIVE_VISIBLE") return "Keep monitored by audit commands.";
  if (status === "TOO_HEAVY_NEEDS_SUMMARY" || endpoints.some(endpoint => endpoint.status === "TOO_LARGE")) return "Use summary endpoint first and lazy-load detail only on demand.";
  if (status === "EMPTY_VALID") return "Keep valid empty state and trace upstream data availability.";
  if (status === "DEVELOPED_HIDDEN" || status === "ENDPOINT_EXISTS_UI_MISSING") return "Reconnect existing summary endpoint to a collapsed or lazy UI section.";
  if (status === "BROKEN_ENDPOINT") return "Fix JSON generation or endpoint path before surfacing.";
  return "Confirm requirement before implementation.";
}

function sourceStatus(source, statusByKey, qualityByKey, collectionText, scriptsText) {
  const item = statusByKey.get(source.source_key) || statusByKey.get(source.source_key.toLowerCase()) || {};
  const quality = qualityByKey.get(source.source_key) || qualityByKey.get(source.source_key.toLowerCase()) || {};
  const envPresence = source.expected_env_names.reduce((acc, envName) => {
    acc[envName] = collectionText.includes(envName) || scriptsText.includes(envName);
    return acc;
  }, {});
  const rowsCollected = Number(quality.rows_collected ?? item.rows_collected ?? 0);
  const rowsNormalized = Number(quality.rows_normalized ?? item.rows_normalized ?? 0);
  const rowsMatched = Number(quality.rows_matched_to_vessels ?? item.rows_matched_to_vessels ?? item.rows_matched ?? 0);
  const configured = Boolean(quality.configured ?? item.configured ?? Object.values(envPresence).some(Boolean));
  const attempted = Boolean(quality.attempted ?? item.collector_attempted ?? rowsCollected > 0);
  const knownBlocker = quality.blocker_reason || item.skip_reason || item.exact_fix_instruction || item.status || "";
  return {
    ...source,
    present_env_detected_from_status: envPresence,
    collector_exists: scriptsText.includes(source.source_key) || source.expected_env_names.some(env => scriptsText.includes(env)),
    collector_attempted: attempted,
    fetch_status: item.status || quality.quality_label || "UNKNOWN",
    http_status: item.http_status || item.diagnostics?.find?.(diag => diag.http_status)?.http_status || null,
    rows_collected: rowsCollected,
    rows_normalized: rowsNormalized,
    rows_matched_to_vessels: rowsMatched,
    current_utilization: quality.utilization_score ?? 0,
    known_blocker: knownBlocker,
    normalization_status: rowsNormalized > 0 ? "WORKING" : rowsCollected > 0 ? "PARTIAL_OR_BLOCKED" : configured ? "NO_ROWS_OR_NOT_ATTEMPTED" : "NOT_CONFIGURED",
    matching_status: rowsMatched > 0 ? "MATCHED" : rowsNormalized > 0 ? "NORMALIZED_NOT_MATCHED" : "NOT_MATCHED",
    implementation_gap: implementationGap({ configured, attempted, rowsCollected, rowsNormalized, rowsMatched, knownBlocker }),
    recommended_next_action: sourceRecommendedAction(source.source_key, { configured, attempted, rowsCollected, rowsNormalized, rowsMatched, knownBlocker })
  };
}

function implementationGap({ configured, attempted, rowsCollected, rowsNormalized, rowsMatched, knownBlocker }) {
  if (!configured) return "Source is referenced but not configured in current status.";
  if (!attempted) return "Collector exists or env is present but collection was not attempted.";
  if (knownBlocker) return knownBlocker;
  if (rowsCollected <= 0) return "Fetch produced no rows.";
  if (rowsNormalized <= 0) return "Rows collected but not normalized.";
  if (rowsMatched <= 0) return "Rows normalized but not matched to vessels.";
  return "Working; monitor quality and field contribution.";
}

function sourceRecommendedAction(sourceKey, state) {
  if (sourceKey === "source_csv" && /TOO_LARGE|too large|large/i.test(state.knownBlocker)) return "Create a smaller verified vessel reference CSV and preserve previous cache.";
  if (sourceKey === "vessel_spec" && state.rowsCollected > 0 && state.rowsNormalized === 0) return "Add parser aliases based on sanitized raw sample keys.";
  if (/ulsan/.test(sourceKey)) return "Keep deferred as auxiliary; fix exact Ulsan endpoint paths later.";
  if (state.rowsNormalized > 0 && state.rowsMatched === 0) return "Improve exact call sign/name + port/time matching and review queue routing.";
  if (!state.configured) return "Add required URL/key as GitHub Actions secret or variable if this source is still desired.";
  return "Continue targeted enrichment; avoid loading this source on Overview.";
}

function capabilityMatrix(sources) {
  const allFields = Object.entries(FIELD_GROUPS).flatMap(([group, fields]) => fields.map(field => ({ group, field })));
  return sources.flatMap(source => {
    const enrichable = new Set(source.enrichment_fields_possible || []);
    const expected = new Set(source.expected_fields || []);
    return allFields.map(({ group, field }) => {
      const canEnrich = enrichable.has(field) || expected.has(field) || source.enrichment_fields_possible?.some(value => String(value).includes(field));
      return {
        source_key: source.source_key,
        field_group: group,
        field_name: field,
        can_enrich: Boolean(canEnrich),
        current_status: canEnrich
          ? source.rows_matched_to_vessels > 0 ? "WORKING"
            : source.rows_normalized > 0 ? "PARTIAL"
              : source.rows_collected > 0 ? "BLOCKED"
                : source.collector_exists ? "PARTIAL"
                  : "NOT_IMPLEMENTED"
          : "UNKNOWN",
        match_keys: matchKeysFor(source.source_key),
        trust_level: trustLevelFor(source.source_key, field),
        conflict_policy: conflictPolicyFor(source.source_key, field),
        current_blocker: source.known_blocker || source.implementation_gap || "",
        next_required_task: source.recommended_next_action
      };
    });
  });
}

function matchKeysFor(sourceKey) {
  if (/ais|vessel_spec|source_csv/.test(sourceKey)) return ["IMO", "MMSI", "call_sign", "vessel_name"];
  if (/pilot|berth|PNC/.test(sourceKey)) return ["call_sign", "vessel_name", "port", "time_window"];
  if (/port_operation/.test(sourceKey)) return ["call_sign", "vessel_name", "port", "ETA/ATA"];
  if (/facility/.test(sourceKey)) return ["port_code", "berth", "terminal"];
  return ["source-specific key", "manual review"];
}

function trustLevelFor(sourceKey, field) {
  if (sourceKey === "source_csv") return "HIGH if verified=true";
  if (sourceKey === "pilot_sources" && /pilotage|eta|ata|atd|movement/.test(field)) return "HIGH for timing";
  if (/berth|PNC/.test(sourceKey) && /berth|terminal/.test(field)) return "MEDIUM_HIGH";
  if (/mof_ais_info|vessel_spec/.test(sourceKey) && /imo|mmsi|gt|dwt|flag|vessel_type/.test(field)) return "HIGH";
  if (sourceKey === "port_operation") return "HIGH for port/timing, MEDIUM for identity";
  return "MEDIUM";
}

function conflictPolicyFor(sourceKey, field) {
  if (/imo|mmsi/.test(field)) return "Never auto-overwrite non-empty verified/manual identity; review conflicts.";
  if (/operator|owner|manager/.test(field)) return "Use as fallback when empty; review operator conflicts.";
  if (/berth|pilotage|eta|ata|atd/.test(field)) return "Prefer freshest high-confidence timing source; review time/port mismatch.";
  return "Apply only if target field is empty or candidate quality is materially higher.";
}

function technicalRequirements(packageJson, scriptFiles) {
  const auditCommands = Object.keys(packageJson.scripts || {}).filter(name => name.startsWith("audit:") || name.startsWith("discover:") || name.startsWith("plan:")).sort();
  const existingScripts = scriptFiles.filter(file => /audit|discover|plan|validate|update|collector|source|enrichment/.test(file));
  return {
    schema_version: "1.0",
    generated_at: GENERATED_AT,
    sections: {
      data_collection_requirements: [
        "Required env names must be reported as present/missing without secret values.",
        "Collectors need response size guards, retry/timeout policy, fallback cache, and source health logging.",
        "Auxiliary sources must not block core dashboard generation."
      ],
      normalization_requirements: [
        "Maintain field alias maps for Korean/English source labels.",
        "Parse date+time and preserve time-only values without inserting invalid timestamptz.",
        "Normalize vessel name, call sign, port labels, GT/DWT numeric fields."
      ],
      matching_requirements: [
        "Use IMO/MMSI/call_sign exact match first.",
        "Use vessel_name + port + time window for operational sources.",
        "Route fuzzy and low-confidence matches to review queue."
      ],
      enrichment_requirements: [
        "Keep source priority by field group.",
        "Track field-level confidence and data lineage.",
        "Auto-apply only high-confidence missing fields; never overwrite manual/verified values blindly."
      ],
      storage_requirements: [
        "Keep latest successful run and active dataset pointer.",
        "Use source cache retention for auxiliary sources.",
        "Split summary/detail JSON and paginate large vessel endpoints."
      ],
      ui_surfacing_requirements: [
        "Business summaries first; diagnostics separated.",
        "Lazy-load detail endpoints.",
        "Use Korean labels for business-facing fields."
      ],
      validation_audit_requirements: auditCommands
    },
    existing_relevant_scripts: existingScripts,
    referenced_but_missing_audit_commands: [
      "audit:hidden-features",
      "audit:feature-revival"
    ].filter(name => !(packageJson.scripts || {})[name])
  };
}

function roadmap(featureItems, sources, endpoints) {
  const p0 = [
    ...endpoints.filter(endpoint => endpoint.valid_json === false || endpoint.schema_valid === false).map(endpoint => `Fix broken endpoint ${endpoint.path}`),
    ...endpoints.filter(endpoint => endpoint.startup_safe && Number(endpoint.bytes || 0) > 150 * 1024).map(endpoint => `Remove heavy startup endpoint ${endpoint.path}`),
    ...endpoints.filter(endpoint => endpoint.status === "STALE").slice(0, 10).map(endpoint => `Refresh stale endpoint ${endpoint.path}`)
  ];
  const p1 = featureItems
    .filter(feature => ["DEVELOPED_HIDDEN", "ENDPOINT_EXISTS_UI_MISSING"].includes(feature.implementation_status) && feature.record_count > 0)
    .slice(0, 20)
    .map(feature => `Reconnect ${feature.feature_name} (${feature.existing_endpoint_paths[0] || "endpoint"})`);
  const p2 = sources
    .filter(source => /NORMALIZED_NOT_MATCHED|Rows normalized but not matched|Rows collected but not normalized|PARTIAL_OR_BLOCKED/.test(`${source.matching_status} ${source.implementation_gap} ${source.normalization_status}`))
    .map(source => `Improve ${source.source_key}: ${source.implementation_gap}`);
  const p3 = featureItems
    .filter(feature => /quote|conversion|fleet|revenue|cleaning|compliance|memory|watchlist/.test(feature.feature_id))
    .slice(0, 20)
    .map(feature => `Surface/validate commercial intelligence: ${feature.feature_name}`);
  const p4 = [
    "Map/heatmap and port click-through polish",
    "Mobile card density and advanced diagnostics separation",
    "Navigation cleanup after hidden feature decisions"
  ];
  return {
    schema_version: "1.0",
    generated_at: GENERATED_AT,
    priorities: [
      { priority: 0, title: "Safety / consistency", items: p0.length ? p0 : ["No critical broken JSON detected in current manifest."] },
      { priority: 1, title: "Revive existing value", items: p1.length ? p1 : ["No data-bearing hidden feature candidates detected by heuristic."] },
      { priority: 2, title: "Enrichment utilization", items: p2.length ? p2 : ["Keep monitoring source normalization and matching."] },
      { priority: 3, title: "Commercial intelligence", items: p3 },
      { priority: 4, title: "Operational polish", items: p4 }
    ]
  };
}

function markdownTable(headers, rowsIn) {
  const header = `| ${headers.join(" | ")} |`;
  const sep = `| ${headers.map(() => "---").join(" | ")} |`;
  const rowsText = rowsIn.map(row => `| ${row.map(value => String(value ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ")).join(" | ")} |`);
  return [header, sep, ...rowsText].join("\n");
}

function main() {
  ensureDir(OUT_DIR);
  ensureDir(DOC_DIR);

  const endpointManifest = readJson("dashboard/api/endpoint-manifest.json", { endpoints: [] });
  const bootstrap = readJson("dashboard/api/bootstrap.json", {});
  const sourceCollectionStatus = readJson("dashboard/api/source-collection-status.json", { items: [] });
  const sourceQualityScore = readJson("dashboard/api/source-quality-score.json", { items: [] });
  const packageJson = readJson("package.json", { scripts: {} });
  const discoveryRunId = endpointManifest.run_id || bootstrap.run_id || null;
  const dashboardHtml = readText("dashboard/index.html");
  const scriptFiles = listFiles("scripts", file => file.endsWith(".js"));
  const docFiles = listFiles("docs", file => /\.(md|txt)$/i.test(file)).slice(0, 250);
  const workflowFiles = listFiles(".github", file => /\.(yml|yaml)$/i.test(file));
  const scriptsText = scriptFiles.map(file => readText(file)).join("\n");
  const docsText = docFiles.map(file => readText(file)).join("\n");
  const workflowText = workflowFiles.map(file => readText(file)).join("\n");
  const collectionText = JSON.stringify(sourceCollectionStatus);

  const ui = discoverUiReferences(dashboardHtml);
  const uiEndpointSet = new Set(ui.endpoints);
  const endpoints = (endpointManifest.endpoints || []).map(endpoint => {
    const current_visibility = endpointVisibility(endpoint, uiEndpointSet);
    return {
      ...endpoint,
      endpoint_classification: classifyEndpoint(endpoint.path || ""),
      current_ui_mapping: uiEndpointSet.has(endpoint.path) ? "dashboard/index.html direct reference" : "",
      hidden_status: endpointStatus(endpoint, current_visibility),
      current_visibility
    };
  });

  const features = PRODUCT_FEATURE_HINTS.map(hint => featureFromHint(hint, endpoints, ui));
  const endpointDerivedFeatures = endpoints
    .filter(endpoint => endpoint.record_count > 0 && !features.some(feature => feature.existing_endpoint_paths.includes(endpoint.path)))
    .slice(0, 120)
    .map(endpoint => ({
      feature_id: normalizeId(endpoint.path),
      feature_name: endpoint.key || normalizeId(endpoint.path),
      product_area: productArea(endpoint.endpoint_classification === "Diagnostic" ? "system" : endpoint.endpoint_classification.includes("Port") || endpoint.endpoint_classification.includes("Fleet") ? "portFleet" : endpoint.endpoint_classification.includes("Vessel") ? "vessel" : endpoint.endpoint_classification.includes("Sales") || endpoint.endpoint_classification.includes("Target") ? "sales" : "overview"),
      discovery_source: "endpoint-manifest",
      existing_endpoint_paths: [endpoint.path],
      existing_ui_sections: endpoint.current_ui_mapping ? [endpoint.current_ui_mapping] : [],
      existing_components_or_functions: [],
      existing_scripts_or_audits: [],
      data_status: endpoint.status,
      record_count: endpoint.record_count,
      item_count: endpoint.item_count,
      valid_json: endpoint.valid_json,
      startup_safe: endpoint.startup_safe,
      load_strategy: endpoint.load_strategy,
      current_visibility: endpoint.current_visibility,
      implementation_status: endpoint.hidden_status,
      reason_hidden_or_incomplete: endpoint.current_visibility === "HIDDEN_OR_LAZY" ? "Endpoint has data but no direct UI endpoint reference found." : "",
      business_value: businessValueFor(endpoint.path),
      recommended_next_action: nextActionFor(endpoint.hidden_status, [endpoint])
    }));
  const featureItems = [...features, ...endpointDerivedFeatures];

  const statusByKey = new Map((sourceCollectionStatus.items || []).map(item => [item.source_key, item]));
  const qualityByKey = new Map((sourceQualityScore.items || []).map(item => [item.source_key, item]));
  const sources = SOURCE_DEFINITIONS.map(source => sourceStatus(source, statusByKey, qualityByKey, collectionText, `${scriptsText}\n${docsText}\n${workflowText}`));

  const capabilityItems = capabilityMatrix(sources);
  const technical = technicalRequirements(packageJson, scriptFiles);
  const roadmapPayload = withDiscoveryTierMetadata(roadmap(featureItems, sources, endpoints), discoveryRunId);
  const discussed = featureItems
    .filter(feature => ["DISCUSSED_NOT_IMPLEMENTED", "PARTIAL_IMPLEMENTATION", "UI_PLACEHOLDER_ONLY"].includes(feature.implementation_status))
    .map(feature => ({
      feature_id: feature.feature_id,
      evidence_found: feature.discovery_source,
      current_status: feature.implementation_status,
      missing_pieces: feature.reason_hidden_or_incomplete || "Needs confirmation.",
      business_value: feature.business_value,
      implementation_risk: feature.existing_endpoint_paths.length ? "LOW_MEDIUM" : "MEDIUM_HIGH",
      recommended_phase: feature.existing_endpoint_paths.length ? "Priority 1" : "Priority 3/4"
    }));

  const hiddenPayload = withDiscoveryTierMetadata({
    schema_version: "1.0",
    generated_at: GENERATED_AT,
    run_id: discoveryRunId,
    feature_count: featureItems.length,
    endpoint_count: endpoints.length,
    hidden_feature_count: featureItems.filter(feature => ["DEVELOPED_HIDDEN", "ENDPOINT_EXISTS_UI_MISSING"].includes(feature.implementation_status)).length,
    partial_api_count: sources.filter(source => /PARTIAL|BLOCKED|NOT_MATCHED|NOT_CONFIGURED/.test(`${source.normalization_status} ${source.matching_status}`)).length,
    discussed_not_implemented_count: discussed.length,
    features: featureItems,
    endpoints,
    ui_placeholders: ui.placeholders,
    source_apis: sources,
    discussed_not_implemented: discussed
  }, discoveryRunId);

  const capabilityPayload = withDiscoveryTierMetadata({
    schema_version: "1.0",
    generated_at: GENERATED_AT,
    run_id: discoveryRunId,
    source_count: sources.length,
    field_mapping_count: capabilityItems.length,
    sources,
    items: capabilityItems
  }, discoveryRunId);

  const technicalPayload = withDiscoveryTierMetadata({
    ...technical,
    run_id: discoveryRunId,
    source_api_count: sources.length,
    endpoint_count: endpoints.length,
    npm_commands: Object.keys(packageJson.scripts || {}).sort()
  }, discoveryRunId);

  const indexPayload = withDiscoveryTierMetadata({
    schema_version: "1.0",
    generated_at: GENERATED_AT,
    run_id: discoveryRunId,
    files_generated: [
      "docs/HIDDEN_FEATURE_AND_API_DISCOVERY.md",
      "docs/SOURCE_ENRICHMENT_CAPABILITY_MATRIX.md",
      "docs/TECHNICAL_REQUIREMENTS_DISCOVERY.md",
      "docs/DISCOVERY_ROADMAP.md",
      "dashboard/api/discovery/hidden-feature-and-api-discovery.json",
      "dashboard/api/discovery/source-enrichment-capability-matrix.json",
      "dashboard/api/discovery/technical-requirements-discovery.json",
      "dashboard/api/discovery/discovery-roadmap.json"
    ],
    feature_count: hiddenPayload.feature_count,
    source_count: sources.length,
    hidden_feature_count: hiddenPayload.hidden_feature_count,
    partial_api_count: hiddenPayload.partial_api_count,
    discussed_not_implemented_count: hiddenPayload.discussed_not_implemented_count,
    priority_0_count: roadmapPayload.priorities.find(item => item.priority === 0)?.items.length || 0,
    priority_1_count: roadmapPayload.priorities.find(item => item.priority === 1)?.items.length || 0,
    priority_2_count: roadmapPayload.priorities.find(item => item.priority === 2)?.items.length || 0
  }, discoveryRunId);

  writeJson("dashboard/api/discovery/hidden-feature-and-api-discovery.json", hiddenPayload);
  writeJson("dashboard/api/discovery/source-enrichment-capability-matrix.json", capabilityPayload);
  writeJson("dashboard/api/discovery/technical-requirements-discovery.json", technicalPayload);
  writeJson("dashboard/api/discovery/discovery-roadmap.json", roadmapPayload);
  writeJson("dashboard/api/discovery/index.json", indexPayload);

  writeMarkdown("docs/HIDDEN_FEATURE_AND_API_DISCOVERY.md", [
    "# Hidden Feature and API Discovery",
    "",
    `Generated at: ${GENERATED_AT}`,
    `Run id: ${indexPayload.run_id || "-"}`,
    "",
    "## Summary",
    "",
    markdownTable(["Metric", "Value"], [
      ["Feature count", hiddenPayload.feature_count],
      ["Endpoint count", hiddenPayload.endpoint_count],
      ["Hidden feature count", hiddenPayload.hidden_feature_count],
      ["Partial API/source count", hiddenPayload.partial_api_count],
      ["Discussed but not implemented count", hiddenPayload.discussed_not_implemented_count]
    ]),
    "",
    "## Feature Inventory",
    "",
    markdownTable(
      ["Feature", "Area", "Status", "Records", "Visibility", "Endpoints", "Next Action"],
      featureItems.slice(0, 120).map(feature => [
        feature.feature_name,
        feature.product_area,
        feature.implementation_status,
        feature.record_count,
        feature.current_visibility,
        feature.existing_endpoint_paths.slice(0, 3).join(", ") || "-",
        feature.recommended_next_action
      ])
    ),
    "",
    "## UI Placeholders / Hidden Markers",
    "",
    ui.placeholders.length
      ? markdownTable(["Marker", "Reason", "Recommended Action"], ui.placeholders.slice(0, 80).map(item => [item.section_title, item.reason_not_visible, item.recommended_reconnect_action]))
      : "No obvious placeholder markers found.",
    "",
    "## Endpoint Classes",
    "",
    markdownTable(
      ["Path", "Class", "Status", "Records", "Items", "Size KB", "Startup", "Load"],
      endpoints.slice(0, 160).map(endpoint => [endpoint.path, endpoint.endpoint_classification, endpoint.status, endpoint.record_count, endpoint.item_count, endpoint.size_kb, endpoint.startup_safe ? "yes" : "no", endpoint.load_strategy])
    )
  ].join("\n"));

  writeMarkdown("docs/SOURCE_ENRICHMENT_CAPABILITY_MATRIX.md", [
    "# Source Enrichment Capability Matrix",
    "",
    `Generated at: ${GENERATED_AT}`,
    "",
    "## Source Status",
    "",
    markdownTable(
      ["Source", "Configured/Attempted", "Rows", "Normalized", "Matched", "Normalization", "Matching", "Blocker", "Next Action"],
      sources.map(source => [
        source.source_key,
        `${source.present_env_detected_from_status ? "env-ref" : "-"} / ${source.collector_attempted ? "attempted" : "not attempted"}`,
        source.rows_collected,
        source.rows_normalized,
        source.rows_matched_to_vessels,
        source.normalization_status,
        source.matching_status,
        source.known_blocker || "-",
        source.recommended_next_action
      ])
    ),
    "",
    "## Field Capability Matrix",
    "",
    markdownTable(
      ["Source", "Field", "Can Enrich", "Status", "Match Keys", "Trust", "Conflict Policy", "Next Task"],
      capabilityItems.filter(item => item.can_enrich).slice(0, 220).map(item => [
        item.source_key,
        item.field_name,
        item.can_enrich ? "yes" : "no",
        item.current_status,
        item.match_keys.join(", "),
        item.trust_level,
        item.conflict_policy,
        item.next_required_task
      ])
    )
  ].join("\n"));

  writeMarkdown("docs/TECHNICAL_REQUIREMENTS_DISCOVERY.md", [
    "# Technical Requirements Discovery",
    "",
    `Generated at: ${GENERATED_AT}`,
    "",
    "## Requirements",
    "",
    ...Object.entries(technicalPayload.sections).flatMap(([section, values]) => [
      `### ${section.replace(/_/g, " ")}`,
      "",
      ...(Array.isArray(values) ? values.map(value => `- ${value}`) : []),
      ""
    ]),
    "## Existing Audit / Discovery Commands",
    "",
    markdownTable(["Command"], technicalPayload.sections.validation_audit_requirements.map(command => [command])),
    "",
    "## Referenced But Missing Commands",
    "",
    technicalPayload.referenced_but_missing_audit_commands.length
      ? technicalPayload.referenced_but_missing_audit_commands.map(command => `- ${command}`).join("\n")
      : "- none"
  ].join("\n"));

  writeMarkdown("docs/DISCOVERY_ROADMAP.md", [
    "# Discovery Roadmap",
    "",
    `Generated at: ${GENERATED_AT}`,
    "",
    ...roadmapPayload.priorities.flatMap(priority => [
      `## Priority ${priority.priority}: ${priority.title}`,
      "",
      ...priority.items.map(item => `- ${item}`),
      ""
    ])
  ].join("\n"));

  console.log("# Feature & API Discovery");
  console.log("");
  console.log("Item | Area | Evidence | Status | Blocker | Next Action");
  console.log("--- | --- | --- | --- | --- | ---");
  for (const feature of featureItems.slice(0, 30)) {
    console.log([
      feature.feature_name,
      feature.product_area,
      feature.discovery_source,
      feature.implementation_status,
      feature.reason_hidden_or_incomplete || feature.data_status || "-",
      feature.recommended_next_action
    ].join(" | "));
  }
  console.log("");
  console.log("1. Feature inventory summary");
  console.log(`- features=${hiddenPayload.feature_count}, hidden=${hiddenPayload.hidden_feature_count}, endpoints=${hiddenPayload.endpoint_count}`);
  console.log("2. Hidden developed features");
  console.log(`- ${hiddenPayload.hidden_feature_count}`);
  console.log("3. UI placeholders with data");
  console.log(`- placeholders=${ui.placeholders.length}`);
  console.log("4. Existing source APIs");
  console.log(`- sources=${sources.length}`);
  console.log("5. API/source blockers");
  console.log(`- partial_or_blocked=${hiddenPayload.partial_api_count}`);
  console.log("6. Enrichment capability matrix");
  console.log(`- field_mappings=${capabilityPayload.field_mapping_count}`);
  console.log("7. Technical requirements discovered");
  console.log(`- npm_commands=${technicalPayload.npm_commands.length}`);
  console.log("8. Discussed but not implemented");
  console.log(`- ${hiddenPayload.discussed_not_implemented_count}`);
  console.log("9. Recommended next phases");
  console.log(`- P0=${indexPayload.priority_0_count}, P1=${indexPayload.priority_1_count}, P2=${indexPayload.priority_2_count}`);
}

main();
