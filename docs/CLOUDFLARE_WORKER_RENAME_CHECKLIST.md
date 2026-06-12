# Cloudflare Worker Rename Checklist

## Target

- Service name: `Korea Port Intelligence`
- Worker slug: `korea-port-intelligence`
- Target URL: `https://korea-port-intelligence.giwon48.workers.dev/`
- Existing URL to keep during transition: `https://hwk-port-intelligence.giwon48.workers.dev/`

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

This should not delete the old Worker. The old URL normally remains available
until it is manually deleted or its route is changed in Cloudflare.

## Post-Deploy Checks

- `https://korea-port-intelligence.giwon48.workers.dev/`
- `https://korea-port-intelligence.giwon48.workers.dev/api/bootstrap.json`
- `https://korea-port-intelligence.giwon48.workers.dev/api/status-summary.json`
- `https://korea-port-intelligence.giwon48.workers.dev/api/vessels/index.json`

Keep checking the old URL during the transition:

- `https://hwk-port-intelligence.giwon48.workers.dev/`

## Do Not Change Automatically

- Cloudflare account id
- Cloudflare API token
- GitHub Actions secret names
- Supabase secrets
- Environment variable keys
- External DNS/custom routes
