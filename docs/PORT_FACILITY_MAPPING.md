# Port Facility Mapping

Source: MOF `CargHarborUse2`

Source key: `port_facility`

Important rule:

`CargHarborUse2` is not a standalone collector. It is called only as child enrichment of PORT-MIS `VsslEtrynd5` using:

- `prtAgCd`
- `etryptYear`
- `etryptCo`
- `clsgn`

Normalized hints:

| API field | Normalized field |
| --- | --- |
| `laidupFcltyNm` | `facility_name` / berth hint |
| `entrpsCdNm` | `operator_or_agent_candidate` |
| `lnlNm` | `cargo_operation_hint` |

Patch hints:

- `port_facility_berth_signal`
- `facility_name`
- `operator_or_agent_candidate`
- `cargo_operation_hint`

Overwrite policy:

- Do not overwrite verified/manual operator fields automatically.
- Operator and agent values from this source are candidates unless the target field is empty and confidence is sufficient.

Outputs:

- `dashboard/api/aux/port-facility-summary.json`
- `dashboard/api/aux/latest/port-facility-summary.json`
