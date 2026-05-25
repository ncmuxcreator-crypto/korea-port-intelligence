import fs from "fs";

const required = [
  "data/latest-lite.json",
  "data/pipeline-report.json",
  "dashboard/api/vessels.json",
  "dashboard/api/status.json",
  "dashboard/index.html",
  "dashboard/api/candidates.json",
  "dashboard/api/backend-ops.json",
  "dashboard/api/candidate-changes.json",
  ".github/workflows/longterm-update.yml"
];

for (const file of required) {
  if (!fs.existsSync(file)) {
    throw new Error(`Missing required output: ${file}`);
  }
}

const data = JSON.parse(fs.readFileSync("data/latest-lite.json", "utf8"));
const report = JSON.parse(fs.readFileSync("data/pipeline-report.json", "utf8"));
const vessels = JSON.parse(fs.readFileSync("dashboard/api/vessels.json", "utf8"));

if (!Array.isArray(data)) {
  throw new Error("Invalid latest-lite.json");
}

if (!report.status || typeof report.record_count !== "number") {
  throw new Error("Invalid pipeline-report.json");
}

for (const item of data) {
  if (!item.vessel_id || !item.vessel_name || !item.port) {
    throw new Error("Missing required vessel fields");
  }
}

const priorityPorts = report?.data_strategy?.priority_ports || [];
const requiredPriorityPorts = ["Busan", "Yeosu/Gwangyang", "Ulsan", "Pyeongtaek-Dangjin", "Hadong/Samcheonpo", "Pohang"];
for (const port of requiredPriorityPorts) {
  if (!priorityPorts.includes(port)) {
    throw new Error(`Missing priority port in data strategy: ${port}`);
  }
}

if (report.data_mode === "sample_only" && report?.candidate_ops?.current_candidate_count !== 0) {
  throw new Error("Sample-only mode must not expose operating candidates");
}

for (const vessel of vessels) {
  const isSample = String(vessel.source_mode || "").includes("sample");
  if (isSample && vessel.commercial_use_status !== "do_not_use_for_outreach") {
    throw new Error(`Sample vessel is not blocked from outreach: ${vessel.vessel_name || vessel.vessel_id}`);
  }
  if (isSample && (vessel.is_operating_candidate || vessel.is_operating_immediate_candidate)) {
    throw new Error(`Sample vessel is exposed as operating candidate: ${vessel.vessel_name || vessel.vessel_id}`);
  }
}



const status = JSON.parse(fs.readFileSync("dashboard/api/status.json", "utf8"));
if (!status.candidate_ops || !status.backend_health || !status.seven_pack_summary) {
  throw new Error("Missing stability bundle outputs");
}
if (!status.backend_stability_batch || !status.runtime_budget || !status.master_db_roadmap) {
  throw new Error("Missing v17.7 backend stability batch outputs");
}

const workflow = fs.readFileSync(".github/workflows/longterm-update.yml", "utf8");
if (!/on:\s*[\s\S]*workflow_dispatch:/.test(workflow) || !/schedule:/.test(workflow)) {
  throw new Error("Workflow trigger configuration is incomplete");
}
if (!workflow.includes("ULSAN_BERTH_DETAIL_API_KEY") || !workflow.includes("YGPA_ARRIVAL_API_KEY")) {
  throw new Error("Workflow public API secret coverage is incomplete");
}

console.log("[HWK] validation success");
