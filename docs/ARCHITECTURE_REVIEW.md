# HWK Port Intelligence Platform Architecture Review

Generated: 2026-06-02

## 1. Current Architecture

HWK Port Intelligence Platform is a backend-first maritime sales intelligence system. Its core operating question is:

> Which vessel should we contact next, and why?

The current implementation already contains the major platform layers:

- Scheduled Longterm Update through GitHub Actions every 4 hours, which equals 6 runs per day.
- External public maritime source collection in `scripts/update.js`.
- Supabase persistence through `scripts/lib/db.js`.
- Generated dashboard JSON under `dashboard/api/`.
- Cloudflare Worker API layer in `src/worker.js`.
- Single-file dashboard UI in `dashboard/index.html`.
- Validation and audit scripts under `scripts/`.

The system is directionally correct: it is not a vessel tracking UI. It is a sales intelligence and opportunity prioritization pipeline. The current architecture, however, still mixes collection, normalization, enrichment, scoring, persistence, static snapshot generation, dashboard fallback, and UI fetch behavior in a few very large files.

## 2. Data Flow

Current data flow:

```text
External APIs / CSV / fallback inputs
  -> scripts/update.js
  -> normalize vessel and port fields
  -> enrichment and replenishment hooks
  -> score commercial, risk, arrival, anchorage, and sales priority signals
  -> scripts/lib/db.js writes Supabase history/current tables
  -> dashboard/api/*.json static snapshots are generated
  -> src/worker.js serves dynamic API responses and/or static asset JSON
  -> dashboard/index.html renders KPI, ports, candidates, intelligence, and vessel list
```

Recommended target flow:

```text
External APIs
  -> Scheduled Longterm Update, 6 times/day
  -> Normalize + Enrich + Score + Generate Candidates
  -> Supabase long-term storage
  -> Latest successful static JSON snapshot
  -> Frontend fast bootstrap load
  -> Lazy-load full vessel list and advanced intelligence
```

The main violation today is that the frontend still behaves like a mixed dashboard client: it reads lightweight snapshots, but it also fetches many secondary endpoints during startup. Heavy analytics are mostly precomputed, but startup fetch behavior has not fully caught up with the snapshot-first architecture.

## 3. DB Role

Supabase should be the long-term system of record for:

- `data_collection_runs`
- `active_dataset_pointer`
- `vessel_master`
- `vessel_snapshots`
- `port_call_master`
- `opportunity_master`
- `risk_history`
- `explainability_snapshots`
- `feature_store`
- `feature_snapshots`
- `model_training_rows`
- `route_snapshot_daily`
- `operator_snapshot_daily`
- `commercial_opportunity_daily`

The DB already stores both current and historical intelligence. Production logs show successful writes to vessel, opportunity, feature, explainability, route, operator, and daily snapshot tables.

DB risks:

- `scripts/lib/db.js` is very large and owns persistence, candidate materialization, retention, promotion, schema compatibility, diagnostics, and verification.
- Current table writes and current-materialized table writes are not clearly isolated.
- `sales_candidates_current` and `immediate_targets_current` can diverge from generated static JSON candidate counts.
- Known schema concerns still need continuous verification: `vessel_events` upsert uniqueness, `dashboard_summary_snapshots` columns/indexes, missing port summary rollup tables, and `pilot_schedule_events` timestamp parsing.

## 4. Static JSON Snapshot Role

Static JSON should represent only the latest successful dashboard snapshot:

- `dashboard/api/bootstrap.json`
- `dashboard/api/dashboard-summary.json`
- `dashboard/api/candidates/top.json`
- `dashboard/api/arrival-pipeline.json`
- `dashboard/api/staying-vessels.json`
- `dashboard/api/anchorage-waiting.json`
- `dashboard/api/targets/current.json`
- `dashboard/api/vessels/index.json`
- `dashboard/api/vessels/page-*.json`
- `dashboard/api/intelligence/*.json`

Recent improvements added paginated vessel pages and a compact bootstrap payload. Latest observed audit values:

- `bootstrap.json`: about 18.5 KB
- Vessel pages: 45 files
- Page size: 30
- Largest vessel page: about 48.9 KB
- Page item sum: 1,346 vessels, matching `vessels/index.json`

Static snapshot risks:

- Several legacy static files remain very large, including `all-collected-vessels.json`, `target-vessels.json`, `vessels.json`, and `candidates.json`.
- GitHub Actions Longterm Update currently runs with `contents: read`, so scheduled runs can update Supabase but cannot push changed static assets back to GitHub. This is acceptable only if Cloudflare Worker serves from Supabase for live data or a separate deploy process publishes latest assets.
- Static JSON and Supabase latest successful run can become stale relative to each other.

## 5. Frontend Role

Frontend should:

- Render the first screen from `bootstrap.json`.
- Avoid external maritime API calls entirely.
- Avoid heavy scoring/filtering on raw vessel rows.
- Lazy-load the full vessel list only when the user opens it.
- Lazy-load advanced intelligence only when expanded or after first paint.
- Render missing fields as `-` or `확인 불가`, and valid `0` as `0`.

Current frontend state:

- Full vessel list is now lazy-loaded through `vessels/index.json` and `vessels/page-*.json`.
- The UI still calls many endpoints during `loadSummary()`, including health, continuity, alerts, ports, top candidates, changes, followups, and all intelligence endpoints.
- The API response/health panel is still startup-coupled.
- `dashboard/index.html` is a single 53 KB file with UI rendering, API client, fallback, KPI, table/card rendering, intelligence loading, and pagination logic.

## 6. Current Pain Points

1. Oversized backend orchestrator in `scripts/update.js`.
2. Oversized persistence layer in `scripts/lib/db.js`.
3. Worker and update scripts duplicate scoring, candidate, and API envelope logic.
4. Dashboard startup still fetches too many endpoints.
5. Static JSON history policy is conceptually latest-only, but the repository contains many large generated outputs.
6. Candidate counts can differ between generated JSON and current DB materialized tables.
7. Enrichment sources exist but coverage remains partial and the reconnection path is still fragile.
8. DB retention policy is improved but still mixed into persistence code.
9. Worker deploy is sensitive to local path and Wrangler runtime behavior.
10. Validation has grown into a broad architecture assertion script, not only a data contract check.

## Latest Audit Observations

These observations came from the review validation run on 2026-06-02.

| Audit | Key observation | Risk |
|---|---|---|
| `audit:performance` | Startup API count is 12; API health is still fetched during startup; bootstrap is about 18.5 KB; vessel pages are lazy and under 300 KB | First render can still be slower/noisier than the target architecture |
| `audit:db` | DB Health Score is 64/100; schema score is low; JSON sync score is low; `vessel_events` has a small duplicate event risk; latest run consistency mostly passes | DB is usable but schema/index and static sync need priority attention |
| `audit:vessels` | Latest DB run has 1,365 vessel snapshots and 1,365 opportunities; static JSON from the pre-build snapshot was stale during the audit; all vessel_master rows had missing IMO/MMSI in the sampled audit | Data collection is active, but identity enrichment is the next quality bottleneck |
| `audit:enrichment` | Call sign coverage is high and GT/type coverage is high; IMO, DWT, owner, manager, and flag coverage are 0%; enrichment attempts are reported as failed/skipped into recovery queue | Existing enrichment/recovery needs reconnection before scoring quality can improve |
| `audit:targets` | Static JSON target ratio is about 94%, above the 20-30% business expectation; this is no longer "too low" but may now be too broad | Candidate qualification needs business calibration after the safety pass |
| `audit:truth` | Sales priority cards are DB-backed and static freshness matched after the final build; sales target/immediate target counts still differ between dashboard JSON and DB current-table definitions | Truth audit should become a deployment gate and candidate-count contract check |

## 7. Performance Bottlenecks

Observed through `npm run audit:performance`:

- Startup API count: 12.
- Full vessel list lazy-loaded: yes.
- `bootstrap.json`: under 150 KB.
- Vessel pages: under 300 KB each.
- Remaining warning: startup API count above 3.

Likely bottlenecks:

- `dashboard/index.html` calls many secondary endpoints in `loadSummary()`.
- API health and latency measurement are startup-coupled.
- Intelligence endpoints are fetched during startup instead of being section-triggered.
- Large static files remain in `dashboard/api/` and can be accidentally fetched through fallback paths.
- Worker dynamic routes can query Supabase during user page load if static snapshots are unavailable.

## 8. Data Integrity Risks

Key risks to keep auditing:

- Active pointer mismatch: `active_dataset_pointer.active_run_id` differs from latest successful summary run.
- DB vs static JSON mismatch: DB has real promoted data while static JSON is stale, placeholder, or sample.
- Duplicate vessel identities: duplicate IMO, MMSI without IMO, or normalized vessel name/type groups.
- Duplicate run-level snapshots: duplicate `run_id + vessel_id` in `vessel_snapshots`.
- Candidate funnel mismatch: `opportunity_master > 0` but `sales_candidates_current` near zero.
- Port alias duplication: Busan/Pusan/부산 counted separately.
- Missing schema objects: `port_daily_summary`, `port_weekly_summary`, `port_monthly_summary`.
- `vessel_events` upsert requires `event_uid` uniqueness.
- `pilot_schedule_events` needs safe timestamp parsing for time-only values.

## 9. Cleanup Priorities

| Priority | Issue | Why It Matters | First Safe Action |
|---|---|---|---|
| P0 | Dashboard startup fetch count > 3 | Slower first load and more error states | Make first load use `bootstrap.json` only |
| P0 | DB/static mismatch risk | Live DB can be correct while UI shows stale data | Strengthen `audit:truth` and deployment rule |
| P0 | Candidate current tables differ from JSON candidate counts | Sales numbers become confusing | Audit materialized current table criteria separately from JSON |
| P1 | `scripts/update.js` too large | High regression risk | Extract snapshot generation and candidate funnel modules |
| P1 | `scripts/lib/db.js` too large | Persistence changes are risky | Split client, runs, promotion, retention, verification, current materialization |
| P1 | `src/worker.js` duplicates update logic | Different API and static behavior | Move shared normalization/scoring contracts to reusable modules |
| P1 | Large legacy JSON files | Accidental heavy fetch and repository bloat | Keep latest-only lightweight serving outputs; archive heavy diagnostics separately |
| P2 | Enrichment coverage partial | Candidate quality suffers | Reconnect existing enrichment before scoring |
| P2 | Validation overloaded | Harder to debug failures | Split validation into contract, workflow, generated-output, and architecture checks |
| P3 | Frontend single-file structure | Hard to maintain safely | Split API client, KPI resolver, health renderer, vessel list, intelligence cards |

## 10. Recommended Target Architecture

```text
External APIs
  -> scheduled-update/
      collection
      normalization
      enrichment
      scoring
      candidate-funnel
      snapshot-generation
  -> db/
      client
      runs
      master-vessels
      snapshots
      opportunities
      current-materialization
      promotion
      retention
      verification
  -> Supabase long-term storage
  -> static-snapshot/
      bootstrap
      ports
      candidates
      targets
      paginated-vessels
      intelligence
  -> Cloudflare Worker
      static JSON first
      Supabase fallback/read-through only when needed
  -> Frontend
      bootstrap first
      lazy details
      no external APIs
```

## 11. Codebase Structure Review

| File | Current role | Problems | Suggested split | Priority |
|---|---|---|---|---|
| `scripts/update.js` | Collection, normalization, enrichment, scoring, candidate generation, JSON output, diagnostics | 6,865 lines, about 389 KB, 651 function/arrow matches; too many responsibilities | `collection/`, `normalization/`, `enrichment/`, `scoring/`, `candidate-funnel/`, `snapshot-output/`, `diagnostics/` | P1 |
| `scripts/lib/db.js` | Supabase client, run writes, master tables, all analytics writes, current materialization, retention, verification | 4,270 lines, about 241 KB, 354 function/arrow matches; persistence and diagnostics mixed | `db/client.js`, `db/runs.js`, `db/master.js`, `db/current.js`, `db/promotion.js`, `db/retention.js`, `db/verification.js` | P1 |
| `src/worker.js` | Cloudflare API, static fallback, Supabase query fallback, summary endpoints | 6,131 lines, about 347 KB, 598 function/arrow matches; duplicates update logic | `worker/router.js`, `worker/static.js`, `worker/supabase.js`, `worker/summaries.js`, shared contracts | P1 |
| `dashboard/index.html` | Complete UI, API client, fallback, KPI, latency, ports, candidates, intelligence, vessel pagination | Single 53 KB HTML file; startup fetch logic and renderers coupled | `api-client.js`, `bootstrap.js`, `kpi.js`, `health.js`, `vessels.js`, `intelligence.js` | P2 |
| `scripts/validate.js` | Data contract, workflow assertions, generated-output checks, architecture markers | 850 lines; validation failures can be broad and hard to isolate | `validate:data.js`, `validate:workflow.js`, `validate:frontend.js`, `validate:architecture.js` | P2 |
| `package.json` scripts | Command registry for update/audit/test/build/deploy | Many scripts but not grouped; build mutates generated outputs | Group audit commands and separate `build` from `update` if CI permits | P2 |
| `.github/workflows/longterm-update.yml` | Scheduled update every 4 hours | `contents: read`; does not publish generated static JSON to repo; relies on Supabase/Worker or separate deploy path | Clarify serving contract and add deploy path if static assets are production source | P0 |

### Hidden Valuable Features

The backend already contains valuable intelligence that should be preserved during cleanup:

- `feature_store` and `feature_snapshots`
- `rule_evaluations`
- `explainability_snapshots`
- `model_training_rows`
- `risk_history`
- `commercial_opportunity_daily`
- `route_snapshot_daily`
- `operator_snapshot_daily`
- `commercial_leads`
- `daily:enrich` and IMO recovery queue traces

These features are not dead code. They are part of the sales decision layer and should be reconnected through compact summaries rather than removed.

### Risky Fallback Paths

- Frontend target mode can still fall back to very large `target-vessels.json` or `vessels.json`.
- Worker APIs can query Supabase during user page load when static snapshots are missing.
- Static debug JSON can be much smaller or older than production JSON and must not be treated as production truth.
- Scheduled GitHub Action updates Supabase but does not automatically commit generated static JSON because workflow permissions are read-only.

## 12. Data Architecture Review

### A. Long-Term DB Storage

Mostly present and active. The DB layer writes core current and historical tables. It also writes advanced intelligence traces such as feature, rule, explainability, route, operator, and model training rows.

Violations and concerns:

- Persistence, promotion, retention, and verification are combined in one file.
- Current materialized tables can diverge from static JSON candidates.
- DB health is dependent on schema compatibility stripping in `scripts/lib/db.js`, which is useful but can hide schema drift unless audited.

### B. Fast Dashboard Snapshots

Present and improving:

- `bootstrap.json` exists and is small.
- Paginated vessel JSON exists.
- Required target endpoints exist.
- Intelligence summary JSON exists.

Violations and concerns:

- Large legacy JSON files are still generated.
- Latest successful static snapshot policy needs a clearer deploy mechanism.
- Some fallback paths still include large static JSON files for target mode.

### C. Frontend Rendering

Partially aligned:

- Full vessel list is lazy.
- Missing values generally render safely.
- Vessel detail fields include IMO, MMSI, call sign, operator, owner, manager, scores, source, and recommendation.

Violations:

- First load does not use `bootstrap.json` only.
- Health, continuity, alerts, changes, followups, top candidates, and intelligence are fetched during startup.
- API health/latency panel is coupled to normal startup fetches.

## 13. Top 10 Issues by Priority

1. P0: First dashboard load still fetches too many endpoints.
2. P0: Static JSON freshness versus Supabase latest successful run is not fully guaranteed by deployment.
3. P0: DB current candidate tables can be much smaller than JSON-qualified candidates and need a clear contract.
4. P0: `vessel_events` upsert depends on a unique/exclusion constraint for `event_uid`.
5. P1: `scripts/update.js` is too large to safely maintain.
6. P1: `scripts/lib/db.js` is too large and mixes persistence, retention, promotion, and diagnostics.
7. P1: `src/worker.js` duplicates backend scoring and summary logic.
8. P1: Large static JSON files remain and can become accidental fallback payloads.
9. P1: Enrichment/replenishment exists but IMO/owner/manager/flag/DWT coverage is currently ineffective.
10. P2: `dashboard/index.html` is still a single-file app with mixed API and rendering responsibilities.

## 14. Next 5 Safest Implementation Steps

1. Make frontend first load fetch `bootstrap.json` only, and move health/intelligence/changes/followups to lazy actions.
2. Add a clear `audit:truth` gate to compare DB latest successful run with `bootstrap.json`, `dashboard-summary.json`, candidates, and vessel pages.
3. Split `scripts/lib/db.js` only along existing function boundaries: client, runs, promotion, retention, verification.
4. Extract static snapshot generation from `scripts/update.js` without changing scoring.
5. Define the current table contract for `sales_candidates_current` and `immediate_targets_current` so DB current counts and dashboard counts are intentionally different or intentionally aligned.
