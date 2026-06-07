-- Port Risk GeoJSON Snapshot storage.
-- Stores latest/periodic port-level GeoJSON snapshots and vessel-level feature rows.

begin;

create extension if not exists pgcrypto;

create table if not exists public.port_geojson_snapshots (
  id uuid primary key default gen_random_uuid(),
  port_code text,
  port_name_kr text,
  port_name_en text,
  window_start timestamptz,
  window_end timestamptz,
  snapshot_type text default '72h',
  geojson jsonb,
  vessel_count int,
  avg_residence_hours numeric,
  avg_combined_score numeric,
  max_combined_score numeric,
  data_health jsonb,
  created_at timestamptz default now()
);

create table if not exists public.port_vessel_features (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid references public.port_geojson_snapshots(id) on delete cascade,
  port_code text,
  mmsi text,
  imo text,
  vessel_name text,
  vessel_type text,
  lat numeric,
  lon numeric,
  residence_hours_72h numeric,
  residence_change_pct_72_vs_30d numeric,
  sst_72h_c_avg numeric,
  sst_7d_c_avg numeric,
  sst_anomaly_c numeric,
  bias_offset_c numeric,
  portmis_last_ts timestamptz,
  combined_score numeric,
  suggested_action text,
  raw jsonb,
  created_at timestamptz default now()
);

create index if not exists idx_port_geojson_snapshots_port_created
  on public.port_geojson_snapshots(port_code, created_at desc);

create index if not exists idx_port_geojson_snapshots_window
  on public.port_geojson_snapshots(window_end desc, snapshot_type);

create index if not exists idx_port_vessel_features_snapshot
  on public.port_vessel_features(snapshot_id);

create index if not exists idx_port_vessel_features_port_score
  on public.port_vessel_features(port_code, combined_score desc);

create index if not exists idx_port_vessel_features_identity
  on public.port_vessel_features(imo, mmsi);

alter table public.port_geojson_snapshots enable row level security;
alter table public.port_vessel_features enable row level security;

drop policy if exists port_geojson_snapshots_service_role_all on public.port_geojson_snapshots;
create policy port_geojson_snapshots_service_role_all
  on public.port_geojson_snapshots
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists port_vessel_features_service_role_all on public.port_vessel_features;
create policy port_vessel_features_service_role_all
  on public.port_vessel_features
  for all
  to service_role
  using (true)
  with check (true);

comment on table public.port_geojson_snapshots is 'Latest and historical port risk GeoJSON snapshots for 72h commercial map rendering.';
comment on table public.port_vessel_features is 'Vessel-level features used to build port risk GeoJSON snapshots.';

commit;
