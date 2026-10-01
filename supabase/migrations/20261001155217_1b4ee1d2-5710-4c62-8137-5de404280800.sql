CREATE OR REPLACE FUNCTION public.can_access_work(_work_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.can_write() OR EXISTS (
    SELECT 1 FROM public.foreman_works fw
    JOIN public.works wl ON wl.id = fw.work_id
    JOIN public.works wt ON wt.id = _work_id
    WHERE fw.user_id = auth.uid()
      AND (fw.work_id = _work_id OR (wt.client_id IS NOT NULL AND wl.client_id = wt.client_id)));
$$;