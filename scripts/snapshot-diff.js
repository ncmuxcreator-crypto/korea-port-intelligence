import fs from "node:fs";
const report = {
  version: "17.7.0",
  generatedAt: new Date().toISOString(),
  mode: "placeholder_until_history",
  categories: ["new_candidate","tier_upgraded","score_jump_10plus","port_changed","stale_candidate","candidate_removed"],
  ok: true
};
fs.mkdirSync("dashboard/api", { recursive: true });
fs.writeFileSync("dashboard/api/snapshot-diff-runtime.json", JSON.stringify(report, null, 2));
console.log("Snapshot diff generated");
