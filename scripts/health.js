import fs from "node:fs";
import { spawnSync } from "node:child_process";

const checks = [
  "doctor",
  "candidate:audit",
  "coverage:audit",
  "risk:calibrate",
  "candidate:explain",
  "snapshot:guard",
  "source:health",
  "candidate:dedupe",
  "candidate:window",
  "collector:plan",
  "pipeline:sla",
  "candidate:daily",
  "readiness:gate",
  "candidate:confidence",
  "snapshot:diff"
];

function readJson(path, fallback = {}) {
  try {
    return fs.existsSync(path) ? JSON.parse(fs.readFileSync(path, "utf8")) : fallback;
  } catch {
    return fallback;
  }
}

function runNpmScript(name) {
  const npmCli = process.env.npm_execpath;
  const command = npmCli ? process.execPath : process.platform === "win32" ? "npm.cmd" : "npm";
  const args = npmCli ? [npmCli, "run", name] : ["run", name];
  return spawnSync(command, args, {
    stdio: "inherit",
    shell: false,
    env: {
      ...process.env,
      KPI_HEALTH_PARENT: "1"
    }
  }).status || 0;
}

const validationMode = String(process.env.VALIDATION_MODE || (process.env.CI === "true" ? "production" : "local")).toLowerCase();
const failures = [];

for (const check of checks) {
  const status = runNpmScript(check);
  if (status !== 0) failures.push({ check, status });
}

const runtimeStatus = readJson("dashboard/api/status.json", {});
const localNoLiveData = validationMode !== "production" && String(runtimeStatus.data_mode || "").toLowerCase() === "no_live_data";

if (failures.length && !localNoLiveData) {
  console.error("[Korea Port Intelligence] health failed", failures);
  process.exit(1);
}

if (failures.length && localNoLiveData) {
  console.warn("[Korea Port Intelligence] health diagnostics completed with local no-live-data warnings", failures);
} else {
  console.log("[Korea Port Intelligence] health checks passed");
}
