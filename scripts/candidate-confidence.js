import fs from "node:fs";
import { baseDatasetFields, getBaseDatasetState, markDerivedReport, rowsFromJson } from "./lib/dataset-state.js";
const path = "dashboard/api/vessels.json";
const data = fs.existsSync(path) ? JSON.parse(fs.readFileSync(path, "utf8")) : [];
const datasetState = getBaseDatasetState();
const vessels = rowsFromJson(data);
const report = markDerivedReport({
  version: "17.7.0",
  generatedAt: new Date().toISOString(),
  ...baseDatasetFields(datasetState),
  ok: !datasetState.base_dataset_empty,
  bands: {
    operational: vessels.filter(v => Number(v.candidate_confidence_score || 0) >= 85).length,
    verify: vessels.filter(v => Number(v.candidate_confidence_score || 0) >= 70 && Number(v.candidate_confidence_score || 0) < 85).length,
    diagnostic: vessels.filter(v => Number(v.candidate_confidence_score || 0) < 70).length
  }
}, datasetState);
fs.mkdirSync("dashboard/api", { recursive: true });
fs.writeFileSync("dashboard/api/candidate-confidence-runtime.json", JSON.stringify(report, null, 2));
console.log("Candidate confidence generated");
