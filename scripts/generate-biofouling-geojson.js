#!/usr/bin/env node

import fs from "fs";
import path from "path";
import { createHash } from "crypto";
import { fileURLToPath } from "url";
import { fetchRecent as fetchAisRecent } from "../src/adapters/aisAdapter.js";
import { fetchRecent as fetchPortmisRecent } from "../src/adapters/portmisAdapter.js";
import { fetchRecent as fetchSstRecent } from "../src/adapters/sstAdapter.js";
import { fetchRecent as fetchBuoyRecent } from "../src/adapters/buoyAdapter.js";
import { toBiofoulingNext4dRecord, scoreActionKo, scoreLevelKo } from "../src/lib/biofoulingScore.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const WINDOW_HOURS = 96;
const TARGET_PORTS = [
  { port_code: "BUSAN", port_name_ko: "부산", center: [129.0756, 35.0386], aliases: ["BUSAN", "PUSAN", "부산", "부산항", "KRPUS", "KR PUS"] },
  { port_code: "YEOSU", port_name_ko: "여수", center: [127.744, 34.74], aliases: ["YEOSU", "여수", "여수항"] },
  { port_code: "GWANGYANG", port_name_ko: "광양", center: [127.695, 34.904], aliases: ["GWANGYANG", "광양", "광양항"] }
];

const SEED_ROWS = [
  {
    port_code: "BUSAN",
    mmsi: "440123456",
    imo: "9812345",
    vessel_name: "DEMO-01",
    port_name_ko: "부산",
    lon: 129.0756,
    lat: 35.0386,
    ais_first_seen: "2026-06-05T00:00:00.000Z",
    ais_last_seen: "2026-06-09T00:00:00.000Z",
    residence_hours_96h: 52.3,
    sst_72h_c_avg: 20.7,
    sst_7d_c_avg: 19.8,
    sst_anomaly_c: 0.9,
    portmis_last_ts: "2026-06-09T00:00:00.000Z",
    portmis_recency_boost: 1.4,
    data_health: { status: "mock", sources: ["seed", "AIS mock", "Port-MIS mock", "SST mock"] },
    updated_at: "2026-06-09T00:00:00.000Z"
  },
  {
    port_code: "YEOSU",
    mmsi: "440223456",
    imo: "9822345",
    vessel_name: "DEMO-02",
    port_name_ko: "여수",
    lon: 127.744,
    lat: 34.74,
    ais_first_seen: "2026-06-05T06:00:00.000Z",
    ais_last_seen: "2026-06-09T00:00:00.000Z",
    residence_hours_96h: 43.6,
    sst_72h_c_avg: 21.1,
    sst_7d_c_avg: 20.4,
    sst_anomaly_c: 0.7,
    portmis_last_ts: "2026-06-08T20:00:00.000Z",
    portmis_recency_boost: 1,
    data_health: { status: "mock", sources: ["seed", "AIS mock", "Port-MIS mock", "SST mock"] },
    updated_at: "2026-06-09T00:00:00.000Z"
  },
  {
    port_code: "GWANGYANG",
    mmsi: "440323456",
    imo: "9832345",
    vessel_name: "DEMO-03",
    port_name_ko: "광양",
    lon: 127.695,
    lat: 34.904,
    ais_first_seen: "2026-06-06T00:00:00.000Z",
    ais_last_seen: "2026-06-09T00:00:00.000Z",
    residence_hours_96h: 31.4,
    sst_72h_c_avg: 21.0,
    sst_7d_c_avg: 20.8,
    sst_anomaly_c: 0.2,
    portmis_last_ts: "2026-06-08T12:00:00.000Z",
    portmis_recency_boost: 0.6,
    data_health: { status: "mock", sources: ["seed", "AIS mock", "Port-MIS mock", "SST mock"] },
    updated_at: "2026-06-09T00:00:00.000Z"
  }
];

function readJson(relativePath, fallback = null) {
  const fullPath = path.join(ROOT, relativePath);
  if (!fs.existsSync(fullPath)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(fullPath, "utf8"));
  } catch {
    return fallback;
  }
}

function rows(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.vessels)) return payload.vessels;
  if (Array.isArray(payload?.opportunities)) return payload.opportunities;
  if (Array.isArray(payload?.features)) return payload.features.map(feature => ({ ...(feature.properties || {}), geometry: feature.geometry }));
  return [];
}

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(finiteNumber(value) * factor) / factor;
}

function normalizeText(value) {
  return String(value || "").normalize("NFKC").toUpperCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

function targetPortFor(record = {}) {
  const blob = normalizeText([
    record.port_code,
    record.port_name_ko,
    record.port_name_kr,
    record.port_name,
    record.port,
    record.current_port,
    record.destination_port,
    record.vessel_display?.current_port
  ].filter(Boolean).join(" "));
  if (!blob) return null;
  return TARGET_PORTS.find(port => port.aliases.some(alias => blob.includes(normalizeText(alias)))) || null;
}

function stableFraction(seed, salt) {
  const hash = createHash("sha1").update(`${seed}|${salt}`).digest("hex").slice(0, 12);
  return parseInt(hash, 16) / 0xffffffffffff;
}

function coordinateFor(record, port) {
  const geometryCoordinates = record.geometry?.coordinates || [];
  const lon = finiteNumber(record.lon ?? record.lng ?? record.longitude ?? geometryCoordinates[0], NaN);
  const lat = finiteNumber(record.lat ?? record.latitude ?? geometryCoordinates[1], NaN);
  if (Number.isFinite(lon) && Number.isFinite(lat) && Math.abs(lon) <= 180 && Math.abs(lat) <= 90) return [round(lon, 6), round(lat, 6)];
  const seed = record.imo || record.mmsi || record.vessel_name || record.vessel_display?.vessel_name || port.port_code;
  return [
    round(port.center[0] + (stableFraction(seed, "lon") - 0.5) * 0.06, 6),
    round(port.center[1] + (stableFraction(seed, "lat") - 0.5) * 0.04, 6)
  ];
}

function identityKey(record = {}) {
  return normalizeText(record.imo || record.vessel_display?.imo) ||
    normalizeText(record.mmsi || record.vessel_display?.mmsi) ||
    `${normalizeText(record.vessel_name || record.vessel_display?.vessel_name)}|${normalizeText(record.port_name_ko || record.port_name || record.current_port)}`;
}

function loadExistingRows() {
  const sources = [
    "dashboard/api/anchorage-waiting.json",
    "dashboard/api/staying-vessels.json",
    "dashboard/api/candidates/top.json",
    "dashboard/api/targets/current.json",
    "dashboard/api/vessels/page-1.json",
    "dashboard/api/vessels.json"
  ];
  const merged = [];
  for (const source of sources) merged.push(...rows(readJson(source, {})));
  const seen = new Set();
  return merged.filter(record => {
    const port = targetPortFor(record);
    if (!port) return false;
    const key = identityKey(record);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 80);
}

async function enrichSourceRow(record = {}) {
  const port = targetPortFor(record);
  if (!port) return null;
  const [lon, lat] = coordinateFor(record, port);
  const sst = await fetchSstRecent(port.port_code, WINDOW_HOURS, { lat, lon });
  const sstRow = sst.items[0] || {};
  const residence = finiteNumber(
    record.residence_hours_96h ??
      record.stay_hours ??
      record.port_stay_hours ??
      record.anchorage_hours ??
      record.waiting_hours ??
      record.vessel_display?.stay_hours,
    0
  );
  return {
    mmsi: String(record.mmsi || record.vessel_display?.mmsi || ""),
    imo: String(record.imo || record.vessel_display?.imo || ""),
    vessel_name: String(record.vessel_name || record.ship_name || record.vessel_display?.vessel_name || "선명 확인 필요"),
    port_name_ko: port.port_name_ko,
    port_code: port.port_code,
    lon,
    lat,
    ais_first_seen: record.ais_first_seen || record.first_seen_at || null,
    ais_last_seen: record.ais_last_seen || record.last_seen_at || record.updated_at || null,
    residence_hours_96h: Math.min(96, Math.max(0, round(residence, 1))),
    sst_72h_c_avg: finiteNumber(record.sst_72h_c_avg, sstRow.sst_72h_c_avg || 20),
    sst_7d_c_avg: finiteNumber(record.sst_7d_c_avg, sstRow.sst_7d_c_avg || 20),
    sst_anomaly_c: finiteNumber(record.sst_anomaly_c, sstRow.sst_anomaly_c || 0),
    portmis_last_ts: record.portmis_last_ts || record.last_seen_at || record.updated_at || null,
    data_health: {
      status: sst.data_health?.status || "estimated",
      sources: ["snapshot", sst.source].filter(Boolean),
      source_status: { sst: sst.data_health?.status || "estimated" }
    },
    updated_at: record.updated_at || record.last_seen_at || record.generated_at || null
  };
}

function featureFromRecord(record) {
  const item = toBiofoulingNext4dRecord(record);
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [item.lon, item.lat] },
    properties: {
      ...item,
      risk_level_ko: scoreLevelKo(item.combined_score),
      suggested_action: scoreActionKo(item.combined_score)
    }
  };
}

function stableStringify(payload) {
  return `${JSON.stringify(payload, null, 2)}\n`;
}

function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

function emitIfChanged(relativePath, content) {
  const fullPath = path.join(ROOT, relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  const previous = fs.existsSync(fullPath) ? fs.readFileSync(fullPath, "utf8") : null;
  const nextHash = sha256(content);
  const previousHash = previous === null ? null : sha256(previous);
  if (previousHash === nextHash) {
    console.log(`[biofouling-next4d] no change ${relativePath} sha256=${nextHash}`);
    return { changed: false, sha256: nextHash };
  }
  fs.writeFileSync(fullPath, content, "utf8");
  console.log(`[biofouling-next4d] emitted ${relativePath} sha256=${nextHash}`);
  return { changed: true, sha256: nextHash };
}

async function buildRows() {
  const args = new Set(process.argv.slice(2));
  const noMock = args.has("--no-mock") || process.env.BIOFOULING_NEXT4D_MOCK === "false";
  const forceMock = args.has("--mock");
  const sourceRows = forceMock ? [] : loadExistingRows();
  const enriched = [];
  for (const row of sourceRows) {
    const next = await enrichSourceRow(row);
    if (next) enriched.push(next);
  }
  const useSeed = forceMock || (!noMock && enriched.length === 0);
  if (useSeed) {
    await Promise.all(TARGET_PORTS.map(port => fetchAisRecent(port.port_code, WINDOW_HOURS, { mockRows: SEED_ROWS })));
    await Promise.all(TARGET_PORTS.map(port => fetchPortmisRecent(port.port_code, WINDOW_HOURS, { mockRows: SEED_ROWS })));
    await Promise.all(TARGET_PORTS.map(port => fetchBuoyRecent(port.port_code, WINDOW_HOURS)));
    return SEED_ROWS;
  }
  return enriched;
}

async function main() {
  const records = (await buildRows()).map(featureFromRecord).sort((a, b) =>
    Number(b.properties.combined_score || 0) - Number(a.properties.combined_score || 0) ||
    String(a.properties.vessel_name).localeCompare(String(b.properties.vessel_name), "ko")
  );
  const dataHealth = records.length
    ? { status: records.some(feature => feature.properties.data_health?.status === "mock") ? "mock" : "estimated", ports: ["부산", "여수", "광양"] }
    : { status: "empty", missing_sources: ["AIS", "Port-MIS", "SST"], ports: ["부산", "여수", "광양"] };
  const geojson = {
    type: "FeatureCollection",
    name: "biofouling_next4d",
    schema_version: "1.0",
    window_hours: WINDOW_HOURS,
    ports: ["부산", "여수", "광양"],
    data_health: dataHealth,
    features: records
  };
  const content = stableStringify(geojson);
  const outputs = [
    "public/data/biofouling_next4d.geojson",
    "dashboard/data/biofouling_next4d.geojson"
  ].map(relativePath => emitIfChanged(relativePath, content));
  const changed = outputs.some(result => result.changed);
  const meta = {
    sha256: outputs[0]?.sha256 || sha256(content),
    emitted_at: new Date().toISOString(),
    feature_count: records.length,
    ports: ["부산", "여수", "광양"],
    changed
  };
  if (changed || !fs.existsSync(path.join(ROOT, "public/data/biofouling_next4d.meta.json"))) {
    const metaContent = stableStringify(meta);
    emitIfChanged("public/data/biofouling_next4d.meta.json", metaContent);
    emitIfChanged("dashboard/data/biofouling_next4d.meta.json", metaContent);
  }
  console.log(`[biofouling-next4d] feature_count=${records.length} changed=${changed}`);
}

main().catch(error => {
  console.error(`[biofouling-next4d] failed: ${error.message}`);
  process.exitCode = 1;
});
