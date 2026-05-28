# Cloudflare Worker Data Flow

This project should not rely on GitHub Actions committing generated JSON files back to `main`.

## Runtime Model

```text
GitHub main
  -> source code and dashboard shell only

GitHub Actions longterm update
  -> collect public port data
  -> score vessels
  -> save full snapshot payloads to Supabase
  -> upload generated JSON as an Actions artifact for diagnostics
  -> do not commit generated files to main

Cloudflare Worker
  -> serves static dashboard assets from ./dashboard
  -> serves /api/*.json dynamically from Supabase vessel_snapshots
```

## Required Cloudflare Worker Secrets

Set these in Cloudflare Workers settings:

```text
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
```

`SUPABASE_ANON_KEY` can be used only if Supabase RLS policies allow read access to `vessel_snapshots`.
For the private operational dashboard, prefer server-side Worker secrets rather than exposing database keys in frontend code.

## Required Supabase Schema Step

Apply `supabase/schema.sql` in Supabase SQL Editor.

The important column for the Worker is:

```sql
alter table vessel_snapshots add column if not exists payload jsonb default '{}'::jsonb;
```

The update pipeline stores the full enriched vessel record in `payload`, so the Worker can rebuild:

- `vessels.json`
- `hot-vessels.json`
- `commercial-command-center.json`
- `port-congestion-heatmap.json`
- `biofouling-timeline.json`
- `status.json`

## Collector Readiness Metrics

Use both metrics:

```text
real_rows
actionable_rows
```

`real_rows` means the collector normalized an external row into a vessel-like record.

`actionable_rows` means the row has enough identity, port-call, berth, or schedule context to support sales review.
Movement-only AIS/VTS rows such as MMSI + SOG + coordinates must not be counted as sales-ready data.

Expected diagnostics examples:

```text
mof_ais_dynamic: success; rows=200; normalized=200; actionable=0; profile=movement_only
port_operation: success; rows=120; normalized=90; actionable=80; profile=schedule_or_berth
```

## Cloudflare Build Settings

Use:

```text
Build command: npm run build
Assets directory: dashboard
```

The Worker configuration is in `wrangler.jsonc`.

Do not set the assets directory to the repository root. If the root is uploaded, Cloudflare may try to upload `node_modules`, including `workerd`, which exceeds the 25 MiB individual asset limit.

Do not upload generated `dashboard/api/*.json` files as Cloudflare static assets. Those files can exceed the Workers 25 MiB per-asset limit, and `/api/*` must be served dynamically by `src/worker.js` from Supabase. The GitHub Actions deploy step temporarily removes `dashboard/api` during `wrangler deploy`, then restores it for diagnostics artifacts.

## API Routes Served By Worker

```text
/api/status.json
/api/vessels.json
/api/hot-vessels.json
/api/commercial-command-center.json
/api/port-congestion-heatmap.json
/api/biofouling-timeline.json
```

Other static dashboard files are served from `./dashboard`.

## IMO Availability Clarification

Most operational sources do not reliably provide IMO directly.

- Port Operation usually provides vessel name, call sign, GT, vessel type, and port movement, but not IMO.
- Pilot, berth, and PNC sources usually provide timing and berth signals, not IMO.
- AIS/VTS may provide MMSI or IMO, but public coverage is inconsistent.
- Vessel Spec API is the primary IMO recovery source.

Treat IMO recovery as multi-source identity accumulation:

```text
Port Operation row
  -> enrichment matching
  -> vessel_master lookup
  -> selective Vessel Spec API lookup for high-value unresolved rows
  -> successful IMO recovery
  -> update vessel_master and vessel_aliases
  -> future runs auto-recover IMO
```

Do not require IMO for candidate visibility. Commercially important vessels must remain visible when IMO is unresolved; IMO recovery improves identity confidence over time.
