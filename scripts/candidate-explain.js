import fs from "node:fs";
import { baseDatasetFields, getBaseDatasetState, markDerivedReport, rowsFromJson } from "./lib/dataset-state.js";

const path = "dashboard/api/vessels.json";
const vessels = fs.existsSync(path) ? JSON.parse(fs.readFileSync(path, "utf8")) : [];
const datasetState = getBaseDatasetState();
const list = rowsFromJson(vessels);

const explanations = list.slice(0, 50).map((v, idx) => ({
  rank: v.rank || idx + 1,
  vessel_name: v.vessel_name || v.name || "Unknown",
  imo: v.imo || null,
  port: v.port || v.current_port || v.location || null,
  score: v.candidate_score || 0,
  tier: v.candidate_tier || "Low",
  contact_priority: v.contact_priority || "No action",
  reasons: v.candidate_reasons || [],
  recommended_action: v.recommended_action || "No action"
}));

fs.mkdirSync("dashboard/api", { recursive: true });
fs.writeFileSync("dashboard/api/candidate-explanations.json", JSON.stringify(markDerivedReport({
  version: "17.7.0",
  generatedAt: new Date().toISOString(),
  ...baseDatasetFields(datasetState),
  ok: !datasetState.base_dataset_empty,
  explanations
}, datasetState), null, 2));

console.log("Candidate explanations generated");
