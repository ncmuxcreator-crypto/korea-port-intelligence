import {
  buildConfidence,
  buildSalesPipeline,
  buildScoreFactors,
  buildVesselVisits,
  normalizeOpportunityCandidate,
  vesselIdentityKey,
  withApiContract
} from "../scripts/lib/intelligence-foundation.js";
import { resolvePortCount } from "../dashboard/app/kpi-resolver.js";

const failures = [];

function assert(condition, message) {
  if (!condition) failures.push(message);
}

assert(vesselIdentityKey({ imo: "1234567", vessel_name: "ABC STAR" }) === vesselIdentityKey({ imo: "1234567", vessel_name: "ABC STAR II", mmsi: "111" }), "Same IMO must resolve to the same vessel identity.");
assert(vesselIdentityKey({ imo: "1234567", mmsi: "111" }) === vesselIdentityKey({ imo: "1234567", mmsi: "222" }), "Different MMSI with same IMO must merge.");
assert(vesselIdentityKey({ mmsi: "440123000", vessel_name: "ABC STAR" }) === vesselIdentityKey({ mmsi: "440123000", vessel_name: "ABC STAR II" }), "Missing IMO but same MMSI must merge.");
assert(vesselIdentityKey({ vessel_name: "ABC  STAR", port_name: "Busan", last_seen_at: "2026-06-01T00:00:00Z" }) === vesselIdentityKey({ vessel_name: "abc-star", port_name: "Busan", last_seen_at: "2026-06-01T12:00:00Z" }), "Missing IMO/MMSI fallback identity must use normalized name, port, and date.");

const staleConfidence = buildConfidence({ vessel_name: "OLD", last_seen_at: "2020-01-01T00:00:00Z", sources_failed: 2 });
assert(staleConfidence.confidence_label !== "HIGH", "Stale vessel should not have HIGH confidence.");
const missingIdentityConfidence = buildConfidence({ vessel_name: "NO ID", source_names: ["source_a"], last_seen_at: new Date().toISOString() });
const identifiedConfidence = buildConfidence({ imo: "1234567", mmsi: "440123000", source_names: ["source_a"], last_seen_at: new Date().toISOString() });
assert(missingIdentityConfidence.confidence_score < identifiedConfidence.confidence_score, "Missing IMO and MMSI should reduce confidence.");
assert(buildConfidence({ imo: "1234567", source_names: ["a", "b"], sources_failed: 2 }).confidence_score < buildConfidence({ imo: "1234567", source_names: ["a", "b"], sources_failed: 0 }).confidence_score, "Failed sources should reduce confidence.");
assert(Number.isFinite(staleConfidence.confidence_score) && staleConfidence.confidence_score >= 0 && staleConfidence.confidence_score <= 100, "confidence_score must be finite between 0 and 100.");

const hot = normalizeOpportunityCandidate({
  vessel_name: "ABC STAR",
  imo: "1234567",
  port_name: "Busan",
  opportunity_score: 84,
  commercial_value_score: 90,
  biofouling_exposure_score: 80,
  stay_hours: 120,
  data_confidence_score: 85
});
assert(hot.priority_label === "HOT", "Opportunity score must resolve HOT priority.");
assert(hot.score_factors.length >= 2, "HOT candidate must have score factors.");
assert(hot.score_factors.reduce((sum, factor) => sum + Number(factor.points || 0), 0) === hot.opportunity_score, "score_factors must sum to opportunity_score.");
assert(buildScoreFactors(hot, hot.opportunity_score).length >= 2, "Score factor builder must explain candidates.");

const topCandidates = { opportunities: [{ ...hot, vessel_id: "v1" }] };
const pipeline = buildSalesPipeline(topCandidates, { generated_at: "2026-06-01T00:00:00Z", data_mode: "test" });
assert(pipeline.items.length === 1 && pipeline.items[0].pipeline_stage === "NEW_HOT", "HOT candidates with no contact history should become NEW_HOT.");

const visits = buildVesselVisits([
  { vessel_name: "ABC STAR", imo: "1234567", port_name: "Busan", stay_hours: 10 },
  { vessel_name: "ABC STAR II", imo: "1234567", port_name: "Busan", stay_hours: 20 },
  { vessel_name: "ABC STAR", imo: "1234567", port_name: "Ulsan", stay_hours: 5 }
], { generated_at: "2026-06-01T00:00:00Z", data_mode: "test" });
assert(visits.visits.length === 2, "Same vessel in same port should merge, different ports should create separate visits.");
assert(visits.visits.every(visit => Number.isFinite(Number(visit.stay_hours))), "Visit stay_hours must be numeric.");

const contract = withApiContract([{ a: 1 }], { generated_at: "2026-06-01T00:00:00Z", data_mode: "test" });
for (const field of ["generated_at", "data_mode", "schema_version", "source_status", "fallback_used", "record_count"]) {
  assert(field in contract, `API contract missing field: ${field}`);
}

assert(resolvePortCount({
  summary: { port_count: 0 },
  state: { rows: [{ port_name: "Busan" }, { port_name: "Busan" }, { port_name: "Ulsan" }] }
}) === 2, "Port KPI must recover from zero summary count using vessel rows.");

if (failures.length) {
  console.error("[Korea Port Intelligence] intelligence foundation test failures");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("[Korea Port Intelligence] intelligence foundation tests passed");
