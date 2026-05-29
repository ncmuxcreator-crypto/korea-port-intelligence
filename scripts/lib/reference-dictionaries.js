import fs from "node:fs";
import path from "node:path";

const REFERENCE_DIR = "data/reference";

function normalize(value) {
  return String(value || "")
    .normalize("NFKC")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9\uAC00-\uD7A3]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeCompact(value) {
  return String(value || "")
    .normalize("NFKC")
    .toUpperCase()
    .replace(/[^A-Z0-9\uAC00-\uD7A3]+/g, "");
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

function indexBy(rows, keys, normalizer = normalize) {
  const map = new Map();
  for (const row of rows) {
    for (const key of keys) {
      const value = normalizer(row[key]);
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
    record.laidupFcltyNm,
    record.facility_name_raw,
    record.facility_name_normalized,
    record.status
  ].filter(Boolean).join(" "));
  if (!text) return null;
  const patterns = [
    /\uBB18\uBC15/,
    /\uC815\uBC15/,
    /\uBC15\uC9C0/,
    /\uC678\uD56D/,
    /\uB0A8\uC678\uD56D/,
    /\uBD81\uC678\uD56D/,
    /\uB300\uAE30/,
    /\bANCH\b/,
    /\bANCHORAGE\b/,
    /\bO A\b/,
    /\bOA\b/,
    /\bOUTER\b/,
    /\bWAITING\b/
  ];
  if (!patterns.some(pattern => pattern.test(text))) return null;
  return {
    anchorage_name: record.anchorage_name || record.anchorage_zone || record.berth_name || record.berth || record.laidupFcltyNm || "Anchorage",
    anchorage_class: "anchorage_waiting",
    berth_class: "anchorage",
    is_anchorage_waiting: true
  };
}

function classifyBerth(record = {}) {
  const text = normalize([record.berth_name, record.berth, record.laidupFcltyNm, record.status].filter(Boolean).join(" "));
  if (!text) return null;
  if (/\uCEE8\uD14C\uC774\uB108|CONTAINER|PNC|HPNT|HJNC|BPT|KBCT/.test(text)) return "container_terminal";
  if (/\uC6D0\uC720|\uC720\uC870|\uC11D\uC720|\uCF00\uBBF8\uCEEC|DOLPHIN|OIL|TANK|LNG|LPG|BUOY/.test(text)) return "tanker_energy_berth";
  if (/\uBC8C\uD06C|\uC0B0\uBB3C|\uAD11\uC11D|BULK|COAL|ORE|CEMENT/.test(text)) return "bulk_berth";
  if (/\uC218\uB9AC|\uC870\uC120|DOCK|YARD|REPAIR/.test(text)) return "repair_yard";
  return null;
}

function normalizeVesselType(record = {}) {
  const text = normalize([record.vessel_type, record.vessel_type_group, record.vsslKndNm, record.vsslKndCd, record.commercial_segment].filter(Boolean).join(" "));
  if (!text) return null;
  const rules = [
    { vessel_type: "Bulk Carrier", vessel_type_group: "bulk_carrier", commercial_segment: "dry_bulk", commercial_fit_score: 5, target_eligibility: "target", biofouling_relevance: "high", pattern: /\uC0B0\uBB3C|\uBC8C\uD06C|BULK|BULKER|CAPE|CAPESIZE|ORE|\uAD11\uC11D/ },
    { vessel_type: "Tanker", vessel_type_group: "tanker", commercial_segment: "energy_tanker", commercial_fit_score: 5, target_eligibility: "target", biofouling_relevance: "high", pattern: /\uC6D0\uC720|\uC720\uC870|\uC11D\uC720|\uCF00\uBBF8\uCEEC|\uC81C\uD488|TANKER|VLCC|CRUDE|CHEMICAL|PRODUCT/ },
    { vessel_type: "PCTC", vessel_type_group: "pctc", commercial_segment: "vehicle_carrier", commercial_fit_score: 5, target_eligibility: "target", biofouling_relevance: "medium_high", pattern: /\uC790\uB3D9\uCC28|\uCC28\uB7C9|PCTC|PCC|CAR CARRIER|RO RO|RORO/ },
    { vessel_type: "Container Ship", vessel_type_group: "container", commercial_segment: "liner_container", commercial_fit_score: 4, target_eligibility: "target", biofouling_relevance: "medium_high", pattern: /\uCEE8\uD14C\uC774\uB108|CONTAINER/ },
    { vessel_type: "Gas Carrier", vessel_type_group: "lng_lpg", commercial_segment: "gas_carrier", commercial_fit_score: 4, target_eligibility: "target", biofouling_relevance: "medium_high", pattern: /LNG|LPG|\uAC00\uC2A4|GAS/ },
    { vessel_type: "Passenger/Cruise", vessel_type_group: "passenger", commercial_segment: "passenger_cruise", commercial_fit_score: 3, target_eligibility: "target", biofouling_relevance: "medium", pattern: /CRUISE|PASSENGER|\uC5EC\uAC1D|\uD06C\uB8E8\uC988/ },
    { vessel_type: record.vessel_type || "Non-commercial small craft", vessel_type_group: "excluded_small_craft", commercial_segment: "low_priority", commercial_fit_score: 0, target_eligibility: "excluded", biofouling_relevance: "low", pattern: /\uC5B4\uC120|\uC608\uC120|TUG|FISH|\uAD00\uACF5\uC120|\uC791\uC5C5\uC120|WORKBOAT|PATROL|\uC900\uC124|DREDGER/ }
  ];
  return rules.find(rule => rule.pattern.test(text)) || null;
}

function seedCandidates(record = {}) {
  return [
    normalize(record.imo),
    normalize(record.mmsi),
    normalize(record.call_sign),
    normalizeCompact(record.vessel_name),
    normalize(record.vessel_name)
  ].filter(Boolean);
}

export function loadReferenceDictionaries() {
  const ports = loadCsv("ports.csv");
  const portsRegistry = loadCsv("ports_registry.csv");
  const berths = loadCsv("berths.csv");
  const anchorages = loadCsv("anchorages.csv");
  const berthAliases = loadCsv("berth_aliases.csv");
  const terminalAliases = loadCsv("terminal_aliases.csv");
  const vesselTypes = loadCsv("vessel_types.csv");
  const operators = loadCsv("operators.csv");
  const agents = loadCsv("agents.csv");
  const agentOperatorMappings = loadCsv("agent_operator_mapping.csv");
  const vesselMasterSeed = loadCsv("vessel_master_seed.csv");
  return {
    loaded_at: new Date().toISOString(),
    ports,
    portsRegistry,
    berths,
    anchorages,
    berthAliases,
    terminalAliases,
    vesselTypes,
    operators,
    agents,
    agentOperatorMappings,
    vesselMasterSeed,
    indexes: {
      ports: indexBy([...ports, ...portsRegistry], ["port_code", "prtAgCd", "port_name", "port_name_ko", "port_name_en", "alias", "sub_port"]),
      berths: indexBy([...berths, ...berthAliases, ...terminalAliases], ["berth_name", "terminal_name", "alias", "normalized_alias"]),
      anchorages: indexBy(anchorages, ["anchorage_name", "alias"]),
      berthAliases: indexBy(berthAliases, ["alias", "normalized_alias", "berth_name"]),
      terminalAliases: indexBy(terminalAliases, ["alias", "normalized_alias", "terminal_name", "berth_name"]),
      vesselTypes: indexBy(vesselTypes, ["vessel_type", "alias"]),
      operators: indexBy(operators, ["operator", "alias"]),
      agents: indexBy(agents, ["agent", "alias"]),
      agentOperatorMappings: indexBy(agentOperatorMappings, ["agent", "agent_normalized", "alias"]),
      vesselMasterSeed: new Map([
        ...indexBy(vesselMasterSeed, ["imo", "mmsi", "call_sign"], normalize),
        ...indexBy(vesselMasterSeed, ["vessel_name", "normalized_name", "canonical_name", "alias"], normalizeCompact)
      ])
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

    const berthRef = indexes.berths?.get(normalize(record.berth_name || record.berth || record.terminal_name || record.laidupFcltyNm));
    if (berthRef) {
      enriched.berth_name = berthRef.berth_name || berthRef.terminal_name || enriched.berth_name || enriched.berth;
      enriched.terminal_name = berthRef.terminal_name || enriched.terminal_name;
      enriched.berth_class = berthRef.berth_class || enriched.berth_class;
      enriched.berth_classification_source = "dictionary";
      enriched.berth_alias_match = true;
    }

    const anchorageRef = indexes.anchorages?.get(normalize(record.anchorage_name || record.anchorage_zone || record.berth_name || record.berth || record.laidupFcltyNm));
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

    const typeRef = indexes.vesselTypes?.get(normalize(record.vessel_type)) || indexes.vesselTypes?.get(normalize(record.vsslKndNm)) || indexes.vesselTypes?.get(normalize(record.vsslKndCd));
    if (typeRef) {
      enriched.vessel_type = typeRef.vessel_type || enriched.vessel_type;
      enriched.vessel_type_group = typeRef.vessel_type_group || enriched.vessel_type_group;
      enriched.commercial_segment = typeRef.commercial_segment || enriched.commercial_segment;
      enriched.commercial_fit_score = Number(typeRef.commercial_fit_score || enriched.commercial_fit_score || 0);
      enriched.target_eligibility = typeRef.target_eligibility || enriched.target_eligibility;
      enriched.biofouling_relevance = typeRef.biofouling_relevance || enriched.biofouling_relevance;
      enriched.vessel_type_normalization_source = "dictionary";
    }

    const typePattern = normalizeVesselType(enriched);
    if (typePattern && (!enriched.vessel_type_group || enriched.vessel_type_group === "unknown")) {
      enriched.vessel_type = typePattern.vessel_type || enriched.vessel_type;
      enriched.vessel_type_group = typePattern.vessel_type_group;
      enriched.commercial_segment = typePattern.commercial_segment || enriched.commercial_segment;
      enriched.commercial_fit_score = Number(typePattern.commercial_fit_score || enriched.commercial_fit_score || 0);
      enriched.target_eligibility = typePattern.target_eligibility || enriched.target_eligibility;
      enriched.biofouling_relevance = typePattern.biofouling_relevance || enriched.biofouling_relevance;
      enriched.vessel_type_normalization_source = "pattern";
    }

    const operatorRef = indexes.operators?.get(normalize(record.operator || record.operator_name));
    if (operatorRef) {
      enriched.operator = operatorRef.operator || enriched.operator || enriched.operator_name;
      enriched.operator_name = enriched.operator;
      enriched.operator_normalized = operatorRef.operator_normalized || normalize(enriched.operator);
      enriched.operator_source = enriched.operator_source || "operator_dictionary";
      enriched.operator_confidence = Math.max(Number(enriched.operator_confidence || 0), 90);
      enriched.operator_inferred = false;
    }

    const agentRef = indexes.agents?.get(normalize(record.agent || record.agent_name || record.satmntEntrpsNm || record.entrpsCdNm));
    if (agentRef) {
      enriched.agent = agentRef.agent || enriched.agent || enriched.agent_name || enriched.satmntEntrpsNm || enriched.entrpsCdNm;
      enriched.agent_name = enriched.agent;
      enriched.agent_normalized = agentRef.agent_normalized || normalize(enriched.agent);
      enriched.agent_source = enriched.agent_source || "agent_dictionary";
    }

    const agentOperatorRef = indexes.agentOperatorMappings?.get(normalize(enriched.agent || enriched.agent_name || record.satmntEntrpsNm || record.entrpsCdNm));
    if (!enriched.operator && agentOperatorRef?.operator) {
      enriched.operator = agentOperatorRef.operator;
      enriched.operator_name = agentOperatorRef.operator;
      enriched.operator_normalized = agentOperatorRef.operator_normalized || normalize(agentOperatorRef.operator);
      enriched.operator_source = "agent_dictionary";
      enriched.operator_confidence = Math.max(Number(enriched.operator_confidence || 0), Number(agentOperatorRef.confidence || 65));
      enriched.operator_inferred = true;
    }

    const seedRef = seedCandidates(record).map(key => indexes.vesselMasterSeed?.get(key)).find(Boolean);
    if (seedRef) {
      enriched.imo = enriched.imo || seedRef.imo;
      enriched.mmsi = enriched.mmsi || seedRef.mmsi;
      enriched.call_sign = enriched.call_sign || seedRef.call_sign;
      enriched.vessel_name = enriched.vessel_name || seedRef.vessel_name || seedRef.canonical_name;
      enriched.normalized_vessel_name = enriched.normalized_vessel_name || seedRef.normalized_name || normalizeCompact(enriched.vessel_name);
      enriched.vessel_type = enriched.vessel_type || seedRef.vessel_type;
      enriched.gt = enriched.gt || Number(seedRef.gt || 0);
      enriched.operator = enriched.operator || seedRef.operator;
      enriched.operator_name = enriched.operator_name || enriched.operator;
      enriched.operator_normalized = enriched.operator_normalized || seedRef.operator_normalized || (enriched.operator ? normalize(enriched.operator) : "");
      enriched.manager_name = enriched.manager_name || seedRef.manager_name;
      enriched.owner_name = enriched.owner_name || seedRef.owner_name;
      if (seedRef.operator) {
        enriched.operator_source = enriched.operator_source || "vessel_master_seed";
        enriched.operator_confidence = Math.max(Number(enriched.operator_confidence || 0), 82);
        enriched.operator_inferred = !record.operator;
      }
      enriched.vessel_master_seed_match = true;
      enriched.imo_recovered_from_seed = Boolean(!record.imo && seedRef.imo);
      enriched.imo_recovery_source = "vessel_master_seed";
    }

    enriched.reference_enriched = Boolean(portRef || berthRef || anchorageRef || anchoragePattern || berthClass || typeRef || typePattern || operatorRef || agentRef || agentOperatorRef || seedRef);
    return enriched;
  });
}
