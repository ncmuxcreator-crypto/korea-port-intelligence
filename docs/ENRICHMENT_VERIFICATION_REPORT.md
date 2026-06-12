# Enrichment Verification Report

Generated at: 2026-06-12T13:30:41.890Z

Reference run: run_20260612065952169_5b648f9d

Summary score: 0

Status: CRITICAL

## Critical Issues

- pilotage_signal: Pilotage matches/signals exist, but no vessel_display output contains pilotage_signal. (lost_stage: enrichment patch)
- berth_signal: Berth/PNC matches/signals exist, but no vessel_display output contains berth_signal. (lost_stage: vessel_display builder / output writer)

## Warnings

- freshness: dashboard/api/enrichment/summary.json is stale or missing context: generated_at differs from bootstrap
- freshness: dashboard/api/enrichment/applied.json is stale or missing context: generated_at differs from bootstrap
- freshness: dashboard/api/enrichment/review-queue.json is stale or missing context: generated_at differs from bootstrap
- freshness: dashboard/api/sales/actions.json is stale or missing context: generated_at differs from bootstrap
- freshness: dashboard/api/targets/current.json is stale or missing context: generated_at differs from bootstrap
- freshness: dashboard/api/watchlist/current.json is stale or missing context: generated_at differs from bootstrap
- freshness: dashboard/api/vessels/page-1.json is stale or missing context: generated_at differs from bootstrap
- freshness: dashboard/api/vessels/page-2.json is stale or missing context: generated_at differs from bootstrap
- freshness: dashboard/api/vessels/page-3.json is stale or missing context: generated_at differs from bootstrap
- freshness: dashboard/api/vessels/page-4.json is stale or missing context: generated_at differs from bootstrap
- freshness: dashboard/api/vessels/page-5.json is stale or missing context: generated_at differs from bootstrap
- freshness: dashboard/api/vessels/page-6.json is stale or missing context: generated_at differs from bootstrap
- freshness: dashboard/api/vessels/page-7.json is stale or missing context: generated_at differs from bootstrap
- freshness: dashboard/api/vessels/page-8.json is stale or missing context: generated_at differs from bootstrap
- freshness: dashboard/api/vessels/page-9.json is stale or missing context: generated_at differs from bootstrap
- freshness: dashboard/api/vessels/page-10.json is stale or missing context: generated_at differs from bootstrap
- freshness: dashboard/api/vessels/page-11.json is stale or missing context: generated_at differs from bootstrap
- freshness: dashboard/api/vessels/page-12.json is stale or missing context: generated_at differs from bootstrap
- freshness: dashboard/api/vessels/page-13.json is stale or missing context: generated_at differs from bootstrap
- freshness: dashboard/api/vessels/page-14.json is stale or missing context: generated_at differs from bootstrap
- freshness: dashboard/api/vessels/page-15.json is stale or missing context: generated_at differs from bootstrap
- freshness: dashboard/api/vessels/page-16.json is stale or missing context: generated_at differs from bootstrap
- freshness: dashboard/api/vessels/page-17.json is stale or missing context: generated_at differs from bootstrap
- freshness: dashboard/api/vessels/page-18.json is stale or missing context: generated_at differs from bootstrap
- freshness: dashboard/api/vessels/page-19.json is stale or missing context: generated_at differs from bootstrap
- freshness: dashboard/api/vessels/page-20.json is stale or missing context: generated_at differs from bootstrap
- freshness: dashboard/api/vessels/page-21.json is stale or missing context: generated_at differs from bootstrap
- freshness: dashboard/api/vessels/page-22.json is stale or missing context: generated_at differs from bootstrap
- freshness: dashboard/api/vessels/page-23.json is stale or missing context: generated_at differs from bootstrap
- vessel_spec: HTTP 200 with rows_normalized=0 but sanitized raw sample keys are missing.
- mof_ais_info: Smoke-level AIS source lacks target-based expansion recommendation.
- mof_ais_dynamic: Smoke-level AIS source lacks target-based expansion recommendation.

## Verified Working Enrichments

- source_csv oversized response is isolated from the core update.

## Blocked Enrichments

- source_csv: Configured source is too large (72478261 bytes); use a smaller verified vessel reference CSV.
- vessel_spec: HTTP 200 returned rows, but no rows matched vessel specification aliases. Check raw_sample_keys and parser_blockers after the next collector run.

## Freshness

| file | generated_at | run_id | stale | reason |
| --- | --- | --- | --- | --- |
| dashboard/api/enrichment-utilization.json | 2026-06-12T07:06:16.970Z | run_20260612065952169_5b648f9d | no | - |
| dashboard/api/enrichment/summary.json | 2026-06-11T09:44:10.845Z | - | yes | generated_at differs from bootstrap |
| dashboard/api/enrichment/applied.json | 2026-06-11T09:44:10.845Z | - | yes | generated_at differs from bootstrap |
| dashboard/api/enrichment/review-queue.json | 2026-06-11T09:44:10.845Z | - | yes | generated_at differs from bootstrap |
| dashboard/api/source-quality-score.json | 2026-06-12T07:06:16.970Z | run_20260612065952169_5b648f9d | no | - |
| dashboard/api/bootstrap.json | 2026-06-12T07:06:16.970Z | run_20260612065952169_5b648f9d | no | - |
| dashboard/api/sales/actions.json | 2026-06-11T09:44:10.845Z | - | yes | generated_at differs from bootstrap |
| dashboard/api/targets/current.json | 2026-06-11T09:44:10.845Z | - | yes | generated_at differs from bootstrap |
| dashboard/api/watchlist/current.json | 2026-06-11T09:44:10.845Z | - | yes | generated_at differs from bootstrap |
| dashboard/api/aux/pilotage-summary.json | 2026-06-12T07:06:16.970Z | run_20260612065952169_5b648f9d | no | - |
| dashboard/api/aux/berth-summary.json | 2026-06-12T07:06:16.970Z | run_20260612065952169_5b648f9d | no | - |
| dashboard/api/aux/source-csv-summary.json | 2026-06-12T07:06:16.970Z | run_20260612065952169_5b648f9d | no | - |
| dashboard/api/aux/vessel-spec-summary.json | 2026-06-12T07:06:16.970Z | run_20260612065952169_5b648f9d | no | - |
| dashboard/api/vessels/page-1.json | 2026-06-11T09:44:10.845Z | - | yes | generated_at differs from bootstrap |
| dashboard/api/vessels/page-2.json | 2026-06-11T09:44:10.845Z | - | yes | generated_at differs from bootstrap |
| dashboard/api/vessels/page-3.json | 2026-06-11T09:44:10.845Z | - | yes | generated_at differs from bootstrap |
| dashboard/api/vessels/page-4.json | 2026-06-11T09:44:10.845Z | - | yes | generated_at differs from bootstrap |
| dashboard/api/vessels/page-5.json | 2026-06-11T09:44:10.845Z | - | yes | generated_at differs from bootstrap |
| dashboard/api/vessels/page-6.json | 2026-06-11T09:44:10.845Z | - | yes | generated_at differs from bootstrap |
| dashboard/api/vessels/page-7.json | 2026-06-11T09:44:10.845Z | - | yes | generated_at differs from bootstrap |
| dashboard/api/vessels/page-8.json | 2026-06-11T09:44:10.845Z | - | yes | generated_at differs from bootstrap |
| dashboard/api/vessels/page-9.json | 2026-06-11T09:44:10.845Z | - | yes | generated_at differs from bootstrap |
| dashboard/api/vessels/page-10.json | 2026-06-11T09:44:10.845Z | - | yes | generated_at differs from bootstrap |
| dashboard/api/vessels/page-11.json | 2026-06-11T09:44:10.845Z | - | yes | generated_at differs from bootstrap |
| dashboard/api/vessels/page-12.json | 2026-06-11T09:44:10.845Z | - | yes | generated_at differs from bootstrap |
| dashboard/api/vessels/page-13.json | 2026-06-11T09:44:10.845Z | - | yes | generated_at differs from bootstrap |
| dashboard/api/vessels/page-14.json | 2026-06-11T09:44:10.845Z | - | yes | generated_at differs from bootstrap |
| dashboard/api/vessels/page-15.json | 2026-06-11T09:44:10.845Z | - | yes | generated_at differs from bootstrap |
| dashboard/api/vessels/page-16.json | 2026-06-11T09:44:10.845Z | - | yes | generated_at differs from bootstrap |
| dashboard/api/vessels/page-17.json | 2026-06-11T09:44:10.845Z | - | yes | generated_at differs from bootstrap |
| dashboard/api/vessels/page-18.json | 2026-06-11T09:44:10.845Z | - | yes | generated_at differs from bootstrap |
| dashboard/api/vessels/page-19.json | 2026-06-11T09:44:10.845Z | - | yes | generated_at differs from bootstrap |
| dashboard/api/vessels/page-20.json | 2026-06-11T09:44:10.845Z | - | yes | generated_at differs from bootstrap |
| dashboard/api/vessels/page-21.json | 2026-06-11T09:44:10.845Z | - | yes | generated_at differs from bootstrap |
| dashboard/api/vessels/page-22.json | 2026-06-11T09:44:10.845Z | - | yes | generated_at differs from bootstrap |
| dashboard/api/vessels/page-23.json | 2026-06-11T09:44:10.845Z | - | yes | generated_at differs from bootstrap |

## Pilotage Propagation

- Rows collected: 385
- Rows normalized: 72
- Rows matched to vessels: 0
- Signal count: 8
- Display count: 0
- Loss stage: enrichment patch

## Berth / PNC Propagation

- Rows collected: 30
- Rows normalized: 30
- Rows matched to vessels: 0
- Signal count: 19
- Display count: 0
- Loss stage: vessel_display builder / output writer

## Source CSV

- Status: SOURCE_TOO_LARGE
- Source too large: true
- Response size bytes: 72478261
- Previous cache available: false
- Using previous cache: false
- Usable reference rows: 0
- Recommended fix: Create a smaller verified vessel reference CSV for enrichment.

## Vessel Spec

- Status: ACTIVE
- HTTP status: 200
- Rows collected: 1
- Rows normalized: 0
- Parser blocker: HTTP 200 returned rows, but no rows matched vessel specification aliases. Check raw_sample_keys and parser_blockers after the next collector run.
- Sanitized sample keys: -

## MOF AIS

- Info coverage label: SMOKE_LEVEL
- Dynamic coverage label: SMOKE_LEVEL
- Recommendation: Enrich sales targets first, then detail eligible top 100; do not enrich all detected vessels in one run.

## Next Fixes

- Connect pilotage enrichment patches to buildVesselDisplay output writer for vessels, sales actions, targets, watchlist, and bootstrap.
- Connect berth/PNC enrichment patches to buildVesselDisplay and compact output mappers.
