# Operations Runbook

## Check required secrets

Required production secrets:

- `PORT_OPERATION_SERVICE_KEY`
- `PORT_OPERATION_API_URL`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

In GitHub Actions, check the collection summary log first. It prints validation mode, missing secrets, enabled ports, attempted ports, row counts, failed stage, and root cause.

## Read source health

Use:

```powershell
npm.cmd run source:health
```

Then inspect:

- `dashboard/api/source-health-runtime.json`
- `dashboard/api/debug/source-health-runtime.json` in local/no-secret mode

Important fields:

- `run_id`
- `secrets_present`
- `enabled_collectors`
- `attempted_collectors`
- `skipped_collectors`
- `skip_reasons`
- `stale_source_health`

If `run_id` does not match `status.json`, treat the report as stale.

## Read backend-doctor

Use:

```powershell
npm.cmd run doctor
```

Important fields:

- `ok`
- `production_ready`
- `data_status`
- `record_count`
- `vessels_json_count`
- `all_collected_vessels_count`
- `target_vessels_count`
- `serving_mode`
- `production_data_source`

If `record_count = 0`, `backend-doctor` must report `ok=false`, `production_ready=false`, and `data_status=empty_dataset`.

## Run the Port Operation smoke test

The smoke test runs automatically before full collection.

Use:

```powershell
npm.cmd run update
```

Look for:

- `smoke_test_status`
- `smoke_test_failure_reason`
- `port_operation_smoke_test.redacted_response_sample`

The redacted sample includes request URL without service key, response status, content type, first 500 characters, parsed item count, and parse errors.

## Restore or keep the last successful dataset

The pipeline has a last successful dataset lock.

If the current run has:

- `record_count = 0`
- `all_vessels_count = 0`
- `no_live_data`
- `degraded_sample_only`

then the run must not replace production JSON, materialized current tables, active dataset pointer, or latest successful summary.

The dashboard should keep serving the latest successful dataset or show diagnostics-only fallback.

## Debug empty vessel output

Check these files in order:

1. `dashboard/api/quality/dataset-generation-audit.json`
2. `dashboard/api/coverage-audit.json`
3. `dashboard/api/source-health-runtime.json`
4. `dashboard/api/snapshot-guard.json`
5. `dashboard/api/backend-doctor.json`

Key questions:

- Were required secrets present?
- Was Port Operation enabled?
- Were enabled ports passed to the collector?
- Did `ports_attempted_count` stay at zero?
- Did the smoke test fail?
- Did normalization produce rows?
- Did `all_vessels_generated` become zero after source rows existed?
- Did validation or promotion gate block the dataset?

## Debug target count mismatch

Check these files or endpoints:

1. `dashboard/api/dashboard-summary.json`
2. `dashboard/api/target-vessels.json`
3. `dashboard/api/vessels.json`
4. `/api/vessels?group=target&page=1&pageSize=50`
5. `/api/dashboard-summary.json`

Compare:

- `target_vessels_count`
- `sales_target_count`
- `immediate_target_count`
- `target-vessels.json` row count
- `dataset_run_id_summary`
- `dataset_run_id_table`

If the summary has targets but the table has zero rows, treat it as a binding issue rather than a scoring issue.

## Check config status

Use Worker route:

```text
/api/config-status.json
```

Confirm:

- `missing_required_config`
- `enabled_sources`
- `enabled_ports_count`
- `active_runtime_limits`
- `validation_mode`
- `serving_mode`
- `production_data_source`

## Run regression tests

Use:

```powershell
npm.cmd run test:regression
```

The regression suite checks:

- stable fixture coverage
- duplicate `port_call_id`
- `target_ratio > 30%` warning behavior
- summary/table count consistency
- `no_live_data` not treated as production-ready
