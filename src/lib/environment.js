const PORT_ENVIRONMENT_MOCKS = {
  BUSAN: { sstCelsius: 22.4, sstAnomalyCelsius: 0.8, salinityPsu: 33.8 },
  PUSAN: { sstCelsius: 22.4, sstAnomalyCelsius: 0.8, salinityPsu: 33.8 },
  "020": { sstCelsius: 22.4, sstAnomalyCelsius: 0.8, salinityPsu: 33.8 },
  ULSAN: { sstCelsius: 21.8, sstAnomalyCelsius: 0.7, salinityPsu: 34.0 },
  "820": { sstCelsius: 21.8, sstAnomalyCelsius: 0.7, salinityPsu: 34.0 },
  GWANGYANG: { sstCelsius: 22.7, sstAnomalyCelsius: 0.9, salinityPsu: 33.4 },
  YEOSU: { sstCelsius: 22.7, sstAnomalyCelsius: 0.9, salinityPsu: 33.5 },
  "620": { sstCelsius: 22.7, sstAnomalyCelsius: 0.9, salinityPsu: 33.4 },
  INCHEON: { sstCelsius: 20.8, sstAnomalyCelsius: 0.6, salinityPsu: 31.8 },
  "030": { sstCelsius: 20.8, sstAnomalyCelsius: 0.6, salinityPsu: 31.8 },
  PYEONGTAEK_DANGJIN: { sstCelsius: 20.9, sstAnomalyCelsius: 0.6, salinityPsu: 31.6 },
  "031": { sstCelsius: 20.9, sstAnomalyCelsius: 0.6, salinityPsu: 31.6 },
  POHANG: { sstCelsius: 21.4, sstAnomalyCelsius: 0.7, salinityPsu: 34.1 },
  "810": { sstCelsius: 21.4, sstAnomalyCelsius: 0.7, salinityPsu: 34.1 },
  MASAN: { sstCelsius: 22.1, sstAnomalyCelsius: 0.8, salinityPsu: 33.2 },
  "622": { sstCelsius: 22.1, sstAnomalyCelsius: 0.8, salinityPsu: 33.2 },
  MOKPO: { sstCelsius: 21.5, sstAnomalyCelsius: 0.7, salinityPsu: 32.3 },
  "070": { sstCelsius: 21.5, sstAnomalyCelsius: 0.7, salinityPsu: 32.3 },
  GUNSAN: { sstCelsius: 20.7, sstAnomalyCelsius: 0.6, salinityPsu: 31.9 },
  "080": { sstCelsius: 20.7, sstAnomalyCelsius: 0.6, salinityPsu: 31.9 },
  UNKNOWN: { sstCelsius: 20.0, sstAnomalyCelsius: 0.2, salinityPsu: 34.0 }
};

function firstNonEmpty(...values) {
  return values.find(value => value !== undefined && value !== null && String(value).trim() !== "") ?? "";
}

function normalizePortToken(value) {
  const raw = String(value || "UNKNOWN").normalize("NFKC").trim().toUpperCase();
  if (!raw) return "UNKNOWN";
  if (/BUSAN|PUSAN|KRPUS|KR PUS|부산/.test(raw)) return "BUSAN";
  if (/ULSAN|KRUSN|울산/.test(raw)) return "ULSAN";
  if (/GWANGYANG|광양/.test(raw)) return "GWANGYANG";
  if (/YEOSU|여수/.test(raw)) return "YEOSU";
  if (/INCHEON|인천/.test(raw)) return "INCHEON";
  if (/PYEONGTAEK|DANGJIN|KRPTK|평택|당진/.test(raw)) return "PYEONGTAEK_DANGJIN";
  if (/POHANG|포항/.test(raw)) return "POHANG";
  if (/MASAN|CHANGWON|JINHAE|마산|창원|진해/.test(raw)) return "MASAN";
  if (/MOKPO|목포/.test(raw)) return "MOKPO";
  if (/GUNSAN|군산/.test(raw)) return "GUNSAN";
  return raw;
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

async function fetchEnvironmentalApi(url, { portCode, lat, lon, timeoutMs = 3500 } = {}) {
  if (!url || typeof fetch !== "function") return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const target = new URL(url);
    if (portCode) target.searchParams.set("port_code", portCode);
    if (Number.isFinite(Number(lat))) target.searchParams.set("lat", String(lat));
    if (Number.isFinite(Number(lon))) target.searchParams.set("lon", String(lon));
    const response = await fetch(target, { signal: controller.signal, headers: { accept: "application/json" } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    return {
      sstCelsius: finiteNumber(firstNonEmpty(payload.sstCelsius, payload.sst_celsius, payload.sst)),
      sstAnomalyCelsius: finiteNumber(firstNonEmpty(payload.sstAnomalyCelsius, payload.sst_anomaly_celsius, payload.sst_anomaly)),
      salinityPsu: finiteNumber(firstNonEmpty(payload.salinityPsu, payload.salinity_psu, payload.salinity)),
      source: String(payload.source || "CMEMS").toUpperCase(),
      updatedAt: payload.updatedAt || payload.updated_at || new Date().toISOString(),
      quality: payload.quality || "good"
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function getEnvironmentalSnapshot(portCode, lat, lon, options = {}) {
  const token = normalizePortToken(portCode);
  const envUrl = firstNonEmpty(
    options.apiUrl,
    process.env.CMEMS_API_URL,
    process.env.KOEM_API_URL,
    process.env.SST_API_URL,
    process.env.NOAA_SST_URL,
    process.env.ENVIRONMENT_API_URL
  );
  const apiSnapshot = await fetchEnvironmentalApi(envUrl, { portCode: token, lat, lon, timeoutMs: options.timeoutMs });
  if (apiSnapshot?.sstCelsius !== null || apiSnapshot?.sstAnomalyCelsius !== null || apiSnapshot?.salinityPsu !== null) {
    return {
      sstCelsius: apiSnapshot.sstCelsius ?? 20,
      sstAnomalyCelsius: apiSnapshot.sstAnomalyCelsius ?? 0,
      salinityPsu: apiSnapshot.salinityPsu ?? 34,
      source: apiSnapshot.source === "KOEM" ? "KOEM" : "CMEMS",
      updatedAt: apiSnapshot.updatedAt,
      quality: apiSnapshot.quality || "good"
    };
  }

  const mock = PORT_ENVIRONMENT_MOCKS[token] || PORT_ENVIRONMENT_MOCKS[normalizePortToken(portCode)] || PORT_ENVIRONMENT_MOCKS.UNKNOWN;
  if (mock) {
    return {
      ...mock,
      source: "MOCK",
      updatedAt: new Date().toISOString(),
      quality: "estimated"
    };
  }

  return {
    sstCelsius: 18,
    sstAnomalyCelsius: 0,
    salinityPsu: 34,
    source: "FALLBACK",
    updatedAt: new Date().toISOString(),
    quality: "missing"
  };
}

export { PORT_ENVIRONMENT_MOCKS };
