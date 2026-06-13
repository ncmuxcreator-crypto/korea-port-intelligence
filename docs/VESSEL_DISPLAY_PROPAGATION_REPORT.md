# Vessel Display Propagation Report

Generated at: 2026-06-13T03:39:33.505Z

Status: WARNING

## Tier Pointer

- status-summary run_id: run_20260612215215093_9a4e8bcc
- update-tiers core_run_id: run_20260612215215093_9a4e8bcc
- core pointer matches status-summary: true
- core pointer source: production_status_summary_preserved

## Output Scan

- pilotage confirmed: 9
- pilotage placeholders: 655
- aux confirmed berth: 0
- baseline berth: 651
- berth placeholders: 8

## Matching Engine

- matching booster available: true
- identity graph records: -
- patch hints applied: 0
- patches applied: 0

## Source Quality

| source | collected | normalized | matched | blocker |
| --- | --- | --- | --- | --- |
| source_csv | 1015 | 1015 | 1015 | - |
| pilot_sources | 403 | 72 | 0 | missing_call_sign; missing_vessel_name; missing_port; time_only_without_date; no_current_vessel_same_port; confidence_below_threshold; vessel_key_mismatch; compact_mapper_dropped_signal |
| berth_sources | 30 | 30 | 0 | no_vessel_match_or_signal |
| vessel_spec | 1 | 0 | 0 | HTTP 200 returned rows, but no rows matched vessel specification aliases. Check raw_sample_keys and parser_blockers after the next collector run. |
| mof_ais_info | 10 | 10 | 10 | - |
| mof_ais_dynamic | 10 | 10 | 10 | - |
| port_operation | 6885 | 6885 | 9 | - |

## Enrichment Utilization

| source | matched | patches | display | sample_basis |
| --- | --- | --- | --- | --- |
| source_csv | 0 | 0 | 0 | unmatched_records |
| pilot_sources | 0 | 0 | 0 | unmatched_records |
| berth_sources | 0 | 0 | 0 | candidate_visible_fields |
| vessel_spec | 0 | 0 | 0 | unmatched_records |
| mof_ais_info | 10 | 0 | 0 | matched_records |
| mof_ais_dynamic | 10 | 0 | 0 | matched_records |
| port_operation | 1016 | 0 | 0 | matched_records |

## Issues

- No critical issues

- WARNING: bootstrap baseline_berth_count=982 differs from output scan=651
- WARNING: bootstrap berth_info_detected_count=982 differs from output scan=651
- WARNING: mixed tiers are documented

## Remaining Blockers

- pilot_sources: missing_call_sign; missing_vessel_name; missing_port; time_only_without_date; no_current_vessel_same_port; confidence_below_threshold; vessel_key_mismatch; compact_mapper_dropped_signal
- berth_sources: no_vessel_match_or_signal
- vessel_spec: HTTP 200 returned rows, but no rows matched vessel specification aliases. Check raw_sample_keys and parser_blockers after the next collector run.
