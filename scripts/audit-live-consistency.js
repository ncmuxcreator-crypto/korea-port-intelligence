#!/usr/bin/env node

import { scanLiveConsistency } from "./lib/live-consistency-scan.js";

const report = scanLiveConsistency({ writeReport: false });

console.log("Live consistency audit");
console.log("======================");
console.log(`status=${report.status}`);
console.log(`status_summary_run_id=${report.tier_pointer_status.status_summary_run_id || "-"}`);
console.log(`update_tiers_core_run_id=${report.tier_pointer_status.update_tiers_core_run_id || "-"}`);
console.log(`core_pointer_matches_status_summary=${report.tier_pointer_status.core_pointer_matches_status_summary}`);
console.log(`core_pointer_source=${report.tier_pointer_status.core_pointer_source || "-"}`);
console.log(`local_run_promoted_over_production=${report.tier_pointer_status.local_run_promoted_over_production}`);
console.log(`pilotage_output_count=${report.output_scan_counts.pilotage_signal_display_count}`);
console.log(`aux_confirmed_berth_count=${report.output_scan_counts.aux_confirmed_berth_count}`);
console.log(`baseline_berth_count=${report.output_scan_counts.baseline_berth_count}`);
console.log(`berth_placeholders=${report.output_scan_counts.berth_placeholders}`);
console.log(`count_inconsistencies=${report.count_inconsistencies_found.length ? report.count_inconsistencies_found.join(",") : "none"}`);
console.log(`remaining_blockers=${report.remaining_blockers.length}`);

for (const issue of report.critical_issues) console.log(`CRITICAL: ${issue}`);
for (const warning of report.warnings) console.log(`WARNING: ${warning}`);
console.log(`recommended_fix=${report.recommended_fix}`);

if (report.critical_issues.length) process.exit(1);
