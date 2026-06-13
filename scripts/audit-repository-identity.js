import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const OUT_JSON = "dashboard/api/runtime/repository-identity-audit.json";
const OUT_MD = "docs/REPOSITORY_IDENTITY_AUDIT.md";
const MAX_LINE_PREVIEW = 180;

const SEARCH_ROOTS = [
  ".github/workflows",
  "wrangler.toml",
  "wrangler.jsonc",
  "package.json",
  "scripts",
  "dashboard",
  "public",
  "docs",
  "README.md",
  "README_V3.txt",
  "README_V4.txt"
];

const TEXT_EXTENSIONS = new Set([
  ".css",
  ".env",
  ".geojson",
  ".html",
  ".js",
  ".json",
  ".jsonc",
  ".md",
  ".sql",
  ".toml",
  ".txt",
  ".yml",
  ".yaml"
]);

const PATTERNS = [
  { key: "korea-port-intelligence", regex: /korea-port-intelligence/gi, current: true },
  { key: "korea port intelligence", regex: /korea\s+port\s+intelligence/gi, current: true },
  { key: "github-url", regex: /github\.com[:/][^\s"'<>),`]+/gi },
  { key: "workers.dev-url", regex: /https?:\/\/[^\s"'<>),`]*workers\.dev[^\s"'<>),`]*/gi },
  { key: "pages.dev-url", regex: /https?:\/\/[^\s"'<>),`]*pages\.dev[^\s"'<>),`]*/gi },
  { key: "netlify", regex: /\b[\w.-]*netlify[\w.-]*\b/gi },
  { key: "artifact", regex: /\bartifacts?\b/gi }
];

const SAFE_CLEANUPS_APPLIED = [];

function toPosix(value = "") {
  return String(value).replace(/\\/g, "/");
}

function exists(relativePath) {
  return fs.existsSync(path.join(ROOT, relativePath));
}

function isEnvExample(filePath = "") {
  const base = path.basename(filePath).toLowerCase();
  return base.startsWith(".env") && /(example|sample|template)$/.test(base);
}

function shouldScanFile(relativePath) {
  const normalized = toPosix(relativePath);
  if (normalized === "scripts/audit-repository-identity.js" || normalized === OUT_JSON || normalized === OUT_MD) return false;
  const base = path.basename(normalized);
  if (base === ".env.local" || base === ".env") return false;
  if (base.startsWith(".env")) return isEnvExample(base);
  return TEXT_EXTENSIONS.has(path.extname(base).toLowerCase());
}

function listFiles(inputPath, out = []) {
  const full = path.join(ROOT, inputPath);
  if (!fs.existsSync(full)) return out;
  const stat = fs.statSync(full);
  if (stat.isFile()) {
    if (shouldScanFile(inputPath)) out.push(toPosix(inputPath));
    return out;
  }
  if (!stat.isDirectory()) return out;
  for (const entry of fs.readdirSync(full, { withFileTypes: true })) {
    if (entry.name === ".git" || entry.name === "node_modules") continue;
    listFiles(path.join(inputPath, entry.name), out);
  }
  return out;
}

function targetFiles() {
  const files = new Set();
  for (const root of SEARCH_ROOTS) {
    for (const file of listFiles(root)) files.add(file);
  }
  for (const name of fs.readdirSync(ROOT)) {
    if (/^\.env.*(?:example|sample|template)$/i.test(name)) files.add(name);
  }
  return [...files].sort();
}

function linePreview(line = "") {
  const trimmed = String(line).trim().replace(/\s+/g, " ");
  if (trimmed.length <= MAX_LINE_PREVIEW) return trimmed;
  return `${trimmed.slice(0, MAX_LINE_PREVIEW - 3)}...`;
}

function isWorkflow(file) {
  return /^\.github\/workflows\//.test(file);
}

function isGeneratedMetadataFile(file) {
  return /^dashboard\/api\//.test(file) || /^public\/data\//.test(file) || /^dashboard\/data\//.test(file);
}

function lineLooksFunctional(line = "", file = "") {
  const lower = `${file}\n${line}`.toLowerCase();
  return /wrangler\.jsonc|wrangler\.toml|workers\.dev|pages\.dev|netlify\.app|netlify\.com|netlify_|production_api_origin|git@github\.com|github\.com[:/]|npx wrangler deploy|deploy:cloudflare|route\s*=|routes\s*=|nameprefix|source_key|api_origin|api_base|path\.join|\.env\.local/.test(lower);
}

function lineLooksArtifact(line = "", file = "") {
  const lower = line.toLowerCase();
  return isWorkflow(file) && (/upload-artifact/.test(lower) || /^\s*name:\s*/.test(lower) || /artifact/.test(lower));
}

function classifyFinding({ file, lineText, pattern, reference }) {
  const lowerFile = file.toLowerCase();
  const lowerLine = lineText.toLowerCase();
  const oldName = Boolean(pattern.old) || /hwk|hullwiper/.test(String(reference).toLowerCase());
  const currentProduct = Boolean(pattern.current) || /korea-port-intelligence|korea\s+port\s+intelligence/i.test(reference);
  const functional = lineLooksFunctional(lineText, file);
  const generated = isGeneratedMetadataFile(file) ||
    /generated_by|repository_name|workflow_name|artifact_name|update_tier|source_key|source_name/.test(lowerLine);

  if (generated) {
    return {
      type: "GENERATED_METADATA",
      risk: oldName ? "MEDIUM" : "LOW",
      recommendation: oldName
        ? "Refresh from the owning generator after confirming no compatibility dependency remains."
        : "No action required unless product naming changes."
    };
  }
  if (functional && oldName) {
    return {
      type: "FUNCTIONAL_DEPENDENCY",
      risk: "HIGH",
      recommendation: "Do not rename automatically. Confirm Cloudflare/local path compatibility before changing."
    };
  }
  if (functional && /workers\.dev|pages\.dev|github\.com|netlify|wrangler\.jsonc|production_api_origin/.test(`${lowerFile}\n${lowerLine}`)) {
    return {
      type: "FUNCTIONAL_DEPENDENCY",
      risk: currentProduct ? "MEDIUM" : "HIGH",
      recommendation: currentProduct
        ? "Keep if this is the intended current deployment identity."
        : "Manual review required before changing deployment or repository identity."
    };
  }
  if (lineLooksArtifact(lineText, file)) {
    return {
      type: "HARMLESS_LABEL",
      risk: "LOW",
      recommendation: oldName
        ? "Safe to rename as a display/artifact label if no external automation expects it."
        : "No action required; artifact/workflow label only."
    };
  }
  if (oldName && /cloudflare|worker|url|folder|local/.test(lowerLine)) {
    return {
      type: "NEEDS_MANUAL_REVIEW",
      risk: "MEDIUM",
      recommendation: "Historical or transition reference; confirm it is no longer needed before editing."
    };
  }
  return {
    type: "HARMLESS_LABEL",
    risk: "LOW",
    recommendation: oldName
      ? "Safe label/doc cleanup candidate if the historical reference is no longer useful."
      : "Current product label; no action required."
  };
}

function scanReferences() {
  const findings = [];
  const files = targetFiles();
  for (const file of files) {
    let text = "";
    try {
      text = fs.readFileSync(path.join(ROOT, file), "utf8");
    } catch {
      continue;
    }
    const lines = text.split(/\r?\n/);
    lines.forEach((lineText, index) => {
      for (const pattern of PATTERNS) {
        pattern.regex.lastIndex = 0;
        let match;
        while ((match = pattern.regex.exec(lineText)) !== null) {
          const reference = match[0];
          const classification = classifyFinding({ file, lineText, pattern, reference });
          findings.push({
            reference,
            pattern: pattern.key,
            file,
            line: index + 1,
            type: classification.type,
            risk: classification.risk,
            recommendation: classification.recommendation,
            old_name: Boolean(pattern.old) || /hwk|hullwiper/i.test(reference),
            current_product_name: Boolean(pattern.current),
            preview: linePreview(lineText)
          });
        }
      }
    });
  }
  return findings;
}

function readText(relativePath) {
  try {
    return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
  } catch {
    return "";
  }
}

function stripJsonComments(text = "") {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function readWranglerIdentity() {
  const candidates = ["wrangler.jsonc", "wrangler.toml"];
  for (const file of candidates) {
    if (!exists(file)) continue;
    const text = readText(file);
    if (file.endsWith(".jsonc")) {
      try {
        const parsed = JSON.parse(stripJsonComments(text));
        return {
          config_file: file,
          worker_name: parsed.name || null,
          main: parsed.main || null,
          routes: parsed.routes || parsed.route || [],
          assets_directory: parsed.assets?.directory || null,
          assets_binding: parsed.assets?.binding || null
        };
      } catch (error) {
        return { config_file: file, parse_error: error.message };
      }
    }
    const nameMatch = text.match(/^\s*name\s*=\s*["']([^"']+)["']/m);
    const routeMatches = [...text.matchAll(/^\s*route\s*=\s*["']([^"']+)["']/gm)].map(match => match[1]);
    return {
      config_file: file,
      worker_name: nameMatch?.[1] || null,
      routes: routeMatches
    };
  }
  return { config_file: null, worker_name: null, routes: [] };
}

function readGitRemoteOrigin() {
  const config = readText(".git/config");
  const lines = config.split(/\r?\n/);
  let inOrigin = false;
  for (const line of lines) {
    if (/^\s*\[remote "origin"\]/.test(line)) {
      inOrigin = true;
      continue;
    }
    if (/^\s*\[/.test(line)) inOrigin = false;
    if (inOrigin) {
      const match = line.match(/^\s*url\s*=\s*(.+)\s*$/);
      if (match) return sanitizeRemote(match[1]);
    }
  }
  return null;
}

function sanitizeRemote(remote = "") {
  return String(remote).replace(/https:\/\/[^/@]+@/i, "https://<redacted>@");
}

function workflowMetadata() {
  const dir = path.join(ROOT, ".github/workflows");
  const workflows = [];
  const artifacts = [];
  if (!fs.existsSync(dir)) return { workflows, artifacts };
  for (const name of fs.readdirSync(dir).filter(file => /\.ya?ml$/i.test(file)).sort()) {
    const file = `.github/workflows/${name}`;
    const lines = readText(file).split(/\r?\n/);
    const workflowName = lines.find(line => /^\s*name:\s*/.test(line))?.replace(/^\s*name:\s*/, "").trim() || name;
    workflows.push({ file, name: workflowName });
    lines.forEach((line, index) => {
      if (!/uses:\s*actions\/upload-artifact@/i.test(line)) return;
      const lookahead = lines.slice(index, index + 12);
      const nameLine = lookahead.find(candidate => /^\s*name:\s*/.test(candidate));
      if (nameLine) {
        artifacts.push({
          file,
          line: index + 1 + lookahead.indexOf(nameLine),
          name: nameLine.replace(/^\s*name:\s*/, "").trim()
        });
      }
    });
  }
  return { workflows, artifacts };
}

function typeCounts(findings) {
  return findings.reduce((acc, finding) => {
    acc[finding.type] = (acc[finding.type] || 0) + 1;
    return acc;
  }, {});
}

function markdownTable(rows) {
  const header = "| Reference | File | Type | Risk | Recommendation |\n|---|---|---|---|---|";
  const body = rows.map(row =>
    `| ${escapeMd(row.reference)} | ${escapeMd(`${row.file}:${row.line}`)} | ${row.type} | ${row.risk} | ${escapeMd(row.recommendation)} |`
  );
  return [header, ...body].join("\n");
}

function escapeMd(value = "") {
  return String(value).replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function writeReports(payload) {
  fs.mkdirSync(path.dirname(path.join(ROOT, OUT_JSON)), { recursive: true });
  fs.mkdirSync(path.dirname(path.join(ROOT, OUT_MD)), { recursive: true });
  fs.writeFileSync(path.join(ROOT, OUT_JSON), `${JSON.stringify(payload, null, 2)}\n`);

  const highValueRows = payload.findings
    .filter(finding => finding.old_name || finding.type === "FUNCTIONAL_DEPENDENCY" || finding.type === "NEEDS_MANUAL_REVIEW")
    .slice(0, 80);
  const md = [
    "# Repository Identity Audit",
    "",
    `Generated at: ${payload.generated_at}`,
    "",
    "## Current Identity",
    "",
    `- GitHub repository: ${payload.current_identity.github_repository || "not available locally"}`,
    `- GitHub ref: ${payload.current_identity.github_ref || "not available locally"}`,
    `- Workflow name: ${payload.current_identity.workflow_name || "not available locally"}`,
    `- Git remote origin: ${payload.current_identity.git_remote_origin || "not available"}`,
    `- Cloudflare worker: ${payload.current_identity.cloudflare.worker_name || "not configured"}`,
    `- Cloudflare routes: ${Array.isArray(payload.current_identity.cloudflare.routes) && payload.current_identity.cloudflare.routes.length ? payload.current_identity.cloudflare.routes.join(", ") : "none configured in repo"}`,
    "",
    "## Summary",
    "",
    `- Findings: ${payload.findings.length}`,
    `- HARMLESS_LABEL: ${payload.summary_by_type.HARMLESS_LABEL || 0}`,
    `- FUNCTIONAL_DEPENDENCY: ${payload.summary_by_type.FUNCTIONAL_DEPENDENCY || 0}`,
    `- GENERATED_METADATA: ${payload.summary_by_type.GENERATED_METADATA || 0}`,
    `- NEEDS_MANUAL_REVIEW: ${payload.summary_by_type.NEEDS_MANUAL_REVIEW || 0}`,
    "",
    "## Safe Cleanup Applied",
    "",
    ...payload.safe_cleanups_applied.map(item => `- ${item.file}: \`${item.from}\` -> \`${item.to}\` (${item.reason})`),
    "",
    "## High-Value References",
    "",
    markdownTable(highValueRows),
    "",
    "## Artifact Names",
    "",
    payload.artifact_names.length
      ? payload.artifact_names.map(item => `- ${item.file}:${item.line} ${item.name}`).join("\n")
      : "- None found",
    "",
    "## Recommendation",
    "",
    "Do not rename Cloudflare worker names, routes, public URLs, git remotes, deploy commands, API origins, or local fallback paths without a separate migration check. Current `korea-port-intelligence` references appear to be the intended product/deployment identity."
  ].join("\n");
  fs.writeFileSync(path.join(ROOT, OUT_MD), `${md}\n`);
}

function printConsole(payload) {
  console.log("Repository Identity Audit");
  console.log("=========================");
  console.log("");
  console.log("Reference | File | Type | Risk | Recommendation");
  const rows = payload.findings
    .filter(finding => finding.old_name || finding.type === "FUNCTIONAL_DEPENDENCY" || finding.type === "NEEDS_MANUAL_REVIEW")
    .slice(0, 80);
  for (const row of rows) {
    console.log(`${row.reference} | ${row.file}:${row.line} | ${row.type} | ${row.risk} | ${row.recommendation}`);
  }
  if (payload.findings.length > rows.length) {
    console.log(`... ${payload.findings.length - rows.length} additional low-risk/current-label finding(s) written to ${OUT_JSON}`);
  }
  console.log("");
  console.log(`Report: ${OUT_JSON}`);
  console.log(`Docs: ${OUT_MD}`);
}

const { workflows, artifacts } = workflowMetadata();
const findings = scanReferences();
const payload = {
  schema_version: "1.0",
  generated_at: new Date().toISOString(),
  current_identity: {
    github_repository: process.env.GITHUB_REPOSITORY || null,
    github_ref: process.env.GITHUB_REF || null,
    workflow_name: process.env.GITHUB_WORKFLOW || null,
    git_remote_origin: readGitRemoteOrigin(),
    cloudflare: readWranglerIdentity()
  },
  workflow_names: workflows,
  artifact_names: artifacts,
  hardcoded_repo_urls: [...new Set(findings.filter(finding => finding.pattern === "github-url").map(finding => finding.reference))],
  old_name_references: findings.filter(finding => finding.old_name),
  safe_cleanups_applied: SAFE_CLEANUPS_APPLIED,
  summary_by_type: typeCounts(findings),
  findings
};

writeReports(payload);
printConsole(payload);
