# Vessel Spec Mapping

Source: MOF `SicsVsslManp3/Info3`

Tier: `fast_aux`

Core update policy: core must not fetch this API directly. Core may apply cached patch hints from `dashboard/api/aux/latest/patch-hints.json`.

Default endpoint:

`http://apis.data.go.kr/1192000/SicsVsslManp3/Info3`

Primary match key:

1. canonical call sign exact
2. canonical call sign + normalized vessel name
3. weak/name-only matches are review-only

Query strategy:

- `serviceKey`
- `clsgn = canonical_call_sign`
- `pageNo=1`
- `numOfRows=50`
- `vsslNm` is optional secondary narrowing only

Per-run request cap:

- `VESSEL_SPEC_MAX_REQUESTS`
- default: `150`

Field mapping:

| API field | Normalized field |
| --- | --- |
| `clsgn` | `call_sign` |
| `imoNo` | `imo` |
| `vsslKorNm` | `vessel_name_ko` / `vessel_name` |
| `vsslEngNm` | `vessel_name_en` / `vessel_name` |
| `vsslKnd` | `vessel_type` |
| `vsslNlty` | `flag` |
| `tonEdycSe` | `tonnage_certificate_type` |
| `tonEdycSeNm` | `tonnage_certificate_type_name` |
| `intrlGrtg` | `international_gt` |
| `grtg` | `gt` |
| `ntng` | `net_tonnage` |
| `vsslTotLt` | `loa` |
| `shdth` | `beam` |
| `vsslDrft` | `draft` |
| `vsslLt` | `length` |
| `vsslDp` | `depth` |
| `vsslCnstrDt` | `built_date` |
| `befClsgn` | `previous_call_sign` |
| `nwshipAt` | `newbuild_flag` |

Notes:

- This source should not be expected to provide MMSI, DWT, operator, owner, or manager.
- Verified/manual current fields must not be overwritten automatically.
- High-confidence empty fields can be patched into `vessel_display.data_lineage` with source `vessel_spec`.
- Conflicting IMO rows stay in review and are not auto-applied.
- Vessel name conflicts reduce confidence and are not auto-applied.

Outputs:

- `dashboard/api/aux/vessel-spec-summary.json`
- `dashboard/api/aux/latest/vessel-spec-summary.json`
- `dashboard/api/aux/latest/patch-hints.json`
- `dashboard/api/aux/vessel-spec-audit.json`
