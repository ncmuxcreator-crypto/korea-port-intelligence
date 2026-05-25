# Candidate Scoring v2

## Main factors
- Port tier and port-specific weight.
- Idle/anchorage duration.
- Vessel segment.
- Biofouling-sensitive destination.
- Data confidence.

## Important rule
Sample data cannot become Immediate. It is capped below 80 to prevent false urgency.

## Output
- Immediate: contact within 24h.
- Strong: verify and contact within 72h.
- Watch: monitor next snapshot.
- Low: archive only.
