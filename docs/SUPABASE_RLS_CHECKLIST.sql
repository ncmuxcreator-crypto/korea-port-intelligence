-- HWK v17.7 Supabase RLS checklist
-- Run after confirming backend/service-role read-write path.

ALTER TABLE IF EXISTS public.vessels ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.vessel_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.port_calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.pipeline_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_all_vessels" ON public.vessels;
CREATE POLICY "service_role_all_vessels"
ON public.vessels
FOR ALL
USING (auth.role() = 'service_role')
WITH CHECK (auth.role() = 'service_role');

-- Add similar policies for operational tables after table ownership and app access model are finalized.
