import fs from "node:fs";
import { baseDatasetFields, getBaseDatasetState, markDerivedReport, rowsFromJson } from "./lib/dataset-state.js";

const path = "dashboard/api/vessels.json";
const vessels = fs.existsSync(path) ? JSON.parse(fs.readFileSync(path, "utf8")) : [];
const datasetState = getBaseDatasetState();
const validationMode = String(process.env.VALIDATION_MODE || (process.env.CI === "true" ? "production" : "local")).toLowerCase();
const list = rowsFromJson(vessels);

let report = {
  version: "17.7.0",
  generatedAt: new Date().toISOString(),
  total: list.length,
  ...baseDatasetFields(datasetState),
  scoreBands: { immediate: 0, strong: 0, watch: 0, low: 0 },
  sampleImmediateViolations: [],
  ok: !datasetState.base_dataset_empty
};

for (const v of list) {
  const score = Number(v.cleaning_candidate_score || v.candidate_score || 0);
  const confidence = String(v.confidence || v.data_confidence || "").toLowerCase();
  const sourceMode = String(v.source_mode || "").toLowerCase();
  const commercialUse = String(v.commercial_use_status || "").toLowerCase();
  if (score >= 80) report.scoreBands.immediate++;
  else if (score >= 65) report.scoreBands.strong++;
  else if (score >= 45) report.scoreBands.watch++;
  else report.scoreBands.low++;

  if ((confidence.includes("sample") || sourceMode.includes("sample")) && score >= 80 && commercialUse !== "do_not_use_for_outreach") {
    report.sampleImmediateViolations.push(v.imo || v.vessel_name || v.name || "unknown");
    report.ok = false;
  }
}
report = markDerivedReport(report, datasetState);

fs.mkdirSync("dashboard/api", { recursive: true });
fs.writeFileSync("dashboard/api/risk-calibration.json", JSON.stringify(report, null, 2));

if (!report.ok && (!datasetState.base_dataset_empty || validationMode === "production")) {
  console.error("Risk calibration failed", report);
  process.exit(1);
}

if (!report.ok) console.warn("Risk calibration derived from empty dataset", report);
else console.log("Risk calibration passed");
