import fs from "node:fs";

const path = "dashboard/api/vessels.json";
const vessels = fs.existsSync(path) ? JSON.parse(fs.readFileSync(path, "utf8")) : [];
const list = Array.isArray(vessels) ? vessels : (vessels.vessels || vessels.items || vessels.data || []);

const report = {
  version: "17.7.0",
  generatedAt: new Date().toISOString(),
  total: list.length,
  scoreBands: { immediate: 0, strong: 0, watch: 0, low: 0 },
  sampleImmediateViolations: [],
  ok: true
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

fs.mkdirSync("dashboard/api", { recursive: true });
fs.writeFileSync("dashboard/api/risk-calibration.json", JSON.stringify(report, null, 2));

if (!report.ok) {
  console.error("Risk calibration failed", report);
  process.exit(1);
}

console.log("Risk calibration passed");
