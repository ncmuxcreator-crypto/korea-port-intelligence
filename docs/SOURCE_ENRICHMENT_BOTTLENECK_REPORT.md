# Source Enrichment Bottleneck Report

Generated at: 2026-06-13T00:44:43.032Z

Source quality run: run_20260612215215093_9a4e8bcc

Enrichment utilization run: run_20260612153026990_a1f0707a

Status summary run: run_20260612215215093_9a4e8bcc

Total vessels: 1016

Stage counts: {"FETCH_BLOCKED":1,"MATCH_BLOCKED":2,"NORMALIZE_BLOCKED":1,"COVERAGE_LIMITED":2}

| source_key | bottleneck_stage | collected | normalized | matched | patches | display | next_action |
| --- | --- | --- | --- | --- | --- | --- | --- |
| source_csv | FETCH_BLOCKED | 0 | 0 | 0 | 0 | 0 | Point SOURCE_CSV_URL to a lightweight verified reference CSV and run reference_enrichment only. |
| pilot_sources | MATCH_BLOCKED | 403 | 72 | 0 | 0 | 0 | Strengthen call_sign, vessel_name, normalized_port, and time-window matching before applying weak matches. |
| berth_sources | MATCH_BLOCKED | 30 | 30 | 0 | 0 | 0 | Strengthen PNC vessel name, vessel code, berth, terminal, and port matching before applying identity fields. |
| vessel_spec | NORMALIZE_BLOCKED | 1 | 0 | 0 | 0 | 0 | Inspect raw_sample_keys and add parser aliases or nested response handling. |
| mof_ais_info | COVERAGE_LIMITED | 10 | 10 | 10 | 0 | 0 | Expand target-based AIS enrichment for sales targets and contact-now vessels. |
| mof_ais_dynamic | COVERAGE_LIMITED | 10 | 10 | 10 | 0 | 0 | Expand target-based AIS enrichment for sales targets and contact-now vessels. |
