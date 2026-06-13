import {
  diagnoseSourceCsvUrl,
  expectedSourceCsvRawUrl,
  resolveGithubRepository,
  VERIFIED_SOURCE_CSV_PATH
} from "./lib/source-csv-url.js";

const repository = resolveGithubRepository({ cwd: process.cwd() });
const effectiveUrl = process.env.SOURCE_CSV_URL || expectedSourceCsvRawUrl({ repository, cwd: process.cwd() });
const diagnostic = diagnoseSourceCsvUrl({
  sourceCsvUrl: effectiveUrl,
  repository,
  cwd: process.cwd()
});

console.log("Source CSV URL Diagnostic");
console.log("=========================");
console.log(`github_repository=${diagnostic.current_github_repository || "-"}`);
console.log(`effective_url=${diagnostic.configured_url_sanitized || "-"}`);
console.log(`expected_raw_url=${diagnostic.expected_raw_url}`);
console.log(`local_reference_path=${VERIFIED_SOURCE_CSV_PATH}`);
console.log(`local_reference_exists=${diagnostic.local_reference_exists ? "yes" : "no"}`);
console.log(`status=${diagnostic.status}`);
console.log(`points_to_old_repo=${diagnostic.points_to_old_repo ? "yes" : "no"}`);
console.log(`points_to_different_repo=${diagnostic.points_to_different_repo ? "yes" : "no"}`);
console.log(`points_to_old_source_arrivals_csv=${diagnostic.points_to_old_source_arrivals_csv ? "yes" : "no"}`);
console.log(`points_to_lightweight_verified_reference_csv=${diagnostic.points_to_lightweight_verified_reference_csv ? "yes" : "no"}`);
console.log(`recommended_fix=${diagnostic.recommended_fix}`);

if (diagnostic.status === "WRONG_SOURCE_CSV_URL" || !diagnostic.local_reference_exists) {
  process.exitCode = 1;
}
