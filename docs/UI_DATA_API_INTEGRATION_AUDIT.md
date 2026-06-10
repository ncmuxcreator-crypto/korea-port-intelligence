# UI Data API Integration Audit

Generated: 2026-06-10T00:41:11.219Z

Scope: read-only audit of current UI, generated static JSON, source capabilities, and simple endpoint mapping health. No new intelligence feature was created.

## Summary

- Active feature mappings: 17
- Hidden feature mappings: 0
- Broken frontend endpoints: 0
- Frontend endpoints checked: 76
- Data source rows collected: 2021
- Normalized vessels: 1407
- Total vessel pages: 47

## Feature Matrix

| Feature | Source tables/data | Generated JSON endpoint | Frontend section | Visible | record_count | Status | Problem |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Overview bootstrap | dashboard_summary_snapshots, active_dataset_pointer, static snapshot | dashboard/api/bootstrap.json | Overview / Executive Summary | yes | 1311 | STALE | stale 70h |
| Sales actions | targets/categories, sales_candidates_current, sales/actions | dashboard/api/sales/actions.json | Sales Execution | yes | 300 | STALE | stale 70h |
| Conversion pipeline | sales-pipeline, sales/actions, operator_contact_history, commercial_leads | dashboard/api/sales/conversion-pipeline.json | Sales Execution / Advanced insight | yes | 300 | STALE | stale 70h |
| Watchlist | vessel_display, opportunity_memory, sales/actions, relationship-intelligence | dashboard/api/watchlist/current.json | Vessel Intelligence | yes | 20 | STALE | stale 70h |
| Quote opportunities | opportunity_master, sales candidates, service-bundles, cleaning-window | dashboard/api/sales/quote-opportunities.json | Sales Execution / Revenue | yes | 100 | STALE | stale 51h |
| Target categories | sales_candidates_current, opportunity_master, risk_history, rule_evaluations | dashboard/api/targets/categories.json | Target Categories | yes | 1311 | STALE | stale 70h |
| Top candidates | opportunity_master, candidates/top snapshot | dashboard/api/candidates/top.json | Vessel Intelligence | yes | 50 | STALE | stale 70h |
| Port intelligence | port_summary_current, port_snapshot_daily, port_congestion_snapshots, opportunity_master | dashboard/api/intelligence/port-dna.json | Port Intelligence | yes | 9 | STALE | stale 70h |
| Fleet intelligence | operator_snapshot_daily, fleet-memory, operator-opportunities, vessel_visits | dashboard/api/intelligence/fleet-intelligence.json | Fleet / Operator Intelligence | yes | 10 | STALE | stale 70h |
| Revenue forecast | commercial_opportunity_daily, opportunity_master, sales/actions, sales-pipeline | dashboard/api/intelligence/revenue-forecast.json | Revenue / Opportunity | yes | 1 | STALE | stale 70h |
| Compliance exposure | risk_history, route_snapshot_daily, opportunity_master, explainability_snapshots | dashboard/api/intelligence/compliance-exposure.json | Risk / Compliance | yes | 10 | STALE | stale 70h |
| Cleaning window | staying-vessels, anchorage-waiting, risk_history, opportunity_master | dashboard/api/intelligence/cleaning-window.json | Risk / Compliance | yes | 10 | STALE | stale 70h |
| Opportunity memory | opportunity_master, commercial_opportunity_daily, sales_candidates_current | dashboard/api/intelligence/opportunity-memory.json | Vessel Intelligence / Revenue | yes | 10 | STALE | stale 70h |
| Opportunity decay | opportunity-memory, sales-pipeline, opportunity_master | dashboard/api/intelligence/opportunity-decay.json | Revenue / Opportunity | yes | 10 | STALE | stale 70h |
| Vessel pages | latest successful vessel snapshot | dashboard/api/vessels/index.json | Full Vessel List | yes | 1407 | STALE | stale 70h |
| Vessel page 1 | latest successful vessel snapshot | dashboard/api/vessels/page-1.json | Full Vessel List | yes | 1407 | STALE | stale 70h |
| Data quality | quality diagnostics, source health, static JSON validation | dashboard/api/quality/data-quality.json | Data Quality / Technical Diagnostics | yes | 1407 | ACTIVE | - |

## Endpoint Map

| Frontend key | Expected URL | Actual generated file path | Exists | Valid JSON | record_count | Schema valid | Status | Problem |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| followups | /api/agent-followup-queue.json | dashboard/api/agent-followup-queue.json | yes | yes | 1311 | yes | ACTIVE | - |
| alerts | /api/alerts/sales-alerts.json | dashboard/api/alerts/sales-alerts.json | yes | yes | 3 | yes | ACTIVE | - |
| arrivalPipeline | /api/arrival-pipeline.json | dashboard/api/arrival-pipeline.json | yes | yes | 200 | yes | ACTIVE | - |
| bioBrazil, insight:biofoulingBrazil, path | /api/biofouling/brazil-compliance-risk.json | dashboard/api/biofouling/brazil-compliance-risk.json | yes | yes | 5 | yes | ACTIVE | - |
| link | /api/biofouling/hotspots.geojson | dashboard/api/biofouling/hotspots.geojson | yes | yes | 0 | yes | EMPTY_VALID | - |
| bioHotspots, insight:biofoulingHotspots, path | /api/biofouling/hotspots.json | dashboard/api/biofouling/hotspots.json | yes | yes | 8 | yes | ACTIVE | - |
| link | /api/biofouling/port-risk-map.geojson | dashboard/api/biofouling/port-risk-map.geojson | yes | yes | 0 | yes | EMPTY_VALID | - |
| bioPortRisk | /api/biofouling/port-risk-map.json | dashboard/api/biofouling/port-risk-map.json | yes | yes | 13 | yes | ACTIVE | - |
| bioTopCleaning | /api/biofouling/top-hull-cleaning-candidates.json | dashboard/api/biofouling/top-hull-cleaning-candidates.json | yes | yes | 10 | yes | ACTIVE | - |
| bioVesselRisk, insight:biofoulingVesselRisk, path | /api/biofouling/vessel-risk-scores.json | dashboard/api/biofouling/vessel-risk-scores.json | yes | yes | 100 | yes | ACTIVE | - |
| bootstrap | /api/bootstrap.json | dashboard/api/bootstrap.json | yes | yes | 1311 | yes | ACTIVE | - |
| candidates:top, top | /api/candidates/top.json | dashboard/api/candidates/top.json | yes | yes | 50 | yes | ACTIVE | - |
| changes | /api/changes.json | dashboard/api/changes.json | yes | yes | 0 | yes | EMPTY_VALID | - |
| insight:congestion, path | /api/congestion-watchlist.json | dashboard/api/congestion-watchlist.json | yes | yes | 393 | yes | ACTIVE | - |
| summary | /api/dashboard-summary.json | dashboard/api/dashboard-summary.json | yes | yes | 1311 | yes | ACTIVE | - |
| continuity | /api/data-continuity.json | dashboard/api/data-continuity.json | yes | yes | 1407 | yes | ACTIVE | - |
| health | /api/health/pipeline.json | dashboard/api/health/pipeline.json | yes | yes | 1311 | yes | ACTIVE | - |
| insight:agentIntelligence, path | /api/intelligence/agent-intelligence.json | dashboard/api/intelligence/agent-intelligence.json | yes | yes | 10 | yes | ACTIVE | - |
| insight:agentRelationship, path | /api/intelligence/agent-relationship.json | dashboard/api/intelligence/agent-relationship.json | yes | yes | 10 | yes | ACTIVE | - |
| insight:agent, path | /api/intelligence/agent-summary.json | dashboard/api/intelligence/agent-summary.json | yes | yes | 10 | yes | ACTIVE | - |
| insight:biofoulingRisk, path | /api/intelligence/biofouling-risk.json | dashboard/api/intelligence/biofouling-risk.json | yes | yes | 10 | yes | ACTIVE | - |
| insight:cleaningWindow, path | /api/intelligence/cleaning-window.json | dashboard/api/intelligence/cleaning-window.json | yes | yes | 10 | yes | ACTIVE | - |
| insight:commercial, path | /api/intelligence/commercial-summary.json | dashboard/api/intelligence/commercial-summary.json | yes | yes | 10 | yes | ACTIVE | - |
| insight:complianceExposure, path | /api/intelligence/compliance-exposure.json | dashboard/api/intelligence/compliance-exposure.json | yes | yes | 10 | yes | ACTIVE | - |
| insight:complianceOpportunities, path | /api/intelligence/compliance-opportunities.json | dashboard/api/intelligence/compliance-opportunities.json | yes | yes | 10 | yes | ACTIVE | - |
| insight:customerMemory, path | /api/intelligence/customer-memory.json | dashboard/api/intelligence/customer-memory.json | yes | yes | 10 | yes | ACTIVE | - |
| insight:drydockPrediction, path | /api/intelligence/drydock-prediction.json | dashboard/api/intelligence/drydock-prediction.json | yes | yes | 10 | yes | ACTIVE | - |
| insight:explainability, path | /api/intelligence/explainability.json | dashboard/api/intelligence/explainability.json | yes | yes | 10 | yes | ACTIVE | - |
| insight:fleetClusters, path | /api/intelligence/fleet-clusters.json | dashboard/api/intelligence/fleet-clusters.json | yes | yes | 10 | yes | ACTIVE | - |
| insight:fleetDna, path | /api/intelligence/fleet-dna.json | dashboard/api/intelligence/fleet-dna.json | yes | yes | 10 | yes | ACTIVE | - |
| insight:fleetExpansion, path | /api/intelligence/fleet-expansion.json | dashboard/api/intelligence/fleet-expansion.json | yes | yes | 9 | yes | ACTIVE | - |
| insight:fleetHeatmap, path | /api/intelligence/fleet-heatmap.json | dashboard/api/intelligence/fleet-heatmap.json | yes | yes | 10 | yes | ACTIVE | - |
| insight:fleet, path | /api/intelligence/fleet-intelligence.json | dashboard/api/intelligence/fleet-intelligence.json | yes | yes | 10 | yes | ACTIVE | - |
| insight:fleetMemory, path | /api/intelligence/fleet-memory.json | dashboard/api/intelligence/fleet-memory.json | yes | yes | 10 | yes | ACTIVE | - |
| insight:fleetPenetration, path | /api/intelligence/fleet-penetration.json | dashboard/api/intelligence/fleet-penetration.json | yes | yes | 10 | yes | ACTIVE | - |
| insight:hullCleaningEngine, path | /api/intelligence/hull-cleaning-engine.json | dashboard/api/intelligence/hull-cleaning-engine.json | yes | yes | 10 | yes | ACTIVE | - |
| insight:koreaPresence, path | /api/intelligence/korea-presence.json | dashboard/api/intelligence/korea-presence.json | yes | yes | 10 | yes | ACTIVE | - |
| insight:lostOpportunityReasons, path | /api/intelligence/lost-opportunity-reasons.json | dashboard/api/intelligence/lost-opportunity-reasons.json | yes | yes | 10 | yes | ACTIVE | - |
| insight:missedOpportunities, path | /api/intelligence/missed-opportunities.json | dashboard/api/intelligence/missed-opportunities.json | yes | yes | 10 | yes | ACTIVE | - |
| insight:operatorOpportunities, path | /api/intelligence/operator-opportunities.json | dashboard/api/intelligence/operator-opportunities.json | yes | yes | 10 | yes | ACTIVE | - |
| insight:operator, path | /api/intelligence/operator-summary.json | dashboard/api/intelligence/operator-summary.json | yes | yes | 10 | yes | ACTIVE | - |
| insight:opportunityDecay, path | /api/intelligence/opportunity-decay.json | dashboard/api/intelligence/opportunity-decay.json | yes | yes | 10 | yes | ACTIVE | - |
| insight:opportunityMemory, path | /api/intelligence/opportunity-memory.json | dashboard/api/intelligence/opportunity-memory.json | yes | yes | 10 | yes | ACTIVE | - |
| insight:portDemandRadar, path | /api/intelligence/port-demand-radar.json | dashboard/api/intelligence/port-demand-radar.json | yes | yes | 9 | yes | ACTIVE | - |
| insight:portDna, path | /api/intelligence/port-dna.json | dashboard/api/intelligence/port-dna.json | yes | yes | 9 | yes | ACTIVE | - |
| insight:portOpportunities, path | /api/intelligence/port-opportunities.json | dashboard/api/intelligence/port-opportunities.json | yes | yes | 9 | yes | ACTIVE | - |
| insight:portSeasonality, path | /api/intelligence/port-seasonality.json | dashboard/api/intelligence/port-seasonality.json | yes | yes | 8 | yes | ACTIVE | - |
| insight:prediction, path | /api/intelligence/prediction-summary.json | dashboard/api/intelligence/prediction-summary.json | yes | yes | 10 | yes | ACTIVE | - |
| insight:relationshipIntelligence, path | /api/intelligence/relationship-intelligence.json | dashboard/api/intelligence/relationship-intelligence.json | yes | yes | 10 | yes | ACTIVE | - |
| insight:repeatCallers, path | /api/intelligence/repeat-callers.json | dashboard/api/intelligence/repeat-callers.json | yes | yes | 10 | yes | ACTIVE | - |
| insight:revenueForecast, path | /api/intelligence/revenue-forecast.json | dashboard/api/intelligence/revenue-forecast.json | yes | yes | 1 | yes | ACTIVE | - |
| insight:risk, path | /api/intelligence/risk-summary.json | dashboard/api/intelligence/risk-summary.json | yes | yes | 10 | yes | ACTIVE | - |
| insight:route, path | /api/intelligence/route-summary.json | dashboard/api/intelligence/route-summary.json | yes | yes | 10 | yes | ACTIVE | - |
| insight:salesPriority, path | /api/intelligence/sales-priority.json | dashboard/api/intelligence/sales-priority.json | yes | yes | 10 | yes | ACTIVE | - |
| insight:serviceBundles, path | /api/intelligence/service-bundles.json | dashboard/api/intelligence/service-bundles.json | yes | yes | 10 | yes | ACTIVE | - |
| insight:superintendentTargets, path | /api/intelligence/superintendent-targets.json | dashboard/api/intelligence/superintendent-targets.json | yes | yes | 10 | yes | ACTIVE | - |
| insight:vesselTimeline, path | /api/intelligence/vessel-timeline.json | dashboard/api/intelligence/vessel-timeline.json | yes | yes | 10 | yes | ACTIVE | - |
| insight:winProbability, path | /api/intelligence/win-probability.json | dashboard/api/intelligence/win-probability.json | yes | yes | 10 | yes | ACTIVE | - |
| ports | /api/ports.json | dashboard/api/ports.json | yes | yes | 8 | yes | ACTIVE | - |
| insight:dataQuality, path | /api/quality/data-quality.json | dashboard/api/quality/data-quality.json | yes | yes | 1407 | yes | ACTIVE | - |
| insight:executiveWeekly, path | /api/reports/executive-weekly.json | dashboard/api/reports/executive-weekly.json | yes | yes | 1 | yes | ACTIVE | - |
| insight:morningBrief, path | /api/reports/morning-brief.json | dashboard/api/reports/morning-brief.json | yes | yes | 1 | yes | ACTIVE | - |
| insight:salesActions, path | /api/sales/actions.json | dashboard/api/sales/actions.json | yes | yes | 300 | yes | ACTIVE | - |
| insight:agentFollowupPriority, path | /api/sales/agent-followup-priority.json | dashboard/api/sales/agent-followup-priority.json | yes | yes | 50 | yes | ACTIVE | - |
| insight:conversionPipeline, path | /api/sales/conversion-pipeline.json | dashboard/api/sales/conversion-pipeline.json | yes | yes | 300 | yes | ACTIVE | - |
| insight:quoteOpportunities, path | /api/sales/quote-opportunities.json | dashboard/api/sales/quote-opportunities.json | yes | yes | 100 | yes | ACTIVE | - |
| verificationQueue | /api/sales/verification-queue.json | dashboard/api/sales/verification-queue.json | yes | yes | 1311 | yes | ACTIVE | - |
| insight:sourceHealth, path | /api/source-health.json | dashboard/api/source-health.json | yes | yes | 0 | yes | EMPTY_VALID | - |
| status | /api/status.json | dashboard/api/status.json | yes | yes | 1311 | yes | ACTIVE | - |
| targetStatic | /api/target-vessels.json | dashboard/api/target-vessels.json | yes | yes | 1311 | yes | ACTIVE | - |
| targetCategories, targets:categories | /api/targets/categories.json | dashboard/api/targets/categories.json | yes | yes | 1311 | yes | ACTIVE | - |
| targetCurrent | /api/targets/current.json | dashboard/api/targets/current.json | yes | yes | 1311 | yes | ACTIVE | - |
| vesselsStatic | /api/vessels.json | dashboard/api/vessels.json | yes | yes | 1311 | yes | ACTIVE | - |
| vesselPages, vessels:index | /api/vessels/index.json | dashboard/api/vessels/index.json | yes | yes | 1407 | yes | ACTIVE | - |
| vessels:page-1 | /api/vessels/page-1.json | dashboard/api/vessels/page-1.json | yes | yes | 1407 | yes | ACTIVE | - |
| watchlist | /api/watchlist/current.json | dashboard/api/watchlist/current.json | yes | yes | 20 | yes | ACTIVE | - |

## Source Capability Map

| Source | Enabled | Runtime status | Collected rows | Fields contributed | UI fields powered | Missing fields it could improve |
| --- | --- | --- | --- | --- | --- | --- |
| source_csv | no | not_configured | 0 | manual vessel corrections, IMO/MMSI, operator hints, port overrides | vessel identity, sales target enrichment, fallback candidate rows | SOURCE_CSV_URL can improve identity and operator coverage |
| vessel_spec | no | not_configured | 0 | IMO, MMSI, call sign, vessel type, GT, DWT, flag | vessel_display identity, quote readiness, fleet segmentation | VESSEL_SPEC_SERVICE_KEY would improve missing IMO/GT/DWT/flag |
| port_operation | yes | enabled | 5664 | vessel name, call sign, ETA/ATA, port, inbound/outbound status, GT hints | arrival pipeline, anchorage/staying, port summary, sales target funnel | already active; more endpoint variants can improve berth/pilot detail |
| port_facility | no | not_configured | 0 | berth, facility, terminal, anchorage/facility context | port intelligence, anchorage reason, vessel detail | PORT_FACILITY_SERVICE_KEY can improve berth/facility display |
| mof_vts | no | not_configured | 0 | movement area, VTS status, waiting/anchorage signal | anchorage waiting, congestion, vessel status | MOF_VTS credentials can reduce unknown status |
| mof_ais_dynamic | no | not_configured | 0 | lat/lon, speed, heading, recent AIS movement | map layers, loitering/anchorage, biofouling signal | MOF_AIS_DYNAMIC_* can improve live position and slow-steaming |
| mof_ais_info | no | not_configured | 0 | MMSI, IMO, vessel identity, call sign, size/type hints | vessel_display, enrichment coverage, quote readiness | MOF_AIS_INFO_* can improve identity coverage |
| mof_ais_stat | no | not_configured | 0 | traffic statistics and historical movement aggregates | port trend, congestion, fleet/route summaries | MOF_AIS_STAT_* can improve trend and seasonality features |
| supabase | yes | enabled | 2815 | run history, vessel history, opportunity history, snapshot promotion state | data health, stale/mismatch diagnostics, long-term intelligence | keep service-role writes only; frontend should use static JSON |

## Consistency Notes

- No KPI/data-count mismatches detected in the checked contracts.

## Broken Or Hidden Connections

- No missing, invalid JSON, or schema-broken frontend endpoints found.
- No catalogued feature with data is hidden from the UI.

## Light Repairs

- No endpoint path repair was required for the specifically checked endpoints: conversionPipeline, watchlist, sales actions, quote opportunities, targets/categories, port intelligence, fleet intelligence, revenue forecast, and vessel pages.
- No empty JSON wrapper was created because no frontend-referenced endpoint was missing or invalid.
- No UI redesign or new intelligence logic was added.

## Recommended Next Actions

- Configure vessel_spec when ready to improve IMO, GT, DWT, flag, and vessel type coverage.
- Configure MOF AIS dynamic when ready to power live position, loitering, and map layers.
