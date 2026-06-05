-- Private sales activity capture foundation.
-- Sensitive activity details remain in Supabase. Public dashboard snapshots
-- must expose aggregate counts only.

begin;

create table if not exists private_sales_activity (
  activity_id text primary key,
  run_id text,
  lead_id text,
  history_id text,
  master_vessel_id text,
  hybrid_entity_key text,
  vessel_name text,
  operator_name text,
  agent_name text,
  port_code text,
  port_name text,
  activity_type text not null,
  activity_at timestamptz not null default now(),
  stage text,
  quote_value numeric,
  quote_currency text default 'USD',
  quote_result text,
  loss_reason text,
  operation_completed boolean default false,
  customer_feedback_summary text,
  sensitive_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint private_sales_activity_type_check check (
    activity_type in (
      'contact_attempt',
      'quote_sent',
      'quote_value',
      'quote_result',
      'won',
      'lost',
      'loss_reason',
      'operation_completed',
      'customer_feedback'
    )
  )
);

alter table commercial_leads add column if not exists last_private_activity_at timestamptz;
alter table commercial_leads add column if not exists private_activity_counts jsonb default '{}'::jsonb;
alter table commercial_leads add column if not exists quote_value numeric;
alter table commercial_leads add column if not exists quote_currency text default 'USD';
alter table commercial_leads add column if not exists quote_result text;
alter table commercial_leads add column if not exists loss_reason text;
alter table commercial_leads add column if not exists operation_completed boolean default false;
alter table commercial_leads add column if not exists customer_feedback_summary text;

create index if not exists idx_private_sales_activity_run_id
  on private_sales_activity(run_id);

create index if not exists idx_private_sales_activity_lead_id
  on private_sales_activity(lead_id);

create index if not exists idx_private_sales_activity_type_at
  on private_sales_activity(activity_type, activity_at desc);

create index if not exists idx_private_sales_activity_operator
  on private_sales_activity(operator_name);

create index if not exists idx_private_sales_activity_port
  on private_sales_activity(port_code);

create index if not exists idx_commercial_leads_private_activity
  on commercial_leads(last_private_activity_at desc);

alter table private_sales_activity enable row level security;

revoke all on table private_sales_activity from anon, authenticated;

drop policy if exists "deny_public_private_sales_activity" on private_sales_activity;

create policy "deny_public_private_sales_activity"
on private_sales_activity
for all
to anon, authenticated
using (false)
with check (false);

commit;
