# Supabase RLS Security Hardening Audit

Generated: 2026-06-10 KST

Scope: all base and partitioned tables in the `public` schema

Mode: read-only audit. No migration was applied by this audit.

## Executive Summary

The production Supabase project still has a public-schema RLS exposure.

- Public tables audited: 63
- RLS disabled: 48
- SAFE: 15
- WARNING: 0
- CRITICAL: 48
- Critical business tables still exposed: 4

The original core dashboard tables have already been hardened, but many newer intelligence, enrichment, route, operator, event, and audit tables still have RLS disabled while broad `anon` and `authenticated` grants exist. This matches the Supabase warning `rls_disabled_in_public` / `Table publicly accessible`.

## Static JSON Architecture Review

Expected serving path:

```text
GitHub Actions / Longterm Update
-> Supabase long-term storage
-> latest successful static JSON snapshot
-> frontend dashboard
```

The frontend should not need direct table reads from Supabase. Based on this architecture:

- Enable RLS on all public intelligence tables.
- Revoke direct `anon` and `authenticated` table grants.
- Use service-role credentials only from scheduled update jobs, backend scripts, and trusted server-side workers.
- Keep browser-facing data in generated static JSON snapshots.
- If a future authenticated customer product needs DB access, expose narrow views/RPCs with explicit tenant-aware policies instead of opening raw tables.

## Critical Business Table Review

| Table | Status | Notes |
|---|---|---|
| `vessel_master` | SAFE | RLS enabled; no anon access detected. |
| `vessel_snapshots` | SAFE | RLS enabled; no anon access detected. |
| `vessel_entities` | SAFE | RLS enabled; no anon access detected. |
| `port_call_master` | SAFE | RLS enabled; no anon access detected. |
| `opportunity_master` | SAFE | RLS enabled; no anon access detected. |
| `risk_history` | SAFE | RLS enabled; no anon access detected. |
| `commercial_leads` | SAFE | RLS enabled; no anon access detected. |
| `operator_contact_history` | SAFE | RLS enabled; no anon access detected. |
| `sales_candidates_current` | SAFE | RLS enabled; no anon access detected. |
| `immediate_targets_current` | SAFE | RLS enabled; no anon access detected. |
| `dashboard_summary_snapshots` | SAFE | RLS enabled; no anon access detected. |
| `active_dataset_pointer` | SAFE | RLS enabled; no anon access detected. |
| `vessel_visits` | NOT FOUND | Not present in the audited public schema. |
| `feature_store` | CRITICAL | RLS disabled; public read/write grants detected. |
| `feature_snapshots` | CRITICAL | RLS disabled; public read/write grants detected. |
| `explainability_snapshots` | CRITICAL | RLS disabled; public read/write grants detected. |
| `rule_evaluations` | CRITICAL | RLS disabled; public read/write grants detected. |

## Full Public Table Audit

`anon_access_possible` means public grants exist and either RLS is disabled or a public policy exists.

| Table | Row Count | RLS Enabled | Anon Access Possible | Service Role Access | Risk |
|---|---:|---|---|---|---|
| `active_dataset_pointer` | 1 | yes | no | yes | SAFE |
| `agent_master` | 658 | no | yes | yes | CRITICAL |
| `agent_operator_links` | 58 | no | yes | yes | CRITICAL |
| `agent_operator_mapping` | 58 | no | yes | yes | CRITICAL |
| `anchorage_clusters` | 0 | no | yes | yes | CRITICAL |
| `berth_aliases` | 0 | no | yes | yes | CRITICAL |
| `berth_occupancy_history` | 0 | no | yes | yes | CRITICAL |
| `commercial_leads` | 5 | yes | no | yes | SAFE |
| `commercial_opportunity_daily` | 48 | no | yes | yes | CRITICAL |
| `contact_master` | 680 | no | yes | yes | CRITICAL |
| `dashboard_summary_snapshots` | 225 | yes | no | yes | SAFE |
| `data_collection_runs` | 251 | no | yes | yes | CRITICAL |
| `duplicate_cleanup_quarantine` | 3542 | no | yes | yes | CRITICAL |
| `enrichment_match_candidates` | 600 | no | yes | yes | CRITICAL |
| `explainability_snapshots` | 1440 | no | yes | yes | CRITICAL |
| `feature_snapshots` | 1440 | no | yes | yes | CRITICAL |
| `feature_store` | 1440 | no | yes | yes | CRITICAL |
| `immediate_targets_current` | 862 | yes | no | yes | SAFE |
| `imo_recovery_queue` | 3944 | no | yes | yes | CRITICAL |
| `model_training_rows` | 943 | no | yes | yes | CRITICAL |
| `operator_contact_history` | 1509 | yes | no | yes | SAFE |
| `operator_fleet_opportunities` | 396 | no | yes | yes | CRITICAL |
| `operator_graph_edges` | 274 | no | yes | yes | CRITICAL |
| `operator_history` | 1509 | no | yes | yes | CRITICAL |
| `operator_master` | 11 | no | yes | yes | CRITICAL |
| `operator_snapshot_daily` | 99 | no | yes | yes | CRITICAL |
| `opportunity_master` | 5774 | yes | no | yes | SAFE |
| `pilot_schedule_events` | 180 | no | yes | yes | CRITICAL |
| `pipeline_runs` | 0 | no | yes | yes | CRITICAL |
| `port_call_master` | 1515 | yes | no | yes | SAFE |
| `port_calls` | 0 | no | yes | yes | CRITICAL |
| `port_congestion_snapshots` | 310 | no | yes | yes | CRITICAL |
| `port_daily_summary` | 18 | no | yes | yes | CRITICAL |
| `port_geojson_snapshots` | 36 | yes | no | yes | SAFE |
| `port_monthly_summary` | 18 | no | yes | yes | CRITICAL |
| `port_snapshot_daily` | 81 | no | yes | yes | CRITICAL |
| `port_summary_current` | 9 | no | yes | yes | CRITICAL |
| `port_vessel_features` | 5376 | yes | no | yes | SAFE |
| `port_weekly_summary` | 18 | no | yes | yes | CRITICAL |
| `predicted_arrivals` | 1266 | no | yes | yes | CRITICAL |
| `private_sales_activity` | 0 | yes | no | yes | SAFE |
| `raw_archive_index` | 0 | no | yes | yes | CRITICAL |
| `risk_history` | 1440 | yes | no | yes | SAFE |
| `route_graph_edges` | 0 | no | yes | yes | CRITICAL |
| `route_patterns` | 1388 | no | yes | yes | CRITICAL |
| `route_snapshot_daily` | 4875 | no | yes | yes | CRITICAL |
| `rule_evaluations` | 2291 | no | yes | yes | CRITICAL |
| `sales_candidates_current` | 1419 | yes | no | yes | SAFE |
| `schema_migrations` | 9 | no | yes | yes | CRITICAL |
| `source_collection_logs` | 47 | no | yes | yes | CRITICAL |
| `terminal_aliases` | 0 | no | yes | yes | CRITICAL |
| `vessel_aliases` | 5955 | no | yes | yes | CRITICAL |
| `vessel_entities` | 2629 | yes | no | yes | SAFE |
| `vessel_events` | 67578 | no | yes | yes | CRITICAL |
| `vessel_events_duplicate_quarantine` | 0 | no | yes | yes | CRITICAL |
| `vessel_identity_candidates` | 1515 | no | yes | yes | CRITICAL |
| `vessel_master` | 2558 | yes | no | yes | SAFE |
| `vessel_operator_history` | 1509 | no | yes | yes | CRITICAL |
| `vessel_route_history` | 1068 | no | yes | yes | CRITICAL |
| `vessel_snapshot_daily` | 1515 | no | yes | yes | CRITICAL |
| `vessel_snapshots` | 1515 | yes | no | yes | SAFE |
| `vessel_universe_audit` | 240 | no | yes | yes | CRITICAL |
| `vessels` | 0 | no | yes | yes | CRITICAL |

## Policy Recommendation

For intelligence, lead, enrichment, route, operator, feature, model, and event tables:

- Access model: service role only.
- `anon`: deny reads and writes.
- `authenticated`: deny reads and writes until an explicit customer/tenant access model exists.
- Dashboard reads: static JSON snapshots only.
- Scheduled update jobs: service-role writes to Supabase, then emit latest successful JSON.

Recommended deny-all pattern:

```sql
alter table public.<table_name> enable row level security;
revoke all on table public.<table_name> from anon, authenticated;
drop policy if exists "deny_public_<table_name>" on public.<table_name>;
create policy "deny_public_<table_name>"
on public.<table_name>
for all
to anon, authenticated
using (false)
with check (false);
```

Do not use `force row level security` in the first pass. The service-role update jobs should continue to bypass RLS.

## Migration Plan

Generated migration file:

- `migrations/20260610_001_public_schema_rls_hardening.sql`

This migration is intentionally not applied by this audit. It loops through all public base/partitioned tables, enables RLS, revokes public grants from `anon` and `authenticated`, and creates deny-all public policies.

Minimum per-table RLS enable statements for currently disabled tables:

```sql
ALTER TABLE public.agent_master ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_operator_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_operator_mapping ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.anchorage_clusters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.berth_aliases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.berth_occupancy_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commercial_opportunity_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contact_master ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.data_collection_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.duplicate_cleanup_quarantine ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.enrichment_match_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.explainability_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feature_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feature_store ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.imo_recovery_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.model_training_rows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.operator_fleet_opportunities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.operator_graph_edges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.operator_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.operator_master ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.operator_snapshot_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pilot_schedule_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pipeline_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.port_calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.port_congestion_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.port_daily_summary ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.port_monthly_summary ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.port_snapshot_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.port_summary_current ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.port_weekly_summary ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.predicted_arrivals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.raw_archive_index ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.route_graph_edges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.route_patterns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.route_snapshot_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rule_evaluations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.schema_migrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.source_collection_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.terminal_aliases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vessel_aliases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vessel_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vessel_events_duplicate_quarantine ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vessel_identity_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vessel_operator_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vessel_route_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vessel_snapshot_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vessel_universe_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vessels ENABLE ROW LEVEL SECURITY;
```

## Verification

Read-only command:

```bash
npm run audit:security
```

Expected current result before applying the migration:

- `public_tables: 63`
- `rls_disabled: 48`
- `critical: 48`

Expected result after applying the migration:

- `rls_disabled: 0`
- `critical: 0` for direct public table exposure

Also run:

```bash
npm run validate
```

## Notes

- This audit does not modify the database.
- This audit does not change frontend or application logic.
- Some RLS-enabled tables still show legacy public grants in the catalog, but `anon_access_possible` is `no` because deny-all RLS policies are active. The migration plan still revokes public grants across all public tables as defense in depth.
