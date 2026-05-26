# GitHub Actions Queue Troubleshooting

Use this when `Longterm Update` stays queued for 30+ minutes or cannot be cancelled.

## Workflow Safeguards

- `runs-on: ubuntu-latest`
- no self-hosted runner labels
- workflow/ref scoped concurrency:

```yaml
concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true
```

- `Longterm Update` job timeout: 12 minutes
- generated data files are not committed back to `main`
- `Actions Health Check` workflow uses a separate concurrency group

## Quick Checks

1. Run `Actions Health Check` manually.
2. If it stays queued too, the problem is likely GitHub-hosted runner queueing or account-level Actions availability.
3. If health check runs but `Longterm Update` stays queued, check:
   - workflow concurrency group
   - old queued runs on the same branch
   - environment approval requirements
   - repository Actions minutes / billing restrictions
   - branch protection requiring approvals before deployment

## Do Not Use

Do not switch this project to:

```yaml
runs-on: self-hosted
```

unless a healthy self-hosted runner is intentionally configured.

## Manual API Recovery

If the GitHub UI cannot cancel a stuck run, use GitHub CLI:

```powershell
gh run list --workflow "Longterm Update" --limit 10
gh run cancel RUN_ID
```

If cancellation fails repeatedly, temporarily disable and re-enable the workflow:

```powershell
gh workflow disable "Longterm Update"
gh workflow enable "Longterm Update"
```

If `gh` is not installed, use the GitHub UI:

```text
Actions -> Longterm Update -> ... menu -> Disable workflow
wait 30-60 seconds
Enable workflow
Run workflow
```

Prefer starting a new `Run workflow` on `main` rather than re-running an old queued run.

## Dispatch Button Bypass

If GitHub shows `Failed to queue workflow run` when pressing the manual button, use `Longterm Update V2` through a normal `main` push instead. The V2 workflow intentionally has no path filter, so even an empty commit can trigger it.

This bypass avoids the manual `workflow_dispatch` path. If a push to `main` also does not create a run, the issue is outside the workflow YAML and is likely repository Actions availability, billing/minutes, organization policy, or a temporary GitHub Actions queue problem.
