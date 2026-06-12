# Supabase DB Cleanup Audit

Generated at: 2026-06-12T06:32:18.515Z

## Summary

- DB health score: 42
- Tables checked: 38
- Estimated rows: 80577
- Cleanup candidate tables: 8
- Protected tables: 4
- Critical issues: 0
- Warnings: 29

## Protected Data

- active_dataset_pointer: run_20260612061752520_06a37656 (protected)
- latest_successful_run: run_20260612061752520_06a37656 (protected)
- vessel_master: canonical identity rows (protected)
- commercial_sales_history: commercial_leads/operator_contact_history/sales_pipeline/quote/customer_memory (protected)
- manual_reference_data: verified source_csv/manual watchlist records (protected)

## Table Inventory

| Table | Exists | Rows | Risk | Protection |
| --- | --- | ---: | --- | --- |
| data_collection_runs | yes | 369 | NEEDS_MANUAL_REVIEW | not_protected |
| active_dataset_pointer | yes | 1 | NEVER_DELETE | BLOCKED_BY_PROTECTION_RULE |
| sales_candidates_current | yes | 126 | NEEDS_MANUAL_REVIEW | not_protected |
| immediate_targets_current | yes | 0 | NEEDS_MANUAL_REVIEW | not_protected |
| port_summary_current | yes | 8 | NEEDS_MANUAL_REVIEW | not_protected |
| vessel_master | yes | 2853 | RETAIN_LONG_TERM | BLOCKED_BY_PROTECTION_RULE |
| vessel_entities | yes | 2938 | RETAIN_LONG_TERM | not_protected |
| vessel_snapshots | yes | 1009 | SAFE_CLEANUP_CANDIDATE | not_protected |
| port_call_master | yes | 1009 | SAFE_CLEANUP_CANDIDATE | not_protected |
| opportunity_master | yes | 6698 | SAFE_CLEANUP_CANDIDATE | not_protected |
| vessel_events | yes | 42309 | RETAIN_LONG_TERM | not_protected |
| risk_history | yes | 321 | RETAIN_MEDIUM_TERM | not_protected |
| explainability_snapshots | yes | 321 | RETAIN_MEDIUM_TERM | not_protected |
| rule_evaluations | yes | 700 | RETAIN_MEDIUM_TERM | not_protected |
| feature_store | yes | 321 | RETAIN_MEDIUM_TERM | not_protected |
| feature_snapshots | yes | 321 | RETAIN_MEDIUM_TERM | not_protected |
| model_training_rows | yes | 208 | RETAIN_MEDIUM_TERM | not_protected |
| vessel_snapshot_daily | yes | 1009 | RETAIN_LONG_TERM | not_protected |
| port_snapshot_daily | yes | 72 | RETAIN_LONG_TERM | not_protected |
| commercial_opportunity_daily | yes | 29 | RETAIN_LONG_TERM | not_protected |
| route_snapshot_daily | yes | 3933 | RETAIN_LONG_TERM | not_protected |
| operator_snapshot_daily | yes | 87 | RETAIN_LONG_TERM | not_protected |
| vessel_universe_audit | yes | 358 | NEEDS_MANUAL_REVIEW | not_protected |
| port_congestion_snapshots | yes | 1046 | RETAIN_SHORT_TERM | not_protected |
| port_daily_summary | yes | 18 | RETAIN_LONG_TERM | not_protected |
| port_weekly_summary | yes | 18 | RETAIN_LONG_TERM | not_protected |
| port_monthly_summary | yes | 18 | RETAIN_LONG_TERM | not_protected |
| commercial_leads | yes | 4 | RETAIN_LONG_TERM | BLOCKED_BY_PROTECTION_RULE |
| operator_contact_history | yes | 1009 | RETAIN_LONG_TERM | BLOCKED_BY_PROTECTION_RULE |
| sales_pipeline | no | - | RETAIN_LONG_TERM | not_protected |
| quote_opportunities | no | - | RETAIN_LONG_TERM | not_protected |
| customer_memory | no | - | RETAIN_LONG_TERM | not_protected |
| enrichment_match_candidates | yes | 692 | RETAIN_SHORT_TERM | not_protected |
| imo_recovery_queue | yes | 4575 | RETAIN_SHORT_TERM | not_protected |
| vessel_identity_candidates | yes | 1009 | RETAIN_SHORT_TERM | not_protected |
| vessel_aliases | yes | 6952 | RETAIN_LONG_TERM | not_protected |
| pilot_schedule_events | yes | 201 | RETAIN_MEDIUM_TERM | not_protected |
| source_collection_logs | yes | 35 | RETAIN_SHORT_TERM | not_protected |

## Cleanup Candidates

- run_20260611103308821_aea4733e: completed run outside recent 20 detailed runs (candidate)
- run_20260611094049200_540e1000: completed run outside recent 20 detailed runs (candidate)
- run_20260611093628081_fa869604: completed run outside recent 20 detailed runs (candidate)
- run_20260611093102163_c5f766ac: completed run outside recent 20 detailed runs (candidate)
- run_20260611085053060_c44ab234: completed run outside recent 20 detailed runs (candidate)
- run_20260611082323489_1b119ace: completed run outside recent 20 detailed runs (candidate)
- run_20260611081706677_c876572b: completed run outside recent 20 detailed runs (candidate)
- run_20260611074820254_f92e3219: completed run outside recent 20 detailed runs (candidate)
- run_20260611070417001_4c116173: completed run outside recent 20 detailed runs (candidate)
- run_20260611061010164_2554ea08: completed run outside recent 20 detailed runs (candidate)
- run_20260611060133674_e92f303b: completed run outside recent 20 detailed runs (candidate)
- run_20260611055708096_8ac8df80: completed run outside recent 20 detailed runs (candidate)
- run_20260611054247041_91debf59: completed run outside recent 20 detailed runs (candidate)
- run_20260611053216802_9bc338fd: completed run outside recent 20 detailed runs (candidate)
- run_20260611052213874_65155e42: completed run outside recent 20 detailed runs (candidate)
- run_20260611051422321_0047505b: completed run outside recent 20 detailed runs (candidate)
- run_20260611040707989_3073fbe8: completed run outside recent 20 detailed runs (candidate)
- run_20260611035831134_55a86b88: completed run outside recent 20 detailed runs (candidate)
- run_20260611035302244_18f586c4: completed run outside recent 20 detailed runs (candidate)
- run_20260611034748756_79da3159: completed run outside recent 20 detailed runs (candidate)
- run_20260611032538498_b4f7ac82: completed run outside recent 20 detailed runs (candidate)
- run_20260611032047881_cc3c1c41: completed run outside recent 20 detailed runs (candidate)
- run_20260611031424592_8981c987: completed run outside recent 20 detailed runs (candidate)
- run_20260611030904330_ff81ea5b: completed run outside recent 20 detailed runs (candidate)
- run_20260611023859390_d3f7ea00: completed run outside recent 20 detailed runs (candidate)
- vessel_snapshots: run-level detailed snapshot table
- port_call_master: run-level detailed snapshot table
- opportunity_master: run-level detailed snapshot table
- port_congestion_snapshots: short-term operational/cache table
- enrichment_match_candidates: short-term operational/cache table
- imo_recovery_queue: short-term operational/cache table
- vessel_identity_candidates: short-term operational/cache table
- source_collection_logs: short-term operational/cache table

## Duplicates

- imo_recovery_queue: duplicate recovery queue rows -> 143 duplicates

## Orphans

- opportunity_master: master_vessel_id_missing_from_vessel_master -> 507 (WARNING)
- risk_history: master_vessel_id_missing_from_vessel_master -> 230 (WARNING)
- sales_candidates_current: master_vessel_id_missing_from_vessel_master -> 56 (WARNING)

## Retention Recommendations

- active_dataset_pointer: keep always - Current live dataset pointer.
- latest_successful_run: keep always - Required for rollback and serving continuity.
- completed_detailed_runs: keep recent 20 detailed runs - Balance rollback depth with storage growth.
- failed_syncing_runs: keep 7-14 days - Enough time for debugging without indefinite growth.
- vessel_master: retain long term - Canonical identity and enrichment memory.
- commercial_sales_history: retain long term - Private commercial memory and won/lost/quote/contact history.
- source_collection_logs: keep detailed logs 30-60 days, aggregate older logs - Diagnostics can grow quickly.

## Next Actions

- [MANUAL_REVIEW] imo_recovery_queue: duplicate recovery queue rows duplicates=143
- [WARNING] opportunity_master: master_vessel_id_missing_from_vessel_master count=507
- [WARNING] risk_history: master_vessel_id_missing_from_vessel_master count=230
- [WARNING] sales_candidates_current: master_vessel_id_missing_from_vessel_master count=56
