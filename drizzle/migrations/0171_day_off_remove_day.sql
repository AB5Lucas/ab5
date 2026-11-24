-- Tirar alguém do quadro FOLGAS na Programação: folga de vários dias pode sair inteira ou só daquele dia.
-- Só o dia: encurta o período (primeiro/último dia) ou divide em dois registros (dia no meio). Uma transação.
-- SECURITY INVOKER: valem as permissões de days_off (RLS).
CREATE OR REPLACE FUNCTION public.day_off_remove_day(_collaborator_id uuid, _date date, _whole boolean DEFAULT false)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $function$
DECLARE rec record; n integer := 0; last_day date;
BEGIN
  FOR rec IN
    SELECT id, date, end_date, reason, notes FROM public.days_off
     WHERE collaborator_id = _collaborator_id AND date <= _date AND coalesce(end_date, date) >= _date
     FOR UPDATE
  LOOP
    last_day := coalesce(rec.end_date, rec.date);
    IF _whole OR last_day = rec.date THEN
      DELETE FROM public.days_off WHERE id = rec.id;
    ELSIF rec.date = _date THEN
      UPDATE public.days_off SET date = _date + 1 WHERE id = rec.id;
    ELSIF last_day = _date THEN
      UPDATE public.days_off SET end_date = _date - 1 WHERE id = rec.id;
    ELSE
      UPDATE public.days_off SET end_date = _date - 1 WHERE id = rec.id;
      INSERT INTO public.days_off (collaborator_id, date, end_date, reason, notes)
      VALUES (_collaborator_id, _date + 1, last_day, rec.reason, rec.notes);
    END IF;
    n := n + 1;
  END LOOP;
  RETURN n;
END $function$;

REVOKE ALL ON FUNCTION public.day_off_remove_day(uuid, date, boolean) FROM anon;
