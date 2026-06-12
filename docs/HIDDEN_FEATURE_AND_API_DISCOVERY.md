# Hidden Feature and API Discovery

Generated at: 2026-06-12T12:02:47.754Z
Run id: run_20260612065952169_5b648f9d

## Summary

| Metric | Value |
| --- | --- |
| Feature count | 150 |
| Endpoint count | 421 |
| Hidden feature count | 100 |
| Partial API/source count | 11 |
| Discussed but not implemented count | 0 |

## Feature Inventory

| Feature | Area | Status | Records | Visibility | Endpoints | Next Action |
| --- | --- | --- | --- | --- | --- | --- |
| 오늘의 영업 액션 | 영업 실행 | ACTIVE_VISIBLE | 406 | VISIBLE_OR_REFERENCED | dashboard/api/agent-followup-queue.json, dashboard/api/debug/agent-followup-queue.json, dashboard/api/debug/sales/actions-summary.json | Keep monitored by audit commands. |
| 영업 전환 파이프라인 | 영업 실행 | ACTIVE_VISIBLE | 70 | VISIBLE_OR_REFERENCED | dashboard/api/debug/sales/conversion-pipeline.json, dashboard/api/sales/conversion-pipeline.json | Keep monitored by audit commands. |
| 견적 기회 빌더 | 영업 실행 | ACTIVE_VISIBLE | 64 | VISIBLE_OR_REFERENCED | dashboard/api/debug/sales/quote-opportunities.json, dashboard/api/sales/quote-opportunities.json | Keep monitored by audit commands. |
| 관심 선박 | 영업 실행 | ACTIVE_VISIBLE | 20 | VISIBLE_OR_REFERENCED | dashboard/api/debug/watchlist/current.json, dashboard/api/watchlist/current.json | Keep monitored by audit commands. |
| 영업 대상 카테고리 | 영업 실행 | ACTIVE_VISIBLE | 124 | VISIBLE_OR_REFERENCED | dashboard/api/debug/targets/categories-summary.json, dashboard/api/debug/targets/categories.json, dashboard/api/debug/targets/current-summary.json | Keep monitored by audit commands. |
| 전체 선박 페이지 | 선박 인텔리전스 | ACTIVE_VISIBLE | 15936 | VISIBLE_OR_REFERENCED | dashboard/api/debug/vessels/index.json, dashboard/api/vessels/index.json, dashboard/api/vessels/page-1.json | Keep monitored by audit commands. |
| 입항 예정 | 선박 인텔리전스 | DEVELOPED_HIDDEN | 800 | HIDDEN_OR_LAZY | dashboard/api/arrival-pipeline-summary.json, dashboard/api/arrival-pipeline.json, dashboard/api/debug/arrival-pipeline-summary.json | Use summary endpoint first and lazy-load detail only on demand. |
| 묘박/대기 | 선박 인텔리전스 | DEVELOPED_HIDDEN | 568 | HIDDEN_OR_LAZY | dashboard/api/anchorage-waiting-summary.json, dashboard/api/anchorage-waiting.json, dashboard/api/debug/anchorage-waiting-summary.json | Use summary endpoint first and lazy-load detail only on demand. |
| 장기 체류 | 선박 인텔리전스 | ACTIVE_VISIBLE | 1000 | VISIBLE_OR_REFERENCED | dashboard/api/debug/staying-vessels-summary.json, dashboard/api/debug/staying-vessels.json, dashboard/api/staying-vessels-summary.json | Keep monitored by audit commands. |
| 부착생물 위험 | 선박 인텔리전스 | ACTIVE_VISIBLE | 260 | VISIBLE_OR_REFERENCED | dashboard/api/biofouling-timeline.json, dashboard/api/biofouling/brazil-compliance-risk.json, dashboard/api/biofouling/hotspots.json | Keep monitored by audit commands. |
| 클리닝 적기 | 선박 인텔리전스 | DEVELOPED_HIDDEN | 10 | HIDDEN_OR_LAZY | dashboard/api/debug/intelligence/cleaning-window.json, dashboard/api/intelligence/cleaning-window.json | Reconnect existing summary endpoint to a collapsed or lazy UI section. |
| Compliance 노출도 | 선박 인텔리전스 | ACTIVE_VISIBLE | 12 | VISIBLE_OR_REFERENCED | dashboard/api/debug/intelligence/compliance-exposure.json, dashboard/api/debug/intelligence/compliance-opportunities.json, dashboard/api/intelligence/compliance-exposure.json | Keep monitored by audit commands. |
| 반복 영업 기회 | 영업 실행 | DEVELOPED_HIDDEN | 10 | HIDDEN_OR_LAZY | dashboard/api/debug/intelligence/opportunity-memory.json, dashboard/api/intelligence/opportunity-memory.json | Reconnect existing summary endpoint to a collapsed or lazy UI section. |
| 선대 인텔리전스 | 항만·선대 인텔리전스 | ACTIVE_VISIBLE | 3 | VISIBLE_OR_REFERENCED | dashboard/api/debug/intelligence/fleet-intelligence.json, dashboard/api/intelligence/fleet-intelligence.json | Keep monitored by audit commands. |
| 선대 침투율 | 항만·선대 인텔리전스 | ACTIVE_VISIBLE | 3 | VISIBLE_OR_REFERENCED | dashboard/api/debug/intelligence/fleet-penetration.json, dashboard/api/intelligence/fleet-penetration.json | Keep monitored by audit commands. |
| 선대 기회 갭 | 항만·선대 인텔리전스 | ACTIVE_VISIBLE | 1 | VISIBLE_OR_REFERENCED | dashboard/api/debug/intelligence/fleet-gap-finder.json, dashboard/api/intelligence/fleet-gap-finder.json | Keep monitored by audit commands. |
| 선대 DNA | 항만·선대 인텔리전스 | ACTIVE_VISIBLE | 3 | VISIBLE_OR_REFERENCED | dashboard/api/debug/intelligence/fleet-dna.json, dashboard/api/intelligence/fleet-dna.json | Keep monitored by audit commands. |
| 에이전트 인텔리전스 | 항만·선대 인텔리전스 | DEVELOPED_HIDDEN | 20 | HIDDEN_OR_LAZY | dashboard/api/debug/intelligence/agent-intelligence.json, dashboard/api/debug/intelligence/agent-relationship.json, dashboard/api/intelligence/agent-intelligence.json | Reconnect existing summary endpoint to a collapsed or lazy UI section. |
| 예상 매출 기회 | 항만·선대 인텔리전스 | ACTIVE_VISIBLE | 2 | VISIBLE_OR_REFERENCED | dashboard/api/debug/intelligence/revenue-forecast.json, dashboard/api/intelligence/revenue-forecast.json | Keep monitored by audit commands. |
| 항만 DNA | 항만·선대 인텔리전스 | ACTIVE_VISIBLE | 20 | VISIBLE_OR_REFERENCED | dashboard/api/debug/intelligence/port-dna.json, dashboard/api/intelligence/port-dna.json | Keep monitored by audit commands. |
| 항만 수요 레이더 | 항만·선대 인텔리전스 | ACTIVE_VISIBLE | 9 | VISIBLE_OR_REFERENCED | dashboard/api/debug/intelligence/port-demand-radar.json, dashboard/api/intelligence/port-demand-radar.json | Keep monitored by audit commands. |
| 항만 계절성 | 항만·선대 인텔리전스 | ACTIVE_VISIBLE | 7 | VISIBLE_OR_REFERENCED | dashboard/api/debug/intelligence/port-seasonality.json, dashboard/api/intelligence/port-seasonality.json | Keep monitored by audit commands. |
| Source Data Enrichment | 데이터 소스·Enrichment | DEVELOPED_HIDDEN | 26409 | HIDDEN_OR_LAZY | dashboard/api/debug/enrichment/applied.json, dashboard/api/debug/enrichment/candidates.json, dashboard/api/debug/enrichment/review-queue.json | Use summary endpoint first and lazy-load detail only on demand. |
| Source Quality Score | 데이터 소스·Enrichment | DEVELOPED_HIDDEN | 14 | HIDDEN_OR_LAZY | dashboard/api/debug/source-quality-score.json, dashboard/api/source-quality-score.json | Reconnect existing summary endpoint to a collapsed or lazy UI section. |
| Source Capability Matrix | 데이터 소스·Enrichment | DEVELOPED_HIDDEN | 22 | HIDDEN_OR_LAZY | dashboard/api/debug/enrichment/source-capability-matrix.json, dashboard/api/enrichment/source-capability-matrix.json | Reconnect existing summary endpoint to a collapsed or lazy UI section. |
| 보조 소스 활용률 | 데이터 소스·Enrichment | ACTIVE_VISIBLE | 14 | VISIBLE_OR_REFERENCED | dashboard/api/debug/enrichment-utilization.json, dashboard/api/enrichment-utilization.json | Keep monitored by audit commands. |
| Auxiliary Source Cache | 데이터 소스·Enrichment | DEVELOPED_HIDDEN | 12 | HIDDEN_OR_LAZY | dashboard/api/aux/cache-status.json, dashboard/api/debug/aux/cache-status.json | Reconnect existing summary endpoint to a collapsed or lazy UI section. |
| Auxiliary Source Schedule | 데이터 소스·Enrichment | DEVELOPED_HIDDEN | 20 | HIDDEN_OR_LAZY | dashboard/api/aux/source-schedule.json, dashboard/api/debug/aux/source-schedule.json | Reconnect existing summary endpoint to a collapsed or lazy UI section. |
| DB Cleanup Plan | 시스템 진단 | DEVELOPED_HIDDEN | 5 | HIDDEN_OR_LAZY | dashboard/api/db-cleanup-plan.json, dashboard/api/debug/storage-efficiency-report.json, dashboard/api/storage-efficiency-report.json | Reconnect existing summary endpoint to a collapsed or lazy UI section. |
| 데이터 품질·시스템 진단 | 시스템 진단 | ACTIVE_VISIBLE | 1491 | VISIBLE_OR_REFERENCED | dashboard/api/aux/cache-status.json, dashboard/api/debug/aux/cache-status.json, dashboard/api/debug/quality/data-quality.json | Keep monitored by audit commands. |
| alerts.latest | 요약 / 현황판 | ENDPOINT_EXISTS_UI_MISSING | 3 | HIDDEN_OR_LAZY | dashboard/api/alerts/latest.json | Reconnect existing summary endpoint to a collapsed or lazy UI section. |
| alerts.sales-alerts | 요약 / 현황판 | ENDPOINT_EXISTS_UI_MISSING | 3 | HIDDEN_OR_LAZY | dashboard/api/alerts/sales-alerts.json | Reconnect existing summary endpoint to a collapsed or lazy UI section. |
| all-collected-vessels-summary | 요약 / 현황판 | ENDPOINT_EXISTS_UI_MISSING | 968 | HIDDEN_OR_LAZY | dashboard/api/all-collected-vessels-summary.json | Reconnect existing summary endpoint to a collapsed or lazy UI section. |
| all-collected-vessels | 선박 인텔리전스 | TOO_HEAVY_NEEDS_SUMMARY | 968 | HIDDEN_OR_LAZY | dashboard/api/all-collected-vessels.json | Use summary endpoint first and lazy-load detail only on demand. |
| aux.aisDynamicSummary | 요약 / 현황판 | ENDPOINT_EXISTS_UI_MISSING | 20 | HIDDEN_OR_LAZY | dashboard/api/aux/ais-dynamic-summary.json | Reconnect existing summary endpoint to a collapsed or lazy UI section. |
| aux.aisInfoSummary | 요약 / 현황판 | ENDPOINT_EXISTS_UI_MISSING | 10 | HIDDEN_OR_LAZY | dashboard/api/aux/ais-info-summary.json | Reconnect existing summary endpoint to a collapsed or lazy UI section. |
| aux.berthSummary | 요약 / 현황판 | ENDPOINT_EXISTS_UI_MISSING | 30 | HIDDEN_OR_LAZY | dashboard/api/aux/berth-summary.json | Reconnect existing summary endpoint to a collapsed or lazy UI section. |
| aux.pilotageSummary | 요약 / 현황판 | ENDPOINT_EXISTS_UI_MISSING | 385 | HIDDEN_OR_LAZY | dashboard/api/aux/pilotage-summary.json | Reconnect existing summary endpoint to a collapsed or lazy UI section. |
| aux.vesselSpecSummary | 요약 / 현황판 | ENDPOINT_EXISTS_UI_MISSING | 1 | HIDDEN_OR_LAZY | dashboard/api/aux/vessel-spec-summary.json | Reconnect existing summary endpoint to a collapsed or lazy UI section. |
| backend-ops | 요약 / 현황판 | ENDPOINT_EXISTS_UI_MISSING | 968 | HIDDEN_OR_LAZY | dashboard/api/backend-ops.json | Reconnect existing summary endpoint to a collapsed or lazy UI section. |
| bootstrap | 요약 / 현황판 | ENDPOINT_EXISTS_UI_MISSING | 29 | HIDDEN_OR_LAZY | dashboard/api/bootstrap.json | Reconnect existing summary endpoint to a collapsed or lazy UI section. |
| candidates-summary | 요약 / 현황판 | ENDPOINT_EXISTS_UI_MISSING | 31 | HIDDEN_OR_LAZY | dashboard/api/candidates-summary.json | Reconnect existing summary endpoint to a collapsed or lazy UI section. |
| candidates | 요약 / 현황판 | TOO_HEAVY_NEEDS_SUMMARY | 31 | HIDDEN_OR_LAZY | dashboard/api/candidates.json | Use summary endpoint first and lazy-load detail only on demand. |
| candidates.topSummary | 요약 / 현황판 | ENDPOINT_EXISTS_UI_MISSING | 50 | HIDDEN_OR_LAZY | dashboard/api/candidates/top-summary.json | Reconnect existing summary endpoint to a collapsed or lazy UI section. |
| candidates.top | 요약 / 현황판 | TOO_HEAVY_NEEDS_SUMMARY | 50 | HIDDEN_OR_LAZY | dashboard/api/candidates/top.json | Use summary endpoint first and lazy-load detail only on demand. |
| congestion-watchlist | 요약 / 현황판 | ENDPOINT_EXISTS_UI_MISSING | 21 | HIDDEN_OR_LAZY | dashboard/api/congestion-watchlist.json | Reconnect existing summary endpoint to a collapsed or lazy UI section. |
| contact-queue | 요약 / 현황판 | ENDPOINT_EXISTS_UI_MISSING | 31 | HIDDEN_OR_LAZY | dashboard/api/contact-queue.json | Reconnect existing summary endpoint to a collapsed or lazy UI section. |
| contact-ready-vessels | 선박 인텔리전스 | ENDPOINT_EXISTS_UI_MISSING | 19 | HIDDEN_OR_LAZY | dashboard/api/contact-ready-vessels.json | Reconnect existing summary endpoint to a collapsed or lazy UI section. |
| continuity | 요약 / 현황판 | TECHNICAL_DIAGNOSTIC_ONLY | 968 | DIAGNOSTIC_ONLY | dashboard/api/continuity.json | Confirm requirement before implementation. |
| coverage-registry | 요약 / 현황판 | ENDPOINT_EXISTS_UI_MISSING | 31 | HIDDEN_OR_LAZY | dashboard/api/coverage-registry.json | Reconnect existing summary endpoint to a collapsed or lazy UI section. |
| dashboard-summary | 요약 / 현황판 | ENDPOINT_EXISTS_UI_MISSING | 31 | HIDDEN_OR_LAZY | dashboard/api/dashboard-summary.json | Reconnect existing summary endpoint to a collapsed or lazy UI section. |
| data-continuity | 요약 / 현황판 | TECHNICAL_DIAGNOSTIC_ONLY | 968 | DIAGNOSTIC_ONLY | dashboard/api/data-continuity.json | Confirm requirement before implementation. |
| debug.alerts.latest | 시스템 진단 | TECHNICAL_DIAGNOSTIC_ONLY | 1 | DIAGNOSTIC_ONLY | dashboard/api/debug/alerts/latest.json | Confirm requirement before implementation. |
| debug.alerts.sales-alerts | 시스템 진단 | TECHNICAL_DIAGNOSTIC_ONLY | 1 | DIAGNOSTIC_ONLY | dashboard/api/debug/alerts/sales-alerts.json | Confirm requirement before implementation. |
| debug.intelligence.contact-coverage-summary | 요약 / 현황판 | TECHNICAL_DIAGNOSTIC_ONLY | 32 | DIAGNOSTIC_ONLY | dashboard/api/debug/intelligence/contact-coverage-summary.json | Confirm requirement before implementation. |
| debug.intelligence.contact-coverage | 요약 / 현황판 | TECHNICAL_DIAGNOSTIC_ONLY | 32 | DIAGNOSTIC_ONLY | dashboard/api/debug/intelligence/contact-coverage.json | Confirm requirement before implementation. |
| debug.ocean-conditions | 시스템 진단 | TECHNICAL_DIAGNOSTIC_ONLY | 12 | DIAGNOSTIC_ONLY | dashboard/api/debug/ocean-conditions.json | Confirm requirement before implementation. |
| debug.reports.executive-weekly | 항만·선대 인텔리전스 | TECHNICAL_DIAGNOSTIC_ONLY | 1 | DIAGNOSTIC_ONLY | dashboard/api/debug/reports/executive-weekly.json | Confirm requirement before implementation. |
| debug.reports.morning-brief | 항만·선대 인텔리전스 | TECHNICAL_DIAGNOSTIC_ONLY | 1 | DIAGNOSTIC_ONLY | dashboard/api/debug/reports/morning-brief.json | Confirm requirement before implementation. |
| debug.source-health-local | 시스템 진단 | TECHNICAL_DIAGNOSTIC_ONLY | 24 | DIAGNOSTIC_ONLY | dashboard/api/debug/source-health-local.json | Confirm requirement before implementation. |
| discovery.hidden-feature-and-api-discovery | 요약 / 현황판 | TOO_HEAVY_NEEDS_SUMMARY | 416 | HIDDEN_OR_LAZY | dashboard/api/discovery/hidden-feature-and-api-discovery.json | Use summary endpoint first and lazy-load detail only on demand. |
| discovery.source-enrichment-capability-matrix | 요약 / 현황판 | ENDPOINT_EXISTS_UI_MISSING | 544 | HIDDEN_OR_LAZY | dashboard/api/discovery/source-enrichment-capability-matrix.json | Reconnect existing summary endpoint to a collapsed or lazy UI section. |
| fleet-opportunities | 항만·선대 인텔리전스 | ENDPOINT_EXISTS_UI_MISSING | 2 | HIDDEN_OR_LAZY | dashboard/api/fleet-opportunities.json | Reconnect existing summary endpoint to a collapsed or lazy UI section. |
| health | 시스템 진단 | ENDPOINT_EXISTS_UI_MISSING | 31 | HIDDEN_OR_LAZY | dashboard/api/health.json | Reconnect existing summary endpoint to a collapsed or lazy UI section. |
| health.pipeline | 시스템 진단 | TECHNICAL_DIAGNOSTIC_ONLY | 31 | DIAGNOSTIC_ONLY | dashboard/api/health/pipeline.json | Confirm requirement before implementation. |
| high-value-low-confidence | 요약 / 현황판 | ENDPOINT_EXISTS_UI_MISSING | 30 | HIDDEN_OR_LAZY | dashboard/api/high-value-low-confidence.json | Reconnect existing summary endpoint to a collapsed or lazy UI section. |
| high-value-targets | 요약 / 현황판 | ENDPOINT_EXISTS_UI_MISSING | 21 | HIDDEN_OR_LAZY | dashboard/api/high-value-targets.json | Reconnect existing summary endpoint to a collapsed or lazy UI section. |
| hot-candidates | 요약 / 현황판 | ENDPOINT_EXISTS_UI_MISSING | 12 | HIDDEN_OR_LAZY | dashboard/api/hot-candidates.json | Reconnect existing summary endpoint to a collapsed or lazy UI section. |
| hot-vessels-summary | 요약 / 현황판 | ENDPOINT_EXISTS_UI_MISSING | 26 | HIDDEN_OR_LAZY | dashboard/api/hot-vessels-summary.json | Reconnect existing summary endpoint to a collapsed or lazy UI section. |
| hot-vessels | 선박 인텔리전스 | TOO_HEAVY_NEEDS_SUMMARY | 26 | HIDDEN_OR_LAZY | dashboard/api/hot-vessels.json | Use summary endpoint first and lazy-load detail only on demand. |
| imo-recovery-priority | 요약 / 현황판 | TECHNICAL_DIAGNOSTIC_ONLY | 31 | DIAGNOSTIC_ONLY | dashboard/api/imo-recovery-priority.json | Confirm requirement before implementation. |
| imo-recovery-queue | 요약 / 현황판 | ENDPOINT_EXISTS_UI_MISSING | 31 | HIDDEN_OR_LAZY | dashboard/api/imo-recovery-queue.json | Reconnect existing summary endpoint to a collapsed or lazy UI section. |
| intelligence.agent-summary | 항만·선대 인텔리전스 | ENDPOINT_EXISTS_UI_MISSING | 10 | HIDDEN_OR_LAZY | dashboard/api/intelligence/agent-summary.json | Reconnect existing summary endpoint to a collapsed or lazy UI section. |
| intelligence.commercial-summary | 요약 / 현황판 | ENDPOINT_EXISTS_UI_MISSING | 10 | HIDDEN_OR_LAZY | dashboard/api/intelligence/commercial-summary.json | Reconnect existing summary endpoint to a collapsed or lazy UI section. |
| intelligence.contactCoverageSummary | 요약 / 현황판 | ENDPOINT_EXISTS_UI_MISSING | 100 | HIDDEN_OR_LAZY | dashboard/api/intelligence/contact-coverage-summary.json | Reconnect existing summary endpoint to a collapsed or lazy UI section. |
| intelligence.contactCoverage | 요약 / 현황판 | TOO_HEAVY_NEEDS_SUMMARY | 100 | HIDDEN_OR_LAZY | dashboard/api/intelligence/contact-coverage.json | Use summary endpoint first and lazy-load detail only on demand. |
| intelligence.customer-memory | 요약 / 현황판 | ENDPOINT_EXISTS_UI_MISSING | 10 | HIDDEN_OR_LAZY | dashboard/api/intelligence/customer-memory.json | Reconnect existing summary endpoint to a collapsed or lazy UI section. |
| intelligence.drydock-prediction | 요약 / 현황판 | ENDPOINT_EXISTS_UI_MISSING | 10 | HIDDEN_OR_LAZY | dashboard/api/intelligence/drydock-prediction.json | Reconnect existing summary endpoint to a collapsed or lazy UI section. |
| intelligence.explainability | 요약 / 현황판 | ENDPOINT_EXISTS_UI_MISSING | 10 | HIDDEN_OR_LAZY | dashboard/api/intelligence/explainability.json | Reconnect existing summary endpoint to a collapsed or lazy UI section. |
| intelligence.fleet-clusters | 항만·선대 인텔리전스 | ENDPOINT_EXISTS_UI_MISSING | 2 | HIDDEN_OR_LAZY | dashboard/api/intelligence/fleet-clusters.json | Reconnect existing summary endpoint to a collapsed or lazy UI section. |
| intelligence.fleet-expansion | 항만·선대 인텔리전스 | ENDPOINT_EXISTS_UI_MISSING | 2 | HIDDEN_OR_LAZY | dashboard/api/intelligence/fleet-expansion.json | Reconnect existing summary endpoint to a collapsed or lazy UI section. |
| intelligence.fleet-heatmap | 항만·선대 인텔리전스 | ENDPOINT_EXISTS_UI_MISSING | 3 | HIDDEN_OR_LAZY | dashboard/api/intelligence/fleet-heatmap.json | Reconnect existing summary endpoint to a collapsed or lazy UI section. |
| intelligence.fleet-memory | 항만·선대 인텔리전스 | ENDPOINT_EXISTS_UI_MISSING | 2 | HIDDEN_OR_LAZY | dashboard/api/intelligence/fleet-memory.json | Reconnect existing summary endpoint to a collapsed or lazy UI section. |
| intelligence.fleet-summary | 항만·선대 인텔리전스 | ENDPOINT_EXISTS_UI_MISSING | 3 | HIDDEN_OR_LAZY | dashboard/api/intelligence/fleet-summary.json | Reconnect existing summary endpoint to a collapsed or lazy UI section. |
| intelligence.hull-cleaning-engine | 요약 / 현황판 | ENDPOINT_EXISTS_UI_MISSING | 10 | HIDDEN_OR_LAZY | dashboard/api/intelligence/hull-cleaning-engine.json | Reconnect existing summary endpoint to a collapsed or lazy UI section. |
| intelligence.korea-presence | 요약 / 현황판 | ENDPOINT_EXISTS_UI_MISSING | 10 | HIDDEN_OR_LAZY | dashboard/api/intelligence/korea-presence.json | Reconnect existing summary endpoint to a collapsed or lazy UI section. |
| intelligence.lost-opportunity-reasons | 요약 / 현황판 | ENDPOINT_EXISTS_UI_MISSING | 10 | HIDDEN_OR_LAZY | dashboard/api/intelligence/lost-opportunity-reasons.json | Reconnect existing summary endpoint to a collapsed or lazy UI section. |
| intelligence.missed-opportunities | 요약 / 현황판 | ENDPOINT_EXISTS_UI_MISSING | 1 | HIDDEN_OR_LAZY | dashboard/api/intelligence/missed-opportunities.json | Reconnect existing summary endpoint to a collapsed or lazy UI section. |
| intelligence.operator-opportunities | 항만·선대 인텔리전스 | ENDPOINT_EXISTS_UI_MISSING | 2 | HIDDEN_OR_LAZY | dashboard/api/intelligence/operator-opportunities.json | Reconnect existing summary endpoint to a collapsed or lazy UI section. |
| intelligence.operator-summary | 항만·선대 인텔리전스 | ENDPOINT_EXISTS_UI_MISSING | 2 | HIDDEN_OR_LAZY | dashboard/api/intelligence/operator-summary.json | Reconnect existing summary endpoint to a collapsed or lazy UI section. |
| intelligence.opportunity-decay | 요약 / 현황판 | ENDPOINT_EXISTS_UI_MISSING | 10 | HIDDEN_OR_LAZY | dashboard/api/intelligence/opportunity-decay.json | Reconnect existing summary endpoint to a collapsed or lazy UI section. |
| intelligence.port-opportunities | 항만·선대 인텔리전스 | ENDPOINT_EXISTS_UI_MISSING | 9 | HIDDEN_OR_LAZY | dashboard/api/intelligence/port-opportunities.json | Reconnect existing summary endpoint to a collapsed or lazy UI section. |
| intelligence.prediction-summary | 요약 / 현황판 | ENDPOINT_EXISTS_UI_MISSING | 10 | HIDDEN_OR_LAZY | dashboard/api/intelligence/prediction-summary.json | Reconnect existing summary endpoint to a collapsed or lazy UI section. |
| intelligence.relationship-intelligence | 요약 / 현황판 | ENDPOINT_EXISTS_UI_MISSING | 10 | HIDDEN_OR_LAZY | dashboard/api/intelligence/relationship-intelligence.json | Reconnect existing summary endpoint to a collapsed or lazy UI section. |
| intelligence.repeat-callers | 요약 / 현황판 | ENDPOINT_EXISTS_UI_MISSING | 10 | HIDDEN_OR_LAZY | dashboard/api/intelligence/repeat-callers.json | Reconnect existing summary endpoint to a collapsed or lazy UI section. |
| intelligence.risk-summary | 요약 / 현황판 | ENDPOINT_EXISTS_UI_MISSING | 10 | HIDDEN_OR_LAZY | dashboard/api/intelligence/risk-summary.json | Reconnect existing summary endpoint to a collapsed or lazy UI section. |
| intelligence.route-summary | 요약 / 현황판 | ENDPOINT_EXISTS_UI_MISSING | 10 | HIDDEN_OR_LAZY | dashboard/api/intelligence/route-summary.json | Reconnect existing summary endpoint to a collapsed or lazy UI section. |
| intelligence.sales-priority | 요약 / 현황판 | ENDPOINT_EXISTS_UI_MISSING | 10 | HIDDEN_OR_LAZY | dashboard/api/intelligence/sales-priority.json | Reconnect existing summary endpoint to a collapsed or lazy UI section. |
| intelligence.service-bundles | 요약 / 현황판 | ENDPOINT_EXISTS_UI_MISSING | 10 | HIDDEN_OR_LAZY | dashboard/api/intelligence/service-bundles.json | Reconnect existing summary endpoint to a collapsed or lazy UI section. |
| intelligence.superintendent-targets | 요약 / 현황판 | ENDPOINT_EXISTS_UI_MISSING | 10 | HIDDEN_OR_LAZY | dashboard/api/intelligence/superintendent-targets.json | Reconnect existing summary endpoint to a collapsed or lazy UI section. |
| intelligence.vessel-timeline | 요약 / 현황판 | ENDPOINT_EXISTS_UI_MISSING | 10 | HIDDEN_OR_LAZY | dashboard/api/intelligence/vessel-timeline.json | Reconnect existing summary endpoint to a collapsed or lazy UI section. |
| intelligence.win-probability | 요약 / 현황판 | ENDPOINT_EXISTS_UI_MISSING | 10 | HIDDEN_OR_LAZY | dashboard/api/intelligence/win-probability.json | Reconnect existing summary endpoint to a collapsed or lazy UI section. |
| json-root-repairs | 요약 / 현황판 | ENDPOINT_EXISTS_UI_MISSING | 1 | HIDDEN_OR_LAZY | dashboard/api/json-root-repairs.json | Reconnect existing summary endpoint to a collapsed or lazy UI section. |
| ocean-conditions | 요약 / 현황판 | ENDPOINT_EXISTS_UI_MISSING | 12 | HIDDEN_OR_LAZY | dashboard/api/ocean-conditions.json | Reconnect existing summary endpoint to a collapsed or lazy UI section. |
| port-congestion-heatmap | 항만·선대 인텔리전스 | ENDPOINT_EXISTS_UI_MISSING | 7 | HIDDEN_OR_LAZY | dashboard/api/port-congestion-heatmap.json | Reconnect existing summary endpoint to a collapsed or lazy UI section. |
| port-opportunities | 항만·선대 인텔리전스 | ENDPOINT_EXISTS_UI_MISSING | 8 | HIDDEN_OR_LAZY | dashboard/api/port-opportunities.json | Reconnect existing summary endpoint to a collapsed or lazy UI section. |
| ports | 항만·선대 인텔리전스 | ENDPOINT_EXISTS_UI_MISSING | 8 | HIDDEN_OR_LAZY | dashboard/api/ports.json | Reconnect existing summary endpoint to a collapsed or lazy UI section. |
| ports.020.anchorage | 항만·선대 인텔리전스 | ENDPOINT_EXISTS_UI_MISSING | 77 | HIDDEN_OR_LAZY | dashboard/api/ports/020/anchorage.json | Reconnect existing summary endpoint to a collapsed or lazy UI section. |
| ports.020.hull-cleaning | 항만·선대 인텔리전스 | ENDPOINT_EXISTS_UI_MISSING | 2 | HIDDEN_OR_LAZY | dashboard/api/ports/020/hull-cleaning.json | Reconnect existing summary endpoint to a collapsed or lazy UI section. |
| ports.020.vessels-summary | 항만·선대 인텔리전스 | ENDPOINT_EXISTS_UI_MISSING | 43 | HIDDEN_OR_LAZY | dashboard/api/ports/020/vessels-summary.json | Reconnect existing summary endpoint to a collapsed or lazy UI section. |
| ports.020.vessels | 선박 인텔리전스 | TOO_HEAVY_NEEDS_SUMMARY | 43 | HIDDEN_OR_LAZY | dashboard/api/ports/020/vessels.json | Use summary endpoint first and lazy-load detail only on demand. |
| ports.030.anchorage | 항만·선대 인텔리전스 | ENDPOINT_EXISTS_UI_MISSING | 7 | HIDDEN_OR_LAZY | dashboard/api/ports/030/anchorage.json | Reconnect existing summary endpoint to a collapsed or lazy UI section. |
| ports.030.candidates | 항만·선대 인텔리전스 | ENDPOINT_EXISTS_UI_MISSING | 1 | HIDDEN_OR_LAZY | dashboard/api/ports/030/candidates.json | Reconnect existing summary endpoint to a collapsed or lazy UI section. |
| ports.030.hull-cleaning | 항만·선대 인텔리전스 | ENDPOINT_EXISTS_UI_MISSING | 1 | HIDDEN_OR_LAZY | dashboard/api/ports/030/hull-cleaning.json | Reconnect existing summary endpoint to a collapsed or lazy UI section. |
| ports.030.vessels-summary | 항만·선대 인텔리전스 | ENDPOINT_EXISTS_UI_MISSING | 91 | HIDDEN_OR_LAZY | dashboard/api/ports/030/vessels-summary.json | Reconnect existing summary endpoint to a collapsed or lazy UI section. |
| ports.030.vessels | 선박 인텔리전스 | TOO_HEAVY_NEEDS_SUMMARY | 91 | HIDDEN_OR_LAZY | dashboard/api/ports/030/vessels.json | Use summary endpoint first and lazy-load detail only on demand. |
| ports.031.anchorage | 항만·선대 인텔리전스 | ENDPOINT_EXISTS_UI_MISSING | 4 | HIDDEN_OR_LAZY | dashboard/api/ports/031/anchorage.json | Reconnect existing summary endpoint to a collapsed or lazy UI section. |
| ports.031.candidates | 항만·선대 인텔리전스 | ENDPOINT_EXISTS_UI_MISSING | 3 | HIDDEN_OR_LAZY | dashboard/api/ports/031/candidates.json | Reconnect existing summary endpoint to a collapsed or lazy UI section. |
| ports.031.vessels-summary | 항만·선대 인텔리전스 | ENDPOINT_EXISTS_UI_MISSING | 74 | HIDDEN_OR_LAZY | dashboard/api/ports/031/vessels-summary.json | Reconnect existing summary endpoint to a collapsed or lazy UI section. |
| ports.031.vessels | 선박 인텔리전스 | TOO_HEAVY_NEEDS_SUMMARY | 74 | HIDDEN_OR_LAZY | dashboard/api/ports/031/vessels.json | Use summary endpoint first and lazy-load detail only on demand. |

## UI Placeholders / Hidden Markers

| Marker | Reason | Recommended Action |
| --- | --- | --- |
| 데이터 준비 중 | Placeholder/hidden marker found in dashboard HTML. | Map to an existing summary endpoint if data exists; otherwise keep as empty state. |
| 데이터 준비 중 | Placeholder/hidden marker found in dashboard HTML. | Map to an existing summary endpoint if data exists; otherwise keep as empty state. |
| 데이터 준비 중 | Placeholder/hidden marker found in dashboard HTML. | Map to an existing summary endpoint if data exists; otherwise keep as empty state. |
| 데이터 준비 중 | Placeholder/hidden marker found in dashboard HTML. | Map to an existing summary endpoint if data exists; otherwise keep as empty state. |
| 데이터 준비 중 | Placeholder/hidden marker found in dashboard HTML. | Map to an existing summary endpoint if data exists; otherwise keep as empty state. |
| 데이터 준비 중 | Placeholder/hidden marker found in dashboard HTML. | Map to an existing summary endpoint if data exists; otherwise keep as empty state. |
| 데이터 준비 중 | Placeholder/hidden marker found in dashboard HTML. | Map to an existing summary endpoint if data exists; otherwise keep as empty state. |
| 데이터 준비 중 | Placeholder/hidden marker found in dashboard HTML. | Map to an existing summary endpoint if data exists; otherwise keep as empty state. |
| 데이터 준비 중 | Placeholder/hidden marker found in dashboard HTML. | Map to an existing summary endpoint if data exists; otherwise keep as empty state. |
| 데이터 준비 중 | Placeholder/hidden marker found in dashboard HTML. | Map to an existing summary endpoint if data exists; otherwise keep as empty state. |
| 데이터 준비 중 | Placeholder/hidden marker found in dashboard HTML. | Map to an existing summary endpoint if data exists; otherwise keep as empty state. |
| 데이터 준비 중 | Placeholder/hidden marker found in dashboard HTML. | Map to an existing summary endpoint if data exists; otherwise keep as empty state. |
| 데이터 준비 중 | Placeholder/hidden marker found in dashboard HTML. | Map to an existing summary endpoint if data exists; otherwise keep as empty state. |
| 데이터 준비 중 | Placeholder/hidden marker found in dashboard HTML. | Map to an existing summary endpoint if data exists; otherwise keep as empty state. |
| 데이터 준비 중 | Placeholder/hidden marker found in dashboard HTML. | Map to an existing summary endpoint if data exists; otherwise keep as empty state. |
| 데이터 준비 중 | Placeholder/hidden marker found in dashboard HTML. | Map to an existing summary endpoint if data exists; otherwise keep as empty state. |
| 데이터 준비 중 | Placeholder/hidden marker found in dashboard HTML. | Map to an existing summary endpoint if data exists; otherwise keep as empty state. |
| 데이터 준비 중 | Placeholder/hidden marker found in dashboard HTML. | Map to an existing summary endpoint if data exists; otherwise keep as empty state. |
| 데이터 준비 중 | Placeholder/hidden marker found in dashboard HTML. | Map to an existing summary endpoint if data exists; otherwise keep as empty state. |
| 데이터 준비 중 | Placeholder/hidden marker found in dashboard HTML. | Map to an existing summary endpoint if data exists; otherwise keep as empty state. |
| 데이터 준비 중 | Placeholder/hidden marker found in dashboard HTML. | Map to an existing summary endpoint if data exists; otherwise keep as empty state. |
| 데이터 준비 중 | Placeholder/hidden marker found in dashboard HTML. | Map to an existing summary endpoint if data exists; otherwise keep as empty state. |
| 데이터 준비 중 | Placeholder/hidden marker found in dashboard HTML. | Map to an existing summary endpoint if data exists; otherwise keep as empty state. |
| 데이터 준비 중 | Placeholder/hidden marker found in dashboard HTML. | Map to an existing summary endpoint if data exists; otherwise keep as empty state. |
| 데이터 준비 중 | Placeholder/hidden marker found in dashboard HTML. | Map to an existing summary endpoint if data exists; otherwise keep as empty state. |
| 데이터 준비 중 | Placeholder/hidden marker found in dashboard HTML. | Map to an existing summary endpoint if data exists; otherwise keep as empty state. |
| 데이터 준비 중 | Placeholder/hidden marker found in dashboard HTML. | Map to an existing summary endpoint if data exists; otherwise keep as empty state. |
| 데이터 준비 중 | Placeholder/hidden marker found in dashboard HTML. | Map to an existing summary endpoint if data exists; otherwise keep as empty state. |
| 데이터 준비 중 | Placeholder/hidden marker found in dashboard HTML. | Map to an existing summary endpoint if data exists; otherwise keep as empty state. |
| 데이터 준비 중 | Placeholder/hidden marker found in dashboard HTML. | Map to an existing summary endpoint if data exists; otherwise keep as empty state. |
| 데이터 준비 중 | Placeholder/hidden marker found in dashboard HTML. | Map to an existing summary endpoint if data exists; otherwise keep as empty state. |
| 데이터 준비 중 | Placeholder/hidden marker found in dashboard HTML. | Map to an existing summary endpoint if data exists; otherwise keep as empty state. |
| 데이터 준비 중 | Placeholder/hidden marker found in dashboard HTML. | Map to an existing summary endpoint if data exists; otherwise keep as empty state. |
| 데이터 준비 중 | Placeholder/hidden marker found in dashboard HTML. | Map to an existing summary endpoint if data exists; otherwise keep as empty state. |
| 데이터 준비 중 | Placeholder/hidden marker found in dashboard HTML. | Map to an existing summary endpoint if data exists; otherwise keep as empty state. |
| 데이터 준비 중 | Placeholder/hidden marker found in dashboard HTML. | Map to an existing summary endpoint if data exists; otherwise keep as empty state. |
| 데이터 준비 중 | Placeholder/hidden marker found in dashboard HTML. | Map to an existing summary endpoint if data exists; otherwise keep as empty state. |
| 데이터 준비 중 | Placeholder/hidden marker found in dashboard HTML. | Map to an existing summary endpoint if data exists; otherwise keep as empty state. |
| 데이터 준비 중 | Placeholder/hidden marker found in dashboard HTML. | Map to an existing summary endpoint if data exists; otherwise keep as empty state. |
| 데이터 준비 중 | Placeholder/hidden marker found in dashboard HTML. | Map to an existing summary endpoint if data exists; otherwise keep as empty state. |
| 데이터 준비 중 | Placeholder/hidden marker found in dashboard HTML. | Map to an existing summary endpoint if data exists; otherwise keep as empty state. |
| 데이터 준비 중 | Placeholder/hidden marker found in dashboard HTML. | Map to an existing summary endpoint if data exists; otherwise keep as empty state. |
| 데이터 준비 중 | Placeholder/hidden marker found in dashboard HTML. | Map to an existing summary endpoint if data exists; otherwise keep as empty state. |
| 데이터 준비 중 | Placeholder/hidden marker found in dashboard HTML. | Map to an existing summary endpoint if data exists; otherwise keep as empty state. |
| 데이터 준비 중 | Placeholder/hidden marker found in dashboard HTML. | Map to an existing summary endpoint if data exists; otherwise keep as empty state. |
| 데이터 준비 중 | Placeholder/hidden marker found in dashboard HTML. | Map to an existing summary endpoint if data exists; otherwise keep as empty state. |
| 데이터 준비 중 | Placeholder/hidden marker found in dashboard HTML. | Map to an existing summary endpoint if data exists; otherwise keep as empty state. |
| 데이터 준비 중 | Placeholder/hidden marker found in dashboard HTML. | Map to an existing summary endpoint if data exists; otherwise keep as empty state. |
| 데이터 준비 중 | Placeholder/hidden marker found in dashboard HTML. | Map to an existing summary endpoint if data exists; otherwise keep as empty state. |
| 데이터 준비 중 | Placeholder/hidden marker found in dashboard HTML. | Map to an existing summary endpoint if data exists; otherwise keep as empty state. |
| 데이터 준비 중 | Placeholder/hidden marker found in dashboard HTML. | Map to an existing summary endpoint if data exists; otherwise keep as empty state. |
| 데이터 준비 중 | Placeholder/hidden marker found in dashboard HTML. | Map to an existing summary endpoint if data exists; otherwise keep as empty state. |
| 데이터 준비 중 | Placeholder/hidden marker found in dashboard HTML. | Map to an existing summary endpoint if data exists; otherwise keep as empty state. |
| 확인 중 | Placeholder/hidden marker found in dashboard HTML. | Map to an existing summary endpoint if data exists; otherwise keep as empty state. |
| 확인 중 | Placeholder/hidden marker found in dashboard HTML. | Map to an existing summary endpoint if data exists; otherwise keep as empty state. |
| 확인 중 | Placeholder/hidden marker found in dashboard HTML. | Map to an existing summary endpoint if data exists; otherwise keep as empty state. |
| 확인 중 | Placeholder/hidden marker found in dashboard HTML. | Map to an existing summary endpoint if data exists; otherwise keep as empty state. |
| 확인 중 | Placeholder/hidden marker found in dashboard HTML. | Map to an existing summary endpoint if data exists; otherwise keep as empty state. |
| 확인 중 | Placeholder/hidden marker found in dashboard HTML. | Map to an existing summary endpoint if data exists; otherwise keep as empty state. |
| 확인 중 | Placeholder/hidden marker found in dashboard HTML. | Map to an existing summary endpoint if data exists; otherwise keep as empty state. |
| 확인 중 | Placeholder/hidden marker found in dashboard HTML. | Map to an existing summary endpoint if data exists; otherwise keep as empty state. |
| 확인 중 | Placeholder/hidden marker found in dashboard HTML. | Map to an existing summary endpoint if data exists; otherwise keep as empty state. |
| 확인 중 | Placeholder/hidden marker found in dashboard HTML. | Map to an existing summary endpoint if data exists; otherwise keep as empty state. |
| 확인 중 | Placeholder/hidden marker found in dashboard HTML. | Map to an existing summary endpoint if data exists; otherwise keep as empty state. |
| 확인 중 | Placeholder/hidden marker found in dashboard HTML. | Map to an existing summary endpoint if data exists; otherwise keep as empty state. |
| 확인 중 | Placeholder/hidden marker found in dashboard HTML. | Map to an existing summary endpoint if data exists; otherwise keep as empty state. |
| 확인 중 | Placeholder/hidden marker found in dashboard HTML. | Map to an existing summary endpoint if data exists; otherwise keep as empty state. |
| 확인 중 | Placeholder/hidden marker found in dashboard HTML. | Map to an existing summary endpoint if data exists; otherwise keep as empty state. |
| 확인 중 | Placeholder/hidden marker found in dashboard HTML. | Map to an existing summary endpoint if data exists; otherwise keep as empty state. |
| 확인 중 | Placeholder/hidden marker found in dashboard HTML. | Map to an existing summary endpoint if data exists; otherwise keep as empty state. |
| 확인 중 | Placeholder/hidden marker found in dashboard HTML. | Map to an existing summary endpoint if data exists; otherwise keep as empty state. |
| 확인 중 | Placeholder/hidden marker found in dashboard HTML. | Map to an existing summary endpoint if data exists; otherwise keep as empty state. |
| 확인 중 | Placeholder/hidden marker found in dashboard HTML. | Map to an existing summary endpoint if data exists; otherwise keep as empty state. |
| 0건 | Placeholder/hidden marker found in dashboard HTML. | Map to an existing summary endpoint if data exists; otherwise keep as empty state. |
| 0건 | Placeholder/hidden marker found in dashboard HTML. | Map to an existing summary endpoint if data exists; otherwise keep as empty state. |
| 0건 | Placeholder/hidden marker found in dashboard HTML. | Map to an existing summary endpoint if data exists; otherwise keep as empty state. |
| 0건 | Placeholder/hidden marker found in dashboard HTML. | Map to an existing summary endpoint if data exists; otherwise keep as empty state. |
| 0건 | Placeholder/hidden marker found in dashboard HTML. | Map to an existing summary endpoint if data exists; otherwise keep as empty state. |
| 0건 | Placeholder/hidden marker found in dashboard HTML. | Map to an existing summary endpoint if data exists; otherwise keep as empty state. |
| 0건 | Placeholder/hidden marker found in dashboard HTML. | Map to an existing summary endpoint if data exists; otherwise keep as empty state. |

## Endpoint Classes

| Path | Class | Status | Records | Items | Size KB | Startup | Load |
| --- | --- | --- | --- | --- | --- | --- | --- |
| dashboard/api/agent-followup-queue.json | Fleet intelligence | OK | 31 | 31 | 221.9 | no | lazy |
| dashboard/api/alerts/latest.json | Core summary | OK | 3 | 3 | 313 | no | lazy |
| dashboard/api/alerts/sales-alerts.json | Core summary | OK | 3 | 3 | 313 | no | lazy |
| dashboard/api/all-collected-vessels-summary.json | Core summary | OK | 968 | 5 | 3.7 | no | lazy |
| dashboard/api/all-collected-vessels.json | Vessel detail | TOO_LARGE | 968 | 968 | 27858.5 | no | lazy |
| dashboard/api/anchorage-waiting-summary.json | Core summary | OK | 284 | 5 | 2.7 | no | lazy |
| dashboard/api/anchorage-waiting.json | Core summary | TOO_LARGE | 284 | 284 | 4033.4 | no | lazy |
| dashboard/api/arrival-pipeline-summary.json | Core summary | OK | 200 | 5 | 2.7 | no | lazy |
| dashboard/api/arrival-pipeline.json | Core summary | TOO_LARGE | 200 | 200 | 2904.3 | no | lazy |
| dashboard/api/aux/ais-dynamic-summary.json | Auxiliary source summary | OK | 20 | 0 | 3.1 | no | lazy |
| dashboard/api/aux/ais-info-summary.json | Auxiliary source summary | OK | 10 | 0 | 2.9 | no | lazy |
| dashboard/api/aux/berth-summary.json | Auxiliary source summary | OK | 30 | 0 | 5.2 | no | lazy |
| dashboard/api/aux/cache-status.json | Auxiliary source summary | OK | 6 | 6 | 5.4 | no | lazy |
| dashboard/api/aux/pilotage-summary.json | Auxiliary source summary | OK | 385 | 0 | 4.1 | no | lazy |
| dashboard/api/aux/source-csv-summary.json | Auxiliary source summary | OK | 0 | 0 | 1.9 | no | lazy |
| dashboard/api/aux/source-schedule.json | Auxiliary source summary | OK | 10 | 10 | 11.3 | no | lazy |
| dashboard/api/aux/vessel-spec-summary.json | Auxiliary source summary | OK | 1 | 0 | 3 | no | lazy |
| dashboard/api/backend-doctor.json | Core summary | OK | 0 | 0 | 2.2 | no | lazy |
| dashboard/api/backend-ops.json | Core summary | OK | 968 | 0 | 3 | no | lazy |
| dashboard/api/biofouling-timeline.json | Compliance / cleaning window | OK | 7 | 7 | 1.6 | no | lazy |
| dashboard/api/biofouling/brazil-compliance-risk.json | Compliance / cleaning window | EMPTY_VALID | 0 | 0 | 0.6 | no | lazy |
| dashboard/api/biofouling/hotspots.json | Compliance / cleaning window | EMPTY_VALID | 0 | 0 | 0.6 | no | lazy |
| dashboard/api/biofouling/port-risk-map.json | Port intelligence | OK | 13 | 13 | 72 | no | lazy |
| dashboard/api/biofouling/top-hull-cleaning-candidates.json | Compliance / cleaning window | OK | 10 | 10 | 77.8 | no | lazy |
| dashboard/api/biofouling/vessel-risk-scores-summary.json | Compliance / cleaning window | OK | 100 | 5 | 3 | no | lazy |
| dashboard/api/biofouling/vessel-risk-scores.json | Compliance / cleaning window | TOO_LARGE | 100 | 100 | 767.8 | no | lazy |
| dashboard/api/bootstrap.json | Core summary | OK | 29 | 9 | 185.4 | no | lazy |
| dashboard/api/candidate-audit.json | Diagnostic | OK | 0 | 0 | 0.2 | no | lazy |
| dashboard/api/candidate-changes.json | Core summary | STALE | 0 | 0 | 0.4 | no | lazy |
| dashboard/api/candidate-confidence-runtime.json | Core summary | OK | 0 | 0 | 0.2 | no | lazy |
| dashboard/api/candidate-dedupe.json | Core summary | OK | 0 | 0 | 0.4 | no | lazy |
| dashboard/api/candidate-explanations.json | Core summary | OK | 0 | 0 | 0.1 | no | lazy |
| dashboard/api/candidate-summary.json | Core summary | OK | 0 | 0 | 12.2 | no | lazy |
| dashboard/api/candidates-summary.json | Core summary | OK | 31 | 5 | 3.8 | no | lazy |
| dashboard/api/candidates.json | Core summary | TOO_LARGE | 31 | 31 | 961.1 | no | lazy |
| dashboard/api/candidates/top-summary.json | Core summary | OK | 50 | 5 | 3.6 | no | lazy |
| dashboard/api/candidates/top.json | Core summary | TOO_LARGE | 50 | 50 | 1792.4 | no | lazy |
| dashboard/api/changes.json | Core summary | OK | 0 | 0 | 0.3 | no | lazy |
| dashboard/api/collector-plan-runtime.json | Core summary | OK | 0 | 0 | 4.1 | no | lazy |
| dashboard/api/commercial-command-center-summary.json | Core summary | EMPTY_VALID | 0 | 0 | 0.7 | no | lazy |
| dashboard/api/commercial-command-center.json | Core summary | TOO_LARGE | 0 | 0 | 674 | no | lazy |
| dashboard/api/congestion-watchlist.json | Core summary | OK | 21 | 21 | 139.7 | no | lazy |
| dashboard/api/contact-queue.json | Contact / memory | OK | 31 | 31 | 32.6 | no | lazy |
| dashboard/api/contact-ready-vessels.json | Vessel detail | OK | 19 | 19 | 42.6 | no | lazy |
| dashboard/api/contact-windows.json | Contact / memory | OK | 0 | 0 | 0.2 | no | lazy |
| dashboard/api/continuity.json | Core summary | OK | 968 | 1 | 5.6 | no | diagnostic_only |
| dashboard/api/coverage-audit.json | Diagnostic | STALE | 0 | 0 | 3.3 | no | lazy |
| dashboard/api/coverage-registry.json | Core summary | OK | 31 | 13 | 6.2 | no | lazy |
| dashboard/api/daily-candidate-report-runtime.json | Port intelligence | OK | 0 | 0 | 0.1 | no | lazy |
| dashboard/api/daily-enrichment-runtime.json | Enrichment | STALE | 0 | 0 | 1.4 | no | lazy |
| dashboard/api/dashboard-summary.json | Core summary | OK | 31 | 8 | 354.1 | no | lazy |
| dashboard/api/data-continuity.json | Core summary | OK | 968 | 0 | 3.3 | no | diagnostic_only |
| dashboard/api/db-cleanup-plan.json | Diagnostic | OK | 0 | 0 | 44.1 | no | diagnostic_only |
| dashboard/api/debug/agent-followup-queue.json | Fleet intelligence | EMPTY_VALID | 0 | 0 | 0.3 | no | diagnostic_only |
| dashboard/api/debug/alerts/latest.json | Diagnostic | OK | 1 | 1 | 2 | no | diagnostic_only |
| dashboard/api/debug/alerts/sales-alerts.json | Diagnostic | OK | 1 | 1 | 2 | no | diagnostic_only |
| dashboard/api/debug/all-collected-vessels-summary.json | Diagnostic | EMPTY_VALID | 0 | 0 | 0.5 | no | diagnostic_only |
| dashboard/api/debug/all-collected-vessels.json | Vessel detail | EMPTY_VALID | 0 | 0 | 0.7 | no | diagnostic_only |
| dashboard/api/debug/anchorage-waiting-summary.json | Diagnostic | EMPTY_VALID | 0 | 0 | 0.5 | no | diagnostic_only |
| dashboard/api/debug/anchorage-waiting.json | Diagnostic | EMPTY_VALID | 0 | 0 | 0.3 | no | diagnostic_only |
| dashboard/api/debug/arrival-pipeline-summary.json | Diagnostic | EMPTY_VALID | 0 | 0 | 0.5 | no | diagnostic_only |
| dashboard/api/debug/arrival-pipeline.json | Diagnostic | EMPTY_VALID | 0 | 0 | 0.3 | no | diagnostic_only |
| dashboard/api/debug/aux/ais-dynamic-summary.json | Auxiliary source summary | OK | 0 | 0 | 2.3 | no | diagnostic_only |
| dashboard/api/debug/aux/ais-info-summary.json | Auxiliary source summary | OK | 0 | 0 | 2.3 | no | diagnostic_only |
| dashboard/api/debug/aux/berth-summary.json | Auxiliary source summary | OK | 0 | 0 | 2.3 | no | diagnostic_only |
| dashboard/api/debug/aux/cache-status.json | Auxiliary source summary | OK | 6 | 6 | 5.6 | no | diagnostic_only |
| dashboard/api/debug/aux/pilotage-summary.json | Auxiliary source summary | OK | 0 | 0 | 2.5 | no | diagnostic_only |
| dashboard/api/debug/aux/source-csv-summary.json | Auxiliary source summary | OK | 0 | 0 | 1.5 | no | diagnostic_only |
| dashboard/api/debug/aux/source-schedule.json | Auxiliary source summary | OK | 10 | 10 | 11.3 | no | diagnostic_only |
| dashboard/api/debug/aux/vessel-spec-summary.json | Auxiliary source summary | OK | 0 | 0 | 2.2 | no | diagnostic_only |
| dashboard/api/debug/backend-ops.json | Diagnostic | OK | 0 | 0 | 2.8 | no | diagnostic_only |
| dashboard/api/debug/biofouling-timeline.json | Compliance / cleaning window | OK | 7 | 7 | 1.5 | no | diagnostic_only |
| dashboard/api/debug/biofouling/brazil-compliance-risk.json | Compliance / cleaning window | EMPTY_VALID | 0 | 0 | 0.6 | no | diagnostic_only |
| dashboard/api/debug/biofouling/hotspots.json | Compliance / cleaning window | EMPTY_VALID | 0 | 0 | 0.6 | no | diagnostic_only |
| dashboard/api/debug/biofouling/port-risk-map.json | Port intelligence | OK | 13 | 13 | 98.4 | no | diagnostic_only |
| dashboard/api/debug/biofouling/top-hull-cleaning-candidates.json | Compliance / cleaning window | EMPTY_VALID | 0 | 0 | 0.6 | no | diagnostic_only |
| dashboard/api/debug/biofouling/vessel-risk-scores-summary.json | Compliance / cleaning window | EMPTY_VALID | 0 | 0 | 0.5 | no | diagnostic_only |
| dashboard/api/debug/biofouling/vessel-risk-scores.json | Compliance / cleaning window | EMPTY_VALID | 0 | 0 | 0.6 | no | diagnostic_only |
| dashboard/api/debug/bootstrap.json | Diagnostic | EMPTY_VALID | 0 | 0 | 14.6 | no | diagnostic_only |
| dashboard/api/debug/candidate-changes.json | Diagnostic | OK | 0 | 0 | 0.4 | no | diagnostic_only |
| dashboard/api/debug/candidate-summary.json | Diagnostic | OK | 0 | 0 | 0.3 | no | diagnostic_only |
| dashboard/api/debug/candidates-summary.json | Diagnostic | EMPTY_VALID | 0 | 0 | 0.5 | no | diagnostic_only |
| dashboard/api/debug/candidates.json | Diagnostic | EMPTY_VALID | 0 | 0 | 0.7 | no | diagnostic_only |
| dashboard/api/debug/candidates/top-summary.json | Diagnostic | EMPTY_VALID | 0 | 0 | 0.5 | no | diagnostic_only |
| dashboard/api/debug/candidates/top.json | Diagnostic | EMPTY_VALID | 0 | 0 | 0.5 | no | diagnostic_only |
| dashboard/api/debug/changes.json | Diagnostic | OK | 0 | 0 | 0.2 | no | diagnostic_only |
| dashboard/api/debug/collector-plan-runtime.json | Diagnostic | OK | 0 | 0 | 4.1 | no | diagnostic_only |
| dashboard/api/debug/commercial-command-center-summary.json | Diagnostic | EMPTY_VALID | 0 | 0 | 0.5 | no | diagnostic_only |
| dashboard/api/debug/commercial-command-center.json | Diagnostic | OK | 0 | 0 | 0.4 | no | diagnostic_only |
| dashboard/api/debug/congestion-watchlist.json | Diagnostic | EMPTY_VALID | 0 | 0 | 0.2 | no | diagnostic_only |
| dashboard/api/debug/contact-queue.json | Contact / memory | EMPTY_VALID | 0 | 0 | 0.1 | no | diagnostic_only |
| dashboard/api/debug/contact-ready-vessels.json | Vessel detail | EMPTY_VALID | 0 | 0 | 0.1 | no | diagnostic_only |
| dashboard/api/debug/continuity.json | Diagnostic | EMPTY_VALID | 0 | 1 | 3.6 | no | diagnostic_only |
| dashboard/api/debug/coverage-registry.json | Diagnostic | EMPTY_VALID | 0 | 0 | 1.8 | no | diagnostic_only |
| dashboard/api/debug/dashboard-summary.json | Diagnostic | EMPTY_VALID | 0 | 0 | 129.5 | no | diagnostic_only |
| dashboard/api/debug/data-continuity.json | Diagnostic | OK | 0 | 0 | 2.4 | no | diagnostic_only |
| dashboard/api/debug/enrichment-utilization.json | Enrichment | OK | 7 | 7 | 8.1 | no | diagnostic_only |
| dashboard/api/debug/enrichment/applied.json | Enrichment | EMPTY_VALID | 0 | 0 | 0.2 | no | diagnostic_only |
| dashboard/api/debug/enrichment/candidates.json | Enrichment | EMPTY_VALID | 0 | 0 | 0.2 | no | diagnostic_only |
| dashboard/api/debug/enrichment/review-queue.json | Enrichment | EMPTY_VALID | 0 | 0 | 0.2 | no | diagnostic_only |
| dashboard/api/debug/enrichment/source-capability-matrix.json | Enrichment | OK | 11 | 11 | 18.5 | no | diagnostic_only |
| dashboard/api/debug/enrichment/summary.json | Enrichment | OK | 0 | 0 | 0.4 | no | diagnostic_only |
| dashboard/api/debug/fleet-opportunities.json | Fleet intelligence | EMPTY_VALID | 0 | 0 | 0.1 | no | diagnostic_only |
| dashboard/api/debug/health.json | Diagnostic | OK | 0 | 0 | 1.5 | no | diagnostic_only |
| dashboard/api/debug/health/pipeline.json | Diagnostic | OK | 0 | 0 | 1.5 | no | diagnostic_only |
| dashboard/api/debug/high-value-low-confidence.json | Diagnostic | EMPTY_VALID | 0 | 0 | 0.1 | no | diagnostic_only |
| dashboard/api/debug/high-value-targets.json | Diagnostic | EMPTY_VALID | 0 | 0 | 0.1 | no | diagnostic_only |
| dashboard/api/debug/hot-candidates.json | Diagnostic | EMPTY_VALID | 0 | 0 | 0.1 | no | diagnostic_only |
| dashboard/api/debug/hot-vessels-summary.json | Diagnostic | EMPTY_VALID | 0 | 0 | 0.5 | no | diagnostic_only |
| dashboard/api/debug/hot-vessels.json | Vessel detail | EMPTY_VALID | 0 | 0 | 0.1 | no | diagnostic_only |
| dashboard/api/debug/imo-recovery-priority.json | Diagnostic | EMPTY_VALID | 0 | 0 | 0.1 | no | diagnostic_only |
| dashboard/api/debug/imo-recovery-queue.json | Diagnostic | EMPTY_VALID | 0 | 0 | 0.1 | no | diagnostic_only |
| dashboard/api/debug/intelligence/agent-intelligence.json | Fleet intelligence | EMPTY_VALID | 0 | 0 | 0.3 | no | diagnostic_only |
| dashboard/api/debug/intelligence/agent-relationship.json | Fleet intelligence | EMPTY_VALID | 0 | 0 | 0.4 | no | diagnostic_only |
| dashboard/api/debug/intelligence/agent-summary.json | Fleet intelligence | EMPTY_VALID | 0 | 0 | 0.3 | no | diagnostic_only |
| dashboard/api/debug/intelligence/biofouling-risk.json | Compliance / cleaning window | EMPTY_VALID | 0 | 0 | 0.4 | no | diagnostic_only |
| dashboard/api/debug/intelligence/cleaning-window.json | Compliance / cleaning window | EMPTY_VALID | 0 | 0 | 0.3 | no | diagnostic_only |
| dashboard/api/debug/intelligence/commercial-summary.json | Diagnostic | EMPTY_VALID | 0 | 0 | 0.3 | no | diagnostic_only |
| dashboard/api/debug/intelligence/compliance-exposure.json | Compliance / cleaning window | EMPTY_VALID | 0 | 0 | 0.4 | no | diagnostic_only |
| dashboard/api/debug/intelligence/compliance-opportunities.json | Compliance / cleaning window | EMPTY_VALID | 0 | 0 | 0.3 | no | diagnostic_only |
| dashboard/api/debug/intelligence/contact-coverage-summary.json | Contact / memory | OK | 32 | 5 | 6.3 | no | diagnostic_only |
| dashboard/api/debug/intelligence/contact-coverage.json | Contact / memory | OK | 32 | 32 | 331 | no | diagnostic_only |
| dashboard/api/debug/intelligence/customer-memory.json | Contact / memory | EMPTY_VALID | 0 | 0 | 0.6 | no | diagnostic_only |
| dashboard/api/debug/intelligence/drydock-prediction.json | Diagnostic | EMPTY_VALID | 0 | 0 | 0.4 | no | diagnostic_only |
| dashboard/api/debug/intelligence/explainability.json | Diagnostic | EMPTY_VALID | 0 | 0 | 0.4 | no | diagnostic_only |
| dashboard/api/debug/intelligence/fleet-clusters.json | Fleet intelligence | EMPTY_VALID | 0 | 0 | 0.3 | no | diagnostic_only |
| dashboard/api/debug/intelligence/fleet-dna.json | Fleet intelligence | EMPTY_VALID | 0 | 0 | 0.3 | no | diagnostic_only |
| dashboard/api/debug/intelligence/fleet-expansion.json | Fleet intelligence | EMPTY_VALID | 0 | 0 | 0.3 | no | diagnostic_only |
| dashboard/api/debug/intelligence/fleet-gap-finder.json | Fleet intelligence | EMPTY_VALID | 0 | 0 | 0.9 | no | diagnostic_only |
| dashboard/api/debug/intelligence/fleet-heatmap.json | Fleet intelligence | EMPTY_VALID | 0 | 0 | 0.2 | no | diagnostic_only |
| dashboard/api/debug/intelligence/fleet-intelligence.json | Fleet intelligence | EMPTY_VALID | 0 | 0 | 0.4 | no | diagnostic_only |
| dashboard/api/debug/intelligence/fleet-memory.json | Fleet intelligence | EMPTY_VALID | 0 | 0 | 0.3 | no | diagnostic_only |
| dashboard/api/debug/intelligence/fleet-penetration.json | Fleet intelligence | EMPTY_VALID | 0 | 0 | 1 | no | diagnostic_only |
| dashboard/api/debug/intelligence/fleet-summary.json | Fleet intelligence | EMPTY_VALID | 0 | 0 | 0.4 | no | diagnostic_only |
| dashboard/api/debug/intelligence/hull-cleaning-engine.json | Compliance / cleaning window | EMPTY_VALID | 0 | 0 | 1 | no | diagnostic_only |
| dashboard/api/debug/intelligence/korea-presence.json | Diagnostic | EMPTY_VALID | 0 | 0 | 0.2 | no | diagnostic_only |
| dashboard/api/debug/intelligence/lost-opportunity-reasons.json | Diagnostic | EMPTY_VALID | 0 | 0 | 0.8 | no | diagnostic_only |
| dashboard/api/debug/intelligence/missed-opportunities.json | Diagnostic | EMPTY_VALID | 0 | 0 | 0.3 | no | diagnostic_only |
| dashboard/api/debug/intelligence/operator-opportunities.json | Fleet intelligence | EMPTY_VALID | 0 | 0 | 0.3 | no | diagnostic_only |
| dashboard/api/debug/intelligence/operator-summary.json | Fleet intelligence | EMPTY_VALID | 0 | 0 | 0.3 | no | diagnostic_only |
| dashboard/api/debug/intelligence/opportunity-decay.json | Diagnostic | EMPTY_VALID | 0 | 0 | 0.3 | no | diagnostic_only |
| dashboard/api/debug/intelligence/opportunity-memory.json | Contact / memory | EMPTY_VALID | 0 | 0 | 0.8 | no | diagnostic_only |
| dashboard/api/debug/intelligence/port-demand-radar.json | Port intelligence | EMPTY_VALID | 0 | 0 | 0.3 | no | diagnostic_only |
| dashboard/api/debug/intelligence/port-dna.json | Port intelligence | OK | 10 | 10 | 76.5 | no | diagnostic_only |
| dashboard/api/debug/intelligence/port-opportunities.json | Port intelligence | EMPTY_VALID | 0 | 0 | 0.3 | no | diagnostic_only |
| dashboard/api/debug/intelligence/port-seasonality.json | Port intelligence | EMPTY_VALID | 0 | 0 | 0.2 | no | diagnostic_only |
| dashboard/api/debug/intelligence/prediction-summary.json | Diagnostic | EMPTY_VALID | 0 | 0 | 0.4 | no | diagnostic_only |
| dashboard/api/debug/intelligence/relationship-intelligence.json | Contact / memory | EMPTY_VALID | 0 | 0 | 0.3 | no | diagnostic_only |
| dashboard/api/debug/intelligence/repeat-callers.json | Diagnostic | EMPTY_VALID | 0 | 0 | 0.4 | no | diagnostic_only |
| dashboard/api/debug/intelligence/revenue-forecast.json | Revenue intelligence | OK | 1 | 1 | 4.5 | no | diagnostic_only |
| dashboard/api/debug/intelligence/risk-summary.json | Compliance / cleaning window | EMPTY_VALID | 0 | 0 | 0.3 | no | diagnostic_only |
| dashboard/api/debug/intelligence/route-summary.json | Diagnostic | EMPTY_VALID | 0 | 0 | 0.3 | no | diagnostic_only |
| dashboard/api/debug/intelligence/sales-priority.json | Diagnostic | EMPTY_VALID | 0 | 0 | 0.5 | no | diagnostic_only |
| dashboard/api/debug/intelligence/service-bundles.json | Diagnostic | EMPTY_VALID | 0 | 0 | 0.8 | no | diagnostic_only |
| dashboard/api/debug/intelligence/superintendent-targets.json | Diagnostic | EMPTY_VALID | 0 | 0 | 0.3 | no | diagnostic_only |
| dashboard/api/debug/intelligence/vessel-timeline.json | Diagnostic | EMPTY_VALID | 0 | 0 | 0.3 | no | diagnostic_only |
| dashboard/api/debug/intelligence/win-probability.json | Diagnostic | EMPTY_VALID | 0 | 0 | 0.4 | no | diagnostic_only |
| dashboard/api/debug/ocean-conditions.json | Diagnostic | OK | 12 | 12 | 8.6 | no | diagnostic_only |
| dashboard/api/debug/port-congestion-heatmap.json | Port intelligence | EMPTY_VALID | 0 | 0 | 0.1 | no | diagnostic_only |
| dashboard/api/debug/port-opportunities.json | Port intelligence | EMPTY_VALID | 0 | 0 | 0.1 | no | diagnostic_only |
