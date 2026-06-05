#!/usr/bin/env node

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const SUMMARY_PATH = "dashboard/api/sales/private-activity-summary.json";
const ACTIVITY_TYPES = [
  "contact_attempt",
  "quote_sent",
  "quote_value",
  "quote_result",
  "won",
  "lost",
  "loss_reason",
  "operation_completed",
  "customer_feedback"
];
const FORBIDDEN_PUBLIC_KEYS = new Set([
  "email",
  "phone",
  "mobile",
  "contact_name",
  "contact_person",
  "customer_feedback",
  "sensitive_payload",
  "notes",
  "recommended_email_draft"
]);

function readJson(relativePath) {
  const fullPath = path.join(ROOT, relativePath);
  if (!fs.existsSync(fullPath)) return null;
  return JSON.parse(fs.readFileSync(fullPath, "utf8"));
}

function walkForbiddenKeys(value, trail = []) {
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) return value.flatMap((item, index) => walkForbiddenKeys(item, [...trail, String(index)]));
  const findings = [];
  for (const [key, nested] of Object.entries(value)) {
    if (FORBIDDEN_PUBLIC_KEYS.has(String(key).toLowerCase())) findings.push([...trail, key].join("."));
    findings.push(...walkForbiddenKeys(nested, [...trail, key]));
  }
  return findings;
}

function countByType(payload = {}) {
  const items = Array.isArray(payload.items) ? payload.items : [];
  const counts = Object.fromEntries(ACTIVITY_TYPES.map(type => [type, 0]));
  for (const item of items) {
    const type = String(item.activity_type || "").toLowerCase();
    if (type in counts) counts[type] = Number(item.count || 0);
  }
  return counts;
}

const payload = readJson(SUMMARY_PATH);

console.log("Private Sales Data Audit");
console.log("========================");

if (!payload) {
  console.error(`ERROR: ${SUMMARY_PATH} not found`);
  process.exit(1);
}

const forbidden = walkForbiddenKeys(payload);
const counts = countByType(payload);

console.log(`- endpoint: ${SUMMARY_PATH}`);
console.log(`- generated_at: ${payload.generated_at || "-"}`);
console.log(`- data_mode: ${payload.data_mode || "-"}`);
console.log(`- source_table: ${payload.source_table || "-"}`);
console.log(`- record_count: ${payload.record_count ?? 0}`);
console.log(`- sensitive_details_exposed: ${payload.sensitive_details_exposed === true ? "true" : "false"}`);
console.log(`- public_snapshot_policy: ${payload.privacy?.public_snapshot || "aggregated_counts_only"}`);
console.log(`- sensitive_storage_policy: ${payload.privacy?.sensitive_storage || "Supabase private tables only"}`);
console.log("- activity_counts:");
for (const type of ACTIVITY_TYPES) console.log(`  - ${type}: ${counts[type] || 0}`);

if (forbidden.length) {
  console.error("ERROR: public private-activity summary exposes forbidden sensitive fields:");
  for (const key of forbidden) console.error(`  - ${key}`);
  process.exit(1);
}

if (payload.sensitive_details_exposed === true) {
  console.error("ERROR: sensitive_details_exposed must not be true");
  process.exit(1);
}

console.log("OK: public private activity summary contains aggregate data only.");
