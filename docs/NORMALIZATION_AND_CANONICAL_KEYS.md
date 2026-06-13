# Normalization and Canonical Keys

Generated at: 2026-06-13T05:25:49.563Z

## Policy

- Port-MIS / port_operation call_sign is the canonical call sign for current Korean port vessels.
- Auxiliary sources must normalize their raw call sign and match canonical_call_sign before vessel-name matching.
- PNC 모선코드 is terminal_vessel_code, not call_sign, unless it exactly matches canonical_call_sign.
- Fuzzy vessel-name-only matches are review queue items, not auto-apply candidates.

## Matching Hierarchy

1. IMO exact
2. MMSI exact
3. canonical_call_sign exact
4. canonical_call_sign + port_code
5. canonical_call_sign + port_code + time window
6. normalized_vessel_name + canonical_call_sign
7. normalized_vessel_name + port_code + time window
8. fuzzy vessel name only -> review queue

## Current Coverage

- Core vessels: 992
- Core vessels with canonical_call_sign: 992
- Auxiliary rows checked: 0
- Auxiliary rows with normalized_call_sign: 0
- Matches by canonical_call_sign evidence: 0
- Duplicate call sign groups: 0

## Shared Module

- scripts/lib/normalize.js

## PNC

- PNC vessel code is treated as terminal_vessel_code; it is not promoted to call_sign unless it equals canonical_call_sign.
