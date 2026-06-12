# DB Cleanup Execution Report

- Generated at: 2026-06-12T12:12:53.503Z
- Mode: apply
- Applied: true
- Supabase configured: true
- Candidate runs selected: 5
- Tables touched: 8
- Rows backed up: 89
- Rows deleted estimate: 89

## Safety

- Only run-level candidates from db-cleanup-plan.json are eligible.
- Active/latest/protected run ids are excluded.
- Table-level cleanup, orphan cleanup, and duplicate cleanup are not executed by this script.
- Rows are exported to data/db-cleanup-backups before deletion.

## Results

| Run | Table | Before | After | Backup | Status |
| --- | --- | ---: | ---: | --- | --- |
| run_20260611131613067_56717d6a | opportunity_master | 4 | 0 | data/db-cleanup-backups/20260612121253/run_20260611131613067_56717d6a/opportunity_master.json | deleted |
| run_20260611131613067_56717d6a | port_congestion_snapshots | 8 | 0 | data/db-cleanup-backups/20260612121253/run_20260611131613067_56717d6a/port_congestion_snapshots.json | deleted |
| run_20260611131111423_f0d63fa7 | port_congestion_snapshots | 8 | 0 | data/db-cleanup-backups/20260612121253/run_20260611131111423_f0d63fa7/port_congestion_snapshots.json | deleted |
| run_20260611130540620_e5d891fb | port_congestion_snapshots | 9 | 0 | data/db-cleanup-backups/20260612121253/run_20260611130540620_e5d891fb/port_congestion_snapshots.json | deleted |
| run_20260611103308821_aea4733e | opportunity_master | 27 | 0 | data/db-cleanup-backups/20260612121253/run_20260611103308821_aea4733e/opportunity_master.json | deleted |
| run_20260611103308821_aea4733e | port_congestion_snapshots | 9 | 0 | data/db-cleanup-backups/20260612121253/run_20260611103308821_aea4733e/port_congestion_snapshots.json | deleted |
| run_20260611094049200_540e1000 | opportunity_master | 16 | 0 | data/db-cleanup-backups/20260612121253/run_20260611094049200_540e1000/opportunity_master.json | deleted |
| run_20260611094049200_540e1000 | port_congestion_snapshots | 8 | 0 | data/db-cleanup-backups/20260612121253/run_20260611094049200_540e1000/port_congestion_snapshots.json | deleted |
