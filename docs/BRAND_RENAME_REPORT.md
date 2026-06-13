# Korea Port Intelligence Rename Report

## What Changed

- Public copy, README text, report titles, focus questions, CSV filenames, workflow logs, and artifact names now use `Korea Port Intelligence` or neutral commercial wording.
- HTML page titles and meta descriptions now use `Korea Port Intelligence`.
- Package metadata now uses `korea-port-intelligence`.
- Cloudflare Worker config and local preview API fallback now target `korea-port-intelligence`.
- Retired Supabase object names and environment variable aliases should be migrated separately if they still exist in a live database.

## Retired Naming Status

Retired project/company labels should not appear in runtime logs, workflow names, package metadata, worker config, or current documentation.

Acceptable remnants are limited to external systems that have not yet had their schema or route names migrated.

## Validation

- `npm run validate`: passed locally.
- `lint` / `typecheck`: no scripts are defined in `package.json`.
