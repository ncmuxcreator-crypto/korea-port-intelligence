#!/usr/bin/env node

import fs from "fs";
import path from "path";
import { createHash, randomUUID } from "crypto";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const SNAPSHOT_TYPE = "72h";
const SCHEMA_VERSION = "1.0";
const WINDOW_HOURS = 72;

export const PORT_CONFIG = [
  {
    port_code: "BUSAN",
    port_name_kr: "부산항",
    port_name_en: "Busan",
    bbox: [128.85, 34.95, 129.25, 35.25],
    aliases: ["BUSAN", "PUSAN", "부산", "부산항", "KRPUS", "KR PUS", "020"]
  },
  {
    port_code: "ULSAN",
    port_name_kr: "울산항",
    port_name_en: "Ulsan",
    bbox: [129.25, 35.35, 129.55, 35.65],
    aliases: ["ULSAN", "울산", "울산항", "KRUSN", "820"]
  },
  {
    port_code: "GWANGYANG_YEOSU",
    port_name_kr: "광양·여수항",
    port_name_en: "Gwangyang / Yeosu",
    bbox: [127.55, 34.55, 128.05, 35.05],
    aliases: ["GWANGYANG", "YEOSU", "광양", "광양항", "여수", "여수항", "여수/광양", "620", "620-YEOSU"]
  },
  {
    port_code: "INCHEON",
    port_name_kr: "인천항",
    port_name_en: "Incheon",
    bbox: [126.45, 37.25, 126.75, 37.6],
    aliases: ["INCHEON", "인천", "인천항", "KRINC", "030"]
  },
  {
    port_code: "PYEONGTAEK_DANGJIN",
    port_name_kr: "평택·당진항",
    port_name_en: "Pyeongtaek-Dangjin",
    bbox: [126.65, 36.85, 127.05, 37.15],
    aliases: ["PYEONGTAEK", "DANGJIN", "평택", "당진", "평택당진", "평택·당진", "KRPTK", "031"]
  },
  {
    port_code: "MOKPO",
    port_name_kr: "목포항",
    port_name_en: "Mokpo",
    bbox: [126.25, 34.65, 126.55, 34.9],
    aliases: ["MOKPO", "목포", "목포항", "KRMOK"]
  },
  {
    port_code: "GUNSAN",
    port_name_kr: "군산항",
    port_name_en: "Gunsan",
    bbox: [126.45, 35.85, 126.85, 36.1],
    aliases: ["GUNSAN", "군산", "군산항", "KRKUV"]
  },
  {
    port_code: "POHANG",
    port_name_kr: "포항항",
    port_name_en: "Pohang",
    bbox: [129.25, 35.9, 129.55, 36.15],
    aliases: ["POHANG", "포항", "포항항", "KRKPO", "810"]
  },
  {
    port_code: "MASAN_JINHAE",
    port_name_kr: "마산·진해항",
    port_name_en: "Masan / Jinhae",
    bbox: [128.5, 35, 128.85, 35.25],
    aliases: ["MASAN", "JINHAE", "CHANGWON", "마산", "진해", "창원", "마산/창원", "경남", "SOUTH GYEONGSANG", "622"]
  }
];

const DASHBOARD_ROOT = "dashboard";
const PUBLIC_ROOT = "public";
const STATIC_ROOTS = [DASHBOARD_ROOT, PUBLIC_ROOT];

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const text = fs.readFileSync(filePath, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key]) continue;
    let value = rawValue.trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

for (const filePath of [
  path.join(ROOT, ".env.local"),
  path.join(ROOT, ".env"),
  path.join(ROOT, "..", "hwkport-push", ".env.local")
]) {
  loadEnvFile(filePath);
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readJson(relativePath, fallback = null) {
  const fullPath = path.join(ROOT, relativePath);
  if (!fs.existsSync(fullPath)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(fullPath, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(relativePath, payload) {
  const fullPath = path.join(ROOT, relativePath);
  ensureDir(path.dirname(fullPath));
  fs.writeFileSync(fullPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function rows(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.vessels)) return payload.vessels;
  if (Array.isArray(payload?.opportunities)) return payload.opportunities;
  if (Array.isArray(payload?.features)) return payload.features.map(feature => ({ ...(feature.properties || {}), geometry: feature.geometry }));
  return [];
}

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function round(value, digits = 1) {
  const factor = 10 ** digits;
  return Math.round(toNumber(value) * factor) / factor;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function average(values) {
  const nums = values.map(value => Number(value)).filter(Number.isFinite);
  if (!nums.length) return 0;
  return round(nums.reduce((sum, value) => sum + value, 0) / nums.length, 1);
}

function normalizeText(value) {
  return String(value || "")
    .normalize("NFKC")
    .toUpperCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function cleanDisplay(value, fallback = "") {
  const text = String(value ?? "").trim();
  if (!text || text === "-" || text === "확인 불가" || text.toLowerCase() === "null" || text.toLowerCase() === "undefined") return fallback;
  return text;
}

function recordPortText(record = {}) {
  return [
    record.port_code,
    record.portCode,
    record.port_name,
    record.port_name_ko,
    record.port_name_kr,
    record.port,
    record.current_port,
    record.destination_port,
    record.destination,
    record.port_group,
    record.sub_port,
    record.area_name,
    record.location_name,
    record.vessel_display?.current_port
  ].filter(Boolean).join(" ");
}

function matchPort(record = {}) {
  const codeText = normalizeText(record.port_code || record.portCode);
  if (codeText) {
    const byCode = PORT_CONFIG.find(port => port.aliases.some(alias => normalizeText(alias) === codeText));
    if (byCode) return byCode;
  }
  const primaryText = normalizeText([
    record.port_name,
    record.port_name_ko,
    record.port_name_kr,
    record.port,
    record.current_port,
    record.destination_port,
    record.destination,
    record.port_group,
    record.area_name,
    record.location_name,
    record.vessel_display?.current_port
  ].filter(Boolean).join(" "));
  if (primaryText) {
    const byPrimary = PORT_CONFIG.find(port => port.aliases.some(alias => primaryText.includes(normalizeText(alias))));
    if (byPrimary) return byPrimary;
  }
  const text = normalizeText(recordPortText(record));
  if (!text) return null;
  return PORT_CONFIG.find(port => port.aliases.some(alias => text.includes(normalizeText(alias)))) || null;
}

function vesselName(record = {}) {
  return cleanDisplay(
    record.vessel_name ||
      record.ship_name ||
      record.name ||
      record.vsslNm ||
      record.vessel_display?.vessel_name ||
      record.properties?.vessel_name
  );
}

function identityKey(record = {}) {
  return (
    normalizeText(record.imo || record.vessel_display?.imo || record.properties?.imo) ||
    normalizeText(record.mmsi || record.vessel_display?.mmsi || record.properties?.mmsi) ||
    normalizeText(record.call_sign || record.callsign || record.vessel_display?.call_sign) ||
    normalizeText(vesselName(record))
  );
}

function stableFraction(seed, salt = "") {
  const hash = createHash("sha1").update(`${seed}|${salt}`).digest("hex").slice(0, 12);
  return parseInt(hash, 16) / 0xffffffffffff;
}

function pseudoCoordinate(record, port) {
  const seed = identityKey(record) || `${port.port_code}-${vesselName(record) || randomUUID()}`;
  const [minLon, minLat, maxLon, maxLat] = port.bbox;
  const lon = minLon + (maxLon - minLon) * (0.15 + stableFraction(seed, "lon") * 0.7);
  const lat = minLat + (maxLat - minLat) * (0.15 + stableFraction(seed, "lat") * 0.7);
  return [round(lon, 5), round(lat, 5)];
}

function coordinateFromRecord(record, port) {
  const lat = toNumber(record.lat ?? record.latitude ?? record.y ?? record.geometry?.coordinates?.[1], NaN);
  const lon = toNumber(record.lon ?? record.lng ?? record.longitude ?? record.x ?? record.geometry?.coordinates?.[0], NaN);
  const [minLon, minLat, maxLon, maxLat] = port.bbox;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (Math.abs(lat) < 0.01 || Math.abs(lon) < 0.01) return null;
  if (lat < minLat - 0.25 || lat > maxLat + 0.25 || lon < minLon - 0.25 || lon > maxLon + 0.25) return null;
  return [round(lon, 5), round(lat, 5)];
}

function parseDate(value) {
  if (!value) return null;
  const date = new Date(String(value).replace(" ", "T"));
  return Number.isNaN(date.getTime()) ? null : date;
}

function lastSeen(record = {}) {
  return (
    record.last_seen_at ||
    record.lastSeenAt ||
    record.updated_at ||
    record.collected_at ||
    record.generated_at ||
    record.portmis_last_ts ||
    record.ata ||
    record.atb ||
    record.etb ||
    record.eta ||
    record.vessel_display?.ata ||
    record.vessel_display?.eta ||
    ""
  );
}

function loadVesselPages() {
  const index = readJson("dashboard/api/vessels/index.json", {});
  const items = [];
  for (const page of index?.pages || []) {
    const pagePath = page.startsWith("page-") ? `dashboard/api/vessels/${page}` : `dashboard/api/vessels/${path.basename(page)}`;
    items.push(...rows(readJson(pagePath, {})));
  }
  return items;
}

function loadSourceRecords() {
  const sourcePaths = [
    "dashboard/api/all-collected-vessels.json",
    "dashboard/api/vessels.json",
    "dashboard/api/targets/current.json",
    "dashboard/api/candidates/top.json",
    "dashboard/api/arrival-pipeline.json",
    "dashboard/api/anchorage-waiting.json",
    "dashboard/api/staying-vessels.json"
  ];
  const byKey = new Map();
  for (const sourcePath of sourcePaths) {
    for (const record of rows(readJson(sourcePath, {}))) {
      const normalized = record.vessel_display ? { ...record, ...record.vessel_display } : record;
      const key = `${identityKey(normalized) || normalizeText(vesselName(normalized))}|${normalizeText(recordPortText(normalized))}`;
      if (!key.trim() || byKey.has(key)) continue;
      byKey.set(key, { ...normalized, _snapshot_source_path: sourcePath });
    }
  }
  if (!byKey.size) {
    for (const record of loadVesselPages()) {
      const normalized = record.vessel_display ? { ...record, ...record.vessel_display } : record;
      const key = `${identityKey(normalized) || normalizeText(vesselName(normalized))}|${normalizeText(recordPortText(normalized))}`;
      if (!key.trim() || byKey.has(key)) continue;
      byKey.set(key, { ...normalized, _snapshot_source_path: "dashboard/api/vessels/page-*.json" });
    }
  }
  return [...byKey.values()];
}

function buildBiofoulingLookup() {
  const lookup = new Map();
  for (const record of rows(readJson("dashboard/api/biofouling/vessel-risk-scores.json", {}))) {
    const normalized = record.vessel_display ? { ...record, ...record.vessel_display } : record;
    const keys = [identityKey(normalized), normalizeText(vesselName(normalized))].filter(Boolean);
    for (const key of keys) {
      if (!lookup.has(key)) lookup.set(key, normalized);
    }
  }
  return lookup;
}

function sstForRecord(record, bioRecord) {
  const anomaly = toNumber(record.sst_anomaly_c ?? record.sst_anomaly ?? bioRecord?.sst_anomaly_c ?? bioRecord?.sst_anomaly, 0);
  const sst7 = toNumber(record.sst_7d_c_avg ?? bioRecord?.sst_7d_c_avg, 18);
  const sst72 = toNumber(record.sst_72h_c_avg ?? bioRecord?.sst_72h_c_avg, sst7 + anomaly);
  return {
    sst_72h_c_avg: round(sst72, 1),
    sst_7d_c_avg: round(sst7, 1),
    sst_anomaly_c: round(anomaly, 1),
    bias_offset_c: round(toNumber(record.bias_offset_c ?? bioRecord?.bias_offset_c, 0), 1)
  };
}

function residenceHours(record = {}, bioRecord = {}) {
  const candidates = [
    record.residence_hours_72h,
    record.stay_hours,
    record.current_call_stay_hours,
    record.cumulative_stay_hours,
    record.anchorage_hours,
    record.waiting_hours,
    bioRecord.ais_dwell_hours,
    toNumber(record.stay_days ?? record.vessel_display?.stay_days, 0) * 24
  ].map(value => toNumber(value, NaN)).filter(Number.isFinite);
  return round(Math.max(0, ...candidates, 0), 1);
}

function residenceChangePct(record = {}, residence = 0) {
  const direct = Number(record.residence_change_pct_72_vs_30d ?? record.residence_change_pct);
  if (Number.isFinite(direct)) return round(direct, 1);
  const baseline = toNumber(record.historical_avg_stay_hours || record.historical_avg_waiting_hours || record.planned_stay_hours, 0);
  if (baseline > 0) return round(((residence - baseline) / baseline) * 100, 1);
  return 0;
}

function combinedScore({ residence, changePct, sstAnomaly, confidence }) {
  const residenceScore = Math.min((residence / WINDOW_HOURS) * 100, 100);
  const changeScore = ((clamp(changePct, -50, 100) + 50) / 150) * 100;
  const sstScore = clamp(((sstAnomaly + 2) / 4) * 100, 0, 100);
  return round(residenceScore * 0.45 + changeScore * 0.25 + sstScore * 0.2 + confidence * 0.1, 1);
}

function suggestedAction(score) {
  if (score >= 75) return "즉시 영업 후보";
  if (score >= 55) return "관심 후보";
  if (score >= 35) return "관찰";
  return "낮음";
}

function buildFeature(record, port, bioLookup) {
  const bioRecord = bioLookup.get(identityKey(record)) || bioLookup.get(normalizeText(vesselName(record))) || {};
  const residence = residenceHours(record, bioRecord);
  const changePct = residenceChangePct(record, residence);
  const sst = sstForRecord(record, bioRecord);
  const confidence = clamp(toNumber(record.data_confidence_score ?? record.confidence_score ?? record.vessel_display?.confidence_score, 50), 0, 100);
  const score = combinedScore({ residence, changePct, sstAnomaly: sst.sst_anomaly_c, confidence });
  const actualCoordinate = coordinateFromRecord(record, port);
  const coordinates = actualCoordinate || pseudoCoordinate(record, port);
  const portmisLastTs = parseDate(lastSeen(record))?.toISOString() || null;
  const properties = {
    port_code: port.port_code,
    mmsi: cleanDisplay(record.mmsi || record.vessel_display?.mmsi),
    imo: cleanDisplay(record.imo || record.vessel_display?.imo),
    vessel_name: vesselName(record),
    vessel_type: cleanDisplay(record.vessel_type || record.vsslKndNm || record.vessel_display?.vessel_type),
    residence_hours_72h: residence,
    residence_change_pct_72_vs_30d: changePct,
    ...sst,
    portmis_last_ts: portmisLastTs || "",
    combined_score: score,
    suggested_action: suggestedAction(score),
    data_confidence_score: confidence,
    coordinate_source: actualCoordinate ? "source_position" : "port_bbox_distribution"
  };
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates },
    properties,
    raw: {
      source: record.source || record.source_label || record._snapshot_source_path || "dashboard_snapshot",
      current_port: cleanDisplay(record.port_name_kr || record.port_name || record.port || record.current_port || record.vessel_display?.current_port),
      opportunity_score: toNumber(record.opportunity_score ?? record.total_sales_priority_score ?? record.commercial_value_score ?? record.vessel_display?.opportunity_score, 0),
      risk_score: toNumber(record.risk_score ?? record.biofouling_risk_score ?? record.vessel_display?.risk_score, 0),
      reason_summary: cleanDisplay(record.reason_summary || record.why_now || record.opportunity_summary || record.vessel_display?.reason_summary),
      recommended_action: cleanDisplay(record.recommended_action || record.vessel_display?.recommended_action)
    }
  };
}

function featureCollection(port, features, dataHealth, generatedAt, windowStart, windowEnd) {
  return {
    type: "FeatureCollection",
    schema_version: SCHEMA_VERSION,
    generated_at: generatedAt,
    properties: {
      port_code: port.port_code,
      port_name_kr: port.port_name_kr,
      port_name_en: port.port_name_en,
      snapshot_type: SNAPSHOT_TYPE,
      window_start: windowStart,
      window_end: windowEnd,
      bbox: port.bbox,
      feature_count: features.length,
      data_health: dataHealth
    },
    features: features.map(({ raw, ...feature }) => feature)
  };
}

function snapshotMeta(port, collection, dataHealth) {
  const features = collection.features || [];
  const scores = features.map(feature => toNumber(feature.properties?.combined_score, NaN)).filter(Number.isFinite);
  const residence = features.map(feature => toNumber(feature.properties?.residence_hours_72h, NaN)).filter(Number.isFinite);
  return {
    port_code: port.port_code,
    port_name_kr: port.port_name_kr,
    port_name_en: port.port_name_en,
    latest_geojson_url: `/data/ports/${port.port_code}/latest.geojson`,
    detail_url: `/ports/${port.port_code}/`,
    bbox: port.bbox,
    vessel_count: features.length,
    avg_residence_hours: average(residence),
    avg_combined_score: average(scores),
    max_combined_score: scores.length ? Math.max(...scores) : 0,
    last_updated: collection.generated_at,
    data_health: dataHealth
  };
}

function buildMockRecords() {
  if (process.env.PORT_GEOJSON_MOCK !== "true") return [];
  return [
    {
      vessel_name: "BUSAN DEMO VESSEL",
      vessel_type: "Container Ship",
      port_name: "Busan",
      current_port: "부산항",
      mmsi: "000000001",
      imo: "9000001",
      stay_hours: 54,
      confidence_score: 70,
      sst_anomaly: 0.8,
      source: "mock"
    }
  ];
}

function sourceStatus(records, bioLookup) {
  return {
    dashboard_vessels: records.length > 0 ? "available" : "empty",
    biofouling_scores: bioLookup.size > 0 ? "available" : "empty",
    source_csv: process.env.SOURCE_CSV_URL ? "configured" : "not_configured",
    mof_ais_dynamic: process.env.MOF_AIS_DYNAMIC_API_URL && process.env.MOF_AIS_DYNAMIC_SERVICE_KEY ? "configured" : "not_configured",
    mof_ais_info: process.env.MOF_AIS_INFO_API_URL && process.env.MOF_AIS_INFO_SERVICE_KEY ? "configured" : "not_configured",
    port_operation: process.env.PORT_OPERATION_API_URL && process.env.PORT_OPERATION_SERVICE_KEY ? "configured" : "not_configured"
  };
}

function supabaseClient() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return null;
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false }
  });
}

async function fetchSupabaseRows(client, table, queryBuilder, pageSize = 1000, maxRows = 10000) {
  const allRows = [];
  for (let from = 0; from < maxRows; from += pageSize) {
    const to = Math.min(from + pageSize - 1, maxRows - 1);
    const { data, error } = await queryBuilder(client.from(table).select("*")).range(from, to);
    if (error) throw new Error(`${table}: ${error.message}`);
    allRows.push(...(data || []));
    if (!data || data.length < pageSize) break;
  }
  return allRows;
}

async function loadSupabaseSourceRecords() {
  const supabase = supabaseClient();
  if (!supabase) return { records: [], status: "skipped", reason: "missing_supabase_env" };
  try {
    const { data: pointerRows, error: pointerError } = await supabase
      .from("active_dataset_pointer")
      .select("active_run_id,promoted_at,active_collected_at")
      .order("promoted_at", { ascending: false, nullsFirst: false })
      .limit(1);
    if (pointerError) throw new Error(`active_dataset_pointer: ${pointerError.message}`);
    let runId = pointerRows?.[0]?.active_run_id || "";
    if (!runId) {
      const { data: latestRows, error: latestError } = await supabase
        .from("vessel_snapshots")
        .select("run_id")
        .order("collected_at", { ascending: false, nullsFirst: false })
        .limit(1);
      if (latestError) throw new Error(`vessel_snapshots latest: ${latestError.message}`);
      runId = latestRows?.[0]?.run_id || "";
    }
    if (!runId) return { records: [], status: "empty", reason: "no_active_run_id" };
    const records = await fetchSupabaseRows(
      supabase,
      "vessel_snapshots",
      query => query.eq("run_id", runId).order("port_code", { ascending: true })
    );
    return {
      records: records.map(record => ({ ...record, _snapshot_source_path: "supabase:vessel_snapshots" })),
      status: records.length ? "available" : "empty",
      run_id: runId,
      row_count: records.length
    };
  } catch (error) {
    return { records: [], status: "failed", error: error.message };
  }
}

async function writeSupabase(snapshots) {
  const supabase = supabaseClient();
  if (!supabase) return { status: "skipped", reason: "missing_supabase_env" };
  const snapshotRows = snapshots.map(snapshot => ({
    id: snapshot.id,
    port_code: snapshot.port.port_code,
    port_name_kr: snapshot.port.port_name_kr,
    port_name_en: snapshot.port.port_name_en,
    window_start: snapshot.windowStart,
    window_end: snapshot.windowEnd,
    snapshot_type: SNAPSHOT_TYPE,
    geojson: snapshot.collection,
    vessel_count: snapshot.meta.vessel_count,
    avg_residence_hours: snapshot.meta.avg_residence_hours,
    avg_combined_score: snapshot.meta.avg_combined_score,
    max_combined_score: snapshot.meta.max_combined_score,
    data_health: snapshot.dataHealth,
    created_at: snapshot.generatedAt
  }));
  const { error: snapshotError } = await supabase.from("port_geojson_snapshots").insert(snapshotRows);
  if (snapshotError) return { status: "failed", error: snapshotError.message };
  const featureRows = [];
  for (const snapshot of snapshots) {
    for (const feature of snapshot.features) {
      const p = feature.properties;
      featureRows.push({
        id: randomUUID(),
        snapshot_id: snapshot.id,
        port_code: snapshot.port.port_code,
        mmsi: p.mmsi || null,
        imo: p.imo || null,
        vessel_name: p.vessel_name || null,
        vessel_type: p.vessel_type || null,
        lat: feature.geometry.coordinates[1],
        lon: feature.geometry.coordinates[0],
        residence_hours_72h: p.residence_hours_72h,
        residence_change_pct_72_vs_30d: p.residence_change_pct_72_vs_30d,
        sst_72h_c_avg: p.sst_72h_c_avg,
        sst_7d_c_avg: p.sst_7d_c_avg,
        sst_anomaly_c: p.sst_anomaly_c,
        bias_offset_c: p.bias_offset_c,
        portmis_last_ts: p.portmis_last_ts || null,
        combined_score: p.combined_score,
        suggested_action: p.suggested_action,
        raw: feature.raw || {},
        created_at: snapshot.generatedAt
      });
    }
  }
  for (let index = 0; index < featureRows.length; index += 500) {
    const { error } = await supabase.from("port_vessel_features").insert(featureRows.slice(index, index + 500));
    if (error) {
      return {
        status: "partial_failed",
        error: error.message,
        inserted_snapshots: snapshotRows.length,
        attempted_features: featureRows.length
      };
    }
  }
  return { status: "completed", inserted_snapshots: snapshotRows.length, inserted_features: featureRows.length };
}

function htmlShell({ title, page }) {
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <link href="https://api.mapbox.com/mapbox-gl-js/v3.10.0/mapbox-gl.css" rel="stylesheet">
  <link rel="stylesheet" href="/ports/port-risk.css">
</head>
<body>
  <header class="topbar">
    <a href="/" class="brand">항만 영업 인텔리전스</a>
    <a href="/ports/" class="nav">항만 리스크 지도</a>
  </header>
  <main id="app" data-page="${page}">
    <div class="loading">항만 리스크 데이터를 불러오는 중입니다.</div>
  </main>
  <script src="https://api.mapbox.com/mapbox-gl-js/v3.10.0/mapbox-gl.js"></script>
  <script src="/ports/port-risk.js"></script>
</body>
</html>
`;
}

const PORT_RISK_CSS = `
*{box-sizing:border-box}html,body{margin:0;min-height:100%;background:#07131f;color:#e5f5ff;font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}body{overflow-x:hidden}.topbar{position:sticky;top:0;z-index:10;display:flex;align-items:center;justify-content:space-between;gap:16px;padding:14px clamp(14px,3vw,28px);background:rgba(5,15,26,.92);border-bottom:1px solid rgba(125,211,252,.18);backdrop-filter:blur(10px)}.brand,.nav{color:#e0f2fe;text-decoration:none;font-weight:800}.nav{min-height:44px;display:inline-flex;align-items:center;padding:0 14px;border:1px solid rgba(34,211,238,.35);border-radius:8px;color:#67e8f9}.wrap{width:min(1600px,100%);margin:0 auto;padding:18px clamp(14px,3vw,28px) 38px}.hero{display:flex;justify-content:space-between;align-items:flex-end;gap:18px;margin:8px 0 18px}.hero h1{font-size:clamp(24px,4vw,42px);line-height:1.05;margin:0}.hero p{margin:8px 0 0;color:#9fb5c7}.chip{display:inline-flex;align-items:center;min-height:30px;padding:4px 10px;border-radius:999px;background:#12263a;border:1px solid rgba(148,163,184,.25);font-size:13px;font-weight:800;white-space:nowrap}.ok{color:#86efac}.warn{color:#fbbf24}.bad{color:#fca5a5}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.card{min-width:0;background:#0d1d2b;border:1px solid rgba(125,211,252,.18);border-radius:8px;padding:15px;text-decoration:none;color:inherit;overflow-wrap:anywhere}.card:hover{border-color:rgba(34,211,238,.55)}.card h2{font-size:18px;margin:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.row{display:flex;align-items:center;justify-content:space-between;gap:10px;min-width:0}.metrics{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-top:14px}.metric{min-width:0;padding:10px;background:#071827;border:1px solid rgba(148,163,184,.14);border-radius:8px}.metric span{display:block;color:#8fb0c5;font-size:12px}.metric b{display:block;font-size:22px;margin-top:3px;overflow-wrap:anywhere}.map-layout{display:grid;grid-template-columns:minmax(0,1.45fr) minmax(320px,.55fr);gap:14px}.map{height:68vh;min-height:430px;border:1px solid rgba(125,211,252,.2);border-radius:8px;overflow:hidden;background:#0a1724}.side{min-width:0;display:flex;flex-direction:column;gap:12px}.list{display:grid;gap:8px}.vessel{min-width:0;padding:12px;background:#0d1d2b;border:1px solid rgba(125,211,252,.16);border-radius:8px}.vessel h3{font-size:15px;margin:0 0 6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.small{font-size:13px;color:#9fb5c7}.health{margin-top:16px;background:#081827;border:1px solid rgba(148,163,184,.18);border-radius:8px;padding:14px}.health h2{font-size:17px;margin:0 0 10px}.health-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}.health-row{min-width:0;padding:9px;border-bottom:1px solid rgba(148,163,184,.12);overflow-wrap:anywhere}.popup{color:#0f172a}.empty{padding:20px;border:1px dashed rgba(148,163,184,.28);border-radius:8px;color:#9fb5c7}.loading{padding:30px;color:#9fb5c7}@media(max-width:1199px){.grid{grid-template-columns:repeat(2,minmax(0,1fr))}.map-layout{grid-template-columns:1fr}.map{height:58vh}}@media(max-width:767px){.topbar{padding-inline:12px}.hero{display:block}.grid{grid-template-columns:1fr}.metrics{grid-template-columns:repeat(2,minmax(0,1fr))}.map{height:55vh;min-height:340px}.health-grid{grid-template-columns:1fr}.wrap{padding-inline:12px}.card{padding:13px}.metric b{font-size:20px}}
`;

const PORT_RISK_JS = `
const app=document.querySelector("#app");
const fmt=value=>Number.isFinite(Number(value))?new Intl.NumberFormat("ko-KR",{maximumFractionDigits:1}).format(Number(value)):"-";
const esc=value=>String(value??"").replace(/[&<>"']/g,match=>({"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;","'":"&#39;"}[match]));
const scoreClass=value=>Number(value)>=75?"bad":Number(value)>=55?"warn":Number(value)>=35?"ok":"";
async function getJson(url){const response=await fetch(url,{cache:"no-store"});if(!response.ok)throw new Error(String(response.status));return response.json()}
function healthPanel(meta,geo){const health=geo?.properties?.data_health||meta?.data_health||{};const rows=[["last_updated",meta?.last_updated||geo?.generated_at],["source_status",JSON.stringify(health.source_status||{})],["missing_sources",(health.missing_sources||[]).join(", ")||"-"],["stale_records_count",health.stale_records_count??0],["bbox",(meta?.bbox||geo?.properties?.bbox||[]).join(", ")],["feature_count",geo?.features?.length??meta?.vessel_count??0],["warning",(health.warnings||[]).join(" · ")||health.warning||"-"]];return '<section class="health"><h2>Data Health</h2><div class="health-grid">'+rows.map(([label,value])=>'<div class="health-row"><span class="small">'+esc(label)+'</span><br><b>'+esc(value)+"</b></div>").join("")+"</div></section>"}
function portCard(meta){return '<a class="card" href="'+esc(meta.detail_url)+'"><div class="row"><h2>'+esc(meta.port_name_kr)+'</h2><span class="chip '+scoreClass(meta.avg_combined_score)+'">'+fmt(meta.avg_combined_score)+'</span></div><div class="small">'+esc(meta.port_name_en)+'</div><div class="metrics"><div class="metric"><span>선박 수</span><b>'+fmt(meta.vessel_count)+'</b></div><div class="metric"><span>평균 체류</span><b>'+fmt(meta.avg_residence_hours)+'h</b></div><div class="metric"><span>최고 점수</span><b>'+fmt(meta.max_combined_score)+'</b></div><div class="metric"><span>상태</span><b class="'+(meta.data_health?.status==="healthy"?"ok":meta.data_health?.status==="stale"?"warn":"")+'">'+esc(meta.data_health?.status||"-")+'</b></div></div></a>'}
async function renderIndex(){const index=await getJson("/data/ports/index.json");const ports=[...(index.ports||[])].sort((a,b)=>Number(b.avg_combined_score||0)-Number(a.avg_combined_score||0));app.innerHTML='<div class="wrap"><section class="hero"><div><h1>항만 리스크 GeoJSON 스냅샷</h1><p>주요 항만별 72시간 체류, 혼잡, 기회점수, SST 리스크를 영업 관점으로 요약합니다.</p></div><span class="chip">'+esc(index.generated_at||"-")+'</span></section><section class="grid">'+ports.map(portCard).join("")+'</section>'+healthPanel(index,{features:[],properties:{data_health:index.data_health||{}}})+'</div>'}
function popupHtml(props){return '<div class="popup"><b>'+esc(props.vessel_name||"선명 확인 필요")+'</b><br>선종: '+esc(props.vessel_type||"-")+'<br>체류: '+fmt(props.residence_hours_72h)+'h<br>SST anomaly: '+fmt(props.sst_anomaly_c)+'°C<br>점수: '+fmt(props.combined_score)+'<br>액션: '+esc(props.suggested_action||"-")+'</div>'}
async function renderDetail(){const code=location.pathname.split("/").filter(Boolean).pop()?.toUpperCase()||"BUSAN";const [index,geo,config]=await Promise.all([getJson("/data/ports/index.json"),getJson("/data/ports/"+code+"/latest.geojson"),getJson("/data/ports/config.json").catch(()=>({}))]);const meta=(index.ports||[]).find(port=>port.port_code===code)||{};meta.mapbox_token=config.mapbox_token||"";const features=[...(geo.features||[])].sort((a,b)=>Number(b.properties?.combined_score||0)-Number(a.properties?.combined_score||0));app.innerHTML='<div class="wrap"><section class="hero"><div><h1>'+esc(meta.port_name_kr||code)+'</h1><p>'+esc(meta.port_name_en||"")+' · 72시간 선박 리스크 스냅샷</p></div><span class="chip '+scoreClass(meta.avg_combined_score)+'">평균 '+fmt(meta.avg_combined_score)+'</span></section><section class="map-layout"><div id="map" class="map"></div><aside class="side"><div class="card"><div class="metrics"><div class="metric"><span>선박 수</span><b>'+fmt(features.length)+'</b></div><div class="metric"><span>평균 체류</span><b>'+fmt(meta.avg_residence_hours)+'h</b></div><div class="metric"><span>최고 점수</span><b>'+fmt(meta.max_combined_score)+'</b></div><div class="metric"><span>상태</span><b>'+esc(meta.data_health?.status||"-")+'</b></div></div></div><div class="list">'+(features.slice(0,12).map(feature=>{const props=feature.properties||{};return '<div class="vessel"><div class="row"><h3>'+esc(props.vessel_name||"선명 확인 필요")+'</h3><span class="chip '+scoreClass(props.combined_score)+'">'+fmt(props.combined_score)+'</span></div><div class="small">'+esc(props.vessel_type||"-")+' · '+fmt(props.residence_hours_72h)+'h · '+esc(props.suggested_action||"-")+'</div></div>'}).join("")||'<div class="empty">표시할 선박이 없습니다.</div>')+'</div></aside></section>'+healthPanel(meta,geo)+'</div>';drawMap(geo,meta)}
function drawMap(geo,meta){const token=meta.mapbox_token;if(!token||!window.mapboxgl){document.querySelector("#map").innerHTML='<div class="empty">Mapbox 공개 토큰이 없어 지도 대신 카드 데이터를 표시합니다.</div>';return}mapboxgl.accessToken=token;const bbox=meta.bbox||geo.properties?.bbox||[126,34,130,38];const center=[(bbox[0]+bbox[2])/2,(bbox[1]+bbox[3])/2];const map=new mapboxgl.Map({container:"map",style:"mapbox://styles/mapbox/dark-v11",center,zoom:9});map.addControl(new mapboxgl.NavigationControl({showCompass:false}),"top-right");map.on("load",()=>{map.addSource("vessels",{type:"geojson",data:geo});map.addLayer({id:"vessel-risk",type:"circle",source:"vessels",paint:{"circle-radius":["interpolate",["linear"],["get","residence_hours_72h"],0,5,72,18,240,28],"circle-color":["case",[">=",["get","combined_score"],75],"#ef4444",[">=",["get","combined_score"],55],"#f59e0b",[">=",["get","combined_score"],35],"#22c55e","#64748b"],"circle-opacity":.78,"circle-stroke-width":1,"circle-stroke-color":"#e0f2fe"}});map.on("click","vessel-risk",event=>new mapboxgl.Popup().setLngLat(event.lngLat).setHTML(popupHtml(event.features[0].properties||{})).addTo(map));map.fitBounds([[bbox[0],bbox[1]],[bbox[2],bbox[3]]],{padding:35,duration:0})})}
(async()=>{try{if(app.dataset.page==="detail")await renderDetail();else await renderIndex()}catch(error){app.innerHTML='<div class="wrap"><div class="empty">항만 리스크 스냅샷을 불러오지 못했습니다.</div><section class="health"><h2>Data Health</h2><div class="health-row"><b>'+esc(error.message)+'</b></div></section></div>'}})();
`;

function publicMapboxToken() {
  const token = process.env.MAPBOX_TOKEN || "";
  return token.startsWith("pk.") ? token : "";
}

function writePortPages(generatedAt) {
  const mapboxToken = publicMapboxToken();
  for (const root of STATIC_ROOTS) {
    writeJson(`${root}/data/ports/config.json`, {
      schema_version: SCHEMA_VERSION,
      generated_at: generatedAt,
      mapbox_token: mapboxToken,
      mapbox_token_available: Boolean(mapboxToken)
    });
    const portsRoot = path.join(ROOT, root, "ports");
    ensureDir(portsRoot);
    fs.writeFileSync(path.join(portsRoot, "index.html"), htmlShell({ title: "항만 리스크 지도", page: "index" }), "utf8");
    fs.writeFileSync(path.join(portsRoot, "port-risk.css"), PORT_RISK_CSS, "utf8");
    fs.writeFileSync(path.join(portsRoot, "port-risk.js"), PORT_RISK_JS, "utf8");
    for (const port of PORT_CONFIG) {
      const dir = path.join(portsRoot, port.port_code);
      ensureDir(dir);
      fs.writeFileSync(path.join(dir, "index.html"), htmlShell({ title: `${port.port_name_kr} 리스크 지도`, page: "detail" }), "utf8");
    }
  }
}

function persistStaticFiles(snapshots, indexPayload) {
  for (const root of STATIC_ROOTS) {
    writeJson(`${root}/data/ports/index.json`, indexPayload);
    for (const snapshot of snapshots) {
      writeJson(`${root}/data/ports/${snapshot.port.port_code}/latest.geojson`, snapshot.collection);
    }
  }
  writePortPages(indexPayload.generated_at);
}

function staleFromExisting(error) {
  const generatedAt = new Date().toISOString();
  const existing = readJson("dashboard/data/ports/index.json", null) || readJson("public/data/ports/index.json", null);
  if (!existing) return null;
  existing.data_health = {
    ...(existing.data_health || {}),
    status: "stale",
    warning: error?.message || String(error || "snapshot_failed"),
    last_failed_at: generatedAt
  };
  writeJson("dashboard/data/ports/index.json", existing);
  writeJson("public/data/ports/index.json", existing);
  writePortPages(generatedAt);
  return existing;
}

async function main() {
  const generatedAt = new Date().toISOString();
  const windowEnd = generatedAt;
  const windowStart = new Date(Date.now() - WINDOW_HOURS * 60 * 60 * 1000).toISOString();
  const supabaseSource = await loadSupabaseSourceRecords();
  const staticRecords = loadSourceRecords();
  const sourceRecords = supabaseSource.records.length ? supabaseSource.records : staticRecords;
  const records = sourceRecords.length ? sourceRecords : buildMockRecords();
  const sourceMode = supabaseSource.records.length ? "supabase_latest_run" : staticRecords.length ? "static_dashboard_json" : records.length ? "mock" : "empty";
  const bioLookup = buildBiofoulingLookup();
  const status = sourceStatus(records, bioLookup);
  status.supabase_vessel_snapshots = {
    status: supabaseSource.status,
    reason: supabaseSource.reason,
    error: supabaseSource.error,
    run_id: supabaseSource.run_id,
    row_count: supabaseSource.row_count || supabaseSource.records.length || 0
  };
  const snapshots = [];

  for (const port of PORT_CONFIG) {
    const matched = records.filter(record => matchPort(record)?.port_code === port.port_code);
    const seen = new Set();
    const features = [];
    for (const record of matched) {
      const key = identityKey(record) || `${vesselName(record)}|${recordPortText(record)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      features.push(buildFeature(record, port, bioLookup));
    }
    features.sort((a, b) => toNumber(b.properties.combined_score) - toNumber(a.properties.combined_score));
    const staleRecords = features.filter(feature => {
      const ts = parseDate(feature.properties.portmis_last_ts);
      return ts && Date.now() - ts.getTime() > 96 * 60 * 60 * 1000;
    }).length;
    const missingSources = [];
    if (!records.length) missingSources.push("dashboard_vessels");
    if (!bioLookup.size) missingSources.push("biofouling_scores");
    if (!process.env.MOF_AIS_DYNAMIC_SERVICE_KEY) missingSources.push("mof_ais_dynamic");
    if (!process.env.PORT_OPERATION_SERVICE_KEY) missingSources.push("port_operation");
    if (!features.length) missingSources.push("matching_port_records");
    const dataHealth = {
      status: features.length ? "healthy" : "empty",
      last_updated: generatedAt,
      source_status: status,
      missing_sources: missingSources,
      stale_records_count: staleRecords,
      bbox: port.bbox,
      feature_count: features.length,
      warnings: features.length ? [] : [`${port.port_name_kr}에 매칭된 선박이 없습니다.`],
      mapbox_token_available: Boolean(publicMapboxToken()),
      position_note: "실좌표가 없는 Port-MIS 기반 선박은 항만 bbox 안에 안정적으로 배치됩니다."
    };
    const collection = featureCollection(port, features, dataHealth, generatedAt, windowStart, windowEnd);
    snapshots.push({
      id: randomUUID(),
      port,
      features,
      collection,
      dataHealth,
      generatedAt,
      windowStart,
      windowEnd,
      meta: snapshotMeta(port, collection, dataHealth)
    });
  }

  const dbStatus = await writeSupabase(snapshots);
  for (const snapshot of snapshots) {
    snapshot.dataHealth.db_status = dbStatus;
    snapshot.collection.properties.data_health = snapshot.dataHealth;
    snapshot.meta = snapshotMeta(snapshot.port, snapshot.collection, snapshot.dataHealth);
  }

  const indexPayload = {
    schema_version: SCHEMA_VERSION,
    generated_at: generatedAt,
    snapshot_type: SNAPSHOT_TYPE,
    record_count: snapshots.length,
    ports: snapshots
      .map(snapshot => snapshot.meta)
      .sort((a, b) => toNumber(b.avg_combined_score) - toNumber(a.avg_combined_score)),
    data_health: {
      status: records.length ? "healthy" : "empty",
      source_status: status,
      missing_sources: records.length ? [] : ["dashboard_vessels"],
      db_status: dbStatus,
      data_source_mode: sourceMode,
      mapbox_token_available: Boolean(publicMapboxToken())
    }
  };
  persistStaticFiles(snapshots, indexPayload);

  console.log(JSON.stringify({
    status: "completed",
    ports: snapshots.length,
    total_features: snapshots.reduce((sum, snapshot) => sum + snapshot.features.length, 0),
    db_status: dbStatus,
    generated_at: generatedAt
  }, null, 2));
}

main().catch(error => {
  const stale = staleFromExisting(error);
  console.error(`[PORT_GEOJSON] ${error?.stack || error}`);
  if (stale) {
    console.log(JSON.stringify({ status: "stale_preserved", generated_at: stale.generated_at, error: error.message }, null, 2));
    process.exit(0);
  }
  writePortPages(new Date().toISOString());
  process.exit(0);
});
