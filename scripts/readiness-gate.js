import fs from "node:fs";
const path = "dashboard/api/vessels.json";
const data = fs.existsSync(path) ? JSON.parse(fs.readFileSync(path, "utf8")) : [];
const vessels = Array.isArray(data) ? data : (data.vessels || data.items || data.data || []);
const report = {
  version: "17.7.0",
  generatedAt: new Date().toISOString(),
  total: vessels.length,
  salesReady: vessels.filter(v => v.commercial_use_status === "sales_review_ready").length,
  blockedSample: vessels.filter(v => v.commercial_use_status === "do_not_use_for_outreach").length,
  sampleImmediateBlocked: vessels.filter(v => v.commercial_use_status === "do_not_use_for_outreach" && v.is_immediate_candidate).length,
  operatingImmediate: vessels.filter(v => v.is_operating_immediate_candidate).length,
  ok: vessels.every(v => !String(v.source_mode || "").includes("sample") || v.commercial_use_status === "do_not_use_for_outreach"),
  note: "This gate prevents sample records from being treated as real candidates."
};
fs.mkdirSync("dashboard/api", { recursive: true });
fs.writeFileSync("dashboard/api/readiness-gate-runtime.json", JSON.stringify(report, null, 2));
console.log("Readiness gate generated");
