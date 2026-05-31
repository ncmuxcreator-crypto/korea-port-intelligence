import fs from "node:fs";
import { baseDatasetFields, getBaseDatasetState, markDerivedReport } from "./lib/dataset-state.js";

const datasetState = getBaseDatasetState();
const report = markDerivedReport({
  version: "17.7.0",
  generatedAt: new Date().toISOString(),
  ...baseDatasetFields(datasetState),
  ok: !datasetState.base_dataset_empty,
  budgets: { updateMinutes: 6, validateMinutes: 2, healthMinutes: 6 },
  note: "This script records runtime budgets; it does not call external APIs."
}, datasetState);
fs.mkdirSync("dashboard/api",{recursive:true});
fs.writeFileSync("dashboard/api/pipeline-sla-runtime.json", JSON.stringify(report,null,2));
console.log("Pipeline SLA generated");
