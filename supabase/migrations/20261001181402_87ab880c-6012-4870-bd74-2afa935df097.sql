CREATE OR REPLACE FUNCTION public.can_access_page(_path text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH r AS (
    SELECT CASE
      WHEN public.has_role(auth.uid(),'admin') THEN 'admin'
      WHEN public.has_role(auth.uid(),'programmer') THEN 'programmer'
      WHEN public.has_role(auth.uid(),'coordenador') THEN 'coordenador'
      WHEN public.has_role(auth.uid(),'encarregado') THEN 'encarregado'
      ELSE 'viewer' END::app_role AS role
  )
  SELECT auth.uid() IS NOT NULL AND COALESCE(
    (SELECT a.allowed FROM public.role_page_access a, r WHERE a.role = r.role AND a.path = _path),
    (SELECT CASE WHEN r.role = 'encarregado' THEN _path LIKE '/externo%'
                 WHEN r.role = 'coordenador' THEN false
                 ELSE true END FROM r)
  )
$$;

DROP POLICY days_off_insert ON public.days_off;
DROP POLICY days_off_update ON public.days_off;
CREATE POLICY days_off_insert ON public.days_off FOR INSERT TO authenticated WITH CHECK (public.can_write() OR public.can_access_page('/ausencias/folgas'));
CREATE POLICY days_off_update ON public.days_off FOR UPDATE TO authenticated USING (public.can_write() OR public.can_access_page('/ausencias/folgas')) WITH CHECK (public.can_write() OR public.can_access_page('/ausencias/folgas'));

DROP POLICY medical_leaves_insert ON public.medical_leaves;
DROP POLICY medical_leaves_update ON public.medical_leaves;
CREATE POLICY medical_leaves_insert ON public.medical_leaves FOR INSERT TO authenticated WITH CHECK (public.can_write() OR public.can_access_page('/ausencias/atestados'));
CREATE POLICY medical_leaves_update ON public.medical_leaves FOR UPDATE TO authenticated USING (public.can_write() OR public.can_access_page('/ausencias/atestados')) WITH CHECK (public.can_write() OR public.can_access_page('/ausencias/atestados'));

DROP POLICY vacations_insert ON public.vacations;
DROP POLICY vacations_update ON public.vacations;
CREATE POLICY vacations_insert ON public.vacations FOR INSERT TO authenticated WITH CHECK (public.can_write() OR public.can_access_page('/ausencias/ferias'));
CREATE POLICY vacations_update ON public.vacations FOR UPDATE TO authenticated USING (public.can_write() OR public.can_access_page('/ausencias/ferias')) WITH CHECK (public.can_write() OR public.can_access_page('/ausencias/ferias'));