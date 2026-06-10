# IMO/MMSI Recovery Audit

## Scope

This audit maps the existing IMO/MMSI recovery flow and documents the repair that adds an actual resolution stage. No UI changes and no new external API system are introduced.

## Existing Assets Found

| Asset | Path | Current role | Reuse status |
| --- | --- | --- | --- |
| Daily enrichment job | `scripts/daily-enrichment.js` | Loads latest `vessel_snapshots`, enriches from `vessel_master`, writes `enrichment_match_candidates`, `imo_recovery_queue`, and `vessel_identity_candidates` | Reused and connected to resolver |
| Vessel master cache | `scripts/lib/db.js` `enrichWithVesselMasterCache` | Looks up `vessel_master` and `vessel_aliases` by IMO, MMSI, call sign, normalized name, alias | Reused as primary reference source |
| Matching helper | `scripts/lib/matching.js` | Provides normalized vessel/call-sign matching and `scoreMatch` | Reused for high-confidence fallback matching |
| Reference CSV dictionaries | `scripts/lib/reference-dictionaries.js`, `data/reference/vessel_master_seed.csv` | Loads local reference seed rows and applies known identity/company fields | Reused as local reference source |
| Source CSV collector | `scripts/collectors/korea.js` source `source_csv` | Optional configured CSV source that can contribute IMO/MMSI/operator fields | Reused when configured and collected |
| Vessel spec / MOF AIS info collectors | `scripts/collectors/korea.js` sources `vessel_spec`, `mof_ais_info`, `mof_ais_dynamic` | Existing source paths for identity/spec data when configured | Reused when records are already collected |

## Previous Flow

1. Raw rows were collected by existing collectors.
2. Rows were normalized by `scripts/collectors/korea.js`.
3. Reference dictionaries and `enrichWithVesselMasterCache` could fill values if a direct cache match existed.
4. `daily-enrichment.js` and `saveToSupabase` wrote missing-IMO rows to `imo_recovery_queue` with `status = pending`.
5. No stage resolved pending rows against reference indexes and applied recovered IMO/MMSI back into the in-memory dataset.
6. `snapshotPatch` only updated snapshots when `enrichWithVesselMasterCache` had already added IMO/MMSI.
7. Generated JSON used `vessel_display`, but the display object had no recovered IMO/MMSI to show.

## Why Recovered Values Did Not Reach Snapshots / JSON

- `buildImoRecoveryRow` created work items only. It did not search reference data.
- `imo_recovery_queue` represented queued work, not completed recovery.
- `vessel_master_seed.csv` currently contains only headers in this repo snapshot, so local seed recovery cannot produce IDs by itself.
- When `vessel_master` rows matched by call sign or name but lacked verified IMO/MMSI, the pipeline could report a cache match without actual identity recovery.
- JSON generation happened after enrichment, but there was no resolver between cache enrichment and scoring/snapshot generation.

## New Resolution Stage

The pipeline now runs:

```text
collect raw rows
normalize vessels
load reference dictionaries / vessel_master cache
resolve IMO/MMSI candidates
apply high-confidence recovered identity fields
operator/company enrichment
scoring/classification
snapshot/json generation
```

Implemented resolver:

- `scripts/lib/db.js` `resolveImoMmsiCandidates(records, referenceIndexes)`
- Integrated in:
  - `scripts/update.js`
  - `scripts/daily-enrichment.js`

## Reference Sources

The resolver builds reference indexes from:

1. Current collected/normalized records that already contain IMO/MMSI.
2. Supabase `vessel_master` by IMO, MMSI, call sign, normalized name.
3. Supabase `vessel_aliases` to `vessel_master`.
4. Local `data/reference/vessel_master_seed.csv`.
5. Existing collected `source_csv`, `vessel_spec`, `mof_ais_info`, `mof_ais_dynamic` rows when those sources are configured and include IMO/MMSI.

No new external API calls are added.

## Match Rules

Automatic apply requires high confidence:

1. Existing non-empty IMO/MMSI in current record.
2. Exact call-sign match to a reference row containing IMO/MMSI.
3. Exact MMSI match to a reference row containing IMO.
4. Exact normalized vessel name plus GT within 5%.
5. Exact normalized vessel name plus vessel type plus same port.
6. High-confidence `scoreMatch` result where the reference row has IMO/MMSI.

Rules:

- Name-only matches do not set IMO automatically.
- Existing non-empty IMO/MMSI is never overwritten by null.
- Existing high-confidence values are not overwritten by weaker references.
- Conflicts stay on the existing value and are marked for review.
- Medium/low confidence rows become `needs_review`.

## Outputs And Metrics

Audits now report:

- `candidate_count`: `identity_resolution.candidates_created`
- `queued_count`: `imoRecoveryQueueRowsSaved`
- `resolved_count`: `identity_resolution.candidates_resolved`
- `applied_to_snapshots_count`: `identity_resolution.applied_high_confidence`
- `applied_to_vessel_master_count`: high-confidence applied records later persisted by `saveToSupabase`
- `written_to_json_count`: rows with final IMO/MMSI in generated vessel/candidate JSON

The same details are surfaced through:

- `data/pipeline-report.json` `identity_resolution`
- `dashboard/api/daily-enrichment-runtime.json` `identity_resolution`
- `npm run audit:enrichment`
- `npm run audit:data-quality`

## Expected Zero-Coverage Explanation

If final IMO/MMSI coverage remains zero, the audit should now say why. Common reasons:

- `vessel_master` reference rows match but do not contain verified IMO/MMSI.
- `source_csv` is not configured or lacks IMO/MMSI columns.
- `vessel_spec` is unavailable.
- `mof_ais_info` / AIS info is unavailable.
- Call-sign coverage is high, but no high-confidence reference identity contains IMO/MMSI.

## Safe Migration Behavior

`imo_recovery_queue` is updated with:

- `status = resolved` for high-confidence applied identities.
- `status = needs_review` for medium/low confidence or conflict cases.
- `recovery_source`
- `recovery_confidence`
- `recovered_imo`
- `recovered_mmsi`
- `resolved_at`

If older Supabase schemas do not have optional columns such as `recovered_imo`, the write retries without those columns and preserves the recovery details in `payload`.
