import fs from "node:fs";

const coveragePath = "dashboard/api/coverage-registry.json";
const coverage = fs.existsSync(coveragePath) ? JSON.parse(fs.readFileSync(coveragePath, "utf8")) : {};
const tier1 = coverage.tier_1 || [];
const tier2 = coverage.tier_2 || [];

const requiredTier1 = ["Busan", "Yeosu/Gwangyang", "Ulsan", "Pyeongtaek-Dangjin", "Hadong/Samcheonpo", "Pohang"];
const present = new Set(tier1.map((p) => p.port));
const missing = requiredTier1.filter((p) => !present.has(p));

const report = {
  version: "17.7.0",
  generatedAt: new Date().toISOString(),
  tier1Count: tier1.length,
  tier2Count: tier2.length,
  missingRequiredTier1: missing,
  ok: missing.length === 0
};

fs.mkdirSync("dashboard/api", { recursive: true });
fs.writeFileSync("dashboard/api/coverage-audit.json", JSON.stringify(report, null, 2));

if (!report.ok) {
  console.error("Coverage audit failed", report);
  process.exit(1);
}

console.log("Coverage audit passed");
