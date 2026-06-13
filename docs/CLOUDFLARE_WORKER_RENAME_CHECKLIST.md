# Cloudflare Worker Rename Checklist

## Target

- Service name: `Korea Port Intelligence`
- Worker slug: `korea-port-intelligence`
- Target URL: `https://korea-port-intelligence.giwon48.workers.dev/`
- Retired worker routes should not be shown as current production endpoints.

## Deployment Path

- Worker config: `wrangler.jsonc`
- Worker entry: `src/worker.js`
- Static assets: `dashboard`
- Package command: `npm run deploy:cloudflare`
- Underlying command: `npx wrangler deploy`
- GitHub Actions deployments:
  - `.github/workflows/longterm-update.yml`
  - `.github/workflows/port-geojson-snapshot.yml`

Both workflows call `npx wrangler deploy`, so they use the Worker name from `wrangler.jsonc`.

## Expected Impact

Changing the Worker name in `wrangler.jsonc` makes the next deploy publish to
the Worker named `korea-port-intelligence`.

This should not delete any retired Worker automatically. Retired routes should be
removed or redirected in Cloudflare only after the current Worker is verified.

## Post-Deploy Checks

- `https://korea-port-intelligence.giwon48.workers.dev/`
- `https://korea-port-intelligence.giwon48.workers.dev/api/bootstrap.json`
- `https://korea-port-intelligence.giwon48.workers.dev/api/status-summary.json`
- `https://korea-port-intelligence.giwon48.workers.dev/api/vessels/index.json`

## Do Not Change Automatically

- Cloudflare account id
- Cloudflare API token
- GitHub Actions secret names
- Supabase secrets
- Environment variable keys
- External DNS/custom routes
