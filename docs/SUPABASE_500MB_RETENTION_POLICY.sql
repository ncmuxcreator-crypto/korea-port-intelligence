-- Korea Port Intelligence Supabase 500MB Retention Policy
-- Goal: keep the Free Plan database below 500MB by keeping only the active run
-- and the latest promoted run for bulky run-scoped tables.
--
-- This preserves the dashboard's active dataset and one successful fallback run.
-- Historical raw/detail data should live in generated JSON artifacts or external archive, not Supabase.

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
  limit 1
) latest_promoted;

select 'keeping_run' as action, run_id
from hwk_keep_runs;

delete from vessel_snapshots where run_id is not null and run_id not in (select run_id from hwk_keep_runs);
delete from operator_contact_history where run_id is not null and run_id not in (select run_id from hwk_keep_runs);
delete from operator_history where run_id is not null and run_id not in (select run_id from hwk_keep_runs);
delete from vessel_operator_history where run_id is not null and run_id not in (select run_id from hwk_keep_runs);
delete from predicted_arrivals where run_id is not null and run_id not in (select run_id from hwk_keep_runs);
delete from vessel_identity_candidates where run_id is not null and run_id not in (select run_id from hwk_keep_runs);
delete from vessel_route_history where run_id is not null and run_id not in (select run_id from hwk_keep_runs);
delete from rule_evaluations where run_id is not null and run_id not in (select run_id from hwk_keep_runs);
delete from explainability_snapshots where run_id is not null and run_id not in (select run_id from hwk_keep_runs);
delete from risk_history where run_id is not null and run_id not in (select run_id from hwk_keep_runs);
delete from feature_store where run_id is not null and run_id not in (select run_id from hwk_keep_runs);
delete from feature_snapshots where run_id is not null and run_id not in (select run_id from hwk_keep_runs);
delete from model_training_rows where run_id is not null and run_id not in (select run_id from hwk_keep_runs);
delete from source_collection_logs where run_id is not null and run_id not in (select run_id from hwk_keep_runs);
delete from port_call_master where run_id is not null and run_id not in (select run_id from hwk_keep_runs);
delete from vessel_snapshot_daily where run_id is not null and run_id not in (select run_id from hwk_keep_runs);
delete from commercial_opportunity_daily where run_id is not null and run_id not in (select run_id from hwk_keep_runs);
delete from dashboard_summary_snapshots
where coalesce(is_latest_successful, false) = false
  and run_id is not null
  and run_id not in (select run_id from hwk_keep_runs);

delete from port_calls where collected_at < now() - interval '2 days';
delete from pilot_schedule_events where created_at < now() - interval '3 days';
delete from port_congestion_snapshots where collected_at < now() - interval '3 days';
delete from anchorage_clusters where collected_at < now() - interval '3 days';
delete from berth_occupancy_history where collected_at < now() - interval '3 days';
delete from raw_archive_index where created_at < now() - interval '14 days';

vacuum (analyze) vessel_snapshots;
vacuum (analyze) operator_contact_history;
vacuum (analyze) operator_history;
vacuum (analyze) vessel_operator_history;
vacuum (analyze) predicted_arrivals;
vacuum (analyze) vessel_identity_candidates;
vacuum (analyze) vessel_route_history;
vacuum (analyze) rule_evaluations;
vacuum (analyze) explainability_snapshots;
vacuum (analyze) risk_history;
vacuum (analyze) feature_store;
vacuum (analyze) feature_snapshots;
vacuum (analyze) model_training_rows;
vacuum (analyze) source_collection_logs;
vacuum (analyze) port_call_master;

select
  relname as table_name,
  n_live_tup as estimated_rows,
  pg_size_pretty(pg_total_relation_size(relid)) as total_size,
  pg_total_relation_size(relid) as bytes
from pg_stat_user_tables
order by pg_total_relation_size(relid) desc
limit 30;

select coalesce(pg_size_pretty(sum(pg_total_relation_size(relid))), '0 bytes') as estimated_total_user_table_size
from pg_stat_user_tables;
