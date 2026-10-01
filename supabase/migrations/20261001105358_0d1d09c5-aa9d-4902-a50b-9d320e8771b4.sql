CREATE OR REPLACE FUNCTION public.can_write()
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'programmer') OR public.has_role(auth.uid(), 'coordenador');
$$;