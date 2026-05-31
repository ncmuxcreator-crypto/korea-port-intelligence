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

comment on view hwk_storage_table_sizes is 'HWK Supabase storage triage view. Shows estimated rows and table/index/toast size by table.';

create index if not exists idx_pipeline_runs_started_at on pipeline_runs(run_started_at desc);
create index if not exists idx_data_collection_runs_started_at on data_collection_runs(started_at desc);
create index if not exists idx_dashboard_summary_snapshots_generated_at on dashboard_summary_snapshots(generated_at desc);
create index if not exists idx_sales_candidates_current_stale on sales_candidates_current(is_current, updated_at desc);
create index if not exists idx_immediate_targets_current_stale on immediate_targets_current(is_current, updated_at desc);
create index if not exists idx_port_summary_current_stale on port_summary_current(is_current, updated_at desc);
create index if not exists idx_operator_contact_history_collected_at on operator_contact_history(collected_at desc);
create index if not exists idx_vessel_operator_history_collected_at on vessel_operator_history(collected_at desc);
create index if not exists idx_operator_history_collected_at on operator_history(collected_at desc);
create index if not exists idx_operator_fleet_opportunities_created_at on operator_fleet_opportunities(created_at desc);
create index if not exists idx_vessel_route_history_created_at on vessel_route_history(created_at desc);
create index if not exists idx_predicted_arrivals_created_at on predicted_arrivals(created_at desc);
create index if not exists idx_commercial_leads_updated_at on commercial_leads(updated_at desc);
create index if not exists idx_raw_archive_index_created_at on raw_archive_index(created_at desc);
create index if not exists idx_risk_history_collected_at on risk_history(collected_at desc);
create index if not exists idx_anchorage_clusters_collected_at on anchorage_clusters(collected_at desc);
create index if not exists idx_berth_occupancy_history_collected_at on berth_occupancy_history(collected_at desc);
create index if not exists idx_pilot_schedule_events_created_at on pilot_schedule_events(created_at desc);
create index if not exists idx_rule_evaluations_collected_at on rule_evaluations(collected_at desc);
create index if not exists idx_model_training_rows_collected_at on model_training_rows(collected_at desc);
create index if not exists idx_explainability_snapshots_collected_at on explainability_snapshots(collected_at desc);
