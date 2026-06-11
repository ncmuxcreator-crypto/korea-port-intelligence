-- Phase 17 Ocean Intelligence Layer
-- Safe to run with service-role migrations. Frontend continues to use static JSON snapshots.

create table if not exists public.port_ocean_conditions (
  id uuid primary key default gen_random_uuid(),
  port_code text not null,
  port_name_ko text,
  lat numeric,
  lon numeric,
  sst_c numeric,
  sst_anomaly_c numeric,
  marine_heatwave_level text,
  biofouling_water_temp_factor numeric,
  source text,
  observed_at timestamptz,
  updated_at timestamptz default now(),
  created_at timestamptz default now()
);

create table if not exists public.vessel_ocean_risk (
  id uuid primary key default gen_random_uuid(),
  vessel_key text not null,
  port_code text,
  sst_c numeric,
  sst_anomaly_c numeric,
  fouling_accelerator_pct numeric,
  ocean_risk_score numeric,
  regulatory_multiplier numeric,
  updated_at timestamptz default now(),
  created_at timestamptz default now()
);

create index if not exists idx_port_ocean_conditions_port_updated
  on public.port_ocean_conditions (port_code, updated_at desc);

create index if not exists idx_vessel_ocean_risk_vessel_updated
  on public.vessel_ocean_risk (vessel_key, updated_at desc);

create index if not exists idx_vessel_ocean_risk_port_updated
  on public.vessel_ocean_risk (port_code, updated_at desc);

alter table public.port_ocean_conditions enable row level security;
alter table public.vessel_ocean_risk enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'port_ocean_conditions'
      and policyname = 'service_role_port_ocean_conditions'
  ) then
    create policy service_role_port_ocean_conditions
      on public.port_ocean_conditions
      for all
      using (auth.role() = 'service_role')
      with check (auth.role() = 'service_role');
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'vessel_ocean_risk'
      and policyname = 'service_role_vessel_ocean_risk'
  ) then
    create policy service_role_vessel_ocean_risk
      on public.vessel_ocean_risk
      for all
      using (auth.role() = 'service_role')
      with check (auth.role() = 'service_role');
  end if;
end $$;
