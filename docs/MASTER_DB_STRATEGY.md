# Master DB Strategy — v17.7

## Product
Korea Port Hull Intelligence Platform.

## Primary goal
Find hull-cleaning candidates in Korean ports as early as possible.

## Storage roles
- GitHub: code, workflows, light generated JSON.
- Supabase: operational master DB.
- GDrive/Object Storage: raw snapshots and bulky archives.

## Recommended Supabase tables
1. `vessels`
2. `vessel_snapshots`
3. `port_calls`
4. `candidate_events`
5. `pipeline_runs`
6. `source_health`

## RLS
Enable RLS before adding customer notes, contact logs, or commercial scoring data.

## Paid AIS
MarineTraffic/VesselFinder should remain optional enrichment. Public/MOF/port data remains the default backbone.
