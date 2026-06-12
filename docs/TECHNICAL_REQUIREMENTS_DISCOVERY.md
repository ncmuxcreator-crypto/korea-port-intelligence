# Technical Requirements Discovery

Generated at: 2026-06-12T12:02:47.754Z

## Requirements

### data collection requirements

- Required env names must be reported as present/missing without secret values.
- Collectors need response size guards, retry/timeout policy, fallback cache, and source health logging.
- Auxiliary sources must not block core dashboard generation.

### normalization requirements

- Maintain field alias maps for Korean/English source labels.
- Parse date+time and preserve time-only values without inserting invalid timestamptz.
- Normalize vessel name, call sign, port labels, GT/DWT numeric fields.

### matching requirements

- Use IMO/MMSI/call_sign exact match first.
- Use vessel_name + port + time window for operational sources.
- Route fuzzy and low-confidence matches to review queue.

### enrichment requirements

- Keep source priority by field group.
- Track field-level confidence and data lineage.
- Auto-apply only high-confidence missing fields; never overwrite manual/verified values blindly.

### storage requirements

- Keep latest successful run and active dataset pointer.
- Use source cache retention for auxiliary sources.
- Split summary/detail JSON and paginate large vessel endpoints.

### ui surfacing requirements

- Business summaries first; diagnostics separated.
- Lazy-load detail endpoints.
- Use Korean labels for business-facing fields.

### validation audit requirements

- audit:actionability
- audit:agents
- audit:biofouling
- audit:classification-consistency
- audit:cleaning-window
- audit:commercial-confidence
- audit:compliance
- audit:compliance-exposure
- audit:contact-coverage
- audit:contacts
- audit:conversion
- audit:data
- audit:data-lineage
- audit:data-quality
- audit:data-utilization
- audit:db
- audit:db-cleanup
- audit:discovery
- audit:drydock
- audit:endpoint-parse
- audit:endpoints
- audit:enrichment
- audit:enrichment-engine
- audit:enrichment-review
- audit:enrichment-utilization
- audit:executive
- audit:features
- audit:fleet-clusters
- audit:fleet-dna
- audit:fleet-expansion
- audit:fleet-gaps
- audit:fleet-heatmap
- audit:fleet-intelligence
- audit:fleet-memory
- audit:fleet-penetration
- audit:identity-sources
- audit:integration
- audit:json-writes
- audit:korea-presence
- audit:load-strategy
- audit:lost-reasons
- audit:match-review
- audit:missed-opportunities
- audit:normalize
- audit:normalize-output
- audit:operators
- audit:opportunity-decay
- audit:opportunity-memory
- audit:performance
- audit:pilotage
- audit:pnc-berth
- audit:port-dna
- audit:port-seasonality
- audit:ports
- audit:private-data
- audit:quote-opportunities
- audit:raw-json
- audit:relationships
- audit:repeat-callers
- audit:revenue
- audit:security
- audit:service-bundles
- audit:snapshot-consistency
- audit:source-cache
- audit:source-csv
- audit:source-enrichment-matrix
- audit:source-quality
- audit:source-schedule
- audit:sources
- audit:superintendents
- audit:target-categories
- audit:targets
- audit:tonnage-threshold
- audit:truth
- audit:ui
- audit:vessel-counts
- audit:vessel-display
- audit:vessel-fields
- audit:vessel-list-ui
- audit:vessel-pages
- audit:vessel-spec
- audit:vessel-timeline
- audit:vessels
- audit:watchlist
- audit:win-probability
- discover:features-and-apis
- plan:db-cleanup

## Existing Audit / Discovery Commands

| Command |
| --- |
| audit:actionability |
| audit:agents |
| audit:biofouling |
| audit:classification-consistency |
| audit:cleaning-window |
| audit:commercial-confidence |
| audit:compliance |
| audit:compliance-exposure |
| audit:contact-coverage |
| audit:contacts |
| audit:conversion |
| audit:data |
| audit:data-lineage |
| audit:data-quality |
| audit:data-utilization |
| audit:db |
| audit:db-cleanup |
| audit:discovery |
| audit:drydock |
| audit:endpoint-parse |
| audit:endpoints |
| audit:enrichment |
| audit:enrichment-engine |
| audit:enrichment-review |
| audit:enrichment-utilization |
| audit:executive |
| audit:features |
| audit:fleet-clusters |
| audit:fleet-dna |
| audit:fleet-expansion |
| audit:fleet-gaps |
| audit:fleet-heatmap |
| audit:fleet-intelligence |
| audit:fleet-memory |
| audit:fleet-penetration |
| audit:identity-sources |
| audit:integration |
| audit:json-writes |
| audit:korea-presence |
| audit:load-strategy |
| audit:lost-reasons |
| audit:match-review |
| audit:missed-opportunities |
| audit:normalize |
| audit:normalize-output |
| audit:operators |
| audit:opportunity-decay |
| audit:opportunity-memory |
| audit:performance |
| audit:pilotage |
| audit:pnc-berth |
| audit:port-dna |
| audit:port-seasonality |
| audit:ports |
| audit:private-data |
| audit:quote-opportunities |
| audit:raw-json |
| audit:relationships |
| audit:repeat-callers |
| audit:revenue |
| audit:security |
| audit:service-bundles |
| audit:snapshot-consistency |
| audit:source-cache |
| audit:source-csv |
| audit:source-enrichment-matrix |
| audit:source-quality |
| audit:source-schedule |
| audit:sources |
| audit:superintendents |
| audit:target-categories |
| audit:targets |
| audit:tonnage-threshold |
| audit:truth |
| audit:ui |
| audit:vessel-counts |
| audit:vessel-display |
| audit:vessel-fields |
| audit:vessel-list-ui |
| audit:vessel-pages |
| audit:vessel-spec |
| audit:vessel-timeline |
| audit:vessels |
| audit:watchlist |
| audit:win-probability |
| discover:features-and-apis |
| plan:db-cleanup |

## Referenced But Missing Commands

- audit:hidden-features
- audit:feature-revival
