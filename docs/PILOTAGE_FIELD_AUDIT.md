# Pilotage Field Audit

## Scope

This audit maps existing pilotage-related data paths and the reuse strategy for showing pilotage signals in vessel lists and sales intelligence views.

No new external pilotage API or data source is introduced. The implementation reuses existing Port-MIS / pilot schedule fields already collected or persisted by the platform.

## Existing Assets Found

| Asset | Path | Current status | Reuse strategy |
| --- | --- | --- | --- |
| Pilot schedule persistence | `scripts/lib/db.js` | Active. Builds `pilot_schedule_events` from records with `pilot_schedule_matched`, `pilot_only_arrival_review`, `source_origin === "pilot_schedule"`, or `pilot_time`. | Keep as source of truth for persisted pilot schedule rows. |
| Pilot-aware scoring and arrival logic | `scripts/update.js` | Active. Uses `pilot_time`, `movement_time`, `pilot_direction`, `pilot_schedule_matched`, and `pilot_only_arrival_review` in arrival/work-window logic. | Reuse these fields to derive display-only `pilotage_signal`. |
| Canonical vessel display mapper | `scripts/update.js` (`buildVesselDisplay`) | Active. Used by generated vessel/candidate/target/action JSON. | Add `pilotage_signal` here so all major JSON outputs share one contract. |
| Existing UI pilot suppression note | `dashboard/index.html` | Hidden/partial. Shows suppression only, not positive pilotage availability. | Add positive badge and filter without redesigning the dashboard. |
| Audit surface | `package.json` audit scripts | Active. Many read-only audits already exist. | Add `audit:pilotage` as a read-only consistency check. |

## Field Inventory

| Field | Purpose | Currently collected/written? | Included in JSON before patch? | UI visible before patch? |
| --- | --- | --- | --- | --- |
| `pilot_schedule_matched` | Strong matched pilot schedule flag | Yes, used in `scripts/update.js` and `scripts/lib/db.js` | Sometimes as raw field | No positive badge/filter |
| `pilot_only_arrival_review` | Pilot-only arrival candidate needing review | Yes | Sometimes as raw field | No positive badge/filter |
| `pilot_time` | Pilot schedule time | Yes when source provides it | Sometimes as raw field | No positive badge/filter |
| `movement_time` | Movement time associated with pilot context | Yes | Sometimes as raw field | No positive badge/filter |
| `pilot_direction` | Inbound/outbound direction | Yes | Sometimes as raw field | No positive badge/filter |
| `movement_type` | Movement direction/type fallback | Yes | Sometimes as raw field | No positive badge/filter |
| `pilot_station` | Pilot boarding/station text | Yes if source provides it | Sometimes as raw field | No positive badge/filter |
| `pilot_source_url` | Source URL for public pilot-related endpoint | Yes | Sometimes as raw field | No, and should not be treated as a signal by itself |

## Current Snapshot Finding

The current generated `dashboard/api/all-collected-vessels.json` has pilotage source URL metadata, but no reliable pilotage event fields:

- rows checked: 897
- `pilot_schedule_matched`: 0
- `pilot_only_arrival_review`: 0
- `pilot_time`: 0
- `movement_time`: 0
- known `pilot_direction`: 0
- known `movement_type`: 0
- `pilot_station`: 0
- `pilot_source_url`: 897

Conclusion: `pilot_source_url` alone is source provenance, not a vessel-level pilotage schedule. It must not mark every vessel as having pilotage information.

## New Contract

Every canonical `vessel_display` now includes:

```json
"pilotage_signal": {
  "has_pilotage": false,
  "pilotage_status": "UNKNOWN",
  "pilotage_time": null,
  "pilotage_direction": null,
  "pilot_station": null,
  "pilotage_port": "부산",
  "pilotage_source": null,
  "pilotage_confidence": null,
  "reason": ""
}
```

When a reliable pilotage signal exists, `has_pilotage` becomes `true` and the UI can show the badge `도선 정보`.

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
- source URL only rows not counted
- pilot schedule events saved
- bootstrap KPI consistency
- endpoint-level pilotage coverage
- UI badge/filter presence

## Status

Status: ACTIVE, currently 0 reliable pilotage rows in the generated snapshot.

Recommended next step when upstream data starts providing pilot schedule fields: verify `audit:pilotage` shows nonzero `raw_reliable_pilotage_count` and matching `pilotage_detected_count`.
