-- Schema integrity repairs for production storage failures.
-- Scope: constraints, columns, summary tables, and DB-side timestamp tolerance only.

begin;

-- P0: vessel_events.upsert uses onConflict: event_uid.
-- PostgREST/Postgres ON CONFLICT (event_uid) cannot infer a partial unique index.
alter table if exists vessel_events add column if not exists event_uid text;
alter table if exists vessel_events add column if not exists port_call_id text;
alter table if exists vessel_events add column if not exists event_time_bucket timestamptz;
alter table if exists vessel_events add column if not exists created_at timestamptz default now();

create table if not exists vessel_events_duplicate_quarantine (
  quarantine_id bigserial primary key,
  event_uid text not null,
  kept_event_id bigint,
  duplicate_event_id bigint,
  quarantined_at timestamptz not null default now(),
  row_data jsonb not null
);

with ranked as (
  select
    id,
    event_uid,
    first_value(id) over (
      partition by event_uid
      order by coalesce(created_at, event_at, event_time, now()) desc, id desc
    ) as kept_id,
    row_number() over (
      partition by event_uid
      order by coalesce(created_at, event_at, event_time, now()) desc, id desc
    ) as rn
  from vessel_events
  where event_uid is not null
),
quarantined as (
  insert into vessel_events_duplicate_quarantine (
    event_uid,
    kept_event_id,
    duplicate_event_id,
    row_data
  )
  select
    ranked.event_uid,
    ranked.kept_id,
    vessel_events.id,
    to_jsonb(vessel_events.*)
  from ranked
  join vessel_events on vessel_events.id = ranked.id
  where ranked.rn > 1
  returning duplicate_event_id
)
delete from vessel_events
using quarantined
where vessel_events.id = quarantined.duplicate_event_id;

create unique index if not exists ux_vessel_events_event_uid on vessel_events(event_uid);
create unique index if not exists ux_vessel_events_port_call_type_bucket
  on vessel_events(port_call_id, event_type, event_time_bucket)
  where port_call_id is not null and event_time_bucket is not null;
create index if not exists idx_vessel_events_run_id on vessel_events(run_id);
create index if not exists idx_vessel_events_type_time on vessel_events(event_type, event_time desc);
create index if not exists idx_vessel_events_port_call on vessel_events(port_call_id);

-- P1: dashboard_summary_snapshots missing columns.
alter table if exists dashboard_summary_snapshots add column if not exists data_mode text;
alter table if exists dashboard_summary_snapshots add column if not exists total_vessels int default 0;

update dashboard_summary_snapshots
set total_vessels = coalesce(nullif(total_vessels, 0), all_vessels_count, record_count, 0)
where total_vessels is null or total_vessels = 0;

update dashboard_summary_snapshots
set data_mode = coalesce(
  data_mode,
  source_health_summary->>'data_mode',
  source_health_summary->>'mode',
  case
    when coalesce(all_vessels_count, record_count, 0) > 0 then 'live'
    else 'unknown'
  end
)
where data_mode is null;

create index if not exists idx_dashboard_summary_snapshots_data_mode
  on dashboard_summary_snapshots(data_mode);
create index if not exists idx_dashboard_summary_snapshots_generated_at
  on dashboard_summary_snapshots(generated_at desc);

-- P2: compact port summary tables.
create table if not exists port_daily_summary (
  id bigserial primary key,
  summary_date date not null,
  port_key text not null,
  port_code text,
  port_name text not null default '미확인 항만',
  vessel_count int default 0,
  hot_candidate_count int default 0,
  avg_opportunity_score numeric,
  source_run_count int default 0,
  first_seen_at timestamptz,
  last_seen_at timestamptz,
  generated_at timestamptz default now(),
  payload jsonb default '{}'::jsonb,
  unique(summary_date, port_key)
);

create table if not exists port_weekly_summary (
  id bigserial primary key,
  week_start date not null,
  port_key text not null,
  port_code text,
  port_name text not null default '미확인 항만',
  vessel_count int default 0,
  hot_candidate_count int default 0,
  avg_opportunity_score numeric,
  source_run_count int default 0,
  first_seen_at timestamptz,
  last_seen_at timestamptz,
  generated_at timestamptz default now(),
  payload jsonb default '{}'::jsonb,
  unique(week_start, port_key)
);

create table if not exists port_monthly_summary (
  id bigserial primary key,
  month_start date not null,
  port_key text not null,
  port_code text,
  port_name text not null default '미확인 항만',
  vessel_count int default 0,
  hot_candidate_count int default 0,
  avg_opportunity_score numeric,
  source_run_count int default 0,
  first_seen_at timestamptz,
  last_seen_at timestamptz,
  generated_at timestamptz default now(),
  payload jsonb default '{}'::jsonb,
  unique(month_start, port_key)
);

create index if not exists idx_port_daily_summary_date on port_daily_summary(summary_date desc);
create index if not exists idx_port_daily_summary_port on port_daily_summary(port_key, summary_date desc);
create index if not exists idx_port_weekly_summary_week on port_weekly_summary(week_start desc);
create index if not exists idx_port_weekly_summary_port on port_weekly_summary(port_key, week_start desc);
create index if not exists idx_port_monthly_summary_month on port_monthly_summary(month_start desc);
create index if not exists idx_port_monthly_summary_port on port_monthly_summary(port_key, month_start desc);

-- Optional backfill from detailed run-level port snapshots.
insert into port_daily_summary (
  summary_date,
  port_key,
  port_code,
  port_name,
  vessel_count,
  hot_candidate_count,
  avg_opportunity_score,
  source_run_count,
  first_seen_at,
  last_seen_at,
  payload
)
select
  snapshot_date,
  coalesce(nullif(port_code, ''), nullif(port_name, ''), 'UNKNOWN') || '|' || coalesce(nullif(sub_port, ''), ''),
  nullif(port_code, ''),
  coalesce(nullif(port_name, ''), '미확인 항만'),
  max(coalesce(total_vessels, 0)),
  max(coalesce(immediate_targets, 0)),
  avg(nullif(port_opportunity_score, 0)),
  count(distinct run_id),
  min(created_at),
  max(created_at),
  jsonb_build_object('backfilled_from', 'port_snapshot_daily')
from port_snapshot_daily
group by snapshot_date, coalesce(nullif(port_code, ''), nullif(port_name, ''), 'UNKNOWN'), coalesce(nullif(sub_port, ''), ''), nullif(port_code, ''), coalesce(nullif(port_name, ''), '미확인 항만')
on conflict (summary_date, port_key) do update
set
  vessel_count = excluded.vessel_count,
  hot_candidate_count = excluded.hot_candidate_count,
  avg_opportunity_score = excluded.avg_opportunity_score,
  source_run_count = excluded.source_run_count,
  first_seen_at = least(port_daily_summary.first_seen_at, excluded.first_seen_at),
  last_seen_at = greatest(port_daily_summary.last_seen_at, excluded.last_seen_at),
  generated_at = now();

insert into port_weekly_summary (
  week_start,
  port_key,
  port_code,
  port_name,
  vessel_count,
  hot_candidate_count,
  avg_opportunity_score,
  source_run_count,
  first_seen_at,
  last_seen_at,
  payload
)
select
  date_trunc('week', summary_date)::date,
  port_key,
  max(port_code),
  max(port_name),
  max(vessel_count),
  max(hot_candidate_count),
  avg(avg_opportunity_score),
  sum(source_run_count),
  min(first_seen_at),
  max(last_seen_at),
  jsonb_build_object('backfilled_from', 'port_daily_summary')
from port_daily_summary
group by date_trunc('week', summary_date)::date, port_key
on conflict (week_start, port_key) do update
set
  vessel_count = excluded.vessel_count,
  hot_candidate_count = excluded.hot_candidate_count,
  avg_opportunity_score = excluded.avg_opportunity_score,
  source_run_count = excluded.source_run_count,
  first_seen_at = least(port_weekly_summary.first_seen_at, excluded.first_seen_at),
  last_seen_at = greatest(port_weekly_summary.last_seen_at, excluded.last_seen_at),
  generated_at = now();

insert into port_monthly_summary (
  month_start,
  port_key,
  port_code,
  port_name,
  vessel_count,
  hot_candidate_count,
  avg_opportunity_score,
  source_run_count,
  first_seen_at,
  last_seen_at,
  payload
)
select
  date_trunc('month', summary_date)::date,
  port_key,
  max(port_code),
  max(port_name),
  max(vessel_count),
  max(hot_candidate_count),
  avg(avg_opportunity_score),
  sum(source_run_count),
  min(first_seen_at),
  max(last_seen_at),
  jsonb_build_object('backfilled_from', 'port_daily_summary')
from port_daily_summary
group by date_trunc('month', summary_date)::date, port_key
on conflict (month_start, port_key) do update
set
  vessel_count = excluded.vessel_count,
  hot_candidate_count = excluded.hot_candidate_count,
  avg_opportunity_score = excluded.avg_opportunity_score,
  source_run_count = excluded.source_run_count,
  first_seen_at = least(port_monthly_summary.first_seen_at, excluded.first_seen_at),
  last_seen_at = greatest(port_monthly_summary.last_seen_at, excluded.last_seen_at),
  generated_at = now();

-- P3: tolerate time-only pilot schedule values such as '04:30'.
alter table if exists pilot_schedule_events add column if not exists pilot_time_raw text;
alter table if exists pilot_schedule_events add column if not exists pilot_time_at timestamptz;

update pilot_schedule_events
set pilot_time_raw = coalesce(pilot_time_raw, pilot_time::text)
where pilot_time_raw is null and pilot_time is not null;

alter table if exists pilot_schedule_events
  alter column pilot_time type text using pilot_time::text;

create or replace function hwk_try_timestamptz(value text)
returns timestamptz
language plpgsql
stable
as $$
begin
  if value is null or btrim(value) = '' then
    return null;
  end if;

  if value !~ '^\d{4}-\d{2}-\d{2}' then
    return null;
  end if;

  return value::timestamptz;
exception when others then
  return null;
end;
$$;

update pilot_schedule_events
set pilot_time_at = hwk_try_timestamptz(pilot_time)
where pilot_time_at is null and pilot_time is not null;

create or replace function hwk_normalize_pilot_schedule_time()
returns trigger
language plpgsql
as $$
begin
  new.pilot_time_raw := coalesce(new.pilot_time_raw, new.pilot_time);

  if new.pilot_time_at is null and new.pilot_time is not null then
    new.pilot_time_at := hwk_try_timestamptz(new.pilot_time);
  end if;

  return new;
end;
$$;

drop trigger if exists trg_hwk_normalize_pilot_schedule_time on pilot_schedule_events;
create trigger trg_hwk_normalize_pilot_schedule_time
before insert or update on pilot_schedule_events
for each row
execute function hwk_normalize_pilot_schedule_time();

drop index if exists idx_pilot_schedule_events_pilot_time;
create index if not exists idx_pilot_schedule_events_pilot_time on pilot_schedule_events(pilot_time_at desc);
create index if not exists idx_pilot_schedule_events_pilot_time_raw on pilot_schedule_events(pilot_time);

commit;
