const BIOFOULING_SENSITIVE = ['AUSTRALIA', 'BRAZIL', 'NEW ZEALAND', 'CALIFORNIA'];
const HIGH_VALUE_TYPES = ['VLCC', 'BULKER', 'CAPE', 'CAPESIZE', 'CRUISE', 'TANKER', 'LNG', 'LPG'];

export function scoreRecord(v) {
  let score = 0;
  const reasons = [];
  const text = `${v.status || ''} ${v.berth || ''}`.toUpperCase();
  const type = `${v.vessel_type || ''}`.toUpperCase();
  const nextCountry = `${v.next_port_country || ''}`.toUpperCase();

  if (text.includes('ANCHOR') || text.includes('WAIT') || text.includes('대기') || text.includes('묘박')) {
    score += 20;
    reasons.push('Anchorage/waiting status');
  }

  if (HIGH_VALUE_TYPES.some(t => type.includes(t))) {
    score += 20;
    reasons.push('High-value vessel type');
  }

  if (BIOFOULING_SENSITIVE.some(c => nextCountry.includes(c))) {
    score += 25;
    reasons.push('Biofouling-sensitive next destination');
  }

  if (v.operator) {
    score += 10;
    reasons.push('Operator identified');
  }

  if (v.imo) {
    score += 5;
    reasons.push('IMO available for enrichment');
  }

  return { ...v, risk_score: Math.min(score, 100), sales_reason: reasons };
}

export function scoreBatch(records) {
  return records.map(scoreRecord).sort((a, b) => b.risk_score - a.risk_score);
}
