import fs from "fs";
import path from "path";

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function safeReadJson(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

export function vesselKey(record = {}) {
  return String(record.vessel_identity || record.vessel_id || record.imo || record.mmsi || record.call_sign || record.vessel_name || "unknown")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "-");
}

export function snapshotKey(record = {}) {
  const portCall = String(record.port_call_identity || "").trim().toUpperCase();
  if (portCall && portCall.replace(/\|/g, "")) return `PORTCALL|${portCall}`;
  return `${vesselKey(record)}|${String(record.port_code || record.port || "UNKNOWN").trim().toUpperCase()}`;
}

function parseTime(value) {
  if (!value) return null;
  const date = new Date(String(value).replace(" ", "T"));
  return Number.isNaN(date.getTime()) ? null : date;
}

function hoursBetween(start, end) {
  const startDate = parseTime(start);
  const endDate = parseTime(end);
  if (!startDate || !endDate || endDate.getTime() < startDate.getTime()) return 0;
  return Math.round(((endDate.getTime() - startDate.getTime()) / 36e5) * 10) / 10;
}

function stayDaysGroup(hours) {
  const days = Number(hours || 0) / 24;
  if (days >= 90) return "stay_90d_plus";
  if (days >= 30) return "stay_30_89d";
  if (days >= 21) return "stay_21_29d";
  if (days >= 14) return "stay_14_20d";
  if (days >= 7) return "stay_7_13d";
  if (days >= 3) return "stay_3_6d";
  return "stay_under_3d";
}

export function mergeSnapshots(current = [], previous = []) {
  const previousMap = new Map(previous.map(row => [snapshotKey(row), row]));
  const seen = new Set();
  const merged = [];

  for (const row of current) {
    const key = snapshotKey(row);
    seen.add(key);
    const old = previousMap.get(key) || {};
    const firstSeenAt = old.first_seen_at || row.first_seen_at || row.updated_at || new Date().toISOString();
    const lastSeenAt = row.updated_at || row.last_seen_at || new Date().toISOString();
    const previousCandidateScore = Number(old.cleaning_candidate_score || 0);
    const currentCandidateScore = Number(row.cleaning_candidate_score || 0);
    const currentCallStayHours = Number(row.current_call_stay_hours ?? row.stay_hours ?? 0);
    const cumulativeStayHours = Math.max(
      Number(old.cumulative_stay_hours || 0),
      Number(row.cumulative_stay_hours || 0),
      currentCallStayHours,
      hoursBetween(firstSeenAt, lastSeenAt)
    );
    const cumulativeReasonCodes = [
      ...(row.reason_codes || []),
      cumulativeStayHours >= 2160 ? "CUMULATIVE_STAY_90D_PLUS" : null,
      cumulativeStayHours >= 720 ? "CUMULATIVE_STAY_30D_PLUS" : null
    ].filter(Boolean);
    merged.push({
      ...old,
      ...row,
      first_seen_at: firstSeenAt,
      last_seen_at: lastSeenAt,
      current_call_stay_hours: currentCallStayHours,
      cumulative_stay_hours: cumulativeStayHours,
      cumulative_stay_days: Math.round((cumulativeStayHours / 24) * 10) / 10,
      stay_hours: cumulativeStayHours,
      stay_days_group: stayDaysGroup(cumulativeStayHours),
      reason_codes: [...new Set(cumulativeReasonCodes)],
      sales_reason: [...new Set(cumulativeReasonCodes)],
      previous_candidate_score: previousCandidateScore,
      candidate_score_delta: currentCandidateScore - previousCandidateScore,
      observation_count: Number(old.observation_count || 0) + 1,
      snapshot_key: key
    });
  }

  return merged.sort((a, b) => (b.cleaning_candidate_score || 0) - (a.cleaning_candidate_score || 0));
}

export function buildCandidateChanges(current = [], previous = []) {
  const previousMap = new Map(previous.map(row => [snapshotKey(row), row]));
  const changes = current.map(row => {
    const old = previousMap.get(snapshotKey(row)) || {};
    const oldScore = Number(old.cleaning_candidate_score || 0);
    const newScore = Number(row.cleaning_candidate_score || 0);
    const delta = newScore - oldScore;
    const isNew = !old.snapshot_key && !old.vessel_name;
    const becameCandidate = !old.is_cleaning_candidate && Boolean(row.is_cleaning_candidate);
    const becameImmediate = !old.is_immediate_candidate && Boolean(row.is_immediate_candidate);
    let changeType = "stable";
    if (isNew && row.is_immediate_candidate) changeType = "new_immediate";
    else if (isNew && row.is_cleaning_candidate) changeType = "new_candidate";
    else if (becameImmediate) changeType = "became_immediate";
    else if (becameCandidate) changeType = "became_candidate";
    else if (delta >= 15) changeType = "score_jump";
    else if (delta <= -15) changeType = "score_drop";

    return {
      snapshot_key: snapshotKey(row),
      vessel_name: row.vessel_name,
      port: row.port,
      operator: row.operator,
      previous_score: oldScore,
      current_score: newScore,
      delta,
      change_type: changeType,
      contact_window: row.contact_window,
      is_cleaning_candidate: Boolean(row.is_cleaning_candidate),
      is_immediate_candidate: Boolean(row.is_immediate_candidate),
      reasons: row.candidate_reasons || [],
      recommended_action: row.candidate_next_action || row.recommended_action || "Monitor",
      first_seen_at: row.first_seen_at,
      last_seen_at: row.last_seen_at || row.updated_at
    };
  });

  const priority = { new_immediate: 1, became_immediate: 2, score_jump: 3, new_candidate: 4, became_candidate: 5, stable: 8, score_drop: 9 };
  const highValue = changes
    .filter(c => c.change_type !== "stable" || c.is_immediate_candidate || c.is_cleaning_candidate)
    .sort((a, b) => (priority[a.change_type] || 7) - (priority[b.change_type] || 7) || b.current_score - a.current_score || b.delta - a.delta);

  return {
    generated_at: new Date().toISOString(),
    tracker_version: "candidate-change-tracker-v16.5",
    total_tracked: current.length,
    changed_count: highValue.filter(c => c.change_type !== "stable").length,
    new_candidate_count: highValue.filter(c => ["new_candidate", "new_immediate"].includes(c.change_type)).length,
    became_immediate_count: highValue.filter(c => ["new_immediate", "became_immediate"].includes(c.change_type)).length,
    score_jump_count: highValue.filter(c => c.change_type === "score_jump").length,
    action_rule: "Prioritize vessels that newly became immediate candidates, then major score jumps, then new candidates. Use this list for first-call planning before reviewing the full queue.",
    top_changes: highValue.slice(0, 20)
  };
}

export function buildBackendOpsReport({ version, buildName, records = [], apiSources = [], supabaseStatus = "not_configured" }) {
  const enabled = apiSources.filter(s => s.enabled).map(s => s.key);
  const collectorTiers = [
    { tier: "base", name: "Port-call / berth signals", sources: ["port_operation", "berth_sources", "pilot_sources", "ulsan_core"] },
    { tier: "movement", name: "AIS / VTS movement signals", sources: ["mof_ais_dynamic", "mof_ais_info", "mof_vts"] },
    { tier: "identity", name: "Vessel master enrichment", sources: ["vessel_spec", "port_facility", "mof_ais_info"] },
    { tier: "storage", name: "Accumulation storage", sources: ["supabase", "google_drive"] },
    { tier: "paid_optional", name: "Paid AIS overlay", sources: ["marine_traffic", "vesselfinder", "aisstream"] }
  ].map(group => {
    const active = group.sources.filter(s => enabled.includes(s));
    return {
      ...group,
      active_sources: active,
      readiness_percent: Math.round((active.length / group.sources.length) * 100),
      status: active.length === group.sources.length ? "ready" : active.length ? "partial" : "waiting"
    };
  });

  const candidates = records.filter(r => r.is_cleaning_candidate);
  const immediate = records.filter(r => r.is_immediate_candidate);
  const changed = records.filter(r => Number(r.candidate_score_delta || 0) !== 0);

  return {
    version,
    build_name: buildName,
    backend_stage: "actual_collector_backend_ready",
    generated_at: new Date().toISOString(),
    collector_execution_mode: enabled.length ? "configured_sources_detected" : "no_live_data",
    supabase_status: supabaseStatus,
    record_count: records.length,
    candidate_count: candidates.length,
    immediate_candidate_count: immediate.length,
    changed_candidate_count: changed.length,
    collector_tiers: collectorTiers,
    backend_priorities: [
      "Run lightweight collectors first; do not block the dashboard when a source fails.",
      "Normalize vessel identity before scoring; use IMO/MMSI when available and vessel name only as fallback.",
      "Append daily/hourly snapshots to Supabase; keep GitHub limited to current dashboard JSON.",
      "Separate paid AIS from public-data base layer so cost does not block Korea candidate discovery."
    ],
    next_backend_tasks: [
      "Wire the first real public collector to produce normalized vessel rows.",
      "Persist hourly candidate snapshots to Supabase with upsert keys.",
      "Add source-level error reporting per collector.",
      "Add port-stay duration calculation from repeated snapshots."
    ]
  };
}

export function writeSnapshotOutputs({ records = [], report = {}, version, buildName, apiSources = [], supabaseStatus }) {
  const previous = report.data_mode === "no_live_data" ? [] : safeReadJson("data/latest-lite.json", []);
  const merged = mergeSnapshots(records, Array.isArray(previous) ? previous : []);
  const today = new Date().toISOString().slice(0, 10);
  const candidateChanges = buildCandidateChanges(merged, Array.isArray(previous) ? previous : []);
  const backendOps = buildBackendOpsReport({ version, buildName, records: merged, apiSources, supabaseStatus });

  ensureDir("dashboard/api/backend-ops.json");
  fs.writeFileSync("dashboard/api/backend-ops.json", JSON.stringify(backendOps, null, 2));
  fs.writeFileSync("dashboard/api/candidate-changes.json", JSON.stringify(candidateChanges, null, 2));
  fs.writeFileSync("dashboard/api/vessels.json", JSON.stringify(merged, null, 2));
  fs.writeFileSync("data/latest-lite.json", JSON.stringify(merged, null, 2));
  ensureDir(`data/history/${today}.json`);
  fs.writeFileSync(`data/history/${today}.json`, JSON.stringify(merged, null, 2));
  return { merged, backendOps, candidateChanges };
}
