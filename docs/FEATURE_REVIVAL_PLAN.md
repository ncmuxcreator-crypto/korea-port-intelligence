# Feature Revival Plan

Generated at: 2026-06-12T21:07:18.258Z

This plan restores existing dashboard functionality by reconnecting already-developed endpoints to existing sections. It avoids duplicate components, keeps heavy detail endpoints lazy, and uses verified tiered data outputs.

## Summary

- Already visible features: 18
- Revived / reconnected features: 3
- Skipped features: 4
- Hidden features with data: 0
- Placeholders reconnected: 3
- Heavy endpoints kept lazy: 19
- Diagnostic-only features: 2
- Duplicate risks: 2
- Source reports stale: yes

## Revival Matrix

| Feature | Area | Classification | Endpoint | Exists | Records | Startup | UI | Action | Risk | Priority |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Today Sales Actions | Sales Execution | ALREADY_VISIBLE | dashboard/api/sales/actions-summary.json | yes | 63 | no | VISIBLE_WITH_DATA | Already connected to an existing UI section; keep monitored. | LOW | 1 |
| Sales Targets | Sales Execution | ALREADY_VISIBLE | dashboard/api/targets/current-summary.json | yes | 33 | no | VISIBLE_WITH_DATA | Already connected to an existing UI section; keep monitored. | LOW | 1 |
| Quote Opportunities | Sales Execution | ALREADY_VISIBLE | dashboard/api/sales/quote-opportunities.json | yes | 36 | no | VISIBLE_WITH_DATA | Already connected to an existing UI section; keep monitored. | MEDIUM | 1 |
| Verification Queue | Sales Execution | ALREADY_VISIBLE | dashboard/api/sales/verification-queue-summary.json | yes | 110 | yes | VISIBLE_WITH_DATA | Already connected to an existing UI section; keep monitored. | LOW | 1 |
| Watchlist | Sales Execution | ALREADY_VISIBLE | dashboard/api/watchlist/current.json | yes | 20 | no | VISIBLE_WITH_DATA | Already connected to an existing UI section; keep monitored. | LOW | 1 |
| Target Categories | Sales Execution | ALREADY_VISIBLE | dashboard/api/targets/categories-summary.json | yes | 33 | yes | VISIBLE_WITH_DATA | Already connected to an existing UI section; keep monitored. | LOW | 1 |
| Port Summary | Port Intelligence | ALREADY_VISIBLE | dashboard/api/ports.json | yes | 8 | yes | VISIBLE_WITH_DATA | Already connected to an existing UI section; keep monitored. | LOW | 2 |
| Port DNA | Port Intelligence | ALREADY_VISIBLE | dashboard/api/intelligence/port-dna.json | yes | 10 | no | VISIBLE_WITH_DATA | Already connected to an existing UI section; keep monitored. | LOW | 2 |
| Fleet Intelligence | Fleet / Operator Intelligence | ALREADY_VISIBLE | dashboard/api/intelligence/fleet-intelligence.json | yes | 3 | no | VISIBLE_WITH_DATA | Already connected to an existing UI section; keep monitored. | LOW | 2 |
| Fleet Penetration | Fleet / Operator Intelligence | ALREADY_VISIBLE | dashboard/api/intelligence/fleet-penetration.json | yes | 3 | no | VISIBLE_WITH_DATA | Already connected to an existing UI section; keep monitored. | LOW | 2 |
| Revenue Forecast | Revenue / Opportunity | ALREADY_VISIBLE | dashboard/api/intelligence/revenue-forecast.json | yes | 1 | no | VISIBLE_WITH_DATA | Already connected to an existing UI section; keep monitored. | LOW | 2 |
| Cleaning Window | Vessel Intelligence | ALREADY_VISIBLE | dashboard/api/intelligence/cleaning-window.json | yes | 10 | no | VISIBLE_WITH_DATA | Already connected to an existing UI section; keep monitored. | LOW | 3 |
| Compliance Exposure | Vessel Intelligence | ALREADY_VISIBLE | dashboard/api/intelligence/compliance-exposure.json | yes | 6 | no | VISIBLE_WITH_DATA | Already connected to an existing UI section; keep monitored. | LOW | 3 |
| Contact Coverage | Sales Intelligence | ALREADY_VISIBLE | dashboard/api/intelligence/contact-coverage-summary.json | yes | 100 | no | VISIBLE_WITH_DATA | Already connected to an existing UI section; keep monitored. | LOW | 3 |
| Opportunity Memory | Sales Intelligence | ALREADY_VISIBLE | dashboard/api/intelligence/opportunity-memory.json | yes | 10 | no | VISIBLE_WITH_DATA | Already connected to an existing UI section; keep monitored. | LOW | 3 |
| Pilotage Summary | Data Source / Enrichment | ALREADY_VISIBLE | dashboard/api/aux/latest/pilotage-summary.json | yes | 361 | no | VISIBLE_WITH_DATA | Existing sources page component now uses verified aux/latest cache. | LOW | 4 |
| Berth / PNC Summary | Data Source / Enrichment | ALREADY_VISIBLE | dashboard/api/aux/latest/berth-summary.json | yes | 31 | no | VISIBLE_WITH_DATA | Existing sources page component now uses verified aux/latest cache. | LOW | 4 |
| AIS Info Summary | Data Source / Enrichment | ALREADY_VISIBLE | dashboard/api/aux/latest/ais-info-summary.json | yes | 10 | no | VISIBLE_WITH_DATA | Existing sources page component now uses verified aux/latest cache. | LOW | 4 |
| Vessel Spec Summary | Data Source / Enrichment | EMPTY_COLLAPSED | dashboard/api/aux/latest/vessel-spec-summary.json | yes | 0 | no | VISIBLE_EMPTY | Keep section collapsed with a clear empty reason. | LOW | 4 |
| Source CSV Summary | Data Source / Enrichment | EMPTY_COLLAPSED | dashboard/api/aux/source-csv-summary.json | yes | 0 | no | VISIBLE_EMPTY | Keep section collapsed with a clear empty reason. | LOW | 4 |
| Source Quality Score | Data Source / Enrichment | DIAGNOSTIC_ONLY | dashboard/api/source-quality-score.json | yes | 7 | no | VISIBLE_WITH_DATA | Keep on data-source/diagnostic page, outside business sections. | LOW | 4 |
| Enrichment Utilization | Data Source / Enrichment | DIAGNOSTIC_ONLY | dashboard/api/enrichment-utilization.json | yes | 7 | no | VISIBLE_WITH_DATA | Keep on data-source/diagnostic page, outside business sections. | LOW | 4 |

## Heavy Endpoints Kept Lazy

- Today Sales Actions: dashboard/api/sales/actions.json (7.3 KB, lazy)
- Sales Targets: dashboard/api/targets/current.json (7.1 KB, lazy)
- Quote Opportunities: dashboard/api/sales/quote-opportunities.json (623.8 KB, lazy)
- Verification Queue: dashboard/api/sales/verification-queue.json (7.3 KB, initial)
- Watchlist: dashboard/api/watchlist/current.json (278.2 KB, lazy)
- Target Categories: dashboard/api/targets/categories.json (49.5 KB, initial)
- Port DNA: dashboard/api/intelligence/port-dna.json (119.7 KB, lazy)
- Fleet Intelligence: dashboard/api/intelligence/fleet-intelligence.json (52.7 KB, lazy)
- Fleet Penetration: dashboard/api/intelligence/fleet-penetration.json (51.3 KB, lazy)
- Revenue Forecast: dashboard/api/intelligence/revenue-forecast.json (25.9 KB, lazy)
- Cleaning Window: dashboard/api/intelligence/cleaning-window.json (134.5 KB, lazy)
- Compliance Exposure: dashboard/api/intelligence/compliance-exposure.json (85.6 KB, lazy)
- Contact Coverage: dashboard/api/intelligence/contact-coverage.json (6.4 KB, lazy)
- Opportunity Memory: dashboard/api/intelligence/opportunity-memory.json (293.2 KB, lazy)
- Pilotage Summary: dashboard/api/aux/latest/pilotage-summary.json (4.3 KB, lazy)
- Berth / PNC Summary: dashboard/api/aux/latest/berth-summary.json (5.5 KB, lazy)
- AIS Info Summary: dashboard/api/aux/latest/ais-info-summary.json (3.2 KB, lazy)
- Vessel Spec Summary: dashboard/api/aux/latest/vessel-spec-summary.json (3 KB, lazy)
- Source CSV Summary: dashboard/api/aux/source-csv-summary.json (4.7 KB, lazy)

## Source Report Freshness

- docs/HIDDEN_FEATURE_AND_API_DISCOVERY.md: exists, generated_at 2026-06-12T17:45:09.197Z, stale yes
- dashboard/api/discovery/hidden-feature-and-api-discovery.json: exists, generated_at 2026-06-12T17:45:09.197Z, stale yes
- docs/FEATURE_REVIVAL_PLAN.md: exists, generated_at 2026-06-12T21:00:49.302Z, stale yes
- dashboard/api/feature-revival-plan.json: exists, generated_at 2026-06-12T21:00:49.302Z, stale yes
- docs/VESSEL_DISPLAY_PROPAGATION_REPORT.md: missing, stale no
- dashboard/api/enrichment/vessel-display-propagation-report.json: missing, stale no

## Duplicate Risks

- Watchlist: existing dedicated section is present; do not add duplicate summary cards.
- Target Categories: existing dedicated section is present; do not add duplicate summary cards.

## Next Actions

- Keep Overview on bootstrap and startup-safe summary outputs only.
- Use aux/latest cache files for auxiliary source summaries.
- Keep heavy detail endpoints lazy-loaded from existing click/expand flows.
- Keep source-quality and enrichment-utilization on the data-source/diagnostic page, not business sections.
- Do not add duplicate cards for target categories or watchlist because dedicated sections already exist.
