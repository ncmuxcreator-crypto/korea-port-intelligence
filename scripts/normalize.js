import crypto from 'crypto';

function cleanText(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim().replace(/\s+/g, ' ');
}

function createVesselId(v) {
  const imo = cleanText(v.imo).replace(/[^0-9]/g, '');
  if (imo) return `IMO-${imo}`;
  const base = [v.vessel_name, v.port, v.eta || v.status || 'UNKNOWN'].map(cleanText).join('|').toUpperCase();
  return `TEMP-${crypto.createHash('sha1').update(base).digest('hex').slice(0, 12)}`;
}

function createUniqueKey(v) {
  const base = [v.vessel_id, v.port, v.source, v.eta || '', v.etd || '', v.status || ''].join('|');
  return crypto.createHash('sha1').update(base).digest('hex');
}

export function normalizeRecord(input, sourceName, collectedAt) {
  const rec = {
    vessel_name: cleanText(input.vessel_name || input.name || input.shipName),
    imo: cleanText(input.imo || input.IMO).replace(/[^0-9]/g, ''),
    vessel_type: cleanText(input.vessel_type || input.type),
    operator: cleanText(input.operator || input.owner || input.manager),
    port: cleanText(input.port),
    berth: cleanText(input.berth || input.terminal),
    eta: input.eta || null,
    etd: input.etd || null,
    status: cleanText(input.status),
    source: sourceName,
    collected_at: collectedAt,
    raw_payload: input
  };
  if (!rec.vessel_name || !rec.port) return null;
  rec.vessel_id = createVesselId(rec);
  rec.unique_key = createUniqueKey(rec);
  return rec;
}

export function normalizeBatch(rows, sourceName, collectedAt) {
  return rows.map(row => normalizeRecord(row, sourceName, collectedAt)).filter(Boolean);
}
