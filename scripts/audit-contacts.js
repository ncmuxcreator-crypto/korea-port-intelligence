import fs from "fs";

function readJson(path, fallback = {}) {
  try {
    return fs.existsSync(path) ? JSON.parse(fs.readFileSync(path, "utf8")) : fallback;
  } catch {
    return fallback;
  }
}

function rows(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.vessels)) return payload.vessels;
  if (Array.isArray(payload?.candidates)) return payload.candidates;
  if (Array.isArray(payload?.opportunities)) return payload.opportunities;
  return [];
}

function value(record, names) {
  for (const name of names) {
    const direct = record?.[name];
    const display = record?.vessel_display?.[name];
    const found = direct ?? display;
    if (hasValue(found)) return found;
  }
  return "";
}

function hasValue(input) {
  const text = String(input ?? "").trim();
  return Boolean(text) && text !== "-" && !/^(unknown|n\/a|null|undefined|확인 필요|미확인)$/i.test(text);
}

function priority(record) {
  return String(value(record, ["priority_label", "urgency", "sales_priority_band", "candidate_band"]) || "").toUpperCase();
}

function countWith(records, names) {
  return records.filter(record => hasValue(value(record, names))).length;
}

const targetsPayload = readJson("dashboard/api/targets/current.json");
const verificationPayload = readJson("dashboard/api/sales/verification-queue.json");
const followupPayload = readJson("dashboard/api/agent-followup-queue.json");
const targets = rows(targetsPayload);
const verification = rows(verificationPayload);
const followups = rows(followupPayload);
const verificationCount = Number(verificationPayload.record_count ?? verification.length);
const hotTargets = targets.filter(record => priority(record) === "HOT");
const hotMissingOperatorOrAgent = hotTargets.filter(record =>
  !hasValue(value(record, ["operator", "operator_name"])) ||
  !hasValue(value(record, ["agent", "agent_name", "local_agent"]))
);
const missingAllCompany = targets.filter(record =>
  !hasValue(value(record, ["operator", "operator_name"])) &&
  !hasValue(value(record, ["owner", "owner_name", "ship_owner", "registered_owner"])) &&
  !hasValue(value(record, ["manager", "manager_name", "ship_manager", "technical_manager"])) &&
  !hasValue(value(record, ["agent", "agent_name", "local_agent"]))
);
const hotMissingRate = hotTargets.length ? Math.round((hotMissingOperatorOrAgent.length / hotTargets.length) * 1000) / 10 : 0;

console.log("Contact / Agent Verification Audit");
console.log("==================================");
console.log(`- sales target count: ${targets.length}`);
console.log(`- targets with operator: ${countWith(targets, ["operator", "operator_name"])}`);
console.log(`- targets with owner: ${countWith(targets, ["owner", "owner_name", "ship_owner", "registered_owner"])}`);
console.log(`- targets with manager: ${countWith(targets, ["manager", "manager_name", "ship_manager", "technical_manager"])}`);
console.log(`- targets with local agent: ${countWith(targets, ["agent", "agent_name", "local_agent"])}`);
console.log(`- targets missing all company fields: ${missingAllCompany.length}`);
console.log(`- verification queue count: ${verificationCount}`);
console.log(`- legacy followup queue count: ${followups.length}`);
console.log(`- HOT targets missing operator/agent: ${hotMissingOperatorOrAgent.length}/${hotTargets.length} (${hotMissingRate}%)`);

if (hotMissingRate > 60) {
  console.log("WARNING: more than 60% of HOT targets lack operator/agent info");
}
if (!verificationCount && (missingAllCompany.length || hotMissingOperatorOrAgent.length)) {
  console.log("WARNING: verification queue is empty while missing contact data exists");
}

for (const item of verification.slice(0, 10)) {
  const missing = Array.isArray(item.missing_fields) ? item.missing_fields.join(",") : "";
  console.log(`  ${item.rank || "-"} ${item.vessel_name || item.vessel_display?.vessel_name || "선명 확인 필요"} | ${item.verification_type || "VERIFY"} | missing=${missing || "-"} | company=${item.known_company || "-"}`);
}
