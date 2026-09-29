DROP POLICY rdos_update ON public.rdos;
CREATE POLICY rdos_update ON public.rdos FOR UPDATE TO authenticated
USING (can_write() OR (can_access_work(work_id) AND status = 'draft'))
WITH CHECK (can_write() OR (can_access_work(work_id) AND status IN ('draft','finalized')));