CREATE OR REPLACE FUNCTION public.is_cliente()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$ SELECT auth.uid() IS NOT NULL AND public.has_role(auth.uid(), 'cliente'::app_role); $$;

CREATE OR REPLACE FUNCTION public.can_write()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$ SELECT auth.uid() IS NOT NULL AND public.is_active_user() AND NOT public.is_cliente(); $$;

CREATE OR REPLACE FUNCTION public.can_access_work(_work_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT public.can_write() OR EXISTS (
    SELECT 1 FROM public.foreman_works fw
    JOIN public.works wl ON wl.id = fw.work_id
    JOIN public.works wt ON wt.id = _work_id
    WHERE fw.user_id = auth.uid() AND public.is_active_user()
      AND (fw.work_id = _work_id
           OR (NOT public.is_cliente() AND wt.client_id IS NOT NULL AND wl.client_id = wt.client_id)));
$$;

CREATE OR REPLACE FUNCTION public.can_edit_rdo(_rdo_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT NOT public.is_cliente() AND EXISTS (SELECT 1 FROM public.rdos r WHERE r.id = _rdo_id
    AND (public.can_write() OR (public.can_access_work(r.work_id) AND r.status = 'draft')));
$$;

CREATE OR REPLACE FUNCTION public.can_access_client(_client_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT NOT public.is_cliente() AND public.can_access_page('/programacao/servicos') AND (
    public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'programmer') OR EXISTS (
      SELECT 1 FROM public.foreman_works fw JOIN public.works w ON w.id = fw.work_id
      WHERE fw.user_id = auth.uid() AND w.client_id = _client_id));
$$;

DROP POLICY IF EXISTS rdos_insert ON public.rdos;
CREATE POLICY rdos_insert ON public.rdos FOR INSERT TO authenticated
  WITH CHECK (NOT public.is_cliente() AND public.can_access_work(work_id));
DROP POLICY IF EXISTS rdos_update ON public.rdos;
CREATE POLICY rdos_update ON public.rdos FOR UPDATE TO authenticated
  USING (NOT public.is_cliente() AND (public.can_write() OR (public.can_access_work(work_id) AND status = 'draft')))
  WITH CHECK (NOT public.is_cliente() AND (public.can_write() OR (public.can_access_work(work_id) AND status = ANY (ARRAY['draft','finalized']))));

DROP POLICY IF EXISTS rdo_signatures_ins ON public.rdo_signatures;
CREATE POLICY rdo_signatures_ins ON public.rdo_signatures FOR INSERT TO authenticated
  WITH CHECK (public.can_edit_rdo(rdo_id) OR (public.is_cliente() AND kind = 'client' AND public.can_access_rdo(rdo_id)));
DROP POLICY IF EXISTS rdo_signatures_upd ON public.rdo_signatures;
CREATE POLICY rdo_signatures_upd ON public.rdo_signatures FOR UPDATE TO authenticated
  USING (public.can_edit_rdo(rdo_id) OR (public.is_cliente() AND kind = 'client' AND public.can_access_rdo(rdo_id)))
  WITH CHECK (public.can_edit_rdo(rdo_id) OR (public.is_cliente() AND kind = 'client' AND public.can_access_rdo(rdo_id)));
DROP POLICY IF EXISTS rdo_signatures_del ON public.rdo_signatures;
CREATE POLICY rdo_signatures_del ON public.rdo_signatures FOR DELETE TO authenticated
  USING (public.can_edit_rdo(rdo_id) OR (public.is_cliente() AND kind = 'client' AND public.can_access_rdo(rdo_id)));