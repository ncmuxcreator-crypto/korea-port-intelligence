import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export const VERIFIED_SOURCE_CSV_PATH = "data/reference/verified_vessel_reference.csv";
export const SOURCE_CSV_URL_RECOMMENDED_FIX = "Update SOURCE_CSV_URL to the current repo lightweight verified_vessel_reference.csv raw URL.";

const OLD_REPO_PATTERNS = [
  /hwkport/i,
  /hwk-port/i,
  /hwk-port-intelligence/i
];

function clean(value = "") {
  return String(value || "").trim();
}

function parseRepoFromRemote(remote = "") {
  const text = clean(remote);
  if (!text) return "";
  const ssh = text.match(/^git@github\.com:([^/]+\/[^/]+?)(?:\.git)?$/i);
  if (ssh) return ssh[1];
  const https = text.match(/^https:\/\/github\.com\/([^/]+\/[^/]+?)(?:\.git)?(?:[#?].*)?$/i);
  if (https) return https[1];
  return "";
}

function gitRemoteOrigin(cwd = process.cwd()) {
  try {
    return execFileSync("git", ["config", "--get", "remote.origin.url"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
  } catch {
    try {
      const config = fs.readFileSync(path.join(cwd, ".git", "config"), "utf8");
      const origin = config.match(/\[remote "origin"\][\s\S]*?url\s*=\s*(.+)/);
      return origin ? origin[1].trim() : "";
    } catch {
      return "";
    }
  }
}

export function resolveGithubRepository({ env = process.env, cwd = process.cwd() } = {}) {
  const fromEnv = clean(env.GITHUB_REPOSITORY);
  if (fromEnv) return fromEnv;
  return parseRepoFromRemote(gitRemoteOrigin(cwd));
}

export function expectedSourceCsvRawUrl({ env = process.env, cwd = process.cwd(), repository = "" } = {}) {
  const repo = clean(repository) || resolveGithubRepository({ env, cwd }) || "ncmuxcreator-crypto/korea-port-intelligence";
  return `https://raw.githubusercontent.com/${repo}/main/${VERIFIED_SOURCE_CSV_PATH}`;
}

function parseRawGithubUrl(url = "") {
  try {
    const parsed = new URL(clean(url));
    if (parsed.hostname.toLowerCase() !== "raw.githubusercontent.com") return null;
    const parts = parsed.pathname.split("/").filter(Boolean);
    if (parts.length < 4) return null;
    return {
      owner: parts[0],
      repo: parts[1],
      branch: parts[2],
      file_path: parts.slice(3).join("/"),
      repository: `${parts[0]}/${parts[1]}`
    };
  } catch {
    return null;
  }
}

function sanitizedUrl(url = "") {
  try {
    const parsed = new URL(clean(url));
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
  } catch {
    return clean(url) ? "<invalid-url>" : "";
  }
}

export function diagnoseSourceCsvUrl({
  sourceCsvUrl = process.env.SOURCE_CSV_URL,
  env = process.env,
  cwd = process.cwd(),
  repository = ""
} = {}) {
  const configuredUrl = clean(sourceCsvUrl);
  const currentRepository = clean(repository) || resolveGithubRepository({ env, cwd });
  const expectedUrl = expectedSourceCsvRawUrl({ env, cwd, repository: currentRepository });
  const rawInfo = parseRawGithubUrl(configuredUrl);
  const configuredLower = configuredUrl.toLowerCase();
  const configuredRepo = rawInfo?.repository || "";
  const filePath = rawInfo?.file_path || "";
  const pointsToOldRepo = OLD_REPO_PATTERNS.some(pattern => pattern.test(configuredUrl));
  const pointsToDifferentRepo = Boolean(rawInfo && currentRepository && configuredRepo && configuredRepo.toLowerCase() !== currentRepository.toLowerCase());
  const pointsToOldArrivalsCsv = /(^|\/)source_arrivals\.csv(?:$|[?#])/i.test(configuredUrl) || /source_arrivals\.csv$/i.test(filePath);
  const pointsToLightweightReferenceCsv = filePath.replace(/\\/g, "/").toLowerCase() === VERIFIED_SOURCE_CSV_PATH.toLowerCase();
  const pointsToExpectedUrl = configuredUrl === expectedUrl;
  const localReferenceExists = fs.existsSync(path.join(cwd, VERIFIED_SOURCE_CSV_PATH));
  const isWrong = Boolean(pointsToOldRepo || pointsToOldArrivalsCsv || pointsToDifferentRepo);
  const status = !configuredUrl
    ? "NOT_CONFIGURED"
    : isWrong
      ? "WRONG_SOURCE_CSV_URL"
      : pointsToLightweightReferenceCsv
        ? "LIGHTWEIGHT_REFERENCE_CSV"
        : "UNKNOWN_SOURCE_CSV_URL";
  const reasons = [
    pointsToOldRepo ? "raw URL points to old hwkport repository naming" : "",
    pointsToDifferentRepo ? "raw URL repository does not match current GITHUB_REPOSITORY" : "",
    pointsToOldArrivalsCsv ? "raw URL points to old 72MB source_arrivals.csv" : "",
    pointsToLightweightReferenceCsv ? "raw URL points to lightweight verified_vessel_reference.csv" : ""
  ].filter(Boolean);

  return {
    status,
    configured: Boolean(configuredUrl),
    current_github_repository: currentRepository || null,
    expected_raw_url: expectedUrl,
    configured_url_sanitized: sanitizedUrl(configuredUrl),
    configured_repository: configuredRepo || null,
    configured_file_path: filePath || null,
    local_reference_path: VERIFIED_SOURCE_CSV_PATH,
    local_reference_exists: localReferenceExists,
    points_to_old_repo: pointsToOldRepo,
    points_to_different_repo: pointsToDifferentRepo,
    points_to_old_hwkport_repo: pointsToOldRepo,
    points_to_old_source_arrivals_csv: pointsToOldArrivalsCsv,
    points_to_lightweight_verified_reference_csv: pointsToLightweightReferenceCsv,
    points_to_expected_url: pointsToExpectedUrl,
    recommended_fix: isWrong || !pointsToLightweightReferenceCsv
      ? SOURCE_CSV_URL_RECOMMENDED_FIX
      : "No action required.",
    reasons
  };
}
