-- Keep core updates on lightweight optional CSV only and repair event upsert keys.

alter table if exists vessel_events add column if not exists event_key text;

update vessel_events
set event_key = coalesce(event_key, event_uid)
where event_key is null
  and event_uid is not null;

create unique index if not exists ux_vessel_events_event_key
  on vessel_events(event_key);

create table if not exists port_daily_summary (
  summary_date date not null,
  port_key text not null,
  port_code text,
  port_name text,
  vessel_count int default 0,
  target_vessel_count int default 0,
  immediate_target_count int default 0,
  commercial_total numeric default 0,
  first_seen_at timestamptz,
  last_seen_at timestamptz,
  payload jsonb default '{}'::jsonb,
  primary key (summary_date, port_key)
);

create table if not exists port_weekly_summary (
  week_start date not null,
  port_key text not null,
  port_code text,
  port_name text,
  vessel_count int default 0,
  target_vessel_count int default 0,
  immediate_target_count int default 0,
  commercial_total numeric default 0,
  first_seen_at timestamptz,
  last_seen_at timestamptz,
  payload jsonb default '{}'::jsonb,
  primary key (week_start, port_key)
);

create table if not exists port_monthly_summary (
  month_start date not null,
  port_key text not null,
  port_code text,
  port_name text,
  vessel_count int default 0,
  target_vessel_count int default 0,
  immediate_target_count int default 0,
  commercial_total numeric default 0,
  first_seen_at timestamptz,
  last_seen_at timestamptz,
  payload jsonb default '{}'::jsonb,
  primary key (month_start, port_key)
);

