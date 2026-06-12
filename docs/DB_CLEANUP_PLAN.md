# DB Cleanup Execution Plan

> Review-only plan. No data was deleted, and all destructive SQL is commented out.

## Summary

| Metric | Value |
| --- | --- |
| Generated at | 2026-06-12T09:59:37.639Z |
| Source generated at | 2026-06-12T06:32:18.515Z |
| Source run id | run_20260612061752520_06a37656 |
| DB health score | 42 |
| Safe cleanup candidates | 33 |
| Manual review candidates | 13 |
| Blocked candidates | 4 |
| Estimated rows removable | 16439 |
| Estimated storage impact | high; exact storage bytes unavailable |

## Protected Data

| Type | Identifier | Rows | Reason |
| --- | --- | --- | --- |
| active_dataset_pointer | run_20260612061752520_06a37656 | - | Protected by cleanup audit. |
| latest_successful_run | run_20260612061752520_06a37656 | - | Protected by cleanup audit. |
| vessel_master | canonical identity rows | - | Protected by cleanup audit. |
| commercial_sales_history | commercial_leads/operator_contact_history/sales_pipeline/quote/customer_memory | - | Protected by cleanup audit. |
| manual_reference_data | verified source_csv/manual watchlist records | - | Protected by cleanup audit. |
| table | active_dataset_pointer | 1 | Never delete table. |
| table | vessel_master | 2853 | Blocked by protection rule. |
| table | commercial_leads | 4 | Blocked by protection rule. |
| table | operator_contact_history | 1009 | Blocked by protection rule. |
| run_id | run_20260612061752520_06a37656 | - | Active/latest successful dataset run; must remain available for rollback and serving continuity. |

## Safe Cleanup Candidates

| Type | Identifier | Rows | Reason |
| --- | --- | --- | --- |
| run | run_20260611103308821_aea4733e | 37 | completed run outside recent 20 detailed runs |
| run | run_20260611094049200_540e1000 | 24 | completed run outside recent 20 detailed runs |
| run | run_20260611093628081_fa869604 | 9 | completed run outside recent 20 detailed runs |
| run | run_20260611093102163_c5f766ac | 8 | completed run outside recent 20 detailed runs |
| run | run_20260611085053060_c44ab234 | 21 | completed run outside recent 20 detailed runs |
| run | run_20260611082323489_1b119ace | 11 | completed run outside recent 20 detailed runs |
| run | run_20260611081706677_c876572b | 8 | completed run outside recent 20 detailed runs |
| run | run_20260611074820254_f92e3219 | 20 | completed run outside recent 20 detailed runs |
| run | run_20260611070417001_4c116173 | 22 | completed run outside recent 20 detailed runs |
| run | run_20260611061010164_2554ea08 | 31 | completed run outside recent 20 detailed runs |
| run | run_20260611060133674_e92f303b | 9 | completed run outside recent 20 detailed runs |
| run | run_20260611055708096_8ac8df80 | 13 | completed run outside recent 20 detailed runs |
| run | run_20260611054247041_91debf59 | 9 | completed run outside recent 20 detailed runs |
| run | run_20260611053216802_9bc338fd | 10 | completed run outside recent 20 detailed runs |
| run | run_20260611052213874_65155e42 | 14 | completed run outside recent 20 detailed runs |
| run | run_20260611051422321_0047505b | 20 | completed run outside recent 20 detailed runs |
| run | run_20260611040707989_3073fbe8 | 20 | completed run outside recent 20 detailed runs |
| run | run_20260611035831134_55a86b88 | 8 | completed run outside recent 20 detailed runs |
| run | run_20260611035302244_18f586c4 | 11 | completed run outside recent 20 detailed runs |
| run | run_20260611034748756_79da3159 | 10 | completed run outside recent 20 detailed runs |
| run | run_20260611032538498_b4f7ac82 | 12 | completed run outside recent 20 detailed runs |
| run | run_20260611032047881_cc3c1c41 | 8 | completed run outside recent 20 detailed runs |
| run | run_20260611031424592_8981c987 | 8 | completed run outside recent 20 detailed runs |
| run | run_20260611030904330_ff81ea5b | 8 | completed run outside recent 20 detailed runs |
| run | run_20260611023859390_d3f7ea00 | 15 | completed run outside recent 20 detailed runs |
| table | vessel_snapshots | 1009 | run-level detailed snapshot table |
| table | port_call_master | 1009 | run-level detailed snapshot table |
| table | opportunity_master | 6698 | run-level detailed snapshot table |
| table | port_congestion_snapshots | 1046 | short-term operational/cache table |
| table | enrichment_match_candidates | 692 | short-term operational/cache table |
| table | imo_recovery_queue | 4575 | short-term operational/cache table |
| table | vessel_identity_candidates | 1009 | short-term operational/cache table |
| table | source_collection_logs | 35 | short-term operational/cache table |

## Manual Review Candidates

| Type | Severity | Identifier | Rows | Reason |
| --- | --- | --- | --- | --- |
| audit_issue | MANUAL_REVIEW | imo_recovery_queue: duplicate recovery queue rows duplicates=143 | - | Manual audit issue requires review before cleanup. |
| audit_issue | WARNING | opportunity_master: master_vessel_id_missing_from_vessel_master count=507 | - | Manual audit issue requires review before cleanup. |
| audit_issue | WARNING | risk_history: master_vessel_id_missing_from_vessel_master count=230 | - | Manual audit issue requires review before cleanup. |
| audit_issue | WARNING | sales_candidates_current: master_vessel_id_missing_from_vessel_master count=56 | - | Manual audit issue requires review before cleanup. |
| table | MANUAL_REVIEW | data_collection_runs | 369 | Table is not automatically safe to clean. |
| table | MANUAL_REVIEW | sales_candidates_current | 126 | Table is not automatically safe to clean. |
| table | MANUAL_REVIEW | immediate_targets_current | 0 | Table is not automatically safe to clean. |
| table | MANUAL_REVIEW | port_summary_current | 8 | Table is not automatically safe to clean. |
| table | MANUAL_REVIEW | vessel_universe_audit | 358 | Table is not automatically safe to clean. |
| duplicate | MANUAL_REVIEW | imo_recovery_queue:duplicate recovery queue rows | 143 | Duplicate cleanup needs quarantine/review before deletion. |
| orphan | WARNING | opportunity_master:master_vessel_id_missing_from_vessel_master | 507 | Orphan rows require relationship check before deletion. |
| orphan | WARNING | risk_history:master_vessel_id_missing_from_vessel_master | 230 | Orphan rows require relationship check before deletion. |
| orphan | WARNING | sales_candidates_current:master_vessel_id_missing_from_vessel_master | 56 | Orphan rows require relationship check before deletion. |

## Blocked Candidates

| Type | Identifier | Rows | Reason |
| --- | --- | --- | --- |
| table | active_dataset_pointer | 1 | NEVER_DELETE |
| table | vessel_master | 2853 | RETAIN_LONG_TERM |
| table | commercial_leads | 4 | RETAIN_LONG_TERM |
| table | operator_contact_history | 1009 | RETAIN_LONG_TERM |

## Estimated Rows Removable

- 16,439 rows
- high; exact storage bytes unavailable
- Supabase table byte estimates were not available in the source report, so storage impact is row-count based.

## SQL Preview

```sql
-- REVIEW-ONLY SQL PREVIEW
-- All destructive statements are commented out intentionally.
-- Uncomment manually only after backup, row-count verification, and approval.
--
-- BEGIN;
--
-- Candidate run_id: run_20260611103308821_aea4733e
-- Reason: completed run outside recent 20 detailed runs
-- DELETE FROM public.opportunity_master
-- WHERE run_id = 'run_20260611103308821_aea4733e'
--   AND run_id NOT IN ('run_20260612061752520_06a37656', 'run_20260612061752520_06a37656', 'run_20260612061752520_06a37656'); -- estimated rows 28
-- DELETE FROM public.port_congestion_snapshots
-- WHERE run_id = 'run_20260611103308821_aea4733e'
--   AND run_id NOT IN ('run_20260612061752520_06a37656', 'run_20260612061752520_06a37656', 'run_20260612061752520_06a37656'); -- estimated rows 9
--
-- Candidate run_id: run_20260611094049200_540e1000
-- Reason: completed run outside recent 20 detailed runs
-- DELETE FROM public.opportunity_master
-- WHERE run_id = 'run_20260611094049200_540e1000'
--   AND run_id NOT IN ('run_20260612061752520_06a37656', 'run_20260612061752520_06a37656', 'run_20260612061752520_06a37656'); -- estimated rows 16
-- DELETE FROM public.port_congestion_snapshots
-- WHERE run_id = 'run_20260611094049200_540e1000'
--   AND run_id NOT IN ('run_20260612061752520_06a37656', 'run_20260612061752520_06a37656', 'run_20260612061752520_06a37656'); -- estimated rows 8
--
-- Candidate run_id: run_20260611093628081_fa869604
-- Reason: completed run outside recent 20 detailed runs
-- DELETE FROM public.opportunity_master
-- WHERE run_id = 'run_20260611093628081_fa869604'
--   AND run_id NOT IN ('run_20260612061752520_06a37656', 'run_20260612061752520_06a37656', 'run_20260612061752520_06a37656'); -- estimated rows 1
-- DELETE FROM public.port_congestion_snapshots
-- WHERE run_id = 'run_20260611093628081_fa869604'
--   AND run_id NOT IN ('run_20260612061752520_06a37656', 'run_20260612061752520_06a37656', 'run_20260612061752520_06a37656'); -- estimated rows 8
--
-- Candidate run_id: run_20260611093102163_c5f766ac
-- Reason: completed run outside recent 20 detailed runs
-- DELETE FROM public.port_congestion_snapshots
-- WHERE run_id = 'run_20260611093102163_c5f766ac'
--   AND run_id NOT IN ('run_20260612061752520_06a37656', 'run_20260612061752520_06a37656', 'run_20260612061752520_06a37656'); -- estimated rows 8
--
-- Candidate run_id: run_20260611085053060_c44ab234
-- Reason: completed run outside recent 20 detailed runs
-- DELETE FROM public.opportunity_master
-- WHERE run_id = 'run_20260611085053060_c44ab234'
--   AND run_id NOT IN ('run_20260612061752520_06a37656', 'run_20260612061752520_06a37656', 'run_20260612061752520_06a37656'); -- estimated rows 13
-- DELETE FROM public.port_congestion_snapshots
-- WHERE run_id = 'run_20260611085053060_c44ab234'
--   AND run_id NOT IN ('run_20260612061752520_06a37656', 'run_20260612061752520_06a37656', 'run_20260612061752520_06a37656'); -- estimated rows 8
--
-- Candidate run_id: run_20260611082323489_1b119ace
-- Reason: completed run outside recent 20 detailed runs
-- DELETE FROM public.opportunity_master
-- WHERE run_id = 'run_20260611082323489_1b119ace'
--   AND run_id NOT IN ('run_20260612061752520_06a37656', 'run_20260612061752520_06a37656', 'run_20260612061752520_06a37656'); -- estimated rows 3
-- DELETE FROM public.port_congestion_snapshots
-- WHERE run_id = 'run_20260611082323489_1b119ace'
--   AND run_id NOT IN ('run_20260612061752520_06a37656', 'run_20260612061752520_06a37656', 'run_20260612061752520_06a37656'); -- estimated rows 8
--
-- Candidate run_id: run_20260611081706677_c876572b
-- Reason: completed run outside recent 20 detailed runs
-- DELETE FROM public.port_congestion_snapshots
-- WHERE run_id = 'run_20260611081706677_c876572b'
--   AND run_id NOT IN ('run_20260612061752520_06a37656', 'run_20260612061752520_06a37656', 'run_20260612061752520_06a37656'); -- estimated rows 8
--
-- Candidate run_id: run_20260611074820254_f92e3219
-- Reason: completed run outside recent 20 detailed runs
-- DELETE FROM public.opportunity_master
-- WHERE run_id = 'run_20260611074820254_f92e3219'
--   AND run_id NOT IN ('run_20260612061752520_06a37656', 'run_20260612061752520_06a37656', 'run_20260612061752520_06a37656'); -- estimated rows 11
-- DELETE FROM public.port_congestion_snapshots
-- WHERE run_id = 'run_20260611074820254_f92e3219'
--   AND run_id NOT IN ('run_20260612061752520_06a37656', 'run_20260612061752520_06a37656', 'run_20260612061752520_06a37656'); -- estimated rows 9
--
-- Candidate run_id: run_20260611070417001_4c116173
-- Reason: completed run outside recent 20 detailed runs
-- DELETE FROM public.opportunity_master
-- WHERE run_id = 'run_20260611070417001_4c116173'
--   AND run_id NOT IN ('run_20260612061752520_06a37656', 'run_20260612061752520_06a37656', 'run_20260612061752520_06a37656'); -- estimated rows 14
-- DELETE FROM public.port_congestion_snapshots
-- WHERE run_id = 'run_20260611070417001_4c116173'
--   AND run_id NOT IN ('run_20260612061752520_06a37656', 'run_20260612061752520_06a37656', 'run_20260612061752520_06a37656'); -- estimated rows 8
--
-- Candidate run_id: run_20260611061010164_2554ea08
-- Reason: completed run outside recent 20 detailed runs
-- DELETE FROM public.opportunity_master
-- WHERE run_id = 'run_20260611061010164_2554ea08'
--   AND run_id NOT IN ('run_20260612061752520_06a37656', 'run_20260612061752520_06a37656', 'run_20260612061752520_06a37656'); -- estimated rows 22
-- DELETE FROM public.port_congestion_snapshots
-- WHERE run_id = 'run_20260611061010164_2554ea08'
--   AND run_id NOT IN ('run_20260612061752520_06a37656', 'run_20260612061752520_06a37656', 'run_20260612061752520_06a37656'); -- estimated rows 9
--
-- Candidate run_id: run_20260611060133674_e92f303b
-- Reason: completed run outside recent 20 detailed runs
-- DELETE FROM public.opportunity_master
-- WHERE run_id = 'run_20260611060133674_e92f303b'
--   AND run_id NOT IN ('run_20260612061752520_06a37656', 'run_20260612061752520_06a37656', 'run_20260612061752520_06a37656'); -- estimated rows 1
-- DELETE FROM public.port_congestion_snapshots
-- WHERE run_id = 'run_20260611060133674_e92f303b'
--   AND run_id NOT IN ('run_20260612061752520_06a37656', 'run_20260612061752520_06a37656', 'run_20260612061752520_06a37656'); -- estimated rows 8
--
-- Candidate run_id: run_20260611055708096_8ac8df80
-- Reason: completed run outside recent 20 detailed runs
-- DELETE FROM public.opportunity_master
-- WHERE run_id = 'run_20260611055708096_8ac8df80'
--   AND run_id NOT IN ('run_20260612061752520_06a37656', 'run_20260612061752520_06a37656', 'run_20260612061752520_06a37656'); -- estimated rows 5
-- DELETE FROM public.port_congestion_snapshots
-- WHERE run_id = 'run_20260611055708096_8ac8df80'
--   AND run_id NOT IN ('run_20260612061752520_06a37656', 'run_20260612061752520_06a37656', 'run_20260612061752520_06a37656'); -- estimated rows 8
--
-- Candidate run_id: run_20260611054247041_91debf59
-- Reason: completed run outside recent 20 detailed runs
-- DELETE FROM public.opportunity_master
-- WHERE run_id = 'run_20260611054247041_91debf59'
--   AND run_id NOT IN ('run_20260612061752520_06a37656', 'run_20260612061752520_06a37656', 'run_20260612061752520_06a37656'); -- estimated rows 1
-- DELETE FROM public.port_congestion_snapshots
-- WHERE run_id = 'run_20260611054247041_91debf59'
--   AND run_id NOT IN ('run_20260612061752520_06a37656', 'run_20260612061752520_06a37656', 'run_20260612061752520_06a37656'); -- estimated rows 8
--
-- Candidate run_id: run_20260611053216802_9bc338fd
-- Reason: completed run outside recent 20 detailed runs
-- DELETE FROM public.opportunity_master
-- WHERE run_id = 'run_20260611053216802_9bc338fd'
--   AND run_id NOT IN ('run_20260612061752520_06a37656', 'run_20260612061752520_06a37656', 'run_20260612061752520_06a37656'); -- estimated rows 2
-- DELETE FROM public.port_congestion_snapshots
-- WHERE run_id = 'run_20260611053216802_9bc338fd'
--   AND run_id NOT IN ('run_20260612061752520_06a37656', 'run_20260612061752520_06a37656', 'run_20260612061752520_06a37656'); -- estimated rows 8
--
-- Candidate run_id: run_20260611052213874_65155e42
-- Reason: completed run outside recent 20 detailed runs
-- DELETE FROM public.opportunity_master
-- WHERE run_id = 'run_20260611052213874_65155e42'
--   AND run_id NOT IN ('run_20260612061752520_06a37656', 'run_20260612061752520_06a37656', 'run_20260612061752520_06a37656'); -- estimated rows 6
-- DELETE FROM public.port_congestion_snapshots
-- WHERE run_id = 'run_20260611052213874_65155e42'
--   AND run_id NOT IN ('run_20260612061752520_06a37656', 'run_20260612061752520_06a37656', 'run_20260612061752520_06a37656'); -- estimated rows 8
--
-- Candidate run_id: run_20260611051422321_0047505b
-- Reason: completed run outside recent 20 detailed runs
-- DELETE FROM public.opportunity_master
-- WHERE run_id = 'run_20260611051422321_0047505b'
--   AND run_id NOT IN ('run_20260612061752520_06a37656', 'run_20260612061752520_06a37656', 'run_20260612061752520_06a37656'); -- estimated rows 12
-- DELETE FROM public.port_congestion_snapshots
-- WHERE run_id = 'run_20260611051422321_0047505b'
--   AND run_id NOT IN ('run_20260612061752520_06a37656', 'run_20260612061752520_06a37656', 'run_20260612061752520_06a37656'); -- estimated rows 8
--
-- Candidate run_id: run_20260611040707989_3073fbe8
-- Reason: completed run outside recent 20 detailed runs
-- DELETE FROM public.opportunity_master
-- WHERE run_id = 'run_20260611040707989_3073fbe8'
--   AND run_id NOT IN ('run_20260612061752520_06a37656', 'run_20260612061752520_06a37656', 'run_20260612061752520_06a37656'); -- estimated rows 11
-- DELETE FROM public.port_congestion_snapshots
-- WHERE run_id = 'run_20260611040707989_3073fbe8'
--   AND run_id NOT IN ('run_20260612061752520_06a37656', 'run_20260612061752520_06a37656', 'run_20260612061752520_06a37656'); -- estimated rows 9
--
-- Candidate run_id: run_20260611035831134_55a86b88
-- Reason: completed run outside recent 20 detailed runs
-- DELETE FROM public.port_congestion_snapshots
-- WHERE run_id = 'run_20260611035831134_55a86b88'
--   AND run_id NOT IN ('run_20260612061752520_06a37656', 'run_20260612061752520_06a37656', 'run_20260612061752520_06a37656'); -- estimated rows 8
--
-- Candidate run_id: run_20260611035302244_18f586c4
-- Reason: completed run outside recent 20 detailed runs
-- DELETE FROM public.opportunity_master
-- WHERE run_id = 'run_20260611035302244_18f586c4'
--   AND run_id NOT IN ('run_20260612061752520_06a37656', 'run_20260612061752520_06a37656', 'run_20260612061752520_06a37656'); -- estimated rows 3
-- DELETE FROM public.port_congestion_snapshots
-- WHERE run_id = 'run_20260611035302244_18f586c4'
--   AND run_id NOT IN ('run_20260612061752520_06a37656', 'run_20260612061752520_06a37656', 'run_20260612061752520_06a37656'); -- estimated rows 8
--
-- Candidate run_id: run_20260611034748756_79da3159
-- Reason: completed run outside recent 20 detailed runs
-- DELETE FROM public.opportunity_master
-- WHERE run_id = 'run_20260611034748756_79da3159'
--   AND run_id NOT IN ('run_20260612061752520_06a37656', 'run_20260612061752520_06a37656', 'run_20260612061752520_06a37656'); -- estimated rows 2
-- DELETE FROM public.port_congestion_snapshots
-- WHERE run_id = 'run_20260611034748756_79da3159'
--   AND run_id NOT IN ('run_20260612061752520_06a37656', 'run_20260612061752520_06a37656', 'run_20260612061752520_06a37656'); -- estimated rows 8
--
-- Candidate run_id: run_20260611032538498_b4f7ac82
-- Reason: completed run outside recent 20 detailed runs
-- DELETE FROM public.opportunity_master
-- WHERE run_id = 'run_20260611032538498_b4f7ac82'
--   AND run_id NOT IN ('run_20260612061752520_06a37656', 'run_20260612061752520_06a37656', 'run_20260612061752520_06a37656'); -- estimated rows 4
-- DELETE FROM public.port_congestion_snapshots
-- WHERE run_id = 'run_20260611032538498_b4f7ac82'
--   AND run_id NOT IN ('run_20260612061752520_06a37656', 'run_20260612061752520_06a37656', 'run_20260612061752520_06a37656'); -- estimated rows 8
--
-- Candidate run_id: run_20260611032047881_cc3c1c41
-- Reason: completed run outside recent 20 detailed runs
-- DELETE FROM public.port_congestion_snapshots
-- WHERE run_id = 'run_20260611032047881_cc3c1c41'
--   AND run_id NOT IN ('run_20260612061752520_06a37656', 'run_20260612061752520_06a37656', 'run_20260612061752520_06a37656'); -- estimated rows 8
--
-- Candidate run_id: run_20260611031424592_8981c987
-- Reason: completed run outside recent 20 detailed runs
-- DELETE FROM public.port_congestion_snapshots
-- WHERE run_id = 'run_20260611031424592_8981c987'
--   AND run_id NOT IN ('run_20260612061752520_06a37656', 'run_20260612061752520_06a37656', 'run_20260612061752520_06a37656'); -- estimated rows 8
--
-- Candidate run_id: run_20260611030904330_ff81ea5b
-- Reason: completed run outside recent 20 detailed runs
-- DELETE FROM public.port_congestion_snapshots
-- WHERE run_id = 'run_20260611030904330_ff81ea5b'
--   AND run_id NOT IN ('run_20260612061752520_06a37656', 'run_20260612061752520_06a37656', 'run_20260612061752520_06a37656'); -- estimated rows 8
--
-- Candidate run_id: run_20260611023859390_d3f7ea00
-- Reason: completed run outside recent 20 detailed runs
-- DELETE FROM public.opportunity_master
-- WHERE run_id = 'run_20260611023859390_d3f7ea00'
--   AND run_id NOT IN ('run_20260612061752520_06a37656', 'run_20260612061752520_06a37656', 'run_20260612061752520_06a37656'); -- estimated rows 7
-- DELETE FROM public.port_congestion_snapshots
-- WHERE run_id = 'run_20260611023859390_d3f7ea00'
--   AND run_id NOT IN ('run_20260612061752520_06a37656', 'run_20260612061752520_06a37656', 'run_20260612061752520_06a37656'); -- estimated rows 8
--
-- Candidate table: vessel_snapshots
-- Reason: run-level detailed snapshot table
-- -- Table-level cleanup requires a reviewed retention predicate before use.
-- DELETE FROM public.vessel_snapshots
-- WHERE <reviewed_retention_predicate>
--   AND COALESCE(run_id, '') NOT IN ('run_20260612061752520_06a37656', 'run_20260612061752520_06a37656', 'run_20260612061752520_06a37656'); -- estimated rows 1009
--
-- Candidate table: port_call_master
-- Reason: run-level detailed snapshot table
-- -- Table-level cleanup requires a reviewed retention predicate before use.
-- DELETE FROM public.port_call_master
-- WHERE <reviewed_retention_predicate>
--   AND COALESCE(run_id, '') NOT IN ('run_20260612061752520_06a37656', 'run_20260612061752520_06a37656', 'run_20260612061752520_06a37656'); -- estimated rows 1009
--
-- Candidate table: opportunity_master
-- Reason: run-level detailed snapshot table
-- -- Table-level cleanup requires a reviewed retention predicate before use.
-- DELETE FROM public.opportunity_master
-- WHERE <reviewed_retention_predicate>
--   AND COALESCE(run_id, '') NOT IN ('run_20260612061752520_06a37656', 'run_20260612061752520_06a37656', 'run_20260612061752520_06a37656'); -- estimated rows 6698
--
-- Candidate table: port_congestion_snapshots
-- Reason: short-term operational/cache table
-- -- Table-level cleanup requires a reviewed retention predicate before use.
-- DELETE FROM public.port_congestion_snapshots
-- WHERE <reviewed_retention_predicate>
--   AND COALESCE(run_id, '') NOT IN ('run_20260612061752520_06a37656', 'run_20260612061752520_06a37656', 'run_20260612061752520_06a37656'); -- estimated rows 1046
--
-- Candidate table: enrichment_match_candidates
-- Reason: short-term operational/cache table
-- -- Table-level cleanup requires a reviewed retention predicate before use.
-- DELETE FROM public.enrichment_match_candidates
-- WHERE <reviewed_retention_predicate>
--   AND COALESCE(run_id, '') NOT IN ('run_20260612061752520_06a37656', 'run_20260612061752520_06a37656', 'run_20260612061752520_06a37656'); -- estimated rows 692
--
-- Candidate table: imo_recovery_queue
-- Reason: short-term operational/cache table
-- -- Table-level cleanup requires a reviewed retention predicate before use.
-- DELETE FROM public.imo_recovery_queue
-- WHERE <reviewed_retention_predicate>
--   AND COALESCE(run_id, '') NOT IN ('run_20260612061752520_06a37656', 'run_20260612061752520_06a37656', 'run_20260612061752520_06a37656'); -- estimated rows 4575
--
-- Candidate table: vessel_identity_candidates
-- Reason: short-term operational/cache table
-- -- Table-level cleanup requires a reviewed retention predicate before use.
-- DELETE FROM public.vessel_identity_candidates
-- WHERE <reviewed_retention_predicate>
--   AND COALESCE(run_id, '') NOT IN ('run_20260612061752520_06a37656', 'run_20260612061752520_06a37656', 'run_20260612061752520_06a37656'); -- estimated rows 1009
--
-- Candidate table: source_collection_logs
-- Reason: short-term operational/cache table
-- -- Table-level cleanup requires a reviewed retention predicate before use.
-- DELETE FROM public.source_collection_logs
-- WHERE <reviewed_retention_predicate>
--   AND COALESCE(run_id, '') NOT IN ('run_20260612061752520_06a37656', 'run_20260612061752520_06a37656', 'run_20260612061752520_06a37656'); -- estimated rows 35
--
-- COMMIT;
```

## Review Checklist

- [ ] Confirm active_run_id and latest_successful_run_id are protected.
- [ ] Take a database backup or export before applying any cleanup.
- [ ] Run SELECT COUNT(*) with the same WHERE predicates before uncommenting DELETE statements.
- [ ] Apply cleanup in small batches and validate dashboard/api/bootstrap.json after each batch.
- [ ] Keep vessel_master, active_dataset_pointer, current serving rows, and commercial history protected.
