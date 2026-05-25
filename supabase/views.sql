create or replace view latest_priority_vessels as
select distinct on (pc.vessel_id, pc.port)
  pc.vessel_id,
  pc.vessel_name,
  pc.imo,
  pc.port,
  pc.berth,
  pc.eta,
  pc.etd,
  pc.status,
  pc.source,
  pc.collected_at,
  pc.risk_score,
  pc.sales_reason,
  v.operator,
  v.vessel_type
from port_calls pc
left join vessels v on v.vessel_id = pc.vessel_id
order by pc.vessel_id, pc.port, pc.collected_at desc;
