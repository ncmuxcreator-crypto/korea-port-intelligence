# Vessel Spec Mapping

Source: MOF `SicsVsslManp3/Info3`

Tier: `fast_aux`

Core update policy: core must not fetch this API directly. Core may apply cached patch hints from `dashboard/api/aux/latest/patch-hints.json`.

Default endpoint:

`http://apis.data.go.kr/1192000/SicsVsslManp3/Info3`

Primary match key:

1. IMO exact
2. MMSI exact if present in another source
3. canonical call sign exact
4. canonical call sign + port/time if context exists
5. vessel name fuzzy is review-only

Field mapping:

| API field | Normalized field |
| --- | --- |
| `clsgn` | `call_sign` |
| `imoNo` | `imo` |
| `vsslKorNm` | `vessel_name_ko` / `vessel_name` |
| `vsslEngNm` | `vessel_name_en` / `vessel_name` |
| `vsslKnd` | `vessel_type` |
| `vsslNlty` | `flag` |
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
