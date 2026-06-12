import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const tier = String(process.argv[2] || "").toLowerCase();
const filePath = path.join(ROOT, "dashboard", "api", "runtime", "update-tiers.json");
const allowed = new Set(["discovery_audit"]);

if (!allowed.has(tier)) {
  console.error(`Unsupported tier stamp: ${tier || "(empty)"}`);
  process.exit(1);
}

function readJson(file, fallback = {}) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function compactTimestamp(date = new Date()) {
  return date.toISOString().replace(/\D/g, "").slice(0, 17);
}

const generatedAt = new Date().toISOString();
const githubRunId = process.env.GITHUB_RUN_ID ? String(process.env.GITHUB_RUN_ID) : "";
const runId = githubRunId ? `github_${githubRunId}` : `manual_${compactTimestamp()}`;
const generatedBy = process.env.GITHUB_ACTIONS === "true" ? "github_actions" : "local";
const previous = readJson(filePath, {});

const next = {
  schema_version: previous.schema_version || "1.0",
  ...previous,
  generated_at: generatedAt,
  owner_tier: "core",
  core_may_update: true,
  update_mode: previous.update_mode || "core",
  [`${tier}_run_id`]: runId,
  [`${tier}_generated_at`]: generatedAt,
  [`${tier}_generated_by`]: generatedBy,
  mixed_tier_status: true,
  mixed_tier_note: "Tier references are intentionally mixed; each tier refreshes on its own cadence and previous successful outputs remain active until the owning tier refreshes.",
  tiers: {
    ...(previous.tiers || {}),
    [tier]: {
      run_id: runId,
      generated_at: generatedAt,
      generated_by: generatedBy
    }
  }
};

fs.mkdirSync(path.dirname(filePath), { recursive: true });
fs.writeFileSync(filePath, `${JSON.stringify(next, null, 2)}\n`);
console.log(`Stamped ${tier}: ${runId}`);
