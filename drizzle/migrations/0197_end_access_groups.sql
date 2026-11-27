INSERT INTO public.user_page_access (user_id, path, allowed, updated_at)
SELECT up.id, gp.path, gp.allowed, now()
FROM public.users_profiles up JOIN public.access_group_pages gp ON gp.group_id = up.access_group_id
WHERE NOT EXISTS (SELECT 1 FROM public.user_page_access x WHERE x.user_id = up.id AND x.path = gp.path);

INSERT INTO public.user_page_access (user_id, path, allowed, updated_at)
SELECT up.id, '@salario', true, now() FROM public.users_profiles up JOIN public.access_groups g ON g.id = up.access_group_id
WHERE g.key IN ('dir','rh') AND NOT EXISTS (SELECT 1 FROM public.user_page_access x WHERE x.user_id = up.id AND x.path = '@salario');
INSERT INTO public.user_page_access (user_id, path, allowed, updated_at)
SELECT up.id, '@aviso-contratacoes', true, now() FROM public.users_profiles up JOIN public.access_groups g ON g.id = up.access_group_id
WHERE g.key = 'rh' AND NOT EXISTS (SELECT 1 FROM public.user_page_access x WHERE x.user_id = up.id AND x.path = '@aviso-contratacoes');

DROP TRIGGER IF EXISTS trg_users_profiles_default_group ON public.users_profiles;

CREATE OR REPLACE FUNCTION public.notif_buyer_ids() RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT DISTINCT up.id FROM users_profiles up JOIN purchase_alcadas a ON a.user_id = up.id AND a.alcada = 'comprador' WHERE up.active
$$;

CREATE OR REPLACE FUNCTION public.can_access_page(_path text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
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

COMMENT ON TABLE public.access_groups IS 'DEPRECATED: grupos extintos em 27/11/2026; acessos individuais em user_page_access';
COMMENT ON TABLE public.access_group_pages IS 'DEPRECATED: grupos extintos em 27/11/2026; acessos individuais em user_page_access';
COMMENT ON COLUMN public.users_profiles.access_group_id IS 'DEPRECATED: grupos extintos em 27/11/2026';