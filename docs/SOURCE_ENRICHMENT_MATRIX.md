# Source Enrichment Capability Matrix

This document defines which source can enrich which vessel, operational, and commercial fields in Korea Port Intelligence.

The enrichment path is:

Raw Source Rows -> Normalized Source Rows -> Source Reference Index -> Match Engine -> Enrichment Patch -> Vessel Display / Sales Actions / Targets / Watchlist

## Safety Rules

- Do not overwrite trusted vessel fields blindly.
- Do not auto-apply name-only IMO/MMSI matches.
- Apply automatically only when match confidence is high and the target field is empty, or the candidate value is materially higher quality.
- Manual, verified, or high-confidence existing fields must go to review if there is a conflict.
- Weak matches are review candidates, not product data.
- Personal pilot contact details must not be exposed.

## Matrix

| Source | Match Keys | Enrichable Fields | Trust Level | Update Policy | Conflict Policy | Current Blocker |
| --- | --- | --- | --- | --- | --- | --- |
| port_operation | call_sign, vessel_name, normalized_vessel_name, port, eta, ata, port_call_id | vessel_name, call_sign, current_port, current_port_korean, berth, eta, etb, ata, atb, etd, atd, stay_hours, vessel_type, gt | HIGH | TIER_0_CORE_EVERY_UPDATE | Apply missing operational timing and port fields. Review conflicts with verified identity or manually confirmed values. | Usually none when port operation is active. |
| source_csv | IMO, MMSI, call_sign, vessel_name, normalized_vessel_name, normalized_vessel_name+call_sign, normalized_vessel_name+gt+vessel_type | imo, mmsi, call_sign, operator_display, owner, manager, vessel_type, gt, dwt, flag, fleet_group | HIGH_IF_VERIFIED | TIER_2_AUXILIARY_CACHE_USE_LAST_SUCCESS_ON_FAILURE | Verified rows can fill missing values. Do not overwrite manual or higher-confidence identifiers; send conflicts to review. | Current source may be SOURCE_TOO_LARGE; use a lightweight verified reference CSV. |
| pilot_sources | call_sign, vessel_name, normalized_vessel_name, port, pilot_time, time_window | pilotage_signal, pilotage_time, pilotage_time_text, pilot_station, pilotage_direction, arrival_departure_timing_signal | HIGH_FOR_TIMING | TIER_1_HIGH_VALUE_AUXILIARY_EACH_PRIORITY_RUN | Auto-apply exact call sign or high-confidence name+port+time matches. Send weak name-only matches to review. | Match quality depends on call sign/name/port/time availability. |
| berth_sources | call_sign, vessel_name, normalized_vessel_name, port, berth, time_window | berth_signal, berth, terminal, etb, atb, operation_status, berth_timing_signal | MEDIUM_HIGH | TIER_1_HIGH_VALUE_AUXILIARY_EACH_PRIORITY_RUN | Apply missing berth/terminal fields on high-confidence match. Review conflicts with newer port operation values. | Parser and matching quality determine utilization. |
| PNC_SOURCE_URLS | call_sign, vessel_name, normalized_vessel_name, port, time_window, berth | berth, terminal, operator_display, route, operation_status, berth_signal | MEDIUM_HIGH | TIER_1_HIGH_VALUE_AUXILIARY_CACHE | Prefer for berth and terminal. Use operator values as fallback only when current operator_display is missing. | Shares utilization with berth/PNC source status. |
| mof_ais_info | MMSI, IMO, call_sign, vessel_name | imo, mmsi, call_sign, vessel_name, vessel_type, flag, gt, dwt | HIGH_FOR_IDENTITY | TIER_1_HIGH_VALUE_TARGETED_ENRICHMENT | Fill missing identifiers on exact key match. Do not overwrite existing non-empty identifiers unless verified confidence is higher. | Current collection can be smoke-level if row count is low. |
| mof_ais_dynamic | MMSI, call_sign, vessel_name+time_window | last_seen_at, lat, lon, speed, course, destination, anchorage_signal, slow_steaming_signal | MEDIUM_HIGH_FOR_POSITION | TIER_2_TARGETED_SALES_TARGETS_FIRST | Use as fresh movement signal. Do not override port operation berth/timing without stronger timestamp evidence. | Expand gradually: sales targets first, then detail eligible top 100. |
| mof_ais_stat | MMSI, IMO, port, vessel_name | repeat_caller_signal, korea_presence_score, dwell_history, route_signal, commercial_frequency_signal | MEDIUM | TIER_2_MEDIUM_FREQUENCY_CACHE | Use for aggregate behavior and repeat-caller signals. Do not overwrite vessel identity fields from statistics alone. | Optional until statistics source is active. |
| vessel_spec | IMO, MMSI, call_sign, normalized_vessel_name+gt+vessel_type | imo, mmsi, call_sign, vessel_type, gt, dwt, flag, loa, beam, tonnage_summary | HIGH_FOR_SPEC | TIER_2_AUXILIARY_TARGETED_CACHE | Prefer for vessel specification when parser output is normalized. Send inconsistent GT/DWT/identity values to review. | If HTTP 200 but normalized rows are 0, parser aliases need adjustment. |
| VTS | MMSI, call_sign, vessel_name, lat_lon_time_window, port_area | last_seen_at, anchorage, anchorage_signal, waiting_hours, slow_steaming_hours, congestion_signal | MEDIUM | TIER_2_OPTIONAL_CACHE_WHEN_CONFIGURED | Use for movement and waiting signals only. Review identity enrichment unless MMSI/call_sign is exact. | Not configured or not collected as a standalone source in the current snapshot. |
| port_facility | port_code, port_name, berth, terminal, facility_name | port_facility_context, berth_context, terminal_context, cargo_context, port_capacity_signal | MEDIUM | TIER_3_LOW_FREQUENCY_REFERENCE_CACHE | Use as reference context for port/berth labels. Do not overwrite vessel-level operational fields. | Not configured or covered indirectly by operational sources. |

## Current Utilization

The generated JSON at `dashboard/api/enrichment/source-capability-matrix.json` contains current utilization per source:

- configuration and attempt status
- rows collected and normalized
- rows matched to vessels
- fields contributed
- quality label and utilization score
- blocker reason and recommended fix

Use `npm run audit:source-enrichment-matrix` to print the current matrix and catch missing or malformed capability definitions.

## Recommended Next Steps

- Keep `port_operation` as the core source for current port and operational timing.
- Keep `source_csv` auxiliary and cache-based; replace oversized input with a smaller verified reference CSV.
- Use `pilot_sources` and `berth_sources` for timing/berth confidence, with medium and weak matches routed to review.
- Expand MOF AIS enrichment gradually: sales targets first, then detail eligible top 100.
- Treat `VTS`, `mof_ais_stat`, and `port_facility` as optional/reference sources until collectors provide normalized rows.
