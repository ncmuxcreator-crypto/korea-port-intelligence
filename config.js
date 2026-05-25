{
  "version": "15.9.0",
  "build_name": "Collector Manifest + Source Registry",
  "status": "success",
  "started_at": "2026-05-25T00:03:30.268Z",
  "completed_at": "2026-05-25T00:03:30.269Z",
  "record_count": 3,
  "critical_count": 2,
  "high_risk_count": 2,
  "compliance_watch_count": 2,
  "opportunity_usd": 90480,
  "ports": [
    "Busan",
    "Yeosu",
    "Ulsan"
  ],
  "port_summary": [
    {
      "port": "Busan",
      "total": 1,
      "critical": 1,
      "high_risk": 1,
      "avg_risk": 95,
      "waiting": 1,
      "at_berth": 0,
      "opportunity_usd": 42000
    },
    {
      "port": "Yeosu",
      "total": 1,
      "critical": 1,
      "high_risk": 1,
      "avg_risk": 90,
      "waiting": 1,
      "at_berth": 0,
      "opportunity_usd": 42000
    },
    {
      "port": "Ulsan",
      "total": 1,
      "critical": 0,
      "high_risk": 0,
      "avg_risk": 35,
      "waiting": 0,
      "at_berth": 1,
      "opportunity_usd": 6480
    }
  ],
  "supabase_status": "not_configured",
  "refresh_interval_seconds": 30,
  "data_mode": "sample_only",
  "data_mode_detail": {
    "mode": "sample_only",
    "label": "SAMPLE DATA",
    "live_ready": false,
    "sample_rows": 3,
    "real_rows": 0,
    "enabled_source_groups": [],
    "supabase_status": "not_configured",
    "message": "Dashboard is render-ready but currently using sample vessels. Connect public/API collectors to replace sample rows.",
    "weight_policy": {
      "current_track": "lightweight_static_first",
      "keep_repository_light": [
        "Do not commit node_modules",
        "Do not commit heavy raw archives",
        "Keep daily JSON snapshots small",
        "Archive bulky raw data to Google Drive/Supabase"
      ],
      "next_build_focus": [
        "collector normalization",
        "public API smoke tests",
        "Supabase history accumulation"
      ]
    }
  },
  "api_sources": [
    {
      "key": "supabase",
      "label": "Supabase Database",
      "type": "database",
      "enabled": false,
      "partial": false,
      "status": "not_configured",
      "using": [],
      "masked": {},
      "missing": [
        "SUPABASE_URL",
        "SUPABASE_SERVICE_ROLE_KEY"
      ],
      "use": "Store vessel snapshots, pipeline reports, dashboard history, and future lead intelligence tables."
    },
    {
      "key": "vessel_spec",
      "label": "MOF Vessel Specification",
      "type": "vessel_master",
      "enabled": false,
      "partial": false,
      "status": "not_configured",
      "using": [],
      "masked": {},
      "missing": [
        "VESSEL_SPEC_SERVICE_KEY"
      ],
      "use": "Vessel particulars, IMO/MMSI enrichment, ship type, size class, and sales segmentation."
    },
    {
      "key": "pilot_sources",
      "label": "Pilot Schedule Sources",
      "type": "pilotage",
      "enabled": false,
      "partial": false,
      "status": "not_configured",
      "using": [],
      "masked": {},
      "missing": [
        "PILOT_SOURCE_URLS"
      ],
      "use": "Pilotage schedule URLs used for port-call and movement confirmation where allowed."
    },
    {
      "key": "berth_sources",
      "label": "Berth Schedule Sources",
      "type": "berth",
      "enabled": false,
      "partial": false,
      "status": "not_configured",
      "using": [],
      "masked": {},
      "missing": [
        "BERTH_SOURCE_URLS"
      ],
      "use": "Public berth/source URLs used for berth assignment, waiting vessels, and terminal watch."
    },
    {
      "key": "port_facility",
      "label": "Port Facility API",
      "type": "port_master",
      "enabled": false,
      "partial": false,
      "status": "not_configured",
      "using": [],
      "masked": {},
      "missing": [
        "PORT_FACILITY_SERVICE_KEY"
      ],
      "use": "Port/berth/facility master data for Korean port intelligence normalization."
    },
    {
      "key": "port_operation",
      "label": "Port Operation API",
      "type": "port_operation",
      "enabled": false,
      "partial": false,
      "status": "not_configured",
      "using": [],
      "masked": {},
      "missing": [
        "PORT_OPERATION_SERVICE_KEY"
      ],
      "use": "Arrival/departure, port operation, and vessel movement enrichment."
    },
    {
      "key": "ulsan_core",
      "label": "Ulsan Port Core API",
      "type": "ulsan",
      "enabled": false,
      "partial": false,
      "status": "not_configured",
      "using": [],
      "masked": {},
      "missing": [
        "ULSAN_API_KEY",
        "ULSAN_BERTH_DETAIL_API_KEY",
        "ULSAN_CARGO_PLAN_API_KEY",
        "ULSAN_BERTH_OPERATION_API_KEY",
        "ULSAN_TERMINAL_PROCESS_API_KEY"
      ],
      "use": "Ulsan berth detail, cargo plan, berth operation, and terminal process feeds."
    },
    {
      "key": "ygpa_core",
      "label": "YGPA / Yeosu-Gwangyang API",
      "type": "ygpa",
      "enabled": false,
      "partial": false,
      "status": "not_configured",
      "using": [],
      "masked": {},
      "missing": [
        "YGPA_SERVICE_KEY",
        "YGPA_ARRIVAL_API_KEY",
        "YGPA_DEPARTURE_API_KEY",
        "YGPA_VTS_API_KEY"
      ],
      "use": "Yeosu/Gwangyang arrival, departure, VTS, and anchorage intelligence."
    },
    {
      "key": "mof_vts",
      "label": "MOF VTS API",
      "type": "vts",
      "enabled": false,
      "partial": false,
      "status": "not_configured",
      "using": [],
      "masked": {},
      "missing": [
        "MOF_VTS_SERVICE_KEY"
      ],
      "use": "VTS-based port movement and port-code scoped vessel traffic monitoring."
    },
    {
      "key": "mof_ais_dynamic",
      "label": "MOF AIS Dynamic API",
      "type": "ais",
      "enabled": false,
      "partial": false,
      "status": "not_configured",
      "using": [],
      "masked": {},
      "missing": [
        "MOF_AIS_DYNAMIC_SERVICE_KEY"
      ],
      "use": "Dynamic AIS position, speed, heading, and recent vessel movement snapshots."
    },
    {
      "key": "mof_ais_info",
      "label": "MOF AIS Vessel Info API",
      "type": "ais_master",
      "enabled": false,
      "partial": false,
      "status": "not_configured",
      "using": [],
      "masked": {},
      "missing": [
        "MOF_AIS_INFO_SERVICE_KEY"
      ],
      "use": "AIS vessel info enrichment including vessel identity and static particulars."
    },
    {
      "key": "mof_ais_stat",
      "label": "MOF AIS Statistics API",
      "type": "ais_stats",
      "enabled": false,
      "partial": false,
      "status": "not_configured",
      "using": [],
      "masked": {},
      "missing": [
        "MOF_AIS_STAT_SERVICE_KEY"
      ],
      "use": "AIS traffic statistics for congestion baselines and port trend reporting."
    },
    {
      "key": "marine_traffic",
      "label": "MarineTraffic AIS",
      "type": "ais_external",
      "enabled": false,
      "partial": false,
      "status": "not_configured",
      "using": [],
      "masked": {},
      "missing": [
        "MARINETRAFFIC_API_KEY",
        "MARINE_TRAFFIC_API_KEY",
        "MT_API_KEY"
      ],
      "use": "Optional external AIS fallback for live vessel position, ETA, speed, and port call data."
    },
    {
      "key": "vesselfinder",
      "label": "VesselFinder AIS",
      "type": "ais_external",
      "enabled": false,
      "partial": false,
      "status": "not_configured",
      "using": [],
      "masked": {},
      "missing": [
        "VESSELFINDER_API_KEY",
        "VESSEL_FINDER_API_KEY"
      ],
      "use": "Optional secondary AIS feed for vessel movement and berth/anchorage watch."
    },
    {
      "key": "aisstream",
      "label": "AISStream",
      "type": "ais_stream",
      "enabled": false,
      "partial": false,
      "status": "not_configured",
      "using": [],
      "masked": {},
      "missing": [
        "AISSTREAM_API_KEY",
        "AIS_STREAM_API_KEY"
      ],
      "use": "Streaming AIS signal when the project moves from snapshot mode to live monitoring."
    },
    {
      "key": "openweather",
      "label": "OpenWeather",
      "type": "weather",
      "enabled": false,
      "partial": false,
      "status": "not_configured",
      "using": [],
      "masked": {},
      "missing": [
        "OPENWEATHER_API_KEY",
        "OPEN_WEATHER_API_KEY"
      ],
      "use": "Weather and sea-condition context for biofouling and operation risk scoring."
    },
    {
      "key": "google_maps",
      "label": "Google Maps / Geocoding",
      "type": "geo",
      "enabled": false,
      "partial": false,
      "status": "not_configured",
      "using": [],
      "masked": {},
      "missing": [
        "GOOGLE_MAPS_API_KEY",
        "GOOGLE_API_KEY"
      ],
      "use": "Port coordinates, map layers, geocoding, and dashboard routing enhancements."
    },
    {
      "key": "korea_public_data",
      "label": "Korea Public Data Fallback",
      "type": "public_data",
      "enabled": false,
      "partial": false,
      "status": "not_configured",
      "using": [],
      "masked": {},
      "missing": [
        "PORTMIS_API_KEY",
        "PORT_MIS_API_KEY",
        "DATA_GO_KR_API_KEY",
        "SERVICE_KEY"
      ],
      "use": "Generic Korean public-data fallback when source-specific keys are not configured."
    },
    {
      "key": "email_alerts",
      "label": "Email Alerts",
      "type": "alert",
      "enabled": false,
      "partial": false,
      "status": "not_configured",
      "using": [],
      "masked": {},
      "missing": [
        "RESEND_API_KEY",
        "SENDGRID_API_KEY"
      ],
      "use": "Daily high-risk vessel alerts and sales action summaries."
    },
    {
      "key": "vercel",
      "label": "Vercel Deployment",
      "type": "hosting",
      "enabled": false,
      "partial": false,
      "status": "not_configured",
      "using": [],
      "masked": {},
      "missing": [
        "VERCEL_TOKEN",
        "VERCEL_ORG_ID",
        "VERCEL_PROJECT_ID"
      ],
      "use": "Automated production deployment from GitHub Actions."
    },
    {
      "key": "google_drive",
      "label": "Google Drive Archive",
      "type": "archive",
      "enabled": false,
      "partial": false,
      "status": "not_configured",
      "using": [],
      "masked": {},
      "missing": [
        "GDRIVE_SERVICE_ACCOUNT_JSON",
        "GOOGLE_SERVICE_ACCOUNT_JSON"
      ],
      "use": "Archive daily reports and raw data exports outside the repository."
    }
  ],
  "api_registry_version": "korea-port-secret-registry-v6-source-manifest",
  "data_strategy": {
    "mode": "public_data_first",
    "principle": "Use Korean public/port/MOF sources as the operating base. Treat MarineTraffic/VesselFinder/AISStream as optional paid enrichment, not a blocker.",
    "public_enabled_count": 0,
    "paid_enabled_count": 0,
    "public_enabled": [],
    "paid_enabled": [],
    "next_focus": [
      "Normalize vessel identity across port, berth, VTS and AIS feeds",
      "Accumulate daily snapshots in Supabase for idle-time and port-stay history",
      "Keep paid AIS integrations disabled unless a customer requires global real-time coverage"
    ]
  },
  "data_quality": {
    "score": 80,
    "grade": "Watch",
    "record_count": 3,
    "enabled_source_groups": 0,
    "completeness_percent": 100,
    "risk_coverage_percent": 100,
    "source_coverage_percent": 0,
    "duplicate_count": 0,
    "missing_fields": {
      "vessel_name": 0,
      "port": 0,
      "operator": 0,
      "destination": 0,
      "updated_at": 0,
      "risk_score": 0
    },
    "issues": [
      "Low configured source coverage; public API keys may still be missing"
    ],
    "next_cleanup_focus": [
      "Low configured source coverage; public API keys may still be missing"
    ]
  },
  "collector_readiness": [
    {
      "phase": "Phase 1",
      "name": "Korea port-call base layer",
      "sources": [
        "port_operation",
        "berth_sources",
        "pilot_sources"
      ],
      "goal": "Confirm arrivals, berth assignment, waiting status, and port-call timing without paid AIS.",
      "active_sources": [],
      "missing_sources": [
        "port_operation",
        "berth_sources",
        "pilot_sources"
      ],
      "readiness_percent": 0,
      "status": "waiting"
    },
    {
      "phase": "Phase 2",
      "name": "Vessel identity enrichment",
      "sources": [
        "vessel_spec",
        "mof_ais_info",
        "port_facility"
      ],
      "goal": "Normalize IMO/MMSI, vessel type, size class, operator, and target segment.",
      "active_sources": [],
      "missing_sources": [
        "vessel_spec",
        "mof_ais_info",
        "port_facility"
      ],
      "readiness_percent": 0,
      "status": "waiting"
    },
    {
      "phase": "Phase 3",
      "name": "Movement / idle-time signals",
      "sources": [
        "mof_vts",
        "mof_ais_dynamic",
        "ulsan_core",
        "ygpa_core"
      ],
      "goal": "Detect anchorage, low speed, long stay, berth shifts, and port congestion signals.",
      "active_sources": [],
      "missing_sources": [
        "mof_vts",
        "mof_ais_dynamic",
        "ulsan_core",
        "ygpa_core"
      ],
      "readiness_percent": 0,
      "status": "waiting"
    },
    {
      "phase": "Phase 4",
      "name": "Trend and reporting history",
      "sources": [
        "supabase",
        "google_drive"
      ],
      "goal": "Accumulate daily snapshots for sales timing, repeat calls, and pipeline reporting.",
      "active_sources": [],
      "missing_sources": [
        "supabase",
        "google_drive"
      ],
      "readiness_percent": 0,
      "status": "waiting"
    },
    {
      "phase": "Optional",
      "name": "Paid AIS enrichment",
      "sources": [
        "marine_traffic",
        "vesselfinder",
        "aisstream"
      ],
      "goal": "Use only when global real-time coverage becomes commercially justified.",
      "active_sources": [],
      "missing_sources": [
        "marine_traffic",
        "vesselfinder",
        "aisstream"
      ],
      "readiness_percent": 0,
      "status": "waiting"
    }
  ],
  "collector_manifest": [
    {
      "collector": "port-operation-base",
      "priority": 1,
      "source_keys": [
        "port_operation",
        "korea_public_data"
      ],
      "output": "port_calls",
      "weight": "light",
      "business_use": "Korea arrivals/departures, port-call timing, and initial sales target discovery.",
      "enabled_sources": [],
      "partial_sources": [],
      "missing_sources": [
        "port_operation",
        "korea_public_data"
      ],
      "readiness_percent": 0,
      "status": "waiting",
      "next_action": "Configure or validate: port_operation, korea_public_data"
    },
    {
      "collector": "berth-and-pilot-watch",
      "priority": 2,
      "source_keys": [
        "berth_sources",
        "pilot_sources",
        "ygpa_core",
        "ulsan_core"
      ],
      "output": "berth_watch",
      "weight": "light_to_medium",
      "business_use": "Berth assignment, waiting status, terminal movement, and short-window outreach timing.",
      "enabled_sources": [],
      "partial_sources": [],
      "missing_sources": [
        "berth_sources",
        "pilot_sources",
        "ygpa_core",
        "ulsan_core"
      ],
      "readiness_percent": 0,
      "status": "waiting",
      "next_action": "Configure or validate: berth_sources, pilot_sources, ygpa_core, ulsan_core"
    },
    {
      "collector": "mof-ais-snapshot",
      "priority": 3,
      "source_keys": [
        "mof_ais_dynamic",
        "mof_ais_info",
        "mof_vts"
      ],
      "output": "ais_snapshot",
      "weight": "medium",
      "business_use": "Low-speed, anchorage, idle-time and movement confirmation without paid AIS dependency.",
      "enabled_sources": [],
      "partial_sources": [],
      "missing_sources": [
        "mof_ais_dynamic",
        "mof_ais_info",
        "mof_vts"
      ],
      "readiness_percent": 0,
      "status": "waiting",
      "next_action": "Configure or validate: mof_ais_dynamic, mof_ais_info, mof_vts"
    },
    {
      "collector": "vessel-master-enrichment",
      "priority": 4,
      "source_keys": [
        "vessel_spec",
        "mof_ais_info",
        "port_facility"
      ],
      "output": "vessel_master",
      "weight": "light",
      "business_use": "Vessel type, size class, identity merge, and opportunity segmentation.",
      "enabled_sources": [],
      "partial_sources": [],
      "missing_sources": [
        "vessel_spec",
        "mof_ais_info",
        "port_facility"
      ],
      "readiness_percent": 0,
      "status": "waiting",
      "next_action": "Configure or validate: vessel_spec, mof_ais_info, port_facility"
    },
    {
      "collector": "history-archive",
      "priority": 5,
      "source_keys": [
        "supabase",
        "google_drive"
      ],
      "output": "daily_history",
      "weight": "external_storage",
      "business_use": "Keep GitHub light while accumulating repeated snapshots for port-stay and lead history.",
      "enabled_sources": [],
      "partial_sources": [],
      "missing_sources": [
        "supabase",
        "google_drive"
      ],
      "readiness_percent": 0,
      "status": "waiting",
      "next_action": "Configure or validate: supabase, google_drive"
    },
    {
      "collector": "paid-ais-enrichment",
      "priority": 9,
      "source_keys": [
        "marine_traffic",
        "vesselfinder",
        "aisstream"
      ],
      "output": "paid_ais_overlay",
      "weight": "optional_paid",
      "business_use": "Commercial-only enrichment when a customer or pilot project requires global real-time coverage.",
      "enabled_sources": [],
      "partial_sources": [],
      "missing_sources": [
        "marine_traffic",
        "vesselfinder",
        "aisstream"
      ],
      "readiness_percent": 0,
      "status": "waiting",
      "next_action": "Configure or validate: marine_traffic, vesselfinder, aisstream"
    }
  ],
  "source_registry": {
    "registry_version": "source-registry-v15.9",
    "total_groups": 21,
    "enabled_groups": 0,
    "partial_groups": 0,
    "public_enabled_groups": 0,
    "storage_enabled_groups": 0,
    "paid_enabled_groups": 0,
    "operating_posture": "sample_first",
    "weight_guidance": "Keep collector outputs small in GitHub. Store raw/heavy archive data in Supabase or Google Drive.",
    "immediate_focus": "Add or verify Korean public/port/MOF API secrets before expanding UI features."
  },
  "next_development_plan": [
    {
      "step": 1,
      "title": "Keep build lightweight",
      "detail": "Do not add heavy raw archives to GitHub. Keep dashboard JSON small and push raw/history data to Supabase or GDrive."
    },
    {
      "step": 2,
      "title": "Connect public collectors first",
      "detail": "Prioritize PORT_OPERATION, BERTH/PILOT URLs, MOF AIS/VTS, YGPA and Ulsan sources before paid AIS."
    },
    {
      "step": 3,
      "title": "Replace sample rows gradually",
      "detail": "Current output is still sample-mode; next work is collector smoke tests and field mapping."
    },
    {
      "step": 4,
      "title": "Add historical accumulation",
      "detail": "Add Supabase credentials when ready to preserve daily snapshots."
    }
  ],
  "recommended_hosting": {
    "build_command": "npm run build",
    "output_directory": "public",
    "node_version": ">=18"
  },
  "error": null,
  "deployment_readiness": {
    "blocking": 0,
    "warnings": 5,
    "checks": [
      {
        "key": "static_build",
        "label": "Static dashboard files generated",
        "status": "pass",
        "detail": "dashboard/index.html and public/index.html should exist for hosting."
      },
      {
        "key": "data_outputs",
        "label": "API JSON outputs generated",
        "status": "pass",
        "detail": "3 vessel records available in dashboard/api/vessels.json."
      },
      {
        "key": "supabase",
        "label": "Supabase credentials",
        "status": "warn",
        "detail": "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY; static data still builds."
      },
      {
        "key": "hosting",
        "label": "Hosting output directory",
        "status": "info",
        "detail": "For Vercel/Netlify, set build command to npm run build and output directory to public or dashboard depending on routing."
      },
      {
        "key": "api_secret_detection",
        "label": "Existing API secrets detected",
        "status": "warn",
        "detail": "0 API group(s) enabled. The pipeline will use configured sources and keep fallback data for missing sources."
      },
      {
        "key": "collector_readiness",
        "label": "Collector readiness roadmap",
        "status": "warn",
        "detail": "Keep using sample/fallback mode while public collectors are wired one by one."
      },
      {
        "key": "ais_source",
        "label": "AIS / vessel tracking source",
        "status": "warn",
        "detail": "No AIS source detected yet; dashboard remains in static/enriched snapshot mode. Add MOF_AIS_* or external AIS keys for live enrichment."
      },
      {
        "key": "data_quality",
        "label": "Data quality score",
        "status": "pass",
        "detail": "Quality score 80/100 · Watch."
      },
      {
        "key": "data_mode_guard",
        "label": "Sample/live data guard",
        "status": "warn",
        "detail": "Dashboard is render-ready but currently using sample vessels. Connect public/API collectors to replace sample rows."
      },
      {
        "key": "business_signal",
        "label": "Sales signal coverage",
        "status": "pass",
        "detail": "2 critical and 2 high-risk targets detected."
      }
    ]
  }
}