# Vessel Universe Audit Report

Generated: 2026-05-30T09:57:53.160Z

Dataset source: local_static_outputs

Run ID: run_20260527074236927_8982db0f

## Collection Counts

| source_name | source_rows_collected | source_rows_normalized | source_rows_discarded | source_rows_failed | status |
| --- | --- | --- | --- | --- | --- |
| source_csv | 0 | 0 | 0 | 0 | unknown |
| port_operation_busan_i | 0 | 0 | 0 | 0 | unknown |
| port_operation_busan_o | 0 | 0 | 0 | 0 | unknown |
| port_operation_incheon_i | 0 | 0 | 0 | 0 | unknown |
| port_operation_incheon_o | 0 | 0 | 0 | 0 | unknown |
| port_operation_yeosu_gwangyang_i | 0 | 0 | 0 | 0 | unknown |
| port_operation_yeosu_gwangyang_o | 0 | 0 | 0 | 0 | unknown |
| port_operation_ulsan_i | 0 | 0 | 0 | 0 | unknown |
| port_operation_ulsan_o | 0 | 0 | 0 | 0 | unknown |
| port_operation_pyeongtaek_dangjin_i | 0 | 0 | 0 | 0 | unknown |
| port_operation_pyeongtaek_dangjin_o | 0 | 0 | 0 | 0 | unknown |
| port_operation_pohang_i | 0 | 0 | 0 | 0 | unknown |
| port_operation_pohang_o | 0 | 0 | 0 | 0 | unknown |
| port_operation_masan_jinhae_i | 0 | 0 | 0 | 0 | unknown |
| port_operation_masan_jinhae_o | 0 | 0 | 0 | 0 | unknown |
| port_operation_samcheonpo_hadong_i | 0 | 0 | 0 | 0 | unknown |
| port_operation_samcheonpo_hadong_o | 0 | 0 | 0 | 0 | unknown |
| port_operation_mokpo_i | 0 | 0 | 0 | 0 | unknown |
| port_operation_mokpo_o | 0 | 0 | 0 | 0 | unknown |
| port_operation_gunsan_i | 0 | 0 | 0 | 0 | unknown |
| port_operation_gunsan_o | 0 | 0 | 0 | 0 | unknown |
| port_operation_daesan_i | 0 | 0 | 0 | 0 | unknown |
| port_operation_daesan_o | 0 | 0 | 0 | 0 | unknown |
| port_operation_donghae_mukho_i | 0 | 0 | 0 | 0 | unknown |
| port_operation_donghae_mukho_o | 0 | 0 | 0 | 0 | unknown |
| port_operation_jeju_i | 0 | 0 | 0 | 0 | unknown |
| port_operation_jeju_o | 0 | 0 | 0 | 0 | unknown |
| port_operation_tongyeong_i | 0 | 0 | 0 | 0 | unknown |
| port_operation_tongyeong_o | 0 | 0 | 0 | 0 | unknown |
| port_operation_geoje_okpo_i | 0 | 0 | 0 | 0 | unknown |
| port_operation_geoje_okpo_o | 0 | 0 | 0 | 0 | unknown |
| ulsan_core | 0 | 0 | 0 | 0 | unknown |
| ulsan_berth_detail | 0 | 0 | 0 | 0 | unknown |
| ulsan_cargo_plan | 0 | 0 | 0 | 0 | unknown |
| ulsan_berth_operation | 0 | 0 | 0 | 0 | unknown |
| ulsan_terminal_process | 0 | 0 | 0 | 0 | unknown |
| mof_ais_dynamic | 0 | 0 | 0 | 0 | unknown |
| mof_ais_info | 0 | 0 | 0 | 0 | unknown |
| mof_ais_stat | 0 | 0 | 0 | 0 | unknown |
| korea_public_data | 0 | 0 | 0 | 0 | unknown |

## Deduplication Counts

| key | count |
| --- | --- |
| raw_rows | 0 |
| normalized_rows | 0 |
| active_rows_after_departure_filter | 0 |
| duplicate_rows_removed | 0 |
| unique_port_calls | 0 |
| unique_vessels | 0 |

## Port Call Audit

| key | count |
| --- | --- |
| port_call_master_count | unknown |
| inferred_unique_port_calls | 0 |
| coverage_percent | unknown |

## Vessel Identity Audit

| key | count |
| --- | --- |
| master_vessel_count | unknown |
| imo_known_count | 0 |
| imo_missing_count | 0 |
| call_sign_known_count | 0 |
| vessel_name_only_count | 0 |

## All Vessels Breakdown

All vessels count: 0

### By Port

_No rows available._

### By Vessel Type

_No rows available._

### By GT Band

_No rows available._

## Target Vessel Audit

| key | count |
| --- | --- |
| scored_vessels_count | 0 |
| watchlist_count | 0 |
| sales_target_count | 0 |
| immediate_target_count | 0 |
| target_ratio | 0 |

## Dashboard Audit

| key | count |
| --- | --- |
| full_vessel_table_source | /api/vessels?group=all -> vesselGroupRows(allRecords, 'all') |
| sales_target_table_source | /api/vessels?group=target -> vesselGroupRows(allRecords, 'target') -> sales candidates only |
| immediate_target_source | /api/candidates/top.json -> dashboard_summary_snapshots.candidate_summary.immediate_targets or buildVisibilityBuckets().immediate_targets |
| current_risk | Summary fallback can display stored port_summary counts until the next successful run rewrites dashboard_summary_snapshots. |

## Suspected Counting Issues

- Local dashboard/api outputs are stale/no-live-data and cannot prove production vessel counts.
- No local all_vessels rows are available for row-level audit.

## Recommended Fixes

- Run this audit in GitHub Actions with Supabase secrets after every successful collection.
- Compare source_collection_logs rows_collected with vessel_snapshots active rows for the same run_id.
- Keep /api/vessels?group=all and /api/vessels?group=target counts separate in UI labels.
- Regenerate dashboard_summary_snapshots after the port metric label change so old port_summary values disappear.
- Add port_call_id coverage as a hard promotion diagnostic if it falls below 80%.
