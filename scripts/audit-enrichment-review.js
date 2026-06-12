import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const VALID_CONFLICT_TYPES = new Set([
  "DIFFERENT_IMO",
  "DIFFERENT_MMSI",
  "OPERATOR_CONFLICT",
  "MULTIPLE_VESSEL_NAME_MATCHES",
  "TIME_WINDOW_MISMATCH",
  "PORT_MISMATCH",
  "LOW_CONFIDENCE_FUZZY_MATCH"
]);

function readJson(relativePath, fallback = {}) {
  const filePath = path.join(ROOT, relativePath);
  try {
    return fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, "utf8")) : fallback;
  } catch (error) {
    return { _error: error.message, items: [] };
  }
}

function rows(payload = {}) {
  return Array.isArray(payload.items) ? payload.items : [];
}

function countBy(items = [], key) {
  return items.reduce((acc, item) => {
    const value = item[key] || "UNKNOWN";
    acc[value] = (acc[value] || 0) + 1;
    return acc;
  }, {});
}

const reviewPayload = readJson("dashboard/api/enrichment/review-queue.json", { items: [] });
const appliedPayload = readJson("dashboard/api/enrichment/applied.json", { items: [] });
const candidatesPayload = readJson("dashboard/api/enrichment/candidates.json", { items: [] });

const reviewItems = rows(reviewPayload);
const appliedItems = rows(appliedPayload);
const candidates = rows(candidatesPayload);
const rejectedItems = candidates.filter(item => item.action === "REJECT");

console.log("Enrichment Review Queue Audit");
console.log("=============================");
console.log(`generated_at=${reviewPayload.generated_at || "unknown"}`);
console.log(`review_count=${reviewItems.length.toLocaleString("ko-KR")}`);
console.log(`applied_count=${appliedItems.length.toLocaleString("ko-KR")}`);
console.log(`rejected_count=${rejectedItems.length.toLocaleString("ko-KR")}`);
console.log("");
console.log("Conflict type counts:");
for (const [type, count] of Object.entries(countBy(reviewItems, "conflict_type"))) {
  console.log(`- ${type}: ${count.toLocaleString("ko-KR")}`);
}

console.log("");
console.log("Top review samples:");
for (const item of reviewItems.slice(0, 10)) {
  const vessel = item.target_vessel?.vessel_name || item.target_vessel_key || "-";
  console.log(`- ${item.source_key}.${item.field_name} -> ${vessel} confidence=${item.confidence ?? item.match_confidence ?? "-"} conflict=${item.conflict_type || "-"} action=${item.recommended_action || "-"}`);
}

const problems = [];
if (reviewPayload._error) problems.push(`review-queue parse error: ${reviewPayload._error}`);
if (!Array.isArray(reviewPayload.items)) problems.push("review-queue items must be an array.");
for (const item of reviewItems) {
  if (!item.source_key) problems.push(`missing source_key: ${item.candidate_id || "unknown"}`);
  if (!("raw_value" in item)) problems.push(`missing raw_value: ${item.candidate_id || "unknown"}`);
  if (!("candidate_value" in item)) problems.push(`missing candidate_value: ${item.candidate_id || "unknown"}`);
  if (!item.target_vessel || typeof item.target_vessel !== "object") problems.push(`missing target_vessel: ${item.candidate_id || "unknown"}`);
  if (!item.field_name) problems.push(`missing field_name: ${item.candidate_id || "unknown"}`);
  if (!("current_value" in item)) problems.push(`missing current_value: ${item.candidate_id || "unknown"}`);
  const confidence = Number(item.confidence ?? item.match_confidence);
  if (!Number.isFinite(confidence)) problems.push(`invalid confidence: ${item.candidate_id || "unknown"}`);
  if (!VALID_CONFLICT_TYPES.has(item.conflict_type)) problems.push(`invalid conflict_type ${item.conflict_type}: ${item.candidate_id || "unknown"}`);
  if (!item.recommended_action) problems.push(`missing recommended_action: ${item.candidate_id || "unknown"}`);
  if (!item.reason) problems.push(`missing reason: ${item.candidate_id || "unknown"}`);
  if (confidence >= 85 && (item.current_value === null || item.current_value === undefined || item.current_value === "-")) {
    problems.push(`high-confidence empty-field item should be applied, not reviewed: ${item.candidate_id || "unknown"}`);
  }
  if (confidence < 60) {
    problems.push(`low-confidence item should be rejected/weak, not review: ${item.candidate_id || "unknown"}`);
  }
}

for (const item of appliedItems) {
  const confidence = Number(item.match_confidence ?? item.confidence);
  if (Number.isFinite(confidence) && confidence < 85) {
    problems.push(`applied item below confidence threshold: ${item.candidate_id || "unknown"} confidence=${confidence}`);
  }
}

if (problems.length) {
  console.error("");
  console.error("Problems:");
  for (const problem of [...new Set(problems)].slice(0, 50)) {
    console.error(`- ${problem}`);
  }
  process.exitCode = 1;
} else {
  console.log("");
  console.log("OK: enrichment review queue schema and action thresholds are valid.");
}
