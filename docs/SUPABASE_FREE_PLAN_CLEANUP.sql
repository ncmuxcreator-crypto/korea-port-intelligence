-- Korea Port Intelligence Supabase Free Plan Cleanup
-- Purpose: reduce database size while preserving the active dashboard run and latest successful summary.
-- Run section 1 first, then section 2 if the database is over the free-plan limit.
-- Supabase usage numbers can take up to about 1 hour to refresh after cleanup.

create or replace view hwk_storage_table_sizes as
select
  schemaname,
  relname as table_name,
  n_live_tup as estimated_live_rows,
  n_dead_tup as estimated_dead_rows,
  pg_total_relation_size(relid) as total_bytes,
  pg_size_pretty(pg_total_relation_size(relid)) as total_size,
  pg_size_pretty(pg_relation_size(relid)) as table_size,
  pg_size_pretty(pg_total_relation_size(relid) - pg_relation_size(relid)) as index_and_toast_size
from pg_stat_user_tables
order by pg_total_relation_size(relid) desc;

-- 1) Size report: largest tables first.
select *
from hwk_storage_table_sizes
order by total_bytes desc
limit 30;

-- 2) Emergency cleanup for append-only run data.
-- Keeps:
-- - active_dataset_pointer.active_run_id
-- - dashboard_summary_snapshots.is_latest_successful = true
-- - master/reference/contact/opportunity tables

delete from port_calls
where collected_at < now() - interval '3 days';

delete from vessel_snapshots
where collected_at < now() - interval '2 days'
  and coalesce(run_id, '') <> coalesce((select active_run_id from active_dataset_pointer where id = 'current'), '__no_active_run__');

delete from port_call_master
where last_seen < now() - interval '14 days'
  and coalesce(run_id, '') <> coalesce((select active_run_id from active_dataset_pointer where id = 'current'), '__no_active_run__');

delete from risk_history
where collected_at < now() - interval '7 days'
  and coalesce(run_id, '') <> coalesce((select active_run_id from active_dataset_pointer where id = 'current'), '__no_active_run__');

delete from enrichment_match_candidates
where created_at < now() - interval '3 days'
  and coalesce(run_id, '') <> coalesce((select active_run_id from active_dataset_pointer where id = 'current'), '__no_active_run__');

delete from source_collection_logs
where started_at < now() - interval '14 days'
  and coalesce(run_id, '') <> coalesce((select active_run_id from active_dataset_pointer where id = 'current'), '__no_active_run__');

delete from dashboard_summary_snapshots
where generated_at < now() - interval '30 days'
  and coalesce(is_latest_successful, false) = false
  and coalesce(run_id, '') <> coalesce((select active_run_id from active_dataset_pointer where id = 'current'), '__no_active_run__');

delete from sales_candidates_current
where updated_at < now() - interval '3 days'
  and is_current = false
  and coalesce(run_id, '') <> coalesce((select active_run_id from active_dataset_pointer where id = 'current'), '__no_active_run__');

delete from immediate_targets_current
where updated_at < now() - interval '3 days'
  and is_current = false
  and coalesce(run_id, '') <> coalesce((select active_run_id from active_dataset_pointer where id = 'current'), '__no_active_run__');

delete from port_summary_current
where updated_at < now() - interval '3 days'
  and is_current = false
  and coalesce(run_id, '') <> coalesce((select active_run_id from active_dataset_pointer where id = 'current'), '__no_active_run__');

delete from vessel_events
where created_at < now() - interval '7 days'
  and coalesce(run_id, '') <> coalesce((select active_run_id from active_dataset_pointer where id = 'current'), '__no_active_run__');

delete from pilot_schedule_events
where created_at < now() - interval '7 days'
  and coalesce(run_id, '') <> coalesce((select active_run_id from active_dataset_pointer where id = 'current'), '__no_active_run__');

delete from port_congestion_snapshots
where collected_at < now() - interval '7 days'
  and coalesce(run_id, '') <> coalesce((select active_run_id from active_dataset_pointer where id = 'current'), '__no_active_run__');

delete from anchorage_clusters
where collected_at < now() - interval '7 days'
  and coalesce(run_id, '') <> coalesce((select active_run_id from active_dataset_pointer where id = 'current'), '__no_active_run__');

delete from berth_occupancy_history
where collected_at < now() - interval '7 days'
  and coalesce(run_id, '') <> coalesce((select active_run_id from active_dataset_pointer where id = 'current'), '__no_active_run__');

delete from vessel_identity_candidates
where collected_at < now() - interval '7 days'
  and coalesce(run_id, '') <> coalesce((select active_run_id from active_dataset_pointer where id = 'current'), '__no_active_run__');

delete from vessel_operator_history
where collected_at < now() - interval '14 days'
  and coalesce(run_id, '') <> coalesce((select active_run_id from active_dataset_pointer where id = 'current'), '__no_active_run__');

delete from operator_history
where collected_at < now() - interval '14 days'
  and coalesce(run_id, '') <> coalesce((select active_run_id from active_dataset_pointer where id = 'current'), '__no_active_run__');

delete from operator_contact_history
where collected_at < now() - interval '14 days'
  and coalesce(run_id, '') <> coalesce((select active_run_id from active_dataset_pointer where id = 'current'), '__no_active_run__');

delete from predicted_arrivals
where created_at < now() - interval '14 days'
  and coalesce(run_id, '') <> coalesce((select active_run_id from active_dataset_pointer where id = 'current'), '__no_active_run__');

delete from vessel_route_history
where created_at < now() - interval '14 days'
  and coalesce(run_id, '') <> coalesce((select active_run_id from active_dataset_pointer where id = 'current'), '__no_active_run__');

delete from operator_fleet_opportunities
where created_at < now() - interval '14 days'
  and coalesce(run_id, '') <> coalesce((select active_run_id from active_dataset_pointer where id = 'current'), '__no_active_run__');

delete from commercial_leads
where updated_at < now() - interval '14 days'
  and coalesce(run_id, '') <> coalesce((select active_run_id from active_dataset_pointer where id = 'current'), '__no_active_run__');

delete from raw_archive_index
where created_at < now() - interval '30 days'
  and coalesce(run_id, '') <> coalesce((select active_run_id from active_dataset_pointer where id = 'current'), '__no_active_run__');

delete from feature_store
where collected_at < now() - interval '7 days'
  and coalesce(run_id, '') <> coalesce((select active_run_id from active_dataset_pointer where id = 'current'), '__no_active_run__');

delete from feature_snapshots
where snapshot_time < now() - interval '7 days'
  and coalesce(run_id, '') <> coalesce((select active_run_id from active_dataset_pointer where id = 'current'), '__no_active_run__');

delete from rule_evaluations
where collected_at < now() - interval '7 days'
  and coalesce(run_id, '') <> coalesce((select active_run_id from active_dataset_pointer where id = 'current'), '__no_active_run__');

delete from model_training_rows
where collected_at < now() - interval '7 days'
  and coalesce(run_id, '') <> coalesce((select active_run_id from active_dataset_pointer where id = 'current'), '__no_active_run__');

delete from explainability_snapshots
where collected_at < now() - interval '7 days'
  and coalesce(run_id, '') <> coalesce((select active_run_id from active_dataset_pointer where id = 'current'), '__no_active_run__');

delete from vessel_snapshot_daily
where snapshot_date < current_date - interval '30 days'
  and coalesce(run_id, '') <> coalesce((select active_run_id from active_dataset_pointer where id = 'current'), '__no_active_run__');

delete from port_snapshot_daily
where snapshot_date < current_date - interval '30 days'
  and coalesce(run_id, '') <> coalesce((select active_run_id from active_dataset_pointer where id = 'current'), '__no_active_run__');

delete from operator_snapshot_daily
where snapshot_date < current_date - interval '30 days'
  and coalesce(run_id, '') <> coalesce((select active_run_id from active_dataset_pointer where id = 'current'), '__no_active_run__');

delete from route_snapshot_daily
where snapshot_date < current_date - interval '30 days'
  and coalesce(run_id, '') <> coalesce((select active_run_id from active_dataset_pointer where id = 'current'), '__no_active_run__');

delete from commercial_opportunity_daily
where snapshot_date < current_date - interval '30 days'
  and coalesce(run_id, '') <> coalesce((select active_run_id from active_dataset_pointer where id = 'current'), '__no_active_run__');

delete from data_collection_runs
where started_at < now() - interval '30 days'
  and coalesce(run_id, '') <> coalesce((select active_run_id from active_dataset_pointer where id = 'current'), '__no_active_run__');

delete from pipeline_runs
where run_started_at < now() - interval '30 days';

-- 3) Update planner statistics. This can help Supabase show a more accurate live-row picture.
vacuum (analyze) port_calls;
vacuum (analyze) vessel_snapshots;
vacuum (analyze) port_call_master;
vacuum (analyze) risk_history;
vacuum (analyze) enrichment_match_candidates;
vacuum (analyze) vessel_events;
vacuum (analyze) pilot_schedule_events;
vacuum (analyze) port_congestion_snapshots;
vacuum (analyze) vessel_identity_candidates;
vacuum (analyze) feature_store;
vacuum (analyze) feature_snapshots;
vacuum (analyze) rule_evaluations;
vacuum (analyze) model_training_rows;
vacuum (analyze) explainability_snapshots;

-- Optional hard shrink:
-- DELETE makes old rows reusable, but PostgreSQL may not immediately return file size to Supabase quota.
-- If Database Size is still over quota after section 2 and section 3, run VACUUM FULL on the largest tables
-- one table at a time during a quiet period. It locks the table while it runs.
-- vacuum (full, analyze) vessel_snapshots;
-- vacuum (full, analyze) port_call_master;
-- vacuum (full, analyze) pilot_schedule_events;
-- vacuum (full, analyze) enrichment_match_candidates;
-- vacuum (full, analyze) risk_history;

-- 4) Check size again.
select *
from hwk_storage_table_sizes
order by total_bytes desc
limit 30;
