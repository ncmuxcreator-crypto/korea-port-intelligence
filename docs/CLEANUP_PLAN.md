# HWK Port Intelligence Platform Cleanup Plan

Generated: 2026-06-02

This plan is intentionally non-destructive. It keeps existing functionality and sequences cleanup work so that each step can be validated before the next one begins.

## Phase 0 — Safety

| Item | Priority | Risk | Expected benefit | Files likely affected | Validation command |
|---|---|---|---|---|---|
| Verify schema integrity for upserts and summary snapshots | P0 | Low if audit-only; medium if migrations are applied later | Prevents silent Supabase write failures | `scripts/audit-db.js`, `migrations/` | `npm run audit:db` |
| Strengthen DB vs static JSON consistency checks | P0 | Low | Detects stale/sample JSON while DB has real promoted data | `scripts/audit-truth.js`, `dashboard/api/*.json` | `npm run audit:truth` |
| Ensure latest failed update never overwrites latest successful static snapshot | P0 | Medium if output routing changes | Keeps dashboard alive during collector/DB failures | `scripts/update.js`, `scripts/lib/db.js` | `npm run update && npm run validate` |
| Keep no-infinite-loading checks in reliability tests | P0 | Low | Protects operator UX during missing/empty API responses | `tests/reliability-tests.js`, `dashboard/index.html` | `npm run test:reliability` |
| Define current table versus dashboard JSON candidate count contract | P0 | Low if documented first | Reduces confusion when `sales_candidates_current` differs from `targets/current.json` | `docs/`, `scripts/audit-targets.js`, `scripts/audit-db.js` | `npm run audit:targets && npm run audit:db` |

## Phase 1 — Performance

| Item | Priority | Risk | Expected benefit | Files likely affected | Validation command |
|---|---|---|---|---|---|
| Make first dashboard load use `bootstrap.json` only | P0 | Medium | Faster first render, fewer startup errors | `dashboard/index.html`, possibly frontend modules | `npm run audit:performance && npm run validate` |
| Move API health detail behind a button | P0 | Low | Removes avoidable startup endpoint fan-out | `dashboard/index.html` | `npm run audit:performance` |
| Lazy-load advanced intelligence only when expanded | P1 | Low to medium | Reduces startup API count and UI error noise | `dashboard/index.html` | `npm run audit:performance && npm run build` |
| Keep full vessel list paginated and lazy | P0 | Low | Prevents 20MB+ initial payloads | `scripts/update.js`, `dashboard/index.html` | `npm run audit:vessel-pages` |
| Enforce JSON size budgets | P1 | Low | Prevents accidental heavy snapshots | `scripts/audit-performance.js`, `scripts/update.js` | `npm run audit:performance` |
| Separate build from live update in developer workflows | P2 | Medium | Avoids accidental generated-output churn | `package.json`, CI workflows | `npm run validate` |

## Phase 2 — Data Quality

| Item | Priority | Risk | Expected benefit | Files likely affected | Validation command |
|---|---|---|---|---|---|
| Keep port normalization before every summary grouping | P0 | Low | Prevents Busan/Pusan/부산 duplicate port cards | `scripts/update.js`, shared normalization module | `npm run audit:normalize && npm run audit:data` |
| Audit vessel identity normalization and duplicates | P0 | Low | Prevents duplicate vessel rows and bad outreach | `scripts/audit-vessels.js`, `scripts/audit-normalize.js` | `npm run audit:vessels && npm run audit:normalize` |
| Restore/reconnect existing enrichment before scoring | P1 | Medium | Improves IMO, call sign, operator, GT/DWT coverage | `scripts/update.js`, `scripts/daily-enrichment.js`, `scripts/lib/db.js` | `npm run audit:enrichment && npm run audit:vessel-fields` |
| Preserve known enriched fields and avoid overwriting with blanks | P1 | Medium | Keeps vessel master quality improving over time | `scripts/lib/db.js`, enrichment functions | `npm run audit:enrichment && npm run audit:vessels` |
| Standardize `vessel_display` contract across every output | P1 | Low | Makes UI rendering predictable | `scripts/update.js`, `src/worker.js`, `dashboard/index.html` | `npm run validate && npm run build` |

## Phase 3 — Sales Intelligence

| Item | Priority | Risk | Expected benefit | Files likely affected | Validation command |
|---|---|---|---|---|---|
| Audit candidate funnel against latest successful dataset | P0 | Low | Shows exact drop-off stage without changing scoring | `scripts/audit-targets.js` | `npm run audit:targets` |
| Align anchorage/arrival/staying logic around OR-based commercial signals | P1 | Medium | Recovers practical sales timing candidates | `scripts/update.js`, `src/worker.js`, tests | `npm run audit:targets && npm run validate` |
| Strengthen candidate explainability visibility | P1 | Low to medium | Makes "why contact now" clear | `scripts/update.js`, `dashboard/api/intelligence/*.json`, UI cards | `npm run audit:features && npm run audit:truth` |
| Define HOT/WARM/LOW as ranked sales bands, not just raw thresholds | P1 | Medium | Better daily sales prioritization | `scripts/update.js`, audit scripts | `npm run audit:targets` |
| Keep immediate targets business-realistic without faking rows | P0 | Medium | Avoids both undercount and inflated sales queues | `scripts/update.js`, `scripts/audit-targets.js` | `npm run audit:targets && npm run audit:truth` |

## Phase 4 — Refactor

| Item | Priority | Risk | Expected benefit | Files likely affected | Validation command |
|---|---|---|---|---|---|
| Split `scripts/lib/db.js` by responsibility | P1 | Medium | Safer DB edits and migrations | `scripts/lib/db/client.js`, `runs.js`, `promotion.js`, `retention.js`, `verification.js`, `current.js` | `npm run audit:db && npm run validate` |
| Split static snapshot generation from `scripts/update.js` | P1 | Medium | Easier to keep latest-successful JSON contract | `scripts/update.js`, `scripts/snapshot/*.js` | `npm run update && npm run audit:truth` |
| Extract candidate funnel/scoring into shared modules | P1 | Medium to high | Removes Worker/update divergence | `scripts/candidate/*.js`, `src/worker.js` | `npm run audit:targets && npm run validate` |
| Split dashboard modules | P2 | Medium | Easier frontend maintenance without redesign | `dashboard/*.js`, `dashboard/index.html` | `npm run build` |
| Split validation scopes | P2 | Low to medium | Makes failures clearer | `scripts/validate*.js`, `package.json` | `npm run validate` |

## Immediate Non-Destructive Checklist

1. Run the full review command set and save the output in the task notes:
   - `npm run audit:performance`
   - `npm run audit:db`
   - `npm run audit:vessels`
   - `npm run audit:enrichment`
   - `npm run audit:targets`
   - `npm run audit:truth`
   - `npm run validate`
   - `npm run build`
2. Fix only audit script crashes, not business logic, during this review pass.
3. Do not delete DB rows or generated outputs automatically.
4. Do not change external API source behavior.
5. Do not redesign UI until first-load architecture is corrected.

## Safest Next 5 Implementation Steps

1. Convert dashboard startup to `bootstrap.json` only.
2. Move API response panel checks behind "상세 API 점검".
3. Make advanced intelligence load only on section expansion.
4. Split `scripts/lib/db.js` into client/runs/promotion/retention/verification without logic changes.
5. Add a CI-friendly truth audit summary that fails when DB latest successful data is newer than static JSON.
