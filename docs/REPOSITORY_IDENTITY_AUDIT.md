# Repository Identity Audit

Generated at: 2026-06-13T10:45:31.207Z

## Current Identity

- GitHub repository: not available locally
- GitHub ref: not available locally
- Workflow name: not available locally
- Git remote origin: git@github.com:ncmuxcreator-crypto/korea-port-intelligence.git
- Cloudflare worker: korea-port-intelligence
- Cloudflare routes: none configured in repo

## Summary

- Findings: 187
- HARMLESS_LABEL: 115
- FUNCTIONAL_DEPENDENCY: 17
- GENERATED_METADATA: 55
- NEEDS_MANUAL_REVIEW: 0

## Safe Cleanup Applied


## High-Value References

| Reference | File | Type | Risk | Recommendation |
|---|---|---|---|---|
| korea-port-intelligence | dashboard/app/api-client.js:9 | FUNCTIONAL_DEPENDENCY | MEDIUM | Keep if this is the intended current deployment identity. |
| https://korea-port-intelligence.giwon48.workers.dev | dashboard/app/api-client.js:9 | FUNCTIONAL_DEPENDENCY | MEDIUM | Keep if this is the intended current deployment identity. |
| korea-port-intelligence | docs/BRAND_RENAME_MIGRATION_NOTES.md:29 | FUNCTIONAL_DEPENDENCY | MEDIUM | Keep if this is the intended current deployment identity. |
| https://korea-port-intelligence.giwon48.workers.dev/ | docs/BRAND_RENAME_MIGRATION_NOTES.md:29 | FUNCTIONAL_DEPENDENCY | MEDIUM | Keep if this is the intended current deployment identity. |
| korea-port-intelligence | docs/CLOUDFLARE_WORKER_RENAME_CHECKLIST.md:7 | FUNCTIONAL_DEPENDENCY | MEDIUM | Keep if this is the intended current deployment identity. |
| https://korea-port-intelligence.giwon48.workers.dev/ | docs/CLOUDFLARE_WORKER_RENAME_CHECKLIST.md:7 | FUNCTIONAL_DEPENDENCY | MEDIUM | Keep if this is the intended current deployment identity. |
| korea-port-intelligence | docs/CLOUDFLARE_WORKER_RENAME_CHECKLIST.md:33 | FUNCTIONAL_DEPENDENCY | MEDIUM | Keep if this is the intended current deployment identity. |
| https://korea-port-intelligence.giwon48.workers.dev/ | docs/CLOUDFLARE_WORKER_RENAME_CHECKLIST.md:33 | FUNCTIONAL_DEPENDENCY | MEDIUM | Keep if this is the intended current deployment identity. |
| korea-port-intelligence | docs/CLOUDFLARE_WORKER_RENAME_CHECKLIST.md:34 | FUNCTIONAL_DEPENDENCY | MEDIUM | Keep if this is the intended current deployment identity. |
| https://korea-port-intelligence.giwon48.workers.dev/api/bootstrap.json | docs/CLOUDFLARE_WORKER_RENAME_CHECKLIST.md:34 | FUNCTIONAL_DEPENDENCY | MEDIUM | Keep if this is the intended current deployment identity. |
| korea-port-intelligence | docs/CLOUDFLARE_WORKER_RENAME_CHECKLIST.md:35 | FUNCTIONAL_DEPENDENCY | MEDIUM | Keep if this is the intended current deployment identity. |
| https://korea-port-intelligence.giwon48.workers.dev/api/status-summary.json | docs/CLOUDFLARE_WORKER_RENAME_CHECKLIST.md:35 | FUNCTIONAL_DEPENDENCY | MEDIUM | Keep if this is the intended current deployment identity. |
| korea-port-intelligence | docs/CLOUDFLARE_WORKER_RENAME_CHECKLIST.md:36 | FUNCTIONAL_DEPENDENCY | MEDIUM | Keep if this is the intended current deployment identity. |
| https://korea-port-intelligence.giwon48.workers.dev/api/vessels/index.json | docs/CLOUDFLARE_WORKER_RENAME_CHECKLIST.md:36 | FUNCTIONAL_DEPENDENCY | MEDIUM | Keep if this is the intended current deployment identity. |
| korea-port-intelligence | public/app/api-client.js:9 | FUNCTIONAL_DEPENDENCY | MEDIUM | Keep if this is the intended current deployment identity. |
| https://korea-port-intelligence.giwon48.workers.dev | public/app/api-client.js:9 | FUNCTIONAL_DEPENDENCY | MEDIUM | Keep if this is the intended current deployment identity. |
| korea-port-intelligence | wrangler.jsonc:3 | FUNCTIONAL_DEPENDENCY | MEDIUM | Keep if this is the intended current deployment identity. |

## Artifact Names

- .github/workflows/daily-enrichment.yml:75 Korea Port Intelligence-daily-enrichment-report
- .github/workflows/db-cleanup.yml:93 korea-port-intelligence-db-cleanup-report
- .github/workflows/discovery-audit.yml:70 korea-port-intelligence-discovery-audit
- .github/workflows/fast-aux-update.yml:100 korea-port-intelligence-fast-aux-cache
- .github/workflows/longterm-update.yml:481 korea-port-intelligence-generated-snapshot
- .github/workflows/port-geojson-snapshot.yml:107 port-risk-geojson-snapshot
- .github/workflows/reference-enrichment.yml:97 korea-port-intelligence-reference-enrichment

## Recommendation

Do not rename Cloudflare worker names, routes, public URLs, git remotes, deploy commands, API origins, or local fallback paths without a separate migration check. Current `korea-port-intelligence` references appear to be the intended product/deployment identity.
