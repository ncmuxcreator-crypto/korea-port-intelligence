# DB Cleanup Execution Report

- Generated at: 2026-06-12T12:08:58.668Z
- Mode: dry_run
- Applied: false
- Supabase configured: false
- Candidate runs selected: 5
- Tables touched: 0
- Rows backed up: 0
- Rows deleted estimate: 0

## Safety

- Only run-level candidates from db-cleanup-plan.json are eligible.
- Active/latest/protected run ids are excluded.
- Table-level cleanup, orphan cleanup, and duplicate cleanup are not executed by this script.
- Rows are exported to data/db-cleanup-backups before deletion.

## Results

| Run | Table | Before | After | Backup | Status |
| --- | --- | ---: | ---: | --- | --- |
