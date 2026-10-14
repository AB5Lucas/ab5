CREATE OR REPLACE FUNCTION public.andam_client_ok(_client uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT public.is_active_user() AND (
    public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'programmer') OR public.has_role(auth.uid(),'viewer') AND NOT (public.has_role(auth.uid(),'coordenador') OR public.has_role(auth.uid(),'encarregado'))
    OR EXISTS (SELECT 1 FROM public.foreman_works fw JOIN public.works w ON w.id = fw.work_id WHERE fw.user_id = auth.uid() AND w.client_id = _client)
    OR (_client IS NULL AND EXISTS (SELECT 1 FROM public.foreman_works fw JOIN public.works w ON w.id = fw.work_id JOIN public.clients c ON c.id = w.client_id
        WHERE fw.user_id = auth.uid() AND upper(trim(c.name)) IN ('PATIO','PÁTIO'))));
$function$;