#!/usr/bin/env node

import { REPORT_JSON, REPORT_MD, scanLiveConsistency } from "./lib/live-consistency-scan.js";

const report = scanLiveConsistency({ writeReport: true });

console.log("Vessel display propagation verification");
console.log("=======================================");
console.log(`status=${report.status}`);
console.log(`pilotage_confirmed=${report.output_scan_counts.pilotage_signal_display_count}`);
console.log(`aux_confirmed_berth=${report.output_scan_counts.aux_confirmed_berth_count}`);
console.log(`baseline_berth=${report.output_scan_counts.baseline_berth_count}`);
console.log(`berth_placeholders=${report.output_scan_counts.berth_placeholders}`);
console.log(`critical_issues=${report.critical_issues.length}`);
console.log(`warnings=${report.warnings.length}`);
console.log(`report=${REPORT_JSON}`);
console.log(`doc=${REPORT_MD}`);

if (report.critical_issues.length) process.exit(1);
