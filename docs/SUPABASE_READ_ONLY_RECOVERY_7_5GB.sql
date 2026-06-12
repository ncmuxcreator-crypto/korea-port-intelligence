-- Korea Port Intelligence Supabase read-only recovery for Pro 7.5GB operation
--
-- Use when Supabase has put the project into read-only mode because storage
-- limits were exceeded. This follows Supabase's documented recovery sequence:
-- 1. make the current SQL session read-write
-- 2. delete old data
-- 3. vacuum to reclaim reusable space
-- 4. turn default read-only mode off
--
-- Source:
-- https://supabase.com/docs/guides/platform/database-size#disabling-read-only-mode

set session characteristics as transaction read write;

select 'before_recovery' as phase,
       pg_size_pretty(pg_database_size(current_database())) as database_size,
       pg_database_size(current_database()) as database_bytes;

create temporary table hwk_keep_runs as
select active_run_id as run_id
from active_dataset_pointer
where id = 'current' and active_run_id is not null
union
select run_id
from (
  select run_id
  from data_collection_runs
  where status = 'promoted'
  order by started_at desc
  limit 30
) latest_promoted;

select 'keeping_run' as action, run_id
from hwk_keep_runs
order by run_id;

create index if not exists idx_port_calls_vessel_id on public.port_calls(vessel_id);

delete from vessel_snapshots
where run_id is not null
  and run_id not in (select run_id from hwk_keep_runs)
  and collected_at < now() - interval '14 days';

delete from port_call_master
where run_id is not null
  and run_id not in (select run_id from hwk_keep_runs)
  and coalesce(last_seen, created_at, now()) < now() - interval '120 days';

delete from source_collection_logs
where run_id is not null
  and run_id not in (select run_id from hwk_keep_runs)
  and started_at < now() - interval '60 days';

delete from port_calls
where collected_at < now() - interval '30 days';

delete from pilot_schedule_events
where created_at < now() - interval '30 days';

delete from port_congestion_snapshots
where collected_at < now() - interval '60 days';

delete from anchorage_clusters
where collected_at < now() - interval '60 days';

delete from berth_occupancy_history
where collected_at < now() - interval '60 days';

delete from vessel_events
where run_id is not null
  and run_id not in (select run_id from hwk_keep_runs)
  and created_at < now() - interval '60 days';

delete from risk_history
where run_id is not null
  and run_id not in (select run_id from hwk_keep_runs)
  and collected_at < now() - interval '90 days';

delete from feature_store
where run_id is not null
  and run_id not in (select run_id from hwk_keep_runs)
  and collected_at < now() - interval '90 days';

delete from feature_snapshots
where run_id is not null
  and run_id not in (select run_id from hwk_keep_runs)
  and snapshot_time < now() - interval '90 days';

delete from rule_evaluations
where run_id is not null
  and run_id not in (select run_id from hwk_keep_runs)
  and collected_at < now() - interval '60 days';

delete from explainability_snapshots
where run_id is not null
  and run_id not in (select run_id from hwk_keep_runs)
  and collected_at < now() - interval '90 days';

delete from model_training_rows
where run_id is not null
  and run_id not in (select run_id from hwk_keep_runs)
  and collected_at < now() - interval '180 days';

delete from operator_contact_history
where run_id is not null
  and run_id not in (select run_id from hwk_keep_runs)
  and collected_at < now() - interval '90 days';

delete from operator_history
where run_id is not null
  and run_id not in (select run_id from hwk_keep_runs)
  and collected_at < now() - interval '90 days';

delete from vessel_operator_history
where run_id is not null
  and run_id not in (select run_id from hwk_keep_runs)
  and collected_at < now() - interval '90 days';

delete from vessel_identity_candidates
where run_id is not null
  and run_id not in (select run_id from hwk_keep_runs)
  and collected_at < now() - interval '45 days';

delete from predicted_arrivals
where run_id is not null
  and run_id not in (select run_id from hwk_keep_runs)
  and created_at < now() - interval '90 days';

delete from vessel_route_history
where run_id is not null
  and run_id not in (select run_id from hwk_keep_runs)
  and created_at < now() - interval '90 days';

delete from operator_fleet_opportunities
where run_id is not null
  and run_id not in (select run_id from hwk_keep_runs)
  and created_at < now() - interval '90 days';

delete from commercial_leads
where updated_at < now() - interval '90 days'
  and coalesce(lead_status, '') in ('closed', 'lost', 'stale');

delete from dashboard_summary_snapshots
where coalesce(is_latest_successful, false) = false
  and run_id is not null
  and run_id not in (select run_id from hwk_keep_runs)
  and generated_at < now() - interval '180 days';

delete from vessel_snapshot_daily
where run_id is not null
  and run_id not in (select run_id from hwk_keep_runs)
  and snapshot_date < current_date - 365;

delete from port_snapshot_daily
where run_id is not null
  and run_id not in (select run_id from hwk_keep_runs)
  and snapshot_date < current_date - 365;

delete from operator_snapshot_daily
where run_id is not null
  and run_id not in (select run_id from hwk_keep_runs)
  and snapshot_date < current_date - 365;

delete from route_snapshot_daily
where run_id is not null
  and run_id not in (select run_id from hwk_keep_runs)
  and snapshot_date < current_date - 365;

delete from commercial_opportunity_daily
where run_id is not null
  and run_id not in (select run_id from hwk_keep_runs)
  and snapshot_date < current_date - 365;

delete from raw_archive_index
where created_at < now() - interval '365 days';

delete from data_collection_runs
where run_id not in (select run_id from hwk_keep_runs)
  and started_at < now() - interval '180 days';

delete from pipeline_runs
where run_started_at < now() - interval '180 days';

vacuum;

set default_transaction_read_only = 'off';

select 'after_recovery' as phase,
       pg_size_pretty(pg_database_size(current_database())) as database_size,
       pg_database_size(current_database()) as database_bytes;

select
  relname as table_name,
  n_live_tup as estimated_rows,
  n_dead_tup as estimated_dead_rows,
  pg_size_pretty(pg_total_relation_size(relid)) as total_size,
  pg_total_relation_size(relid) as bytes
from pg_stat_user_tables
order by pg_total_relation_size(relid) desc
limit 30;
