# Cloudflare Local Bypass

Use this path when GitHub Actions recognizes workflow files but does not start runs.

## What This Bypasses

This bypass avoids GitHub Actions entirely:

```text
local PowerShell
-> npm run update
-> npm run validate
-> npx wrangler deploy
-> Cloudflare Worker serves dashboard and live Supabase API
```

## One-Time Cloudflare Worker Secrets

Run these in PowerShell from the project folder:

```powershell
npm run secret:cloudflare:supabase-url
npm run secret:cloudflare:supabase-service-role
```

Paste the matching values when Wrangler asks:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

These are Worker runtime secrets. They are separate from GitHub Secrets.

## Manual Data Refresh And Deploy

```powershell
cd "C:\Users\HP\Documents\New project"
npm install
npm run update
npm run validate
npm run deploy:cloudflare
```

If `npm run health` is needed, run it after `validate`. Health is useful for audits, but collector diagnostics are usually visible after `npm run update`.

## Expected Live API Check

After deploy, open:

```text
https://YOUR_WORKER_DOMAIN/api/status.json
```

The Worker-backed API should show:

```text
version = worker-live-api-v1
```

If it still shows the static `17.7.0` status file, the Cloudflare Worker route is not serving the site yet.
