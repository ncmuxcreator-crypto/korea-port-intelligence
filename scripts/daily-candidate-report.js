import fs from "node:fs";
import { baseDatasetFields, getBaseDatasetState, markDerivedReport, rowsFromJson } from "./lib/dataset-state.js";
const path="dashboard/api/vessels.json";
const data=fs.existsSync(path)?JSON.parse(fs.readFileSync(path,"utf8")):[];
const datasetState=getBaseDatasetState();
const vessels=rowsFromJson(data);
const report = markDerivedReport({
  version: "17.7.0",
  generatedAt: new Date().toISOString(),
  ...baseDatasetFields(datasetState),
  ok: !datasetState.base_dataset_empty,
  total: vessels.length,
  contact72h: vessels.filter(v => ["0-24h","24-72h"].includes(v.contact_window)).length,
  top: vessels.slice(0,10)
}, datasetState);
fs.mkdirSync("dashboard/api",{recursive:true});
fs.writeFileSync("dashboard/api/daily-candidate-report-runtime.json", JSON.stringify(report,null,2));
console.log("Daily candidate report generated");
