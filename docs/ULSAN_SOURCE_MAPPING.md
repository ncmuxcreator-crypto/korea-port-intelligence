# Ulsan Source Mapping

Source key: `ulsan_vessel_operation`

Tier: `fast_aux`

Environment:

- `ULSAN_API_URL`
- `ULSAN_API_KEY`
- optional `ULSAN_API_OPERATION`

Operation handling:

- Default operation is `getVtsBaseVslNvgtInfo`.
- If `ULSAN_API_URL` already ends with that operation, the collector does not append it again.
- If `ULSAN_API_URL` is a base URL, the collector appends the operation path once.

Normalized fields:

- vessel name
- canonical call sign
- port
- berth
- terminal
- ETA / ETB / ATA / ATB / ETD / ATD
- movement status

Matching policy:

1. canonical call sign + port/time
2. canonical call sign + port
3. normalized vessel name + port/time
4. weak name-only matches stay in review

Outputs:

- `dashboard/api/aux/ulsan-summary.json`
- `dashboard/api/aux/latest/ulsan-summary.json`
- patch hint field: `ulsan_signal`

Core update policy: core reads cached patch hints only and does not fetch Ulsan API directly.
