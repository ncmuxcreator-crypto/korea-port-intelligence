# Feature Revival Plan

Generated at: 2026-06-12T13:37:34.671Z

This plan restores existing dashboard functionality by reconnecting already-developed endpoints to existing sections. It avoids duplicate components and keeps heavy detail endpoints lazy.

## Summary

- Already visible features: 20
- Revived / reconnected features: 6
- Hidden features with data: 0
- Heavy endpoints kept lazy: 5
- Duplicate risks: 1

## Revival Matrix

| Feature | Status | Endpoint | Records | UI | Action | Risk | Priority |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 오늘의 영업 액션 | ACTIVE | dashboard/api/sales/actions-summary.json | 59 | 오늘의 영업 우선순위 / 영업 액션 인사이트 | RESTORE/monitor: already connected to existing UI. | LOW | 1 |
| 영업 대상 / targets.current | ACTIVE | dashboard/api/targets/current-summary.json | 31 | 영업 대상 카테고리 | RESTORE/monitor: already connected to existing UI. | LOW | 1 |
| 견적 기회 | ACTIVE | dashboard/api/sales/quote-opportunities.json | 32 | 견적·관심·후속 영업 | RESTORE/monitor: already connected to existing UI. | LOW | 1 |
| 검증 큐 | ACTIVE | dashboard/api/sales/verification-queue-summary.json | 113 | 견적·관심·후속 영업 | RESTORE/monitor: already connected to existing UI. | LOW | 1 |
| 관심 선박 | ACTIVE | dashboard/api/watchlist/current.json | 20 | 관심 선박 | RESTORE/monitor: already connected to existing UI. | LOW | 1 |
| 영업 카테고리 | ACTIVE | dashboard/api/targets/categories-summary.json | 31 | 영업 대상 카테고리 | RESTORE/monitor: already connected to existing UI. | LOW | 1 |
| 항만 요약 | ACTIVE | dashboard/api/ports.json | 8 | 항만 인텔리전스 | RESTORE/monitor: already connected to existing UI. | LOW | 2 |
| Port DNA | ACTIVE | dashboard/api/intelligence/port-dna.json | 10 | 항만 인텔리전스 | RESTORE/monitor: already connected to existing UI. | LOW | 2 |
| Fleet Intelligence | ACTIVE | dashboard/api/intelligence/fleet-intelligence.json | 3 | 선대 / 운영사 인텔리전스 | RESTORE/monitor: already connected to existing UI. | LOW | 2 |
| Fleet Penetration | ACTIVE | dashboard/api/intelligence/fleet-penetration.json | 3 | 선대 / 운영사 인텔리전스 | RESTORE/monitor: already connected to existing UI. | LOW | 2 |
| Revenue Forecast | ACTIVE | dashboard/api/intelligence/revenue-forecast.json | 1 | 예상 매출 / 기회 | RESTORE/monitor: already connected to existing UI. | LOW | 2 |
| Cleaning Window | ACTIVE | dashboard/api/intelligence/cleaning-window.json | 10 | 리스크 / Compliance | RESTORE/monitor: already connected to existing UI. | LOW | 3 |
| Compliance Exposure | ACTIVE | dashboard/api/intelligence/compliance-exposure.json | 6 | 리스크 / Compliance | RESTORE/monitor: already connected to existing UI. | LOW | 3 |
| Contact Coverage | ACTIVE | dashboard/api/intelligence/contact-coverage-summary.json | 100 | 영업 인텔리전스 | RESTORE/monitor: already connected to existing UI. | LOW | 3 |
| Opportunity Memory | ACTIVE | dashboard/api/intelligence/opportunity-memory.json | 10 | 영업 인텔리전스 | RESTORE/monitor: already connected to existing UI. | LOW | 3 |
| Pilotage Summary | ACTIVE | dashboard/api/aux/pilotage-summary.json | 385 | 데이터 품질·시스템 진단 | RESTORE/monitor: already connected to existing UI. | LOW | 4 |
| Berth / PNC Summary | ACTIVE | dashboard/api/aux/berth-summary.json | 30 | 데이터 품질·시스템 진단 | RESTORE/monitor: already connected to existing UI. | LOW | 4 |
| AIS Info Summary | ACTIVE | dashboard/api/aux/ais-info-summary.json | 10 | 데이터 품질·시스템 진단 | RESTORE/monitor: already connected to existing UI. | LOW | 4 |
| Vessel Spec Summary | ACTIVE | dashboard/api/aux/vessel-spec-summary.json | 1 | 데이터 품질·시스템 진단 | RESTORE/monitor: already connected to existing UI. | LOW | 4 |
| Source CSV Summary | ACTIVE | dashboard/api/aux/source-csv-summary.json | 0 | 데이터 품질·시스템 진단 | RESTORE/monitor: already connected to existing UI. | LOW | 4 |

## Heavy Endpoints Kept Lazy

- 오늘의 영업 액션: dashboard/api/sales/actions.json (3 KB)
- 영업 대상 / targets.current: dashboard/api/targets/current.json (3.7 KB)
- 검증 큐: dashboard/api/sales/verification-queue.json (3 KB)
- 영업 카테고리: dashboard/api/targets/categories.json (3.7 KB)
- Contact Coverage: dashboard/api/intelligence/contact-coverage.json (3 KB)

## Duplicate Risks

- 영업 카테고리: already has a dedicated section; do not add duplicate insight card.

## Next Actions

- Keep Overview on bootstrap/status-summary only.
- Use sales/actions-summary, verification-queue-summary, and contact-coverage-summary for cards.
- Keep heavy detail endpoints lazy-loaded from existing click/expand flows.
- Do not add duplicate cards for target categories or watchlist because dedicated sections already exist.
