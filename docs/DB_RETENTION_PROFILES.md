# HWK DB Retention Profiles

HWK supports two database retention modes through one environment value:

```env
DB_RETENTION_PROFILE=free_500mb
```

or:

```env
DB_RETENTION_PROFILE=ideal
```

## free_500mb

Use this while Supabase Free Plan size matters.

- Target size: 450 MB
- Hard cap: 500 MB
- Keeps active run plus latest promoted run
- Keeps short analytical history, usually 2-7 days
- Uses JSON outputs and external archive as the long-term fallback layer

## ideal

Use this later when the database has enough paid capacity.

- Target size: 4 GB
- Hard cap: 8 GB
- Keeps active run plus 14 promoted runs
- Keeps broader analytical history, usually 30-365 days
- Better for trend analysis, model training, and long-term port intelligence

## Switching

In GitHub:

```text
Settings -> Secrets and variables -> Actions -> Variables
```

Set:

```text
DB_RETENTION_PROFILE = free_500mb
```

or:

```text
DB_RETENTION_PROFILE = ideal
```

Individual values such as `DB_RETENTION_VESSEL_SNAPSHOTS_DAYS` can still override the profile when needed. Leave them blank to use the selected profile defaults.
