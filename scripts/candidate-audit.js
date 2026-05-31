import fs from "node:fs";
import { baseDatasetFields, getBaseDatasetState, markDerivedReport, rowsFromJson } from "./lib/dataset-state.js";

const path = "dashboard/api/vessels.json";
const vessels = fs.existsSync(path) ? JSON.parse(fs.readFileSync(path, "utf8")) : [];
const datasetState = getBaseDatasetState();
const list = rowsFromJson(vessels);

const counts = {
  total: list.length,
  immediate: 0,
  strong: 0,
  watch: 0,
  low: 0,
  missingImo: 0,
  missingPort: 0
};

for (const v of list) {
  const tier = v.candidate_tier || v.priority_tier || "low";
  if (/immediate/i.test(tier)) counts.immediate++;
  else if (/strong|high/i.test(tier)) counts.strong++;
  else if (/watch/i.test(tier)) counts.watch++;
  else counts.low++;

  if (!v.imo && !v.mmsi) counts.missingImo++;
  if (!v.port && !v.current_port && !v.location) counts.missingPort++;
}

const report = markDerivedReport({
  version: "17.7.0",
  generatedAt: new Date().toISOString(),
  ...baseDatasetFields(datasetState),
  counts,
  status: datasetState.base_dataset_empty ? "empty_dataset" : list.length > 0 ? "ok" : "empty",
  ok: !datasetState.base_dataset_empty
}, datasetState);

fs.mkdirSync("dashboard/api", { recursive: true });
fs.writeFileSync("dashboard/api/candidate-audit.json", JSON.stringify(report, null, 2));

if (!list.length) {
  console.warn("Candidate audit warning: no vessels found.");
}
console.log("Candidate audit completed");
