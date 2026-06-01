# Feature Inventory Audit

Generated: 2026-06-01

This audit maps historical intelligence features that still exist in the backend and shows whether they are connected to compact JSON outputs and the dashboard UI. It does not remove or refactor existing features.

## Scope

Search terms:

- `prediction`
- `forecast`
- `feature_store`
- `feature_snapshots`
- `explainability`
- `risk_history`
- `commercial`
- `opportunity`
- `route_snapshot`
- `operator_snapshot`
- `model_training`
- `rule_evaluations`

## Method

- DB table existence: `supabase/schema.sql` and `migrations/*.sql`.
- Backend writer existence: `scripts/lib/db.js`, `scripts/update.js`, and `src/worker.js`.
- Generated JSON existence: `dashboard/api/**` plus `dashboard/api/debug/**` for protected local diagnostic runs.
- Frontend component existence: `dashboard/index.html` and `public/index.html`.
- Current visibility: dashboard section titled `숨겨진 인사이트 / 고급 분석`.

## Status Legend

- `ACTIVE`: DB/backend/JSON/UI are connected and the JSON has rows.
- `HIDDEN`: data exists or is generated, but no UI surface consumes it.
- `BROKEN`: UI or JSON surface exists but the required backend link is missing or invalid.
- `EMPTY`: surface is connected, but current local output has no rows.
- `UNUSED`: DB/backend writer exists, but no compact JSON or UI surface exists.
- `REMOVED`: feature was not found in DB, backend, JSON, or UI.

## Matrix

| Feature | DB table exists? | Backend writer exists? | Generated JSON exists? | Frontend component exists? | Currently visible? | Currently broken? | Missing link | Status |
|---|---|---|---|---|---|---|---|---|
| risk / `risk_history` | Yes: `risk_history` | Yes: `scripts/lib/db.js` inserts risk rows | Yes: `biofouling-timeline.json`, `intelligence/risk-summary.json` | Yes: `리스크 분석` card | Yes, when rows exist | No structural break found | Production row count needed to prove active data | EMPTY locally |
| explainability / `explainability_snapshots` / `rule_evaluations` | Yes | Yes: rule/explainability rows are upserted | Yes: `intelligence/explainability.json`; candidates also carry `reason_summary` | Yes: `점수 설명` card | Yes, when rows exist | No structural break found | Dedicated UI was previously missing; now compact card exists | EMPTY locally |
| prediction / forecast / `model_training_rows` | Yes: `predicted_arrivals`, `model_training_rows` | Yes: prediction and model-ready rows are written | Yes: `predicted-arrivals.json`, `predicted-cleaning-opportunities.json`, `quality/prediction-feedback.json`, `intelligence/prediction-summary.json` | Yes: `예측 신호 / 실험 기능` card | Yes, when rows exist | No structural break found | Must remain labelled experimental | EMPTY locally |
| feature store / `feature_store` / `feature_snapshots` | Yes | Yes: model-ready feature rows are upserted | No compact user-facing JSON | No direct UI | No | No | Intentionally storage/model foundation only | UNUSED |
| commercial opportunity / `opportunity_master` / `commercial_opportunity_daily` | Yes | Yes: opportunity rows and daily snapshots are written | Yes: `candidates/top.json`, `commercial-command-center.json`, `intelligence/commercial-summary.json` | Yes: `상업 기회` card and existing candidate UI | Yes, when candidates exist | Local output is empty without secrets | Production latest-successful dataset should feed it | EMPTY locally |
| sales candidates / `sales_candidates_current` | Yes | Yes: current candidates are materialized | Yes: `candidates.json`, `candidates/top.json` | Yes: KPI, TOP 10, candidate table | Yes | Locally empty in no-secret mode | Needs production data or restored successful dataset | EMPTY locally |
| immediate targets / `immediate_targets_current` | Yes | Yes: current HOT targets are materialized | Yes: `hot-candidates.json`, `candidates/top.json` | Yes: HOT KPI and TOP 10 | Yes | Locally empty in no-secret mode | Needs production data or restored successful dataset | EMPTY locally |
| route snapshot / `route_snapshot_daily` | Yes | Yes: historical warehouse writer | Yes: `intelligence/route-summary.json` | Yes: `항로 인사이트` card | Yes, when route fields exist | No structural break found | Previously only Worker history API existed | EMPTY locally |
| operator snapshot / `operator_snapshot_daily` | Yes | Yes: historical warehouse writer | Yes: `fleet-opportunities.json`, `intelligence/operator-summary.json` | Yes: `선사/운영사 인사이트` card | Yes, when rows exist | No structural break found | Previously hidden from main UI | EMPTY locally |

## Resurfaced JSON Endpoints

The update job now writes compact summary endpoints under:

- `dashboard/api/intelligence/risk-summary.json`
- `dashboard/api/intelligence/explainability.json`
- `dashboard/api/intelligence/prediction-summary.json`
- `dashboard/api/intelligence/operator-summary.json`
- `dashboard/api/intelligence/route-summary.json`
- `dashboard/api/intelligence/commercial-summary.json`

Each endpoint uses:

- `generated_at`
- `schema_version`
- `data_mode`
- `record_count`
- `source_table`
- `items`

Items are capped to 10 records so the dashboard does not expose raw analytical tables.

## Currently Hidden Or Unused

- `feature_store` and `feature_snapshots` remain unused in UI by design. They are model foundation tables, not user-facing insight outputs.
- `model_training_rows` is surfaced only as part of the experimental prediction summary, not as raw training rows.
- Historical `operator_snapshot_daily`, `route_snapshot_daily`, and `commercial_opportunity_daily` remain persisted in DB, with compact summaries now surfaced through static JSON.

## Local Data Caveat

The current local shell does not have production secrets, so local update runs can produce `no_live_data` and empty intelligence summaries. That does not mean the production collectors are disconnected. It means the local generated files are diagnostic outputs until the environment has the required API and Supabase credentials.
