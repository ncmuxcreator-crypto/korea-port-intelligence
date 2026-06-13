# Auxiliary Enrichment Sources

This layer keeps the core dashboard fast. Auxiliary sources refresh in `fast_aux` or reference tiers and publish small summaries plus cached patch hints.

Sources covered:

| Source | Tier | Core fetch? | Summary |
| --- | --- | --- | --- |
| `vessel_spec` | fast_aux | no | `dashboard/api/aux/vessel-spec-summary.json` |
| `ulsan_vessel_operation` | fast_aux | no | `dashboard/api/aux/ulsan-summary.json` |
| `port_facility` | fast_aux child enrichment | no | `dashboard/api/aux/port-facility-summary.json` |

Core contract:

- Core applies only cached `dashboard/api/aux/latest/patch-hints.json`.
- Core must not fetch auxiliary APIs directly.
- Weak or fuzzy-only vessel-name matches remain review-only.
- Verified/manual values are never overwritten blindly.

Current matching rules:

- `port_facility`: `canonical_call_sign + prtAgCd + etryptYear + etryptCo`
- `vessel_spec`: `canonical_call_sign` exact

Current patch hint types:

- `port_facility_berth_signal`
- `vessel_spec_hint`
- `pilotage_signal`
- `berth_signal`

Latest cache endpoints:

- `dashboard/api/aux/latest/index.json`
- `dashboard/api/aux/latest/cache-status.json`
- `dashboard/api/aux/latest/patch-hints.json`
- `dashboard/api/aux/latest/port-facility-summary.json`
- `dashboard/api/aux/latest/vessel-spec-summary.json`

Audit commands:

- `npm run audit:vessel-spec`
- `npm run audit:ulsan-source`
- `npm run audit:port-facility`
- `npm run audit:aux-enrichment-sources`
