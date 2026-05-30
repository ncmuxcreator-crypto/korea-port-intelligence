import fs from "fs";
import path from "path";
import { createRunId, enrichWithVesselMasterCache, saveToSupabase } from "./lib/db.js";
import { enrichWithReferenceDictionaries, loadReferenceDictionaries } from "./lib/reference-dictionaries.js";

function argValue(name) {
  const prefix = `--${name}=`;
  const hit = process.argv.slice(2).find(arg => arg.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : "";
}

function candidateArchivePaths(date) {
  return [
    path.join("data", "raw-archive", `${date}.json`),
    path.join("data", "archive", `${date}.json`),
    path.join("data", "reports", `${date}.json`)
  ];
}

function extractRecords(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return [];
  for (const key of ["records", "normalized_records", "all_vessels", "rawRecords", "raw_records", "vessels", "data"]) {
    const rows = extractRecords(value[key]);
    if (rows.length) return rows;
  }
  return [];
}

function loadArchiveFile() {
  const explicitFile = argValue("file");
  const date = argValue("date");
  const candidates = explicitFile ? [explicitFile] : candidateArchivePaths(date);
  const file = candidates.find(candidate => candidate && fs.existsSync(candidate));
  if (!file) {
    throw new Error(`No local raw archive found. Use npm run reprocess -- --date=YYYY-MM-DD or --file=path/to/archive.json`);
  }
  const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  return { file, records: extractRecords(parsed), payload: parsed };
}

const startedAt = new Date().toISOString();
const runId = createRunId().replace("run_", "reprocess_");
const { file, records } = loadArchiveFile();
if (!records.length) throw new Error(`Archive has no reprocessable records: ${file}`);

const dictionaries = loadReferenceDictionaries();
const enriched = enrichWithReferenceDictionaries(records, dictionaries);
const masterResult = await enrichWithVesselMasterCache(enriched);
const finalRecords = masterResult.records || enriched;
const diagnostics = {
  generated_at: startedAt,
  reprocess_mode: true,
  reprocess_archive_file: file,
  attempted_count: 1,
  success_count: 1,
  failed_count: 0,
  skipped_count: 0,
  real_row_count: finalRecords.length,
  actionable_row_count: finalRecords.filter(record => record.actionable_source_row !== false).length,
  sources: [{
    source_name: "local_raw_archive",
    key: "local_raw_archive",
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    duration_ms: Math.max(0, Date.now() - new Date(startedAt).getTime()),
    status: "success",
    success: true,
    rows_collected: records.length,
    rows_normalized: finalRecords.length,
    rows_matched: finalRecords.filter(record => record.actionable_source_row !== false).length,
    retry_count: 0
  }]
};

const result = await saveToSupabase(finalRecords, {
  runId,
  startedAt,
  diagnostics,
  status: "reprocessed"
});

console.log(JSON.stringify({
  status: "reprocessed",
  run_id: runId,
  archive_file: file,
  records: finalRecords.length,
  save_result: result
}, null, 2));
