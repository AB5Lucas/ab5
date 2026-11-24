-- Programação: gravações concorrentes sem erro de duplicidade.
-- ensure_schedule: cria (ou devolve) a programação do dia de uma vez só; dois usuários abrindo o mesmo dia
-- vazio ao mesmo tempo não batem mais na chave única daily_schedules_schedule_date_key.
CREATE OR REPLACE FUNCTION public.ensure_schedule(_date date)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $function$
DECLARE sid uuid;
BEGIN
  SELECT id INTO sid FROM public.daily_schedules WHERE schedule_date = _date;
  IF sid IS NOT NULL THEN RETURN sid; END IF;
  INSERT INTO public.daily_schedules (schedule_date, status, created_by)
  VALUES (_date, 'draft', auth.uid())
  ON CONFLICT (schedule_date) DO NOTHING
  RETURNING id INTO sid;
  IF sid IS NULL THEN
    SELECT id INTO sid FROM public.daily_schedules WHERE schedule_date = _date;
  END IF;
  RETURN sid;
END $function$;

-- Reordenação do quadro numa transação (antes um update por linha; falha no meio deixava a ordem pela metade).
CREATE OR REPLACE FUNCTION public.reorder_allocations(_ids uuid[], _orders integer[])
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $function$
BEGIN
  IF coalesce(array_length(_ids, 1), 0) <> coalesce(array_length(_orders, 1), 0) THEN
    RAISE EXCEPTION 'Listas de reordenação com tamanhos diferentes';
  END IF;
  UPDATE public.daily_allocations a
     SET sort_order = x.ord
    FROM unnest(_ids, _orders) AS x(id, ord)
   WHERE a.id = x.id AND a.sort_order IS DISTINCT FROM x.ord;
END $function$;

-- Presença: quem está com a Programação do mesmo dia aberta (renovada a cada 30 s, vale 90 s).
CREATE TABLE IF NOT EXISTS public.schedule_presence (
  schedule_date date NOT NULL,
  user_id uuid NOT NULL,
  seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (schedule_date, user_id)
);
ALTER TABLE public.schedule_presence ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS schedule_presence_select ON public.schedule_presence;
CREATE POLICY schedule_presence_select ON public.schedule_presence FOR SELECT
  USING ((SELECT public.is_active_user()));

CREATE OR REPLACE FUNCTION public.schedule_presence_ping(_date date)
RETURNS TABLE (user_id uuid, full_name text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE me uuid := auth.uid();
BEGIN
  IF me IS NULL OR NOT public.is_active_user() THEN RETURN; END IF;
  INSERT INTO public.schedule_presence (schedule_date, user_id, seen_at) VALUES (_date, me, now())
  ON CONFLICT ON CONSTRAINT schedule_presence_pkey DO UPDATE SET seen_at = now();
  DELETE FROM public.schedule_presence sp WHERE sp.seen_at < now() - interval '1 day';
  RETURN QUERY
    SELECT p.user_id, coalesce(nullif(u.full_name, ''), u.email, 'Usuário')::text
      FROM public.schedule_presence p
      LEFT JOIN public.users_profiles u ON u.id = p.user_id
     WHERE p.schedule_date = _date AND p.user_id <> me AND p.seen_at > now() - interval '90 seconds'
     ORDER BY 2;
END $function$;

-- Sai da página: some da lista dos outros na hora.
CREATE OR REPLACE FUNCTION public.schedule_presence_leave(_date date)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  DELETE FROM public.schedule_presence WHERE schedule_date = _date AND user_id = auth.uid();
$function$;

REVOKE ALL ON FUNCTION public.schedule_presence_ping(date) FROM anon;
REVOKE ALL ON FUNCTION public.schedule_presence_leave(date) FROM anon;
REVOKE ALL ON FUNCTION public.ensure_schedule(date) FROM anon;
REVOKE ALL ON FUNCTION public.reorder_allocations(uuid[], integer[]) FROM anon;
