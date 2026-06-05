# UI Integration Audit

Generated: 2026-06-05

Scope: reconnect existing intelligence to the dashboard UI and make data quality problems visible. This is not a new intelligence build. The review followed `RESTORE > RECONNECT > EXTEND > REPLACE > CREATE`.

## Existing Assets Found

- `dashboard/index.html` and `public/index.html` already use `bootstrap.json` for the first screen and lazy-load intelligence groups.
- `vessel_display` already exists in candidate, target, sales action, and vessel page JSON outputs.
- Full vessel pagination already exists at `dashboard/api/vessels/index.json` and `dashboard/api/vessels/page-*.json`.
- Recent intelligence outputs already exist under `dashboard/api/intelligence/`.
- Sales support outputs already exist under `dashboard/api/sales/`.
- Existing audits include `audit:truth`, `audit:performance`, `audit:vessel-fields`, `audit:features`, `audit:targets`, and intelligence endpoint audits.

## Reuse Strategy

- Reuse the existing insight hub instead of creating parallel dashboard cards.
- Reuse `INTELLIGENCE_ENDPOINTS` for feature discovery and lazy rendering.
- Reuse existing `vessel_display` for compact and expanded vessel rows.
- Add a read-only `audit:ui` command instead of changing data collection or scoring.
- Add a compact `데이터 점검 필요` warning panel instead of hiding issues behind generic unknown states.

## Feature Matrix

| Feature | Endpoint | record_count | UI exists? | Visible? | Mobile usable? | Data valid? | Status |
|---|---:|---:|---|---|---|---|---|
| bootstrap.json | `dashboard/api/bootstrap.json` | 1427 | Yes | Yes | Yes | Yes | ACTIVE |
| vessel_display | `dashboard/api/vessels/page-1.json` | 1521 | Yes | Yes | Yes | Yes | ACTIVE |
| full vessel pagination | `dashboard/api/vessels/index.json` | 1521 | Yes | Yes | Yes | Yes | ACTIVE |
| target categories | `dashboard/api/targets/categories.json` | 1427 | Yes | Yes | Yes | Yes | ACTIVE |
| sales actions | `dashboard/api/sales/actions.json` | 300 | Yes | Lazy | Yes | Yes | ACTIVE |
| verification queue | `dashboard/api/sales/verification-queue.json` | 1427 | Yes | Yes | Yes | Yes | ACTIVE |
| message drafts | `dashboard/api/sales/message-drafts.json` | 0 | No | No | N/A | No endpoint | NEEDS_UI |
| daily sales report | `dashboard/api/reports/daily-sales-report.json` | 0 | Yes | Lazy | Yes | Empty valid JSON | EMPTY |
| repeat callers | `dashboard/api/intelligence/repeat-callers.json` | 10 | Yes | Lazy | Yes | Yes | ACTIVE |
| biofouling risk | `dashboard/api/intelligence/biofouling-risk.json` | 10 | Yes | Lazy | Yes | Yes | ACTIVE |
| fleet intelligence | `dashboard/api/intelligence/fleet-intelligence.json` | 10 | Yes | Lazy | Yes | Yes | ACTIVE |
| revenue forecast | `dashboard/api/intelligence/revenue-forecast.json` | 1 | Yes | Lazy | Yes | Yes | ACTIVE |
| agent intelligence | `dashboard/api/intelligence/agent-intelligence.json` | 10 | Yes | Lazy | Yes | Yes | ACTIVE |
| korea presence | `dashboard/api/intelligence/korea-presence.json` | 10 | Yes | Lazy | Yes | Yes | ACTIVE |
| fleet DNA | `dashboard/api/intelligence/fleet-dna.json` | 10 | Yes | Lazy | Yes | Yes | ACTIVE |
| compliance exposure | `dashboard/api/intelligence/compliance-exposure.json` | 10 | Yes | Lazy | Yes | Yes | ACTIVE |
| cleaning window | `dashboard/api/intelligence/cleaning-window.json` | 10 | Yes | Lazy | Yes | Yes | ACTIVE |
| opportunity memory | `dashboard/api/intelligence/opportunity-memory.json` | 10 | Yes | Lazy | Yes | Yes | ACTIVE |
| opportunity decay | `dashboard/api/intelligence/opportunity-decay.json` | 10 | Yes | Lazy | Yes | Yes | ACTIVE |
| missed opportunities | `dashboard/api/intelligence/missed-opportunities.json` | 1 | Yes | Lazy | Yes | Yes | ACTIVE |
| actionability ranking | `dashboard/api/intelligence/actionability-ranking.json` | 0 | No | No | N/A | No endpoint | NEEDS_UI |
| hidden opportunities | `dashboard/api/intelligence/hidden-opportunities.json` | 0 | No | No | N/A | No endpoint | NEEDS_UI |
| port DNA | `dashboard/api/intelligence/port-dna.json` | 9 | Yes | Lazy | Yes | Yes | ACTIVE |
| fleet momentum | `dashboard/api/intelligence/fleet-momentum.json` | 0 | No | No | N/A | No endpoint | NEEDS_UI |
| commercial similarity | `dashboard/api/intelligence/commercial-similarity.json` | 0 | No | No | N/A | No endpoint | NEEDS_UI |
| congestion / waiting score | `dashboard/api/congestion-watchlist.json` | 432 | Yes | Lazy | Yes | Yes | ACTIVE |
| enrichment fields | `dashboard/api/quality/basic-info-coverage.json` | 1427 | Yes | Lazy | Yes | Yes | ACTIVE |
| data quality dashboard | `dashboard/api/quality/data-quality.json` | 1521 | Yes | Lazy | Yes | Yes | ACTIVE |

## Data Quality Problems Now Surfaced

The dashboard now has a compact warning panel named `데이터 점검 필요`. It can surface:

- DB/latest run count and static JSON count mismatch.
- Sales target ratio below 20%.
- `opportunity_master > 0` while `sales_candidates_current = 0`.
- Port statistics failed or empty despite vessel data.
- Duplicate port aliases in rendered port summaries.
- Stale static JSON snapshot.
- Endpoint missing, invalid JSON, fetch failure, or 0-record loaded intelligence.
- Low IMO, call sign, or operator coverage from the existing data quality endpoints.

Known current data quality signals:

- `bootstrap.json` is small at about 23 KB and suitable for first screen rendering.
- Vessel pagination covers 1,521 vessels across 51 pages.
- Basic info coverage shows IMO coverage at 0% and operator coverage around 7%, so enrichment/replenishment remains the most visible data quality gap.
- Several legacy raw/static JSON files are intentionally large and should remain off the startup path.

## Remaining Gaps

- `message-drafts`, `actionability-ranking`, `hidden-opportunities`, `fleet-momentum`, and `commercial-similarity` do not currently have generated endpoints. They should not be displayed as real features until an existing backend implementation is found or restored.
- `fleet-summary.json` duplicates `fleet-intelligence.json`; keep one visible surface to avoid duplicate cards.
- `targets/static.json` is a duplicate/supporting target snapshot, not a separate UI feature.
- Large legacy files such as `target-vessels.json`, `all-collected-vessels.json`, `agent-followup-queue.json`, and port-level raw files should stay out of initial page load.

## Validation Command

Run:

```bash
npm run audit:ui
npm run audit:truth
```

Expected outcome after this pass:

- Hidden intelligence with `record_count > 0`: none.
- UI sections with missing endpoint: none.
- Missing feature candidates are reported as `NEEDS_UI` only when the endpoint itself is absent.
- When Supabase credentials are not present locally, `audit:truth` reports DB checks as `not_checked` instead of treating unavailable DB counts as real mismatches.
