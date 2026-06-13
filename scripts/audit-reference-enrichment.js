import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

const FILES = {
  sourceCsvSummary: "dashboard/api/aux/source-csv-summary.json",
  sourceCsvReference: "dashboard/api/cache/source-csv-reference.json",
  sourceCsvIndex: "dashboard/api/cache/source-csv-index.json",
  vesselSpecSummary: "dashboard/api/aux/vessel-spec-summary.json",
  latestIndex: "dashboard/api/enrichment/latest/index.json",
  latestSummary: "dashboard/api/enrichment/latest/summary.json",
  latestCandidates: "dashboard/api/enrichment/latest/candidates.json",
  latestApplied: "dashboard/api/enrichment/latest/applied.json",
  latestReview: "dashboard/api/enrichment/latest/review-queue.json",
  latestPatches: "dashboard/api/enrichment/latest/patches.json",
  legacySummary: "dashboard/api/enrichment/summary.json",
  legacyCandidates: "dashboard/api/enrichment/candidates.json",
  legacyApplied: "dashboard/api/enrichment/applied.json",
  legacyReview: "dashboard/api/enrichment/review-queue.json",
  updateScript: "scripts/update.js",
  runModeScript: "scripts/run-update-mode.js",
  collectorScript: "scripts/collectors/korea.js"
};

const PATCH_ALLOWED_FIELDS = new Set([
  "imo",
  "mmsi",
  "call_sign",
  "operator_display",
  "owner",
  "manager",
  "vessel_type",
  "gt",
  "dwt",
  "flag",
  "loa",
  "beam"
]);

const PATCH_ALLOWED_SOURCES = new Set([
  "manual_reference",
  "source_csv",
  "vessel_spec",
  "mof_ais_info"
]);

function readJson(relativePath, fallback = {}) {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), "utf8"));
  } catch (error) {
    return { ...fallback, _read_error: error.message };
  }
}

function readText(relativePath) {
  try {
    return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
  } catch {
    return "";
  }
}

function exists(relativePath) {
  return fs.existsSync(path.join(ROOT, relativePath));
}

function fileSize(relativePath) {
  try {
    return fs.statSync(path.join(ROOT, relativePath)).size;
  } catch {
    return 0;
  }
}

function items(payload = {}) {
  return Array.isArray(payload.items) ? payload.items : [];
}

function patches(payload = {}) {
  return Array.isArray(payload.patches) ? payload.patches : [];
}

function count(payload = {}) {
  return Number(payload.record_count || payload.item_count || items(payload).length || patches(payload).length || 0);
}

function sourceCounts(rows = []) {
  const out = {};
  for (const row of rows) {
    const source = row.source_key || row.lineage?.source || row.lineage?.raw_source || "unknown";
    if (!out[source]) out[source] = { count: 0, fields: {} };
    out[source].count += 1;
    const field = row.field_name || "unknown";
    out[source].fields[field] = (out[source].fields[field] || 0) + 1;
  }
  return out;
}

function conflictCount(rows = []) {
  return rows.filter(row => {
    const type = String(row.conflict_type || "").toUpperCase();
    return type.includes("CONFLICT") || type.includes("DIFFERENT_IMO") || type.includes("DIFFERENT_MMSI");
  }).length;
}

function requiredMetadataIssues(label, payload = {}) {
  const required = ["generated_at", "enrichment_run_id", "owner_tier", "stale_diagnostic", "patch_count", "review_count"];
  const missing = required.filter(field => payload[field] === undefined || payload[field] === null || payload[field] === "");
  const issues = missing.map(field => `${label}: missing ${field}`);
  if (payload.owner_tier !== "reference_enrichment") issues.push(`${label}: owner_tier=${payload.owner_tier || "missing"}`);
  if (payload.core_may_update !== false) issues.push(`${label}: core_may_update must be false`);
  if (!payload.source_run_ids || typeof payload.source_run_ids !== "object") issues.push(`${label}: missing source_run_ids`);
  return issues;
}

const sourceCsvSummary = readJson(FILES.sourceCsvSummary, {});
const sourceCsvReference = readJson(FILES.sourceCsvReference, {});
const sourceCsvIndex = readJson(FILES.sourceCsvIndex, {});
const vesselSpecSummary = readJson(FILES.vesselSpecSummary, {});
const latestIndex = readJson(FILES.latestIndex, {});
const latestSummary = readJson(FILES.latestSummary, {});
const latestCandidates = readJson(FILES.latestCandidates, {});
const latestApplied = readJson(FILES.latestApplied, {});
const latestReview = readJson(FILES.latestReview, {});
const latestPatches = readJson(FILES.latestPatches, {});
const legacySummary = readJson(FILES.legacySummary, {});
const legacyCandidates = readJson(FILES.legacyCandidates, {});
const legacyApplied = readJson(FILES.legacyApplied, {});
const legacyReview = readJson(FILES.legacyReview, {});

const updateScript = readText(FILES.updateScript);
const runModeScript = readText(FILES.runModeScript);
const collectorScript = readText(FILES.collectorScript);

const coreLightweightCsv = /core:\s*{[\s\S]*?SOURCE_CSV_MODE:\s*"lightweight"/.test(runModeScript);
const coreLightweightApply = /core:\s*{[\s\S]*?ENRICHMENT_MODE:\s*"lightweight_apply_cache"/.test(runModeScript);
const coreSkipsFullMatching = /IS_CORE_UPDATE \|\| ENRICHMENT_MODE === "lightweight"/.test(updateScript);
const coreAppliesCachedPatches = /applyCachedEnrichmentPatches/.test(updateScript) && /cachedPatchItemsFromPayload/.test(updateScript);
const sourceCsvLightweightCoreTier = /if \(key === "source_csv"\) return sourceCsvCoreCandidate\(\) \? "core" : "reference_enrichment"/.test(collectorScript);

const latestFiles = [
  ["index", latestIndex],
  ["summary", latestSummary],
  ["candidates", latestCandidates],
  ["applied", latestApplied],
  ["review-queue", latestReview],
  ["patches", latestPatches]
];

const problems = [];
const warnings = [];

for (const [label, payload] of latestFiles) {
  if (payload._read_error) problems.push(`enrichment/latest/${label}.json unreadable: ${payload._read_error}`);
  problems.push(...requiredMetadataIssues(`enrichment/latest/${label}.json`, payload));
}

for (const file of Object.values(FILES).filter(file => file.startsWith("dashboard/api/enrichment/latest/"))) {
  if (!exists(file)) problems.push(`missing ${file}`);
}

if (!exists(FILES.legacySummary) || !exists(FILES.legacyCandidates) || !exists(FILES.legacyApplied) || !exists(FILES.legacyReview)) {
  problems.push("missing one or more legacy enrichment compatibility outputs");
}

if (!exists(FILES.sourceCsvReference) || sourceCsvReference._read_error) {
  problems.push("source-csv-reference cache contract is missing/unreadable");
}
if (!exists(FILES.sourceCsvIndex) || sourceCsvIndex._read_error) {
  problems.push("source-csv-index cache contract is missing/unreadable");
}

if (!patches(latestPatches).length && !items(latestPatches).length) {
  warnings.push("patches.json has no patch items; this is acceptable only when no safe auto-apply candidates exist.");
}
if (items(latestPatches).length) {
  problems.push("patches.json must stay compact and must not include legacy field-level items");
}
if (patches(latestPatches).length) {
  const malformed = patches(latestPatches).filter(patch =>
    !patch.vessel_key ||
    !patch.fields ||
    typeof patch.fields !== "object" ||
    !patch.lineage ||
    typeof patch.lineage !== "object" ||
    patch.apply_policy !== "safe_auto_apply"
  ).length;
  if (malformed) problems.push(`patches.json has ${malformed} malformed compact patch(es)`);
  const disallowedFields = new Set();
  const disallowedSources = new Set();
  let missingFieldLineage = 0;
  for (const patch of patches(latestPatches)) {
    const fields = patch.fields && typeof patch.fields === "object" ? patch.fields : {};
    const lineage = patch.lineage && typeof patch.lineage === "object" ? patch.lineage : {};
    for (const fieldName of Object.keys(fields)) {
      if (!PATCH_ALLOWED_FIELDS.has(fieldName)) disallowedFields.add(fieldName);
      const fieldLineage = lineage[fieldName] && typeof lineage[fieldName] === "object" ? lineage[fieldName] : null;
      if (!fieldLineage?.source || !fieldLineage?.match_type) missingFieldLineage += 1;
    }
    for (const sourceKey of patch.source_keys || []) {
      if (!PATCH_ALLOWED_SOURCES.has(sourceKey)) disallowedSources.add(sourceKey);
    }
  }
  if (disallowedFields.size) problems.push(`patches.json has disallowed fields: ${[...disallowedFields].sort().join(",")}`);
  if (disallowedSources.size) problems.push(`patches.json has disallowed sources: ${[...disallowedSources].sort().join(",")}`);
  if (missingFieldLineage) problems.push(`patches.json has ${missingFieldLineage} field patch(es) missing source/match lineage`);
}

if (!coreLightweightCsv) problems.push("core preset must use SOURCE_CSV_MODE=lightweight");
if (!coreLightweightApply) problems.push("core preset must use ENRICHMENT_MODE=lightweight_apply_cache");
if (!coreSkipsFullMatching) problems.push("core update may recompute full enrichment matching");
if (!coreAppliesCachedPatches) problems.push("core update does not clearly apply cached enrichment patches");
if (!sourceCsvLightweightCoreTier) problems.push("source_csv collector must be core-owned only for lightweight/raw/off mode diagnostics");

const rejected = latestSummary.rejected ?? items(latestCandidates).filter(item => item.action === "REJECT").length;
const reviewRows = items(latestReview);
const appliedRows = items(latestApplied);
const patchRows = patches(latestPatches);

console.log("Reference enrichment audit");
console.log("==========================");
console.log(`source_csv_status=${sourceCsvSummary.status || "unknown"} source_too_large=${Boolean(sourceCsvSummary.source_too_large)} response_size_bytes=${sourceCsvSummary.response_size_bytes ?? 0}`);
console.log(`source_csv_cache=${exists(FILES.sourceCsvReference) ? "present" : "missing"} rows=${sourceCsvReference.item_count || sourceCsvReference.record_count || 0}`);
console.log(`source_csv_index=${exists(FILES.sourceCsvIndex) ? "present" : "missing"} counts=${JSON.stringify(sourceCsvSummary.reference_index_counts || sourceCsvSummary.reference_index_keys || {})}`);
console.log(`vessel_spec_status=${vesselSpecSummary.status || "unknown"} rows_collected=${vesselSpecSummary.rows_collected ?? 0} rows_normalized=${vesselSpecSummary.rows_normalized ?? 0}`);
console.log(`candidates_generated=${count(latestCandidates)}`);
console.log(`applied_patches=${count(latestApplied)} compact_patches=${patchRows.length}`);
console.log(`review_queue_items=${reviewRows.length}`);
console.log(`rejected_candidates=${rejected}`);
console.log(`conflicts=${conflictCount(reviewRows)}`);
console.log(`fields_enriched_by_source=${JSON.stringify(sourceCounts(appliedRows))}`);
console.log(`patch_count=${latestPatches.patch_count ?? patchRows.length} patch_file_size=${fileSize(FILES.latestPatches)}`);
console.log(`legacy_outputs=${[legacySummary, legacyCandidates, legacyApplied, legacyReview].filter(payload => !payload._read_error).length}/4`);
console.log(`core_recomputing_matching_incorrectly=${!(coreCacheOnly && coreLightweightApply && coreSkipsFullMatching && coreAppliesCachedPatches)}`);
console.log(`warnings=${warnings.length ? warnings.join("; ") : "none"}`);
console.log(`problems=${problems.length ? problems.join("; ") : "none"}`);

if (problems.length) process.exit(1);
