#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const DASHBOARD_HTML = "dashboard/index.html";
const PLAN_JSON = "dashboard/api/feature-revival-plan.json";
const PLAN_MD = "docs/FEATURE_REVIVAL_PLAN.md";
const MANIFEST_JSON = "dashboard/api/endpoint-manifest.json";
const HEAVY_BYTES = 500 * 1024;

const SOURCE_REPORTS = [
  "docs/HIDDEN_FEATURE_AND_API_DISCOVERY.md",
  "dashboard/api/discovery/hidden-feature-and-api-discovery.json",
  "docs/FEATURE_REVIVAL_PLAN.md",
  "dashboard/api/feature-revival-plan.json",
  "docs/VESSEL_DISPLAY_PROPAGATION_REPORT.md",
  "dashboard/api/enrichment/vessel-display-propagation-report.json"
];

const FEATURE_DEFINITIONS = [
  {
    priority: 1,
    feature_name: "Today Sales Actions",
    product_area: "Sales Execution",
    endpoint_path: "dashboard/api/sales/actions-summary.json",
    detail_endpoint_path: "dashboard/api/sales/actions.json",
    existing_ui_section: "Today Sales Actions",
    existing_component: "salesPriorityList, INTELLIGENCE_ENDPOINTS.salesActions",
    ui_needles: ["salesPriorityList", "salesActions", "/api/sales/actions-summary.json"],
    expected_payload: "small sales action summary; full action list stays lazy"
  },
  {
    priority: 1,
    feature_name: "Sales Targets",
    product_area: "Sales Execution",
    endpoint_path: "dashboard/api/targets/current-summary.json",
    detail_endpoint_path: "dashboard/api/targets/current.json",
    existing_ui_section: "Target Categories",
    existing_component: "targetCategoryCards, loadTargetCategoryItems",
    ui_needles: ["targetCategoryCards", "loadTargetCategoryItems"],
    expected_payload: "summary counts in dashboard; target detail lazy on selection"
  },
  {
    priority: 1,
    feature_name: "Quote Opportunities",
    product_area: "Sales Execution",
    endpoint_path: "dashboard/api/sales/quote-opportunities.json",
    existing_ui_section: "Quote / Watchlist / Follow-up Sales",
    existing_component: "INTELLIGENCE_ENDPOINTS.quoteOpportunities, renderQuoteOpportunityItem",
    ui_needles: ["quoteOpportunities", "renderQuoteOpportunityItem"],
    expected_payload: "top quote opportunity cards loaded from sales insight group"
  },
  {
    priority: 1,
    feature_name: "Verification Queue",
    product_area: "Sales Execution",
    endpoint_path: "dashboard/api/sales/verification-queue-summary.json",
    detail_endpoint_path: "dashboard/api/sales/verification-queue.json",
    existing_ui_section: "Quote / Watchlist / Follow-up Sales",
    existing_component: "INTELLIGENCE_ENDPOINTS.verificationQueueSummary",
    ui_needles: ["verificationQueueSummary", "/api/sales/verification-queue-summary.json"],
    expected_payload: "verification summary only; heavy queue remains lazy"
  },
  {
    priority: 1,
    feature_name: "Watchlist",
    product_area: "Sales Execution",
    endpoint_path: "dashboard/api/watchlist/current.json",
    existing_ui_section: "Watchlist",
    existing_component: "watchlistRows, renderWatchlist",
    ui_needles: ["watchlistRows", "renderWatchlist", "/api/watchlist/current.json"],
    expected_payload: "current watchlist items"
  },
  {
    priority: 1,
    feature_name: "Target Categories",
    product_area: "Sales Execution",
    endpoint_path: "dashboard/api/targets/categories-summary.json",
    detail_endpoint_path: "dashboard/api/targets/categories.json",
    existing_ui_section: "Target Categories",
    existing_component: "targetCategoryCards, TARGET_CATEGORY_UI",
    ui_needles: ["targetCategoryCards", "TARGET_CATEGORY_UI"],
    expected_payload: "category summary counts; category members lazy on click"
  },
  {
    priority: 2,
    feature_name: "Port Summary",
    product_area: "Port Intelligence",
    endpoint_path: "dashboard/api/ports.json",
    existing_ui_section: "Port Intelligence",
    existing_component: "ports, renderPorts",
    ui_needles: ["renderPorts", "/api/ports.json"],
    expected_payload: "port summary cards"
  },
  {
    priority: 2,
    feature_name: "Port DNA",
    product_area: "Port Intelligence",
    endpoint_path: "dashboard/api/intelligence/port-dna.json",
    existing_ui_section: "Port Intelligence",
    existing_component: "INTELLIGENCE_ENDPOINTS.portDna",
    ui_needles: ["portDna", "/api/intelligence/port-dna.json"],
    expected_payload: "lazy port insight cards"
  },
  {
    priority: 2,
    feature_name: "Fleet Intelligence",
    product_area: "Fleet / Operator Intelligence",
    endpoint_path: "dashboard/api/intelligence/fleet-intelligence.json",
    existing_ui_section: "Fleet / Operator Intelligence",
    existing_component: "INTELLIGENCE_ENDPOINTS.fleet",
    ui_needles: ["fleet-intelligence.json", "fleet"],
    expected_payload: "lazy fleet insight cards"
  },
  {
    priority: 2,
    feature_name: "Fleet Penetration",
    product_area: "Fleet / Operator Intelligence",
    endpoint_path: "dashboard/api/intelligence/fleet-penetration.json",
    existing_ui_section: "Fleet / Operator Intelligence",
    existing_component: "INTELLIGENCE_ENDPOINTS.fleetPenetration",
    ui_needles: ["fleetPenetration", "/api/intelligence/fleet-penetration.json"],
    expected_payload: "lazy fleet penetration cards"
  },
  {
    priority: 2,
    feature_name: "Revenue Forecast",
    product_area: "Revenue / Opportunity",
    endpoint_path: "dashboard/api/intelligence/revenue-forecast.json",
    existing_ui_section: "Revenue / Opportunity",
    existing_component: "INTELLIGENCE_ENDPOINTS.revenueForecast",
    ui_needles: ["revenueForecast", "/api/intelligence/revenue-forecast.json"],
    expected_payload: "lazy revenue forecast card"
  },
  {
    priority: 3,
    feature_name: "Cleaning Window",
    product_area: "Vessel Intelligence",
    endpoint_path: "dashboard/api/intelligence/cleaning-window.json",
    existing_ui_section: "Risk / Compliance",
    existing_component: "INTELLIGENCE_ENDPOINTS.cleaningWindow",
    ui_needles: ["cleaningWindow", "/api/intelligence/cleaning-window.json"],
    expected_payload: "lazy cleaning window cards"
  },
  {
    priority: 3,
    feature_name: "Compliance Exposure",
    product_area: "Vessel Intelligence",
    endpoint_path: "dashboard/api/intelligence/compliance-exposure.json",
    existing_ui_section: "Risk / Compliance",
    existing_component: "INTELLIGENCE_ENDPOINTS.complianceExposure",
    ui_needles: ["complianceExposure", "/api/intelligence/compliance-exposure.json"],
    expected_payload: "lazy compliance exposure cards"
  },
  {
    priority: 3,
    feature_name: "Contact Coverage",
    product_area: "Sales Intelligence",
    endpoint_path: "dashboard/api/intelligence/contact-coverage-summary.json",
    detail_endpoint_path: "dashboard/api/intelligence/contact-coverage.json",
    existing_ui_section: "Sales Intelligence",
    existing_component: "INTELLIGENCE_ENDPOINTS.contactCoverage, renderContactCoverageCard",
    ui_needles: ["contactCoverage", "/api/intelligence/contact-coverage-summary.json"],
    expected_payload: "contact coverage summary; full coverage detail lazy"
  },
  {
    priority: 3,
    feature_name: "Opportunity Memory",
    product_area: "Sales Intelligence",
    endpoint_path: "dashboard/api/intelligence/opportunity-memory.json",
    existing_ui_section: "Sales Intelligence",
    existing_component: "INTELLIGENCE_ENDPOINTS.opportunityMemory",
    ui_needles: ["opportunityMemory", "/api/intelligence/opportunity-memory.json"],
    expected_payload: "lazy repeat opportunity cards"
  },
  {
    priority: 4,
    feature_name: "Pilotage Summary",
    product_area: "Data Source / Enrichment",
    endpoint_path: "dashboard/api/aux/latest/pilotage-summary.json",
    existing_ui_section: "Data Source / Enrichment",
    existing_component: "INTELLIGENCE_ENDPOINTS.pilotageSummary",
    ui_needles: ["pilotageSummary", "/api/aux/latest/pilotage-summary.json"],
    expected_payload: "fast auxiliary cached pilotage summary"
  },
  {
    priority: 4,
    feature_name: "Berth / PNC Summary",
    product_area: "Data Source / Enrichment",
    endpoint_path: "dashboard/api/aux/latest/berth-summary.json",
    existing_ui_section: "Data Source / Enrichment",
    existing_component: "INTELLIGENCE_ENDPOINTS.berthSummary",
    ui_needles: ["berthSummary", "/api/aux/latest/berth-summary.json"],
    expected_payload: "fast auxiliary cached berth/PNC summary"
  },
  {
    priority: 4,
    feature_name: "AIS Info Summary",
    product_area: "Data Source / Enrichment",
    endpoint_path: "dashboard/api/aux/latest/ais-info-summary.json",
    existing_ui_section: "Data Source / Enrichment",
    existing_component: "INTELLIGENCE_ENDPOINTS.aisInfoSummary",
    ui_needles: ["aisInfoSummary", "/api/aux/latest/ais-info-summary.json"],
    expected_payload: "fast auxiliary cached AIS info summary"
  },
  {
    priority: 4,
    feature_name: "Vessel Spec Summary",
    product_area: "Data Source / Enrichment",
    endpoint_path: "dashboard/api/aux/latest/vessel-spec-summary.json",
    existing_ui_section: "Data Source / Enrichment",
    existing_component: "INTELLIGENCE_ENDPOINTS.vesselSpecSummary",
    ui_needles: ["vesselSpecSummary", "/api/aux/latest/vessel-spec-summary.json"],
    expected_payload: "fast auxiliary cached vessel spec summary"
  },
  {
    priority: 4,
    feature_name: "Source CSV Summary",
    product_area: "Data Source / Enrichment",
    endpoint_path: "dashboard/api/aux/source-csv-summary.json",
    existing_ui_section: "Data Source / Enrichment",
    existing_component: "INTELLIGENCE_ENDPOINTS.sourceCsvSummary",
    ui_needles: ["sourceCsvSummary", "/api/aux/source-csv-summary.json"],
    expected_payload: "lightweight source CSV summary"
  },
  {
    priority: 4,
    feature_name: "Source Quality Score",
    product_area: "Data Source / Enrichment",
    endpoint_path: "dashboard/api/source-quality-score.json",
    existing_ui_section: "Data Source / Enrichment",
    existing_component: "INTELLIGENCE_ENDPOINTS.sourceQuality",
    ui_needles: ["sourceQuality", "/api/source-quality-score.json"],
    expected_payload: "diagnostic quality summary; sources page only",
    diagnostic_only: true
  },
  {
    priority: 4,
    feature_name: "Enrichment Utilization",
    product_area: "Data Source / Enrichment",
    endpoint_path: "dashboard/api/enrichment-utilization.json",
    existing_ui_section: "Data Source / Enrichment",
    existing_component: "INTELLIGENCE_ENDPOINTS.enrichmentUtilization",
    ui_needles: ["enrichmentUtilization", "/api/enrichment-utilization.json"],
    expected_payload: "diagnostic enrichment utilization summary; sources page only",
    diagnostic_only: true
  }
];

function abs(relativePath) {
  return path.join(ROOT, ...String(relativePath).split("/"));
}

function exists(relativePath) {
  return fs.existsSync(abs(relativePath));
}

function readText(relativePath) {
  try {
    return exists(relativePath) ? fs.readFileSync(abs(relativePath), "utf8") : "";
  } catch {
    return "";
  }
}

function readJson(relativePath) {
  try {
    if (!exists(relativePath)) return { exists: false, payload: null, error: null, size: 0 };
    const file = abs(relativePath);
    return {
      exists: true,
      payload: JSON.parse(fs.readFileSync(file, "utf8")),
      error: null,
      size: fs.statSync(file).size
    };
  } catch (error) {
    return {
      exists: true,
      payload: null,
      error: error.message,
      size: exists(relativePath) ? fs.statSync(abs(relativePath)).size : 0
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

function rows(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.ports)) return payload.ports;
  if (Array.isArray(payload?.categories)) return payload.categories;
  if (Array.isArray(payload?.vessels)) return payload.vessels;
  if (Array.isArray(payload?.opportunities)) return payload.opportunities;
  if (Array.isArray(payload?.sources)) return payload.sources;
  return [];
}

function recordCount(payload) {
  const direct = Number(
    payload?.record_count ??
    payload?.total_count ??
    payload?.total_item_count ??
    payload?.source_count ??
    payload?.patch_count
  );
  if (Number.isFinite(direct)) return direct;
  const list = rows(payload);
  if (list.length) return list.length;
  if (payload && typeof payload === "object" && (payload.status || payload.generated_at || payload.owner_tier)) return 1;
  return 0;
}

function endpointHasData(payload) {
  if (!payload || typeof payload !== "object") return false;
  if (recordCount(payload) > 0) return true;
  return ["ACTIVE", "SOURCE_TOO_LARGE"].includes(String(payload.status || "").toUpperCase());
}

function findManifestEntry(manifest, endpointPath) {
  const entries = Array.isArray(manifest?.endpoints) ? manifest.endpoints : [];
  return entries.find(entry => entry.path === endpointPath) || null;
}

function generatedAt(payload) {
  return payload?.generated_at || payload?.status?.generated_at || payload?.snapshot_context?.generated_at || null;
}

function ageHours(value) {
  const time = Date.parse(value || "");
  if (!Number.isFinite(time)) return null;
  return (Date.now() - time) / 36e5;
}

function reportMeta(relativePath, manifestGeneratedAt) {
  const fileExists = exists(relativePath);
  const json = relativePath.endsWith(".json") ? readJson(relativePath) : { payload: null, error: null };
  const text = fileExists && !relativePath.endsWith(".json") ? readText(relativePath) : "";
  const generated = generatedAt(json.payload) || text.match(/Generated at:\s*([^\n]+)/i)?.[1]?.trim() || null;
  const staleByAge = ageHours(generated) !== null && ageHours(generated) > 36;
  const staleByManifest = generated && manifestGeneratedAt && Date.parse(generated) < Date.parse(manifestGeneratedAt);
  return {
    path: relativePath,
    exists: fileExists,
    generated_at: generated,
    stale: Boolean(fileExists && (staleByAge || staleByManifest)),
    error: json.error || null
  };
}

function uiVisible(html, needles) {
  return needles.some(needle => html.includes(needle));
}

function currentVisibility(endpointExists, endpointHasDataValue, visible) {
  if (visible && endpointHasDataValue) return "VISIBLE_WITH_DATA";
  if (visible) return "VISIBLE_EMPTY";
  if (endpointExists && endpointHasDataValue) return "HIDDEN_WITH_DATA";
  if (endpointExists) return "HIDDEN_EMPTY";
  return "MISSING";
}

function classifyFeature({ definition, endpointExists, endpointError, endpointHasDataValue, endpointSize, visible, manifestEntry }) {
  if (definition.diagnostic_only) return "DIAGNOSTIC_ONLY";
  if (!endpointExists || endpointError) return "DEFERRED";
  if (!endpointHasDataValue) return visible ? "EMPTY_COLLAPSED" : "DEFERRED";
  if (visible) return "ALREADY_VISIBLE";
  if (endpointSize > HEAVY_BYTES && !definition.detail_endpoint_path) return "NEEDS_SUMMARY";
  if (definition.detail_endpoint_path || manifestEntry?.load_strategy === "lazy") return "DETAIL_LAZY_ONLY";
  if (manifestEntry?.load_strategy === "diagnostic_only") return "DO_NOT_SURFACE_YET";
  return "SAFE_TO_RECONNECT";
}

function revivalAction({ classification, definition, endpointSize, manifestEntry }) {
  if (classification === "ALREADY_VISIBLE") {
    return definition.endpoint_path.includes("/aux/latest/")
      ? "Existing sources page component now uses verified aux/latest cache."
      : "Already connected to an existing UI section; keep monitored.";
  }
  if (classification === "SAFE_TO_RECONNECT") return "Reconnect existing placeholder/component to this summary endpoint.";
  if (classification === "NEEDS_SUMMARY") return "Do not load raw detail; create/use a summary endpoint first.";
  if (classification === "DETAIL_LAZY_ONLY") return "Keep detail lazy; use existing summary or click/expand flow.";
  if (classification === "EMPTY_COLLAPSED") return "Keep section collapsed with a clear empty reason.";
  if (classification === "DIAGNOSTIC_ONLY") return "Keep on data-source/diagnostic page, outside business sections.";
  if (classification === "DO_NOT_SURFACE_YET") return "Do not surface in dashboard business screens yet.";
  if (endpointSize > HEAVY_BYTES || manifestEntry?.load_strategy === "diagnostic_only") return "Defer until a safe summary renderer exists.";
  return "Keep deferred until endpoint data is available.";
}

function riskFor({ classification, endpointSize, endpointError }) {
  if (endpointError) return "HIGH";
  if (classification === "NEEDS_SUMMARY" || endpointSize > HEAVY_BYTES) return "MEDIUM";
  if (classification === "DIAGNOSTIC_ONLY" || classification === "DO_NOT_SURFACE_YET") return "LOW";
  if (classification === "DEFERRED") return "MEDIUM";
  return "LOW";
}

function markdownTable(headers, tableRows) {
  const header = `| ${headers.join(" | ")} |`;
  const sep = `| ${headers.map(() => "---").join(" | ")} |`;
  const body = tableRows.map(row => `| ${headers.map(h => String(row[h] ?? "-").replace(/\|/g, "\\|").replace(/\n/g, " ")).join(" | ")} |`);
  return [header, sep, ...body].join("\n");
}

const html = readText(DASHBOARD_HTML);
const manifest = readJson(MANIFEST_JSON).payload || {};
const manifestGeneratedAt = manifest.generated_at || null;
const generatedAtNow = new Date().toISOString();
const sourceReports = SOURCE_REPORTS.map(report => reportMeta(report, manifestGeneratedAt));

const features = FEATURE_DEFINITIONS.map(definition => {
  const endpoint = readJson(definition.endpoint_path);
  const manifestEntry = findManifestEntry(manifest, definition.endpoint_path);
  const endpointExists = endpoint.exists;
  const endpointHasDataValue = endpoint.exists && !endpoint.error && endpointHasData(endpoint.payload);
  const visible = uiVisible(html, definition.ui_needles);
  const endpointRecordCount = endpoint.payload && !endpoint.error ? recordCount(endpoint.payload) : 0;
  const endpointSizeKb = Math.round((endpoint.size / 1024) * 10) / 10;
  const classification = classifyFeature({
    definition,
    endpointExists,
    endpointError: endpoint.error,
    endpointHasDataValue,
    endpointSize: endpoint.size,
    visible,
    manifestEntry
  });
  return {
    feature_name: definition.feature_name,
    product_area: definition.product_area,
    endpoint_path: definition.endpoint_path,
    detail_endpoint_path: definition.detail_endpoint_path || null,
    endpoint_exists: endpointExists,
    endpoint_has_data: endpointHasDataValue,
    endpoint_record_count: endpointRecordCount,
    endpoint_size_kb: endpointSizeKb,
    startup_safe: Boolean(manifestEntry?.startup_safe),
    load_strategy: manifestEntry?.load_strategy || "unknown",
    owner_tier: manifestEntry?.owner_tier || "unknown",
    included_in_deploy: Boolean(manifestEntry?.included_in_deploy),
    existing_ui_section: definition.existing_ui_section,
    existing_component: definition.existing_component,
    current_visibility: currentVisibility(endpointExists, endpointHasDataValue, visible),
    revival_classification: classification,
    revival_action: revivalAction({ classification, definition, endpointSize: endpoint.size, manifestEntry }),
    risk: riskFor({ classification, endpointSize: endpoint.size, endpointError: endpoint.error }),
    expected_payload: definition.expected_payload,
    priority: definition.priority
  };
});

const heavyLazy = features.filter(feature =>
  feature.detail_endpoint_path ||
  feature.endpoint_size_kb > 500 ||
  feature.load_strategy === "lazy"
);
const hiddenWithData = features.filter(feature => feature.current_visibility === "HIDDEN_WITH_DATA");
const skipped = features.filter(feature => ["DEFERRED", "DIAGNOSTIC_ONLY", "DO_NOT_SURFACE_YET", "EMPTY_COLLAPSED"].includes(feature.revival_classification));
const duplicateRisks = features
  .filter(feature => feature.feature_name === "Target Categories" || feature.feature_name === "Watchlist")
  .map(feature => `${feature.feature_name}: existing dedicated section is present; do not add duplicate summary cards.`);
const placeholdersReconnected = features.filter(feature => feature.revival_action.includes("verified aux/latest"));
const staleReports = sourceReports.filter(report => report.exists && report.stale);

const plan = {
  schema_version: "2.0",
  generated_at: generatedAtNow,
  manifest_generated_at: manifestGeneratedAt,
  source_reports: sourceReports,
  source_reports_stale: staleReports.length > 0,
  record_count: features.length,
  summary: {
    already_visible_features: features.filter(feature => feature.revival_classification === "ALREADY_VISIBLE").length,
    revived_features: placeholdersReconnected.length,
    skipped_features: skipped.length,
    hidden_features_with_data: hiddenWithData.length,
    placeholders_reconnected: placeholdersReconnected.length,
    heavy_endpoints_kept_lazy: heavyLazy.length,
    duplicate_risk_count: duplicateRisks.length,
    diagnostic_only_features: features.filter(feature => feature.revival_classification === "DIAGNOSTIC_ONLY").length
  },
  features,
  already_visible_features: features.filter(feature => feature.revival_classification === "ALREADY_VISIBLE").map(feature => feature.feature_name),
  revived_features: placeholdersReconnected.map(feature => feature.feature_name),
  skipped_features: skipped.map(feature => ({
    feature_name: feature.feature_name,
    classification: feature.revival_classification,
    reason: feature.revival_action
  })),
  hidden_features_with_data: hiddenWithData.map(feature => feature.feature_name),
  heavy_endpoints_kept_lazy: heavyLazy.map(feature => ({
    feature_name: feature.feature_name,
    endpoint_path: feature.endpoint_path,
    detail_endpoint_path: feature.detail_endpoint_path,
    size_kb: feature.endpoint_size_kb,
    load_strategy: feature.load_strategy
  })),
  duplicate_risks: duplicateRisks,
  recommended_next_actions: [
    "Keep Overview on bootstrap and startup-safe summary outputs only.",
    "Use aux/latest cache files for auxiliary source summaries.",
    "Keep heavy detail endpoints lazy-loaded from existing click/expand flows.",
    "Keep source-quality and enrichment-utilization on the data-source/diagnostic page, not business sections.",
    "Do not add duplicate cards for target categories or watchlist because dedicated sections already exist."
  ]
};

writeJson(PLAN_JSON, plan);

const mdRows = features.map(feature => ({
  Feature: feature.feature_name,
  Area: feature.product_area,
  Classification: feature.revival_classification,
  Endpoint: feature.endpoint_path,
  Exists: feature.endpoint_exists ? "yes" : "no",
  Records: feature.endpoint_record_count,
  Startup: feature.startup_safe ? "yes" : "no",
  UI: feature.current_visibility,
  Action: feature.revival_action,
  Risk: feature.risk,
  Priority: feature.priority
}));

writeText(PLAN_MD, `# Feature Revival Plan

Generated at: ${generatedAtNow}

This plan restores existing dashboard functionality by reconnecting already-developed endpoints to existing sections. It avoids duplicate components, keeps heavy detail endpoints lazy, and uses verified tiered data outputs.

## Summary

- Already visible features: ${plan.summary.already_visible_features}
- Revived / reconnected features: ${plan.summary.revived_features}
- Skipped features: ${plan.summary.skipped_features}
- Hidden features with data: ${plan.summary.hidden_features_with_data}
- Placeholders reconnected: ${plan.summary.placeholders_reconnected}
- Heavy endpoints kept lazy: ${plan.summary.heavy_endpoints_kept_lazy}
- Diagnostic-only features: ${plan.summary.diagnostic_only_features}
- Duplicate risks: ${plan.summary.duplicate_risk_count}
- Source reports stale: ${plan.source_reports_stale ? "yes" : "no"}

## Revival Matrix

${markdownTable(["Feature", "Area", "Classification", "Endpoint", "Exists", "Records", "Startup", "UI", "Action", "Risk", "Priority"], mdRows)}

## Heavy Endpoints Kept Lazy

${plan.heavy_endpoints_kept_lazy.length ? plan.heavy_endpoints_kept_lazy.map(item => `- ${item.feature_name}: ${item.detail_endpoint_path || item.endpoint_path} (${item.size_kb} KB, ${item.load_strategy})`).join("\n") : "- none"}

## Source Report Freshness

${sourceReports.map(report => `- ${report.path}: ${report.exists ? "exists" : "missing"}${report.generated_at ? `, generated_at ${report.generated_at}` : ""}, stale ${report.stale ? "yes" : "no"}`).join("\n")}

## Duplicate Risks

${plan.duplicate_risks.length ? plan.duplicate_risks.map(item => `- ${item}`).join("\n") : "- none"}

## Next Actions

${plan.recommended_next_actions.map(item => `- ${item}`).join("\n")}
`);

console.log("Feature Revival Audit");
console.log("=====================");
console.log("Feature | Endpoint | Record Count | UI Section | Visible | Classification | Problem");
for (const feature of features) {
  const visible = feature.current_visibility.startsWith("VISIBLE") ? "yes" : "no";
  const problem = feature.revival_classification === "ALREADY_VISIBLE" ? "-" : feature.revival_action;
  console.log(`${feature.feature_name} | ${feature.endpoint_path} | ${feature.endpoint_record_count} | ${feature.existing_ui_section} | ${visible} | ${feature.revival_classification} | ${problem}`);
}

console.log("");
console.log(`already_visible_features=${plan.summary.already_visible_features}`);
console.log(`revived_features=${plan.summary.revived_features}`);
console.log(`skipped_features=${plan.summary.skipped_features}`);
console.log(`hidden_features_with_data=${plan.summary.hidden_features_with_data}`);
console.log(`placeholders_reconnected=${plan.summary.placeholders_reconnected}`);
console.log(`heavy_endpoints_kept_lazy=${plan.summary.heavy_endpoints_kept_lazy}`);
console.log(`duplicate_risks=${plan.summary.duplicate_risk_count}`);
console.log(`source_reports_stale=${plan.source_reports_stale ? "yes" : "no"}`);
console.log(`plan=${PLAN_JSON}`);
console.log(`doc=${PLAN_MD}`);
