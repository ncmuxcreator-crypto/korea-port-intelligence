import fs from "fs";
import path from "path";

const ROOT = process.cwd();

const DATASETS = [
  "dashboard/api/bootstrap.json",
  "dashboard/api/vessels/page-1.json",
  "dashboard/api/candidates/top.json",
  "dashboard/api/targets/current.json",
  "dashboard/api/staying-vessels.json",
  "dashboard/api/anchorage-waiting.json",
  "dashboard/api/arrival-pipeline.json",
  "dashboard/api/congestion-watchlist.json"
];

const FIELDS = [
  ["vessel_name", "선명", "CORE"],
  ["imo", "IMO", "CORE"],
  ["mmsi", "MMSI", "IMPORTANT"],
  ["call_sign", "콜사인", "CORE"],
  ["vessel_type", "선종", "CORE"],
  ["operator", "운영사", "CORE"],
  ["current_port", "현재 항만", "CORE"],
  ["eta", "ETA", "CORE"],
  ["ata", "ATA", "CORE"],
  ["gt", "GT", "IMPORTANT"],
  ["dwt", "DWT", "IMPORTANT"],
  ["flag", "국적", "DETAIL"],
  ["owner", "선주", "DETAIL"],
  ["manager", "관리사", "DETAIL"],
  ["agent", "에이전트", "DETAIL"],
  ["berth", "선석", "DETAIL"],
  ["anchorage", "묘박지", "DETAIL"],
  ["etb", "ETB", "IMPORTANT"],
  ["atb", "ATB", "IMPORTANT"],
  ["etd", "ETD", "DETAIL"],
  ["atd", "ATD", "DETAIL"],
  ["stay_days", "체류일수", "CORE"],
  ["stay_hours", "체류시간", "IMPORTANT"],
  ["waiting_hours", "대기시간", "IMPORTANT"],
  ["waiting_score", "체선점수", "IMPORTANT"],
  ["congestion_score", "혼잡도", "IMPORTANT"],
  ["opportunity_score", "기회점수", "CORE"],
  ["risk_score", "리스크점수", "IMPORTANT"],
  ["biofouling_score", "Biofouling 점수", "IMPORTANT"],
  ["compliance_score", "Compliance 점수", "DETAIL"],
  ["confidence_score", "신뢰도", "CORE"],
  ["priority_label", "우선순위", "CORE"],
  ["target_categories", "영업 카테고리", "DETAIL"],
  ["reason_summary", "추천 사유", "CORE"],
  ["recommended_action", "추천 액션", "CORE"],
  ["data_sources", "데이터 소스", "DETAIL"],
  ["enrichment_sources", "Enrichment Source", "DEBUG"],
  ["last_seen_at", "마지막 확인", "DETAIL"]
];

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, file), "utf8"));
  } catch {
    return null;
  }
}

function rowsFrom(payload) {
  if (!payload || typeof payload !== "object") return [];
  return [
    ...(Array.isArray(payload.top_candidates) ? payload.top_candidates : []),
    ...(Array.isArray(payload.items) ? payload.items : []),
    ...(Array.isArray(payload.opportunities) ? payload.opportunities : []),
    ...(Array.isArray(payload.immediate_targets) ? payload.immediate_targets : []),
    ...(Array.isArray(payload.vessels) ? payload.vessels : [])
  ];
}

function hasField(row, field) {
  if (!row || typeof row !== "object") return false;
  if (Object.prototype.hasOwnProperty.call(row, field)) return true;
  if (row.vessel_display && Object.prototype.hasOwnProperty.call(row.vessel_display, field)) return true;
  if (row.congestion_signal && Object.prototype.hasOwnProperty.call(row.congestion_signal, field)) return true;
  if (row.schedule_summary && Object.prototype.hasOwnProperty.call(row.schedule_summary, field)) return true;
  return false;
}

const allRows = [];
const datasetCounts = [];
for (const file of DATASETS) {
  const payload = readJson(file);
  const rows = rowsFrom(payload);
  datasetCounts.push([file, rows.length]);
  allRows.push(...rows.slice(0, 100));
}

const html = fs.existsSync(path.join(ROOT, "dashboard/index.html"))
  ? fs.readFileSync(path.join(ROOT, "dashboard/index.html"), "utf8")
  : "";

function visible(label, field) {
  const aliases = {
    call_sign: ["콜사인", "call_sign"],
    vessel_type: ["선종", "vesselTypeText"],
    operator: ["운영사", "operator"],
    current_port: ["현재 항만", "currentPortText"],
    waiting_score: ["체선점수", "waitingScore"],
    congestion_score: ["혼잡도", "congestionScore"],
    recommended_action: ["추천 액션", "recommended_action"]
  };
  return [label, field, ...(aliases[field] || [])].some(token => html.includes(token));
}

console.log("Vessel list UI audit");
console.log("");
console.log("Datasets sampled:");
for (const [file, count] of datasetCounts) console.log(`- ${file}: ${count}`);
console.log("");
console.log("Field | Available | Visible | Desktop Visible | Mobile Visible | Priority");
console.log("--- | --- | --- | --- | --- | ---");

const warnings = [];
for (const [field, label, priority] of FIELDS) {
  const available = allRows.some(row => hasField(row, field));
  const isVisible = visible(label, field);
  const desktopVisible = isVisible && html.includes("<th") && html.includes(label);
  const mobileVisible = isVisible && html.includes("vessel-core-grid");
  console.log(`${field} | ${available ? "yes" : "no"} | ${isVisible ? "yes" : "no"} | ${desktopVisible ? "yes" : "no"} | ${mobileVisible ? "yes" : "no"} | ${priority}`);
  if (available && ["CORE", "IMPORTANT"].includes(priority) && !isVisible) {
    warnings.push(`${label} (${field}) exists but is not visible.`);
  }
}

console.log("");
if (warnings.length) {
  console.log("Warnings:");
  for (const warning of warnings) console.log(`- ${warning}`);
  process.exitCode = 1;
} else {
  console.log("OK: core and important available vessel fields are visible in the vessel list UI.");
}
