-- Folga ou férias tiram a pessoa da obra: ao lançar/alterar a ausência, as alocações daqueles dias são apagadas;
-- e alocação nova num dia de folga/férias é ignorada (como quem está num quadro, 0129).
CREATE OR REPLACE FUNCTION public.collaborator_off_on(_collab uuid, _date date) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
  SELECT EXISTS (SELECT 1 FROM days_off o WHERE o.collaborator_id = _collab AND o.date <= _date AND coalesce(o.end_date, o.date) >= _date)
      OR EXISTS (SELECT 1 FROM vacations v WHERE v.collaborator_id = _collab AND v.start_date <= _date AND v.end_date >= _date AND v.status <> 'cancelled')
$f$;

CREATE OR REPLACE FUNCTION public.allocation_skips_boxed() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
BEGIN
  IF EXISTS (SELECT 1 FROM daily_status_entries e WHERE e.schedule_id = NEW.schedule_id AND e.collaborator_id = NEW.collaborator_id) THEN
    RETURN NULL;
  END IF;
  IF public.collaborator_off_on(NEW.collaborator_id, (SELECT schedule_date FROM daily_schedules WHERE id = NEW.schedule_id)) THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END $f$;

CREATE OR REPLACE FUNCTION public.absence_removes_allocation() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE d1 date; d2 date;
BEGIN
  IF TG_TABLE_NAME = 'days_off' THEN
    d1 := NEW.date; d2 := coalesce(NEW.end_date, NEW.date);
  ELSE
    IF NEW.status = 'cancelled' THEN RETURN NEW; END IF;
    d1 := NEW.start_date; d2 := NEW.end_date;
  END IF;
  DELETE FROM daily_allocations a USING daily_schedules s
   WHERE s.id = a.schedule_id AND a.collaborator_id = NEW.collaborator_id AND s.schedule_date BETWEEN d1 AND d2;
  RETURN NEW;
END $f$;

DROP TRIGGER IF EXISTS trg_days_off_removes_allocation ON public.days_off;
CREATE TRIGGER trg_days_off_removes_allocation AFTER INSERT OR UPDATE OF date, end_date, collaborator_id ON public.days_off
  FOR EACH ROW EXECUTE FUNCTION public.absence_removes_allocation();
DROP TRIGGER IF EXISTS trg_vacations_removes_allocation ON public.vacations;
CREATE TRIGGER trg_vacations_removes_allocation AFTER INSERT OR UPDATE OF start_date, end_date, status, collaborator_id ON public.vacations
  FOR EACH ROW EXECUTE FUNCTION public.absence_removes_allocation();

-- Limpeza de hoje em diante (dias passados ficam como estão por causa dos fechamentos).
DELETE FROM daily_allocations a USING daily_schedules s
 WHERE s.id = a.schedule_id AND s.schedule_date >= (now() AT TIME ZONE 'America/Sao_Paulo')::date
   AND public.collaborator_off_on(a.collaborator_id, s.schedule_date);
