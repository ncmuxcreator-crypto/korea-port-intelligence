import { arr, n, fmt, esc, pick, uniqueBy } from "./utils.js?v=20260601-db-snapshot-3";
import { apiFactory } from "./api-client.js?v=20260601-db-snapshot-3";
import { buildKpiRows } from "./kpi-resolver.js?v=20260601-db-snapshot-3";
import { buildHealthRows } from "./data-health-renderer.js?v=20260601-db-snapshot-3";
import { renderCandidateCards, renderCandidateTableRows } from "./candidate-table-renderer.js?v=20260601-db-snapshot-3";

const $ = id => document.getElementById(id);
const state = {
  rows: [],
  summary: {},
  status: {},
  health: {},
  continuity: {},
  alerts: {},
  ports: [],
  top: {},
  changes: {},
  followups: [],
  latency: {},
  tab: "all",
  page: 1,
  pageSize: 10,
  sample: false,
  rowsRendered: false
};

window.__dashboardState = state;
const api = apiFactory(state);

function firstKnownNumber(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && String(value).trim() !== "" && Number.isFinite(Number(value))) {
      return Number(value);
    }
  }
  return 0;
}

function vesselName(vessel) {
  return pick(vessel, "vessel_name", "ship_name", "name", "normalized_vessel_name") || "선명 확인 필요";
}

function portName(vessel) {
  return pick(vessel, "port_name", "port", "current_port", "port_code") || "항만 확인 필요";
}

function vesselKey(vessel) {
  return pick(vessel, "vessel_id", "master_vessel_id", "port_call_id", "imo", "mmsi") ||
    `${vesselName(vessel).toLowerCase()}|${portName(vessel).toLowerCase()}`;
}

export function score(vessel) {
  return firstKnownNumber(
    vessel?.salesScore,
    vessel?.sales_score,
    vessel?.sales_priority_score,
    vessel?.total_sales_priority_score,
    vessel?.commercial_value_score,
    vessel?.opportunity_score,
    vessel?.cleaning_candidate_score,
    vessel?.biofoulingScore,
    vessel?.biofouling_score,
    vessel?.biofouling_exposure_score,
    vessel?.risk_score
  );
}

function riskScore(vessel) {
  return firstKnownNumber(
    vessel?.biofoulingScore,
    vessel?.biofouling_score,
    vessel?.biofouling_exposure_score,
    vessel?.risk_score,
    vessel?.predicted_cleaning_opportunity_score,
    score(vessel)
  );
}

function stayHours(vessel) {
  return firstKnownNumber(
    vessel?.stay_hours,
    vessel?.hours_in_area,
    vessel?.port_stay_hours,
    vessel?.current_call_stay_hours,
    vessel?.cumulative_stay_hours,
    vessel?.anchoring_hours,
    vessel?.anchorage_hours,
    vessel?.duration_hours
  );
}

function stayLabel(vessel) {
  const hours = stayHours(vessel);
  if (!hours) return "0일";
  const days = hours / 24;
  return days >= 1 ? `${Math.round(days * 10) / 10}일` : `${Math.round(hours)}시간`;
}

function scheduleValue(vessel) {
  return pick(vessel, "eta", "etb", "ata", "atb", "predicted_arrival_time", "arrival_time", "berth_time");
}

function scheduleRank(vessel) {
  const value = scheduleValue(vessel);
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : Number.MAX_SAFE_INTEGER;
}

function formatDateTime(value) {
  if (!value) return "확인 불가";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function dateLabel(vessel) {
  const fields = [
    ["ETA", pick(vessel, "eta", "predicted_arrival_time")],
    ["ETB", vessel?.etb],
    ["ATA", vessel?.ata],
    ["ATB", vessel?.atb]
  ].filter(([, value]) => value);
  if (!fields.length) return "확인 불가";
  return fields.slice(0, 2).map(([label, value]) => `${label} ${formatDateTime(value)}`).join(" / ");
}

function statusText(vessel) {
  const raw = String(pick(vessel, "status_bucket", "status", "operational_status", "vessel_status")).toLowerCase();
  if (/arrived_staying|staying|stay|체류/.test(raw)) return "체류";
  if (/anch|waiting|wait|묘박|대기/.test(raw)) return "묘박/대기";
  if (/berth|dock|alongside|접안/.test(raw)) return "접안";
  if (/arriv|eta|입항/.test(raw) || pick(vessel, "eta", "predicted_arrival_time")) return "입항예정";
  if (/depart|sail|출항/.test(raw)) return "출항";
  return raw ? raw : "확인 불가";
}

function grade(vessel) {
  const raw = String(pick(vessel, "priority_label", "sales_priority", "sales_priority_band", "commercial_value_band", "candidate_band")).toUpperCase();
  if (raw.includes("HOT") || raw.includes("IMMEDIATE") || score(vessel) >= 75) return ["HOT", "hot"];
  if (raw.includes("WARM") || raw.includes("SALES_TARGET") || score(vessel) >= 50) return ["WARM", "warm"];
  return ["COLD", "cold"];
}

function action(vessel) {
  return pick(
    vessel,
    "recommended_action",
    "recommended_next_action",
    "candidate_next_action",
    "next_action"
  ) || "대리점 통해 ETA와 작업 가능 시간을 확인";
}

function memo(vessel) {
  return pick(
    vessel,
    "reason_summary",
    "why_now",
    "candidate_summary_ko",
    "opportunity_summary",
    "memo"
  ) || "체류 시간, 항만 상태, 목적지 규제 가능성을 함께 확인";
}

function tags(vessel) {
  const rawTags = [
    ...(Array.isArray(vessel.reason_codes) ? vessel.reason_codes : []),
    ...(Array.isArray(vessel.commercial_signal_flags) ? vessel.commercial_signal_flags : []),
    grade(vessel)[0],
    statusText(vessel)
  ];
  const route = [vessel.destination, vessel.destination_port, vessel.next_port].join(" ");
  if (/australia|brazil|new zealand|호주|브라질|뉴질랜드/i.test(route)) rawTags.push("규제 항로");
  if (stayHours(vessel) >= 72) rawTags.push("장기체류");
  return [...new Set(rawTags.filter(Boolean))].slice(0, 5);
}

function isSalesCandidate(vessel) {
  const band = String(pick(vessel, "candidate_band", "sales_priority_band", "priority_label", "commercial_value_band")).toLowerCase();
  const explicit = /(immediate|sales_target|target|candidate|hot|warm|cold|low|watch|qualified)/.test(band);
  return explicit || score(vessel) >= 45 || riskScore(vessel) >= 65 || stayHours(vessel) >= 96;
}

function sortCandidates(rows) {
  return rows.slice().sort((a, b) =>
    score(b) - score(a) ||
    stayHours(b) - stayHours(a) ||
    scheduleRank(a) - scheduleRank(b) ||
    vesselName(a).localeCompare(vesselName(b), "ko")
  );
}

export function getSalesCandidates(vessels) {
  return sortCandidates(uniqueBy((vessels || []).filter(isSalesCandidate), vesselKey));
}

function sampleRows() {
  return [
    {
      vessel_name: "KONG QUE ZUO",
      imo: "9876543",
      port_name: "부산항",
      status_bucket: "anchorage_waiting",
      stay_hours: 168,
      commercial_value_score: 96,
      biofouling_exposure_score: 88,
      candidate_band: "immediate_target",
      destination: "Australia",
      recommended_action: "대리점 통해 출항 전 작업 가능 시간 확인",
      why_now: "장기 묘박과 규제 항로가 겹쳐 즉시 확인 가치가 높습니다."
    },
    {
      vessel_name: "NEW DEDICATION",
      imo: "9876544",
      port_name: "울산항",
      status_bucket: "berthed",
      stay_hours: 84,
      commercial_value_score: 88,
      biofouling_exposure_score: 76,
      candidate_band: "immediate_target",
      destination: "Brazil",
      recommended_action: "선체 상태와 출항 예정 시간을 먼저 확인",
      why_now: "접안 체류가 길고 브라질 규제 대응 가능성이 있습니다."
    },
    {
      vessel_name: "PACIFIC KING",
      imo: "9876545",
      port_name: "여수·광양항",
      status_bucket: "arriving_soon",
      eta: new Date(Date.now() + 27 * 36e5).toISOString(),
      stay_hours: 0,
      commercial_value_score: 67,
      biofouling_exposure_score: 58,
      candidate_band: "sales_target",
      destination: "New Zealand",
      recommended_action: "입항 24시간 전 선주·대리점 접점 확인",
      why_now: "뉴질랜드 항로와 입항 예정 정보가 확인되어 사전 영업 가치가 있습니다."
    }
  ];
}

function useSampleFallback() {
  state.sample = true;
  state.rows = sampleRows();
  state.summary = {
    record_count: 3,
    all_vessels_count: 3,
    total_vessels: 3,
    sales_target_count: 3,
    immediate_target_count: 2,
    port_count: 3,
    data_mode: "sample_mode",
    generated_at: new Date().toISOString(),
    fallback_used: true,
    fallback_reason: "sample_mode_final_fallback",
    run_id: "sample_mode"
  };
  state.status = { data_mode: "sample_mode", status: "sample" };
}

function inferDataSourceLabel() {
  const finalSource = [
    state.summary.data_source_used,
    state.status.data_source_used,
    state.summary.data_mode,
    state.status.data_mode,
    state.summary.serving_mode,
    state.status.serving_mode
  ].join(" ").toLowerCase();
  const text = JSON.stringify({ summary: state.summary, status: state.status, health: state.health }).toLowerCase();
  if (/supabase|active_dataset|latest_successful|summary_snapshot|db_snapshot/.test(finalSource)) return "DB 스냅샷";
  if (/csv|source_csv/.test(finalSource)) return "CSV";
  if (state.sample || /sample_mode/.test(finalSource)) return "샘플 데이터";
  if (/supabase|worker_supabase|api|live/.test(text)) return "API";
  return "API";
}

function csvFailed() {
  const finalSource = [
    state.summary.data_source_used,
    state.status.data_source_used,
    state.summary.data_mode,
    state.status.data_mode
  ].join(" ").toLowerCase();
  if (/supabase|active_dataset|latest_successful|summary_snapshot|db_snapshot/.test(finalSource)) return false;
  const text = JSON.stringify({ summary: state.summary, status: state.status, health: state.health }).toLowerCase();
  return /csv|source_csv/.test(text) && /fail|error|timeout|unavailable|실패|오류/.test(text);
}

function lastUpdated() {
  return state.summary.last_success_at ||
    state.status.last_success_at ||
    state.summary.generated_at ||
    state.status.generated_at ||
    state.health.generated_at ||
    "";
}

function renderKpi() {
  const rows = buildKpiRows({ state, score, riskScore, statusText, salesRows: getSalesCandidates });
  $("kpiGrid").innerHTML = rows.map(([title, value, caption]) => `
    <article class="metric" data-kpi="${esc(title)}">
      <span>${esc(title)}</span>
      <strong>${fmt(value)}</strong>
      <span>${esc(caption)}</span>
    </article>
  `).join("");
}

function renderStatus() {
  const count = firstKnownNumber(
    state.summary.all_vessels_count,
    state.summary.total_vessels,
    state.status.all_vessels_count,
    state.status.record_count,
    state.rows.length
  );
  const sample = state.sample || state.status.data_mode === "sample_mode";
  const source = inferDataSourceLabel();
  const dbSnapshot = source === "DB 스냅샷";
  const noLive = !dbSnapshot && (state.status.data_mode === "no_live_data" || state.summary.data_source_used === "diagnostics_only_no_live_data");
  const fallback = !dbSnapshot && Boolean(state.summary.fallback_used || state.status.fallback_used || sample || noLive);
  const statusLabel = sample ? "샘플" : fallback || noLive ? "주의" : "정상";

  $("sourceBadge").className = `status-pill ${sample || fallback || noLive ? "warn" : "ok"}`;
  $("sourceBadge").textContent = `${source} · ${statusLabel}`;
  $("healthBadge").className = `chip ${sample || fallback || noLive ? "warn" : "ok"}`;
  $("healthBadge").textContent = statusLabel;
  $("freshBadge").textContent = `마지막 업데이트 ${formatDateTime(lastUpdated())}`;

  $("healthRows").innerHTML = buildHealthRows({
    summary: state.summary,
    status: state.status,
    health: state.health,
    count,
    dataSourceLabel: source,
    sample,
    fallback,
    noLive,
    lastUpdated: formatDateTime(lastUpdated())
  }).map(([label, value]) => `
    <div class="data-item"><span>${esc(label)}</span><b>${esc(value)}</b></div>
  `).join("");

  const notices = [];
  if (csvFailed()) notices.push("CSV 데이터를 불러오지 못했습니다. 기존 데이터를 표시합니다.");
  if (sample) notices.push("실제 데이터가 확인되지 않아 샘플 데이터로 화면을 유지합니다.");
  else if (fallback || noLive) notices.push("최근 성공 데이터 또는 정적 백업 기준으로 화면을 유지합니다.");

  $("notice").className = notices.length ? `notice show ${sample ? "" : "err"}` : "notice";
  $("notice").innerHTML = notices.map(message => `<div>${esc(message)}</div>`).join("");
}

function renderAlerts() {
  const alertRows = arr(state.alerts.alerts || state.alerts);
  const rows = [
    ...(csvFailed() ? [{ title: "CSV 로딩 실패", severity: "주의", recommended_action: "기존 데이터 표시 중" }] : []),
    ...alertRows
  ].slice(0, 6);
  $("alertBadge").textContent = `${fmt(rows.length)}건`;
  $("alertRows").innerHTML = rows.length
    ? rows.map(row => `
      <div class="data-item">
        <span>${esc(row.title || row.alert_type || row.type || "알림")}</span>
        <b>${esc(row.severity || row.recommended_action || "확인")}</b>
      </div>
    `).join("")
    : '<div class="empty">표시할 알림이 없습니다.</div>';
}

function portRowsFromVessels() {
  const byPort = new Map();
  for (const vessel of state.rows) {
    const port = portName(vessel);
    const row = byPort.get(port) || {
      port_name: port,
      total_vessels: 0,
      high_risk_count: 0,
      anchorage_waiting_count: 0,
      berthed_count: 0,
      arrival_pipeline_count: 0,
      long_stay_vessels: 0
    };
    row.total_vessels += 1;
    if (riskScore(vessel) >= 65) row.high_risk_count += 1;
    if (statusText(vessel) === "묘박/대기") row.anchorage_waiting_count += 1;
    if (statusText(vessel) === "접안") row.berthed_count += 1;
    if (statusText(vessel) === "입항예정") row.arrival_pipeline_count += 1;
    if (stayHours(vessel) >= 72) row.long_stay_vessels += 1;
    byPort.set(port, row);
  }
  return [...byPort.values()];
}

function renderPorts() {
  let rows = arr(state.ports);
  if (!rows.length) rows = arr(state.summary?.ports);
  if (!rows.length) rows = portRowsFromVessels();

  $("portCount").textContent = `${fmt(rows.length)}개 항만`;
  $("ports").innerHTML = rows.length
    ? rows.slice(0, 12).map((port, index) => {
      const total = firstKnownNumber(port.total_vessels, port.vessel_count, port.record_count);
      const high = firstKnownNumber(port.high_risk_count, port.immediate_target_count, port.immediate_targets, port.hot_count);
      const anchorage = firstKnownNumber(port.anchorage_waiting_count, port.anchorage_count, port.waiting_count);
      const berthed = firstKnownNumber(port.berthed_count, port.berth_count, port.at_berth_count);
      const arrivals = firstKnownNumber(port.arrival_pipeline_count, port.arriving_count, port.eta_count);
      const longStay = firstKnownNumber(port.long_stay_vessels, port.long_stay_count);
      return `
        <details class="port-card" ${index < 3 ? "open" : ""}>
          <summary>
            <div class="port-summary">
              <span class="port-name">${esc(portName(port))}</span>
              <span class="chip ${high ? "hot" : "ok"}">${fmt(total)}척 · 고위험 ${fmt(high)}</span>
            </div>
          </summary>
          <div class="port-details kv-grid">
            <div class="kv"><span>묘박/대기</span><b>${fmt(anchorage)}</b></div>
            <div class="kv"><span>접안</span><b>${fmt(berthed)}</b></div>
            <div class="kv"><span>입항예정</span><b>${fmt(arrivals)}</b></div>
            <div class="kv"><span>장기체류</span><b>${fmt(longStay)}</b></div>
          </div>
        </details>
      `;
    }).join("")
    : '<div class="empty">항만 요약 데이터가 없습니다.</div>';

  const current = $("portFilter").value;
  const options = [...new Set(rows.map(portName).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ko"));
  $("portFilter").innerHTML = '<option value="">전체 항만</option>' + options.map(port => `<option>${esc(port)}</option>`).join("");
  $("portFilter").value = options.includes(current) ? current : "";
}

function renderHotList() {
  const sourceRows = state.rows.length ? state.rows : summaryCandidateRows();
  const rows = getSalesCandidates(sourceRows).slice(0, 10);
  $("hotList").innerHTML = rows.length
    ? rows.map((vessel, index) => `
      <details class="hot-detail">
        <summary class="hot-item" data-score="${score(vessel)}">
          <span class="rank">${index + 1}</span>
          <div>
            <div class="candidate-name">${esc(vesselName(vessel))}</div>
            <div class="meta-line">${esc(portName(vessel))} · ${esc(statusText(vessel))}</div>
          </div>
          <span class="score">${fmt(score(vessel))}</span>
        </summary>
        <div class="hot-extra">
          <div class="memo">${esc(memo(vessel))}</div>
          <div class="tag-row">${tags(vessel).map(tag => `<span class="tag">${esc(tag)}</span>`).join("")}</div>
        </div>
      </details>
    `).join("")
    : '<div class="empty">HOT 후보가 없습니다.</div>';
}

function visibleCandidates() {
  let rows = getSalesCandidates(state.rows);
  if (state.tab !== "all") {
    rows = rows.filter(vessel => grade(vessel)[0].toLowerCase() === state.tab);
  }

  const query = $("search").value.trim().toLowerCase();
  const port = $("portFilter").value;
  if (query) {
    rows = rows.filter(vessel => [
      vesselName(vessel),
      vessel.imo,
      vessel.mmsi,
      portName(vessel),
      memo(vessel)
    ].join(" ").toLowerCase().includes(query));
  }
  if (port) rows = rows.filter(vessel => portName(vessel) === port);

  if ($("sortOrder").value === "stay") {
    rows = rows.slice().sort((a, b) => stayHours(b) - stayHours(a) || score(b) - score(a));
  } else if ($("sortOrder").value === "eta") {
    rows = rows.slice().sort((a, b) => scheduleRank(a) - scheduleRank(b) || score(b) - score(a));
  }

  return rows;
}

function renderRows() {
  const rows = visibleCandidates();
  const pages = Math.max(1, Math.ceil(rows.length / state.pageSize));
  state.page = Math.min(state.page, pages);
  const pageRows = rows.slice((state.page - 1) * state.pageSize, state.page * state.pageSize);
  const rendererOptions = { page: state.page, pageSize: state.pageSize, vesselName, portName, statusText, dateLabel, stayLabel, score, grade, action, memo, tags };

  $("tableCount").textContent = `${fmt(rows.length)}건`;
  $("rows").innerHTML = renderCandidateTableRows(pageRows, rendererOptions);
  $("mobileRows").innerHTML = renderCandidateCards(pageRows, rendererOptions);
  $("pager").innerHTML = `
    <button ${state.page <= 1 ? "disabled" : ""} id="prevPage" type="button">이전</button>
    <span>${state.page} / ${pages}</span>
    <button ${state.page >= pages ? "disabled" : ""} id="nextPage" type="button">다음</button>
  `;
  $("prevPage").onclick = () => { state.page = Math.max(1, state.page - 1); renderRows(); };
  $("nextPage").onclick = () => { state.page = Math.min(pages, state.page + 1); renderRows(); };
  state.rowsRendered = true;
}

function renderAll({ lazyRows = true } = {}) {
  renderKpi();
  renderStatus();
  renderAlerts();
  renderPorts();
  renderHotList();
  if (lazyRows) setTimeout(renderRows, 0);
  else renderRows();
}

function mergeRows(...groups) {
  return uniqueBy(groups.flatMap(group => arr(group)), vesselKey);
}

function summaryCandidateRows() {
  return mergeRows(
    state.summary?.immediate_targets,
    state.summary?.opportunities,
    state.summary?.contact_ready_vessels,
    state.summary?.alert_candidates,
    state.top?.immediate_targets,
    state.top?.opportunities
  );
}

async function loadRows() {
  const [candidateStatic, topStatic] = await Promise.all([
    api("candidates", "/api/vessels.json", 15000),
    api("top", "/api/candidates/top.json", 6000)
  ]);

  state.top = topStatic || state.top || {};
  const snapshotRows = summaryCandidateRows();
  const liveRows = mergeRows(candidateStatic);
  state.rows = liveRows.length ? liveRows : mergeRows(topStatic, snapshotRows);
}

async function loadSummary() {
  $("sourceBadge").textContent = "데이터 확인 중";
  const [summary, status] = await Promise.all([
    api("summary", "/api/dashboard-summary.json", 4500),
    api("status", "/api/status-summary.json", 4500)
  ]);

  state.summary = summary || {};
  state.status = status || {};
  state.ports = arr(state.summary?.ports);
  state.top = {
    immediate_targets: arr(state.summary?.immediate_targets),
    opportunities: arr(state.summary?.opportunities)
  };
  renderKpi();
  renderStatus();
  renderPorts();
  renderHotList();

  const [health, continuity, alerts, ports, top, changes, followups] = await Promise.all([
    api("health", "/api/health/pipeline.json", 3000),
    api("continuity", "/api/data-continuity.json", 3000),
    api("alerts", "/api/alerts/sales-alerts.json", 3000),
    api("ports", "/api/ports.json", 3500),
    api("topRefresh", "/api/candidates/top.json", 3500),
    api("changes", "/api/candidate-changes.json", 2500),
    api("followups", "/api/agent-followup-queue.json", 2500)
  ]);

  state.health = health || {};
  state.continuity = continuity || {};
  state.alerts = alerts || {};
  state.ports = arr(ports).length ? arr(ports) : arr(state.summary?.ports);
  state.top = top || state.top || {};
  state.changes = changes || {};
  state.followups = arr(followups);

  await loadRows();
  if (!state.rows.length) useSampleFallback();
  renderAll({ lazyRows: true });
}

function setTab(tab) {
  state.tab = tab;
  state.page = 1;
  for (const id of ["allTab", "hotTab", "warmTab", "coldTab"]) {
    $(id).classList.toggle("active", id === `${tab}Tab`);
  }
  renderRows();
}

$("menuButton").onclick = () => document.querySelector(".candidate-panel")?.scrollIntoView({ behavior: "smooth" });
$("refreshBtn").onclick = () => {
  state.rowsRendered = false;
  loadSummary().catch(handleLoadError);
};
for (const tab of ["all", "hot", "warm", "cold"]) {
  $(`${tab}Tab`).onclick = () => setTab(tab);
}
for (const id of ["search", "portFilter", "sortOrder"]) {
  $(id).addEventListener("input", () => { state.page = 1; renderRows(); });
}
$("pageSize").addEventListener("change", event => {
  state.pageSize = Number(event.target.value) || 10;
  state.page = 1;
  renderRows();
});

function handleLoadError(error) {
  state.status = { status: "error", error_reason: error?.message || String(error) };
  useSampleFallback();
  renderAll({ lazyRows: false });
}

setTimeout(() => {
  if (!state.rowsRendered && state.rows.length) renderRows();
}, 8000);

loadSummary().catch(handleLoadError);
