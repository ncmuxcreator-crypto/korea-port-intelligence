const SECRET_CATALOG = [
  {
    key: "supabase",
    label: "Supabase Database",
    type: "database",
    required: ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"],
    optional: ["SUPABASE_ANON_KEY"],
    use: "Store vessel snapshots, pipeline reports, dashboard history, and future lead intelligence tables."
  },
  {
    key: "vessel_spec",
    label: "MOF Vessel Specification",
    type: "vessel_master",
    required: ["VESSEL_SPEC_SERVICE_KEY"],
    optional: ["VESSEL_SPEC_API_URL"],
    use: "Vessel particulars, IMO/MMSI enrichment, ship type, size class, and sales segmentation."
  },
  {
    key: "pilot_sources",
    label: "Pilot Schedule Sources",
    type: "pilotage",
    requiredAny: ["PILOT_SOURCE_URLS"],
    optional: [],
    use: "Pilotage schedule URLs used for port-call and movement confirmation where allowed."
  },
  {
    key: "berth_sources",
    label: "Berth Schedule Sources",
    type: "berth",
    requiredAny: ["BERTH_SOURCE_URLS"],
    optional: ["PNC_SOURCE_URLS"],
    use: "Public berth/source URLs used for berth assignment, waiting vessels, and terminal watch."
  },
  {
    key: "port_facility",
    label: "Port Facility API",
    type: "port_master",
    required: ["PORT_FACILITY_SERVICE_KEY"],
    optional: ["PORT_FACILITY_API_URL"],
    use: "Port/berth/facility master data for Korean port intelligence normalization."
  },
  {
    key: "port_operation",
    label: "Port Operation API",
    type: "port_operation",
    required: ["PORT_OPERATION_SERVICE_KEY"],
    optional: ["PORT_OPERATION_API_URL"],
    use: "Arrival/departure, port operation, and vessel movement enrichment."
  },
  {
    key: "ulsan_core",
    label: "Ulsan Port Core API",
    type: "ulsan",
    requiredAny: ["ULSAN_API_KEY", "ULSAN_BERTH_DETAIL_API_KEY", "ULSAN_CARGO_PLAN_API_KEY", "ULSAN_BERTH_OPERATION_API_KEY", "ULSAN_TERMINAL_PROCESS_API_KEY"],
    optional: ["ULSAN_API_URL", "ULSAN_BERTH_DETAIL_API_URL", "ULSAN_CARGO_PLAN_API_URL", "ULSAN_BERTH_OPERATION_API_URL", "ULSAN_TERMINAL_PROCESS_API_URL"],
    use: "Ulsan berth detail, cargo plan, berth operation, and terminal process feeds."
  },
  {
    key: "mof_vts",
    label: "MOF VTS API",
    type: "vts",
    required: ["MOF_VTS_SERVICE_KEY"],
    optional: ["MOF_VTS_API_BASE", "MOF_VTS_PORT_CODES"],
    use: "VTS-based port movement and port-code scoped vessel traffic monitoring."
  },
  {
    key: "mof_ais_dynamic",
    label: "MOF AIS Dynamic API",
    type: "ais",
    required: ["MOF_AIS_DYNAMIC_SERVICE_KEY"],
    optional: ["MOF_AIS_DYNAMIC_API_URL", "MOF_AIS_DYNAMIC_PER_PAGE"],
    use: "Dynamic AIS position, speed, heading, and recent vessel movement snapshots."
  },
  {
    key: "mof_ais_info",
    label: "MOF AIS Vessel Info API",
    type: "ais_master",
    required: ["MOF_AIS_INFO_SERVICE_KEY"],
    optional: ["MOF_AIS_INFO_API_URL", "MOF_AIS_INFO_PER_PAGE"],
    use: "AIS vessel info enrichment including vessel identity and static particulars."
  },
  {
    key: "mof_ais_stat",
    label: "MOF AIS Statistics API",
    type: "ais_stats",
    required: ["MOF_AIS_STAT_SERVICE_KEY"],
    optional: ["MOF_AIS_STAT_API_URL", "MOF_AIS_STAT_PER_PAGE"],
    use: "AIS traffic statistics for congestion baselines and port trend reporting."
  },
  {
    key: "marine_traffic",
    label: "MarineTraffic AIS",
    type: "ais_external",
    requiredAny: ["MARINETRAFFIC_API_KEY", "MARINE_TRAFFIC_API_KEY", "MT_API_KEY"],
    optional: ["MARINETRAFFIC_BASE_URL"],
    use: "Optional external AIS fallback for live vessel position, ETA, speed, and port call data."
  },
  {
    key: "vesselfinder",
    label: "VesselFinder AIS",
    type: "ais_external",
    requiredAny: ["VESSELFINDER_API_KEY", "VESSEL_FINDER_API_KEY"],
    optional: ["VESSELFINDER_BASE_URL"],
    use: "Optional secondary AIS feed for vessel movement and berth/anchorage watch."
  },
  {
    key: "aisstream",
    label: "AISStream",
    type: "ais_stream",
    requiredAny: ["AISSTREAM_API_KEY", "AIS_STREAM_API_KEY"],
    optional: [],
    use: "Streaming AIS signal when the project moves from snapshot mode to live monitoring."
  },
  {
    key: "openweather",
    label: "OpenWeather",
    type: "weather",
    requiredAny: ["OPENWEATHER_API_KEY", "OPEN_WEATHER_API_KEY"],
    optional: [],
    use: "Weather and sea-condition context for biofouling and operation risk scoring."
  },
  {
    key: "google_maps",
    label: "Google Maps / Geocoding",
    type: "geo",
    requiredAny: ["GOOGLE_MAPS_API_KEY", "GOOGLE_API_KEY"],
    optional: [],
    use: "Port coordinates, map layers, geocoding, and dashboard routing enhancements."
  },
  {
    key: "korea_public_data",
    label: "Korea Public Data Fallback",
    type: "public_data",
    requiredAny: ["PORTMIS_API_KEY", "PORT_MIS_API_KEY", "DATA_GO_KR_API_KEY", "SERVICE_KEY"],
    optional: ["KOREA_PORTMIS_BASE_URL"],
    use: "Generic Korean public-data fallback when source-specific keys are not configured."
  },
  {
    key: "email_alerts",
    label: "Email Alerts",
    type: "alert",
    requiredAny: ["RESEND_API_KEY", "SENDGRID_API_KEY"],
    optional: ["ALERT_TO_EMAIL", "ALERT_FROM_EMAIL"],
    use: "Daily high-risk vessel alerts and sales action summaries."
  },
  {
    key: "vercel",
    label: "Vercel Deployment",
    type: "hosting",
    required: ["VERCEL_TOKEN", "VERCEL_ORG_ID", "VERCEL_PROJECT_ID"],
    optional: [],
    use: "Automated production deployment from GitHub Actions."
  },
  {
    key: "google_drive",
    label: "Google Drive Archive",
    type: "archive",
    requiredAny: ["GDRIVE_SERVICE_ACCOUNT_JSON", "GOOGLE_SERVICE_ACCOUNT_JSON"],
    optional: ["GDRIVE_FOLDER_ID", "GOOGLE_DRIVE_FOLDER_ID", "ARCHIVE_TO_DRIVE"],
    use: "Archive daily reports and raw data exports outside the repository."
  }
];

function present(name) {
  return Boolean(process.env[name] && String(process.env[name]).trim());
}

function mask(name) {
  const value = process.env[name];
  if (!value) return null;
  const text = String(value);
  if (text.length <= 8) return "configured";
  return `${text.slice(0, 3)}***${text.slice(-3)}`;
}

export function detectSecrets() {
  return SECRET_CATALOG.map(source => {
    const required = source.required || [];
    const requiredAny = source.requiredAny || [];
    const optional = source.optional || [];
    const requiredPresent = required.filter(present);
    const anyPresent = requiredAny.filter(present);
    const optionalPresent = optional.filter(present);
    const enabled = required.length ? requiredPresent.length === required.length : requiredAny.length ? anyPresent.length > 0 : false;
    const partial = !enabled && (requiredPresent.length > 0 || anyPresent.length > 0 || optionalPresent.length > 0);
    const selectedSecrets = [...requiredPresent, ...anyPresent, ...optionalPresent];
    const missing = required.length ? required.filter(k => !present(k)) : requiredAny.length && !anyPresent.length ? requiredAny : [];

    return {
      key: source.key,
      label: source.label,
      type: source.type,
      enabled,
      partial,
      status: enabled ? "enabled" : partial ? "partial" : "not_configured",
      using: selectedSecrets,
      masked: Object.fromEntries(selectedSecrets.map(k => [k, mask(k)])),
      missing,
      use: source.use
    };
  });
}

export function enabledSecretKeys() {
  return detectSecrets().filter(s => s.enabled).map(s => s.key);
}

export function secretCatalog() {
  return SECRET_CATALOG;
}
