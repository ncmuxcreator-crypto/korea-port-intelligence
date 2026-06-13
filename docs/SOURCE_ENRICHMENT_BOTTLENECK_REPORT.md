# Source Enrichment Bottleneck Report

Generated at: 2026-06-13T13:23:43.353Z

Source quality run: run_20260613132041816_787ce530

Enrichment utilization run: run_20260613132041816_787ce530

Status summary run: run_20260613132041816_787ce530

Total vessels: 919

Stage counts: {"PATCH_BLOCKED":3,"FETCH_BLOCKED":3,"MATCH_BLOCKED":2}

| source_key | bottleneck_stage | collected | normalized | matched | patches | display | match_rate | apply_rate | review_rate | next_action |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| source_csv | PATCH_BLOCKED | 1015 | 1015 | 877 | 0 | 10 | 0 | 0 | 0 | Point SOURCE_CSV_URL to a lightweight verified reference CSV and run reference_enrichment only. |
| pilot_sources | PATCH_BLOCKED | 0 | 29 | 29 | 29 | 32 | 100 | 100 | 0 | Strengthen call_sign, vessel_name, normalized_port, and time-window matching before applying weak matches. |
| berth_sources | FETCH_BLOCKED | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | Strengthen PNC vessel name, vessel code, berth, terminal, and port matching before applying identity fields. |
| vessel_spec | FETCH_BLOCKED | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | Inspect raw_sample_keys and add parser aliases or nested response handling. |
| mof_ais_info | MATCH_BLOCKED | 0 | 50 | 0 | 0 | 0 | 0 | 0 | 0 | Expand target-based AIS enrichment for sales targets and contact-now vessels. |
| mof_ais_dynamic | MATCH_BLOCKED | 0 | 50 | 0 | 0 | 0 | 0 | 0 | 0 | Expand target-based AIS enrichment for sales targets and contact-now vessels. |
| ulsan_vessel_operation | FETCH_BLOCKED | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | Review source-specific diagnostics and refresh the owning tier. |
| port_facility | PATCH_BLOCKED | 50 | 50 | 50 | 0 | 0 | 0 | 0 | 0 | Create safe enrichment patches from matched rows. |
