-- Korea Port Intelligence Supabase Performance Advisor Guardrails
-- Fixes low-risk advisor warnings without changing application behavior.
--
-- Covers:
-- - public.port_calls foreign key index for vessels(vessel_id)
-- - primary keys on daily warehouse tables that already use stable unique keys

create index if not exists idx_port_calls_vessel_id on public.port_calls(vessel_id);

create unique index if not exists ux_vessel_snapshot_daily_date_port_call
  on public.vessel_snapshot_daily(snapshot_date, port_call_id);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.vessel_snapshot_daily'::regclass
      and contype = 'p'
  ) then
    alter table public.vessel_snapshot_daily
      add constraint vessel_snapshot_daily_pkey
      primary key using index ux_vessel_snapshot_daily_date_port_call;
  end if;
end $$;

update public.port_snapshot_daily
set sub_port = ''
where sub_port is null;

alter table public.port_snapshot_daily
  alter column sub_port set not null;

create unique index if not exists ux_port_snapshot_daily_date_port
  on public.port_snapshot_daily(snapshot_date, port_code, sub_port);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.port_snapshot_daily'::regclass
      and contype = 'p'
  ) then
    alter table public.port_snapshot_daily
      add constraint port_snapshot_daily_pkey
      primary key using index ux_port_snapshot_daily_date_port;
  end if;
end $$;

create unique index if not exists ux_operator_snapshot_daily_date_operator
  on public.operator_snapshot_daily(snapshot_date, operator_normalized);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.operator_snapshot_daily'::regclass
      and contype = 'p'
  ) then
    alter table public.operator_snapshot_daily
      add constraint operator_snapshot_daily_pkey
      primary key using index ux_operator_snapshot_daily_date_operator;
  end if;
end $$;

update public.route_snapshot_daily
set
  previous_port = coalesce(previous_port, ''),
  destination_port = coalesce(destination_port, ''),
  vessel_type_group = coalesce(vessel_type_group, '')
where previous_port is null
   or destination_port is null
   or vessel_type_group is null;

alter table public.route_snapshot_daily
  alter column previous_port set not null,
  alter column destination_port set not null,
  alter column vessel_type_group set not null;

create unique index if not exists ux_route_snapshot_daily_date_route
  on public.route_snapshot_daily(snapshot_date, previous_port, destination_port, vessel_type_group);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.route_snapshot_daily'::regclass
      and contype = 'p'
  ) then
    alter table public.route_snapshot_daily
      add constraint route_snapshot_daily_pkey
      primary key using index ux_route_snapshot_daily_date_route;
  end if;
end $$;

create unique index if not exists ux_commercial_opportunity_daily_date_opportunity
  on public.commercial_opportunity_daily(snapshot_date, opportunity_id);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.commercial_opportunity_daily'::regclass
      and contype = 'p'
  ) then
    alter table public.commercial_opportunity_daily
      add constraint commercial_opportunity_daily_pkey
      primary key using index ux_commercial_opportunity_daily_date_opportunity;
  end if;
end $$;

analyze public.port_calls;
analyze public.vessel_snapshot_daily;
analyze public.port_snapshot_daily;
analyze public.operator_snapshot_daily;
analyze public.route_snapshot_daily;
analyze public.commercial_opportunity_daily;
