# Auxiliary Enrichment Sources

This layer keeps the core dashboard fast. Auxiliary sources refresh in `fast_aux` or reference tiers and publish small summaries plus cached patch hints.

Sources covered:

| Source | Tier | Core fetch? | Summary |
| --- | --- | --- | --- |
| `vessel_spec` | fast_aux | no | `dashboard/api/aux/vessel-spec-summary.json` |
| `ulsan_vessel_operation` | fast_aux | no | `dashboard/api/aux/ulsan-summary.json` |
| `port_facility` | fast_aux child enrichment | no standalone fetch | `dashboard/api/aux/port-facility-summary.json` |

Core contract:

- Core applies only cached `dashboard/api/aux/latest/patch-hints.json`.
- Core must not fetch auxiliary APIs directly.
- Weak or fuzzy-only vessel-name matches remain review-only.
- Verified/manual values are never overwritten blindly.

Audit commands:

- `npm run audit:vessel-spec`
- `npm run audit:ulsan-source`
- `npm run audit:port-facility`
- `npm run audit:aux-enrichment-sources`
