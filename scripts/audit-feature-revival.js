#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const DASHBOARD_HTML = "dashboard/index.html";
const PLAN_JSON = "dashboard/api/feature-revival-plan.json";
const PLAN_MD = "docs/FEATURE_REVIVAL_PLAN.md";

const FEATURE_DEFINITIONS = [
  {
    priority: 1,
    feature_name: "오늘의 영업 액션",
    endpoint_path: "dashboard/api/sales/actions-summary.json",
    detail_endpoint_path: "dashboard/api/sales/actions.json",
    existing_ui_section: "오늘의 영업 우선순위 / 영업 액션 인사이트",
    existing_component: "salesPriorityList, INTELLIGENCE_ENDPOINTS.salesActions",
    ui_needles: ["salesPriorityList", "salesActions", "/api/sales/actions-summary.json"],
    expected_payload: "summary endpoint; detail remains lazy"
  },
  {
    priority: 1,
    feature_name: "영업 대상 / targets.current",
    endpoint_path: "dashboard/api/targets/current-summary.json",
    detail_endpoint_path: "dashboard/api/targets/current.json",
    existing_ui_section: "영업 대상 카테고리",
    existing_component: "targetCategoryCards, loadTargetCategoryItems",
    ui_needles: ["targetCategoryCards", "loadTargetCategoryItems"],
    expected_payload: "bootstrap/category summary on first view; detail lazy on category click"
  },
  {
    priority: 1,
    feature_name: "견적 기회",
    endpoint_path: "dashboard/api/sales/quote-opportunities.json",
    existing_ui_section: "견적·관심·후속 영업",
    existing_component: "INTELLIGENCE_ENDPOINTS.quoteOpportunities, renderQuoteOpportunityItem",
    ui_needles: ["quoteOpportunities", "renderQuoteOpportunityItem"],
    expected_payload: "top quote opportunity items"
  },
  {
    priority: 1,
    feature_name: "검증 큐",
    endpoint_path: "dashboard/api/sales/verification-queue-summary.json",
    detail_endpoint_path: "dashboard/api/sales/verification-queue.json",
    existing_ui_section: "견적·관심·후속 영업",
    existing_component: "INTELLIGENCE_ENDPOINTS.verificationQueueSummary",
    ui_needles: ["verificationQueueSummary", "/api/sales/verification-queue-summary.json"],
    expected_payload: "summary endpoint only; heavy detail lazy"
  },
  {
    priority: 1,
    feature_name: "관심 선박",
    endpoint_path: "dashboard/api/watchlist/current.json",
    existing_ui_section: "관심 선박",
    existing_component: "watchlistRows, renderWatchlist",
    ui_needles: ["watchlistRows", "renderWatchlist", "/api/watchlist/current.json"],
    expected_payload: "top 20 watchlist items"
  },
  {
    priority: 1,
    feature_name: "영업 카테고리",
    endpoint_path: "dashboard/api/targets/categories-summary.json",
    detail_endpoint_path: "dashboard/api/targets/categories.json",
    existing_ui_section: "영업 대상 카테고리",
    existing_component: "targetCategoryCards, TARGET_CATEGORY_UI",
    ui_needles: ["targetCategoryCards", "TARGET_CATEGORY_UI"],
    expected_payload: "summary counts; detail lazy on click"
  },
  {
    priority: 2,
    feature_name: "항만 요약",
    endpoint_path: "dashboard/api/ports.json",
    existing_ui_section: "항만 인텔리전스",
    existing_component: "ports, renderPorts",
    ui_needles: ["renderPorts", "/api/ports.json"],
    expected_payload: "port summary cards"
  },
  {
    priority: 2,
    feature_name: "Port DNA",
    endpoint_path: "dashboard/api/intelligence/port-dna.json",
    existing_ui_section: "항만 인텔리전스",
    existing_component: "INTELLIGENCE_ENDPOINTS.portDna",
    ui_needles: ["portDna", "/api/intelligence/port-dna.json"],
    expected_payload: "lazy insight cards"
  },
  {
    priority: 2,
    feature_name: "Fleet Intelligence",
    endpoint_path: "dashboard/api/intelligence/fleet-intelligence.json",
    existing_ui_section: "선대 / 운영사 인텔리전스",
    existing_component: "INTELLIGENCE_ENDPOINTS.fleet",
    ui_needles: ["fleet-intelligence.json", "fleet"],
    expected_payload: "lazy operator/fleet cards"
  },
  {
    priority: 2,
    feature_name: "Fleet Penetration",
    endpoint_path: "dashboard/api/intelligence/fleet-penetration.json",
    existing_ui_section: "선대 / 운영사 인텔리전스",
    existing_component: "INTELLIGENCE_ENDPOINTS.fleetPenetration",
    ui_needles: ["fleetPenetration", "/api/intelligence/fleet-penetration.json"],
    expected_payload: "lazy fleet penetration cards"
  },
  {
    priority: 2,
    feature_name: "Revenue Forecast",
    endpoint_path: "dashboard/api/intelligence/revenue-forecast.json",
    existing_ui_section: "예상 매출 / 기회",
    existing_component: "INTELLIGENCE_ENDPOINTS.revenueForecast",
    ui_needles: ["revenueForecast", "/api/intelligence/revenue-forecast.json"],
    expected_payload: "lazy revenue forecast cards"
  },
  {
    priority: 3,
    feature_name: "Cleaning Window",
    endpoint_path: "dashboard/api/intelligence/cleaning-window.json",
    existing_ui_section: "리스크 / Compliance",
    existing_component: "INTELLIGENCE_ENDPOINTS.cleaningWindow",
    ui_needles: ["cleaningWindow", "/api/intelligence/cleaning-window.json"],
    expected_payload: "lazy risk cards"
  },
  {
    priority: 3,
    feature_name: "Compliance Exposure",
    endpoint_path: "dashboard/api/intelligence/compliance-exposure.json",
    existing_ui_section: "리스크 / Compliance",
    existing_component: "INTELLIGENCE_ENDPOINTS.complianceExposure",
    ui_needles: ["complianceExposure", "/api/intelligence/compliance-exposure.json"],
    expected_payload: "lazy compliance cards"
  },
  {
    priority: 3,
    feature_name: "Contact Coverage",
    endpoint_path: "dashboard/api/intelligence/contact-coverage-summary.json",
    detail_endpoint_path: "dashboard/api/intelligence/contact-coverage.json",
    existing_ui_section: "영업 인텔리전스",
    existing_component: "INTELLIGENCE_ENDPOINTS.contactCoverage, renderContactCoverageCard",
    ui_needles: ["contactCoverage", "/api/intelligence/contact-coverage-summary.json"],
    expected_payload: "summary endpoint only; heavy detail lazy"
  },
  {
    priority: 3,
    feature_name: "Opportunity Memory",
    endpoint_path: "dashboard/api/intelligence/opportunity-memory.json",
    existing_ui_section: "영업 인텔리전스",
    existing_component: "INTELLIGENCE_ENDPOINTS.opportunityMemory",
    ui_needles: ["opportunityMemory", "/api/intelligence/opportunity-memory.json"],
    expected_payload: "lazy repeat opportunity cards"
  },
  {
    priority: 4,
    feature_name: "Pilotage Summary",
    endpoint_path: "dashboard/api/aux/pilotage-summary.json",
    existing_ui_section: "데이터 소스·Enrichment",
    existing_component: "INTELLIGENCE_ENDPOINTS.pilotageSummary",
    ui_needles: ["pilotageSummary", "/api/aux/pilotage-summary.json"],
    expected_payload: "small auxiliary summary"
  },
  {
    priority: 4,
    feature_name: "Berth / PNC Summary",
    endpoint_path: "dashboard/api/aux/berth-summary.json",
    existing_ui_section: "데이터 소스·Enrichment",
    existing_component: "INTELLIGENCE_ENDPOINTS.berthSummary",
    ui_needles: ["berthSummary", "/api/aux/berth-summary.json"],
    expected_payload: "small auxiliary summary"
  },
  {
    priority: 4,
    feature_name: "AIS Info Summary",
    endpoint_path: "dashboard/api/aux/ais-info-summary.json",
    existing_ui_section: "데이터 소스·Enrichment",
    existing_component: "INTELLIGENCE_ENDPOINTS.aisInfoSummary",
    ui_needles: ["aisInfoSummary", "/api/aux/ais-info-summary.json"],
    expected_payload: "small auxiliary summary"
  },
  {
    priority: 4,
    feature_name: "Vessel Spec Summary",
    endpoint_path: "dashboard/api/aux/vessel-spec-summary.json",
    existing_ui_section: "데이터 소스·Enrichment",
    existing_component: "INTELLIGENCE_ENDPOINTS.vesselSpecSummary",
    ui_needles: ["vesselSpecSummary", "/api/aux/vessel-spec-summary.json"],
    expected_payload: "small auxiliary summary"
  },
  {
    priority: 4,
    feature_name: "Source CSV Summary",
    endpoint_path: "dashboard/api/aux/source-csv-summary.json",
    existing_ui_section: "데이터 소스·Enrichment",
    existing_component: "INTELLIGENCE_ENDPOINTS.sourceCsvSummary",
    ui_needles: ["sourceCsvSummary", "/api/aux/source-csv-summary.json"],
    expected_payload: "small auxiliary summary"
  }
];

function abs(relativePath) {
  return path.join(ROOT, ...relativePath.split("/"));
}

function readText(relativePath) {
  try {
    return fs.existsSync(abs(relativePath)) ? fs.readFileSync(abs(relativePath), "utf8") : "";
  } catch {
    return "";
  }
}

function readJson(relativePath) {
  try {
    if (!fs.existsSync(abs(relativePath))) return { exists: false, payload: null, error: null, size: 0 };
    return {
      exists: true,
      payload: JSON.parse(fs.readFileSync(abs(relativePath), "utf8")),
      error: null,
      size: fs.statSync(abs(relativePath)).size
    };
  } catch (error) {
    return {
      exists: true,
      payload: null,
      error: error.message,
      size: fs.existsSync(abs(relativePath)) ? fs.statSync(abs(relativePath)).size : 0
    };
  }
}

function writeJson(relativePath, payload) {
  const file = abs(relativePath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function writeText(relativePath, text) {
  const file = abs(relativePath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, "utf8");
}

function items(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.ports)) return payload.ports;
  if (Array.isArray(payload?.categories)) return payload.categories;
  if (Array.isArray(payload?.vessels)) return payload.vessels;
  if (Array.isArray(payload?.opportunities)) return payload.opportunities;
  return [];
}

function recordCount(payload) {
  const direct = Number(payload?.record_count ?? payload?.total_count ?? payload?.total_item_count);
  return Number.isFinite(direct) ? direct : items(payload).length;
}

function endpointHasData(payload) {
  if (!payload || typeof payload !== "object") return false;
  return recordCount(payload) > 0 || items(payload).length > 0 || ["ACTIVE", "SOURCE_TOO_LARGE"].includes(String(payload.status || "").toUpperCase());
}

function uiVisible(html, needles) {
  return needles.some(needle => html.includes(needle));
}

function currentStatus({ exists, error, hasData, visible }) {
  if (!exists) return "MISSING_ENDPOINT";
  if (error) return "BROKEN";
  if (!hasData) return visible ? "EMPTY_VISIBLE" : "EMPTY_HIDDEN";
  return visible ? "ACTIVE" : "HIDDEN_WITH_DATA";
}

function revivalAction({ status, size, feature }) {
  if (status === "MISSING_ENDPOINT") return "Keep placeholder; endpoint is missing.";
  if (status === "BROKEN") return "Repair JSON endpoint before UI connection.";
  if (status === "ACTIVE") return "RESTORE/monitor: already connected to existing UI.";
  if (status === "EMPTY_VISIBLE") return "Keep section collapsed and show clear empty reason.";
  if (status === "EMPTY_HIDDEN") return "Do not surface yet; endpoint is valid but empty.";
  if (size > 500 * 1024) return "Use summary endpoint only; keep detail lazy.";
  if (feature.detail_endpoint_path) return "RECONNECT summary endpoint and lazy-load detail only on click.";
  return "RECONNECT existing insight/card section to endpoint.";
}

function riskFor({ status, size }) {
  if (status === "BROKEN") return "HIGH";
  if (status === "MISSING_ENDPOINT") return "MEDIUM";
  if (size > 500 * 1024) return "MEDIUM";
  return "LOW";
}

function markdownTable(headers, rows) {
  const header = `| ${headers.join(" | ")} |`;
  const sep = `| ${headers.map(() => "---").join(" | ")} |`;
  const body = rows.map(row => `| ${headers.map(h => String(row[h] ?? "-").replace(/\n/g, " ")).join(" | ")} |`);
  return [header, sep, ...body].join("\n");
}

const html = readText(DASHBOARD_HTML);
const generatedAt = new Date().toISOString();

const features = FEATURE_DEFINITIONS.map(feature => {
  const endpoint = readJson(feature.endpoint_path);
  const hasData = endpoint.exists && !endpoint.error && endpointHasData(endpoint.payload);
  const visible = uiVisible(html, feature.ui_needles);
  const status = currentStatus({ exists: endpoint.exists, error: endpoint.error, hasData, visible });
  const sizeKb = Math.round((endpoint.size / 1024) * 10) / 10;
  return {
    feature_name: feature.feature_name,
    current_status: status,
    endpoint_path: feature.endpoint_path,
    detail_endpoint_path: feature.detail_endpoint_path || null,
    endpoint_has_data: hasData,
    record_count: endpoint.payload && !endpoint.error ? recordCount(endpoint.payload) : 0,
    size_kb: sizeKb,
    existing_ui_section: feature.existing_ui_section,
    existing_component: feature.existing_component,
    revival_action: revivalAction({ status, size: endpoint.size, feature }),
    risk: riskFor({ status, size: endpoint.size }),
    expected_payload: feature.expected_payload,
    priority: feature.priority
  };
});

const revivedFeatures = features.filter(feature => feature.current_status === "ACTIVE" && /summary|pilotageSummary|berthSummary|sourceCsvSummary|aisInfoSummary|vesselSpecSummary|verificationQueueSummary/.test(feature.existing_component));
const hiddenWithData = features.filter(feature => feature.current_status === "HIDDEN_WITH_DATA");
const heavyLazy = features.filter(feature => feature.size_kb > 500 || feature.detail_endpoint_path);
const duplicateRisks = features.filter(feature => feature.feature_name.includes("카테고리") && feature.current_status === "ACTIVE")
  .map(feature => `${feature.feature_name}: already has a dedicated section; do not add duplicate insight card.`);

const plan = {
  schema_version: "1.0",
  generated_at: generatedAt,
  source_documents: [
    "docs/HIDDEN_FEATURE_AND_API_DISCOVERY.md",
    "dashboard/api/discovery/hidden-feature-and-api-discovery.json",
    "docs/ENRICHMENT_VERIFICATION_REPORT.md"
  ],
  record_count: features.length,
  summary: {
    already_visible_features: features.filter(feature => feature.current_status === "ACTIVE").length,
    revived_features: revivedFeatures.length,
    hidden_features_with_data: hiddenWithData.length,
    heavy_endpoints_kept_lazy: heavyLazy.length,
    duplicate_risk_count: duplicateRisks.length
  },
  features,
  hidden_features_with_data: hiddenWithData.map(feature => feature.feature_name),
  heavy_endpoints_kept_lazy: heavyLazy.map(feature => ({
    feature_name: feature.feature_name,
    endpoint_path: feature.endpoint_path,
    detail_endpoint_path: feature.detail_endpoint_path,
    size_kb: feature.size_kb
  })),
  duplicate_risks: duplicateRisks,
  recommended_next_actions: [
    "Keep Overview on bootstrap/status-summary only.",
    "Use sales/actions-summary, verification-queue-summary, and contact-coverage-summary for cards.",
    "Keep heavy detail endpoints lazy-loaded from existing click/expand flows.",
    "Do not add duplicate cards for target categories or watchlist because dedicated sections already exist."
  ]
};

writeJson(PLAN_JSON, plan);

const mdRows = features.map(feature => ({
  Feature: feature.feature_name,
  Status: feature.current_status,
  Endpoint: feature.endpoint_path,
  Records: feature.record_count,
  UI: feature.existing_ui_section,
  Action: feature.revival_action,
  Risk: feature.risk,
  Priority: feature.priority
}));

writeText(PLAN_MD, `# Feature Revival Plan

Generated at: ${generatedAt}

This plan restores existing dashboard functionality by reconnecting already-developed endpoints to existing sections. It avoids duplicate components and keeps heavy detail endpoints lazy.

## Summary

- Already visible features: ${plan.summary.already_visible_features}
- Revived / reconnected features: ${plan.summary.revived_features}
- Hidden features with data: ${plan.summary.hidden_features_with_data}
- Heavy endpoints kept lazy: ${plan.summary.heavy_endpoints_kept_lazy}
- Duplicate risks: ${plan.summary.duplicate_risk_count}

## Revival Matrix

${markdownTable(["Feature", "Status", "Endpoint", "Records", "UI", "Action", "Risk", "Priority"], mdRows)}

## Heavy Endpoints Kept Lazy

${plan.heavy_endpoints_kept_lazy.length ? plan.heavy_endpoints_kept_lazy.map(item => `- ${item.feature_name}: ${item.detail_endpoint_path || item.endpoint_path} (${item.size_kb} KB)`).join("\n") : "- none"}

## Duplicate Risks

${plan.duplicate_risks.length ? plan.duplicate_risks.map(item => `- ${item}`).join("\n") : "- none"}

## Next Actions

${plan.recommended_next_actions.map(item => `- ${item}`).join("\n")}
`);

console.log("Feature Revival Audit");
console.log("=====================");
console.log("Feature | Endpoint | Record Count | UI Section | Visible | Status | Problem");
for (const feature of features) {
  const visible = feature.current_status === "ACTIVE" ? "yes" : "no";
  const problem = feature.current_status === "ACTIVE" ? "-" : feature.revival_action;
  console.log(`${feature.feature_name} | ${feature.endpoint_path} | ${feature.record_count} | ${feature.existing_ui_section} | ${visible} | ${feature.current_status} | ${problem}`);
}

console.log("");
console.log(`already_visible_features=${plan.summary.already_visible_features}`);
console.log(`revived_features=${plan.summary.revived_features}`);
console.log(`hidden_features_with_data=${plan.summary.hidden_features_with_data}`);
console.log(`heavy_endpoints_kept_lazy=${plan.summary.heavy_endpoints_kept_lazy}`);
console.log(`duplicate_risks=${plan.summary.duplicate_risk_count}`);
console.log(`plan=${PLAN_JSON}`);
console.log(`doc=${PLAN_MD}`);
