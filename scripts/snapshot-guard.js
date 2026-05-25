import fs from "node:fs";

const required = [
  "dashboard/api/vessels.json",
  "dashboard/api/candidate-summary.json",
  "dashboard/api/contact-queue.json"
];

const report = {
  version: "17.7.0",
  generatedAt: new Date().toISOString(),
  required,
  missing: [],
  empty: [],
  ok: true
};

for (const file of required) {
  if (!fs.existsSync(file)) {
    report.missing.push(file);
    report.ok = false;
    continue;
  }
  const stat = fs.statSync(file);
  if (stat.size === 0) {
    report.empty.push(file);
    report.ok = false;
  }
}

fs.mkdirSync("dashboard/api", { recursive: true });
fs.writeFileSync("dashboard/api/snapshot-guard.json", JSON.stringify(report, null, 2));

if (!report.ok) {
  console.error("Snapshot guard failed", report);
  process.exit(1);
}

console.log("Snapshot guard passed");
