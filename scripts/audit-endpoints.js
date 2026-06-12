#!/usr/bin/env node

import fs from "fs";
import path from "path";

const ROOT = process.cwd();
const API_ROOT = path.join(ROOT, "dashboard", "api");
const DASHBOARD_HTML = path.join(ROOT, "dashboard", "index.html");
const MANIFEST_PATH = path.join(API_ROOT, "endpoint-manifest.json");
const TOO_LARGE_BYTES = 500 * 1024;
const STARTUP_SAFE_BYTES = 100 * 1024;
const STARTUP_SAFE_BOOTSTRAP_BYTES = 150 * 1024;
const STALE_HOURS = 36;
const AUXILIARY_ENDPOINT_PATTERNS = [
  /dashboard\/api\/aux\//,
  /source-csv/i,
  /vessel-spec/i,
  /ais-(?:info|dynamic|stat)/i,
  /pilotage/i,
  /berth/i,
  /vts/i,
  /ulsan/i
];
const DIAGNOSTIC_ENDPOINT_PATTERNS = [
  /dashboard\/api\/(?:debug|quality|review)\//,
  /dashboard\/api\/(?:status|source-health-runtime|source-collection-status|source-quality-score|storage-efficiency-report|health\/pipeline|backend|readiness|snapshot|coverage|doctor|audit|collector-plan|data-continuity|continuity)\.json$/i,
  /diagnostic/i,
  /imo-recovery-priority/i
];
const CORE_INITIAL_ENDPOINTS = new Set([
  "dashboard/api/bootstrap.json",
  "dashboard/api/status-summary.json",
  "dashboard/api/vessel-count-reconciliation.json",
  "dashboard/api/vessels/index.json",
  "dashboard/api/ports.json",
  "dashboard/api/targets/categories-summary.json",
  "dashboard/api/sales/verification-queue-summary.json"
]);

const ENDPOINT_SUMMARY_DETAIL_PAIRS = new Map([
  ["dashboard/api/all-collected-vessels.json", "dashboard/api/all-collected-vessels-summary.json"],
  ["dashboard/api/target-vessels.json", "dashboard/api/target-vessels-summary.json"],
  ["dashboard/api/vessels.json", "dashboard/api/vessels-summary.json"],
  ["dashboard/api/candidates.json", "dashboard/api/candidates-summary.json"],
  ["dashboard/api/candidates/top.json", "dashboard/api/candidates/top-summary.json"],
  ["dashboard/api/hot-vessels.json", "dashboard/api/hot-vessels-summary.json"],
  ["dashboard/api/sales/actions.json", "dashboard/api/sales/actions-summary.json"],
  ["dashboard/api/sales/verification-queue.json", "dashboard/api/sales/verification-queue-summary.json"],
  ["dashboard/api/targets/current.json", "dashboard/api/targets/current-summary.json"],
  ["dashboard/api/targets/categories.json", "dashboard/api/targets/categories-summary.json"],
  ["dashboard/api/staying-vessels.json", "dashboard/api/staying-vessels-summary.json"],
  ["dashboard/api/anchorage-waiting.json", "dashboard/api/anchorage-waiting-summary.json"],
  ["dashboard/api/arrival-pipeline.json", "dashboard/api/arrival-pipeline-summary.json"],
  ["dashboard/api/predicted-arrivals.json", "dashboard/api/predicted-arrivals-summary.json"],
  ["dashboard/api/commercial-command-center.json", "dashboard/api/commercial-command-center-summary.json"],
  ["dashboard/api/biofouling/vessel-risk-scores.json", "dashboard/api/biofouling/vessel-risk-scores-summary.json"],
  ["dashboard/api/intelligence/contact-coverage.json", "dashboard/api/intelligence/contact-coverage-summary.json"],
  ["dashboard/api/status.json", "dashboard/api/status-summary.json"]
]);
const ENDPOINT_DETAIL_BY_SUMMARY = new Map([...ENDPOINT_SUMMARY_DETAIL_PAIRS.entries()].map(([detail, summary]) => [summary, detail]));

const IMPORTANT_ENDPOINTS = [
  ["bootstrap", "dashboard/api/bootstrap.json"],
  ["status.summary", "dashboard/api/status-summary.json"],
  ["vessel.countReconciliation", "dashboard/api/vessel-count-reconciliation.json"],
  ["vessels.index", "dashboard/api/vessels/index.json"],
  ["ports", "dashboard/api/ports.json"],
  ["candidates.topSummary", "dashboard/api/candidates/top-summary.json"],
  ["candidates.top", "dashboard/api/candidates/top.json"],
  ["status", "dashboard/api/status.json"],
  ["dashboard-summary", "dashboard/api/dashboard-summary.json"],
  ["sales.actionsSummary", "dashboard/api/sales/actions-summary.json"],
  ["sales.actions", "dashboard/api/sales/actions.json"],
  ["sales.conversionPipeline", "dashboard/api/sales/conversion-pipeline.json"],
  ["sales.quoteOpportunities", "dashboard/api/sales/quote-opportunities.json"],
  ["sales.verificationQueueSummary", "dashboard/api/sales/verification-queue-summary.json"],
  ["sales.verificationQueue", "dashboard/api/sales/verification-queue.json"],
  ["watchlist.current", "dashboard/api/watchlist/current.json"],
  ["targets.currentSummary", "dashboard/api/targets/current-summary.json"],
  ["targets.current", "dashboard/api/targets/current.json"],
  ["targets.categoriesSummary", "dashboard/api/targets/categories-summary.json"],
  ["targets.categories", "dashboard/api/targets/categories.json"],
  ["vessels.page1", "dashboard/api/vessels/page-1.json"],
  ["aux.sourceCsvSummary", "dashboard/api/aux/source-csv-summary.json"],
  ["aux.pilotageSummary", "dashboard/api/aux/pilotage-summary.json"],
  ["aux.berthSummary", "dashboard/api/aux/berth-summary.json"],
  ["aux.aisInfoSummary", "dashboard/api/aux/ais-info-summary.json"],
  ["aux.aisDynamicSummary", "dashboard/api/aux/ais-dynamic-summary.json"],
  ["aux.vesselSpecSummary", "dashboard/api/aux/vessel-spec-summary.json"],
  ["source.healthRuntime", "dashboard/api/source-health-runtime.json"],
  ["source.collectionStatus", "dashboard/api/source-collection-status.json"],
  ["source.qualityScore", "dashboard/api/source-quality-score.json"],
  ["storage.efficiency", "dashboard/api/storage-efficiency-report.json"],
  ["intelligence.fleetIntelligence", "dashboard/api/intelligence/fleet-intelligence.json"],
  ["intelligence.fleetPenetration", "dashboard/api/intelligence/fleet-penetration.json"],
  ["intelligence.revenueForecast", "dashboard/api/intelligence/revenue-forecast.json"],
  ["intelligence.portDna", "dashboard/api/intelligence/port-dna.json"],
  ["intelligence.opportunityMemory", "dashboard/api/intelligence/opportunity-memory.json"],
  ["intelligence.contactCoverageSummary", "dashboard/api/intelligence/contact-coverage-summary.json"],
  ["intelligence.contactCoverage", "dashboard/api/intelligence/contact-coverage.json"],
  ["intelligence.complianceExposure", "dashboard/api/intelligence/compliance-exposure.json"],
  ["intelligence.cleaningWindow", "dashboard/api/intelligence/cleaning-window.json"]
];

const CRITICAL_ENDPOINTS = new Set([
  "dashboard/api/bootstrap.json",
  "dashboard/api/status.json",
  "dashboard/api/dashboard-summary.json",
  "dashboard/api/sales/actions.json",
  "dashboard/api/sales/conversion-pipeline.json",
  "dashboard/api/watchlist/current.json",
  "dashboard/api/vessels/index.json",
  "dashboard/api/vessels/page-1.json",
  "dashboard/api/vessel-count-reconciliation.json"
]);

const SNAPSHOT_CONTEXT_FILES = [
  "dashboard/api/bootstrap.json",
  "dashboard/api/status-summary.json",
  "dashboard/api/vessel-count-reconciliation.json"
];

const WRAPPER_PATTERNS = [
  /^dashboard\/api\/sales\//,
  /^dashboard\/api\/watchlist\//,
  /^dashboard\/api\/targets\//,
  /^dashboard\/api\/intelligence\//,
  /^dashboard\/api\/reports\//,
  /^dashboard\/api\/candidates\/top\.json$/,
  /^dashboard\/api\/arrival-pipeline\.json$/,
  /^dashboard\/api\/anchorage-waiting\.json$/,
  /^dashboard\/api\/staying-vessels\.json$/,
  /^dashboard\/api\/congestion-watchlist\.json$/,
  /^dashboard\/api\/agent-followup-queue\.json$/
];

function toRepoPath(filePath) {
  return path.relative(ROOT, filePath).replace(/\\/g, "/");
}

function listJsonFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listJsonFiles(full));
    else if (entry.isFile() && entry.name.endsWith(".json")) out.push(full);
  }
  return out;
}

function rows(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.vessels)) return payload.vessels;
  if (Array.isArray(payload?.candidates)) return payload.candidates;
  if (Array.isArray(payload?.opportunities)) return payload.opportunities;
  if (Array.isArray(payload?.contact_today)) return payload.contact_today;
  if (Array.isArray(payload?.ports)) return payload.ports;
  if (Array.isArray(payload?.categories)) return payload.categories;
  if (Array.isArray(payload?.endpoints)) return payload.endpoints;
  return [];
}

function itemCount(payload) {
  return rows(payload).length;
}

function firstJsonCharacter(text = "") {
  const match = String(text || "").replace(/^\uFEFF/, "").match(/\S/);
  return match ? match[0] : "";
}

function rootType(payload) {
  if (Array.isArray(payload)) return "array";
  if (payload === null) return "null";
  return typeof payload;
}

function recordCount(payload) {
  const direct = Number(payload?.record_count ?? payload?.total_count ?? payload?.total_vessels);
  return Number.isFinite(direct) ? direct : rows(payload).length;
}

function readJson(relativePath) {
  try {
    const filePath = path.join(ROOT, ...relativePath.split("/"));
    return fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, "utf8")) : null;
  } catch {
    return null;
  }
}

function snapshotContextFromDisk() {
  const loaded = SNAPSHOT_CONTEXT_FILES
    .map(readJson)
    .filter(payload => payload && typeof payload === "object" && !Array.isArray(payload));
  const bootstrap = loaded[0] || {};
  const firstWithContext = loaded.find(payload => payload.snapshot_context && typeof payload.snapshot_context === "object") || {};
  const context = firstWithContext.snapshot_context || {};
  const generatedAt = context.generated_at ||
    bootstrap.generated_at ||
    loaded.find(payload => payload.generated_at)?.generated_at ||
    new Date().toISOString();
  const runId = context.run_id ||
    bootstrap.run_id ||
    loaded.find(payload => payload.run_id)?.run_id ||
    loaded.find(payload => payload.active_run_id)?.active_run_id ||
    null;
  const sourceRunId = context.source_run_id ||
    bootstrap.source_run_id ||
    loaded.find(payload => payload.source_run_id)?.source_run_id ||
    loaded.find(payload => payload.latest_successful_run_id)?.latest_successful_run_id ||
    runId ||
    null;
  const dataMode = context.data_mode ||
    bootstrap.data_mode ||
    loaded.find(payload => payload.data_mode)?.data_mode ||
    "live";
  return {
    run_id: runId,
    generated_at: generatedAt,
    data_mode: dataMode,
    source_run_id: sourceRunId
  };
}

function hasArrayPayload(payload) {
  return Array.isArray(payload?.items) ||
    Array.isArray(payload?.data) ||
    Array.isArray(payload?.vessels) ||
    Array.isArray(payload?.candidates) ||
    Array.isArray(payload?.opportunities) ||
    Array.isArray(payload?.contact_today) ||
    Array.isArray(payload?.ports) ||
    Array.isArray(payload?.categories) ||
    Array.isArray(payload?.endpoints);
}

function needsWrapper(relativePath) {
  return WRAPPER_PATTERNS.some(pattern => pattern.test(relativePath));
}

function isCritical(relativePath) {
  return CRITICAL_ENDPOINTS.has(relativePath);
}

function sourceLayer(relativePath = "") {
  const normalized = String(relativePath || "").replace(/\\/g, "/");
  if (DIAGNOSTIC_ENDPOINT_PATTERNS.some(pattern => pattern.test(normalized))) return "diagnostic";
  if (AUXILIARY_ENDPOINT_PATTERNS.some(pattern => pattern.test(normalized))) return "auxiliary";
  return "core";
}

function loadStrategy(relativePath = "", { startupSafe = false } = {}) {
  const normalized = String(relativePath || "").replace(/\\/g, "/");
  const layer = sourceLayer(normalized);
  if (layer === "diagnostic") return "diagnostic_only";
  if (layer === "auxiliary") return normalized.startsWith("dashboard/api/aux/") ? "lazy" : "on_demand";
  return startupSafe && CORE_INITIAL_ENDPOINTS.has(normalized) ? "initial" : "lazy";
}

function startupSafe(relativePath, bytes = 0, { validJson = true, schemaValid = true } = {}) {
  const normalized = String(relativePath || "").replace(/\\/g, "/");
  if (!validJson || !schemaValid) return false;
  if (sourceLayer(normalized) !== "core") return false;
  if (!CORE_INITIAL_ENDPOINTS.has(normalized)) return false;
  if (normalized === "dashboard/api/bootstrap.json") return bytes <= STARTUP_SAFE_BOOTSTRAP_BYTES;
  if (/dashboard\/api\/(?:status-summary|targets\/categories-summary|sales\/verification-queue-summary)\.json$/.test(normalized)) {
    return bytes <= STARTUP_SAFE_BYTES;
  }
  if (normalized === "dashboard/api/vessel-count-reconciliation.json" || normalized === "dashboard/api/vessels/index.json" || normalized === "dashboard/api/ports.json") {
    return bytes <= STARTUP_SAFE_BYTES;
  }
  return false;
}

function summaryPathFor(relativePath = "") {
  const normalized = String(relativePath || "").replace(/\\/g, "/");
  if (/^dashboard\/api\/ports\/[^/]+\/vessels\.json$/.test(normalized)) {
    return normalized.replace(/\/vessels\.json$/, "/vessels-summary.json");
  }
  return ENDPOINT_SUMMARY_DETAIL_PAIRS.get(normalized) || null;
}

function detailPathFor(relativePath = "") {
  const normalized = String(relativePath || "").replace(/\\/g, "/");
  if (/^dashboard\/api\/ports\/[^/]+\/vessels-summary\.json$/.test(normalized)) {
    return normalized.replace(/\/vessels-summary\.json$/, "/vessels.json");
  }
  return ENDPOINT_DETAIL_BY_SUMMARY.get(normalized) || null;
}

function maxRecommendedSizeKb(relativePath = "", { startupSafe: isStartupSafe = false } = {}) {
  const normalized = String(relativePath || "").replace(/\\/g, "/");
  if (isStartupSafe) return normalized === "dashboard/api/bootstrap.json" ? 150 : 100;
  if (summaryPathFor(normalized) || detailPathFor(normalized)) return detailPathFor(normalized) ? 100 : 500;
  if (sourceLayer(normalized) === "diagnostic") return 500;
  return 500;
}

function recommendedLoad(relativePath = "", { startupSafe: isStartupSafe = false, summaryAvailable = false } = {}) {
  const normalized = String(relativePath || "").replace(/\\/g, "/");
  if (isStartupSafe) return "initial";
  if (detailPathFor(normalized)) return "summary";
  if (summaryAvailable) return "lazy_detail";
  if (sourceLayer(normalized) === "diagnostic") return "diagnostic_only";
  if (sourceLayer(normalized) === "auxiliary") return "lazy";
  return "lazy";
}

function duplicatedPayloadRisk(relativePath = "", text = "", { bytes = 0, itemCount = 0 } = {}) {
  const normalized = String(relativePath || "").replace(/\\/g, "/");
  const vesselDisplayRepeats = (String(text || "").match(/"vessel_display"/g) || []).length;
  if (detailPathFor(normalized)) return "LOW";
  if (vesselDisplayRepeats > 100 || (bytes > TOO_LARGE_BYTES && vesselDisplayRepeats > 25)) return "HIGH";
  if (vesselDisplayRepeats > 25 || (bytes > TOO_LARGE_BYTES && itemCount > 25)) return "MEDIUM";
  return "LOW";
}

function staleHours(payload) {
  const value = payload?.generated_at || payload?.last_success_at || payload?.updated_at;
  const time = Date.parse(value || "");
  if (!Number.isFinite(time)) return null;
  return (Date.now() - time) / 36e5;
}

function findUndefinedLike(value, currentPath = "$", found = []) {
  if (found.length > 20) return found;
  if (typeof value === "string" && /^(undefined|nan|infinity|-infinity)$/i.test(value.trim())) {
    found.push(currentPath);
  } else if (Array.isArray(value)) {
    value.forEach((item, index) => findUndefinedLike(item, `${currentPath}[${index}]`, found));
  } else if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) findUndefinedLike(child, `${currentPath}.${key}`, found);
  }
  return found;
}

function validateSchema(relativePath, payload) {
  if (!payload || typeof payload !== "object") return "root object or array required";
  if (Array.isArray(payload)) return "";
  if (relativePath.endsWith("endpoint-manifest.json")) {
    if (!payload.schema_version) return "missing schema_version";
    if (!payload.generated_at) return "missing generated_at";
    if (!Array.isArray(payload.endpoints)) return "missing endpoints array";
    return "";
  }
  const strictWrapper = isCritical(relativePath) || needsWrapper(relativePath);
  if (!strictWrapper) return "";
  if (!payload.schema_version) return "missing schema_version";
  if (!payload.generated_at) return "missing generated_at";
  if (!Number.isFinite(Number(payload.record_count ?? payload.total_count ?? payload.total_vessels))) return "missing numeric record_count";
  if (needsWrapper(relativePath) && !hasArrayPayload(payload)) return "missing items/data array";
  return "";
}

function writeJsonAtomically(filePath, payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error(`Refusing to write non-object JSON payload: ${filePath}`);
  }
  const body = `${JSON.stringify(payload, null, 2)}\n`;
  const parsed = JSON.parse(body);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Refusing to write non-object JSON root: ${filePath}`);
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  try {
    fs.writeFileSync(tempPath, body, "utf8");
    JSON.parse(fs.readFileSync(tempPath, "utf8"));
    fs.renameSync(tempPath, filePath);
  } catch (error) {
    try {
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    } catch {
      // Best effort cleanup only.
    }
    throw error;
  }
}

function auditFile(relativePath) {
  const filePath = path.join(ROOT, ...relativePath.split("/"));
  if (!fs.existsSync(filePath)) {
    return {
      endpoint: relativePath,
      path: relativePath,
      exists: false,
      first_char: "",
      root_type: "missing",
      parsed_from_disk: true,
      valid_json: false,
      schema_valid: false,
      record_count: 0,
      item_count: 0,
      size_kb: 0,
      bytes: 0,
      source_layer: sourceLayer(relativePath),
      startup_safe: false,
      load_strategy: loadStrategy(relativePath, { startupSafe: false }),
      duplicated_payload_risk: "LOW",
      summary_available: false,
      detail_available: false,
      recommended_load: recommendedLoad(relativePath, { startupSafe: false, summaryAvailable: false }),
      max_recommended_size_kb: maxRecommendedSizeKb(relativePath, { startupSafe: false }),
      status: "MISSING",
      problem: "file missing"
    };
  }
  const bytes = fs.statSync(filePath).size;
  const text = fs.readFileSync(filePath, "utf8");
  try {
    const firstChar = firstJsonCharacter(text);
    if (firstChar !== "{") {
      throw new Error(`dashboard endpoint must start with object root; first_char=${firstChar || "empty"}`);
    }
    const payload = JSON.parse(text);
    const root = rootType(payload);
    if (root !== "object") {
      throw new Error(`dashboard endpoint root object required; root_type=${root}`);
    }
    const undefinedLike = findUndefinedLike(payload);
    const schemaProblem = validateSchema(relativePath, payload);
    const schemaValid = !schemaProblem && !undefinedLike.length;
    const age = staleHours(payload);
    const count = recordCount(payload);
    const actualItemCount = itemCount(payload);
    let status = "OK";
    let problem = "";
    if (undefinedLike.length) {
      status = "SCHEMA_MISMATCH";
      problem = `undefined-like string at ${undefinedLike.slice(0, 3).join(", ")}`;
    } else if (schemaProblem) {
      status = "SCHEMA_MISMATCH";
      problem = schemaProblem;
    } else if (bytes > TOO_LARGE_BYTES) {
      status = "TOO_LARGE";
      problem = `${Math.round(bytes / 1024)}KB`;
    } else if (age !== null && age > STALE_HOURS) {
      status = "STALE";
      problem = `${Math.round(age)}h old`;
    } else if (count === 0 && hasArrayPayload(payload)) {
      status = "EMPTY_VALID";
      problem = "0 records";
    }
    const safeForStartup = startupSafe(relativePath, bytes, { validJson: true, schemaValid });
    const summaryPath = summaryPathFor(relativePath);
    const detailPath = detailPathFor(relativePath);
    const summaryAvailable = summaryPath ? fs.existsSync(path.join(ROOT, ...summaryPath.split("/"))) : Boolean(detailPath);
    const detailAvailable = detailPath ? fs.existsSync(path.join(ROOT, ...detailPath.split("/"))) : Boolean(summaryPath);
    return {
      endpoint: relativePath,
      path: relativePath,
      exists: true,
      first_char: firstChar,
      root_type: root,
      parsed_from_disk: true,
      valid_json: true,
      schema_valid: schemaValid,
      record_count: count,
      item_count: actualItemCount,
      size_kb: Math.round((bytes / 1024) * 10) / 10,
      bytes,
      source_layer: sourceLayer(relativePath),
      startup_safe: safeForStartup,
      load_strategy: loadStrategy(relativePath, { startupSafe: safeForStartup }),
      duplicated_payload_risk: duplicatedPayloadRisk(relativePath, text, { bytes, itemCount: actualItemCount }),
      summary_available: summaryAvailable,
      detail_available: detailAvailable,
      recommended_load: recommendedLoad(relativePath, { startupSafe: safeForStartup, summaryAvailable }),
      max_recommended_size_kb: maxRecommendedSizeKb(relativePath, { startupSafe: safeForStartup }),
      status,
      problem
    };
  } catch (error) {
    return {
      endpoint: relativePath,
      path: relativePath,
      exists: true,
      first_char: firstJsonCharacter(text) || "",
      root_type: "invalid",
      parsed_from_disk: true,
      valid_json: false,
      schema_valid: false,
      record_count: 0,
      item_count: 0,
      size_kb: Math.round((bytes / 1024) * 10) / 10,
      bytes,
      source_layer: sourceLayer(relativePath),
      startup_safe: false,
      load_strategy: loadStrategy(relativePath, { startupSafe: false }),
      duplicated_payload_risk: "UNKNOWN",
      summary_available: Boolean(summaryPathFor(relativePath)),
      detail_available: Boolean(detailPathFor(relativePath)),
      recommended_load: recommendedLoad(relativePath, { startupSafe: false, summaryAvailable: Boolean(summaryPathFor(relativePath)) }),
      max_recommended_size_kb: maxRecommendedSizeKb(relativePath, { startupSafe: false }),
      status: "INVALID_JSON",
      problem: error.message
    };
  }
}

function readDashboardEndpointMap() {
  const html = fs.existsSync(DASHBOARD_HTML) ? fs.readFileSync(DASHBOARD_HTML, "utf8") : "";
  const endpoints = new Map();
  for (const match of html.matchAll(/api\("([^"]+)","([^"]+)"/g)) {
    const pathValue = match[2].replace(/^\/api\//, "dashboard/api/").replace(/\?.*$/, "");
    endpoints.set(match[1], pathValue);
  }
  for (const match of html.matchAll(/\{key:"([^"]+)",title:"[^"]+",path:"([^"]+)"/g)) {
    const pathValue = match[2].replace(/^\/api\//, "dashboard/api/").replace(/\?.*$/, "");
    endpoints.set(`insight:${match[1]}`, pathValue);
  }
  return endpoints;
}

function writeManifest(entries) {
  const context = snapshotContextFromDisk();
  const entryByPath = new Map(entries.map(entry => [entry.path, entry]));
  const importantKeyByPath = new Map(IMPORTANT_ENDPOINTS.map(([key, relativePath]) => [relativePath, key]));
  const endpointPaths = [...new Set([...IMPORTANT_ENDPOINTS.map(([, relativePath]) => relativePath), ...entries.map(entry => entry.path)])].sort();
  const totalEndpointCount = endpointPaths.length;
  const endpoints = endpointPaths.map((relativePath) => {
    const entry = entryByPath.get(relativePath) || auditFile(relativePath);
    const key = importantKeyByPath.get(relativePath)
      || relativePath.replace(/^dashboard\/api\//, "").replace(/\.json$/, "").replace(/[\\/]+/g, ".");
    const isManifestEntry = relativePath === "dashboard/api/endpoint-manifest.json";
    return {
      key,
      path: relativePath,
      exists: isManifestEntry ? true : entry.exists,
      first_char: isManifestEntry ? "{" : (entry.first_char || ""),
      root_type: isManifestEntry ? "object" : (entry.root_type || (entry.exists ? "unknown" : "missing")),
      parsed_from_disk: true,
      parse_checked_at: context.generated_at,
      valid_json: isManifestEntry ? true : entry.valid_json,
      schema_valid: isManifestEntry ? true : entry.schema_valid,
      record_count: isManifestEntry ? totalEndpointCount : entry.record_count,
      item_count: isManifestEntry ? totalEndpointCount : entry.item_count,
      size_kb: entry.size_kb ?? Math.round(((entry.bytes || 0) / 1024) * 10) / 10,
      bytes: entry.bytes || 0,
      source_layer: entry.source_layer || sourceLayer(relativePath),
      startup_safe: entry.startup_safe === true,
      load_strategy: entry.load_strategy || loadStrategy(relativePath, { startupSafe: entry.startup_safe === true }),
      duplicated_payload_risk: entry.duplicated_payload_risk || "LOW",
      summary_available: entry.summary_available === true,
      detail_available: entry.detail_available === true,
      recommended_load: entry.recommended_load || recommendedLoad(relativePath, { startupSafe: entry.startup_safe === true, summaryAvailable: entry.summary_available === true }),
      max_recommended_size_kb: entry.max_recommended_size_kb || maxRecommendedSizeKb(relativePath, { startupSafe: entry.startup_safe === true }),
      status: entry.status,
      problem: entry.problem || ""
    };
  });
  const manifest = {
    schema_version: "1.0",
    generated_at: context.generated_at,
    data_mode: context.data_mode,
    run_id: context.run_id,
    source_run_id: context.source_run_id,
    snapshot_context: context,
    record_count: endpoints.length,
    item_count: endpoints.length,
    endpoints
  };
  writeJsonAtomically(MANIFEST_PATH, manifest);
  return manifest;
}

const existingFiles = listJsonFiles(API_ROOT).map(toRepoPath);
const importantPaths = IMPORTANT_ENDPOINTS.map(([, endpointPath]) => endpointPath);
const allPaths = [...new Set([...existingFiles, ...importantPaths])].sort();
const entries = allPaths.map(auditFile);
const manifest = writeManifest(entries);
const endpointMap = readDashboardEndpointMap();

console.log("Endpoint | Path | Exists | Valid JSON | Schema Valid | Source Layer | Load Strategy | Size KB | Record Count | Item Count | Startup Safe | Status | Problem");
for (const entry of entries) {
  console.log([
    entry.endpoint,
    entry.path,
    entry.exists ? "yes" : "no",
    entry.valid_json ? "yes" : "no",
    entry.schema_valid ? "yes" : "no",
    entry.source_layer || sourceLayer(entry.path),
    entry.load_strategy || loadStrategy(entry.path, { startupSafe: entry.startup_safe === true }),
    entry.size_kb ?? Math.round(((entry.bytes || 0) / 1024) * 10) / 10,
    entry.record_count,
    entry.item_count,
    entry.startup_safe ? "yes" : "no",
    entry.status,
    entry.problem || "-"
  ].join(" | "));
}

console.log("\nFrontend endpoint map:");
for (const [key, endpointPath] of [...endpointMap.entries()].sort()) {
  const entry = entries.find(item => item.path === endpointPath) || auditFile(endpointPath);
  console.log(`- ${key}: ${endpointPath} -> ${entry.status}${entry.problem ? ` (${entry.problem})` : ""}`);
}

console.log("\nStartup heavy-file warnings:");
const heavyStartup = [...endpointMap.entries()]
  .filter(([, endpointPath]) => /imo-recovery-priority|vessels\/page-(?!1\.json)\d+|audit|diagnostic|debug/i.test(endpointPath))
  .map(([key, endpointPath]) => `${key}: ${endpointPath}`);
if (heavyStartup.length) heavyStartup.forEach(line => console.log(`- WARNING ${line}`));
else console.log("- none");

console.log(`\nManifest written: dashboard/api/endpoint-manifest.json (${manifest.record_count} endpoints)`);

const invalidJson = entries.filter(entry => entry.status === "INVALID_JSON");
const missingCritical = entries.filter(entry => isCritical(entry.path) && entry.status === "MISSING");
const schemaCritical = entries.filter(entry => isCritical(entry.path) && !entry.schema_valid);
const criticalManifestFailures = manifest.endpoints.filter(entry => CRITICAL_ENDPOINTS.has(entry.path) && (entry.status === "INVALID_JSON" || entry.status === "MISSING" || !entry.schema_valid));

if (invalidJson.length || missingCritical.length || schemaCritical.length || criticalManifestFailures.length) {
  console.error("\nEndpoint audit failed:");
  for (const entry of [...invalidJson, ...missingCritical, ...schemaCritical, ...criticalManifestFailures]) {
    console.error(`- ${entry.path}: ${entry.status} ${entry.problem || ""}`.trim());
  }
  process.exit(1);
}
