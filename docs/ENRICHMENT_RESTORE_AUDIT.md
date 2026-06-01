# Enrichment Restore Audit

Generated during architecture stabilization. Scope: restore existing vessel enrichment and replenishment paths only. No new external API, scoring rule, or UI redesign is introduced here.

## Pipeline Order

Current production update order in `scripts/update.js`:

1. Collect raw rows with `collectKoreaData`.
2. Normalize and dictionary-enrich rows with `enrichWithReferenceDictionaries`.
3. Reuse cached vessel identity fields with `enrichWithVesselMasterCache`.
4. Run repeat-caller, sales-signal, fleet, and predictive scoring on enriched records.
5. Save enriched/scored rows to Supabase through `saveToSupabase`.
6. Generate latest static dashboard JSON outputs.
7. Frontend and Worker render `vessel_display`.

This satisfies the required order: enrichment runs before scoring.

## Existing Enrichment Inventory

| Module / Function | Purpose | Currently Called | Input Fields | Output Fields | Writes DB | Included In JSON | Visible In UI | Status |
|---|---|---:|---|---|---:|---:|---:|---|
| `scripts/lib/reference-dictionaries.js` `loadReferenceDictionaries` | Loads local reference CSV dictionaries for ports, berths, anchorages, operators, agents, vessel type aliases, and vessel seed rows. | Yes, during `npm run update`. | `data/reference/*.csv` | Dictionary indexes | No | Indirect | Indirect | ACTIVE |
| `scripts/lib/reference-dictionaries.js` `enrichWithReferenceDictionaries` | Merges local reference fields without overwriting known values. | Yes, before cache enrichment. | `port_code`, `port_name`, `berth`, `vessel_type`, `operator`, `agent`, `vessel_name`, `imo`, `mmsi`, `call_sign` | `port_name`, `berth_name`, `anchorage_name`, `vessel_type_group`, `operator_name`, `owner_name`, `manager_name`, `imo`, `mmsi`, `call_sign`, `vessel_master_seed_match` | No | Yes, after update output generation | Yes through `vessel_display` | ACTIVE |
| `scripts/lib/db.js` `enrichWithVesselMasterCache` | Reuses persistent `vessel_master` and `vessel_aliases` data to replenish missing identity and static vessel fields. | Yes, before scoring. | `imo`, `mmsi`, `call_sign`, `normalized_vessel_name`, `gt`, `vessel_type_group` | `imo`, `mmsi`, `call_sign`, `vessel_type`, `vessel_type_group`, `gt`, `dwt`, `operator`, `flag`, `owner_name`, `manager_name`, cache diagnostics | No | Yes, after scoring/output generation | Yes through `vessel_display` | ACTIVE |
| `scripts/lib/db.js` `buildImoRecoveryRows` / `buildImoRecoveryDiagnostics` | Creates candidate rows and KPI diagnostics for IMO recovery priority. | Yes, inside `saveToSupabase`. | Missing IMO rows, call sign, GT, vessel type, commercial score | Recovery queue rows, recovery counts | Yes, `imo_recovery_queue` | Yes, quality JSON | Review endpoints only | ACTIVE |
| `scripts/daily-enrichment.js` | Scheduled critical enrichment maintenance using active `vessel_snapshots`, match memory, cache reuse, and recovery queues. | Yes, available as `npm run daily:enrich` and GitHub workflow marker. | Latest active run snapshots, historical `enrichment_match_candidates`, `vessel_master` cache | Snapshot patches for missing identity/contact fields, match memory, recovery queue, identity candidates, aliases | Yes | Runtime report JSON | Indirect | ACTIVE |
| `scripts/lib/matching.js` | Scores identity/match confidence for repeated port/vessel records. | Yes, in daily enrichment. | Vessel name, call sign, port, berth, terminal, type, GT, timestamps, agent/operator | Match score, confidence band, matched fields, match reasons | No | Via daily enrichment runtime/report | Indirect | ACTIVE |
| `scripts/pipeline/enrichment.js` | Pipeline stage metadata for architecture and ops reporting. | Yes, via `scripts/pipeline/index.js`. | None | Stage ownership metadata | No | Yes, status/backend ops | No | ACTIVE |
| `scripts/collectors/korea.js` `mof_ais_info` source classification | Existing collector source marked as identity data when configured. | Yes, source registry recognizes it. | `MOF_AIS_INFO_*` env source rows | Identity-oriented collector rows | Via update pipeline | Yes when source configured | Indirect | HIDDEN |
| `scripts/lib/config.js` `MAX_IMO_RECOVERY_CALLS` | Runtime safeguard for IMO recovery volume. | Yes, config audit and workflows expose it. | Environment variable | Numeric limit | No | Status/config diagnostics | No | ACTIVE |

## Reconnected Links

- `vessel_display` now consistently includes required identity, company, score, reason, action, and source fields.
- Missing display values are rendered as `"-"` instead of `null` or empty string. Numeric `0` remains `0`.
- Worker direct vessel pages now merge `vessel_snapshots.payload` into compact rows before building `vessel_display`, so cached/enriched fields are not discarded by the direct Supabase page API.
- Static paginated vessel files are generated as latest-only JSON under `dashboard/api/vessels/index.json` and `dashboard/api/vessels/page-*.json`.
- `enrichWithVesselMasterCache` now reads `vessel_master.payload` so cached owner/manager fields can be reused.
- `daily-enrichment.js` now preserves/replenishes `call_sign`, `owner_name`, and `manager_name` when they become available.

## Safeguards

- No enrichment runs in the frontend.
- No new external enrichment API was added.
- Existing `MAX_IMO_RECOVERY_CALLS` remains the controlling limit for IMO recovery.
- Existing values are preserved when enrichment sources return null/empty values.
- Static JSON files are latest snapshot outputs only. Historical run history remains a Supabase responsibility.

## Gaps To Monitor

- `vessel_snapshots` stores some rich identity fields in `payload`; direct SQL column coverage may vary by deployed schema.
- `owner_name`, `manager_name`, `dwt`, and `flag` coverage depends on configured sources or seeded/cache data.
- `mof_ais_info` and `vessel_spec` are source hooks, not newly implemented collectors in this change.

## Audit Command

Run:

```bash
npm run audit:enrichment
```

The audit prints:

- Total vessels in latest successful run or static fallback.
- IMO, call sign, operator, owner, manager, vessel type, GT, DWT, and flag coverage.
- Enrichment candidates, attempts, successes, failures, and skipped counts.
- Top 20 sample enriched vessels.
