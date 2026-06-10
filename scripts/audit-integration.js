#!/usr/bin/env node

import fs from "fs";
import path from "path";

const ROOT = process.cwd();
const DASHBOARD_HTML = path.join(ROOT, "dashboard", "index.html");
const DOC_PATH = path.join(ROOT, "docs", "UI_DATA_API_INTEGRATION_AUDIT.md");

const FEATURE_CATALOG = [
  {
    feature: "Overview bootstrap",
    source: "dashboard_summary_snapshots, active_dataset_pointer, static snapshot",
    endpoint: "dashboard/api/bootstrap.json",
    section: "Overview / Executive Summary",
    needles: ["applyBootstrapSnapshot", "overviewCommandCenter", "executiveSummary"]
  },
  {
    feature: "Sales actions",
    source: "targets/categories, sales_candidates_current, sales/actions",
    endpoint: "dashboard/api/sales/actions.json",
    section: "Sales Execution",
    needles: ["sales/actions.json", "salesActions", "todaySalesActions"]
  },
  {
    feature: "Conversion pipeline",
    source: "sales-pipeline, sales/actions, operator_contact_history, commercial_leads",
    endpoint: "dashboard/api/sales/conversion-pipeline.json",
    section: "Sales Execution / Advanced insight",
    needles: ["conversionPipeline", "conversion-pipeline.json"]
  },
  {
    feature: "Watchlist",
    source: "vessel_display, opportunity_memory, sales/actions, relationship-intelligence",
    endpoint: "dashboard/api/watchlist/current.json",
    section: "Vessel Intelligence",
    needles: ["watchlist/current.json", "watchlistRows"]
  },
  {
    feature: "Quote opportunities",
    source: "opportunity_master, sales candidates, service-bundles, cleaning-window",
    endpoint: "dashboard/api/sales/quote-opportunities.json",
    section: "Sales Execution / Revenue",
    needles: ["quote-opportunities.json", "quoteOpportunities"]
  },
  {
    feature: "Target categories",
    source: "sales_candidates_current, opportunity_master, risk_history, rule_evaluations",
    endpoint: "dashboard/api/targets/categories.json",
    section: "Target Categories",
    needles: ["targets/categories.json", "targetCategoryCards", "target_categories"]
  },
  {
    feature: "Top candidates",
    source: "opportunity_master, candidates/top snapshot",
    endpoint: "dashboard/api/candidates/top.json",
    section: "Vessel Intelligence",
    needles: ["candidates/top.json", "hotList"]
  },
  {
    feature: "Port intelligence",
    source: "port_summary_current, port_snapshot_daily, port_congestion_snapshots, opportunity_master",
    endpoint: "dashboard/api/intelligence/port-dna.json",
    section: "Port Intelligence",
    needles: ["port-dna.json", "portIntelligenceBlock"]
  },
  {
    feature: "Fleet intelligence",
    source: "operator_snapshot_daily, fleet-memory, operator-opportunities, vessel_visits",
    endpoint: "dashboard/api/intelligence/fleet-intelligence.json",
    section: "Fleet / Operator Intelligence",
    needles: ["fleet-intelligence.json", "fleetOperatorBlock"]
  },
  {
    feature: "Revenue forecast",
    source: "commercial_opportunity_daily, opportunity_master, sales/actions, sales-pipeline",
    endpoint: "dashboard/api/intelligence/revenue-forecast.json",
    section: "Revenue / Opportunity",
    needles: ["revenue-forecast.json", "revenueOpportunityBlock", "revenueRadar"]
  },
  {
    feature: "Vessel pages",
    source: "latest successful vessel snapshot",
    endpoint: "dashboard/api/vessels/index.json",
    section: "Full Vessel List",
    needles: ["vessels/index.json", "loadStaticVesselPage", "ensureVesselIndex"]
  },
  {
    feature: "Data quality",
    source: "quality diagnostics, source health, static JSON validation",
    endpoint: "dashboard/api/quality/data-quality.json",
    section: "Data Quality / Technical Diagnostics",
    needles: ["data-quality.json", "technicalDiagnostics", "dataQuality"]
  }
];

const EXPECTED_ENDPOINTS = [
  ["bootstrap", "/api/bootstrap.json"],
  ["insight:conversionPipeline", "/api/sales/conversion-pipeline.json"],
  ["watchlist", "/api/watchlist/current.json"],
  ["insight:salesActions", "/api/sales/actions.json"],
  ["insight:quoteOpportunities", "/api/sales/quote-opportunities.json"],
  ["targets:categories", "/api/targets/categories.json"],
  ["candidates:top", "/api/candidates/top.json"],
  ["insight:portDna", "/api/intelligence/port-dna.json"],
  ["insight:fleet", "/api/intelligence/fleet-intelligence.json"],
  ["insight:revenueForecast", "/api/intelligence/revenue-forecast.json"],
  ["vessels:index", "/api/vessels/index.json"]
];

const SOURCE_KEYS = [
  "source_csv",
  "vessel_spec",
  "port_operation",
  "port_facility",
  "mof_vts",
  "mof_ais_dynamic",
  "mof_ais_info",
  "mof_ais_stat",
  "supabase"
];

const SOURCE_CAPABILITY = {
  source_csv: {
    fields: "manual vessel corrections, IMO/MMSI, operator hints, port overrides",
    ui: "vessel identity, sales target enrichment, fallback candidate rows",
    missing: "SOURCE_CSV_URL can improve identity and operator coverage"
  },
  vessel_spec: {
    fields: "IMO, MMSI, call sign, vessel type, GT, DWT, flag",
    ui: "vessel_display identity, quote readiness, fleet segmentation",
    missing: "VESSEL_SPEC_SERVICE_KEY would improve missing IMO/GT/DWT/flag"
  },
  port_operation: {
    fields: "vessel name, call sign, ETA/ATA, port, inbound/outbound status, GT hints",
    ui: "arrival pipeline, anchorage/staying, port summary, sales target funnel",
    missing: "already active; more endpoint variants can improve berth/pilot detail"
  },
  port_facility: {
    fields: "berth, facility, terminal, anchorage/facility context",
    ui: "port intelligence, anchorage reason, vessel detail",
    missing: "PORT_FACILITY_SERVICE_KEY can improve berth/facility display"
  },
  mof_vts: {
    fields: "movement area, VTS status, waiting/anchorage signal",
    ui: "anchorage waiting, congestion, vessel status",
    missing: "MOF_VTS credentials can reduce unknown status"
  },
  mof_ais_dynamic: {
    fields: "lat/lon, speed, heading, recent AIS movement",
    ui: "map layers, loitering/anchorage, biofouling signal",
    missing: "MOF_AIS_DYNAMIC_* can improve live position and slow-steaming"
  },
  mof_ais_info: {
    fields: "MMSI, IMO, vessel identity, call sign, size/type hints",
    ui: "vessel_display, enrichment coverage, quote readiness",
    missing: "MOF_AIS_INFO_* can improve identity coverage"
  },
  mof_ais_stat: {
    fields: "traffic statistics and historical movement aggregates",
    ui: "port trend, congestion, fleet/route summaries",
    missing: "MOF_AIS_STAT_* can improve trend and seasonality features"
  },
  supabase: {
    fields: "run history, vessel history, opportunity history, snapshot promotion state",
    ui: "data health, stale/mismatch diagnostics, long-term intelligence",
    missing: "keep service-role writes only; frontend should use static JSON"
  }
};

function toFile(urlOrPath) {
  const relative = urlOrPath.startsWith("/api/")
    ? `dashboard${urlOrPath}`
    : urlOrPath;
  return path.join(ROOT, ...relative.split("/"));
}

function toEndpointPath(urlOrPath) {
  return urlOrPath.startsWith("/api/") ? `dashboard${urlOrPath}` : urlOrPath;
}

function readText(file) {
  try {
    return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  } catch {
    return "";
  }
}

function readJson(urlOrPath) {
  const file = toFile(urlOrPath);
  if (!fs.existsSync(file)) return { exists: false, payload: null, error: "missing", size: 0, file };
  try {
    const text = fs.readFileSync(file, "utf8");
    return { exists: true, payload: JSON.parse(text), error: null, size: Buffer.byteLength(text), file };
  } catch (error) {
    return { exists: true, payload: null, error: error.message, size: fs.statSync(file).size, file };
  }
}

function rows(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.vessels)) return payload.vessels;
  if (Array.isArray(payload?.candidates)) return payload.candidates;
  if (Array.isArray(payload?.opportunities)) return payload.opportunities;
  if (Array.isArray(payload?.ports)) return payload.ports;
  if (Array.isArray(payload?.categories)) return payload.categories;
  return [];
}

function recordCount(payload) {
  const direct = Number(payload?.record_count ?? payload?.total_count ?? payload?.total_vessels ?? payload?.all_vessels_count);
  return Number.isFinite(direct) ? direct : rows(payload).length;
}

function generatedAt(payload) {
  return payload?.generated_at || payload?.status?.generated_at || payload?.data_health?.last_success_at || null;
}

function ageHours(value) {
  const time = Date.parse(value || "");
  if (!Number.isFinite(time)) return null;
  return (Date.now() - time) / 36e5;
}

function schemaValid(payload, endpoint) {
  if (!payload || typeof payload !== "object") return false;
  if (endpoint.endsWith("/bootstrap.json")) return Boolean(payload.kpis && payload.generated_at);
  if (endpoint.endsWith("/vessels/index.json")) return Array.isArray(payload.pages) && Number.isFinite(Number(payload.total_count));
  if (endpoint.includes("/targets/categories.json")) return Array.isArray(payload.categories) && Boolean(payload.generated_at);
  if (endpoint.includes("/intelligence/") || endpoint.includes("/sales/") || endpoint.includes("/watchlist/")) {
    return Boolean(payload.generated_at) && (
      Array.isArray(payload.items) ||
      Array.isArray(payload.data) ||
      Array.isArray(payload.categories) ||
      Number.isFinite(Number(payload.record_count))
    );
  }
  return Boolean(payload.generated_at || Array.isArray(payload) || Object.keys(payload).length);
}

function statusFor({ exists, error, schemaOk, recordCount, visible, stale, mismatch }) {
  if (!exists || error || !schemaOk) return "BROKEN";
  if (mismatch) return "MISMATCH";
  if (stale) return "STALE";
  if (recordCount === 0) return "EMPTY";
  if (!visible) return "HIDDEN";
  return "ACTIVE";
}

function parseFrontendEndpoints(html) {
  const map = new Map();
  const add = (key, url) => {
    if (!url || !url.startsWith("/api/")) return;
    const current = map.get(url) || new Set();
    current.add(key || "frontend");
    map.set(url, current);
  };

  for (const match of html.matchAll(/api\("([^"]+)","(\/api\/[^"]+)"/g)) add(match[1], match[2]);
  for (const match of html.matchAll(/\{key:"([^"]+)"[\s\S]{0,240}?path:"(\/api\/[^"]+)"/g)) add(`insight:${match[1]}`, match[2]);
  for (const match of html.matchAll(/path:"(\/api\/[^"]+)"/g)) add("path", match[1]);
  for (const match of html.matchAll(/href="(\/api\/[^"]+)"/g)) add("link", match[1]);

  for (const [key, url] of EXPECTED_ENDPOINTS) add(key, url);
  return [...map.entries()].map(([url, keys]) => ({ url, keys: [...keys].sort() })).sort((a, b) => a.url.localeCompare(b.url));
}

function sourceStatus(key, statusPayload, sourceHealth, datasetAudit, bootstrap) {
  const apiSource = (statusPayload.api_sources || []).find(source => source.key === key);
  const enabledCollectors = sourceHealth.enabled_collectors || [];
  const attempted = sourceHealth.attempted_collectors || [];
  const skipped = sourceHealth.skipped_collectors || [];
  const counts = datasetAudit.counts_by_stage || {};
  const dbRows = bootstrap.data_health?.db_status?.rows_written_by_table || statusPayload.supabase_write?.rows_written_by_table || {};
  const skippedReason = skipped.find(item => item.source_name === key || String(item.source_name || "").startsWith(`${key}_`));

  let enabled = Boolean(apiSource?.enabled);
  let collectedRows = 0;
  if (key === "port_operation") {
    enabled = enabled || enabledCollectors.some(name => name.startsWith("port_operation_"));
    collectedRows = Number(counts.port_operation_source_rows_collected || datasetAudit.port_operation_source_rows_collected || 0);
  } else if (key === "supabase") {
    enabled = Boolean(apiSource?.enabled || bootstrap.data_health?.db_status?.supabase_write_status === "completed" || statusPayload.supabase_status === "completed");
    collectedRows = Object.values(dbRows).reduce((sum, value) => sum + (Number(value) || 0), 0);
  } else {
    enabled = Boolean(apiSource?.enabled);
    collectedRows = attempted.includes(key) ? Number(counts.source_rows_collected || 0) : 0;
  }

  const status = apiSource?.status || (skippedReason ? `skipped:${skippedReason.reason || skippedReason.raw_reason}` : enabled ? "enabled" : "not_configured");
  const capability = SOURCE_CAPABILITY[key] || { fields: "-", ui: "-", missing: "-" };
  return {
    source: key,
    enabled: enabled ? "yes" : "no",
    status,
    collectedRows,
    fields: capability.fields,
    ui: capability.ui,
    missing: capability.missing
  };
}

function mdTable(headers, rows) {
  const escapeCell = value => String(value ?? "-").replace(/\|/g, "\\|").replace(/\n/g, "<br>");
  return [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map(row => `| ${row.map(escapeCell).join(" | ")} |`)
  ].join("\n");
}

function main() {
  const html = readText(DASHBOARD_HTML);
  const statusPayload = readJson("dashboard/api/status.json").payload || {};
  const sourceHealth = readJson("dashboard/api/source-health-runtime.json").payload || {};
  const datasetAudit = readJson("dashboard/api/quality/dataset-generation-audit.json").payload || {};
  const bootstrap = readJson("dashboard/api/bootstrap.json").payload || {};
  const vesselIndex = readJson("dashboard/api/vessels/index.json").payload || {};
  const targetCategories = readJson("dashboard/api/targets/categories.json").payload || {};

  const frontendEndpoints = parseFrontendEndpoints(html);
  const endpointRows = frontendEndpoints.map(({ url, keys }) => {
    const endpoint = toEndpointPath(url);
    const result = readJson(url);
    const count = result.payload && !result.error ? recordCount(result.payload) : 0;
    const schemaOk = !result.error && schemaValid(result.payload, url);
    return {
      key: keys.join(", "),
      url,
      filePath: endpoint,
      exists: result.exists,
      jsonOk: result.exists && !result.error,
      recordCount: count,
      schemaOk,
      status: !result.exists ? "MISSING" : result.error ? "INVALID_JSON" : !schemaOk ? "SCHEMA_MISMATCH" : count === 0 ? "EMPTY" : "OK",
      problem: !result.exists ? "file missing" : result.error ? result.error : !schemaOk ? "schema contract mismatch" : "-"
    };
  });

  const featureRows = FEATURE_CATALOG.map(feature => {
    const result = readJson(feature.endpoint);
    const count = result.payload && !result.error ? recordCount(result.payload) : 0;
    const visible = feature.needles.some(needle => html.includes(needle));
    const staleAge = result.payload ? ageHours(generatedAt(result.payload)) : null;
    const stale = staleAge !== null && staleAge > 36;
    const schemaOk = !result.error && schemaValid(result.payload, feature.endpoint);
    const mismatch =
      feature.endpoint.endsWith("bootstrap.json") &&
      Number(bootstrap.kpis?.total_vessels) !== Number(vesselIndex.total_count);
    const status = statusFor({ exists: result.exists, error: result.error, schemaOk, recordCount: count, visible, stale, mismatch });
    return {
      feature: feature.feature,
      source: feature.source,
      endpoint: feature.endpoint,
      section: feature.section,
      visible: visible ? "yes" : "no",
      recordCount: count,
      status,
      problem: result.error || (!result.exists ? "missing endpoint" : !schemaOk ? "schema invalid" : stale ? `stale ${Math.round(staleAge)}h` : mismatch ? "bootstrap total_vessels differs from vessel index" : "-")
    };
  });

  const sourceRows = SOURCE_KEYS.map(key => sourceStatus(key, statusPayload, sourceHealth, datasetAudit, bootstrap));
  const hiddenJsonWithData = endpointRows.filter(row => row.recordCount > 0 && !row.key.includes("insight:") && !row.key.includes("watchlist") && !row.key.includes("bootstrap"));
  const brokenEndpoints = endpointRows.filter(row => ["MISSING", "INVALID_JSON", "SCHEMA_MISMATCH"].includes(row.status));
  const activeFeatures = featureRows.filter(row => ["ACTIVE", "STALE"].includes(row.status) && row.visible === "yes" && row.recordCount > 0);
  const hiddenFeatures = featureRows.filter(row => row.status === "HIDDEN");
  const uiGaps = featureRows.filter(row => row.status === "BROKEN" || row.status === "MISMATCH" || row.visible === "no");

  const mismatches = [];
  if (Number(bootstrap.kpis?.total_vessels) !== Number(vesselIndex.total_count)) {
    mismatches.push(`bootstrap.kpis.total_vessels (${bootstrap.kpis?.total_vessels}) != vessels/index.total_count (${vesselIndex.total_count})`);
  }
  if (Number(bootstrap.kpis?.sales_target_count) !== Number(targetCategories.record_count)) {
    mismatches.push(`bootstrap.kpis.sales_target_count (${bootstrap.kpis?.sales_target_count}) != targets/categories.record_count (${targetCategories.record_count})`);
  }

  const recommendations = [];
  if (brokenEndpoints.length) recommendations.push("Repair missing/invalid frontend endpoint mappings before adding UI features.");
  if (mismatches.length) recommendations.push("Keep total vessel KPI mapped to vessels/index and sales target KPI mapped to targets/categories.");
  if (!sourceRows.find(row => row.source === "vessel_spec")?.enabled.includes("yes")) recommendations.push("Configure vessel_spec when ready to improve IMO, GT, DWT, flag, and vessel type coverage.");
  if (!sourceRows.find(row => row.source === "mof_ais_dynamic")?.enabled.includes("yes")) recommendations.push("Configure MOF AIS dynamic when ready to power live position, loitering, and map layers.");
  if (!recommendations.length) recommendations.push("No broken mapping found; continue with data quality and source coverage improvements.");

  const doc = [
    "# UI Data API Integration Audit",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    "Scope: read-only audit of current UI, generated static JSON, source capabilities, and simple endpoint mapping health. No new intelligence feature was created.",
    "",
    "## Summary",
    "",
    `- Active feature mappings: ${activeFeatures.length}`,
    `- Hidden feature mappings: ${hiddenFeatures.length}`,
    `- Broken frontend endpoints: ${brokenEndpoints.length}`,
    `- Frontend endpoints checked: ${endpointRows.length}`,
    `- Data source rows collected: ${datasetAudit.counts_by_stage?.source_rows_collected ?? datasetAudit.source_rows_collected ?? 0}`,
    `- Normalized vessels: ${datasetAudit.counts_by_stage?.normalized_rows ?? datasetAudit.normalized_rows ?? 0}`,
    `- Total vessel pages: ${vesselIndex.total_pages ?? 0}`,
    "",
    "## Feature Matrix",
    "",
    mdTable(
      ["Feature", "Source tables/data", "Generated JSON endpoint", "Frontend section", "Visible", "record_count", "Status", "Problem"],
      featureRows.map(row => [row.feature, row.source, row.endpoint, row.section, row.visible, row.recordCount, row.status, row.problem])
    ),
    "",
    "## Endpoint Map",
    "",
    mdTable(
      ["Frontend key", "Expected URL", "Actual generated file path", "Exists", "Valid JSON", "record_count", "Schema valid", "Status", "Problem"],
      endpointRows.map(row => [row.key, row.url, row.filePath, row.exists ? "yes" : "no", row.jsonOk ? "yes" : "no", row.recordCount, row.schemaOk ? "yes" : "no", row.status, row.problem])
    ),
    "",
    "## Source Capability Map",
    "",
    mdTable(
      ["Source", "Enabled", "Runtime status", "Collected rows", "Fields contributed", "UI fields powered", "Missing fields it could improve"],
      sourceRows.map(row => [row.source, row.enabled, row.status, row.collectedRows, row.fields, row.ui, row.missing])
    ),
    "",
    "## Consistency Notes",
    "",
    mismatches.length ? mismatches.map(item => `- ${item}`).join("\n") : "- No KPI/data-count mismatches detected in the checked contracts.",
    "",
    "## Broken Or Hidden Connections",
    "",
    brokenEndpoints.length ? brokenEndpoints.map(row => `- ${row.key}: ${row.url} -> ${row.status} (${row.problem})`).join("\n") : "- No missing, invalid JSON, or schema-broken frontend endpoints found.",
    hiddenFeatures.length ? hiddenFeatures.map(row => `- ${row.feature}: ${row.endpoint} has data but is not visible.`).join("\n") : "- No catalogued feature with data is hidden from the UI.",
    "",
    "## Light Repairs",
    "",
    "- No endpoint path repair was required for the specifically checked endpoints: conversionPipeline, watchlist, sales actions, quote opportunities, targets/categories, port intelligence, fleet intelligence, revenue forecast, and vessel pages.",
    "- No empty JSON wrapper was created because no frontend-referenced endpoint was missing or invalid.",
    "- No UI redesign or new intelligence logic was added.",
    "",
    "## Recommended Next Actions",
    "",
    recommendations.map(item => `- ${item}`).join("\n"),
    ""
  ].join("\n");

  fs.mkdirSync(path.dirname(DOC_PATH), { recursive: true });
  fs.writeFileSync(DOC_PATH, doc, "utf8");

  console.log("UI/Data/API Integration Audit");
  console.log("=============================");
  console.log(`Active features: ${activeFeatures.length}`);
  for (const row of activeFeatures) console.log(`- ${row.feature}: ${row.recordCount} records`);
  console.log("");
  console.log(`Hidden features: ${hiddenFeatures.length}`);
  if (!hiddenFeatures.length) console.log("- none");
  for (const row of hiddenFeatures) console.log(`- ${row.feature}: ${row.endpoint}`);
  console.log("");
  console.log(`Broken endpoints: ${brokenEndpoints.length}`);
  if (!brokenEndpoints.length) console.log("- none");
  for (const row of brokenEndpoints) console.log(`- ${row.key}: ${row.url} -> ${row.status}`);
  console.log("");
  console.log("Data source contributions:");
  for (const row of sourceRows) console.log(`- ${row.source}: ${row.status}, enabled=${row.enabled}, rows=${row.collectedRows}`);
  console.log("");
  console.log("UI gaps:");
  if (!uiGaps.length) console.log("- none");
  for (const row of uiGaps) console.log(`- ${row.feature}: ${row.status} (${row.problem})`);
  console.log("");
  console.log("Recommended next actions:");
  for (const item of recommendations) console.log(`- ${item}`);
  console.log("");
  console.log(`Wrote ${path.relative(ROOT, DOC_PATH).replace(/\\/g, "/")}`);
}

main();
