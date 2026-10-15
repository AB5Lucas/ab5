CREATE TABLE public.user_page_access (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  path text NOT NULL,
  allowed boolean NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, path)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_page_access TO authenticated;
GRANT ALL ON public.user_page_access TO service_role;
ALTER TABLE public.user_page_access ENABLE ROW LEVEL SECURITY;
CREATE POLICY "upa read own or admin" ON public.user_page_access FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.is_admin());
CREATE POLICY "upa admin insert" ON public.user_page_access FOR INSERT TO authenticated WITH CHECK (public.is_admin());
CREATE POLICY "upa admin update" ON public.user_page_access FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "upa admin delete" ON public.user_page_access FOR DELETE TO authenticated USING (public.is_admin());

CREATE OR REPLACE FUNCTION public.can_access_page(_path text)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  WITH r AS (
    SELECT CASE
      WHEN public.has_role(auth.uid(),'admin') THEN 'admin'
      WHEN public.has_role(auth.uid(),'programmer') THEN 'programmer'
      WHEN public.has_role(auth.uid(),'coordenador') THEN 'coordenador'
      WHEN public.has_role(auth.uid(),'encarregado') THEN 'encarregado'
      ELSE 'viewer' END::app_role AS role
  )
  SELECT auth.uid() IS NOT NULL AND COALESCE(
    (SELECT u.allowed FROM public.user_page_access u WHERE u.user_id = auth.uid() AND u.path = _path),
    (SELECT a.allowed FROM public.role_page_access a, r WHERE a.role = r.role AND a.path = _path),
    (SELECT CASE WHEN r.role = 'encarregado' THEN _path LIKE '/externo%'
                 WHEN r.role = 'coordenador' THEN false
                 ELSE true END FROM r)
  )
$function$;