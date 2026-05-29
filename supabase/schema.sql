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
  snapshot_date date not null default current_date,
  source_name text,
  master_vessel_id text,
  port_code text,
  port_name text,
  port_call_identity text,
  sub_port text,
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
  data_quality_score int default 0,
  data_quality_band text,
  source_confidence_score int default 0,
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

alter table vessel_snapshots add column if not exists snapshot_date date default current_date;
alter table vessel_snapshots alter column snapshot_date set default current_date;
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
alter table vessel_snapshots add column if not exists operator_name text;
alter table vessel_snapshots add column if not exists operator_normalized text;
alter table vessel_snapshots add column if not exists operator_inferred boolean default false;
alter table vessel_snapshots add column if not exists operator_confidence int default 0;
alter table vessel_snapshots add column if not exists operator_source text;
alter table vessel_snapshots add column if not exists agent_name text;
alter table vessel_snapshots add column if not exists agent_normalized text;
alter table vessel_snapshots add column if not exists agent_source text;
alter table vessel_snapshots add column if not exists manager_name text;
alter table vessel_snapshots add column if not exists owner_name text;
alter table vessel_snapshots add column if not exists contact_readiness_score int default 0;
alter table vessel_snapshots add column if not exists contact_intelligence_score int default 0;
alter table vessel_snapshots add column if not exists contact_path_available boolean default false;
alter table vessel_snapshots add column if not exists contact_priority text default 'LOW';
alter table vessel_snapshots add column if not exists contact_path_label_ko text;
alter table vessel_snapshots add column if not exists operator_website text;
alter table vessel_snapshots add column if not exists operator_email text;
alter table vessel_snapshots add column if not exists operator_phone text;
alter table vessel_snapshots add column if not exists agent_website text;
alter table vessel_snapshots add column if not exists agent_email text;
alter table vessel_snapshots add column if not exists agent_phone text;
alter table vessel_snapshots add column if not exists previous_port text;
alter table vessel_snapshots add column if not exists destination_port text;
alter table vessel_snapshots add column if not exists next_port text;
alter table vessel_snapshots add column if not exists route_region text;
alter table vessel_snapshots add column if not exists predicted_arrival_time timestamptz;
alter table vessel_snapshots add column if not exists arrival_prediction_confidence int default 0;
alter table vessel_snapshots add column if not exists predicted_congestion int default 0;
alter table vessel_snapshots add column if not exists predicted_cleaning_window int default 0;
alter table vessel_snapshots add column if not exists predicted_congestion_score int default 0;
alter table vessel_snapshots add column if not exists congestion_forecast_band text;
alter table vessel_snapshots add column if not exists anchorage_probability int default 0;
alter table vessel_snapshots add column if not exists predicted_work_window_hours numeric default 0;
alter table vessel_snapshots add column if not exists work_window_confidence int default 0;
alter table vessel_snapshots add column if not exists calls_last_3m int default 0;
alter table vessel_snapshots add column if not exists calls_last_6m int default 0;
alter table vessel_snapshots add column if not exists calls_last_12m int default 0;
alter table vessel_snapshots add column if not exists repeat_caller_score int default 0;
alter table vessel_snapshots add column if not exists repeat_operator_score int default 0;
alter table vessel_snapshots add column if not exists repeat_call_count int default 0;
alter table vessel_snapshots add column if not exists repeat_operator_count int default 0;
alter table vessel_snapshots add column if not exists operator_call_count int default 0;
alter table vessel_snapshots add column if not exists operator_vessel_count int default 0;
alter table vessel_snapshots add column if not exists operator_port_count int default 0;
alter table vessel_snapshots add column if not exists fleet_opportunity_score int default 0;
alter table vessel_snapshots add column if not exists low_speed_exposure int default 0;
alter table vessel_snapshots add column if not exists idle_exposure int default 0;
alter table vessel_snapshots add column if not exists anchorage_exposure int default 0;
alter table vessel_snapshots add column if not exists biofouling_exposure_score int default 0;
alter table vessel_snapshots add column if not exists biofouling_exposure_band text;
alter table vessel_snapshots add column if not exists biofouling_exposure_reasons jsonb default '[]'::jsonb;
alter table vessel_snapshots add column if not exists predicted_cleaning_opportunity_score int default 0;
alter table vessel_snapshots add column if not exists cleaning_opportunity_band text;
alter table vessel_snapshots add column if not exists opportunity_summary text;
alter table vessel_snapshots add column if not exists arrival_opportunity_score int default 0;
alter table vessel_snapshots add column if not exists predicted_arrival_pipeline boolean default false;
alter table vessel_snapshots add column if not exists work_feasibility_score int default 0;
alter table vessel_snapshots add column if not exists lead_status text default 'monitor';
alter table vessel_snapshots add column if not exists lead_priority_score int default 0;
alter table vessel_snapshots add column if not exists auto_lead_created boolean default false;
alter table vessel_snapshots add column if not exists lead_created_reason text;
alter table vessel_snapshots add column if not exists why_now text;
alter table vessel_snapshots add column if not exists candidate_summary_ko text;
alter table vessel_snapshots add column if not exists sales_angle text;
alter table vessel_snapshots add column if not exists recommended_next_action text;
alter table vessel_snapshots add column if not exists recommended_action text;
alter table vessel_snapshots add column if not exists action_priority text default 'LOW';
alter table vessel_snapshots add column if not exists recommended_contact_path text;
alter table vessel_snapshots add column if not exists recommended_department text;
alter table vessel_snapshots add column if not exists recommended_email_draft text;
alter table vessel_snapshots add column if not exists recommended_followup_date date;
alter table vessel_snapshots add column if not exists lead_timeline jsonb default '[]'::jsonb;
alter table vessel_snapshots add column if not exists last_contacted_at timestamptz;
alter table vessel_snapshots add column if not exists follow_up_due timestamptz;
alter table vessel_snapshots add column if not exists quote_status text default 'not_started';
alter table vessel_snapshots add column if not exists notes text;
alter table vessel_snapshots add column if not exists actual_arrival_time timestamptz;
alter table vessel_snapshots add column if not exists prediction_error_hours numeric;
alter table vessel_snapshots add column if not exists alert_candidate boolean default false;
alter table vessel_snapshots add column if not exists information_enrichment_needed boolean default false;
alter table vessel_snapshots drop constraint if exists vessel_snapshots_snapshot_date_vessel_id_port_key;
create index if not exists idx_vessel_snapshots_hybrid_entity_key on vessel_snapshots(hybrid_entity_key);
create index if not exists idx_vessel_snapshots_collected_at on vessel_snapshots(collected_at desc);
create index if not exists idx_vessel_snapshots_run_id on vessel_snapshots(run_id);
create index if not exists idx_vessel_snapshots_operator_normalized on vessel_snapshots(operator_normalized);
create index if not exists idx_vessel_snapshots_agent_normalized on vessel_snapshots(agent_normalized);
create index if not exists idx_vessel_snapshots_route_region on vessel_snapshots(route_region);
create index if not exists idx_vessel_snapshots_predicted_arrival_time on vessel_snapshots(predicted_arrival_time);
create index if not exists idx_vessel_snapshots_lead_priority on vessel_snapshots(lead_priority_score desc);
create index if not exists idx_vessel_snapshots_predicted_cleaning_opportunity on vessel_snapshots(predicted_cleaning_opportunity_score desc);
alter table vessel_snapshots add column if not exists global_rank int;
alter table vessel_snapshots add column if not exists global_percentile numeric;
alter table vessel_snapshots add column if not exists port_rank int;
alter table vessel_snapshots add column if not exists port_percentile numeric;
alter table vessel_snapshots add column if not exists route_pattern_confidence int default 0;
alter table vessel_snapshots add column if not exists data_quality_score int default 0;
alter table vessel_snapshots add column if not exists data_quality_band text;
alter table vessel_snapshots add column if not exists source_confidence_score int default 0;
alter table vessel_snapshots add column if not exists port_call_identity text;
alter table vessel_snapshots add column if not exists sub_port text;
create index if not exists idx_vessel_snapshots_date on vessel_snapshots(snapshot_date desc);
create index if not exists idx_vessel_snapshots_port_call_identity on vessel_snapshots(port_call_identity);

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
  vessel_type_group text,
  gt numeric,
  dwt numeric,
  loa numeric,
  beam numeric,
  operator text,
  operator_normalized text,
  flag text,
  identity_confidence int default 0,
  identity_confidence_band text,
  identity_match_strategy text,
  imo_status text,
  first_seen timestamptz default now(),
  last_seen timestamptz default now(),
  updated_at timestamptz default now(),
  payload jsonb default '{}'::jsonb
);

create table if not exists operator_master (
  operator_id text primary key,
  operator_name text not null,
  operator_normalized text not null unique,
  website text,
  country text,
  fleet_size int,
  segment text,
  operator_group text,
  source text,
  confidence int default 0,
  first_seen timestamptz default now(),
  last_seen timestamptz default now(),
  payload jsonb default '{}'::jsonb
);

create table if not exists agent_master (
  agent_id text primary key,
  agent_name text not null,
  agent_normalized text not null unique,
  email text,
  phone text,
  website text,
  location text,
  agent_group text,
  source text,
  first_seen timestamptz default now(),
  last_seen timestamptz default now(),
  payload jsonb default '{}'::jsonb
);

create table if not exists agent_operator_links (
  link_id text primary key,
  agent_id text,
  operator_id text,
  agent_name text,
  operator_name text,
  agent_normalized text not null,
  operator_normalized text not null,
  source text,
  confidence int default 0,
  inferred boolean default true,
  first_seen timestamptz default now(),
  last_seen timestamptz default now(),
  payload jsonb default '{}'::jsonb,
  unique(agent_normalized, operator_normalized, source)
);

create table if not exists agent_operator_mapping (
  mapping_id text primary key,
  agent_id text,
  operator_id text,
  agent_name text,
  operator_name text,
  agent_normalized text not null,
  operator_normalized text not null,
  source text,
  confidence int default 0,
  inferred boolean default true,
  first_seen timestamptz default now(),
  last_seen timestamptz default now(),
  payload jsonb default '{}'::jsonb,
  unique(agent_normalized, operator_normalized, source)
);

create table if not exists contact_master (
  contact_id text primary key,
  company_name text not null,
  company_normalized text not null,
  contact_type text not null,
  company_type text,
  email text,
  general_email text,
  operations_email text,
  chartering_email text,
  purchasing_email text,
  technical_email text,
  phone text,
  website text,
  country text,
  source text,
  confidence int default 0,
  last_verified timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  payload jsonb default '{}'::jsonb,
  unique(company_normalized, contact_type, source)
);

create table if not exists operator_contact_history (
  history_id text primary key,
  run_id text,
  master_vessel_id text,
  hybrid_entity_key text,
  vessel_name text,
  port_code text,
  operator_name text,
  operator_normalized text,
  agent_name text,
  agent_normalized text,
  contact_path_status text default 'unknown',
  contact_priority text default 'LOW',
  contact_path_label_ko text,
  contact_path_available boolean default false,
  contact_readiness_score int default 0,
  lead_status text default 'monitor',
  recommended_action text,
  collected_at timestamptz default now(),
  payload jsonb default '{}'::jsonb
);

create table if not exists vessel_operator_history (
  history_id text primary key,
  run_id text,
  master_vessel_id text,
  hybrid_entity_key text,
  vessel_name text,
  port_code text,
  operator_name text,
  operator_normalized text,
  operator_inferred boolean default false,
  operator_confidence int default 0,
  operator_source text,
  agent_name text,
  agent_normalized text,
  agent_source text,
  contact_readiness_score int default 0,
  contact_path_status text default 'unknown',
  contact_priority text default 'LOW',
  contact_path_label_ko text,
  collected_at timestamptz default now(),
  payload jsonb default '{}'::jsonb
);

create table if not exists operator_history (
  history_id text primary key,
  run_id text,
  master_vessel_id text,
  hybrid_entity_key text,
  vessel_name text,
  port_code text,
  operator_name text,
  operator_normalized text,
  operator_inferred boolean default false,
  operator_confidence int default 0,
  operator_source text,
  agent_name text,
  agent_normalized text,
  agent_source text,
  contact_readiness_score int default 0,
  contact_path_status text default 'unknown',
  contact_path_available boolean default false,
  collected_at timestamptz default now(),
  payload jsonb default '{}'::jsonb
);

create table if not exists operator_fleet_opportunities (
  fleet_opportunity_id text primary key,
  run_id text,
  operator_name text,
  operator_normalized text,
  current_vessel_count int default 0,
  target_vessel_count int default 0,
  immediate_target_count int default 0,
  operator_call_count int default 0,
  operator_vessel_count int default 0,
  operator_port_count int default 0,
  average_commercial_value int default 0,
  average_biofouling_exposure int default 0,
  average_congestion_exposure int default 0,
  route_exposure_score int default 0,
  operator_quality_score int default 0,
  repeat_operator_score int default 0,
  fleet_opportunity_score int default 0,
  fleet_alert text,
  fleet_alerts jsonb default '[]'::jsonb,
  contact_readiness_avg int default 0,
  top_vessels jsonb default '[]'::jsonb,
  payload jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

create table if not exists route_patterns (
  route_pattern_id text primary key,
  from_port text,
  to_port text,
  vessel_type_group text,
  avg_transit_hours numeric default 0,
  avg_waiting_hours numeric default 0,
  avg_stay_hours numeric default 0,
  congestion_probability int default 0,
  route_pattern_confidence int default 0,
  observation_count int default 0,
  first_seen timestamptz default now(),
  last_seen timestamptz default now(),
  payload jsonb default '{}'::jsonb,
  unique(from_port, to_port, vessel_type_group)
);

create table if not exists vessel_route_history (
  route_history_id text primary key,
  run_id text,
  master_vessel_id text,
  hybrid_entity_key text,
  vessel_name text,
  previous_port text,
  destination_port text,
  arrival timestamptz,
  departure timestamptz,
  vessel_type_group text,
  route_region text,
  arrival_opportunity_score int default 0,
  predicted_arrival_time timestamptz,
  actual_arrival_time timestamptz,
  prediction_error_hours numeric,
  prediction_confidence int default 0,
  route_pattern_id text,
  arrival_prediction_confidence int default 0,
  created_at timestamptz default now(),
  payload jsonb default '{}'::jsonb
);

create table if not exists predicted_arrivals (
  predicted_arrival_id text primary key,
  run_id text,
  master_vessel_id text,
  hybrid_entity_key text,
  vessel_name text,
  previous_port text,
  destination_port text,
  port_code text,
  port_name text,
  predicted_arrival_time timestamptz,
  actual_arrival_time timestamptz,
  prediction_error_hours numeric,
  prediction_confidence int default 0,
  route_pattern_id text,
  arrival_prediction_confidence int default 0,
  predicted_congestion int default 0,
  predicted_cleaning_window int default 0,
  predicted_congestion_score int default 0,
  congestion_forecast_band text,
  anchorage_probability int default 0,
  predicted_work_window_hours numeric default 0,
  work_window_confidence int default 0,
  repeat_caller_score int default 0,
  repeat_operator_score int default 0,
  repeat_call_count int default 0,
  repeat_operator_count int default 0,
  biofouling_exposure_score int default 0,
  predicted_cleaning_opportunity_score int default 0,
  arrival_opportunity_score int default 0,
  status text,
  created_at timestamptz default now(),
  payload jsonb default '{}'::jsonb
);

alter table route_patterns add column if not exists route_pattern_confidence int default 0;
alter table vessel_route_history add column if not exists actual_arrival_time timestamptz;
alter table vessel_route_history add column if not exists prediction_error_hours numeric;
alter table vessel_route_history add column if not exists prediction_confidence int default 0;
alter table vessel_route_history add column if not exists route_pattern_id text;
alter table predicted_arrivals add column if not exists actual_arrival_time timestamptz;
alter table predicted_arrivals add column if not exists prediction_error_hours numeric;
alter table predicted_arrivals add column if not exists prediction_confidence int default 0;
alter table predicted_arrivals add column if not exists route_pattern_id text;

create table if not exists enrichment_match_candidates (
  match_id text primary key,
  run_id text,
  source_name text,
  source_row_id text,
  snapshot_id text,
  master_vessel_id text,
  hybrid_entity_key text,
  port_call_identity text,
  vessel_name text,
  normalized_vessel_name text,
  call_sign text,
  port_code text,
  enrichment_source text,
  enrichment_source_type text,
  match_score int default 0,
  confidence text,
  match_confidence text,
  match_reasons jsonb default '[]'::jsonb,
  matched_fields jsonb default '{}'::jsonb,
  raw_source_payload jsonb default '{}'::jsonb,
  matched_at timestamptz default now(),
  reused_historical_match boolean default false,
  created_at timestamptz default now(),
  payload jsonb default '{}'::jsonb
);

create table if not exists imo_recovery_queue (
  recovery_id text primary key,
  run_id text,
  master_vessel_id text,
  snapshot_id text,
  hybrid_entity_key text,
  vessel_name text,
  normalized_vessel_name text,
  call_sign text,
  gt numeric,
  vessel_type text,
  vessel_type_group text,
  port_code text,
  commercial_value_score int default 0,
  data_confidence_score int default 0,
  priority text,
  status text default 'pending',
  attempt_count int default 0,
  last_attempt_at timestamptz,
  recovery_source text,
  recovery_confidence int default 0,
  payload jsonb default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists commercial_leads (
  lead_id text primary key,
  run_id text,
  master_vessel_id text,
  hybrid_entity_key text,
  port_call_identity text,
  vessel_name text,
  port_code text,
  port_name text,
  lead_status text default 'monitor',
  lead_priority_score int default 0,
  auto_lead_created boolean default false,
  lead_created_reason text,
  commercial_value_score int default 0,
  contact_readiness_score int default 0,
  work_feasibility_score int default 0,
  arrival_opportunity_score int default 0,
  predicted_cleaning_opportunity_score int default 0,
  anchorage_probability int default 0,
  predicted_congestion_score int default 0,
  why_now text,
  candidate_summary_ko text,
  sales_angle text,
  recommended_next_action text,
  recommended_action text,
  action_priority text default 'LOW',
  recommended_contact_path text,
  recommended_department text,
  recommended_email_draft text,
  recommended_followup_date date,
  lead_timeline jsonb default '[]'::jsonb,
  last_contacted_at timestamptz,
  follow_up_due timestamptz,
  quote_status text default 'not_started',
  notes text,
  actual_arrival_time timestamptz,
  prediction_error_hours numeric,
  alert_candidate boolean default false,
  information_enrichment_needed boolean default false,
  payload jsonb default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists berth_aliases (
  alias_id bigserial primary key,
  port_code text,
  berth_name text,
  terminal_name text,
  alias text,
  normalized_alias text,
  berth_class text,
  source text,
  confidence int default 70,
  updated_at timestamptz default now()
);

create table if not exists terminal_aliases (
  alias_id bigserial primary key,
  port_code text,
  terminal_name text,
  berth_name text,
  alias text,
  normalized_alias text,
  terminal_group text,
  source text,
  confidence int default 70,
  updated_at timestamptz default now()
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

create table if not exists pilot_schedule_events (
  id bigserial primary key,
  event_id bigserial,
  run_id text,
  port_code text,
  port_name text,
  vessel_name text,
  normalized_vessel_name text,
  call_sign text,
  pilot_time timestamptz,
  pilot_direction text,
  pilot_station text,
  berth_name text,
  movement_type text,
  status text,
  raw_payload jsonb default '{}'::jsonb,
  matched_snapshot_id bigint,
  matched_master_vessel_id text,
  match_confidence int default 0,
  created_at timestamptz default now()
);

create index if not exists idx_vessel_master_imo on vessel_master(imo);
create index if not exists idx_vessel_master_mmsi on vessel_master(mmsi);
create index if not exists idx_vessel_identity_candidates_collected_at on vessel_identity_candidates(collected_at desc);
create index if not exists idx_port_congestion_snapshots_collected_at on port_congestion_snapshots(collected_at desc);
create index if not exists idx_data_collection_runs_status on data_collection_runs(status);
create index if not exists idx_active_dataset_pointer_active_run_id on active_dataset_pointer(active_run_id);
create index if not exists idx_pilot_schedule_events_run_id on pilot_schedule_events(run_id);
create index if not exists idx_pilot_schedule_events_pilot_time on pilot_schedule_events(pilot_time desc);
alter table enrichment_match_candidates add column if not exists source_name text;
alter table enrichment_match_candidates add column if not exists source_row_id text;
alter table enrichment_match_candidates add column if not exists snapshot_id text;
alter table enrichment_match_candidates add column if not exists confidence text;
alter table enrichment_match_candidates add column if not exists matched_fields jsonb default '{}'::jsonb;
alter table enrichment_match_candidates add column if not exists raw_source_payload jsonb default '{}'::jsonb;
alter table enrichment_match_candidates add column if not exists created_at timestamptz default now();
create index if not exists idx_enrichment_match_candidates_run_id on enrichment_match_candidates(run_id);
create index if not exists idx_enrichment_match_candidates_score on enrichment_match_candidates(match_score desc);
create index if not exists idx_enrichment_match_candidates_source_name on enrichment_match_candidates(source_name);
create index if not exists idx_imo_recovery_queue_priority on imo_recovery_queue(priority, commercial_value_score desc);
create index if not exists idx_imo_recovery_queue_status on imo_recovery_queue(status);
create index if not exists idx_imo_recovery_queue_call_sign on imo_recovery_queue(call_sign);
create index if not exists idx_commercial_leads_run_id on commercial_leads(run_id);
create index if not exists idx_commercial_leads_status on commercial_leads(lead_status);
create index if not exists idx_commercial_leads_priority on commercial_leads(lead_priority_score desc);
alter table commercial_leads add column if not exists predicted_cleaning_opportunity_score int default 0;
alter table commercial_leads add column if not exists auto_lead_created boolean default false;
alter table commercial_leads add column if not exists lead_created_reason text;
alter table commercial_leads add column if not exists cleaning_opportunity_band text;
alter table commercial_leads add column if not exists opportunity_summary text;
alter table commercial_leads add column if not exists anchorage_probability int default 0;
alter table commercial_leads add column if not exists predicted_congestion_score int default 0;
alter table commercial_leads add column if not exists repeat_caller_score int default 0;
alter table commercial_leads add column if not exists repeat_operator_score int default 0;
alter table commercial_leads add column if not exists repeat_call_count int default 0;
alter table commercial_leads add column if not exists repeat_operator_count int default 0;
alter table commercial_leads add column if not exists fleet_opportunity_score int default 0;
alter table commercial_leads add column if not exists candidate_summary_ko text;
alter table commercial_leads add column if not exists recommended_action text;
alter table commercial_leads add column if not exists action_priority text default 'LOW';
alter table commercial_leads add column if not exists recommended_contact_path text;
alter table commercial_leads add column if not exists recommended_department text;
alter table commercial_leads add column if not exists recommended_email_draft text;
alter table commercial_leads add column if not exists recommended_followup_date date;
alter table commercial_leads add column if not exists last_contacted_at timestamptz;
alter table commercial_leads add column if not exists follow_up_due timestamptz;
alter table commercial_leads add column if not exists quote_status text default 'not_started';
alter table commercial_leads add column if not exists notes text;
alter table commercial_leads add column if not exists actual_arrival_time timestamptz;
alter table commercial_leads add column if not exists prediction_error_hours numeric;
alter table commercial_leads add column if not exists alert_candidate boolean default false;
alter table commercial_leads add column if not exists information_enrichment_needed boolean default false;
alter table commercial_leads add column if not exists contact_path_status text default 'unknown';
alter table commercial_leads add column if not exists contact_priority text default 'LOW';
alter table commercial_leads add column if not exists contact_path_label_ko text;
create index if not exists idx_commercial_leads_follow_up_due on commercial_leads(follow_up_due);
create index if not exists idx_commercial_leads_alert on commercial_leads(alert_candidate);
alter table operator_master add column if not exists website text;
alter table operator_master add column if not exists country text;
alter table operator_master add column if not exists fleet_size int;
alter table operator_master add column if not exists segment text;
alter table agent_master add column if not exists email text;
alter table agent_master add column if not exists phone text;
alter table agent_master add column if not exists website text;
alter table agent_master add column if not exists location text;
alter table agent_operator_links add column if not exists agent_name text;
alter table agent_operator_links add column if not exists operator_name text;
alter table contact_master add column if not exists company_type text;
alter table contact_master add column if not exists general_email text;
alter table contact_master add column if not exists operations_email text;
alter table contact_master add column if not exists chartering_email text;
alter table contact_master add column if not exists purchasing_email text;
alter table contact_master add column if not exists technical_email text;
alter table contact_master add column if not exists country text;
alter table vessel_snapshots add column if not exists contact_path_status text default 'unknown';
alter table vessel_snapshots add column if not exists contact_priority text default 'LOW';
alter table vessel_snapshots add column if not exists contact_path_label_ko text;
alter table vessel_operator_history add column if not exists contact_path_status text default 'unknown';
alter table vessel_operator_history add column if not exists contact_priority text default 'LOW';
alter table vessel_operator_history add column if not exists contact_path_label_ko text;
alter table operator_history add column if not exists contact_path_status text default 'unknown';
alter table operator_history add column if not exists contact_priority text default 'LOW';
alter table operator_history add column if not exists contact_path_label_ko text;
alter table operator_contact_history add column if not exists contact_priority text default 'LOW';
alter table operator_contact_history add column if not exists contact_path_label_ko text;
create index if not exists idx_contact_master_company on contact_master(company_normalized);
create index if not exists idx_contact_master_type on contact_master(contact_type);
create index if not exists idx_operator_contact_history_run on operator_contact_history(run_id);
create index if not exists idx_operator_contact_history_status on operator_contact_history(contact_path_status);
create index if not exists idx_operator_fleet_opportunities_run on operator_fleet_opportunities(run_id);
create index if not exists idx_operator_fleet_opportunities_score on operator_fleet_opportunities(fleet_opportunity_score desc);
create index if not exists idx_operator_fleet_opportunities_operator on operator_fleet_opportunities(operator_normalized);
alter table operator_fleet_opportunities add column if not exists average_commercial_value int default 0;
alter table operator_fleet_opportunities add column if not exists average_biofouling_exposure int default 0;
alter table operator_fleet_opportunities add column if not exists average_congestion_exposure int default 0;
alter table operator_fleet_opportunities add column if not exists route_exposure_score int default 0;
alter table operator_fleet_opportunities add column if not exists operator_quality_score int default 0;
alter table operator_fleet_opportunities add column if not exists fleet_alert text;
alter table operator_fleet_opportunities add column if not exists fleet_alerts jsonb default '[]'::jsonb;
alter table operator_fleet_opportunities add column if not exists fleet_cleaning_probability int default 0;
alter table operator_fleet_opportunities add column if not exists fleet_cleaning_probability_band text;
alter table operator_fleet_opportunities add column if not exists forecast_window_days int default 30;
create index if not exists idx_operator_fleet_cleaning_probability on operator_fleet_opportunities(fleet_cleaning_probability desc);
alter table predicted_arrivals add column if not exists predicted_congestion_score int default 0;
alter table predicted_arrivals add column if not exists congestion_forecast_band text;
alter table predicted_arrivals add column if not exists anchorage_probability int default 0;
alter table predicted_arrivals add column if not exists predicted_work_window_hours numeric default 0;
alter table predicted_arrivals add column if not exists work_window_confidence int default 0;
alter table predicted_arrivals add column if not exists repeat_caller_score int default 0;
alter table predicted_arrivals add column if not exists repeat_operator_score int default 0;
alter table predicted_arrivals add column if not exists biofouling_exposure_score int default 0;
alter table predicted_arrivals add column if not exists biofouling_exposure_band text;
alter table predicted_arrivals add column if not exists biofouling_exposure_reasons jsonb default '[]'::jsonb;
alter table predicted_arrivals add column if not exists predicted_cleaning_opportunity_score int default 0;
alter table predicted_arrivals add column if not exists cleaning_opportunity_band text;
alter table predicted_arrivals add column if not exists opportunity_summary text;
create index if not exists idx_predicted_arrivals_cleaning_opportunity on predicted_arrivals(predicted_cleaning_opportunity_score desc);
create index if not exists idx_berth_aliases_normalized_alias on berth_aliases(normalized_alias);
create index if not exists idx_terminal_aliases_normalized_alias on terminal_aliases(normalized_alias);

alter table data_collection_runs add column if not exists raw_collected_rows int default 0;
alter table data_collection_runs add column if not exists normalized_rows int default 0;
alter table data_collection_runs add column if not exists target_vessels_count int default 0;
alter table data_collection_runs add column if not exists gt_5000_plus_count int default 0;
alter table data_collection_runs add column if not exists unknown_gt_review_count int default 0;
alter table data_collection_runs add column if not exists staying_vessels_count int default 0;
alter table data_collection_runs add column if not exists arrival_pipeline_count int default 0;
alter table data_collection_runs add column if not exists sales_candidates_count int default 0;
alter table data_collection_runs add column if not exists immediate_targets_count int default 0;
alter table data_collection_runs add column if not exists high_score_not_promoted_count int default 0;
alter table data_collection_runs add column if not exists candidate_promotion_error boolean default false;
alter table data_collection_runs add column if not exists exclusion_reason_counts jsonb default '{}'::jsonb;
alter table data_collection_runs add column if not exists imo_missing_count int default 0;
alter table data_collection_runs add column if not exists imo_recovered_count int default 0;
alter table data_collection_runs add column if not exists imo_recovery_queue_count int default 0;
alter table data_collection_runs add column if not exists imo_recovery_success_rate int default 0;
alter table data_collection_runs add column if not exists high_value_imo_coverage int default 0;
alter table data_collection_runs add column if not exists unresolved_high_value_count int default 0;
alter table data_collection_runs add column if not exists call_sign_match_recovery_count int default 0;
alter table data_collection_runs add column if not exists vessel_name_match_recovery_count int default 0;
alter table data_collection_runs add column if not exists spec_api_recovery_count int default 0;
alter table data_collection_runs add column if not exists high_value_low_confidence_count int default 0;
alter table data_collection_runs add column if not exists validation_status text;
alter table risk_history add column if not exists commercial_value_score int default 0;
alter table risk_history add column if not exists data_confidence_score int default 0;
alter table vessel_master add column if not exists vessel_type_group text;
alter table vessel_master add column if not exists identity_confidence_band text;
alter table vessel_master add column if not exists identity_match_strategy text;
alter table vessel_snapshots add column if not exists identity_confidence int default 0;
alter table vessel_snapshots add column if not exists identity_confidence_band text;
alter table vessel_snapshots add column if not exists identity_match_strategy text;
alter table vessel_snapshots add column if not exists recovery_source text;
alter table vessel_snapshots add column if not exists recovery_confidence int default 0;
alter table vessel_snapshots add column if not exists imo_recovery_priority text;
alter table vessel_snapshots add column if not exists imo_recovery_required boolean default false;
alter table vessel_snapshots add column if not exists imo_recovery_score int default 0;
alter table vessel_identity_candidates add column if not exists identity_match_strategy text;
alter table vessel_identity_candidates add column if not exists commercial_value_score int default 0;
alter table enrichment_match_candidates add column if not exists source_name text;
alter table enrichment_match_candidates add column if not exists source_row_id text;
alter table enrichment_match_candidates add column if not exists snapshot_id text;
alter table enrichment_match_candidates add column if not exists confidence text;
alter table enrichment_match_candidates add column if not exists matched_fields jsonb default '{}'::jsonb;
alter table enrichment_match_candidates add column if not exists raw_source_payload jsonb default '{}'::jsonb;
alter table enrichment_match_candidates add column if not exists created_at timestamptz default now();
