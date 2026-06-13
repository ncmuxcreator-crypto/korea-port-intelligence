import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { normalizeCallSign, normalizeFlag, normalizeNumeric, normalizeVesselName, normalizeVesselType } from "./lib/normalize.js";

const EXPECTED_FIELDS = [
  "vessel_name",
  "normalized_vessel_name",
  "imo",
  "mmsi",
  "call_sign",
  "operator",
  "owner",
  "manager",
  "vessel_type",
  "gt",
  "dwt",
  "flag",
  "verified",
  "notes",
  "updated_at"
];

const FIELD_ALIASES = {
  vessel_name: ["vessel_name", "name", "ship_name", "vsl_nm", "vesselName", "Vessel Name", "선명"],
  normalized_vessel_name: ["normalized_vessel_name", "normalized_name", "norm_name"],
  imo: ["imo", "imo_no", "imo_number", "imoNumber", "IMO"],
  mmsi: ["mmsi", "MMSI"],
  call_sign: ["call_sign", "callsign", "callSign", "clsgn", "Call Sign", "호출부호"],
  operator: ["operator", "shipping_company", "company", "company_name", "owner_operator", "운영사", "선사"],
  owner: ["owner", "registered_owner", "소유자"],
  manager: ["manager", "technical_manager", "ship_manager", "관리사"],
  vessel_type: ["vessel_type", "ship_type", "type", "vesselType", "선종"],
  gt: ["gt", "grt", "gross_tonnage", "intrlGrtg", "GT", "총톤수"],
  dwt: ["dwt", "deadweight", "DWT", "재화중량"],
  flag: ["flag", "flag_state", "국적"],
  verified: ["verified", "is_verified", "validated"],
  notes: ["notes", "note", "memo", "비고"],
  updated_at: ["updated_at", "updatedAt", "last_updated", "lastUpdated"]
};

function parseCsvLine(line = "") {
  const cells = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === '"' && quoted && next === '"') {
      cell += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      cells.push(cell);
      cell = "";
    } else {
      cell += char;
    }
  }
  cells.push(cell);
  return cells.map(value => value.trim());
}

function csvEscape(value = "") {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function indexHeaders(headers = []) {
  const lower = headers.map(header => String(header || "").trim().toLowerCase());
  return Object.fromEntries(EXPECTED_FIELDS.map(field => {
    const aliases = FIELD_ALIASES[field] || [field];
    const index = aliases
      .map(alias => lower.indexOf(String(alias).trim().toLowerCase()))
      .find(position => position >= 0);
    return [field, index ?? -1];
  }));
}

function value(cells = [], headerIndex = {}, field = "") {
  const index = headerIndex[field];
  return index >= 0 ? String(cells[index] ?? "").trim() : "";
}

function dedupeKey(row = {}) {
  if (row.imo) return `imo:${row.imo}`;
  if (row.mmsi) return `mmsi:${row.mmsi}`;
  if (row.call_sign && row.normalized_vessel_name) return `call_name:${row.call_sign}|${row.normalized_vessel_name}`;
  return "";
}

async function main() {
  const input = process.argv[2] || process.env.SOURCE_CSV_RAW_PATH;
  const output = process.argv[3] || "data/source-csv-reference.csv";
  if (!input) {
    console.error("Usage: node scripts/build-source-csv-reference.js <raw.csv> [output.csv]");
    process.exit(1);
  }
  if (!fs.existsSync(input)) {
    console.error(`Input CSV not found: ${input}`);
    process.exit(1);
  }

  fs.mkdirSync(path.dirname(output), { recursive: true });
  const reader = readline.createInterface({
    input: fs.createReadStream(input, { encoding: "utf8" }),
    crlfDelay: Infinity
  });
  const writer = fs.createWriteStream(output, { encoding: "utf8" });
  writer.write(`${EXPECTED_FIELDS.join(",")}\n`);

  let headerIndex = null;
  let readRows = 0;
  let writtenRows = 0;
  const seen = new Set();
  for await (const line of reader) {
    if (!line.trim()) continue;
    const cells = parseCsvLine(line);
    if (!headerIndex) {
      headerIndex = indexHeaders(cells);
      continue;
    }
    readRows += 1;
    const vesselName = value(cells, headerIndex, "vessel_name");
    const row = {
      vessel_name: vesselName,
      normalized_vessel_name: normalizeVesselName(vesselName || value(cells, headerIndex, "normalized_vessel_name")),
      imo: value(cells, headerIndex, "imo"),
      mmsi: value(cells, headerIndex, "mmsi"),
      call_sign: normalizeCallSign(value(cells, headerIndex, "call_sign")),
      operator: value(cells, headerIndex, "operator"),
      owner: value(cells, headerIndex, "owner"),
      manager: value(cells, headerIndex, "manager"),
      vessel_type: normalizeVesselType(value(cells, headerIndex, "vessel_type")),
      gt: normalizeNumeric(value(cells, headerIndex, "gt")) ?? "",
      dwt: normalizeNumeric(value(cells, headerIndex, "dwt")) ?? "",
      flag: normalizeFlag(value(cells, headerIndex, "flag")),
      verified: value(cells, headerIndex, "verified") || "true",
      notes: value(cells, headerIndex, "notes"),
      updated_at: value(cells, headerIndex, "updated_at")
    };
    if (!row.vessel_name && !row.normalized_vessel_name && !row.imo && !row.mmsi && !row.call_sign) continue;
    const key = dedupeKey(row);
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    writer.write(`${EXPECTED_FIELDS.map(field => csvEscape(row[field])).join(",")}\n`);
    writtenRows += 1;
  }

  writer.end();
  await new Promise(resolve => writer.on("finish", resolve));
  console.log(`source_csv_reference_built input_rows=${readRows} output_rows=${writtenRows} output=${output}`);
}

main().catch(error => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
