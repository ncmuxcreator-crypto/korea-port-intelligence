# Port Facility Mapping

Source: MOF `CargHarborUse2`

Source key: `port_facility`

Owner tier: `fast_aux`

Core update policy: `core_may_update=false`. `UPDATE_MODE=core` must not fetch `PORT_FACILITY_API_URL`; it may only apply cached hints from `dashboard/api/aux/latest/patch-hints.json`.

Important rule:

`CargHarborUse2` is not a standalone collector. It is called only as child enrichment of PORT-MIS `VsslEtrynd5` using:

- `prtAgCd`
- `etryptYear`
- `etryptCo`
- `clsgn`

`clsgn` must be the centralized `canonical_call_sign`.

Per-run request cap:

- `PORT_FACILITY_MAX_REQUESTS`
- default: `150`

Skip reasons:

- `missing_prtAgCd`
- `missing_etryptYear`
- `missing_etryptCo`
- `missing_clsgn`

Normalized hints:

| API field | Normalized field |
| --- | --- |
| `laidupFcltyNm` | `facility_name` / berth hint |
| `laidupPlaceCd` | `berth_place_code` |
| `laidupPlaceSubCd` | `berth_place_sub_code` |
| `entrpsCdNm` | `operator_or_agent_candidate` |
| `chrgeKndNm` | `charge_type` |
| `useSe` | `use_code` |
| `useSeNm` | `use_type` |
| `etryndDt` | `facility_use_time` |
| `satmntDt` | `declaration_time` |
| `dedtDt` | `payment_due_time` |
| `totRntfee` | `total_fee` |
| `aprtfEtryptDt` | `next_port_arrival_time` |
| `lnlNm` | `cargo_operation_hint` |
| `cychgTon` | `freight_ton` |
| `bassChrge` | `base_charge` |

Nested `details.detail[]` rows also map:

- `lnlSe`
- `lnlNm`
- `cychgTon`
- `bassChrge`
- `dscntRt`

Patch hints:

- `port_facility_berth_signal`
- `facility_name`
- `berth`
- `berth_place_code`
- `berth_place_sub_code`
- `facility_use_time`
- `operator_or_agent_candidate`
- `cargo_operation_hint`
- `charge_type`
- `berth_signal`

Primary match:

- `canonical_call_sign + prtAgCd + etryptYear + etryptCo`

Secondary match:

- `canonical_call_sign + normalized port + facility_use_time window`

Overwrite policy:

- Do not overwrite verified/manual operator fields automatically.
- Operator and agent values from this source are candidates unless the target field is empty and confidence is sufficient.
- Conflicting operator candidates should go to enrichment review, not overwrite `operator_display`.

Outputs:

- `dashboard/api/aux/port-facility-summary.json`
- `dashboard/api/aux/latest/port-facility-summary.json`
- `dashboard/api/aux/latest/patch-hints.json`
- `dashboard/api/aux/port-facility-audit.json`
