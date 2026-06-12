# Discovery Roadmap

Generated at: 2026-06-12T17:45:09.197Z

## Priority 0: Safety / consistency

- Fix broken endpoint dashboard/api/cache/source-csv-reference.json
- Fix broken endpoint dashboard/api/cache/source-csv-index.json

## Priority 1: Revive existing value

- Reconnect 클리닝 적기 (dashboard/api/intelligence/cleaning-window.json)
- Reconnect 반복 영업 기회 (dashboard/api/intelligence/opportunity-memory.json)
- Reconnect Source Quality Score (dashboard/api/source-quality-score.json)
- Reconnect Auxiliary Source Cache (dashboard/api/aux/cache-status.json)
- Reconnect Auxiliary Source Schedule (dashboard/api/aux/source-schedule.json)
- Reconnect DB Cleanup Plan (dashboard/api/storage-efficiency-report.json)
- Reconnect bootstrap (dashboard/api/bootstrap.json)
- Reconnect vessel.countReconciliation (dashboard/api/vessel-count-reconciliation.json)
- Reconnect ports (dashboard/api/ports.json)
- Reconnect candidates.topSummary (dashboard/api/candidates/top-summary.json)
- Reconnect dashboard-summary (dashboard/api/dashboard-summary.json)
- Reconnect enrichment.sourceCsvDryRun (dashboard/api/enrichment/source-csv-dry-run.json)
- Reconnect aux.aisDynamicSummary (dashboard/api/aux/ais-dynamic-summary.json)
- Reconnect aux.latestIndex (dashboard/api/aux/latest/index.json)
- Reconnect aux.latestPilotage (dashboard/api/aux/latest/pilotage-summary.json)
- Reconnect aux.latestBerth (dashboard/api/aux/latest/berth-summary.json)
- Reconnect aux.latestAisInfo (dashboard/api/aux/latest/ais-info-summary.json)
- Reconnect aux.latestAisDynamic (dashboard/api/aux/latest/ais-dynamic-summary.json)
- Reconnect enrichment.latestSummary (dashboard/api/enrichment/latest/summary.json)
- Reconnect intelligence.contactCoverageSummary (dashboard/api/intelligence/contact-coverage-summary.json)

## Priority 2: Enrichment utilization

- Improve pilot_sources: no_vessel_match_or_signal
- Improve berth_sources: no_vessel_match_or_signal
- Improve mof_ais_stat: Set MOF_AIS_STAT_API_URL and MOF_AIS_STAT_SERVICE_KEY.
- Improve vessel_spec: HTTP 200 returned rows, but no rows matched vessel specification aliases. Check raw_sample_keys and parser_blockers after the next collector run.

## Priority 3: Commercial intelligence

- Surface/validate commercial intelligence: 영업 전환 파이프라인
- Surface/validate commercial intelligence: 견적 기회 빌더
- Surface/validate commercial intelligence: 관심 선박
- Surface/validate commercial intelligence: 클리닝 적기
- Surface/validate commercial intelligence: Compliance 노출도
- Surface/validate commercial intelligence: 반복 영업 기회
- Surface/validate commercial intelligence: 선대 인텔리전스
- Surface/validate commercial intelligence: 선대 침투율
- Surface/validate commercial intelligence: 선대 기회 갭
- Surface/validate commercial intelligence: 선대 DNA
- Surface/validate commercial intelligence: 예상 매출 기회

## Priority 4: Operational polish

- Map/heatmap and port click-through polish
- Mobile card density and advanced diagnostics separation
- Navigation cleanup after hidden feature decisions
