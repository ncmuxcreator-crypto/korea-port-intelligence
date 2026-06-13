# Source CSV Reference

`source_csv` is owned by the `reference_enrichment` tier. Core updates must stay cache-only and must not fetch the raw CSV.

## Canonical Lightweight CSV

- Local path: `data/reference/verified_vessel_reference.csv`
- Raw URL in GitHub Actions: `https://raw.githubusercontent.com/${GITHUB_REPOSITORY}/main/data/reference/verified_vessel_reference.csv`
- Current expected repository URL: `https://raw.githubusercontent.com/ncmuxcreator-crypto/korea-port-intelligence/main/data/reference/verified_vessel_reference.csv`

Do not point `SOURCE_CSV_URL` at the old large `source_arrivals.csv` file or at an old repository raw URL.

## Tier Behavior

- `UPDATE_MODE=core`: `SOURCE_CSV_MODE=cache_only`; reuse previous cache only.
- `UPDATE_MODE=reference_enrichment`: `SOURCE_CSV_MODE=refresh`; fetch the lightweight verified CSV and regenerate:
  - `dashboard/api/cache/source-csv-reference.json`
  - `dashboard/api/cache/source-csv-index.json`
  - `dashboard/api/aux/source-csv-summary.json`

Missing IMO, MMSI, or operator values are allowed for this lightweight CSV when call sign, GT, flag, or vessel type fields provide usable reference coverage.

## Diagnostics

Run:

```bash
npm run diagnose:source-csv-url
```

The diagnostic reports `WRONG_SOURCE_CSV_URL` when the configured raw URL points to an old repo name or the old large `source_arrivals.csv`.
