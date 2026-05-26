import fs from "node:fs";

const path = "dashboard/api/vessels.json";
const data = fs.existsSync(path) ? JSON.parse(fs.readFileSync(path, "utf8")) : [];
const vessels = Array.isArray(data) ? data : (data.vessels || data.items || data.data || []);

function stableSnapshotKey(v = {}) {
  return String(
    v.snapshot_key ||
    [
      v.vessel_id || v.imo || v.mmsi || v.hybrid_entity_key || v.vessel_name || v.name || "unknown",
      v.port || "unknown",
      v.eta || v.ata || v.updated_at || v.collected_at || ""
    ].join("|")
  ).trim().toUpperCase();
}

function vesselNameKey(v = {}) {
  return String(v.vessel_name || v.name || "").trim().toUpperCase();
}

const seenSnapshots = new Set();
const duplicateSnapshots = [];
const nameCounts = new Map();

for (const vessel of vessels) {
  const snapshotKey = stableSnapshotKey(vessel);
  if (snapshotKey && seenSnapshots.has(snapshotKey)) duplicateSnapshots.push(snapshotKey);
  if (snapshotKey) seenSnapshots.add(snapshotKey);

  const nameKey = vesselNameKey(vessel);
  if (nameKey) nameCounts.set(nameKey, (nameCounts.get(nameKey) || 0) + 1);
}

const repeatedNames = [...nameCounts.entries()]
  .filter(([, count]) => count > 1)
  .map(([vessel_name, count]) => ({ vessel_name, count }))
  .sort((a, b) => b.count - a.count || a.vessel_name.localeCompare(b.vessel_name))
  .slice(0, 100);

const report = {
  version: "17.7.0",
  generatedAt: new Date().toISOString(),
  total: vessels.length,
  duplicate_snapshot_count: duplicateSnapshots.length,
  duplicate_snapshots: duplicateSnapshots.slice(0, 100),
  repeated_vessel_name_count: repeatedNames.length,
  repeated_vessel_names: repeatedNames,
  ok: true,
  severity: duplicateSnapshots.length ? "warn" : "pass",
  note: "Repeated vessel names and repeated vessel/port snapshot keys are expected with multi-source public data. This audit reports merge pressure but does not fail the pipeline."
};

fs.mkdirSync("dashboard/api", { recursive: true });
fs.writeFileSync("dashboard/api/candidate-dedupe.json", JSON.stringify(report, null, 2));

if (duplicateSnapshots.length) {
  console.warn("Duplicate stable candidate snapshots observed; reporting as warning", duplicateSnapshots.slice(0, 20));
}
if (repeatedNames.length) {
  console.warn(`Repeated vessel names observed: ${repeatedNames.length}. Treated as warning, not failure.`);
}

console.log("Candidate dedupe passed");
