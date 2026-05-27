import fs from "node:fs";
import path from "node:path";

const REFERENCE_DIR = "data/reference";

function normalize(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9가-힣]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseCsv(text) {
  const lines = String(text || "").replace(/^\uFEFF/, "").split(/\r?\n/).filter(line => line.trim());
  if (lines.length < 2) return [];
  const parseLine = line => {
    const cells = [];
    let current = "";
    let quoted = false;
    for (let index = 0; index < line.length; index += 1) {
      const char = line[index];
      const next = line[index + 1];
      if (char === '"' && quoted && next === '"') {
        current += '"';
        index += 1;
      } else if (char === '"') {
        quoted = !quoted;
      } else if (char === "," && !quoted) {
        cells.push(current.trim());
        current = "";
      } else {
        current += char;
      }
    }
    cells.push(current.trim());
    return cells;
  };
  const headers = parseLine(lines[0]);
  return lines.slice(1).map(line => {
    const values = parseLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, values[index] || ""]));
  });
}

function loadCsv(name) {
  const file = path.join(REFERENCE_DIR, name);
  if (!fs.existsSync(file)) return [];
  return parseCsv(fs.readFileSync(file, "utf8"));
}

function indexBy(rows, keys) {
  const map = new Map();
  for (const row of rows) {
    for (const key of keys) {
      const value = normalize(row[key]);
      if (value) map.set(value, row);
    }
  }
  return map;
}

function classifyAnchorage(record = {}) {
  const text = normalize([
    record.berth_name,
    record.berth,
    record.anchorage_name,
    record.anchorage_zone,
    record.status
  ].filter(Boolean).join(" "));
  if (!text) return null;
  const patterns = [
    /묘박/,
    /정박/,
    /박지/,
    /외항/,
    /남외항/,
    /북외항/,
    /\bANCH\b/,
    /\bANCHORAGE\b/,
    /\bO A\b/,
    /\bOA\b/,
    /\bOUTER\b/,
    /\bWAITING\b/
  ];
  if (!patterns.some(pattern => pattern.test(text))) return null;
  return {
    anchorage_name: record.anchorage_name || record.anchorage_zone || record.berth_name || record.berth || "Anchorage",
    anchorage_class: "anchorage_waiting",
    berth_class: "anchorage",
    is_anchorage_waiting: true
  };
}

function classifyBerth(record = {}) {
  const text = normalize([record.berth_name, record.berth, record.status].filter(Boolean).join(" "));
  if (!text) return null;
  if (/컨테이너|CONTAINER|PNC|HPNT|HJNC|BPT|KBCT/.test(text)) return "container_terminal";
  if (/원유|유류|돌핀|DOLPHIN|OIL|TANK|LNG|LPG|부이|BUOY/.test(text)) return "tanker_energy_berth";
  if (/벌크|석탄|광석|시멘트|BULK|COAL|ORE|CEMENT/.test(text)) return "bulk_berth";
  if (/수리|조선|DOCK|YARD|REPAIR/.test(text)) return "repair_yard";
  return null;
}

function normalizeVesselType(record = {}) {
  const text = normalize([record.vessel_type, record.vessel_type_group].filter(Boolean).join(" "));
  if (!text) return null;
  const rules = [
    { vessel_type: "Bulk Carrier", vessel_type_group: "bulk_carrier", pattern: /산물|벌크|BULK|BULKER|CAPE|CAPESIZE|ORE|광석/ },
    { vessel_type: "Tanker", vessel_type_group: "tanker", pattern: /원유|유조|석유|케미컬|제품|TANKER|VLCC|CRUDE|CHEMICAL|PRODUCT/ },
    { vessel_type: "PCTC", vessel_type_group: "pctc", pattern: /자동차|차량|PCTC|PCC|CAR CARRIER|RO RO|RORO/ },
    { vessel_type: "Container Ship", vessel_type_group: "container", pattern: /컨테이너|CONTAINER/ },
    { vessel_type: "Gas Carrier", vessel_type_group: "lng_lpg", pattern: /LNG|LPG|가스|GAS/ },
    { vessel_type: "Passenger/Cruise", vessel_type_group: "passenger", pattern: /CRUISE|PASSENGER|여객|크루즈/ },
    { vessel_type: record.vessel_type || "Non-commercial small craft", vessel_type_group: "excluded_small_craft", pattern: /어선|예선|TUG|FISH|관공선|작업선|WORKBOAT|PATROL|준설|DREDGER/ }
  ];
  return rules.find(rule => rule.pattern.test(text)) || null;
}

export function loadReferenceDictionaries() {
  const ports = loadCsv("ports.csv");
  const berths = loadCsv("berths.csv");
  const anchorages = loadCsv("anchorages.csv");
  const vesselTypes = loadCsv("vessel_types.csv");
  const operators = loadCsv("operators.csv");
  const agents = loadCsv("agents.csv");
  const vesselMasterSeed = loadCsv("vessel_master_seed.csv");
  return {
    loaded_at: new Date().toISOString(),
    ports,
    berths,
    anchorages,
    vesselTypes,
    operators,
    agents,
    vesselMasterSeed,
    indexes: {
      ports: indexBy(ports, ["port_code", "port_name", "alias"]),
      berths: indexBy(berths, ["berth_name", "alias"]),
      anchorages: indexBy(anchorages, ["anchorage_name", "alias"]),
      vesselTypes: indexBy(vesselTypes, ["vessel_type", "alias"]),
      operators: indexBy(operators, ["operator", "alias"]),
      agents: indexBy(agents, ["agent", "alias"]),
      vesselMasterSeed: indexBy(vesselMasterSeed, ["imo", "mmsi", "call_sign", "canonical_name", "alias"])
    }
  };
}

export function enrichWithReferenceDictionaries(records = [], dictionaries = loadReferenceDictionaries()) {
  const indexes = dictionaries.indexes || {};
  return records.map(record => {
    const enriched = { ...record };
    const portRef = indexes.ports?.get(normalize(record.port_code)) || indexes.ports?.get(normalize(record.port_name || record.port));
    if (portRef) {
      enriched.port_code = enriched.port_code || portRef.port_code;
      enriched.port_name = portRef.port_name || enriched.port_name || enriched.port;
      enriched.port = enriched.port_name;
    }

    const berthRef = indexes.berths?.get(normalize(record.berth_name || record.berth));
    if (berthRef) {
      enriched.berth_name = berthRef.berth_name || enriched.berth_name || enriched.berth;
      enriched.berth_class = berthRef.berth_class || enriched.berth_class;
      enriched.berth_classification_source = "dictionary";
    }

    const anchorageRef = indexes.anchorages?.get(normalize(record.anchorage_name || record.anchorage_zone || record.berth_name || record.berth));
    if (anchorageRef) {
      enriched.anchorage_name = anchorageRef.anchorage_name || enriched.anchorage_name || enriched.anchorage_zone;
      enriched.anchorage_class = anchorageRef.anchorage_class || "anchorage_waiting";
      enriched.is_anchorage_waiting = true;
      enriched.berth_class = enriched.berth_class || "anchorage";
      enriched.anchorage_classification_source = "dictionary";
    }

    const anchoragePattern = classifyAnchorage(enriched);
    if (anchoragePattern) {
      enriched.anchorage_name = anchoragePattern.anchorage_name;
      enriched.anchorage_class = anchoragePattern.anchorage_class;
      enriched.is_anchorage_waiting = true;
      enriched.berth_class = anchoragePattern.berth_class;
      enriched.anchorage_classification_source = enriched.anchorage_classification_source || "pattern";
    }

    const berthClass = classifyBerth(enriched);
    if (berthClass && !enriched.berth_class) {
      enriched.berth_class = berthClass;
      enriched.berth_classification_source = "pattern";
    }

    const typeRef = indexes.vesselTypes?.get(normalize(record.vessel_type));
    if (typeRef) {
      enriched.vessel_type = typeRef.vessel_type || enriched.vessel_type;
      enriched.vessel_type_group = typeRef.vessel_type_group || enriched.vessel_type_group;
      enriched.vessel_type_normalization_source = "dictionary";
    }

    const typePattern = normalizeVesselType(enriched);
    if (typePattern && (!enriched.vessel_type_group || enriched.vessel_type_group === "unknown")) {
      enriched.vessel_type = typePattern.vessel_type || enriched.vessel_type;
      enriched.vessel_type_group = typePattern.vessel_type_group;
      enriched.vessel_type_normalization_source = "pattern";
    }

    const operatorRef = indexes.operators?.get(normalize(record.operator));
    if (operatorRef) {
      enriched.operator = operatorRef.operator || enriched.operator;
      enriched.operator_normalized = operatorRef.operator_normalized || normalize(enriched.operator);
    }

    const agentRef = indexes.agents?.get(normalize(record.agent));
    if (agentRef) {
      enriched.agent = agentRef.agent || enriched.agent;
      enriched.agent_normalized = agentRef.agent_normalized || normalize(enriched.agent);
    }

    const seedRef = indexes.vesselMasterSeed?.get(normalize(record.imo)) ||
      indexes.vesselMasterSeed?.get(normalize(record.mmsi)) ||
      indexes.vesselMasterSeed?.get(normalize(record.call_sign)) ||
      indexes.vesselMasterSeed?.get(normalize(record.vessel_name));
    if (seedRef) {
      enriched.imo = enriched.imo || seedRef.imo;
      enriched.mmsi = enriched.mmsi || seedRef.mmsi;
      enriched.call_sign = enriched.call_sign || seedRef.call_sign;
      enriched.gt = enriched.gt || Number(seedRef.gt || 0);
      enriched.operator = enriched.operator || seedRef.operator;
      enriched.vessel_master_seed_match = true;
    }

    enriched.reference_enriched = Boolean(portRef || berthRef || anchorageRef || anchoragePattern || berthClass || typeRef || typePattern || operatorRef || agentRef || seedRef);
    return enriched;
  });
}
