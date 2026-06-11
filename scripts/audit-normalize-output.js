import fs from "fs";
import path from "path";

const API_ROOT = path.join(process.cwd(), "dashboard", "api");

const RAW_PORT_PATTERN = /\b(BUSAN|PUSAN|KRPUS|KR\s*PUS|ULSAN|KRUSN|YEOSU|GWANGYANG|INCHEON|DAESAN|PYEONGTAEK|PYONGTAEK|DANGJIN|POHANG|MASAN|CHANGWON|JINHAE|MOKPO|GUNSAN|UNKNOWN)\b/i;
const PORTISH_FIELDS = new Set([
  "port",
  "port_name",
  "current_port",
  "arrival_port",
  "destination_port",
  "next_port",
  "display_name",
  "port_display_name"
]);
const RAW_ALLOWED_FIELDS = new Set(["port_code", "raw_port", "raw_aliases"]);
const BUSINESS_LABEL_BY_CODE = {
  CONTACT_NOW: "즉시 연락",
  VERIFY_CONTACT: "연락처 확인 필요",
  PRE_ARRIVAL: "입항 전 선제 연락",
  ANCHORAGE_OPPORTUNITY: "묘박/정박 작업 가능",
  LONG_STAY_RISK: "장기 체류 위험",
  BIOFOULING_COMPLIANCE: "Compliance 대상",
  MONITOR: "모니터링",
  HOLD: "보류"
};

function listJsonFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...listJsonFiles(full));
    else if (entry.isFile() && entry.name.endsWith(".json")) files.push(full);
  }
  return files;
}

function rel(file) {
  return path.relative(process.cwd(), file).replace(/\\/g, "/");
}

function isBusinessEndpoint(relativePath) {
  if (!relativePath.startsWith("dashboard/api/")) return false;
  if (/\/(?:debug|quality|review)\//.test(relativePath)) return false;
  if (/endpoint-manifest|backend|health\/pipeline|source-health|readiness|snapshot|coverage|doctor|audit/i.test(relativePath)) return false;
  return true;
}

function walk(value, visitor, trail = []) {
  if (!value || typeof value !== "object") return;
  visitor(value, trail);
  if (Array.isArray(value)) {
    value.forEach((item, index) => walk(item, visitor, [...trail, String(index)]));
    return;
  }
  for (const [key, child] of Object.entries(value)) walk(child, visitor, [...trail, key]);
}

function normalizedDisplay(item = {}) {
  return item?.normalized_port?.display_name || item?.port_display_name || item?.display_name || item?.port_name || "";
}

const reports = [];
for (const file of listJsonFiles(API_ROOT).filter(file => isBusinessEndpoint(rel(file)))) {
  const relativePath = rel(file);
  let payload;
  try {
    payload = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    reports.push({ endpoint: relativePath, type: "invalid_json", detail: error.message });
    continue;
  }
  walk(payload, (node, trail) => {
    if (!node || typeof node !== "object" || Array.isArray(node)) return;
    for (const [key, value] of Object.entries(node)) {
      if (!PORTISH_FIELDS.has(key) || RAW_ALLOWED_FIELDS.has(key)) continue;
      const parentKey = trail[trail.length - 1] || "";
      if (parentKey === "normalized_port") continue;
      if (typeof value === "string" && RAW_PORT_PATTERN.test(value)) {
        reports.push({ endpoint: relativePath, type: "raw_english_port_label", path: [...trail, key].join("."), detail: value });
      }
    }
    const hasPortSignal = [...PORTISH_FIELDS].some(key => typeof node[key] === "string" && node[key].trim()) ||
      Boolean(node.normalized_port);
    if (hasPortSignal) {
      const displayName = normalizedDisplay(node);
      if (!displayName) reports.push({ endpoint: relativePath, type: "missing_display_name", path: trail.join("."), detail: "port-like object missing display_name" });
      if (node.normalized_port?.display_name === "미확인 항만") reports.push({ endpoint: relativePath, type: "unknown_port", path: trail.join("."), detail: node.normalized_port.raw_port || "UNKNOWN" });
    }
    const code = String(node.action_type || node.primary_category_code || node.category_code || node.code || "").toUpperCase();
    const expectedLabel = BUSINESS_LABEL_BY_CODE[code];
    if (expectedLabel) {
      const labels = [node.korean_label, node.category_label, node.action_label, node.label, node.primary_category_label].filter(Boolean);
      if (!labels.includes(expectedLabel)) {
        reports.push({ endpoint: relativePath, type: "raw_business_code_without_korean_label", path: trail.join("."), detail: `${code} expected ${expectedLabel}` });
      }
    }
  });

  const itemArrays = [];
  if (Array.isArray(payload.items)) itemArrays.push(["items", payload.items]);
  if (Array.isArray(payload.ports)) itemArrays.push(["ports", payload.ports]);
  for (const [name, items] of itemArrays) {
    const portLike = items.filter(item => item && typeof item === "object" && !item.vessel_name && !item.vessel_display && normalizedDisplay(item));
    const seen = new Map();
    for (const item of portLike) {
      const display = normalizedDisplay(item);
      if (!display) continue;
      seen.set(display, (seen.get(display) || 0) + 1);
    }
    for (const [display, count] of seen) {
      if (count > 1) reports.push({ endpoint: relativePath, type: "duplicate_normalized_port_name", path: name, detail: `${display} x${count}` });
    }
  }
}

const grouped = reports.reduce((acc, report) => {
  acc[report.type] = (acc[report.type] || 0) + 1;
  return acc;
}, {});

console.log("Normalize output audit");
console.log(`- endpoints checked: ${listJsonFiles(API_ROOT).filter(file => isBusinessEndpoint(rel(file))).length}`);
console.log(`- raw English port labels: ${grouped.raw_english_port_label || 0}`);
console.log(`- missing display_name: ${grouped.missing_display_name || 0}`);
console.log(`- duplicate normalized port names: ${grouped.duplicate_normalized_port_name || 0}`);
console.log(`- unknown port count: ${grouped.unknown_port || 0}`);
console.log(`- raw business codes without Korean labels: ${grouped.raw_business_code_without_korean_label || 0}`);

for (const report of reports.slice(0, 80)) {
  console.log(`- [${report.type}] ${report.endpoint}${report.path ? ` :: ${report.path}` : ""} :: ${report.detail}`);
}
if (reports.length > 80) console.log(`- ... ${reports.length - 80} more`);

const blocking = reports.filter(report => [
  "invalid_json",
  "raw_english_port_label",
  "missing_display_name",
  "raw_business_code_without_korean_label",
  "duplicate_normalized_port_name"
].includes(report.type));

if (blocking.length) {
  console.error(`Normalize output audit failed: ${blocking.length} blocking issue(s).`);
  process.exit(1);
}
