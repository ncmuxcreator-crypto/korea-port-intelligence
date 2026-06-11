# Pilotage Field Audit

## Scope

This audit maps existing pilotage-related data paths and the reuse strategy for showing pilotage signals in vessel lists and sales intelligence views.

No new external pilotage API or data source is introduced. The implementation reuses existing Port-MIS / pilot schedule fields already collected or persisted by the platform.

## Existing Assets Found

| Asset | Path | Current status | Reuse strategy |
| --- | --- | --- | --- |
| Pilot schedule persistence | `scripts/lib/db.js` | Active. Builds `pilot_schedule_events` from records with `pilot_schedule_matched`, `pilot_only_arrival_review`, `source_origin === "pilot_schedule"`, or `pilot_time`. | Keep as source of truth for persisted pilot schedule rows. |
| Pilot schedule enrichment bridge | `scripts/update.js` (`enrichRecordsWithPilotageEvents`) | Active. Loads current-batch pilot rows and recent `pilot_schedule_events`, then safely matches them to current vessel records. | Reuse persisted/current pilot events to fill timing, berth, and direct identifier fields before scoring/JSON output. |
| Pilot-aware scoring and arrival logic | `scripts/update.js` | Active. Uses `pilot_time`, `movement_time`, `pilot_direction`, `pilot_schedule_matched`, and `pilot_only_arrival_review` in arrival/work-window logic. | Reuse these fields to derive display-only `pilotage_signal` and `arrival_window`. |
| Canonical vessel display mapper | `scripts/update.js` (`buildVesselDisplay`) | Active. Used by generated vessel/candidate/target/action JSON. | Add pilotage timing, berth source, and display signal here so all major JSON outputs share one contract. |
| Existing UI pilot suppression note | `dashboard/index.html` | Hidden/partial. Shows suppression only, not positive pilotage availability. | Add positive badge and filter without redesigning the dashboard. |
| Audit surface | `package.json` audit scripts | Active. Many read-only audits already exist. | Use `audit:pilotage` as a read-only consistency check. |

## Field Inventory

| Field | Purpose | Currently collected/written? | Included in JSON? | UI visible? |
| --- | --- | --- | --- | --- |
| `pilot_schedule_matched` | Strong matched pilot schedule flag | Yes, used in `scripts/update.js` and `scripts/lib/db.js` | Yes, as raw field and through `pilotage_signal` | Yes, through badge/filter if reliable |
| `pilot_only_arrival_review` | Pilot-only arrival candidate needing review | Yes | Yes, as raw field and through `pilotage_signal` | Yes, through badge/filter if reliable |
| `pilot_time` | Pilot schedule time | Yes when source provides it | Yes | Yes, in pilotage line/detail |
| `movement_time` | Movement time associated with pilot context | Yes | Yes | Yes if paired with pilot source/direction |
| `pilot_direction` | Inbound/outbound direction | Yes | Yes | Yes |
| `movement_type` | Movement direction/type fallback | Yes | Yes | Yes when pilot-related |
| `pilot_station` | Pilot boarding/station text | Yes if source provides it | Yes | Yes |
| `pilot_source_url` | Source URL for public pilot-related endpoint | Yes | Yes | No by itself; source URL alone is not a vessel-level pilotage signal |
| `arrival_window` | Pilot-derived arrival/departure timing object | Yes after enrichment | Included through `vessel_display` | Visible in detail surfaces if present |
| `berth_source` / `arrival_window_source` | Source labels for enriched berth/timing fields | Yes after enrichment | Included through `vessel_display` | Detail/diagnostic context |

## Current Snapshot Finding

The latest generated snapshot can contain pilot source URL metadata without actual vessel-level pilot schedule fields. `pilot_source_url` alone is source provenance and must not mark every vessel as having pilotage information.

## Vessel Display Contract

Every canonical `vessel_display` includes:

```json
"pilotage_signal": {
  "has_pilotage": false,
  "pilotage_status": "UNKNOWN",
  "pilotage_time": null,
  "pilotage_direction": null,
  "pilot_station": null,
  "berth_name": null,
  "pilotage_port": "부산",
  "pilotage_source": null,
  "pilotage_confidence": null,
  "arrival_window": null,
  "reason": ""
}
```

Additional display fields populated by the pilotage bridge when available:

- `vessel_display.arrival_window`
- `vessel_display.arrival_window_source`
- `vessel_display.berth_source`
- `vessel_display.pilotage_signal.berth_name`
- `vessel_display.pilotage_signal.arrival_window`

IMO/MMSI from pilotage data is applied only when the pilot row has the identifier directly and the match is high-confidence by vessel id or exact call sign + port. Name-only pilotage matches never assign IMO/MMSI automatically.

## Signal Rules

Positive signal:

- `pilot_schedule_matched`
- `pilot_only_arrival_review`
- `outbound_pilot_scheduled`
- `source_origin === "pilot_schedule"`
- explicit `pilot_time` / `pilotage_time` / `pilot_event_time`
- `movement_time` only when paired with pilot source/direction context
- `pilot_station` or pilot status/order fields
- known inbound/outbound pilot direction when paired with a pilot source

Not a positive signal by itself:

- `pilot_source_url`
- generic source URL
- weak free-text reason such as "출항도선 신호가 강하지 않습니다"

Safe enrichment match patterns:

- exact vessel/master id match
- exact call sign + same port
- exact normalized vessel name + same port + matching time window or berth

Weak vessel-name-only matches are retained for audit review and are not applied.

## Outputs Covered

Because the field is added in `buildVesselDisplay`, it is propagated to:

- `dashboard/api/bootstrap.json` top candidates
- `dashboard/api/candidates/top.json`
- `dashboard/api/targets/current.json`
- `dashboard/api/sales/actions.json`
- `dashboard/api/sales/conversion-pipeline.json`
- `dashboard/api/sales/quote-opportunities.json`
- `dashboard/api/watchlist/current.json`
- `dashboard/api/staying-vessels.json`
- `dashboard/api/anchorage-waiting.json`
- `dashboard/api/arrival-pipeline.json`
- `dashboard/api/vessels/page-*.json`

## Audit Command

`npm run audit:pilotage` reports:

- total vessels
- vessels with reliable pilotage signal
- pilotage reference events available
- records enriched from pilotage
- berth fields filled from pilotage
- arrival timing fields filled from pilotage
- direct IMO/MMSI fields filled from pilotage
- source URL-only rows intentionally not counted
- pilot schedule events saved
- bootstrap KPI consistency
- endpoint-level pilotage coverage
- UI badge/filter presence

## Status

Status: ACTIVE. The bridge is connected; nonzero output depends on reliable pilot schedule rows from current collection or persisted `pilot_schedule_events`.
