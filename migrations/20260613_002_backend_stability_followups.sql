-- Backend stability follow-ups for source CSV, event upserts, and optional summaries.

alter table if exists public.vessel_events
  add column if not exists event_key text;

update public.vessel_events
set event_key = coalesce(
  event_key,
  event_uid,
  concat_ws('|',
    nullif(coalesce(hybrid_entity_key, vessel_id, master_vessel_id, port_call_id), ''),
    nullif(coalesce(port, port_code), ''),
    nullif(coalesce(event_type, source_name, source), ''),
    nullif(coalesce(event_time::text, event_time_bucket::text, created_at::text), '')
  )
)
where event_key is null;

create unique index if not exists vessel_events_event_key_uidx
  on public.vessel_events(event_key)
  where event_key is not null;

create table if not exists public.port_daily_summary (
  id bigserial primary key,
  summary_key text,
  summary_date date not null default current_date,
  period_start date,
  period_end date,
  snapshot_date date,
  port_key text not null default 'UNKNOWN',
  port_code text,
  port_name text,
  payload jsonb default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.port_weekly_summary (
  id bigserial primary key,
  summary_key text,
  week_start date not null default date_trunc('week', current_date)::date,
  period_start date,
  period_end date,
  snapshot_date date,
  port_key text not null default 'UNKNOWN',
  port_code text,
  port_name text,
  payload jsonb default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.port_monthly_summary (
  id bigserial primary key,
  summary_key text,
  month_start date not null default date_trunc('month', current_date)::date,
  period_start date,
  period_end date,
  snapshot_date date,
  port_key text not null default 'UNKNOWN',
  port_code text,
  port_name text,
  payload jsonb default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table if exists public.port_daily_summary
  add column if not exists summary_key text,
  add column if not exists period_start date,
  add column if not exists period_end date,
  add column if not exists snapshot_date date,
  add column if not exists updated_at timestamptz default now();

update public.port_daily_summary
set summary_key = coalesce(summary_key, concat_ws('|', 'daily', summary_date::text, port_key)),
    period_start = coalesce(period_start, summary_date),
    period_end = coalesce(period_end, summary_date),
    snapshot_date = coalesce(snapshot_date, summary_date)
where summary_key is null;

create unique index if not exists port_daily_summary_summary_key_uidx
  on public.port_daily_summary(summary_key)
  where summary_key is not null;

alter table if exists public.port_weekly_summary
  add column if not exists summary_key text,
  add column if not exists period_start date,
  add column if not exists period_end date,
  add column if not exists snapshot_date date,
  add column if not exists updated_at timestamptz default now();

update public.port_weekly_summary
set summary_key = coalesce(summary_key, concat_ws('|', 'weekly', week_start::text, port_key)),
    period_start = coalesce(period_start, week_start),
    period_end = coalesce(period_end, week_start + 6),
    snapshot_date = coalesce(snapshot_date, week_start)
where summary_key is null;

create unique index if not exists port_weekly_summary_summary_key_uidx
  on public.port_weekly_summary(summary_key)
  where summary_key is not null;

alter table if exists public.port_monthly_summary
  add column if not exists summary_key text,
  add column if not exists period_start date,
  add column if not exists period_end date,
  add column if not exists snapshot_date date,
  add column if not exists updated_at timestamptz default now();

update public.port_monthly_summary
set summary_key = coalesce(summary_key, concat_ws('|', 'monthly', month_start::text, port_key)),
    period_start = coalesce(period_start, month_start),
    period_end = coalesce(period_end, (month_start + interval '1 month - 1 day')::date),
    snapshot_date = coalesce(snapshot_date, month_start)
where summary_key is null;

create unique index if not exists port_monthly_summary_summary_key_uidx
  on public.port_monthly_summary(summary_key)
  where summary_key is not null;

drop trigger if exists trg_hwk_normalize_pilot_schedule_time on public.pilot_schedule_events;

create or replace function public.kpi_try_timestamptz(value text)
returns timestamptz
language plpgsql
as $$
begin
  if value is null or btrim(value) = '' or btrim(value) = '-' then
    return null;
  end if;
  if value ~ '^\d{1,2}:\d{2}(:\d{2})?$' then
    return null;
  end if;
  return value::timestamptz;
exception when others then
  return null;
end;
$$;

create or replace function public.kpi_normalize_pilot_schedule_time()
returns trigger
language plpgsql
as $$
begin
  new.pilot_time_raw := coalesce(new.pilot_time_raw, new.pilot_time);
  if new.pilot_time_at is null and new.pilot_time is not null then
    new.pilot_time_at := public.kpi_try_timestamptz(new.pilot_time);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_kpi_normalize_pilot_schedule_time on public.pilot_schedule_events;
create trigger trg_kpi_normalize_pilot_schedule_time
before insert or update on public.pilot_schedule_events
for each row
execute function public.kpi_normalize_pilot_schedule_time();

drop function if exists public.hwk_normalize_pilot_schedule_time();
drop function if exists public.hwk_try_timestamptz(text);
drop view if exists public.hwk_storage_table_sizes;

create or replace view public.kpi_storage_table_sizes as
select
  schemaname,
  relname as table_name,
  n_live_tup as estimated_rows,
  pg_total_relation_size(relid) as total_bytes,
  pg_relation_size(relid) as table_bytes,
  pg_indexes_size(relid) as index_bytes
from pg_stat_user_tables;
