import fs from "fs";
import path from "path";

const ROOT = process.cwd();
const DOC_PATH = path.join(ROOT, "docs", "VESSEL_DISPLAY_MAPPING_AUDIT.md");

const ENDPOINTS = [
  { key: "bootstrap.top_candidates", file: "dashboard/api/bootstrap.json", paths: ["top_candidates", "sales_priority"] },
  { key: "candidates/top", file: "dashboard/api/candidates/top.json", paths: ["items", "opportunities", "candidates"] },
  { key: "targets/current", file: "dashboard/api/targets/current.json", paths: ["items", "targets"] },
  { key: "targets/categories", file: "dashboard/api/targets/categories.json", paths: ["categories[].items"] },
  { key: "sales/actions", file: "dashboard/api/sales/actions.json", paths: ["items"] },
  { key: "sales/conversion-pipeline", file: "dashboard/api/sales/conversion-pipeline.json", paths: ["items"] },
  { key: "sales/quote-opportunities", file: "dashboard/api/sales/quote-opportunities.json", paths: ["items"] },
  { key: "watchlist/current", file: "dashboard/api/watchlist/current.json", paths: ["items"] },
  { key: "staying-vessels", file: "dashboard/api/staying-vessels.json", paths: ["items"] },
  { key: "anchorage-waiting", file: "dashboard/api/anchorage-waiting.json", paths: ["items"] },
  { key: "arrival-pipeline", file: "dashboard/api/arrival-pipeline.json", paths: ["items"] },
  { key: "vessels/page-1", file: "dashboard/api/vessels/page-1.json", paths: ["items"] }
];

const REQUIRED_FIELDS = [
  ["vessel_name", "text"],
  ["imo", "text"],
  ["mmsi", "text"],
  ["call_sign", "text"],
  ["flag", "text"],
  ["vessel_type", "text"],
  ["gt", "number"],
  ["dwt", "number"],
  ["operator", "text"],
  ["operator_display", "text"],
  ["company", "text"],
  ["owner", "text"],
  ["manager", "text"],
  ["agent", "text"],
  ["current_port", "text"],
  ["current_port_korean", "text"],
  ["berth", "text"],
  ["anchorage", "text"],
  ["eta", "text"],
  ["etb", "text"],
  ["ata", "text"],
  ["atb", "text"],
  ["etd", "text"],
  ["atd", "text"],
  ["stay_days", "number"],
  ["stay_hours", "number"],
  ["waiting_hours", "number"],
  ["port_stay_hours", "number"],
  ["congestion_score", "number"],
  ["waiting_score", "number"],
  ["opportunity_score", "number"],
  ["risk_score", "number"],
  ["biofouling_score", "number"],
  ["compliance_score", "number"],
  ["confidence_score", "number"],
  ["priority_label", "text"],
  ["priority_label_ko", "text"],
  ["target_categories", "array"],
  ["reason_summary", "text"],
  ["recommended_action", "text"],
  ["data_sources", "array"],
  ["enrichment_sources", "array"],
  ["last_seen_at", "text"]
];

const COVERAGE_FIELDS = [
  ["gt", "number"],
  ["vessel_type", "text"],
  ["operator_display", "text"],
  ["current_port_korean", "text"],
  ["stay_days", "number"],
  ["waiting_hours", "number"],
  ["opportunity_score", "number"],
  ["risk_score", "number"]
];

const MISSING_TEXT = new Set(["", "-", "--", "0", "unknown", "null", "undefined", "n/a", "na", "none", "확인 불가", "확인 필요", "미확인", "정보 없음"]);

function readJson(file) {
  const fullPath = path.join(ROOT, file);
  if (!fs.existsSync(fullPath)) return { missing: true, payload: null, error: "missing file" };
  try {
    return { missing: false, payload: JSON.parse(fs.readFileSync(fullPath, "utf8")), error: "" };
  } catch (error) {
    return { missing: false, payload: null, error: error.message };
  }
}

function getPath(object, pathExpression) {
  if (!object || !pathExpression) return undefined;
  return String(pathExpression).split(".").reduce((value, part) => value?.[part], object);
}

function rowsFrom(payload, paths = []) {
  const rows = [];
  for (const rowPath of paths) {
    if (rowPath === "categories[].items") {
      for (const category of payload?.categories || []) {
        if (Array.isArray(category?.items)) rows.push(...category.items);
      }
      continue;
    }
    const value = getPath(payload, rowPath);
    if (Array.isArray(value)) rows.push(...value);
  }
  if (!rows.length && Array.isArray(payload?.items)) rows.push(...payload.items);
  return rows.filter(Boolean);
}

function hasText(value) {
  if (value === null || value === undefined) return false;
  const text = String(value).normalize("NFKC").trim();
  return Boolean(text) && !MISSING_TEXT.has(text.toLowerCase());
}

function hasNumber(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === "string" && !value.trim()) return false;
  if (typeof value === "string" && MISSING_TEXT.has(value.trim().toLowerCase())) return false;
  return Number.isFinite(Number(String(value).replace(/,/g, "")));
}

function present(value, type) {
  if (type === "array") return Array.isArray(value) && value.length > 0;
  return type === "number" ? hasNumber(value) : hasText(value);
}

function firstText(...values) {
  for (const value of values) {
    if (hasText(value)) return String(value).trim();
  }
  return "";
}

function fieldCoverage(items, field, type) {
  return items.filter(item => present(item?.vessel_display?.[field], type)).length;
}

function reasonMentionsGt(reason = "") {
  return /\bGT\s*[:=]?\s*[0-9]/i.test(String(reason || ""));
}

function reasonMentionsStay(reason = "") {
  return /체류|stay|dwell|묘박|정박|대기|waiting|anchorage/i.test(String(reason || ""));
}

function reasonMentionsStayOrWaiting(reason = "") {
  return reasonMentionsStay(reason) || /체류|묘박|정박|대기|장기\s*체류|LONG_PORT_STAY|stay|dwell|waiting|anchorage/i.test(String(reason || ""));
}

function reasonMentionsDurationValue(reason = "") {
  const text = String(reason || "");
  return /(?:체류|묘박|정박|대기|장기\s*체류|stay|dwell|waiting|anchorage)[^0-9]{0,24}[1-9][0-9,]*(?:\.\d+)?\s*(?:일|시간|d|day|days|h|hr|hrs|hour|hours)?/i.test(text) ||
    /[1-9][0-9,]*(?:\.\d+)?\s*(?:일|시간|d|day|days|h|hr|hrs|hour|hours)[^가-힣A-Za-z0-9]{0,16}(?:체류|묘박|정박|대기|stay|dwell|waiting|anchorage)/i.test(text);
}

function reasonMentionsDurationValueSafe(reason = "") {
  const text = String(reason || "");
  const termsBeforeNumber = /(?:\uCCB4\uB958|\uBB18\uBC15|\uC815\uBC15|\uB300\uAE30|\uC7A5\uAE30\s*\uCCB4\uB958|stay|dwell|waiting|anchorage)[^0-9]{0,24}[1-9][0-9,]*(?:\.\d+)?\s*(?:\uC77C|\uC2DC\uAC04|d|day|days|h|hr|hrs|hour|hours)/i;
  const numberBeforeTerms = /[1-9][0-9,]*(?:\.\d+)?\s*(?:\uC77C|\uC2DC\uAC04|d|day|days|h|hr|hrs|hour|hours)[^\uAC00-\uD7A3A-Za-z0-9]{0,16}(?:\uCCB4\uB958|\uBB18\uBC15|\uC815\uBC15|\uB300\uAE30|stay|dwell|waiting|anchorage)/i;
  return termsBeforeNumber.test(text) || numberBeforeTerms.test(text);
}

function analyzeEndpoint(endpoint) {
  const read = readJson(endpoint.file);
  const analysis = {
    ...endpoint,
    exists: !read.missing,
    valid_json: !read.error,
    parse_error: read.error,
    record_count: 0,
    rows_with_display: 0,
    coverage: {},
    contradictions: [],
    warnings: []
  };

  if (read.error || !read.payload) return analysis;
  const items = rowsFrom(read.payload, endpoint.paths);
  analysis.record_count = items.length;
  analysis.rows_with_display = items.filter(item => item?.vessel_display && typeof item.vessel_display === "object").length;

  for (const [field, type] of REQUIRED_FIELDS) {
    analysis.coverage[field] = fieldCoverage(items, field, type);
  }

  for (const item of items) {
    const display = item?.vessel_display || {};
    const rawCompany = firstText(item.operator, item.shipping_company, item.company, item.company_name, item.owner_operator, item.technical_manager, item.manager, item.owner);
    if (rawCompany && !hasText(display.operator_display)) analysis.contradictions.push("operator_display_missing_despite_company");
    const rawPort = firstText(item.current_port, item.port_name, item.port, item.arrival_port, item.destination_port, item.destination);
    if (rawPort && !hasText(display.current_port_korean)) analysis.contradictions.push("current_port_korean_missing_despite_port");
    const rawScore = hasNumber(item.opportunity_score) || hasNumber(item.sales_priority_score) || hasNumber(item.commercial_value_score);
    if (rawScore && !hasNumber(display.opportunity_score)) analysis.contradictions.push("opportunity_score_missing_despite_raw_score");
    const reason = firstText(item.reason_summary, item.quote_reason_summary, item.why_now, display.reason_summary);
    if (reasonMentionsGt(reason) && !hasNumber(display.gt)) analysis.contradictions.push("reason_mentions_gt_but_display_gt_missing");
    if (reasonMentionsDurationValueSafe(reason) && !hasNumber(display.stay_days)) analysis.contradictions.push("reason_mentions_stay_but_display_stay_days_missing");
    if (
      reasonMentionsDurationValueSafe(reason) &&
      !hasNumber(display.stay_days) &&
      !hasNumber(display.stay_hours) &&
      !hasNumber(display.waiting_hours) &&
      !hasNumber(display.port_stay_hours) &&
      !hasNumber(display.portStayHours) &&
      !hasNumber(display.anchorageHours)
    ) {
      analysis.contradictions.push("reason_mentions_stay_but_display_duration_missing");
    }
  }

  analysis.contradictions = [...new Set(analysis.contradictions)];
  if (items.length && analysis.rows_with_display !== items.length) analysis.warnings.push("some_rows_missing_vessel_display");
  if (items.length && analysis.coverage.operator_display === 0) analysis.warnings.push("operator_display_coverage_zero");
  if (items.length && analysis.coverage.current_port_korean === 0) analysis.warnings.push("current_port_korean_coverage_zero");
  if (analysis.contradictions.length) analysis.warnings.push("display_mapping_contradictions_found");
  return analysis;
}

function pct(count, total) {
  if (!total) return "0.0%";
  return `${((count / total) * 100).toFixed(1)}%`;
}

function writeDoc(results) {
  const generatedAt = new Date().toISOString();
  const lines = [
    "# Vessel Display Mapping Audit",
    "",
    `Generated at: ${generatedAt}`,
    "",
    "## Scope",
    "",
    "This audit checks whether generated dashboard JSON items expose the canonical `vessel_display` object used by the frontend. It does not change UI, scoring, or data collection.",
    "",
    "## Canonical Mapping",
    "",
    "- Text fields use `-` when missing.",
    "- Numeric fields use `null` when missing; valid numeric `0` remains `0`.",
    "- `operator_display` falls back through operator, shipping_company, company, company_name, owner_operator, technical_manager, manager, owner.",
    "- `current_port_korean` is derived through existing port normalization plus Korean display-name fallback.",
    "- `reason_summary` parsing is used only as a fallback for non-critical display fields such as GT, stay duration, berth, or anchorage text. It is never used for IMO/MMSI identity.",
    "",
    "## Endpoint Coverage",
    "",
    "| Endpoint | Exists | Valid JSON | Rows | Rows With Display | Operator Display | Port Korean | Opportunity Score | Contradictions |",
    "| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- |"
  ];

  for (const result of results) {
    lines.push(`| ${result.key} | ${result.exists ? "yes" : "no"} | ${result.valid_json ? "yes" : "no"} | ${result.record_count} | ${result.rows_with_display} | ${pct(result.coverage.operator_display || 0, result.record_count)} | ${pct(result.coverage.current_port_korean || 0, result.record_count)} | ${pct(result.coverage.opportunity_score || 0, result.record_count)} | ${result.contradictions.join(", ") || "-"} |`);
  }

  lines.push("", "## Required Fields");
  lines.push("", REQUIRED_FIELDS.map(([field, type]) => `- ${field}: ${type}`).join("\n"));
  lines.push("", "## Notes");
  lines.push("", "- Coverage can remain low when the source data truly lacks IMO, MMSI, operator, or timestamp fields.");
  lines.push("- The important failure condition is contradiction: source data or reason text has a value but `vessel_display` does not expose it.");

  fs.mkdirSync(path.dirname(DOC_PATH), { recursive: true });
  fs.writeFileSync(DOC_PATH, `${lines.join("\n")}\n`, "utf8");
}

const results = ENDPOINTS.map(analyzeEndpoint);

console.log("Vessel display mapping audit:");
for (const result of results) {
  console.log(`\n${result.key}`);
  console.log(`- file: ${result.file}`);
  console.log(`- exists: ${result.exists}`);
  console.log(`- valid_json: ${result.valid_json}`);
  if (result.parse_error) console.log(`- parse_error: ${result.parse_error}`);
  console.log(`- rows: ${result.record_count}`);
  console.log(`- rows_with_vessel_display: ${result.rows_with_display}`);
  for (const [field] of COVERAGE_FIELDS) {
    console.log(`- ${field}_coverage: ${pct(result.coverage[field] || 0, result.record_count)}`);
  }
  if (result.contradictions.length) console.log(`- contradictions: ${result.contradictions.join(", ")}`);
  if (result.warnings.length) console.log(`- warnings: ${result.warnings.join(", ")}`);
}

writeDoc(results);
console.log(`\nWrote ${path.relative(ROOT, DOC_PATH)}`);

const parseFailures = results.filter(result => result.exists && !result.valid_json);
if (parseFailures.length) {
  console.error(`\nFailed: ${parseFailures.length} endpoint(s) could not be parsed.`);
  process.exit(1);
}
