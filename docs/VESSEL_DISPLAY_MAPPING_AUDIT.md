# Vessel Display Mapping Audit

Generated at: 2026-06-11T05:27:01.972Z

## Scope

This audit checks whether generated dashboard JSON items expose the canonical `vessel_display` object used by the frontend. It does not change UI, scoring, or data collection.

## Canonical Mapping

- Text fields use `-` when missing.
- Numeric fields use `null` when missing; valid numeric `0` remains `0`.
- `operator_display` falls back through operator, shipping_company, company, company_name, owner_operator, technical_manager, manager, owner.
- `current_port_korean` is derived through existing port normalization plus Korean display-name fallback.
- `reason_summary` parsing is used only as a fallback for non-critical display fields such as GT, stay duration, berth, or anchorage text. It is never used for IMO/MMSI identity.

## Endpoint Coverage

| Endpoint | Exists | Valid JSON | Rows | Rows With Display | Operator Display | Port Korean | Opportunity Score | Contradictions |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| bootstrap.top_candidates | yes | yes | 20 | 20 | 50.0% | 100.0% | 100.0% | - |
| candidates/top | yes | yes | 100 | 100 | 100.0% | 100.0% | 100.0% | - |
| targets/current | yes | yes | 29 | 29 | 100.0% | 100.0% | 100.0% | - |
| targets/categories | yes | yes | 162 | 162 | 100.0% | 100.0% | 100.0% | - |
| sales/actions | yes | yes | 58 | 58 | 100.0% | 100.0% | 100.0% | - |
| sales/conversion-pipeline | yes | yes | 29 | 29 | 100.0% | 100.0% | 100.0% | - |
| sales/quote-opportunities | yes | yes | 31 | 31 | 96.8% | 100.0% | 100.0% | - |
| watchlist/current | yes | yes | 20 | 20 | 60.0% | 100.0% | 100.0% | - |
| staying-vessels | yes | yes | 500 | 500 | 100.0% | 100.0% | 100.0% | - |
| anchorage-waiting | yes | yes | 271 | 271 | 100.0% | 100.0% | 100.0% | - |
| arrival-pipeline | yes | yes | 200 | 200 | 100.0% | 100.0% | 100.0% | - |
| vessels/page-1 | yes | yes | 30 | 30 | 100.0% | 100.0% | 100.0% | - |

## Required Fields

- vessel_name: text
- imo: text
- mmsi: text
- call_sign: text
- flag: text
- vessel_type: text
- gt: number
- dwt: number
- operator: text
- operator_display: text
- company: text
- owner: text
- manager: text
- agent: text
- current_port: text
- current_port_korean: text
- berth: text
- anchorage: text
- eta: text
- etb: text
- ata: text
- atb: text
- etd: text
- atd: text
- stay_days: number
- stay_hours: number
- waiting_hours: number
- port_stay_hours: number
- congestion_score: number
- waiting_score: number
- opportunity_score: number
- risk_score: number
- biofouling_score: number
- compliance_score: number
- confidence_score: number
- priority_label: text
- priority_label_ko: text
- target_categories: array
- reason_summary: text
- recommended_action: text
- data_sources: array
- enrichment_sources: array
- last_seen_at: text

## Notes

- Coverage can remain low when the source data truly lacks IMO, MMSI, operator, or timestamp fields.
- The important failure condition is contradiction: source data or reason text has a value but `vessel_display` does not expose it.
