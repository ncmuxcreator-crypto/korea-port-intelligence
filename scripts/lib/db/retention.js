export function retentionCutoff(days, dateOnly = false) {
  const cutoff = new Date(Date.now() - Number(days || 0) * 24 * 60 * 60 * 1000).toISOString();
  return dateOnly ? cutoff.slice(0, 10) : cutoff;
}

function retentionNumberEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || String(raw).trim() === "") return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

export const RETENTION_PROFILES = {
  free_500mb: {
    targetMb: 450,
    hardCapMb: 500,
    keepPromotedRuns: 1,
    portRunSnapshotDays: 2,
    portRunSnapshotKeepRuns: 20,
    vesselSnapshotsDays: 1,
    portCallMasterDays: 365,
    riskHistoryDays: 365,
    enrichmentDays: 2,
    sourceLogsDays: 7,
    dashboardSummaryDays: 14,
    currentStaleDays: 2,
    eventDays: 3,
    pilotEventDays: 3,
    congestionDays: 3,
    identityDays: 3,
    historyDays: 365,
    routePredictionDays: 365,
    opportunityScoreDays: 365,
    candidateHistoryDays: 180,
    salesPipelineDays: 3650,
    dailyWarehouseDays: 7,
    portDailySummaryDays: 365,
    portWeeklySummaryDays: 730,
    portMonthlySummaryDays: 1825,
    rawArchiveIndexDays: 14,
    ruleDays: 3,
    featureDays: 3,
    modelDays: 3,
    explainabilityDays: 3
  },
  pro_7_5gb: {
    targetMb: 6500,
    hardCapMb: 7500,
    keepPromotedRuns: 30,
    portRunSnapshotDays: 2,
    portRunSnapshotKeepRuns: 20,
    vesselSnapshotsDays: 14,
    portCallMasterDays: 730,
    riskHistoryDays: 365,
    enrichmentDays: 30,
    sourceLogsDays: 60,
    dashboardSummaryDays: 180,
    currentStaleDays: 14,
    eventDays: 60,
    pilotEventDays: 30,
    congestionDays: 60,
    identityDays: 45,
    historyDays: 730,
    routePredictionDays: 365,
    opportunityScoreDays: 365,
    candidateHistoryDays: 365,
    salesPipelineDays: 3650,
    dailyWarehouseDays: 365,
    portDailySummaryDays: 730,
    portWeeklySummaryDays: 1095,
    portMonthlySummaryDays: 3650,
    rawArchiveIndexDays: 365,
    ruleDays: 60,
    featureDays: 90,
    modelDays: 180,
    explainabilityDays: 90
  },
  ideal: {
    targetMb: 4096,
    hardCapMb: 8192,
    keepPromotedRuns: 14,
    portRunSnapshotDays: 2,
    portRunSnapshotKeepRuns: 20,
    vesselSnapshotsDays: 30,
    portCallMasterDays: 730,
    riskHistoryDays: 365,
    enrichmentDays: 30,
    sourceLogsDays: 90,
    dashboardSummaryDays: 180,
    currentStaleDays: 14,
    eventDays: 90,
    pilotEventDays: 90,
    congestionDays: 90,
    identityDays: 90,
    historyDays: 730,
    routePredictionDays: 365,
    opportunityScoreDays: 365,
    candidateHistoryDays: 365,
    salesPipelineDays: 3650,
    dailyWarehouseDays: 365,
    portDailySummaryDays: 730,
    portWeeklySummaryDays: 1095,
    portMonthlySummaryDays: 3650,
    rawArchiveIndexDays: 365,
    ruleDays: 90,
    featureDays: 90,
    modelDays: 180,
    explainabilityDays: 90
  }
};

export function retentionProfileName() {
  const raw = String(process.env.DB_RETENTION_PROFILE || "pro_7_5gb").trim().toLowerCase();
  if (["ideal", "analytics", "growth"].includes(raw)) return "ideal";
  if (["pro", "pro_7_5gb", "pro_7.5gb", "7_5gb", "7500mb", "7.5gb"].includes(raw)) return "pro_7_5gb";
  if (["free", "free_500", "500mb", "free_500mb", "lean"].includes(raw)) return "free_500mb";
  return "pro_7_5gb";
}

export function retentionPolicyFromEnv() {
  const profile = retentionProfileName();
  const defaults = RETENTION_PROFILES[profile] || RETENTION_PROFILES.pro_7_5gb;
  return {
    profile,
    targetMb: retentionNumberEnv("DB_RETENTION_TARGET_MB", defaults.targetMb),
    hardCapMb: retentionNumberEnv("DB_RETENTION_HARD_CAP_MB", defaults.hardCapMb),
    keepPromotedRuns: retentionNumberEnv("DB_RETENTION_KEEP_PROMOTED_RUNS", defaults.keepPromotedRuns),
    portRunSnapshotDays: retentionNumberEnv("DB_RETENTION_PORT_RUN_SNAPSHOT_DAYS", defaults.portRunSnapshotDays),
    portRunSnapshotKeepRuns: retentionNumberEnv("DB_RETENTION_PORT_RUN_SNAPSHOT_KEEP_RUNS", defaults.portRunSnapshotKeepRuns),
    vesselSnapshotsDays: retentionNumberEnv("DB_RETENTION_VESSEL_SNAPSHOTS_DAYS", defaults.vesselSnapshotsDays),
    portCallMasterDays: retentionNumberEnv("DB_RETENTION_PORT_CALL_MASTER_DAYS", defaults.portCallMasterDays),
    riskHistoryDays: retentionNumberEnv("DB_RETENTION_RISK_HISTORY_DAYS", defaults.riskHistoryDays),
    enrichmentDays: retentionNumberEnv("DB_RETENTION_ENRICHMENT_DAYS", defaults.enrichmentDays),
    sourceLogsDays: retentionNumberEnv("DB_RETENTION_SOURCE_LOGS_DAYS", defaults.sourceLogsDays),
    dashboardSummaryDays: retentionNumberEnv("DB_RETENTION_DASHBOARD_SUMMARY_DAYS", defaults.dashboardSummaryDays),
    currentStaleDays: retentionNumberEnv("DB_RETENTION_CURRENT_STALE_DAYS", defaults.currentStaleDays),
    eventDays: retentionNumberEnv("DB_RETENTION_EVENT_DAYS", defaults.eventDays),
    pilotEventDays: retentionNumberEnv("DB_RETENTION_PILOT_EVENT_DAYS", defaults.pilotEventDays),
    congestionDays: retentionNumberEnv("DB_RETENTION_CONGESTION_DAYS", defaults.congestionDays),
    identityDays: retentionNumberEnv("DB_RETENTION_IDENTITY_DAYS", defaults.identityDays),
    historyDays: retentionNumberEnv("DB_RETENTION_HISTORY_DAYS", defaults.historyDays),
    routePredictionDays: retentionNumberEnv("DB_RETENTION_ROUTE_PREDICTION_DAYS", defaults.routePredictionDays),
    opportunityScoreDays: retentionNumberEnv("DB_RETENTION_OPPORTUNITY_SCORE_DAYS", defaults.opportunityScoreDays),
    candidateHistoryDays: retentionNumberEnv("DB_RETENTION_CANDIDATE_HISTORY_DAYS", defaults.candidateHistoryDays),
    salesPipelineDays: retentionNumberEnv("DB_RETENTION_SALES_PIPELINE_DAYS", defaults.salesPipelineDays),
    dailyWarehouseDays: retentionNumberEnv("DB_RETENTION_DAILY_WAREHOUSE_DAYS", defaults.dailyWarehouseDays),
    portDailySummaryDays: retentionNumberEnv("DB_RETENTION_PORT_DAILY_SUMMARY_DAYS", defaults.portDailySummaryDays),
    portWeeklySummaryDays: retentionNumberEnv("DB_RETENTION_PORT_WEEKLY_SUMMARY_DAYS", defaults.portWeeklySummaryDays),
    portMonthlySummaryDays: retentionNumberEnv("DB_RETENTION_PORT_MONTHLY_SUMMARY_DAYS", defaults.portMonthlySummaryDays),
    rawArchiveIndexDays: retentionNumberEnv("DB_RETENTION_RAW_ARCHIVE_INDEX_DAYS", defaults.rawArchiveIndexDays),
    ruleDays: retentionNumberEnv("DB_RETENTION_RULE_DAYS", defaults.ruleDays),
    featureDays: retentionNumberEnv("DB_RETENTION_FEATURE_DAYS", defaults.featureDays),
    modelDays: retentionNumberEnv("DB_RETENTION_MODEL_DAYS", defaults.modelDays),
    explainabilityDays: retentionNumberEnv("DB_RETENTION_EXPLAINABILITY_DAYS", defaults.explainabilityDays)
  };
}
