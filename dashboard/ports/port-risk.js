const app = document.querySelector("#app");

const fmt = (value, digits = 1) =>
  Number.isFinite(Number(value))
    ? new Intl.NumberFormat("ko-KR", { maximumFractionDigits: digits }).format(Number(value))
    : "-";
const esc = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (match) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  }[match]));

function scoreClass(value) {
  const number = Number(value || 0);
  if (number <= 1) return number >= 0.75 ? "bad" : number >= 0.5 ? "warn" : number >= 0.35 ? "ok" : "";
  return number >= 75 ? "bad" : number >= 55 ? "warn" : number >= 35 ? "ok" : "";
}

function scoreText(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "-";
  return number <= 1 ? fmt(Math.round(number * 100), 0) : fmt(number);
}

async function getJson(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`${url} ${response.status}`);
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("json") && !contentType.includes("geo+json")) {
    throw new Error(`${url} JSON 응답 아님`);
  }
  return response.json();
}

async function getOptionalJson(url) {
  try {
    return await getJson(url);
  } catch {
    return null;
  }
}

function portNamesForCode(code) {
  const map = {
    BUSAN: ["부산"],
    GWANGYANG_YEOSU: ["광양", "여수"],
    YEOSU: ["여수"],
    GWANGYANG: ["광양"],
    INCHEON: ["인천"],
    ULSAN: ["울산"],
    PYEONGTAEK_DANGJIN: ["평택", "당진"],
    MOKPO: ["목포"],
    GUNSAN: ["군산"],
    POHANG: ["포항"],
    MASAN_JINHAE: ["마산", "진해", "창원"]
  };
  return map[String(code || "").toUpperCase()] || [];
}

function next4dFeaturesForPort(geojson, code) {
  const names = portNamesForCode(code);
  if (!names.length) return [];
  return (geojson?.features || []).filter((feature) => {
    const port = String(feature?.properties?.port_name_ko || "");
    return names.some((name) => port.includes(name));
  });
}

function next4dSummaryForPort(geojson, code) {
  const features = next4dFeaturesForPort(geojson, code);
  if (!features.length) return null;
  const scores = features.map((feature) => Number(feature.properties?.combined_score || 0));
  return {
    feature_count: features.length,
    max_score: Math.max(...scores),
    avg_score: scores.reduce((sum, value) => sum + value, 0) / scores.length
  };
}

function healthPanel(meta, geo, next4d) {
  const health = geo?.properties?.data_health || meta?.data_health || {};
  const nextHealth = next4d?.properties?.data_health || {};
  const rows = [
    ["마지막 갱신", meta?.last_updated || geo?.generated_at || next4d?.generated_at],
    ["기존 항만 소스", JSON.stringify(health.source_status || {})],
    ["부착생물 4일 소스", nextHealth.status || nextHealth.quality || "-"],
    ["누락 소스", [...(health.missing_sources || []), ...(nextHealth.missing_sources || [])].join(", ") || "-"],
    ["오래된 레코드", health.stale_records_count ?? 0],
    ["범위", (meta?.bbox || geo?.properties?.bbox || []).join(", ")],
    ["표시 선박", geo?.features?.length ?? meta?.vessel_count ?? 0],
    ["4일 위험 선박", next4d?.features?.length ?? 0],
    ["경고", (health.warnings || []).join(" · ") || health.warning || "-"]
  ];
  return `<section class="health"><h2>데이터 상태 / 기술 진단</h2><div class="health-grid">${rows
    .map(([label, value]) => `<div class="health-row"><span class="small">${esc(label)}</span><br><b>${esc(value)}</b></div>`)
    .join("")}</div></section>`;
}

function portCard(meta, next4d) {
  const summary = next4dSummaryForPort(next4d, meta.port_code);
  return `<a class="card" href="${esc(meta.detail_url)}">
    <div class="row"><h2>${esc(meta.port_name_kr)}</h2><span class="chip ${scoreClass(meta.avg_combined_score)}">${fmt(meta.avg_combined_score)}</span></div>
    <div class="small">${esc(meta.port_name_en)}</div>
    <div class="metrics">
      <div class="metric"><span>선박 수</span><b>${fmt(meta.vessel_count, 0)}</b></div>
      <div class="metric"><span>평균 체류</span><b>${fmt(meta.avg_residence_hours)}h</b></div>
      <div class="metric"><span>최고 점수</span><b>${fmt(meta.max_combined_score)}</b></div>
      <div class="metric"><span>4일 위험</span><b class="${scoreClass(summary?.max_score)}">${summary ? scoreText(summary.max_score) : "-"}</b></div>
    </div>
  </a>`;
}

function next4dCard(feature) {
  const props = feature.properties || {};
  return `<div class="vessel">
    <div class="row"><h3>${esc(props.vessel_name || "선박명 확인 필요")}</h3><span class="chip ${scoreClass(props.combined_score)}">${scoreText(props.combined_score)}</span></div>
    <div class="small">${esc(props.port_name_ko || "-")} · 최근 96시간 체류 ${fmt(props.residence_hours_96h)}h · 수온 이상치 ${fmt(props.sst_anomaly_c)}℃</div>
    <div class="small">${esc(props.score_reason_ko || props.suggested_action || "부착생물 위험 신호를 확인 중입니다.")}</div>
  </div>`;
}

async function renderIndex() {
  const [index, next4d] = await Promise.all([
    getJson("/data/ports/index.json"),
    getOptionalJson("/data/biofouling_next4d.geojson")
  ]);
  const ports = [...(index.ports || [])].sort((a, b) => Number(b.avg_combined_score || 0) - Number(a.avg_combined_score || 0));
  const nextRows = [...(next4d?.features || [])].sort((a, b) => Number(b.properties?.combined_score || 0) - Number(a.properties?.combined_score || 0)).slice(0, 9);
  app.innerHTML = `<div class="wrap">
    <section class="hero">
      <div><h1>항만 리스크 지도</h1><p>주요 항만의 체류, 혼잡, 기회점수와 부산·여수·광양 부착생물 4일 위험 신호를 함께 봅니다.</p></div>
      <span class="chip">${esc(index.generated_at || next4d?.generated_at || "-")}</span>
    </section>
    <section class="grid">${ports.map((port) => portCard(port, next4d)).join("")}</section>
    <section class="health"><h2>부착생물 4일 위험 후보</h2><div class="list">${nextRows.length ? nextRows.map(next4dCard).join("") : '<div class="empty">데이터 준비 중</div>'}</div></section>
    ${healthPanel(index, { features: [], properties: { data_health: index.data_health || {} } }, next4d)}
  </div>`;
}

function popupHtml(props) {
  if (props.residence_hours_96h !== undefined) {
    return `<div class="popup"><b>${esc(props.vessel_name || "선박명 확인 필요")}</b><br>
      MMSI: ${esc(props.mmsi || "-")}<br>
      항구: ${esc(props.port_name_ko || "-")}<br>
      최근 96시간 체류: ${fmt(props.residence_hours_96h)}h<br>
      수온 72시간/7일 평균: ${fmt(props.sst_72h_c_avg)}℃ / ${fmt(props.sst_7d_c_avg)}℃<br>
      수온 이상치: ${fmt(props.sst_anomaly_c)}℃<br>
      Port-MIS 최신 시각: ${esc(props.portmis_last_ts || "-")}<br>
      부착생물 점수: ${scoreText(props.combined_score)}<br>
      판단 사유: ${esc(props.score_reason_ko || "-")}</div>`;
  }
  return `<div class="popup"><b>${esc(props.vessel_name || "선박명 확인 필요")}</b><br>
    선종: ${esc(props.vessel_type || "-")}<br>
    체류: ${fmt(props.residence_hours_72h)}h<br>
    수온 이상치: ${fmt(props.sst_anomaly_c)}℃<br>
    점수: ${fmt(props.combined_score)}<br>
    액션: ${esc(props.suggested_action || "-")}</div>`;
}

async function renderDetail() {
  const code = location.pathname.split("/").filter(Boolean).pop()?.toUpperCase() || "BUSAN";
  const [index, geo, config, next4d] = await Promise.all([
    getJson("/data/ports/index.json"),
    getJson(`/data/ports/${code}/latest.geojson`),
    getJson("/data/ports/config.json").catch(() => ({})),
    getOptionalJson("/data/biofouling_next4d.geojson")
  ]);
  const meta = (index.ports || []).find((port) => port.port_code === code) || {};
  meta.mapbox_token = config.mapbox_token || "";
  const features = [...(geo.features || [])].sort((a, b) => Number(b.properties?.combined_score || 0) - Number(a.properties?.combined_score || 0));
  const nextRows = next4dFeaturesForPort(next4d, code).sort((a, b) => Number(b.properties?.combined_score || 0) - Number(a.properties?.combined_score || 0));
  app.innerHTML = `<div class="wrap">
    <section class="hero">
      <div><h1>${esc(meta.port_name_kr || code)}</h1><p>${esc(meta.port_name_en || "")} · 항만 리스크와 부착생물 4일 위험 후보</p></div>
      <span class="chip ${scoreClass(meta.avg_combined_score)}">평균 ${fmt(meta.avg_combined_score)}</span>
    </section>
    <section class="map-layout">
      <div id="map" class="map"></div>
      <aside class="side">
        <div class="card"><div class="metrics">
          <div class="metric"><span>선박 수</span><b>${fmt(features.length, 0)}</b></div>
          <div class="metric"><span>평균 체류</span><b>${fmt(meta.avg_residence_hours)}h</b></div>
          <div class="metric"><span>최고 점수</span><b>${fmt(meta.max_combined_score)}</b></div>
          <div class="metric"><span>4일 위험 후보</span><b>${fmt(nextRows.length, 0)}</b></div>
        </div></div>
        <div class="health"><h2>부착생물 4일 위험</h2><div class="list">${nextRows.length ? nextRows.slice(0, 12).map(next4dCard).join("") : '<div class="empty">해당 항만의 4일 위험 후보가 없습니다.</div>'}</div></div>
        <div class="list">${features.slice(0, 12).map((feature) => {
          const props = feature.properties || {};
          return `<div class="vessel"><div class="row"><h3>${esc(props.vessel_name || "선박명 확인 필요")}</h3><span class="chip ${scoreClass(props.combined_score)}">${fmt(props.combined_score)}</span></div><div class="small">${esc(props.vessel_type || "-")} · ${fmt(props.residence_hours_72h)}h · ${esc(props.suggested_action || "-")}</div></div>`;
        }).join("") || '<div class="empty">표시할 선박이 없습니다.</div>'}</div>
      </aside>
    </section>
    ${healthPanel(meta, geo, next4d)}
  </div>`;
  drawMap(geo, meta, next4d, code);
}

function drawMap(geo, meta, next4d, code) {
  const token = meta.mapbox_token;
  const mapNode = document.querySelector("#map");
  if (!token || !window.mapboxgl) {
    mapNode.innerHTML = '<div class="empty">Mapbox 공개 토큰이 없어 지도 대신 카드 목록을 표시합니다.</div>';
    return;
  }
  mapboxgl.accessToken = token;
  const bbox = meta.bbox || geo.properties?.bbox || [126, 34, 130, 38];
  const center = [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2];
  const map = new mapboxgl.Map({ container: "map", style: "mapbox://styles/mapbox/dark-v11", center, zoom: 9 });
  map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "top-right");
  map.on("load", () => {
    map.addSource("vessels", { type: "geojson", data: geo });
    map.addLayer({
      id: "vessel-risk",
      type: "circle",
      source: "vessels",
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["get", "residence_hours_72h"], 0, 5, 72, 18, 240, 28],
        "circle-color": ["case", [">=", ["get", "combined_score"], 75], "#ef4444", [">=", ["get", "combined_score"], 55], "#f59e0b", [">=", ["get", "combined_score"], 35], "#22c55e", "#64748b"],
        "circle-opacity": 0.46,
        "circle-stroke-width": 1,
        "circle-stroke-color": "#e0f2fe"
      }
    });
    const nextFeatures = next4dFeaturesForPort(next4d, code);
    if (nextFeatures.length) {
      map.addSource("biofouling-next4d", {
        type: "geojson",
        data: { type: "FeatureCollection", features: nextFeatures }
      });
      map.addLayer({
        id: "biofouling-next4d-risk",
        type: "circle",
        source: "biofouling-next4d",
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["get", "residence_hours_96h"], 0, 8, 72, 24, 168, 34],
          "circle-color": ["case", [">=", ["get", "combined_score"], 0.75], "#f43f5e", [">=", ["get", "combined_score"], 0.5], "#f59e0b", [">=", ["get", "combined_score"], 0.35], "#22c55e", "#94a3b8"],
          "circle-opacity": 0.82,
          "circle-stroke-width": 2,
          "circle-stroke-color": "#fef3c7"
        }
      });
      map.on("click", "biofouling-next4d-risk", (event) => new mapboxgl.Popup().setLngLat(event.lngLat).setHTML(popupHtml(event.features[0].properties || {})).addTo(map));
    }
    map.on("click", "vessel-risk", (event) => new mapboxgl.Popup().setLngLat(event.lngLat).setHTML(popupHtml(event.features[0].properties || {})).addTo(map));
    map.fitBounds([[bbox[0], bbox[1]], [bbox[2], bbox[3]]], { padding: 35, duration: 0 });
  });
}

(async () => {
  try {
    if (app.dataset.page === "detail") await renderDetail();
    else await renderIndex();
  } catch (error) {
    app.innerHTML = `<div class="wrap"><div class="empty">항만 리스크 지도를 불러오지 못했습니다.</div><section class="health"><h2>데이터 상태 / 기술 진단</h2><div class="health-row"><b>${esc(error.message)}</b></div></section></div>`;
  }
})();
