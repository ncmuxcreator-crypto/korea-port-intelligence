# Korea Port Intelligence Rename Notes

User-facing copy should use `Korea Port Intelligence` or short `Port Intelligence`.

## Changed In This Repository

- README, page title, meta description, dashboard copy, and generated report titles use `Korea Port Intelligence`.
- GitHub Actions artifact/log names use `korea-port-intelligence`.
- CSV/download and archive display prefixes use `korea-port-intelligence`.
- Package metadata uses `korea-port-intelligence`.
- Cloudflare Worker config now targets `korea-port-intelligence`.

## Manual External Settings To Verify

- Retired Cloudflare Worker routes:
  - Do not present retired worker routes as current production endpoints.
- Supabase historical/source keys:
  - Legacy run keys may exist in historical data and should be treated as archived metadata.
- Supabase helper objects:
  - Legacy helper objects need a dedicated database migration if renamed.
- Environment variable keys:
  - Retired compatibility env names should not be used for new runtime configuration.
- Local workspace fallback paths:
  - Retired local folder fallback paths should not be used for new runs.

## Deployment URL Follow-Up

1. Deploy the Worker named `korea-port-intelligence`.
2. Verify `https://korea-port-intelligence.giwon48.workers.dev/`.
3. Move any external DNS/custom route only after the new Worker is verified.
