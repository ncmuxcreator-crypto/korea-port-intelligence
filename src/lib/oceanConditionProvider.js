const nowIso = () => new Date().toISOString();

export const OCEAN_PORT_FALLBACKS = [
  { port_code: "BUSAN", port_name_ko: "부산", lat: 35.096, lon: 129.045, sst_c: 24.6, sst_anomaly_c: 2.1, marine_heatwave_level: "HIGH" },
  { port_code: "GWANGYANG", port_name_ko: "광양", lat: 34.904, lon: 127.695, sst_c: 25.1, sst_anomaly_c: 2.4, marine_heatwave_level: "HIGH" },
  { port_code: "YEOSU", port_name_ko: "여수", lat: 34.74, lon: 127.744, sst_c: 25.3, sst_anomaly_c: 2.6, marine_heatwave_level: "EXTREME" },
  { port_code: "ULSAN", port_name_ko: "울산", lat: 35.48, lon: 129.39, sst_c: 23.8, sst_anomaly_c: 1.7, marine_heatwave_level: "WATCH" },
  { port_code: "POHANG", port_name_ko: "포항", lat: 36.03, lon: 129.39, sst_c: 22.9, sst_anomaly_c: 1.4, marine_heatwave_level: "WATCH" },
  { port_code: "SAMCHEONPO", port_name_ko: "삼천포", lat: 34.93, lon: 128.08, sst_c: 24.8, sst_anomaly_c: 2.0, marine_heatwave_level: "HIGH" },
  { port_code: "HADONG", port_name_ko: "하동", lat: 34.95, lon: 127.82, sst_c: 24.9, sst_anomaly_c: 2.2, marine_heatwave_level: "HIGH" },
  { port_code: "INCHEON", port_name_ko: "인천", lat: 37.45, lon: 126.61, sst_c: 21.7, sst_anomaly_c: 1.1, marine_heatwave_level: "WATCH" },
  { port_code: "PYEONGTAEK", port_name_ko: "평택·당진", lat: 36.98, lon: 126.84, sst_c: 22.2, sst_anomaly_c: 1.3, marine_heatwave_level: "WATCH" },
  { port_code: "GUNSAN", port_name_ko: "군산", lat: 35.99, lon: 126.59, sst_c: 22.0, sst_anomaly_c: 0.8, marine_heatwave_level: "NORMAL" },
  { port_code: "DONGHAE", port_name_ko: "동해", lat: 37.49, lon: 129.13, sst_c: 21.3, sst_anomaly_c: 1.0, marine_heatwave_level: "WATCH" },
  { port_code: "SAMCHEOK", port_name_ko: "삼척", lat: 37.43, lon: 129.19, sst_c: 21.2, sst_anomaly_c: 0.9, marine_heatwave_level: "NORMAL" }
];

export function normalizeOceanPortCode(value = "") {
  const raw = String(value || "")
    .normalize("NFKC")
    .toUpperCase()
    .replace(/[\s._/·-]+/g, "");
  if (!raw) return "UNKNOWN";
  const portCodeMap = {
    "020": "BUSAN",
    "030": "INCHEON",
    "031": "PYEONGTAEK",
    "620": "YEOSU",
    "620YEOSU": "YEOSU",
    "620GWANGYANG": "GWANGYANG",
    "810": "POHANG",
    "820": "ULSAN"
  };
  if (portCodeMap[raw]) return portCodeMap[raw];
  if (/BUSAN|PUSAN|KRPUS|부산/.test(raw)) return "BUSAN";
  if (/GWANGYANG|광양/.test(raw)) return "GWANGYANG";
  if (/YEOSU|여수/.test(raw)) return "YEOSU";
  if (/ULSAN|KRUSN|울산/.test(raw)) return "ULSAN";
  if (/POHANG|포항/.test(raw)) return "POHANG";
  if (/SAMCHEONPO|삼천포/.test(raw)) return "SAMCHEONPO";
  if (/HADONG|하동/.test(raw)) return "HADONG";
  if (/INCHEON|인천/.test(raw)) return "INCHEON";
  if (/PYEONGTAEK|PYONGTAEK|DANGJIN|KRPTK|평택|당진/.test(raw)) return "PYEONGTAEK";
  if (/GUNSAN|군산/.test(raw)) return "GUNSAN";
  if (/DONGHAE|동해/.test(raw)) return "DONGHAE";
  if (/SAMCHEOK|삼척/.test(raw)) return "SAMCHEOK";
  return raw;
}

function finiteNumber(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function heatFactor(sstC) {
  const sst = Number(sstC || 0);
  if (sst < 10) return 0;
  if (sst < 15) return 5;
  if (sst < 20) return 10;
  if (sst < 25) return 20;
  return 30;
}

export function normalizeOceanCondition(input = {}, options = {}) {
  const portCode = normalizeOceanPortCode(input.port_code || input.portCode || input.port_name_ko || input.port_name || input.port || options.portCode);
  const fallback = OCEAN_PORT_FALLBACKS.find(port => port.port_code === portCode) || OCEAN_PORT_FALLBACKS[0];
  const sstC = finiteNumber(input.sst_c ?? input.sstC ?? input.sstCelsius, fallback.sst_c);
  const anomaly = finiteNumber(input.sst_anomaly_c ?? input.sstAnomalyC ?? input.sstAnomalyCelsius, fallback.sst_anomaly_c);
  const level = String(input.marine_heatwave_level || input.marineHeatwaveLevel || fallback.marine_heatwave_level || "NORMAL").toUpperCase();
  const updatedAt = input.updated_at || input.updatedAt || options.generatedAt || nowIso();
  return {
    port_code: portCode,
    port_name_ko: input.port_name_ko || input.portNameKo || fallback.port_name_ko,
    lat: finiteNumber(input.lat, fallback.lat),
    lon: finiteNumber(input.lon, fallback.lon),
    sst_c: Math.round(sstC * 10) / 10,
    sst_anomaly_c: Math.round(anomaly * 10) / 10,
    marine_heatwave_level: ["NORMAL", "WATCH", "HIGH", "EXTREME"].includes(level) ? level : "NORMAL",
    biofouling_water_temp_factor: heatFactor(sstC),
    source: input.source || options.source || "FALLBACK",
    observed_at: input.observed_at || input.observedAt || updatedAt,
    updated_at: updatedAt
  };
}

async function fetchJson(url, timeoutMs = 3500) {
  if (!url || typeof fetch !== "function") return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { accept: "application/json" } });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export const fallbackProvider = {
  async fetchPortOceanConditions(options = {}) {
    return this.getFallbackOceanConditions(options);
  },
  normalizeOceanCondition,
  getFallbackOceanConditions(options = {}) {
    return OCEAN_PORT_FALLBACKS.map(row => normalizeOceanCondition(row, {
      generatedAt: options.generatedAt,
      source: "FALLBACK"
    }));
  }
};

export const noaaProvider = {
  async fetchPortOceanConditions(options = {}) {
    const payload = await fetchJson(options.noaaUrl || process.env.NOAA_SST_URL || process.env.NOAA_SST_JSON_URL, options.timeoutMs);
    const rows = Array.isArray(payload?.items) ? payload.items : Array.isArray(payload?.ports) ? payload.ports : [];
    return rows.map(row => normalizeOceanCondition(row, { generatedAt: options.generatedAt, source: "NOAA" }));
  },
  normalizeOceanCondition,
  getFallbackOceanConditions: fallbackProvider.getFallbackOceanConditions
};

export const cmemsProvider = {
  async fetchPortOceanConditions(options = {}) {
    const payload = await fetchJson(options.cmemsUrl || process.env.CMEMS_API_URL || process.env.KOEM_API_URL, options.timeoutMs);
    const rows = Array.isArray(payload?.items) ? payload.items : Array.isArray(payload?.ports) ? payload.ports : [];
    return rows.map(row => normalizeOceanCondition(row, { generatedAt: options.generatedAt, source: "CMEMS" }));
  },
  normalizeOceanCondition,
  getFallbackOceanConditions: fallbackProvider.getFallbackOceanConditions
};

export const OceanConditionProvider = {
  async fetchPortOceanConditions(options = {}) {
    const providers = [
      process.env.CMEMS_API_URL || process.env.KOEM_API_URL ? cmemsProvider : null,
      process.env.NOAA_SST_URL || process.env.NOAA_SST_JSON_URL ? noaaProvider : null,
      fallbackProvider
    ].filter(Boolean);
    for (const provider of providers) {
      const rows = await provider.fetchPortOceanConditions(options);
      if (rows.length) return rows;
    }
    return fallbackProvider.getFallbackOceanConditions(options);
  },
  normalizeOceanCondition,
  getFallbackOceanConditions: fallbackProvider.getFallbackOceanConditions
};
