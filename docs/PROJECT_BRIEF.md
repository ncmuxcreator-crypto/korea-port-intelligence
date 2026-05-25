# Korea Port Hull Intelligence Platform - Codex Project Brief

## Core Mission

Build a backend-first intelligence platform that detects underwater hull-cleaning candidates in Korean ports as early as possible.

The primary business goal is to find commercially actionable hull-cleaning candidates before competitors do.

The platform is not a generic AIS map viewer. The core product is cleaning candidate intelligence, not vessel tracking itself.

## Operational Philosophy

Prioritize:

- Early candidate detection
- Long-idle vessels
- Anchorage congestion
- Resource-port vessel patterns
- Biofouling-risk signals
- Short-port-stay cleaning opportunities
- Fuel, CII, and compliance driven sales timing

## Geographic Priority

Tier 1 ports:

1. Busan
2. Yeosu / Gwangyang
3. Ulsan
4. Pyeongtaek-Dangjin
5. Hadong / Samcheonpo
6. Pohang

Busan focus:

- Cruise
- Container
- Repair / yard
- Anchorage opportunities

Yeosu / Gwangyang focus:

- Bulk carriers
- VLCC / tankers
- Long-idle resource vessels
- Australia / Brazil related trades

Ulsan focus:

- Tankers
- Industrial berths
- Anchorage idle detection

## Product Direction

The platform should evolve toward a real-time hull-cleaning candidate intelligence platform.

Avoid becoming:

- A generic shipping dashboard
- A generic port map
- A visual-only monitoring system

The system should always prioritize commercial hull-cleaning intelligence over visual complexity.

## Architecture Priority

This is a backend-first system. The backend is the main product; the frontend is secondary.

Priority order:

1. Data collection
2. Candidate scoring
3. Snapshot accumulation
4. Operational reliability
5. Frontend visualization

## Public-Data-First Rule

The backend should work primarily with:

- Korean public APIs
- MOF APIs
- Port authority APIs
- Berth, pilot, and public schedules

MarineTraffic and VesselFinder must not become core dependencies. They are optional future enrichment layers only.

## Integrated VTS Rule

Do not make the architecture Yeosu-only. Earlier notes that say "Yeosu VTS" should be interpreted as integrated VTS / national VTS-based vessel traffic.

Yeosu is one monitored area. The VTS layer should support multiple Korean ports and coverage areas, including Yeosu, Gwangyang, Busan, Ulsan, Pyeongtaek-Dangjin, Pohang, Hadong, Masan / Jinhae, and Incheon.

Recommended source priority:

1. PORT-MIS / Korean port call APIs
2. Berth allocation data from major Korean ports
3. Integrated VTS / national vessel traffic information
4. Public vessel specification data
5. Manual correction CSV
6. Future optional enrichment: AISHub / Global Fishing Watch
7. Future optional environment layer: Copernicus / NOAA

## Frontend Schedule Intelligence

The frontend and normalized vessel records should support these schedule fields:

- `eta`: Estimated Time of Arrival
- `etb`: Estimated Time of Berthing
- `ata`: Actual Time of Arrival
- `atb`: Actual Time of Berthing
- `etd`: Estimated Time of Departure
- `atd`: Actual Time of Departure

These fields drive:

- Port stay duration
- Berth stay duration
- Anchorage / waiting duration
- Workable UWC window
- Long-stay candidate detection
- Schedule confidence

Frontend work should answer: which vessel should HullWiper Korea contact now, and why?

## Candidate Engine

Score vessels using:

- Port priority
- Idle duration
- Vessel type
- Destination country
- Biofouling exposure
- Port congestion
- Anchorage duration
- Snapshot history

## Snapshot System

Store historical vessel state snapshots to track changes over time.

Examples:

- 14+ day idle
- Repeated anchorage
- ETA drift
- Speed reduction
- Repeated Korean port calls

## Candidate Confidence Layer

Separate:

- Sample / demo data
- Low-confidence data
- Commercially usable candidates

Rules:

- Sample data must never trigger real sales outreach.
- Commercial candidates require minimum completeness thresholds.
- Candidate counts must always carry source and freshness context.

## Fallback Snapshot System

If collectors fail:

- Preserve the last valid snapshot.
- Mark stale outputs clearly.
- Never publish empty outputs over a valid previous snapshot.

## Health Audit Layer

Track:

- Workflow status
- Source readiness
- Collector health
- Duplicate candidates
- Runtime SLA
- Snapshot validity

## Expected Data Sources

Vessel / AIS related:

- `VESSEL_SPEC_SERVICE_KEY`
- `VESSEL_SPEC_API_URL`
- `MOF_AIS_DYNAMIC_API_URL`
- `MOF_AIS_DYNAMIC_SERVICE_KEY`
- `MOF_AIS_DYNAMIC_PER_PAGE`
- `MOF_AIS_INFO_API_URL`
- `MOF_AIS_INFO_SERVICE_KEY`
- `MOF_AIS_INFO_PER_PAGE`
- `MOF_AIS_STAT_API_URL`
- `MOF_AIS_STAT_SERVICE_KEY`
- `MOF_AIS_STAT_PER_PAGE`

VTS / port movement:

- `MOF_VTS_API_BASE`
- `MOF_VTS_SERVICE_KEY`
- `MOF_VTS_PORT_CODES`

Port operations:

- `PORT_OPERATION_SERVICE_KEY`
- `PORT_OPERATION_API_URL`
- `PORT_FACILITY_SERVICE_KEY`
- `PORT_FACILITY_API_URL`

Ulsan:

- `ULSAN_API_URL`
- `ULSAN_API_KEY`
- `ULSAN_BERTH_DETAIL_API_URL`
- `ULSAN_BERTH_DETAIL_API_KEY`
- `ULSAN_CARGO_PLAN_API_URL`
- `ULSAN_CARGO_PLAN_API_KEY`
- `ULSAN_BERTH_OPERATION_API_URL`
- `ULSAN_BERTH_OPERATION_API_KEY`
- `ULSAN_TERMINAL_PROCESS_API_URL`
- `ULSAN_TERMINAL_PROCESS_API_KEY`

Public schedule sources:

- `PILOT_SOURCE_URLS`
- `BERTH_SOURCE_URLS`
- `PNC_SOURCE_URLS`

## Database Direction

Primary direction: Supabase.

Expected tables:

- `vessels`
- `vessel_snapshots`
- `port_calls`
- `candidate_events`
- `pipeline_runs`
- `source_health`

GitHub stores code, lightweight generated JSON, workflows, and configuration. It must not store huge historical datasets or massive AIS archives.

Use Supabase, Google Drive, or object storage for long-term accumulation.

## Security Direction

RLS is eventually required before storing:

- Customer notes
- Commercial scoring
- Contact logs
- Quote history

Current assumption: public/sample vessel data only.

## GitHub Actions Requirements

Workflows must:

- Survive source failures
- Use timeout protections
- Avoid empty snapshot publishing
- Preserve last valid state
- Allow slow npm install
- Keep update runtime bounded

Runtime targets:

- `npm install`: <= 30 minutes acceptable
- `npm run update`: target <= 6 minutes
- `npm run validate`: <= 2 minutes
- `npm run health`: <= 7 minutes

## Current Backend State

Approximate status:

- Architecture: 70-80%
- Real operational data integration: 35-45%

## Most Important Next Steps

1. Real source normalization
2. Snapshot accumulation
3. Candidate accuracy
4. Frontend operationalization

Frontend work can include heatmaps, candidate queues, timeline diff, port risk layers, and operational views later, but it is not the primary product.

## Codex Working Rules

When modifying the repo:

- Keep backend stability first.
- Prefer incremental safe improvements.
- Do not introduce unnecessary dependencies.
- Preserve the public-data-first approach.
- Keep paid AIS optional only.
- Preserve existing workflow safety guards.
- Never allow sample data to appear as commercial-ready.
- Prioritize candidate detection accuracy, runtime stability, collector reliability, and snapshot integrity over UI cosmetics.

Run before proposing changes:

```powershell
npm install
npm run update
npm run validate
npm run health
```
