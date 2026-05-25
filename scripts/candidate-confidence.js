import fs from "node:fs";
const path = "dashboard/api/vessels.json";
const data = fs.existsSync(path) ? JSON.parse(fs.readFileSync(path, "utf8")) : [];
const vessels = Array.isArray(data) ? data : (data.vessels || data.items || data.data || []);
const report = {
  version: "17.7.0",
  generatedAt: new Date().toISOString(),
  bands: {
    operational: vessels.filter(v => Number(v.candidate_confidence_score || 0) >= 85).length,
    verify: vessels.filter(v => Number(v.candidate_confidence_score || 0) >= 70 && Number(v.candidate_confidence_score || 0) < 85).length,
    diagnostic: vessels.filter(v => Number(v.candidate_confidence_score || 0) < 70).length
  }
};
fs.mkdirSync("dashboard/api", { recursive: true });
fs.writeFileSync("dashboard/api/candidate-confidence-runtime.json", JSON.stringify(report, null, 2));
console.log("Candidate confidence generated");
