# Korea Port Intelligence Rename Notes

User-facing copy should use `Korea Port Intelligence` or short `Port Intelligence`.

## Changed In This Repository

- README, page title, meta description, dashboard copy, and generated report titles use `Korea Port Intelligence`.
- GitHub Actions artifact/log names use `korea-port-intelligence`.
- CSV/download and archive display prefixes use `korea-port-intelligence`.
- Package metadata uses `korea-port-intelligence`.
- Cloudflare Worker config now targets `korea-port-intelligence`.

## Manual External Settings To Rename Later

- Existing Cloudflare Worker URL:
  - Keep `https://hwk-port-intelligence.giwon48.workers.dev` live until the new URL is verified.
- Supabase historical/source keys:
  - `hwk-port-raw:${runId}` remains unchanged for compatibility.
- Supabase helper objects:
  - `hwk_try_timestamptz`, `hwk_normalize_pilot_schedule_time`,
    `trg_hwk_normalize_pilot_schedule_time`, and `hwk_storage_table_sizes`
    need a dedicated database migration if renamed.
- Environment variable keys:
  - `HWK_HEALTH_PARENT` remains unchanged for backward compatibility.
- Local workspace fallback paths:
  - Any `hwkport-*` local folder references should be changed only after local folders are renamed.

## Known Benign Matches

- `package-lock.json` can contain `HWK` inside npm integrity hashes. Do not edit hashes manually.

## Deployment URL Follow-Up

1. Deploy the Worker named `korea-port-intelligence`.
2. Verify `https://korea-port-intelligence.giwon48.workers.dev/`.
3. Keep the old Worker URL as a fallback during transition.
4. Move any external DNS/custom route only after the new Worker is verified.
