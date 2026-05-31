-- Rebalance port numeric snapshot retention.
-- Detailed port_snapshot_daily rows are short-lived operational evidence.
-- Long-term port trends live in compact daily/weekly/monthly summaries.

create table if not exists public.port_daily_summary (
  summary_date date not null,
  run_id text,
  latest_run_id text,
  port_code text not null,
  port_name text,
  sub_port text default '' not null,
  top_port_call_id text,
  top_opportunity_id text,
  total_vessels int default 0,
  target_vessels int default 0,
  immediate_targets int default 0,
  sales_targets int default 0,
  watchlist_count int default 0,
  opportunity_count int default 0,
  open_opportunities int default 0,
  closed_opportunities int default 0,
  anchorage_vessels int default 0,
  long_stay_vessels int default 0,
  avg_stay_hours numeric default 0,
  avg_anchorage_hours numeric default 0,
  avg_congestion_score numeric default 0,
  avg_commercial_value_score numeric default 0,
  avg_predicted_cleaning_opportunity_score numeric default 0,
  port_opportunity_score int default 0,
  port_congestion_score int default 0,
  source_run_count int default 1,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  payload jsonb default '{}'::jsonb
);

create table if not exists public.port_weekly_summary (
  week_start_date date not null,
  week_end_date date not null,
  run_id text,
  latest_run_id text,
  port_code text not null,
  port_name text,
  sub_port text default '' not null,
  top_port_call_id text,
  top_opportunity_id text,
  total_vessels int default 0,
  target_vessels int default 0,
  immediate_targets int default 0,
  sales_targets int default 0,
  watchlist_count int default 0,
  opportunity_count int default 0,
  open_opportunities int default 0,
  closed_opportunities int default 0,
  anchorage_vessels int default 0,
  long_stay_vessels int default 0,
  avg_stay_hours numeric default 0,
  avg_anchorage_hours numeric default 0,
  avg_congestion_score numeric default 0,
  avg_commercial_value_score numeric default 0,
  avg_predicted_cleaning_opportunity_score numeric default 0,
  port_opportunity_score int default 0,
  port_congestion_score int default 0,
  source_run_count int default 1,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  payload jsonb default '{}'::jsonb
);

create table if not exists public.port_monthly_summary (
  month_start_date date not null,
  month_end_date date not null,
  run_id text,
  latest_run_id text,
  port_code text not null,
  port_name text,
  sub_port text default '' not null,
  top_port_call_id text,
  top_opportunity_id text,
  total_vessels int default 0,
  target_vessels int default 0,
  immediate_targets int default 0,
  sales_targets int default 0,
  watchlist_count int default 0,
  opportunity_count int default 0,
  open_opportunities int default 0,
  closed_opportunities int default 0,
  anchorage_vessels int default 0,
  long_stay_vessels int default 0,
  avg_stay_hours numeric default 0,
  avg_anchorage_hours numeric default 0,
  avg_congestion_score numeric default 0,
  avg_commercial_value_score numeric default 0,
  avg_predicted_cleaning_opportunity_score numeric default 0,
  port_opportunity_score int default 0,
  port_congestion_score int default 0,
  source_run_count int default 1,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  payload jsonb default '{}'::jsonb
);

insert into public.port_daily_summary (
  summary_date, run_id, latest_run_id, port_code, port_name, sub_port,
  top_port_call_id, top_opportunity_id, total_vessels, target_vessels, immediate_targets,
  sales_targets, watchlist_count, opportunity_count, open_opportunities, closed_opportunities,
  anchorage_vessels, long_stay_vessels, avg_stay_hours, avg_anchorage_hours,
  avg_congestion_score, avg_commercial_value_score, avg_predicted_cleaning_opportunity_score,
  port_opportunity_score, port_congestion_score, source_run_count, created_at, updated_at, payload
)
select
  snapshot_date,
  (array_agg(run_id order by created_at desc))[1],
  (array_agg(run_id order by created_at desc))[1],
  port_code,
  (array_agg(port_name order by created_at desc))[1],
  coalesce(sub_port, ''),
  (array_agg(top_port_call_id order by port_opportunity_score desc nulls last))[1],
  (array_agg(top_opportunity_id order by port_opportunity_score desc nulls last))[1],
  max(total_vessels),
  max(target_vessels),
  max(immediate_targets),
  max(sales_targets),
  max(watchlist_count),
  max(opportunity_count),
  max(open_opportunities),
  max(closed_opportunities),
  max(anchorage_vessels),
  max(long_stay_vessels),
  avg(avg_stay_hours),
  avg(avg_anchorage_hours),
  avg(avg_congestion_score),
  avg(avg_commercial_value_score),
  avg(avg_predicted_cleaning_opportunity_score),
  max(port_opportunity_score),
  max(port_congestion_score),
  count(distinct run_id),
  min(created_at),
  now(),
  jsonb_build_object('compacted_from', 'port_snapshot_daily', 'period', 'daily')
from public.port_snapshot_daily
group by snapshot_date, port_code, coalesce(sub_port, '')
on conflict do nothing;

insert into public.port_weekly_summary (
  week_start_date, week_end_date, run_id, latest_run_id, port_code, port_name, sub_port,
  top_port_call_id, top_opportunity_id, total_vessels, target_vessels, immediate_targets,
  sales_targets, watchlist_count, opportunity_count, open_opportunities, closed_opportunities,
  anchorage_vessels, long_stay_vessels, avg_stay_hours, avg_anchorage_hours,
  avg_congestion_score, avg_commercial_value_score, avg_predicted_cleaning_opportunity_score,
  port_opportunity_score, port_congestion_score, source_run_count, created_at, updated_at, payload
)
select
  date_trunc('week', snapshot_date::timestamptz)::date,
  (date_trunc('week', snapshot_date::timestamptz)::date + 6),
  (array_agg(run_id order by created_at desc))[1],
  (array_agg(run_id order by created_at desc))[1],
  port_code,
  (array_agg(port_name order by created_at desc))[1],
  coalesce(sub_port, ''),
  (array_agg(top_port_call_id order by port_opportunity_score desc nulls last))[1],
  (array_agg(top_opportunity_id order by port_opportunity_score desc nulls last))[1],
  max(total_vessels),
  max(target_vessels),
  max(immediate_targets),
  max(sales_targets),
  max(watchlist_count),
  max(opportunity_count),
  max(open_opportunities),
  max(closed_opportunities),
  max(anchorage_vessels),
  max(long_stay_vessels),
  avg(avg_stay_hours),
  avg(avg_anchorage_hours),
  avg(avg_congestion_score),
  avg(avg_commercial_value_score),
  avg(avg_predicted_cleaning_opportunity_score),
  max(port_opportunity_score),
  max(port_congestion_score),
  count(distinct run_id),
  min(created_at),
  now(),
  jsonb_build_object('compacted_from', 'port_snapshot_daily', 'period', 'weekly')
from public.port_snapshot_daily
group by date_trunc('week', snapshot_date::timestamptz)::date, port_code, coalesce(sub_port, '')
on conflict do nothing;

insert into public.port_monthly_summary (
  month_start_date, month_end_date, run_id, latest_run_id, port_code, port_name, sub_port,
  top_port_call_id, top_opportunity_id, total_vessels, target_vessels, immediate_targets,
  sales_targets, watchlist_count, opportunity_count, open_opportunities, closed_opportunities,
  anchorage_vessels, long_stay_vessels, avg_stay_hours, avg_anchorage_hours,
  avg_congestion_score, avg_commercial_value_score, avg_predicted_cleaning_opportunity_score,
  port_opportunity_score, port_congestion_score, source_run_count, created_at, updated_at, payload
)
select
  date_trunc('month', snapshot_date::timestamptz)::date,
  (date_trunc('month', snapshot_date::timestamptz)::date + interval '1 month - 1 day')::date,
  (array_agg(run_id order by created_at desc))[1],
  (array_agg(run_id order by created_at desc))[1],
  port_code,
  (array_agg(port_name order by created_at desc))[1],
  coalesce(sub_port, ''),
  (array_agg(top_port_call_id order by port_opportunity_score desc nulls last))[1],
  (array_agg(top_opportunity_id order by port_opportunity_score desc nulls last))[1],
  max(total_vessels),
  max(target_vessels),
  max(immediate_targets),
  max(sales_targets),
  max(watchlist_count),
  max(opportunity_count),
  max(open_opportunities),
  max(closed_opportunities),
  max(anchorage_vessels),
  max(long_stay_vessels),
  avg(avg_stay_hours),
  avg(avg_anchorage_hours),
  avg(avg_congestion_score),
  avg(avg_commercial_value_score),
  avg(avg_predicted_cleaning_opportunity_score),
  max(port_opportunity_score),
  max(port_congestion_score),
  count(distinct run_id),
  min(created_at),
  now(),
  jsonb_build_object('compacted_from', 'port_snapshot_daily', 'period', 'monthly')
from public.port_snapshot_daily
group by date_trunc('month', snapshot_date::timestamptz)::date, port_code, coalesce(sub_port, '')
on conflict do nothing;

create unique index if not exists ux_port_daily_summary_date_port
  on public.port_daily_summary(summary_date, port_code, sub_port);
create unique index if not exists ux_port_weekly_summary_week_port
  on public.port_weekly_summary(week_start_date, port_code, sub_port);
create unique index if not exists ux_port_monthly_summary_month_port
  on public.port_monthly_summary(month_start_date, port_code, sub_port);

create index if not exists idx_port_daily_summary_port on public.port_daily_summary(port_code, summary_date desc);
create index if not exists idx_port_weekly_summary_port on public.port_weekly_summary(port_code, week_start_date desc);
create index if not exists idx_port_monthly_summary_port on public.port_monthly_summary(port_code, month_start_date desc);
create index if not exists idx_port_snapshot_daily_run_date on public.port_snapshot_daily(run_id, snapshot_date desc);

comment on table public.port_snapshot_daily is 'Short-retention detailed port numeric snapshots. Keep latest 24-48h or latest 20 successful runs; compact older rows into port_daily_summary, port_weekly_summary, and port_monthly_summary.';
comment on table public.port_daily_summary is 'Compact daily port trend summary generated from detailed port snapshots.';
comment on table public.port_weekly_summary is 'Compact weekly port trend summary generated from detailed port snapshots.';
comment on table public.port_monthly_summary is 'Compact monthly port trend summary generated from detailed port snapshots.';
