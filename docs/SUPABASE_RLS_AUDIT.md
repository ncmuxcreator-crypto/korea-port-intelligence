# Supabase RLS Security Audit

Generated: 2026-06-03 KST

Scope: public schema tables used by the port intelligence pipeline and dashboard serving path.

This audit is read-only. No database changes were applied.

## Summary

The audited Supabase database has a critical RLS exposure.

- 12 of 12 audited public tables have Row Level Security disabled.
- 12 of 12 audited tables grant broad privileges to `anon` and `authenticated`.
- Broad grants include `SELECT`, `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`, `REFERENCES`, and `TRIGGER`.
- No RLS policies currently exist on the audited tables.

Because these tables contain vessel identity, operational snapshots, commercial opportunity scores, risk signals, lead data, and active dataset pointers, the current state should be treated as `CRITICAL` until RLS is enabled and public grants are revoked or contained.

## Method

Queried PostgreSQL catalog tables through the Supabase pooler using the local DB connection string:

- `pg_class.relrowsecurity`
- `pg_class.relforcerowsecurity`
- `pg_policies`
- `information_schema.role_table_grants`

Values below are estimated row counts from `pg_stat_user_tables`.

## Findings

| Table | Rows | RLS Enabled? | Public Exposure Risk | Recommended Policy | Status |
|---|---:|---|---|---|---|
| `vessel_master` | 1,831 | No | `anon` and `authenticated` have read/write/delete/truncate grants. Vessel identity and enrichment cache can be exposed or modified. | Enable RLS, revoke public grants, service-role only. | CRITICAL |
| `vessel_snapshots` | 1,530 | No | `anon` and `authenticated` have read/write/delete/truncate grants. Full vessel snapshot payloads can be exposed or modified. | Enable RLS, revoke public grants, service-role only. Dashboard should use Worker/static JSON, not direct public DB access. | CRITICAL |
| `vessel_entities` | 1,854 | No | `anon` and `authenticated` have read/write/delete/truncate grants. Identity graph can be exposed or corrupted. | Enable RLS, revoke public grants, service-role only. | CRITICAL |
| `port_call_master` | 1,530 | No | `anon` and `authenticated` have read/write/delete/truncate grants. Port-call intelligence and commercial signals can be exposed or modified. | Enable RLS, revoke public grants, service-role only. | CRITICAL |
| `opportunity_master` | 2,210 | No | `anon` and `authenticated` have read/write/delete/truncate grants. Sales scoring and opportunity history can be exposed or modified. | Enable RLS, revoke public grants, service-role only. | CRITICAL |
| `risk_history` | 1,427 | No | `anon` and `authenticated` have read/write/delete/truncate grants. Risk scoring history can be exposed or modified. | Enable RLS, revoke public grants, service-role only. | CRITICAL |
| `commercial_leads` | 1 | No | `anon` and `authenticated` have read/write/delete/truncate grants. Commercial lead data is directly exposed. | Enable RLS, revoke public grants, deny public access. | CRITICAL |
| `operator_contact_history` | 1,524 | No | `anon` and `authenticated` have read/write/delete/truncate grants. Operator/contact intelligence can be exposed or modified. | Enable RLS, revoke public grants, deny public access. | CRITICAL |
| `sales_candidates_current` | 29 | No | `anon` and `authenticated` have read/write/delete/truncate grants. Current sales targets can be exposed or modified. | Enable RLS, revoke public grants, service-role only. | CRITICAL |
| `immediate_targets_current` | 29 | No | `anon` and `authenticated` have read/write/delete/truncate grants. Immediate sales targets can be exposed or modified. | Enable RLS, revoke public grants, service-role only. | CRITICAL |
| `dashboard_summary_snapshots` | 97 | No | `anon` and `authenticated` have read/write/delete/truncate grants. Dashboard snapshot source of truth can be exposed or overwritten. | Enable RLS, revoke public grants, service-role only. | CRITICAL |
| `active_dataset_pointer` | 1 | No | `anon` and `authenticated` have read/write/delete/truncate grants. Active run pointer can be exposed or changed, affecting fallback and snapshot selection. | Enable RLS, revoke public grants, service-role only. | CRITICAL |

## Recommended Access Model

Use this model unless the product later introduces authenticated customer-facing views:

- Frontend: reads static JSON or Worker endpoints only.
- Cloudflare Worker: reads Supabase using server-side `SUPABASE_SERVICE_ROLE_KEY`.
- GitHub Actions Longterm Update: writes Supabase using service-role credentials.
- `anon`: no direct table access.
- `authenticated`: no direct table access until a user/tenant model is designed.

## Migration Plan

This SQL is a plan only. It has not been applied.

The plan does three things:

1. Enables RLS on all audited tables.
2. Revokes broad table privileges from `anon` and `authenticated`.
3. Adds explicit deny-all policies for non-service clients.

The Supabase `service_role` normally bypasses RLS. The policies below are still useful as documentation of intent and as a defensive fallback if bypass behavior is changed by role configuration.

```sql
begin;

-- 1. Enable RLS.
alter table if exists public.vessel_master enable row level security;
alter table if exists public.vessel_snapshots enable row level security;
alter table if exists public.vessel_entities enable row level security;
alter table if exists public.port_call_master enable row level security;
alter table if exists public.opportunity_master enable row level security;
alter table if exists public.risk_history enable row level security;
alter table if exists public.commercial_leads enable row level security;
alter table if exists public.operator_contact_history enable row level security;
alter table if exists public.sales_candidates_current enable row level security;
alter table if exists public.immediate_targets_current enable row level security;
alter table if exists public.dashboard_summary_snapshots enable row level security;
alter table if exists public.active_dataset_pointer enable row level security;

-- Optional hardening. Keep disabled if table owners need to bypass RLS during maintenance.
-- alter table if exists public.vessel_master force row level security;
-- alter table if exists public.vessel_snapshots force row level security;
-- alter table if exists public.vessel_entities force row level security;
-- alter table if exists public.port_call_master force row level security;
-- alter table if exists public.opportunity_master force row level security;
-- alter table if exists public.risk_history force row level security;
-- alter table if exists public.commercial_leads force row level security;
-- alter table if exists public.operator_contact_history force row level security;
-- alter table if exists public.sales_candidates_current force row level security;
-- alter table if exists public.immediate_targets_current force row level security;
-- alter table if exists public.dashboard_summary_snapshots force row level security;
-- alter table if exists public.active_dataset_pointer force row level security;

-- 2. Remove direct public table privileges.
revoke all on table public.vessel_master from anon, authenticated;
revoke all on table public.vessel_snapshots from anon, authenticated;
revoke all on table public.vessel_entities from anon, authenticated;
revoke all on table public.port_call_master from anon, authenticated;
revoke all on table public.opportunity_master from anon, authenticated;
revoke all on table public.risk_history from anon, authenticated;
revoke all on table public.commercial_leads from anon, authenticated;
revoke all on table public.operator_contact_history from anon, authenticated;
revoke all on table public.sales_candidates_current from anon, authenticated;
revoke all on table public.immediate_targets_current from anon, authenticated;
revoke all on table public.dashboard_summary_snapshots from anon, authenticated;
revoke all on table public.active_dataset_pointer from anon, authenticated;

-- 3. Drop any future/legacy policies with the same names before replacing them.
drop policy if exists "deny_public_vessel_master" on public.vessel_master;
drop policy if exists "deny_public_vessel_snapshots" on public.vessel_snapshots;
drop policy if exists "deny_public_vessel_entities" on public.vessel_entities;
drop policy if exists "deny_public_port_call_master" on public.port_call_master;
drop policy if exists "deny_public_opportunity_master" on public.opportunity_master;
drop policy if exists "deny_public_risk_history" on public.risk_history;
drop policy if exists "deny_public_commercial_leads" on public.commercial_leads;
drop policy if exists "deny_public_operator_contact_history" on public.operator_contact_history;
drop policy if exists "deny_public_sales_candidates_current" on public.sales_candidates_current;
drop policy if exists "deny_public_immediate_targets_current" on public.immediate_targets_current;
drop policy if exists "deny_public_dashboard_summary_snapshots" on public.dashboard_summary_snapshots;
drop policy if exists "deny_public_active_dataset_pointer" on public.active_dataset_pointer;

-- Deny-all policies. With no public grants, these are an extra guardrail.
create policy "deny_public_vessel_master"
on public.vessel_master
for all
to anon, authenticated
using (false)
with check (false);

create policy "deny_public_vessel_snapshots"
on public.vessel_snapshots
for all
to anon, authenticated
using (false)
with check (false);

create policy "deny_public_vessel_entities"
on public.vessel_entities
for all
to anon, authenticated
using (false)
with check (false);

create policy "deny_public_port_call_master"
on public.port_call_master
for all
to anon, authenticated
using (false)
with check (false);

create policy "deny_public_opportunity_master"
on public.opportunity_master
for all
to anon, authenticated
using (false)
with check (false);

create policy "deny_public_risk_history"
on public.risk_history
for all
to anon, authenticated
using (false)
with check (false);

create policy "deny_public_commercial_leads"
on public.commercial_leads
for all
to anon, authenticated
using (false)
with check (false);

create policy "deny_public_operator_contact_history"
on public.operator_contact_history
for all
to anon, authenticated
using (false)
with check (false);

create policy "deny_public_sales_candidates_current"
on public.sales_candidates_current
for all
to anon, authenticated
using (false)
with check (false);

create policy "deny_public_immediate_targets_current"
on public.immediate_targets_current
for all
to anon, authenticated
using (false)
with check (false);

create policy "deny_public_dashboard_summary_snapshots"
on public.dashboard_summary_snapshots
for all
to anon, authenticated
using (false)
with check (false);

create policy "deny_public_active_dataset_pointer"
on public.active_dataset_pointer
for all
to anon, authenticated
using (false)
with check (false);

commit;
```

## Optional Service-Role Documentation Policies

These policies are not required for normal Supabase service-role behavior, because the service role bypasses RLS. If you want explicit policy documentation in the database, add service-role policies after confirming they do not interfere with the backend runtime.

```sql
-- Example pattern. Repeat per table only after confirming runtime behavior.
drop policy if exists "service_role_all_vessel_snapshots" on public.vessel_snapshots;
create policy "service_role_all_vessel_snapshots"
on public.vessel_snapshots
for all
to service_role
using (true)
with check (true);
```

## Post-Migration Verification

Run these checks after applying the migration:

```sql
select
  c.relname as table_name,
  c.relrowsecurity as rls_enabled,
  c.relforcerowsecurity as rls_forced
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in (
    'vessel_master',
    'vessel_snapshots',
    'vessel_entities',
    'port_call_master',
    'opportunity_master',
    'risk_history',
    'commercial_leads',
    'operator_contact_history',
    'sales_candidates_current',
    'immediate_targets_current',
    'dashboard_summary_snapshots',
    'active_dataset_pointer'
  )
order by c.relname;

select table_name, grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in (
    'vessel_master',
    'vessel_snapshots',
    'vessel_entities',
    'port_call_master',
    'opportunity_master',
    'risk_history',
    'commercial_leads',
    'operator_contact_history',
    'sales_candidates_current',
    'immediate_targets_current',
    'dashboard_summary_snapshots',
    'active_dataset_pointer'
  )
  and grantee in ('anon', 'authenticated', 'public')
order by table_name, grantee, privilege_type;
```

Expected result:

- Every audited table has `rls_enabled = true`.
- No direct `anon` or `authenticated` grants remain.
- Longterm Update still writes through service role.
- Cloudflare Worker still reads through service role.
- Public dashboard still renders from static JSON / Worker endpoints.

## Risk Notes

- Enabling RLS without service-role runtime credentials would break direct public PostgREST table reads. This is acceptable for the intended architecture because the dashboard should not query Supabase directly from the browser.
- Do not add permissive `anon` policies for these tables unless a separate public-safe view is created.
- If customer-facing access is added later, create narrow read-only views or RPCs rather than exposing operational tables.
