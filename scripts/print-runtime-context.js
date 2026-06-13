import fs from "node:fs";
import { execSync } from "node:child_process";

function readText(path) {
  try {
    return fs.readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

function stripJsonComments(text) {
  return String(text || "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|\s)\/\/.*$/gm, "$1");
}

function readJsonLike(path) {
  const text = readText(path);
  if (!text) return {};
  try {
    return JSON.parse(stripJsonComments(text));
  } catch {
    return {};
  }
}

function gitRemoteOrigin() {
  try {
    return execSync("git remote get-url origin", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    const config = readText(".git/config");
    return (config.match(/\[remote "origin"\][\s\S]*?url\s*=\s*(.+)/) || [])[1]?.trim() || "";
  }
}

function workerName() {
  const wranglerJson = readJsonLike("wrangler.jsonc");
  if (wranglerJson.name) return wranglerJson.name;
  const wrangler = readJsonLike("wrangler.json");
  if (wrangler.name) return wrangler.name;
  const toml = readText("wrangler.toml");
  return (toml.match(/^\s*name\s*=\s*["']([^"']+)["']/m) || [])[1] || "";
}

const pkg = readJsonLike("package.json");
const runtimeProjectName = process.env.RUNTIME_PROJECT_NAME || pkg.name || "korea-port-intelligence";

console.log("=== Runtime Context ===");
console.log(`GITHUB_REPOSITORY=${process.env.GITHUB_REPOSITORY || ""}`);
console.log(`GITHUB_WORKFLOW=${process.env.GITHUB_WORKFLOW || ""}`);
console.log(`GITHUB_RUN_ID=${process.env.GITHUB_RUN_ID || ""}`);
console.log(`git_remote_origin=${gitRemoteOrigin()}`);
console.log(`package_name=${pkg.name || ""}`);
console.log(`worker_name=${workerName()}`);
console.log(`runtime_project_name=${runtimeProjectName}`);
