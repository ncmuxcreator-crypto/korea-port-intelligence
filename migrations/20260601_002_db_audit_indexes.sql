-- Safe index repairs reported by DB integrity audit.
-- Scope: lookup performance and idempotent current-table uniqueness only.

begin;

create index if not exists idx_port_call_master_run_id
  on port_call_master(run_id);

create index if not exists idx_opportunity_master_run_id
  on opportunity_master(run_id);

create unique index if not exists ux_dashboard_summary_snapshots_run_id
  on dashboard_summary_snapshots(run_id);

create unique index if not exists ux_port_summary_current_run_port
  on port_summary_current(run_id, port_code);

create unique index if not exists ux_sales_candidates_current_run_vessel
  on sales_candidates_current(run_id, master_vessel_id)
  where master_vessel_id is not null;

commit;
