# Schema Integrity Audit - 2026-06-01

Scope: schema/storage integrity only. API connectivity and collection success were not investigated by request.

## 1. Missing Constraints Report

### P0 - `vessel_events.upsert` fails with `42P10`

Finding:
- Collection code writes `vessel_events` with `upsert(..., { onConflict: "event_uid" })`.
- The schema had a partial unique index on `event_uid`:
  `idx_vessel_events_event_uid on vessel_events(event_uid) where event_uid is not null`.
- PostgreSQL/PostgREST cannot use that partial index as the conflict target for plain `ON CONFLICT (event_uid)`.

Required repair:
- Preserve duplicate rows before enforcing the constraint.
- Quarantine duplicate `event_uid` rows into `vessel_events_duplicate_quarantine`.
- Add a non-partial unique index:
  `ux_vessel_events_event_uid on vessel_events(event_uid)`.

Expected result:
- `vessel_events.upsert` can resolve conflicts by `event_uid`.
- Latest collection runs do not fail storage with `42P10`.

## 2. Missing Table Report

### P2 - Port summary tables are missing

Missing tables:
- `port_daily_summary`
- `port_weekly_summary`
- `port_monthly_summary`

Required repair:
- Create compact port summary tables for daily, weekly, and monthly rollups.
- Add unique keys by period + `port_key`.
- Add date and port lookup indexes.
- Backfill from `port_snapshot_daily` when available.

Expected result:
- Older run-level port snapshots can be compacted without losing dashboard-level port history.
- Vessel-level intelligence remains independent from port numeric snapshot cleanup.

## 3. Missing Column Report

### P1 - `dashboard_summary_snapshots` schema mismatch

Missing columns:
- `data_mode text`
- `total_vessels int default 0`

Required repair:
- Add both columns.
- Backfill `total_vessels` from `all_vessels_count`, then `record_count`.
- Backfill `data_mode` from `source_health_summary`, then fallback to `live` or `unknown`.

Expected result:
- Dashboard summary snapshots can be stored without schema mismatch.
- Top-level numeric dashboard fields remain stable.

### P3 - `pilot_schedule_events.pilot_time` cannot accept time-only values

Finding:
- Raw pilot schedule values can be time-only strings such as `04:30`.
- `pilot_time timestamptz` rejects time-only values with `invalid timestamptz value`.

Required repair:
- Convert `pilot_time` to `text` so raw source values are stored safely.
- Add `pilot_time_raw text`.
- Add `pilot_time_at timestamptz` for parsed full timestamps only.
- Add a DB trigger to populate `pilot_time_raw` and safely parse `pilot_time_at`.

Expected result:
- Time-only pilot rows are stored instead of rejected.
- Full timestamp rows remain queryable through `pilot_time_at`.

## 4. SQL Migration Plan

Apply one migration in this order:

1. P0: prepare `vessel_events`, quarantine duplicate `event_uid` rows, create full unique conflict target.
2. P1: add and backfill `dashboard_summary_snapshots.data_mode` and `dashboard_summary_snapshots.total_vessels`.
3. P2: create compact port summary tables and indexes, then backfill from `port_snapshot_daily`.
4. P3: make pilot schedule time storage raw-safe and add parsed timestamp support.

Migration safety:
- The migration is wrapped in a transaction.
- It uses `if exists` / `if not exists` where practical.
- Duplicate event rows are copied to quarantine before deletion.
- No UI code is changed.
- No API or collector logic is changed.
- Vessel history is not cleaned or deleted.
- Active/latest dataset pointers are not modified.

## 5. Safe Migration Scripts

Primary migration:
- `migrations/20260601_001_schema_integrity_storage_repairs.sql`

Post-migration verification SQL:

```sql
select indexname, indexdef
from pg_indexes
where schemaname = 'public'
  and tablename = 'vessel_events'
  and indexname in ('ux_vessel_events_event_uid', 'idx_vessel_events_event_uid');

select column_name, data_type
from information_schema.columns
where table_schema = 'public'
  and table_name = 'dashboard_summary_snapshots'
  and column_name in ('data_mode', 'total_vessels')
order by column_name;

select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name in (
    'port_daily_summary',
    'port_weekly_summary',
    'port_monthly_summary'
  )
order by table_name;

select column_name, data_type
from information_schema.columns
where table_schema = 'public'
  and table_name = 'pilot_schedule_events'
  and column_name in ('pilot_time', 'pilot_time_raw', 'pilot_time_at')
order by column_name;
```

Smoke test for time-only pilot values:

```sql
insert into pilot_schedule_events (
  run_id,
  port_code,
  vessel_name,
  pilot_time
) values (
  'schema-integrity-smoke-test',
  'KRPUS',
  'SCHEMA TEST VESSEL',
  '04:30'
);

select pilot_time, pilot_time_raw, pilot_time_at
from pilot_schedule_events
where run_id = 'schema-integrity-smoke-test';

delete from pilot_schedule_events
where run_id = 'schema-integrity-smoke-test';
```

Expected smoke test result:
- `pilot_time = '04:30'`
- `pilot_time_raw = '04:30'`
- `pilot_time_at is null`
