# Korea Port Hull Intelligence Platform

Korea Port Hull Intelligence Platform detects hull-cleaning candidates in Korean ports as early as possible.

The backend is public-data-first. Paid AIS providers such as MarineTraffic, VesselFinder, or AISStream are optional enrichment only and should not block candidate discovery.

## Port Priority

1. Busan
2. Yeosu / Gwangyang
3. Ulsan
4. Pyeongtaek-Dangjin
5. Hadong / Samcheonpo
6. Pohang

## Operating Goals

- Improve backend stability and bounded collector runtime.
- Strengthen candidate scoring for hull-cleaning outreach timing.
- Accumulate snapshots for port-stay, idle-time, and score-change history.
- Keep GitHub Actions reliable for scheduled updates.
- Keep generated dashboard JSON compact; do not commit `node_modules` or bulky raw archives.

See [docs/PROJECT_BRIEF.md](docs/PROJECT_BRIEF.md) for the full product direction and Codex working rules.

## Local Checks

Run these before proposing changes:

```powershell
npm install
npm run update
npm run validate
npm run health
```

`npm run update` can run without API secrets, but the output will stay in `sample_only` mode until public data collectors and secrets are configured.

## Data Mode

- `sample_only`: UI and pipeline smoke-test mode. Do not use candidates for real outreach.
- `api_ready_snapshot`: API groups are configured, but collector output still needs source/freshness review.
- `static_snapshot`: static generated dashboard data.

## GitHub Actions

The scheduled workflow runs every six hours and pushes compact generated outputs back to `main`. Configure public-data secrets first, then add paid AIS keys only if commercial coverage requires them.
