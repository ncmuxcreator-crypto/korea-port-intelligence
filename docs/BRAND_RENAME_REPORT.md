# Korea Port Intelligence Rename Report

## What Changed

- Public copy, README text, report titles, focus questions, CSV filenames, workflow logs, and artifact names now use `Korea Port Intelligence` or neutral commercial wording.
- HTML page titles and meta descriptions now use `Korea Port Intelligence`.
- Package metadata now uses `korea-port-intelligence`.
- Cloudflare Worker config and local preview API fallback now target `korea-port-intelligence`.
- Supabase object names and environment variable keys were not renamed.

## Remaining Legacy String Status

Remaining `HWK/hwk/HullWiper/hwk-port-intelligence` matches are intentional when they are:

- Old Cloudflare URL references in migration notes.
- Supabase schema object names requiring an explicit DB migration.
- Environment variable keys requiring backward compatibility.
- Local workspace fallback paths.
- Package lock integrity hash false positives.

## Validation

- `npm run validate`: passed locally.
- `lint` / `typecheck`: no scripts are defined in `package.json`.
