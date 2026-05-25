import fs from "node:fs";

const requiredFiles = [
  "package.json",
  ".github/workflows/longterm-update.yml",
  "dashboard/api/vessels.json",
  "dashboard/api/candidate-summary.json",
  "dashboard/api/coverage-registry.json"
];

const requiredSecrets = [
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "MOF_AIS_DYNAMIC_API_URL",
  "MOF_AIS_DYNAMIC_SERVICE_KEY",
  "MOF_VTS_API_BASE",
  "MOF_VTS_SERVICE_KEY",
  "VESSEL_SPEC_SERVICE_KEY",
  "PORT_OPERATION_SERVICE_KEY"
];

const report = {
  ok: true,
  checkedAt: new Date().toISOString(),
  files: {},
  secrets: {},
  notes: []
};

for (const f of requiredFiles) {
  const exists = fs.existsSync(f);
  report.files[f] = exists ? "ok" : "missing";
  if (!exists) report.ok = false;
}

for (const s of requiredSecrets) {
  report.secrets[s] = process.env[s] ? "configured" : "missing_or_not_in_ci";
}

fs.mkdirSync("dashboard/api", { recursive: true });
fs.writeFileSync("dashboard/api/backend-doctor.json", JSON.stringify(report, null, 2));

if (!report.ok) {
  console.error("Backend doctor failed", report);
  process.exit(1);
}

console.log("Backend doctor passed");
