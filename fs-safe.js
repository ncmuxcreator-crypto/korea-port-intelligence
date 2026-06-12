<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Korea Port Intelligence v15.9</title>
<style>
:root{--bg:#020617;--card:#0f172a;--line:#1e293b;--text:#f8fafc;--muted:#94a3b8;--blue:#38bdf8;--green:#22c55e;--red:#ef4444;--amber:#f59e0b;--purple:#a855f7}
*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at top,#0b2447 0,#020617 46%);color:var(--text);font-family:Arial,system-ui,sans-serif;padding:28px}.header{display:flex;justify-content:space-between;gap:16px;align-items:flex-start;flex-wrap:wrap}.eyebrow{color:var(--blue);font-weight:700;letter-spacing:.08em;font-size:12px;text-transform:uppercase}.title{font-size:34px;margin:6px 0}.meta{color:var(--muted);font-size:13px}.badge{padding:10px 16px;background:#14532d;border:1px solid #166534;border-radius:999px;color:#bbf7d0;font-weight:700}.badge.error{background:#7f1d1d;color:#fecaca;border-color:#991b1b}.badge.warn{background:#78350f;color:#fde68a;border-color:#92400e}.metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px;margin-top:24px}.metric{background:rgba(15,23,42,.92);padding:18px;border-radius:18px;border:1px solid var(--line);box-shadow:0 20px 60px rgba(0,0,0,.24)}.metric span{display:block;color:var(--muted);font-size:13px}.metric strong{display:block;margin-top:8px;font-size:30px;color:var(--blue)}.section{margin-top:26px}.section h2{font-size:18px;margin-bottom:12px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(310px,1fr));gap:16px}.card{background:rgba(15,23,42,.94);padding:20px;border-radius:20px;border:1px solid var(--line)}.vessel-card.critical{border-color:#ef4444;box-shadow:0 0 0 1px rgba(239,68,68,.25)}.vessel-card.high{border-color:#7c3aed}.score{font-size:42px;font-weight:800;color:var(--blue);line-height:1}.chip{display:inline-block;margin:8px 6px 0 0;padding:6px 10px;border-radius:999px;background:#1e293b;color:#cbd5e1;font-size:12px}.chip.hot{background:#3b0764;color:#e9d5ff}.chip.critical{background:#7f1d1d;color:#fecaca}.chip.compliance{background:#422006;color:#fde68a}.chip.action{background:#082f49;color:#bae6fd}.chip.pass{background:#14532d;color:#bbf7d0}.chip.warn{background:#78350f;color:#fde68a}.chip.fail{background:#7f1d1d;color:#fecaca}.chip.info{background:#172554;color:#bfdbfe}.port-table{width:100%;border-collapse:collapse;background:rgba(15,23,42,.94);border:1px solid var(--line);border-radius:18px;overflow:hidden}th,td{text-align:left;padding:12px;border-bottom:1px solid var(--line);font-size:14px}th{color:#93c5fd;background:#0b1220}.reason{margin:10px 0 0;padding-left:18px;color:#cbd5e1}.reason li{margin:4px 0}.footer{margin-top:28px;color:var(--muted);font-size:12px}.toolbar{display:flex;gap:10px;flex-wrap:wrap;margin-top:14px}.toolbar input,.toolbar select,.toolbar button{background:#0b1220;color:var(--text);border:1px solid var(--line);border-radius:12px;padding:11px 12px;min-width:160px}.toolbar button{cursor:pointer;color:#bae6fd}.empty{border:1px dashed var(--line);border-radius:18px;padding:22px;color:var(--muted)}.money{color:#86efac;font-weight:700}.small{font-size:12px;color:var(--muted)}.readiness{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px}.check{border:1px solid var(--line);border-radius:16px;padding:14px;background:#0b1220}.check b{display:block;margin-bottom:6px}.copy{font-size:12px;color:#93c5fd;cursor:pointer;margin-top:8px;display:inline-block}.note{background:#082f49;border:1px solid #075985;border-radius:16px;padding:14px;color:#dbeafe;margin-top:12px}.stale{color:#fde68a}.ok{color:#bbf7d0}
</style>
</head>
<body>
<div class="header">
  <div>
    <div class="eyebrow">Korea Port Intelligence Market Intelligence</div>
    <h1 class="title">Korea Port Intelligence v15.9</h1>
    <p class="meta">Collector manifest · Source registry · Public API first · Sales action queue</p>
  </div>
  <div id="statusBadge" class="badge">Loading status...</div>
</div>

<div class="metrics">
  <div class="metric"><span>Total Targets</span><strong id="totalTargets">-</strong></div>
  <div class="metric"><span>Critical</span><strong id="criticalTargets">-</strong></div>
  <div class="metric"><span>High Risk</span><strong id="highRisk">-</strong></div>
  <div class="metric"><span>Compliance Watch</span><strong id="complianceWatch">-</strong></div>
  <div class="metric"><span>Estimated Pipeline</span><strong id="pipelineValue" style="font-size:22px;">-</strong></div>
  <div class="metric"><span>Data Freshness</span><strong id="dataFreshness" style="font-size:16px;">-</strong></div>
</div>

<div class="section">
  <h2>Data Mode Guard</h2>
  <div id="dataMode" class="readiness"><div class="check">Loading data mode...</div></div>
</div>

<div class="section">
  <h2>Data Quality Control</h2>
  <div id="dataQuality" class="readiness"><div class="check">Loading data quality...</div></div>
</div>

<div class="section">
  <h2>Data Source Strategy</h2>
  <div id="dataStrategy" class="readiness"><div class="check">Loading data strategy...</div></div>
</div>

<div class="section">
  <h2>Collector Readiness Roadmap</h2>
  <div id="collectorReadiness" class="readiness"><div class="check">Loading collector readiness...</div></div>
</div>

<div class="section">
  <h2>Collector Manifest</h2>
  <div id="collectorManifest" class="readiness"><div class="check">Loading collector manifest...</div></div>
</div>

<div class="section">
  <h2>Source Registry</h2>
  <div id="sourceRegistry" class="readiness"><div class="check">Loading source registry...</div></div>
</div>

<div class="section">
  <h2>Next Development Plan</h2>
  <div id="nextPlan" class="readiness"><div class="check">Loading development plan...</div></div>
</div>

<div class="section">
  <h2>API Secret Status</h2>
  <div id="apiSources" class="readiness"><div class="check">Loading API status...</div></div>
</div>

<div class="section">
  <h2>Deployment Readiness</h2>
  <div id="readiness" class="readiness"><div class="check">Loading checks...</div></div>
  <div class="note" id="hostingHint">Hosting hint loading...</div>
</div>

<div class="section">
  <h2>Port Risk Summary</h2>
  <table class="port-table">
    <thead><tr><th>Port</th><th>Total</th><th>Critical</th><th>High Risk</th><th>Avg Risk</th><th>Waiting</th><th>Opportunity</th></tr></thead>
    <tbody id="portRows"><tr><td colspan="7">Loading...</td></tr></tbody>
  </table>
</div>

<div class="section">
  <h2>Sales Priority Queue</h2>
  <div class="toolbar">
    <input id="searchBox" placeholder="Search vessel / operator / port">
    <select id="riskFilter"><option value="all">All Risk</option><option value="critical">Critical only</option><option value="high">High + Critical</option><option value="compliance">Compliance Watch</option></select>
    <select id="portFilter"><option value="all">All Ports</option></select>
    <button id="exportCsv">Export CSV</button>
  </div>
  <p class="small" id="resultCount">Loading targets...</p>
  <div id="grid" class="grid"></div>
</div>

<div class="footer">v15.9 build: collector manifest, source registry, lightweight data posture, sample/live guard.</div>

<script>
const safe = value => String(value ?? "").replace(/[&<>'"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;","\"":"&quot;"}[c]));
const money = value => new Intl.NumberFormat("en-US", { style:"currency", currency:"USD", maximumFractionDigits:0 }).format(value || 0);
let vesselsCache = [];
let statusCache = {};

function ageText(iso){
  if(!iso) return "No timestamp";
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if(minutes < 1) return "just now";
  if(minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes/60);
  return `${hours} hr ago`;
}

async function loadStatus(){
  const res = await fetch("./api/status.json?t=" + Date.now());
  const status = await res.json();
  statusCache = status;
  const badge = document.getElementById("statusBadge");
  const ok = status.status === "success";
  const warnings = status.deployment_readiness?.warnings || 0;
  badge.textContent = ok ? `Pipeline OK · v${status.version}${warnings ? ` · ${warnings} warning(s)` : ""}` : `Pipeline Error · v${status.version || "15.9"}`;
  badge.className = ok ? (warnings ? "badge warn" : "badge") : "badge error";

  document.getElementById("totalTargets").textContent = status.record_count ?? 0;
  document.getElementById("criticalTargets").textContent = status.critical_count ?? 0;
  document.getElementById("highRisk").textContent = status.high_risk_count ?? 0;
  document.getElementById("complianceWatch").textContent = status.compliance_watch_count ?? 0;
  document.getElementById("pipelineValue").textContent = money(status.opportunity_usd || 0);
  const fresh = ageText(status.completed_at);
  document.getElementById("dataFreshness").innerHTML = `<span class="${fresh.includes('hr') ? 'stale' : 'ok'}">${safe(fresh)}</span>`;

  const dm = status.data_mode_detail || {};
  document.getElementById("dataMode").innerHTML = `
    <div class="check"><span class="chip ${dm.mode === 'sample_only' ? 'warn' : 'pass'}">${safe(dm.label || status.data_mode || 'UNKNOWN')}</span><b>Current Data Mode</b><div class="small">${safe(dm.message || 'No mode detail available.')}</div></div>
    <div class="check"><span class="chip info">${dm.real_rows || 0}</span><b>Real/API Rows</b><div class="small">Sample rows: ${dm.sample_rows || 0}</div></div>
    <div class="check"><span class="chip ${dm.supabase_status === 'synced' ? 'pass' : 'warn'}">${safe(dm.supabase_status || 'not_configured')}</span><b>Supabase History</b><div class="small">Use Supabase for port-stay history and repeated snapshots.</div></div>
    <div class="check"><span class="chip action">LIGHT</span><b>Weight Policy</b><div class="small">Keep repo light. Store heavy raw data outside GitHub.</div></div>
  `;

  const rows = (status.port_summary || []).map(p => `
    <tr><td>${safe(p.port)}</td><td>${p.total}</td><td>${p.critical}</td><td>${p.high_risk}</td><td>${p.avg_risk}</td><td>${p.waiting}</td><td class="money">${money(p.opportunity_usd)}</td></tr>
  `).join("");
  document.getElementById("portRows").innerHTML = rows || '<tr><td colspan="7">No port data</td></tr>';

  const dq = status.data_quality || {};
  const missing = dq.missing_fields || {};
  const issueList = (dq.issues && dq.issues.length ? dq.issues : dq.next_cleanup_focus || []).map(safe).join(' · ');
  document.getElementById("dataQuality").innerHTML = `
    <div class="check"><span class="chip ${dq.score >= 85 ? 'pass' : dq.score >= 70 ? 'warn' : 'fail'}">${dq.score || 0}/100</span><b>Quality Score</b><div class="small">${safe(dq.grade || 'Needs Cleanup')} · ${dq.record_count || 0} records</div></div>
    <div class="check"><span class="chip info">${dq.completeness_percent || 0}%</span><b>Completeness</b><div class="small">Missing: operator ${missing.operator || 0}, destination ${missing.destination || 0}, port ${missing.port || 0}</div></div>
    <div class="check"><span class="chip ${dq.duplicate_count ? 'warn' : 'pass'}">${dq.duplicate_count || 0}</span><b>Duplicate Watch</b><div class="small">Duplicate vessel/port rows detected from merged sources.</div></div>
    <div class="check"><span class="chip action">FOCUS</span><b>Next Cleanup Focus</b><div class="small">${issueList || 'No major cleanup issue detected'}</div></div>
  `;

  const strategy = status.data_strategy || {};
  document.getElementById("dataStrategy").innerHTML = `
    <div class="check"><span class="chip pass">PUBLIC FIRST</span><b>Operating Mode</b><div class="small">${safe(strategy.principle || "Korea public data is the default base layer.")}</div></div>
    <div class="check"><span class="chip ${strategy.public_enabled_count ? 'pass' : 'warn'}">${strategy.public_enabled_count || 0}</span><b>Public / Port API Groups Enabled</b><div class="small">${strategy.public_enabled && strategy.public_enabled.length ? strategy.public_enabled.map(safe).join(', ') : 'none detected yet'}</div></div>
    <div class="check"><span class="chip info">${strategy.paid_enabled_count || 0}</span><b>Paid AIS Groups Enabled</b><div class="small">${strategy.paid_enabled && strategy.paid_enabled.length ? strategy.paid_enabled.map(safe).join(', ') : 'MarineTraffic / VesselFinder are optional, not required for this build.'}</div></div>
    <div class="check"><span class="chip action">NEXT</span><b>Next Data Work</b><div class="small">${(strategy.next_focus || []).map(safe).join(' · ')}</div></div>
  `;

  const collectors = status.collector_readiness || [];
  document.getElementById("collectorReadiness").innerHTML = collectors.map(c => `
    <div class="check">
      <span class="chip ${c.status === 'ready' ? 'pass' : c.status === 'partial' ? 'warn' : 'info'}">${safe(c.readiness_percent || 0)}%</span>
      <b>${safe(c.phase)} · ${safe(c.name)}</b>
      <div class="small">${safe(c.goal)}</div>
      <div class="small"><b>Active:</b> ${c.active_sources && c.active_sources.length ? c.active_sources.map(safe).join(', ') : 'none yet'}</div>
      <div class="small"><b>Missing:</b> ${c.missing_sources && c.missing_sources.length ? c.missing_sources.map(safe).join(', ') : 'none'}</div>
    </div>
  `).join("") || '<div class="check">No collector readiness data</div>';

  const manifest = status.collector_manifest || [];
  document.getElementById("collectorManifest").innerHTML = manifest.map(c => `
    <div class="check">
      <span class="chip ${c.status === 'ready' ? 'pass' : c.status === 'partial' ? 'warn' : 'info'}">P${safe(c.priority)} · ${safe(c.readiness_percent || 0)}%</span>
      <b>${safe(c.collector)}</b>
      <div class="small">${safe(c.business_use)}</div>
      <div class="small"><b>Output:</b> ${safe(c.output)} · <b>Weight:</b> ${safe(c.weight)}</div>
      <div class="small"><b>Enabled:</b> ${c.enabled_sources && c.enabled_sources.length ? c.enabled_sources.map(safe).join(', ') : 'none'}</div>
      <div class="small"><b>Next:</b> ${safe(c.next_action)}</div>
    </div>
  `).join("") || '<div class="check">No collector manifest available</div>';

  const registry = status.source_registry || {};
  document.getElementById("sourceRegistry").innerHTML = `
    <div class="check"><span class="chip ${registry.operating_posture === 'public_data_ready' ? 'pass' : registry.operating_posture === 'public_data_partial' ? 'warn' : 'info'}">${safe(registry.operating_posture || 'unknown')}</span><b>Operating Posture</b><div class="small">${safe(registry.immediate_focus || 'No focus available')}</div></div>
    <div class="check"><span class="chip pass">${registry.public_enabled_groups || 0}</span><b>Public Groups Enabled</b><div class="small">Public/port/MOF sources are the preferred base layer.</div></div>
    <div class="check"><span class="chip info">${registry.storage_enabled_groups || 0}</span><b>Storage Groups Enabled</b><div class="small">Supabase/GDrive keep history outside GitHub.</div></div>
    <div class="check"><span class="chip ${registry.paid_enabled_groups ? 'warn' : 'info'}">${registry.paid_enabled_groups || 0}</span><b>Paid AIS Groups Enabled</b><div class="small">Paid AIS remains optional enrichment.</div></div>
    <div class="check"><span class="chip action">WEIGHT</span><b>Repository Weight Guidance</b><div class="small">${safe(registry.weight_guidance || 'Keep repo light.')}</div></div>
  `;

  const nextPlan = status.next_development_plan || [];
  document.getElementById("nextPlan").innerHTML = nextPlan.map(p => `
    <div class="check">
      <span class="chip action">STEP ${safe(p.step)}</span>
      <b>${safe(p.title)}</b>
      <div class="small">${safe(p.detail)}</div>
    </div>
  `).join("") || '<div class="check">No development plan available</div>';

  const apiSources = status.api_sources || [];
  document.getElementById("apiSources").innerHTML = apiSources.map(s => `
    <div class="check">
      <span class="chip ${s.enabled ? 'pass' : s.partial ? 'warn' : 'info'}">${s.status.toUpperCase()}</span>
      <b>${safe(s.label)}</b>
      <div class="small">${safe(s.use)}</div>
      <div class="small"><b>Using:</b> ${s.using && s.using.length ? s.using.map(safe).join(', ') : 'none'}</div>
      ${s.missing && s.missing.length ? `<div class="small"><b>Missing:</b> ${s.missing.map(safe).join(' / ')}</div>` : ''}
    </div>
  `).join("") || '<div class="check">No API secret catalog available</div>';

  const checks = status.deployment_readiness?.checks || [];
  document.getElementById("readiness").innerHTML = checks.map(c => `
    <div class="check">
      <span class="chip ${safe(c.status)}">${safe(c.status).toUpperCase()}</span>
      <b>${safe(c.label)}</b>
      <div class="small">${safe(c.detail)}</div>
    </div>
  `).join("") || '<div class="check">No readiness checks available</div>';
  const host = status.recommended_hosting || {};
  document.getElementById("hostingHint").innerHTML = `<b>Hosting setup:</b> Build Command <code>${safe(host.build_command || "npm run build")}</code> · Output Directory <code>${safe(host.output_directory || "public")}</code> · Node <code>${safe(host.node_version || ">=18")}</code>`;
}

function updatePortFilter(vessels){
  const select = document.getElementById("portFilter");
  const current = select.value;
  const ports = [...new Set(vessels.map(v => v.port).filter(Boolean))].sort();
  select.innerHTML = '<option value="all">All Ports</option>' + ports.map(p => `<option value="${safe(p)}">${safe(p)}</option>`).join("");
  if (ports.includes(current)) select.value = current;
}

function passesFilters(v){
  const q = document.getElementById("searchBox").value.trim().toLowerCase();
  const risk = document.getElementById("riskFilter").value;
  const port = document.getElementById("portFilter").value;
  const haystack = [v.vessel_name, v.operator, v.port, v.destination, v.vessel_type].join(" ").toLowerCase();
  if (q && !haystack.includes(q)) return false;
  if (port !== "all" && v.port !== port) return false;
  if (risk === "critical" && (v.risk_score || 0) < 85) return false;
  if (risk === "high" && (v.risk_score || 0) < 70) return false;
  if (risk === "compliance" && !v.compliance_watch) return false;
  return true;
}

function currentFiltered(){ return vesselsCache.filter(passesFilters); }

function exportCsv(){
  const rows = currentFiltered();
  const headers = ["vessel_name","vessel_id","port","status","operator","destination","vessel_type","risk_score","risk_level","recommended_action","opportunity_usd","updated_at"];
  const csv = [headers.join(",")].concat(rows.map(v => headers.map(h => `"${String(v[h] ?? "").replaceAll('"','""')}"`).join(","))).join("\n");
  const blob = new Blob([csv], {type:"text/csv;charset=utf-8"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `korea-port-intelligence-sales-priority-v${statusCache.version || "15.9"}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function copyAction(name, action){
  navigator.clipboard?.writeText(`${name}: ${action}`).catch(()=>{});
}

function renderData(){
  const grid = document.getElementById("grid");
  const filtered = currentFiltered();
  document.getElementById("resultCount").textContent = `${filtered.length} of ${vesselsCache.length} targets shown · auto-refresh ${statusCache.refresh_interval_seconds || 30}s`;
  if (!filtered.length) {
    grid.innerHTML = '<div class="empty">No matching targets. Try a broader filter.</div>';
    return;
  }
  grid.innerHTML = filtered.map(v => {
    const score = v.risk_score || 0;
    const critical = score >= 85;
    const high = score >= 70;
    const reasons = (v.sales_reason || []).map(r => `<li>${safe(r)}</li>`).join("");
    const action = v.recommended_action || "Monitor";
    return `
      <div class="card vessel-card ${critical ? "critical" : high ? "high" : ""}">
        <h2>${safe(v.vessel_name)}</h2>
        <div class="score">${score}</div>
        <span class="chip ${critical ? "critical" : high ? "hot" : ""}">${safe(v.risk_level || v.sales_priority || "Normal")}</span>
        ${v.compliance_watch ? '<span class="chip compliance">Compliance Watch</span>' : ''}
        <span class="chip action">${safe(action)}</span>
        <p><b>Port:</b> ${safe(v.port)} · <b>Status:</b> ${safe(v.status)}</p>
        <p><b>Operator:</b> ${safe(v.operator)}</p>
        <p><b>Destination:</b> ${safe(v.destination)} · <b>Type:</b> ${safe(v.vessel_type)}</p>
        <p><b>Estimated opportunity:</b> <span class="money">${money(v.opportunity_usd)}</span></p>
        <ul class="reason">${reasons || '<li>No special signal</li>'}</ul>
        <span class="copy" onclick="copyAction('${safe(v.vessel_name)}','${safe(action)}')">Copy action note</span>
        <p class="meta">Updated: ${v.updated_at ? new Date(v.updated_at).toLocaleString() : "-"}</p>
      </div>`;
  }).join("");
}

async function loadData(){
  const res = await fetch("./api/vessels.json?t=" + Date.now());
  vesselsCache = await res.json();
  updatePortFilter(vesselsCache);
  renderData();
}

async function refresh(){
  await loadStatus();
  await loadData();
}

document.getElementById("searchBox").addEventListener("input", renderData);
document.getElementById("riskFilter").addEventListener("change", renderData);
document.getElementById("portFilter").addEventListener("change", renderData);
document.getElementById("exportCsv").addEventListener("click", exportCsv);
refresh();
setInterval(refresh, 30000);
</script>
</body>
</html>
