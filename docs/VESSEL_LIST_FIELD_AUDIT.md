# Vessel List Field Audit

작성일: 2026-06-10

목적: 선박 목록에서 선박 식별 정보와 운영/영업 판단 필드가 실제 JSON에 존재하는지, 그리고 현재 UI에 노출되는지 확인한다.

## 기존 자산

| 자산 | 경로 | 상태 | 재사용 전략 |
| --- | --- | --- | --- |
| 선박 표시 계약 | `scripts/update.js` `vesselDisplay()` | ACTIVE | 기존 `vessel_display`에 누락된 운영/혼잡/일정 별칭을 추가 매핑 |
| Worker 표시 계약 | `src/worker.js` `vesselDisplay()` | ACTIVE | 라이브 Worker 응답도 같은 `vessel_display` 계약을 따르도록 동기화 |
| 선박 페이지 JSON | `dashboard/api/vessels/page-*.json` | ACTIVE | 전체 선박 lazy-load의 주 데이터로 유지 |
| 후보/타겟 JSON | `dashboard/api/candidates/top.json`, `dashboard/api/targets/current.json` | ACTIVE | 영업 후보 목록과 HOT 후보에 이미 존재하는 세부 필드 재사용 |
| 혼잡/체선 JSON | `dashboard/api/congestion-watchlist.json` | PARTIAL | `congestion_signal`, `waiting_score`, `congestion_score` 별칭으로 화면 매핑 |
| 프론트 선박 목록 | `dashboard/index.html` | EXTENDED | 기존 렌더러를 유지하고 최종 렌더링 레이어만 확장 |

## 필드 커버리지

| Field | Available in JSON | Available in DB/source | Currently visible | Recommended label | Priority |
| --- | --- | --- | --- | --- | --- |
| `vessel_name` | yes | yes | yes | 선명 | CORE |
| `imo` | yes | yes | yes | IMO | CORE |
| `mmsi` | yes | yes | yes | MMSI | IMPORTANT |
| `call_sign` | yes | yes | yes | 콜사인 | CORE |
| `vessel_type` | yes | yes | yes | 선종 | CORE |
| `operator` | yes | yes | yes | 운영사 | CORE |
| `current_port` | yes | yes | yes | 현재 항만 | CORE |
| `eta` | yes | yes | yes | ETA | CORE |
| `ata` | yes | yes | yes | ATA | CORE |
| `gt` | yes | yes | yes | GT | IMPORTANT |
| `dwt` | yes | yes | yes | DWT | IMPORTANT |
| `flag` | yes | yes | detail | 국적 | DETAIL |
| `owner` | yes | yes | detail | 선주 | DETAIL |
| `manager` | yes | yes | detail | 관리사 | DETAIL |
| `agent` | partial | partial | detail | 에이전트 | DETAIL |
| `berth` | partial | partial | detail | 선석 | DETAIL |
| `anchorage` | partial | partial | detail | 묘박지 | DETAIL |
| `etb` | yes | yes | detail | ETB | IMPORTANT |
| `atb` | yes | yes | detail | ATB | IMPORTANT |
| `etd` | partial | partial | detail | ETD | DETAIL |
| `atd` | partial | partial | detail | ATD | DETAIL |
| `stay_days` | yes | yes | yes | 체류일수 | CORE |
| `stay_hours` | yes | yes | yes | 체류시간 | IMPORTANT |
| `waiting_hours` | partial | partial | yes | 대기시간 | IMPORTANT |
| `waiting_score` | partial | partial | yes | 체선점수 | IMPORTANT |
| `congestion_score` | partial | partial | yes | 혼잡도 | IMPORTANT |
| `opportunity_score` | yes | yes | yes | 기회점수 | CORE |
| `risk_score` | yes | yes | yes | 리스크점수 | IMPORTANT |
| `biofouling_score` | yes | yes | yes | Biofouling 점수 | IMPORTANT |
| `compliance_score` | partial | partial | detail | Compliance 점수 | DETAIL |
| `confidence_score` | yes | yes | yes | 신뢰도 | CORE |
| `priority_label` | yes | yes | yes | 우선순위 | CORE |
| `target_categories` | yes | yes | detail | 영업 카테고리 | DETAIL |
| `reason_summary` | yes | yes | yes | 추천 사유 | CORE |
| `recommended_action` | yes | yes | yes | 추천 액션 | CORE |
| `data_sources` | yes | yes | detail | 데이터 소스 | DETAIL |
| `enrichment_sources` | partial | partial | detail | Enrichment Source | DEBUG |
| `last_seen_at` | yes | yes | detail | 마지막 확인 | DETAIL |

## 표시 정책

- 선박 기본정보는 점수보다 먼저 표시한다.
- 데스크톱 표에서는 선명, IMO, 콜사인, 선종, 운영사, 현재 항만, ETA, ATA, 기회점수를 항상 표시한다.
- 모바일 카드는 선박 기본정보, 운영사/항만/일정, 체류/체선/기회/우선순위 순서로 표시한다.
- 누락값은 `-`로 표시하고, 유효한 숫자 `0`은 `0`으로 표시한다.
- 검색은 선명, IMO, MMSI, 콜사인, 운영사, 선주, 관리사, 에이전트, 항만, 선종까지 포함한다.
- 빠른 필터는 HOT, WARM, 입항예정, 묘박/대기, 장기체류, 고위험, 체선점수 높음, IMO 없음, 운영사 없음으로 제공한다.
