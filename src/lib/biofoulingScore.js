function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, finiteNumber(value, min)));
}

export function normalize(value, min = 0, max = 1) {
  if (max === min) return 0;
  return clamp((finiteNumber(value) - min) / (max - min));
}

export function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(finiteNumber(value) * factor) / factor;
}

export function portmisRecencyBoost(portmisLastTs, now = new Date(), explicitBoost = null) {
  if (Number.isFinite(Number(explicitBoost))) return clamp(Number(explicitBoost), 0, 1.4);
  const timestamp = Date.parse(portmisLastTs || "");
  if (!Number.isFinite(timestamp)) return 0.1;
  const ageHours = (now.getTime() - timestamp) / 36e5;
  if (ageHours <= 6) return 1.4;
  if (ageHours <= 24) return 1;
  if (ageHours <= 72) return 0.6;
  return 0.2;
}

export function calculateBiofoulingNext4dScore(record = {}, options = {}) {
  const residenceHours = Math.max(0, finiteNumber(record.residence_hours_96h, record.residenceHours96h || 0));
  const sstAnomaly = finiteNumber(record.sst_anomaly_c, record.sstAnomalyC || 0);
  const recencyBoost = portmisRecencyBoost(record.portmis_last_ts, options.now || new Date(), record.portmis_recency_boost);
  const residenceComponent = normalize(residenceHours, 0, 72) * 0.5;
  const sstComponent = normalize(Math.max(sstAnomaly, 0), 0, 2) * 0.3;
  const recencyComponent = recencyBoost * 0.2;
  const combinedScore = clamp(residenceComponent + sstComponent + recencyComponent);
  return {
    residence_component: round(residenceComponent, 4),
    sst_component: round(sstComponent, 4),
    recency_component: round(recencyComponent, 4),
    portmis_recency_boost: round(recencyBoost, 2),
    combined_score: round(combinedScore, 2)
  };
}

export function scoreLevelKo(score) {
  const value = finiteNumber(score);
  if (value >= 0.75) return "높음";
  if (value >= 0.5) return "주의";
  return "낮음";
}

export function scoreActionKo(score) {
  const value = finiteNumber(score);
  if (value >= 0.75) return "즉시 영업 후보";
  if (value >= 0.55) return "관심 후보";
  if (value >= 0.35) return "관찰";
  return "낮음";
}

export function buildScoreReasonKo(record = {}, score = record.combined_score) {
  const residence = round(record.residence_hours_96h, 1);
  const anomaly = round(record.sst_anomaly_c, 1);
  const sst72 = round(record.sst_72h_c_avg, 1);
  const sst7 = round(record.sst_7d_c_avg, 1);
  const level = scoreLevelKo(score);
  const fragments = [];
  if (residence >= 48) fragments.push(`최근 96시간 중 항만 체류가 ${residence}시간으로 깁니다`);
  else if (residence > 0) fragments.push(`최근 96시간 체류가 ${residence}시간입니다`);
  if (anomaly >= 0.8) fragments.push(`최근 수온이 7일 평균보다 ${anomaly}℃ 높습니다`);
  else if (anomaly > 0) fragments.push(`수온 이상치가 +${anomaly}℃로 관찰됩니다`);
  if (record.portmis_last_ts) fragments.push("Port-MIS 정보가 최근성 판단에 반영되었습니다");
  if (!fragments.length) fragments.push("체류와 수온 신호가 제한적이어서 관찰 대상으로 분류됩니다");
  return `${fragments.join(", ")}. 72시간 평균 수온 ${sst72}℃, 7일 평균 ${sst7}℃ 기준으로 부착생물 위험은 ${level} 수준입니다.`;
}

export function toBiofoulingNext4dRecord(input = {}, options = {}) {
  const score = calculateBiofoulingNext4dScore(input, options);
  const combined = Number.isFinite(Number(input.combined_score)) && options.preserveProvidedScore
    ? round(input.combined_score, 2)
    : score.combined_score;
  return {
    mmsi: String(input.mmsi || ""),
    imo: String(input.imo || ""),
    vessel_name: String(input.vessel_name || input.vesselName || "선명 확인 필요"),
    port_name_ko: String(input.port_name_ko || input.portNameKo || "부산"),
    lon: round(input.lon, 6),
    lat: round(input.lat, 6),
    ais_first_seen: input.ais_first_seen || null,
    ais_last_seen: input.ais_last_seen || null,
    residence_hours_96h: round(input.residence_hours_96h, 1),
    sst_72h_c_avg: round(input.sst_72h_c_avg, 1),
    sst_7d_c_avg: round(input.sst_7d_c_avg, 1),
    sst_anomaly_c: round(input.sst_anomaly_c, 2),
    portmis_last_ts: input.portmis_last_ts || null,
    combined_score: combined,
    score_reason_ko: input.score_reason_ko || buildScoreReasonKo(input, combined),
    data_health: input.data_health || { status: "estimated", sources: ["mock"] },
    updated_at: input.updated_at || input.ais_last_seen || null,
    score_components: score
  };
}
