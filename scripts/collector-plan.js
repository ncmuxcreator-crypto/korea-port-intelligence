import fs from "node:fs";
const plan = {
  version: "17.7.0",
  generatedAt: new Date().toISOString(),
  status: "ready",
  sequence: ["source_health","vessel_spec","port_operation","mof_ais_dynamic","candidate_engine","snapshot_guard"],
  target: "fast cleaning candidate detection"
};
fs.mkdirSync("dashboard/api",{recursive:true});
fs.writeFileSync("dashboard/api/collector-plan-runtime.json", JSON.stringify(plan,null,2));
console.log("Collector plan generated");
