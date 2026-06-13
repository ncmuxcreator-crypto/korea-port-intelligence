import fs from "fs";
import path from "path";
import {
  buildVesselMatchKeys,
  normalizeCallSign,
  normalizePort,
  normalizeVesselName
} from "./lib/normalize.js";

const GENERATED_AT = new Date().toISOString();
const REPORT_PATH = "dashboard/api/normalization-report.json";
const DOC_PATH = "docs/NORMALIZATION_AND_CANONICAL_KEYS.md";

function readJson(file, fallback = {}) {
  try {
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : fallback;
  } catch {
    return fallback;
  }
}

function rows(payload = {}) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.items)) return payload.items;
  if (Array.isArray(payload.vessels)) return payload.vessels;
  if (Array.isArray(payload.data)) return payload.data;
  return [];
}

function display(row = {}) {
  return row.vessel_display && typeof row.vessel_display === "object"
    ? { ...row, ...row.vessel_display }
    : row;
}

function first(...values) {
  return values.find(value => value !== undefined && value !== null && String(value).trim() !== "") ?? "";
}

function sourceFilesUsingSharedNormalize() {
  const candidates = [
    "scripts/collectors/korea.js",
    "scripts/lib/matching.js",
    "scripts/lib/evidence-matching-engine.js",
    "scripts/lib/match-review.js",
    "scripts/lib/source-csv-cache.js",
    "scripts/build-source-csv-reference.js",
    "scripts/daily-enrichment.js"
  ];
  return candidates.map(file => {
    const text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
    const direct = /from\s+["'][.\/]+(?:lib\/)?normalize\.js["']/.test(text) ||
      /from\s+["']\.\.\/lib\/normalize\.js["']/.test(text);
    const viaMatching = /from\s+["'][.\/]+(?:lib\/)?matching\.js["']/.test(text) ||
      /from\s+["']\.\.\/lib\/matching\.js["']/.test(text);
    return {
      file,
      uses_shared_normalize: direct || viaMatching,
      normalize_usage: direct ? "direct" : viaMatching ? "via_matching_wrapper" : "not_detected"
    };
  });
}

function legacyDuplicateNormalizationFiles() {
  const files = [];
  const stack = ["scripts"];
  while (stack.length) {
    const dir = stack.pop();
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!["node_modules", ".git"].includes(entry.name)) stack.push(full);
        continue;
      }
      if (!entry.name.endsWith(".js") || full.replace(/\\/g, "/") === "scripts/lib/normalize.js") continue;
      const text = fs.readFileSync(full, "utf8");
      const matches = text.match(/function\s+normalize(?:VesselName|CallSign|Port|Imo|Mmsi|Gt|DateTime|TimeWindow)\b/g) || [];
      if (matches.length) files.push({ file: full.replace(/\\/g, "/"), duplicate_function_count: matches.length });
    }
  }
  return files;
}

function vesselIdentity(row = {}) {
  const d = display(row);
  const rawCallSign = first(d.raw_call_sign, d.call_sign, d.callsign, d.clsgn);
  const canonicalCallSign = normalizeCallSign(first(d.canonical_call_sign, rawCallSign));
  const port = normalizePort(first(d.normalized_port?.normalized_port, d.current_port, d.port_name, d.port, d.port_code));
  const name = normalizeVesselName(first(d.normalized_vessel_name, d.vessel_name, d.name, d.ship_name));
  const keys = buildVesselMatchKeys({
    ...d,
    canonical_call_sign: canonicalCallSign,
    normalized_vessel_name: name,
    normalized_port: port.normalized_port
  });
  return {
    vessel_name: first(d.vessel_name, d.name, d.ship_name),
    raw_call_sign: rawCallSign,
    canonical_call_sign: canonicalCallSign,
    call_sign_source: first(d.call_sign_source, canonicalCallSign ? "port_operation" : ""),
    call_sign_valid: Boolean(canonicalCallSign),
    port_code: port.port_code || port.normalized_port || "",
    normalized_port: port.normalized_port || "",
    normalized_vessel_name: name,
    keys
  };
}

function duplicateGroups(items, keyFn) {
  const map = new Map();
  for (const item of items) {
    const key = keyFn(item);
    if (!key) continue;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  }
  return [...map.entries()]
    .filter(([, group]) => group.length > 1)
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 20)
    .map(([key, group]) => ({
      key,
      count: group.length,
      examples: group.slice(0, 5).map(item => ({
        vessel_name: item.vessel_name,
        canonical_call_sign: item.canonical_call_sign,
        normalized_port: item.normalized_port
      }))
    }));
}

function auxMatchRows() {
  const payloads = [
    readJson("dashboard/api/aux/latest/pilotage-match-results.json", {}),
    readJson("dashboard/api/aux/latest/berth-match-results.json", {}),
    readJson("dashboard/api/review/pilotage-berth-matches.json", {})
  ];
  return payloads.flatMap(rows);
}

function pncClassification() {
  const berthSummary = readJson("dashboard/api/aux/berth-summary.json", {});
  const latest = readJson("dashboard/api/aux/latest/berth-summary.json", {});
  const samples = [
    ...(Array.isArray(berthSummary.raw_sample_keys) ? berthSummary.raw_sample_keys : []),
    ...(Array.isArray(latest.raw_sample_keys) ? latest.raw_sample_keys : []),
    ...rows(readJson("dashboard/api/aux/latest/berth-match-results.json", {})).flatMap(item => Object.keys(item || {}))
  ];
  const hasMotherVesselCode = samples.some(key => /모선코드|vessel_code|vslCd|terminal_vessel_code|pnc_vessel_code/i.test(String(key)));
  return {
    terminal_vessel_code_detected: hasMotherVesselCode,
    classification: hasMotherVesselCode
      ? "PNC vessel code is treated as terminal_vessel_code; it is not promoted to call_sign unless it equals canonical_call_sign."
      : "No terminal vessel code sample detected in current berth summaries.",
    policy: "do_not_assume_terminal_vessel_code_is_call_sign"
  };
}

function buildReport() {
  const coreRows = rows(readJson("dashboard/api/all-collected-vessels.json", {}));
  const identities = coreRows.map(vesselIdentity);
  const auxRows = auxMatchRows();
  const auxWithCallSign = auxRows.filter(item => normalizeCallSign(first(item.normalized_call_sign, item.raw_call_sign, item.call_sign)));
  const callSignMatches = auxRows.filter(item =>
    /call_sign/i.test(first(item.match_type, (item.evidence || []).join("+"))) ||
    (Array.isArray(item.evidence) && item.evidence.some(value => /call_sign/i.test(String(value))))
  );
  const unmatchedCallSigns = auxRows.filter(item => {
    const call = normalizeCallSign(first(item.normalized_call_sign, item.raw_call_sign, item.call_sign));
    const action = String(first(item.action, item.recommended_action)).toUpperCase();
    return call && (!item.candidate_vessel_key || action === "REJECT");
  });
  const invalidCallSignExamples = identities
    .filter(item => item.raw_call_sign && !item.canonical_call_sign)
    .slice(0, 20)
    .map(item => ({ vessel_name: item.vessel_name, raw_call_sign: item.raw_call_sign }));
  const duplicates = duplicateGroups(identities, item => item.canonical_call_sign);
  const sharedUsage = sourceFilesUsingSharedNormalize();
  const legacyDuplicates = legacyDuplicateNormalizationFiles();
  return {
    schema_version: "1.0",
    generated_at: GENERATED_AT,
    source_layer: "diagnostic",
    startup_safe: false,
    load_strategy: "diagnostic_only",
    canonical_policy: {
      canonical_call_sign_source: "port_operation",
      hierarchy: [
        "IMO exact",
        "MMSI exact",
        "canonical_call_sign exact",
        "canonical_call_sign + port_code",
        "canonical_call_sign + port_code + time window",
        "normalized_vessel_name + canonical_call_sign",
        "normalized_vessel_name + port_code + time window",
        "fuzzy vessel name only -> review queue"
      ]
    },
    record_count: 1,
    item_count: 1,
    shared_normalize_module: "scripts/lib/normalize.js",
    duplicate_normalization_functions_removed_from_active_audit_path: true,
    sources_using_shared_normalize_module: sharedUsage,
    legacy_duplicate_normalization_functions_remaining: legacyDuplicates,
    core_vessels: {
      total: identities.length,
      with_canonical_call_sign: identities.filter(item => item.canonical_call_sign).length,
      invalid_call_sign_examples: invalidCallSignExamples,
      duplicate_call_signs: duplicates
    },
    auxiliary_sources: {
      rows_checked: auxRows.length,
      rows_with_normalized_call_sign: auxWithCallSign.length,
      matches_by_canonical_call_sign: callSignMatches.length,
      unmatched_call_signs: unmatchedCallSigns.slice(0, 30).map(item => ({
        source_row_id: item.source_row_id || item.raw_row_identity || "",
        raw_call_sign: first(item.raw_call_sign, item.call_sign),
        normalized_call_sign: normalizeCallSign(first(item.normalized_call_sign, item.raw_call_sign, item.call_sign)),
        blocker_reason: item.blocker_reason || "unmatched"
      }))
    },
    pnc: pncClassification()
  };
}

function writeReport(report) {
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
  fs.mkdirSync(path.dirname(DOC_PATH), { recursive: true });
  const lines = [
    "# Normalization and Canonical Keys",
    "",
    `Generated at: ${report.generated_at}`,
    "",
    "## Policy",
    "",
    "- Port-MIS / port_operation call_sign is the canonical call sign for current Korean port vessels.",
    "- Auxiliary sources must normalize their raw call sign and match canonical_call_sign before vessel-name matching.",
    "- PNC 모선코드 is terminal_vessel_code, not call_sign, unless it exactly matches canonical_call_sign.",
    "- Fuzzy vessel-name-only matches are review queue items, not auto-apply candidates.",
    "",
    "## Matching Hierarchy",
    "",
    ...report.canonical_policy.hierarchy.map((item, index) => `${index + 1}. ${item}`),
    "",
    "## Current Coverage",
    "",
    `- Core vessels: ${report.core_vessels.total}`,
    `- Core vessels with canonical_call_sign: ${report.core_vessels.with_canonical_call_sign}`,
    `- Auxiliary rows checked: ${report.auxiliary_sources.rows_checked}`,
    `- Auxiliary rows with normalized_call_sign: ${report.auxiliary_sources.rows_with_normalized_call_sign}`,
    `- Matches by canonical_call_sign evidence: ${report.auxiliary_sources.matches_by_canonical_call_sign}`,
    `- Duplicate call sign groups: ${report.core_vessels.duplicate_call_signs.length}`,
    "",
    "## Shared Module",
    "",
    `- ${report.shared_normalize_module}`,
    "",
    "## PNC",
    "",
    `- ${report.pnc.classification}`
  ];
  fs.writeFileSync(DOC_PATH, `${lines.join("\n")}\n`);
}

const report = buildReport();
writeReport(report);
console.log("Normalization & Canonical Key Audit");
console.log("===================================");
console.log(`shared_normalize_module: ${report.shared_normalize_module}`);
console.log(`core_vessels_with_canonical_call_sign: ${report.core_vessels.with_canonical_call_sign}/${report.core_vessels.total}`);
console.log(`aux_rows_with_normalized_call_sign: ${report.auxiliary_sources.rows_with_normalized_call_sign}/${report.auxiliary_sources.rows_checked}`);
console.log(`matches_by_canonical_call_sign: ${report.auxiliary_sources.matches_by_canonical_call_sign}`);
console.log(`duplicate_call_sign_groups: ${report.core_vessels.duplicate_call_signs.length}`);
console.log(`pnc_policy: ${report.pnc.policy}`);
console.log(`wrote: ${REPORT_PATH}`);
console.log(`wrote: ${DOC_PATH}`);
