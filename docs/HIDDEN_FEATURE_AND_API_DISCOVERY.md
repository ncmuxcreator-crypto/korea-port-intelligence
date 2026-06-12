# Hidden Feature and API Discovery

Generated at: 2026-06-12T17:45:09.197Z
Run id: run_20260612173949259_4818cb4a

## Summary

| Metric | Value |
| --- | --- |
| Feature count | 51 |
| Endpoint count | 63 |
| Hidden feature count | 20 |
| Partial API/source count | 13 |
| Discussed but not implemented count | 11 |

## Feature Inventory

| Feature | Area | Status | Records | Visibility | Endpoints | Next Action |
| --- | --- | --- | --- | --- | --- | --- |
| 오늘의 영업 액션 | 영업 실행 | ACTIVE_VISIBLE | 346 | VISIBLE_OR_REFERENCED | dashboard/api/sales/actions-summary.json, dashboard/api/sales/actions.json, dashboard/api/sales/verification-queue-summary.json | Keep monitored by audit commands. |
| 영업 전환 파이프라인 | 영업 실행 | ACTIVE_VISIBLE | 32 | VISIBLE_OR_REFERENCED | dashboard/api/sales/conversion-pipeline.json | Keep monitored by audit commands. |
| 견적 기회 빌더 | 영업 실행 | ACTIVE_VISIBLE | 35 | VISIBLE_OR_REFERENCED | dashboard/api/sales/quote-opportunities.json | Keep monitored by audit commands. |
| 관심 선박 | 영업 실행 | ACTIVE_VISIBLE | 20 | VISIBLE_OR_REFERENCED | dashboard/api/watchlist/current.json | Keep monitored by audit commands. |
| 영업 대상 카테고리 | 영업 실행 | ACTIVE_VISIBLE | 128 | VISIBLE_OR_REFERENCED | dashboard/api/targets/current-summary.json, dashboard/api/targets/current.json, dashboard/api/targets/categories-summary.json | Keep monitored by audit commands. |
| 전체 선박 페이지 | 선박 인텔리전스 | ACTIVE_VISIBLE | 1338 | VISIBLE_OR_REFERENCED | dashboard/api/vessels/index.json, dashboard/api/vessels/page-1.json | Keep monitored by audit commands. |
| 입항 예정 | 선박 인텔리전스 | DISCUSSED_NOT_IMPLEMENTED | 0 | NOT_VISIBLE | - | Confirm requirement before implementation. |
| 묘박/대기 | 선박 인텔리전스 | DISCUSSED_NOT_IMPLEMENTED | 0 | NOT_VISIBLE | - | Confirm requirement before implementation. |
| 장기 체류 | 선박 인텔리전스 | DISCUSSED_NOT_IMPLEMENTED | 0 | VISIBLE_OR_REFERENCED | - | Confirm requirement before implementation. |
| 부착생물 위험 | 선박 인텔리전스 | DISCUSSED_NOT_IMPLEMENTED | 0 | VISIBLE_OR_REFERENCED | - | Confirm requirement before implementation. |
| 클리닝 적기 | 선박 인텔리전스 | DEVELOPED_HIDDEN | 10 | HIDDEN_OR_LAZY | dashboard/api/intelligence/cleaning-window.json | Reconnect existing summary endpoint to a collapsed or lazy UI section. |
| Compliance 노출도 | 선박 인텔리전스 | ACTIVE_VISIBLE | 6 | VISIBLE_OR_REFERENCED | dashboard/api/intelligence/compliance-exposure.json | Keep monitored by audit commands. |
| 반복 영업 기회 | 영업 실행 | DEVELOPED_HIDDEN | 10 | HIDDEN_OR_LAZY | dashboard/api/intelligence/opportunity-memory.json | Reconnect existing summary endpoint to a collapsed or lazy UI section. |
| 선대 인텔리전스 | 항만·선대 인텔리전스 | ACTIVE_VISIBLE | 3 | VISIBLE_OR_REFERENCED | dashboard/api/intelligence/fleet-intelligence.json | Keep monitored by audit commands. |
| 선대 침투율 | 항만·선대 인텔리전스 | ACTIVE_VISIBLE | 3 | VISIBLE_OR_REFERENCED | dashboard/api/intelligence/fleet-penetration.json | Keep monitored by audit commands. |
| 선대 기회 갭 | 항만·선대 인텔리전스 | DISCUSSED_NOT_IMPLEMENTED | 0 | VISIBLE_OR_REFERENCED | - | Confirm requirement before implementation. |
| 선대 DNA | 항만·선대 인텔리전스 | DISCUSSED_NOT_IMPLEMENTED | 0 | VISIBLE_OR_REFERENCED | - | Confirm requirement before implementation. |
| 에이전트 인텔리전스 | 항만·선대 인텔리전스 | DISCUSSED_NOT_IMPLEMENTED | 0 | NOT_VISIBLE | - | Confirm requirement before implementation. |
| 예상 매출 기회 | 항만·선대 인텔리전스 | ACTIVE_VISIBLE | 1 | VISIBLE_OR_REFERENCED | dashboard/api/intelligence/revenue-forecast.json | Keep monitored by audit commands. |
| 항만 DNA | 항만·선대 인텔리전스 | ACTIVE_VISIBLE | 10 | VISIBLE_OR_REFERENCED | dashboard/api/intelligence/port-dna.json | Keep monitored by audit commands. |
| 항만 수요 레이더 | 항만·선대 인텔리전스 | DISCUSSED_NOT_IMPLEMENTED | 0 | VISIBLE_OR_REFERENCED | - | Confirm requirement before implementation. |
| 항만 계절성 | 항만·선대 인텔리전스 | DISCUSSED_NOT_IMPLEMENTED | 0 | VISIBLE_OR_REFERENCED | - | Confirm requirement before implementation. |
| Source Data Enrichment | 데이터 소스·Enrichment | DISCUSSED_NOT_IMPLEMENTED | 0 | NOT_VISIBLE | - | Confirm requirement before implementation. |
| Source Quality Score | 데이터 소스·Enrichment | DEVELOPED_HIDDEN | 7 | HIDDEN_OR_LAZY | dashboard/api/source-quality-score.json | Reconnect existing summary endpoint to a collapsed or lazy UI section. |
| Source Capability Matrix | 데이터 소스·Enrichment | DISCUSSED_NOT_IMPLEMENTED | 0 | NOT_VISIBLE | - | Confirm requirement before implementation. |
| 보조 소스 활용률 | 데이터 소스·Enrichment | ACTIVE_VISIBLE | 7 | VISIBLE_OR_REFERENCED | dashboard/api/enrichment-utilization.json | Keep monitored by audit commands. |
| Auxiliary Source Cache | 데이터 소스·Enrichment | DEVELOPED_HIDDEN | 6 | HIDDEN_OR_LAZY | dashboard/api/aux/cache-status.json | Reconnect existing summary endpoint to a collapsed or lazy UI section. |
| Auxiliary Source Schedule | 데이터 소스·Enrichment | DEVELOPED_HIDDEN | 10 | HIDDEN_OR_LAZY | dashboard/api/aux/source-schedule.json | Reconnect existing summary endpoint to a collapsed or lazy UI section. |
| DB Cleanup Plan | 시스템 진단 | DEVELOPED_HIDDEN | 5 | HIDDEN_OR_LAZY | dashboard/api/storage-efficiency-report.json, dashboard/api/db-cleanup-plan.json | Reconnect existing summary endpoint to a collapsed or lazy UI section. |
| 데이터 품질·시스템 진단 | 시스템 진단 | ACTIVE_VISIBLE | 89 | VISIBLE_OR_REFERENCED | dashboard/api/status-summary.json, dashboard/api/status.json, dashboard/api/aux/cache-status.json | Keep monitored by audit commands. |
| bootstrap | 요약 / 현황판 | ENDPOINT_EXISTS_UI_MISSING | 32 | HIDDEN_OR_LAZY | dashboard/api/bootstrap.json | Reconnect existing summary endpoint to a collapsed or lazy UI section. |
| vessel.countReconciliation | 요약 / 현황판 | ENDPOINT_EXISTS_UI_MISSING | 1014 | HIDDEN_OR_LAZY | dashboard/api/vessel-count-reconciliation.json | Reconnect existing summary endpoint to a collapsed or lazy UI section. |
| ports | 항만·선대 인텔리전스 | ENDPOINT_EXISTS_UI_MISSING | 8 | HIDDEN_OR_LAZY | dashboard/api/ports.json | Reconnect existing summary endpoint to a collapsed or lazy UI section. |
| candidates.topSummary | 요약 / 현황판 | ENDPOINT_EXISTS_UI_MISSING | 50 | HIDDEN_OR_LAZY | dashboard/api/candidates/top-summary.json | Reconnect existing summary endpoint to a collapsed or lazy UI section. |
| candidates.top | 요약 / 현황판 | TOO_HEAVY_NEEDS_SUMMARY | 50 | HIDDEN_OR_LAZY | dashboard/api/candidates/top.json | Use summary endpoint first and lazy-load detail only on demand. |
| dashboard-summary | 요약 / 현황판 | ENDPOINT_EXISTS_UI_MISSING | 32 | HIDDEN_OR_LAZY | dashboard/api/dashboard-summary.json | Reconnect existing summary endpoint to a collapsed or lazy UI section. |
| enrichment.sourceCsvDryRun | 요약 / 현황판 | ENDPOINT_EXISTS_UI_MISSING | 1 | HIDDEN_OR_LAZY | dashboard/api/enrichment/source-csv-dry-run.json | Reconnect existing summary endpoint to a collapsed or lazy UI section. |
| aux.aisDynamicSummary | 요약 / 현황판 | ENDPOINT_EXISTS_UI_MISSING | 10 | HIDDEN_OR_LAZY | dashboard/api/aux/ais-dynamic-summary.json | Reconnect existing summary endpoint to a collapsed or lazy UI section. |
| aux.latestIndex | 요약 / 현황판 | ENDPOINT_EXISTS_UI_MISSING | 6 | HIDDEN_OR_LAZY | dashboard/api/aux/latest/index.json | Reconnect existing summary endpoint to a collapsed or lazy UI section. |
| aux.latestPilotage | 요약 / 현황판 | ENDPOINT_EXISTS_UI_MISSING | 361 | HIDDEN_OR_LAZY | dashboard/api/aux/latest/pilotage-summary.json | Reconnect existing summary endpoint to a collapsed or lazy UI section. |
| aux.latestBerth | 요약 / 현황판 | ENDPOINT_EXISTS_UI_MISSING | 31 | HIDDEN_OR_LAZY | dashboard/api/aux/latest/berth-summary.json | Reconnect existing summary endpoint to a collapsed or lazy UI section. |
| aux.latestAisInfo | 요약 / 현황판 | ENDPOINT_EXISTS_UI_MISSING | 10 | HIDDEN_OR_LAZY | dashboard/api/aux/latest/ais-info-summary.json | Reconnect existing summary endpoint to a collapsed or lazy UI section. |
| aux.latestAisDynamic | 요약 / 현황판 | ENDPOINT_EXISTS_UI_MISSING | 10 | HIDDEN_OR_LAZY | dashboard/api/aux/latest/ais-dynamic-summary.json | Reconnect existing summary endpoint to a collapsed or lazy UI section. |
| source.healthRuntime | 시스템 진단 | TECHNICAL_DIAGNOSTIC_ONLY | 24 | DIAGNOSTIC_ONLY | dashboard/api/source-health-runtime.json | Confirm requirement before implementation. |
| enrichment.latestSummary | 요약 / 현황판 | ENDPOINT_EXISTS_UI_MISSING | 10817 | HIDDEN_OR_LAZY | dashboard/api/enrichment/latest/summary.json | Reconnect existing summary endpoint to a collapsed or lazy UI section. |
| enrichment.latestCandidates | 요약 / 현황판 | TOO_HEAVY_NEEDS_SUMMARY | 10817 | HIDDEN_OR_LAZY | dashboard/api/enrichment/latest/candidates.json | Use summary endpoint first and lazy-load detail only on demand. |
| enrichment.latestApplied | 요약 / 현황판 | TOO_HEAVY_NEEDS_SUMMARY | 4295 | HIDDEN_OR_LAZY | dashboard/api/enrichment/latest/applied.json | Use summary endpoint first and lazy-load detail only on demand. |
| enrichment.latestReviewQueue | 요약 / 현황판 | TOO_HEAVY_NEEDS_SUMMARY | 6522 | HIDDEN_OR_LAZY | dashboard/api/enrichment/latest/review-queue.json | Use summary endpoint first and lazy-load detail only on demand. |
| enrichment.latestPatches | 요약 / 현황판 | TOO_HEAVY_NEEDS_SUMMARY | 4295 | HIDDEN_OR_LAZY | dashboard/api/enrichment/latest/patches.json | Use summary endpoint first and lazy-load detail only on demand. |
| intelligence.contactCoverageSummary | 요약 / 현황판 | ENDPOINT_EXISTS_UI_MISSING | 100 | HIDDEN_OR_LAZY | dashboard/api/intelligence/contact-coverage-summary.json | Reconnect existing summary endpoint to a collapsed or lazy UI section. |
| intelligence.contactCoverage | 요약 / 현황판 | TOO_HEAVY_NEEDS_SUMMARY | 100 | HIDDEN_OR_LAZY | dashboard/api/intelligence/contact-coverage.json | Use summary endpoint first and lazy-load detail only on demand. |

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
| dashboard/api/bootstrap.json | Core summary | OK | 32 | 8 | 143.1 | yes | initial |
| dashboard/api/status-summary.json | Diagnostic | OK | 32 | 0 | 3.7 | yes | initial |
| dashboard/api/vessel-count-reconciliation.json | Core summary | OK | 1014 | 0 | 6.3 | yes | initial |
| dashboard/api/vessels/index.json | Vessel detail | OK | 669 | 0 | 1.2 | yes | initial |
| dashboard/api/ports.json | Port intelligence | OK | 8 | 8 | 8.4 | yes | initial |
| dashboard/api/candidates/top-summary.json | Core summary | OK | 50 | 5 | 7.4 | no | lazy |
| dashboard/api/candidates/top.json | Core summary | TOO_LARGE | 50 | 50 | 2449.6 | no | lazy |
| dashboard/api/status.json | Diagnostic | TOO_LARGE | 32 | 8 | 1786.4 | no | diagnostic_only |
| dashboard/api/dashboard-summary.json | Core summary | OK | 32 | 8 | 250.6 | no | lazy |
| dashboard/api/sales/actions-summary.json | Sales action | OK | 62 | 5 | 7 | no | lazy |
| dashboard/api/sales/actions.json | Sales action | TOO_LARGE | 62 | 62 | 950.7 | no | lazy |
| dashboard/api/sales/conversion-pipeline.json | Sales action | OK | 32 | 32 | 468.8 | no | lazy |
| dashboard/api/sales/quote-opportunities.json | Sales action | TOO_LARGE | 35 | 35 | 589.6 | no | lazy |
| dashboard/api/sales/verification-queue-summary.json | Sales action | OK | 111 | 5 | 7 | yes | initial |
| dashboard/api/sales/verification-queue.json | Sales action | TOO_LARGE | 111 | 111 | 1466.1 | no | lazy |
| dashboard/api/watchlist/current.json | Watchlist | OK | 20 | 20 | 270.1 | no | lazy |
| dashboard/api/targets/current-summary.json | Targeting | OK | 32 | 5 | 6.9 | no | lazy |
| dashboard/api/targets/current.json | Targeting | TOO_LARGE | 32 | 32 | 828.5 | no | lazy |
| dashboard/api/targets/categories-summary.json | Targeting | OK | 32 | 10 | 48.1 | yes | initial |
| dashboard/api/targets/categories.json | Targeting | TOO_LARGE | 32 | 10 | 4916.6 | no | lazy |
| dashboard/api/vessels/page-1.json | Vessel detail | OK | 669 | 30 | 412.2 | no | lazy |
| dashboard/api/aux/source-csv-summary.json | Auxiliary source summary | EMPTY_VALID | 0 | 0 | 3.6 | no | lazy |
| dashboard/api/cache/source-csv-reference.json | Diagnostic | MISSING | 0 | 0 | 0 | no | on_demand |
| dashboard/api/cache/source-csv-index.json | Diagnostic | MISSING | 0 | 0 | 0 | no | on_demand |
| dashboard/api/enrichment/source-csv-dry-run.json | Enrichment | OK | 1 | 0 | 1.3 | no | on_demand |
| dashboard/api/aux/pilotage-summary.json | Auxiliary source summary | EMPTY_VALID | 0 | 0 | 4.3 | no | lazy |
| dashboard/api/aux/berth-summary.json | Auxiliary source summary | EMPTY_VALID | 0 | 0 | 3.2 | no | lazy |
| dashboard/api/aux/ais-info-summary.json | Auxiliary source summary | EMPTY_VALID | 0 | 0 | 3.1 | no | lazy |
| dashboard/api/aux/ais-dynamic-summary.json | Auxiliary source summary | OK | 10 | 0 | 3.5 | no | lazy |
| dashboard/api/aux/vessel-spec-summary.json | Auxiliary source summary | EMPTY_VALID | 0 | 0 | 3 | no | lazy |
| dashboard/api/aux/cache-status.json | Auxiliary source summary | OK | 6 | 6 | 6.3 | no | lazy |
| dashboard/api/aux/source-schedule.json | Auxiliary source summary | OK | 10 | 10 | 11.8 | no | lazy |
| dashboard/api/aux/latest/index.json | Auxiliary source summary | OK | 6 | 0 | 1.9 | no | lazy |
| dashboard/api/aux/latest/pilotage-summary.json | Auxiliary source summary | OK | 361 | 0 | 4.1 | no | lazy |
| dashboard/api/aux/latest/berth-summary.json | Auxiliary source summary | OK | 31 | 0 | 5.3 | no | lazy |
| dashboard/api/aux/latest/ais-info-summary.json | Auxiliary source summary | OK | 10 | 0 | 3.1 | no | lazy |
| dashboard/api/aux/latest/ais-dynamic-summary.json | Auxiliary source summary | OK | 10 | 0 | 3.4 | no | lazy |
| dashboard/api/aux/latest/vessel-spec-summary.json | Auxiliary source summary | EMPTY_VALID | 0 | 0 | 3 | no | lazy |
| dashboard/api/aux/latest/cache-status.json | Auxiliary source summary | OK | 6 | 6 | 5.8 | no | lazy |
| dashboard/api/source-health-runtime.json | Diagnostic | OK | 24 | 0 | 86.5 | no | diagnostic_only |
| dashboard/api/source-collection-status.json | Diagnostic | OK | 13 | 13 | 91.6 | no | diagnostic_only |
| dashboard/api/source-quality-score.json | Diagnostic | OK | 7 | 7 | 12.5 | no | diagnostic_only |
| dashboard/api/enrichment-utilization.json | Enrichment | OK | 7 | 7 | 19.4 | no | diagnostic_only |
| dashboard/api/enrichment/latest/index.json | Enrichment | EMPTY_VALID | 0 | 0 | 1.2 | no | lazy |
| dashboard/api/enrichment/latest/summary.json | Enrichment | OK | 10817 | 0 | 5.2 | no | lazy |
| dashboard/api/enrichment/latest/candidates.json | Enrichment | TOO_LARGE | 10817 | 10817 | 15199 | no | lazy |
| dashboard/api/enrichment/latest/applied.json | Enrichment | TOO_LARGE | 4295 | 4295 | 5959.6 | no | lazy |
| dashboard/api/enrichment/latest/review-queue.json | Enrichment | TOO_LARGE | 6522 | 6522 | 10521 | no | lazy |
| dashboard/api/enrichment/latest/patches.json | Enrichment | TOO_LARGE | 4295 | 4295 | 5959.8 | no | lazy |
| dashboard/api/review/pilotage-berth-matches.json | Core summary | EMPTY_VALID | 0 | 0 | 1.2 | no | diagnostic_only |
| dashboard/api/runtime-budget-report.json | Core summary | EMPTY_VALID | 0 | 0 | 4 | no | diagnostic_only |
| dashboard/api/runtime/update-tiers.json | Core summary | EMPTY_VALID | 0 | 0 | 2.7 | no | lazy |
| dashboard/api/storage-efficiency-report.json | Diagnostic | OK | 5 | 0 | 3.5 | no | diagnostic_only |
| dashboard/api/db-cleanup-plan.json | Diagnostic | EMPTY_VALID | 0 | 0 | 43 | no | diagnostic_only |
| dashboard/api/intelligence/fleet-intelligence.json | Fleet intelligence | OK | 3 | 3 | 51 | no | lazy |
| dashboard/api/intelligence/fleet-penetration.json | Fleet intelligence | OK | 3 | 3 | 49.7 | no | lazy |
| dashboard/api/intelligence/revenue-forecast.json | Revenue intelligence | OK | 1 | 1 | 25 | no | lazy |
| dashboard/api/intelligence/port-dna.json | Port intelligence | OK | 10 | 10 | 115.9 | no | lazy |
| dashboard/api/intelligence/opportunity-memory.json | Contact / memory | OK | 10 | 10 | 284.7 | no | lazy |
| dashboard/api/intelligence/contact-coverage-summary.json | Contact / memory | OK | 100 | 5 | 6.2 | no | lazy |
| dashboard/api/intelligence/contact-coverage.json | Contact / memory | TOO_LARGE | 100 | 100 | 1109.1 | no | lazy |
| dashboard/api/intelligence/compliance-exposure.json | Compliance / cleaning window | OK | 6 | 6 | 83.1 | no | lazy |
| dashboard/api/intelligence/cleaning-window.json | Compliance / cleaning window | OK | 10 | 10 | 130.3 | no | lazy |
