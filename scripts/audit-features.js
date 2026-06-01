import fs from "fs";
import path from "path";

const ROOT = process.cwd();

const FEATURES = [
  {
    feature: "risk",
    tables: ["risk_history"],
    json: ["dashboard/api/intelligence/risk-summary.json"],
    ui: ["리스크 분석", "/api/intelligence/risk-summary.json"]
  },
  {
    feature: "explainability",
    tables: ["explainability_snapshots", "rule_evaluations"],
    json: ["dashboard/api/intelligence/explainability.json", "dashboard/api/candidates/top.json"],
    ui: ["점수 설명", "/api/intelligence/explainability.json"]
  },
  {
    feature: "prediction",
    tables: ["predicted_arrivals", "model_training_rows"],
    json: ["dashboard/api/predicted-arrivals.json", "dashboard/api/predicted-cleaning-opportunities.json", "dashboard/api/intelligence/prediction-summary.json"],
    ui: ["예측 신호 / 실험 기능", "/api/intelligence/prediction-summary.json"]
  },
  {
    feature: "feature_store",
    tables: ["feature_store", "feature_snapshots"],
    json: [],
    ui: []
  },
  {
    feature: "commercial_opportunity",
    tables: ["opportunity_master", "commercial_opportunity_daily"],
    json: ["dashboard/api/candidates/top.json", "dashboard/api/commercial-command-center.json", "dashboard/api/intelligence/commercial-summary.json"],
    ui: ["상업 기회", "/api/intelligence/commercial-summary.json"]
  },
  {
    feature: "sales_priority",
    tables: ["opportunity_master", "explainability_snapshots", "risk_history", "commercial_opportunity_daily", "route_snapshot_daily", "operator_snapshot_daily"],
    json: ["dashboard/api/intelligence/sales-priority.json"],
    ui: ["오늘의 영업 우선순위", "/api/intelligence/sales-priority.json", "renderSalesPriority"]
  },
  {
    feature: "sales_candidates",
    tables: ["sales_candidates_current"],
    json: ["dashboard/api/candidates.json", "dashboard/api/candidates/top.json"],
    ui: ["영업 후보", "getHotCandidates"]
  },
  {
    feature: "immediate_targets",
    tables: ["immediate_targets_current"],
    json: ["dashboard/api/hot-candidates.json", "dashboard/api/candidates/top.json"],
    ui: ["HOT", "getHotCandidates"]
  },
  {
    feature: "route_snapshot",
    tables: ["route_snapshot_daily"],
    json: ["dashboard/api/intelligence/route-summary.json"],
    ui: ["항로 인사이트", "/api/intelligence/route-summary.json"]
  },
  {
    feature: "operator_snapshot",
    tables: ["operator_snapshot_daily"],
    json: ["dashboard/api/fleet-opportunities.json", "dashboard/api/intelligence/operator-summary.json"],
    ui: ["선사/운영사 인사이트", "/api/intelligence/operator-summary.json"]
  }
];

function readText(file) {
  try {
    return fs.readFileSync(path.join(ROOT, file), "utf8");
  } catch {
    return "";
  }
}

function readJson(file) {
  const candidates = [
    file,
    file.replace("dashboard/api/", "dashboard/api/debug/")
  ];
  for (const candidate of candidates) {
    try {
      const fullPath = path.join(ROOT, candidate);
      if (fs.existsSync(fullPath)) return JSON.parse(fs.readFileSync(fullPath, "utf8"));
    } catch {
      return { __invalid_json: true };
    }
  }
  return null;
}

function rows(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.vessels)) return payload.vessels;
  if (Array.isArray(payload?.candidates)) return payload.candidates;
  if (Array.isArray(payload?.opportunities)) return payload.opportunities;
  if (Array.isArray(payload?.immediate_targets)) return payload.immediate_targets;
  return [];
}

const schemaText = [
  readText("supabase/schema.sql"),
  ...fs.existsSync(path.join(ROOT, "migrations"))
    ? fs.readdirSync(path.join(ROOT, "migrations"))
      .filter(file => /\.sql$/i.test(file))
      .map(file => readText(`migrations/${file}`))
    : []
].join("\n");
const writerText = [
  readText("scripts/lib/db.js"),
  readText("scripts/update.js"),
  readText("src/worker.js")
].join("\n");
const uiText = [
  readText("dashboard/index.html"),
  readText("public/index.html")
].join("\n");

function hasTable(table) {
  const escaped = table.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped}\\b`, "i").test(schemaText);
}

function hasWriter(table) {
  return writerText.includes(`.from("${table}")`) ||
    writerText.includes(`"${table}",`) ||
    writerText.includes(`'${table}'`);
}

function hasUi(markers = []) {
  return markers.length > 0 && markers.some(marker => uiText.includes(marker));
}

function jsonState(files = []) {
  if (!files.length) return { exists: false, hasRows: false, invalid: false };
  let exists = false;
  let hasRows = false;
  let invalid = false;
  for (const file of files) {
    const payload = readJson(file);
    if (!payload) continue;
    exists = true;
    if (payload.__invalid_json) invalid = true;
    if (rows(payload).length > 0 || Number(payload.record_count || 0) > 0) hasRows = true;
  }
  return { exists, hasRows, invalid };
}

function statusFor({ db, writer, json, ui }) {
  if (json.invalid) return "BROKEN";
  if (db && writer && json.exists && ui && json.hasRows) return "ACTIVE";
  if (db && writer && json.exists && ui && !json.hasRows) return "EMPTY";
  if (db && writer && json.exists && !ui) return "HIDDEN";
  if (db && writer && !json.exists) return "UNUSED";
  if (db && !writer) return "UNUSED";
  if (!db && (json.exists || ui)) return "BROKEN";
  return "REMOVED";
}

const rowsOut = FEATURES.map(feature => {
  const db = feature.tables.some(hasTable);
  const writer = feature.tables.some(hasWriter);
  const json = jsonState(feature.json);
  const ui = hasUi(feature.ui);
  return {
    Feature: feature.feature,
    DB: db ? "Yes" : "No",
    Writer: writer ? "Yes" : "No",
    JSON: json.exists ? json.hasRows ? "Yes" : "Empty" : "No",
    UI: ui ? "Yes" : "No",
    Status: statusFor({ db, writer, json, ui })
  };
});

const headers = ["Feature", "DB", "Writer", "JSON", "UI", "Status"];
const widths = headers.map(header => Math.max(header.length, ...rowsOut.map(row => String(row[header]).length)));
const line = row => headers.map((header, index) => String(row[header]).padEnd(widths[index])).join(" | ");

console.log(line(Object.fromEntries(headers.map(header => [header, header]))));
console.log(widths.map(width => "-".repeat(width)).join("-|-"));
for (const row of rowsOut) console.log(line(row));

const hidden = rowsOut.filter(row => row.Status === "HIDDEN").map(row => row.Feature);
const empty = rowsOut.filter(row => row.Status === "EMPTY").map(row => row.Feature);
const unused = rowsOut.filter(row => row.Status === "UNUSED").map(row => row.Feature);
console.log("");
console.log(`Hidden: ${hidden.length ? hidden.join(", ") : "none"}`);
console.log(`Empty: ${empty.length ? empty.join(", ") : "none"}`);
console.log(`Unused: ${unused.length ? unused.join(", ") : "none"}`);
