#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { detectSecrets } from "./lib/secrets.js";

const ROOT = process.cwd();
const SUPABASE_URL = String(process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const REST_URL = SUPABASE_URL ? `${SUPABASE_URL}/rest/v1` : "";
const PAGE_SIZE = 1000;
const MAX_ROWS = Number(process.env.AUDIT_IDENTITY_SOURCE_MAX_ROWS || 25000);

function clean(value) {
  return String(value ?? "").normalize("NFKC").trim();
}

function hasValue(value) {
  const text = clean(value);
  return Boolean(text && text !== "-" && !/^null$/i.test(text) && !/^undefined$/i.test(text));
}

function normalizeImo(value) {
  const digits = clean(value).replace(/\D+/g, "");
  return digits.length === 7 ? digits : "";
}

function normalizeMmsi(value) {
  const digits = clean(value).replace(/\D+/g, "");
  return digits.length === 9 ? digits : "";
}

function objectValue(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function payload(row = {}) {
  return objectValue(row.payload);
}

function first(row = {}, keys = []) {
  const body = payload(row);
  const display = objectValue(row.vessel_display);
  for (const key of keys) {
    const value = row[key] ?? body[key] ?? display[key];
    if (hasValue(value)) return value;
  }
  return "";
}

function hasImo(row = {}) {
  return Boolean(normalizeImo(first(row, ["imo", "imo_no", "imo_number"])));
}

function hasMmsi(row = {}) {
  return Boolean(normalizeMmsi(first(row, ["mmsi", "mmsi_no", "mmsi_number"])));
}

function parseCsv(text = "") {
  const lines = String(text || "").replace(/^\uFEFF/, "").split(/\r?\n/).filter(line => line.trim());
  if (lines.length < 2) return [];
  const parseLine = line => {
    const cells = [];
    let current = "";
    let quoted = false;
    for (let index = 0; index < line.length; index += 1) {
      const char = line[index];
      const next = line[index + 1];
      if (char === "\"" && quoted && next === "\"") {
        current += "\"";
        index += 1;
      } else if (char === "\"") {
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
    const cells = parseLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, cells[index] || ""]));
  });
}

function readJson(relativePath, fallback = {}) {
  const file = path.join(ROOT, ...relativePath.split("/"));
  try {
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : fallback;
  } catch {
    return fallback;
  }
}

function readLocalCsv(relativePath) {
  const file = path.join(ROOT, ...relativePath.split("/"));
  if (!fs.existsSync(file)) return [];
  return parseCsv(fs.readFileSync(file, "utf8"));
}

function rows(payload = {}) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.items)) return payload.items;
  if (Array.isArray(payload.data)) return payload.data;
  if (Array.isArray(payload.vessels)) return payload.vessels;
  if (Array.isArray(payload.candidates)) return payload.candidates;
  return [];
}

function sourceText(row = {}) {
  const body = payload(row);
  return [
    row.source_name,
    row.source,
    row.source_profile,
    row.data_source_used,
    row.enrichment_source,
    body.source_name,
    body.source,
    ...(Array.isArray(row.source_names) ? row.source_names : []),
    ...(Array.isArray(row.data_sources) ? row.data_sources : [])
  ].filter(hasValue).join(" | ");
}

function sourceRows(snapshotRows = [], pattern) {
  return snapshotRows.filter(row => pattern.test(sourceText(row)));
}

function summarize(rows = []) {
  return {
    loaded: rows.length,
    with_imo: rows.filter(hasImo).length,
    with_mmsi: rows.filter(hasMmsi).length,
    with_call_sign: rows.filter(row => hasValue(first(row, ["call_sign", "callsign", "clsgn"]))).length
  };
}

function parseContentRange(value) {
  const match = clean(value).match(/\/(\d+|\*)$/);
  if (!match || match[1] === "*") return null;
  const count = Number(match[1]);
  return Number.isFinite(count) ? count : null;
}

function urlFor(table, params = {}) {
  const url = new URL(`${REST_URL}/${table}`);
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    url.searchParams.append(key, value);
  }
  return url.toString();
}

async function rest(table, params = {}, options = {}) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return { ok: false, rows: [], count: null, error: "missing_supabase_env" };
  }
  const response = await fetch(urlFor(table, params), {
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      accept: "application/json",
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return {
    ok: response.ok,
    status: response.status,
    rows: Array.isArray(body) ? body : [],
    count: parseContentRange(response.headers.get("content-range")),
    error: response.ok ? null : body?.message || body?.details || body?.hint || text || `http_${response.status}`
  };
}

async function fetchRows(table, { filters = {}, order = "", maxRows = MAX_ROWS, select = "*" } = {}) {
  const out = [];
  let total = null;
  for (let offset = 0; offset < maxRows; offset += PAGE_SIZE) {
    const params = { select, ...filters };
    if (order) params.order = order;
    const result = await rest(table, params, {
      headers: {
        prefer: offset === 0 ? "count=exact" : undefined,
        range: `${offset}-${Math.min(offset + PAGE_SIZE - 1, maxRows - 1)}`
      }
    });
    if (!result.ok) return { ok: false, rows: out, count: total, error: result.error };
    if (offset === 0) total = result.count;
    out.push(...result.rows);
    if (result.rows.length < PAGE_SIZE) break;
  }
  return { ok: true, rows: out, count: total ?? out.length };
}

async function latestRunId() {
  const pointer = await rest("active_dataset_pointer", { select: "active_run_id", id: "eq.current", limit: "1" });
  if (pointer.ok && pointer.rows[0]?.active_run_id) return pointer.rows[0].active_run_id;
  const latest = await rest("data_collection_runs", { select: "run_id,status,finished_at", order: "finished_at.desc.nullslast", limit: "1" });
  return latest.ok ? latest.rows[0]?.run_id || null : null;
}

async function fetchSourceCsvRows() {
  const configured = hasValue(process.env.SOURCE_CSV_URL);
  const enabled = String(process.env.ENABLE_SOURCE_CSV || "").toLowerCase() === "true";
  const localSeedRows = readLocalCsv("data/reference/vessel_master_seed.csv").map(row => ({ ...row, reference_source: "vessel_master_seed" }));
  const result = {
    configured,
    enabled,
    local_seed_rows: localSeedRows.length,
    remote_status: configured && enabled ? "not_attempted" : configured ? "disabled_by_ENABLE_SOURCE_CSV" : "not_configured",
    rows: [...localSeedRows]
  };
  if (!configured || !enabled) return result;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    const response = await fetch(process.env.SOURCE_CSV_URL, { signal: controller.signal });
    clearTimeout(timeout);
    const text = await response.text();
    if (!response.ok) {
      result.remote_status = `http_${response.status}`;
      return result;
    }
    const contentType = response.headers.get("content-type") || "";
    const remoteRows = /json/i.test(contentType)
      ? rows(JSON.parse(text))
      : parseCsv(text);
    result.remote_status = "loaded";
    result.rows.push(...remoteRows.map(row => ({ ...row, reference_source: "source_csv" })));
  } catch (error) {
    result.remote_status = `failed:${error?.message || String(error)}`;
  }
  return result;
}

function printSource(name, summary) {
  console.log(`- ${name} rows loaded: ${summary.loaded}`);
  console.log(`- ${name} rows with IMO: ${summary.with_imo}`);
  console.log(`- ${name} rows with MMSI: ${summary.with_mmsi}`);
}

async function main() {
  console.log("Identity source availability audit:");
  const secrets = detectSecrets();
  const sourceCsv = await fetchSourceCsvRows();
  const sourceCsvSummary = summarize(sourceCsv.rows);
  const runId = await latestRunId();
  let snapshotRows = [];
  let snapshotStatus = "static_json";
  if (runId) {
    const fetched = await fetchRows("vessel_snapshots", {
      filters: { run_id: `eq.${runId}` },
      select: "run_id,source_name,source,vessel_name,imo,mmsi,call_sign,gt,vessel_type,payload",
      order: "collected_at.desc.nullslast"
    });
    if (fetched.ok) {
      snapshotRows = fetched.rows;
      snapshotStatus = "supabase";
    } else {
      snapshotStatus = `supabase_error:${fetched.error}`;
    }
  }
  if (!snapshotRows.length) {
    const page = readJson("dashboard/api/vessels/page-1.json", {});
    const all = readJson("dashboard/api/all-collected-vessels.json", {});
    snapshotRows = [...rows(page), ...rows(all)];
  }

  const vesselSpecRows = sourceRows(snapshotRows, /vessel[_-]?spec|ship[_-]?spec|spec_api/i);
  const mofAisInfoRows = sourceRows(snapshotRows, /mof[_-]?ais[_-]?info|ais[_-]?info/i);
  const sourceCsvSnapshotRows = sourceRows(snapshotRows, /source[_-]?csv|vessel_master_seed|external snapshot csv/i);
  const vesselMaster = await fetchRows("vessel_master", {
    select: "master_vessel_id,imo,mmsi,call_sign,canonical_name,normalized_name,vessel_type,vessel_type_group,gt,payload",
    order: "first_seen.desc.nullslast"
  });
  const vesselMasterRows = vesselMaster.ok ? vesselMaster.rows : [];
  const vesselMasterSummary = summarize(vesselMasterRows);
  const pipeline = readJson("data/pipeline-report.json", {});
  const identityResolution = pipeline.identity_resolution || readJson("dashboard/api/daily-enrichment-runtime.json", {}).identity_resolution || {};

  console.log(`- latest_successful_run_id: ${runId || "unknown"}`);
  console.log(`- snapshot_source: ${snapshotStatus}`);
  console.log(`- snapshot_rows_checked: ${snapshotRows.length}`);
  console.log(`- source_csv configured?: ${sourceCsv.configured ? "yes" : "no"}`);
  console.log(`- source_csv enabled?: ${sourceCsv.enabled ? "yes" : "no"}`);
  console.log(`- source_csv local seed rows: ${sourceCsv.local_seed_rows}`);
  console.log(`- source_csv remote status: ${sourceCsv.remote_status}`);
  printSource("source_csv", {
    loaded: sourceCsvSummary.loaded + sourceCsvSnapshotRows.length,
    with_imo: sourceCsvSummary.with_imo + sourceCsvSnapshotRows.filter(hasImo).length,
    with_mmsi: sourceCsvSummary.with_mmsi + sourceCsvSnapshotRows.filter(hasMmsi).length
  });
  printSource("vessel_spec", summarize(vesselSpecRows));
  printSource("mof_ais_info", summarize(mofAisInfoRows));
  console.log(`- vessel_master read status: ${vesselMaster.ok ? "loaded" : `failed:${vesselMaster.error || "unknown"}`}`);
  console.log(`- vessel_master rows loaded: ${vesselMasterRows.length}`);
  console.log(`- vessel_master rows with IMO: ${vesselMasterSummary.with_imo}`);
  console.log(`- vessel_master rows with MMSI: ${vesselMasterSummary.with_mmsi}`);

  console.log("\nConfigured identity source groups:");
  for (const key of ["source_csv", "vessel_spec", "mof_ais_info", "supabase"]) {
    const source = secrets.find(item => item.key === key);
    console.log(`- ${key}: ${source?.enabled ? "enabled" : "not_enabled"}${source?.missing?.length ? ` (missing ${source.missing.join(",")})` : ""}`);
  }

  console.log("\nLatest resolver diagnostics:");
  console.log(`- candidates_created: ${identityResolution.candidates_created ?? "unknown"}`);
  console.log(`- reference_rows_with_imo: ${identityResolution.reference_rows_with_imo ?? "unknown"}`);
  console.log(`- reference_rows_with_mmsi: ${identityResolution.reference_rows_with_mmsi ?? "unknown"}`);
  console.log(`- resolved_imo_count: ${identityResolution.resolved_imo_count ?? "unknown"}`);
  console.log(`- resolved_mmsi_count: ${identityResolution.resolved_mmsi_count ?? "unknown"}`);
  console.log(`- applied_imo_count: ${identityResolution.applied_imo_count ?? "unknown"}`);
  console.log(`- applied_mmsi_count: ${identityResolution.applied_mmsi_count ?? "unknown"}`);
  console.log(`- needs_review_count: ${identityResolution.needs_review ?? "unknown"}`);
  console.log(`- conflict_count: ${identityResolution.conflicts ?? "unknown"}`);
  console.log(`- blockers_by_reason: ${JSON.stringify(identityResolution.blockers_by_reason || identityResolution.failed_recovery_reasons || {})}`);
  console.log(`- reference_source_identifier_counts: ${JSON.stringify(identityResolution.reference_source_identifier_counts || {})}`);

  const blockers = [];
  if (!sourceCsv.configured) blockers.push("source_csv not configured");
  if (sourceCsv.configured && !sourceCsv.enabled) blockers.push("source_csv configured but ENABLE_SOURCE_CSV is not true");
  if (sourceCsv.configured && sourceCsvSummary.loaded > 0 && sourceCsvSummary.with_imo === 0) blockers.push("source_csv has no IMO column/value");
  if (!secrets.find(item => item.key === "vessel_spec")?.enabled && vesselSpecRows.length === 0) blockers.push("vessel_spec unavailable");
  if (!secrets.find(item => item.key === "mof_ais_info")?.enabled && mofAisInfoRows.length === 0) blockers.push("mof_ais_info unavailable");
  if (vesselMasterRows.length > 0 && vesselMasterSummary.with_imo === 0 && vesselMasterSummary.with_mmsi === 0) blockers.push("vessel_master rows lack IMO/MMSI");
  if (Number(identityResolution.candidates_created || 0) > 0 && Number(identityResolution.reference_rows_with_imo || 0) === 0 && Number(identityResolution.reference_rows_with_mmsi || 0) === 0) {
    blockers.push("all reference sources lack usable IMO/MMSI values");
  }
  if (Number(identityResolution.candidates_created || 0) > 0 && Number(identityResolution.candidates_resolved || 0) === 0 && Number(identityResolution.reference_rows_with_imo || 0) > 0) {
    blockers.push("reference rows exist but all matches are low confidence or conflicting");
  }

  console.log("\nSource-level blockers:");
  if (blockers.length) blockers.forEach(reason => console.log(`- ${reason}`));
  else console.log("- none");
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
