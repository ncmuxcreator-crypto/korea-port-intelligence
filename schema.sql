export async function collect() {
  return {
    source: 'sample',
    raw: JSON.stringify({ ok: true, note: 'Replace this collector with Busan/Yeosu/Ulsan source logic.' }),
    rows: [
      {
        vessel_name: 'MV HF ZHOUSHAN',
        imo: '9876543',
        vessel_type: 'BULKER',
        operator: 'Sample Operator',
        port: 'Samcheonpo',
        berth: 'TBN',
        eta: '2026-05-24T09:00:00+09:00',
        status: 'Anchorage / Waiting',
        next_port_country: 'Australia'
      },
      {
        vessel_name: 'ADORA MAGIC CITY',
        imo: '9821234',
        vessel_type: 'CRUISE',
        operator: 'Adora Cruises',
        port: 'Busan',
        berth: 'Yeongdo Cruise Terminal',
        eta: '2026-05-24T12:00:00+09:00',
        status: 'Berth Assigned'
      }
    ]
  };
}
