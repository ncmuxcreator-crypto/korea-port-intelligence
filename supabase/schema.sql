create table if not exists vessels (
  vessel_id text primary key,
  imo text,
  vessel_name text not null,
  vessel_type text,
  operator text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists port_calls (
  id bigserial primary key,
  vessel_id text references vessels(vessel_id),
  vessel_name text not null,
  imo text,
  port text not null,
  berth text,
  eta timestamptz,
  etd timestamptz,
  status text,
  source text not null,
  collected_at timestamptz not null,
  risk_score int default 0,
  sales_reason jsonb default '[]'::jsonb,
  raw_payload jsonb,
  unique_key text unique
);

create table if not exists vessel_snapshots (
  id bigserial primary key,
  snapshot_id bigserial,
  run_id text,
  snapshot_date date not null,
  source_name text,
  master_vessel_id text,
  port_code text,
  port_name text,
  berth_name text,
  anchorage_name text,
  call_sign text,
  imo text,
  mmsi text,
  vessel_type text,
  gt numeric,
  ata timestamptz,
  etb timestamptz,
  atb timestamptz,
  atd timestamptz,
  stay_hours numeric default 0,
  berth_hours numeric default 0,
  anchorage_hours numeric default 0,
  data_quality_tier text,
  total_sales_priority_score int default 0,
  commercial_value_score int default 0,
  commercial_value_band text,
  data_confidence_score int default 0,
  candidate_band text,
  reason_codes jsonb default '[]'::jsonb,
  vessel_id text not null,
  vessel_name text,
  port text,
  status text,
  operator text,
  berth text,
  eta timestamptz,
  etd timestamptz,
  source text,
  risk_score int default 0,
  sales_reason jsonb default '[]'::jsonb,
  hybrid_entity_key text,
  payload jsonb default '{}'::jsonb,
  updated_at timestamptz,
  collected_at timestamptz not null
);

create table if not exists pipeline_runs (
  id bigserial primary key,
  run_started_at timestamptz not null,
  run_finished_at timestamptz,
  status text not null,
  records_collected int default 0,
  records_saved int default 0,
  errors jsonb default '[]'::jsonb
);

create table if not exists data_collection_runs (
  run_id text primary key,
  started_at timestamptz not null,
  finished_at timestamptz,
  status text not null,
  source_summary jsonb default '{}'::jsonb,
  total_rows int default 0,
  raw_collected_rows int default 0,
  normalized_rows int default 0,
  all_vessels_count int default 0,
  target_vessels_count int default 0,
  gt_5000_plus_count int default 0,
  unknown_gt_review_count int default 0,
  staying_vessels_count int default 0,
  arrival_pipeline_count int default 0,
  scored_vessels_count int default 0,
  candidates_count int default 0,
  sales_candidates_count int default 0,
  immediate_targets_count int default 0,
  imo_missing_count int default 0,
  imo_recovered_count int default 0,
  high_value_low_confidence_count int default 0,
  actionable_rows int default 0,
  validation_status text,
  error_summary jsonb default '{}'::jsonb,
  promoted_at timestamptz
);

create table if not exists active_dataset_pointer (
  id text primary key default 'current',
  active_run_id text,
  active_collected_at timestamptz,
  promoted_at timestamptz,
  data_age_minutes int default 0,
  is_stale boolean default false
);

create index if not exists idx_port_calls_collected_at on port_calls(collected_at desc);
create index if not exists idx_port_calls_port on port_calls(port);
create index if not exists idx_port_calls_risk_score on port_calls(risk_score desc);
create index if not exists idx_vessel_snapshots_date on vessel_snapshots(snapshot_date desc);

alter table vessel_snapshots add column if not exists vessel_name text;
alter table vessel_snapshots add column if not exists operator text;
alter table vessel_snapshots add column if not exists source text;
alter table vessel_snapshots add column if not exists updated_at timestamptz;
alter table vessel_snapshots add column if not exists payload jsonb default '{}'::jsonb;
alter table vessel_snapshots add column if not exists hybrid_entity_key text;
alter table vessel_snapshots add column if not exists run_id text;
alter table vessel_snapshots add column if not exists source_name text;
alter table vessel_snapshots add column if not exists master_vessel_id text;
alter table vessel_snapshots add column if not exists port_code text;
alter table vessel_snapshots add column if not exists port_name text;
alter table vessel_snapshots add column if not exists berth_name text;
alter table vessel_snapshots add column if not exists anchorage_name text;
alter table vessel_snapshots add column if not exists call_sign text;
alter table vessel_snapshots add column if not exists imo text;
alter table vessel_snapshots add column if not exists mmsi text;
alter table vessel_snapshots add column if not exists vessel_type text;
alter table vessel_snapshots add column if not exists gt numeric;
alter table vessel_snapshots add column if not exists ata timestamptz;
alter table vessel_snapshots add column if not exists etb timestamptz;
alter table vessel_snapshots add column if not exists atb timestamptz;
alter table vessel_snapshots add column if not exists atd timestamptz;
alter table vessel_snapshots add column if not exists stay_hours numeric default 0;
alter table vessel_snapshots add column if not exists berth_hours numeric default 0;
alter table vessel_snapshots add column if not exists anchorage_hours numeric default 0;
alter table vessel_snapshots add column if not exists data_quality_tier text;
alter table vessel_snapshots add column if not exists total_sales_priority_score int default 0;
alter table vessel_snapshots add column if not exists commercial_value_score int default 0;
alter table vessel_snapshots add column if not exists commercial_value_band text;
alter table vessel_snapshots add column if not exists data_confidence_score int default 0;
alter table vessel_snapshots add column if not exists candidate_band text;
alter table vessel_snapshots add column if not exists reason_codes jsonb default '[]'::jsonb;
alter table vessel_snapshots drop constraint if exists vessel_snapshots_snapshot_date_vessel_id_port_key;
create index if not exists idx_vessel_snapshots_hybrid_entity_key on vessel_snapshots(hybrid_entity_key);
create index if not exists idx_vessel_snapshots_collected_at on vessel_snapshots(collected_at desc);
create index if not exists idx_vessel_snapshots_run_id on vessel_snapshots(run_id);

create table if not exists vessel_entities (
  hybrid_entity_key text primary key,
  vessel_id text,
  vessel_name text,
  imo text,
  mmsi text,
  call_sign text,
  vessel_type text,
  vessel_type_group text,
  gt numeric,
  operator text,
  first_seen_at timestamptz default now(),
  last_seen_at timestamptz default now(),
  payload jsonb default '{}'::jsonb
);

create table if not exists vessel_master (
  master_vessel_id text primary key,
  imo text,
  mmsi text,
  call_sign text,
  canonical_name text,
  normalized_name text,
  vessel_type text,
  gt numeric,
  dwt numeric,
  loa numeric,
  beam numeric,
  operator text,
  operator_normalized text,
  flag text,
  identity_confidence int default 0,
  imo_status text,
  first_seen timestamptz default now(),
  last_seen timestamptz default now(),
  updated_at timestamptz default now(),
  payload jsonb default '{}'::jsonb
);

create table if not exists vessel_aliases (
  id bigserial primary key,
  alias_id bigserial,
  alias_name text not null,
  normalized_alias_name text,
  master_vessel_id text not null,
  source text,
  confidence int default 0,
  first_seen timestamptz default now(),
  last_seen timestamptz default now(),
  created_at timestamptz default now(),
  unique(alias_name, master_vessel_id, source)
);

create table if not exists vessel_identity_candidates (
  id bigserial primary key,
  candidate_id bigserial,
  run_id text,
  hybrid_entity_key text,
  vessel_id text,
  vessel_name text,
  raw_vessel_name text,
  normalized_name text,
  call_sign text,
  mmsi text,
  gt numeric,
  port_code text,
  likely_master_vessel_id text,
  confidence int default 0,
  resolution_status text,
  likely_imo_candidates jsonb default '[]'::jsonb,
  confidence_band text,
  manual_review_required boolean default false,
  collected_at timestamptz default now(),
  payload jsonb default '{}'::jsonb
);

create table if not exists vessel_events (
  id bigserial primary key,
  event_id bigserial,
  hybrid_entity_key text,
  master_vessel_id text,
  run_id text,
  vessel_id text,
  event_type text not null,
  event_time timestamptz,
  port_code text,
  berth_name text,
  confidence int default 0,
  source_name text,
  port text,
  event_at timestamptz not null default now(),
  payload jsonb default '{}'::jsonb
);

create table if not exists risk_history (
  id bigserial primary key,
  risk_id bigserial,
  run_id text,
  master_vessel_id text,
  hybrid_entity_key text,
  vessel_id text,
  port text,
  total_sales_priority_score int default 0,
  commercial_value_score int default 0,
  data_confidence_score int default 0,
  biofouling_risk_score int default 0,
  performance_proxy_score int default 0,
  congestion_exposure_score int default 0,
  cleaning_window_score int default 0,
  compliance_pressure_score int default 0,
  commercial_fit_score int default 0,
  candidate_band text,
  reason_codes jsonb default '[]'::jsonb,
  collected_at timestamptz not null default now(),
  payload jsonb default '{}'::jsonb
);

create table if not exists port_congestion_snapshots (
  id bigserial primary key,
  congestion_id bigserial,
  run_id text,
  port_code text,
  port_name text,
  total_vessels int default 0,
  anchorage_vessels int default 0,
  long_idle_vessels int default 0,
  average_waiting_hours numeric default 0,
  berth_occupancy_proxy numeric default 0,
  anchorage_density_score int default 0,
  port_congestion_score int default 0,
  collected_at timestamptz not null default now(),
  payload jsonb default '{}'::jsonb
);

create table if not exists anchorage_clusters (
  id bigserial primary key,
  cluster_id bigserial,
  run_id text,
  port_code text,
  port_name text,
  anchorage_name text,
  vessel_count int default 0,
  avg_idle_hours numeric default 0,
  density_score int default 0,
  collected_at timestamptz not null default now(),
  payload jsonb default '{}'::jsonb
);

create table if not exists berth_occupancy_history (
  id bigserial primary key,
  berth_history_id bigserial,
  run_id text,
  port_code text,
  port_name text,
  berth_name text,
  occupied_vessels int default 0,
  occupancy_proxy int default 0,
  expected_turnover_time numeric default 0,
  collected_at timestamptz not null default now(),
  payload jsonb default '{}'::jsonb
);

create index if not exists idx_vessel_master_imo on vessel_master(imo);
create index if not exists idx_vessel_master_mmsi on vessel_master(mmsi);
create index if not exists idx_vessel_identity_candidates_collected_at on vessel_identity_candidates(collected_at desc);
create index if not exists idx_port_congestion_snapshots_collected_at on port_congestion_snapshots(collected_at desc);
create index if not exists idx_data_collection_runs_status on data_collection_runs(status);
create index if not exists idx_active_dataset_pointer_active_run_id on active_dataset_pointer(active_run_id);

alter table data_collection_runs add column if not exists raw_collected_rows int default 0;
alter table data_collection_runs add column if not exists normalized_rows int default 0;
alter table data_collection_runs add column if not exists target_vessels_count int default 0;
alter table data_collection_runs add column if not exists gt_5000_plus_count int default 0;
alter table data_collection_runs add column if not exists unknown_gt_review_count int default 0;
alter table data_collection_runs add column if not exists staying_vessels_count int default 0;
alter table data_collection_runs add column if not exists arrival_pipeline_count int default 0;
alter table data_collection_runs add column if not exists sales_candidates_count int default 0;
alter table data_collection_runs add column if not exists imo_missing_count int default 0;
alter table data_collection_runs add column if not exists imo_recovered_count int default 0;
alter table data_collection_runs add column if not exists high_value_low_confidence_count int default 0;
alter table data_collection_runs add column if not exists validation_status text;
alter table risk_history add column if not exists commercial_value_score int default 0;
alter table risk_history add column if not exists data_confidence_score int default 0;
