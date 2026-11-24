-- Montagem do transporte: quem sai do cliente na Programação (alocação apagada ou movida para serviço de outro
-- cliente) deixa de ser passageiro do transporte daquele cliente no dia. Antes a linha em transport_passengers
-- ficava e o cliente/dia continuava "montado" (VT e prêmio motorista pela montagem).
CREATE OR REPLACE FUNCTION public.drop_passenger_on_allocation_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  old_client uuid;
  new_client uuid;
  d date;
BEGIN
  SELECT client_id INTO old_client FROM public.works WHERE id = OLD.work_id;
  IF old_client IS NULL THEN RETURN NULL; END IF;
  IF TG_OP = 'UPDATE' THEN
    SELECT client_id INTO new_client FROM public.works WHERE id = NEW.work_id;
    IF new_client IS NOT DISTINCT FROM old_client
       AND NEW.collaborator_id = OLD.collaborator_id
       AND NEW.schedule_id = OLD.schedule_id THEN
      RETURN NULL;
    END IF;
  END IF;
  SELECT schedule_date INTO d FROM public.daily_schedules WHERE id = OLD.schedule_id;
  IF d IS NULL THEN RETURN NULL; END IF;
  -- Continua escalado em outro serviço do mesmo cliente no dia: fica no transporte.
  IF EXISTS (
    SELECT 1 FROM public.daily_allocations a JOIN public.works w ON w.id = a.work_id
    WHERE a.schedule_id = OLD.schedule_id AND a.collaborator_id = OLD.collaborator_id AND w.client_id = old_client
  ) THEN
    RETURN NULL;
  END IF;
  DELETE FROM public.transport_passengers
    WHERE schedule_date = d AND client_id = old_client AND collaborator_id = OLD.collaborator_id;
  RETURN NULL;
END $function$;

DROP TRIGGER IF EXISTS trg_daily_allocations_drop_passenger ON public.daily_allocations;
CREATE TRIGGER trg_daily_allocations_drop_passenger
  AFTER DELETE OR UPDATE OF work_id, collaborator_id, schedule_id ON public.daily_allocations
  FOR EACH ROW EXECUTE FUNCTION public.drop_passenger_on_allocation_change();

-- Limpeza: passageiros que já não atendem o cliente no dia (sem escalação num serviço do cliente e sem integração
-- nele). Conferido antes: nenhum cliente/dia deixa de estar "montado" por isso (sempre há outro passageiro válido),
-- então VT e prêmio de meses fechados não mudam.
DELETE FROM public.transport_passengers tp
USING public.clients c
WHERE c.id = tp.client_id
  AND NOT EXISTS (
    SELECT 1 FROM public.daily_schedules s
    JOIN public.daily_allocations a ON a.schedule_id = s.id
    JOIN public.works w ON w.id = a.work_id
    WHERE s.schedule_date = tp.schedule_date AND a.collaborator_id = tp.collaborator_id AND w.client_id = tp.client_id)
  AND NOT EXISTS (
    SELECT 1 FROM public.daily_schedules s
    JOIN public.daily_status_entries e ON e.schedule_id = s.id
    WHERE s.schedule_date = tp.schedule_date AND e.collaborator_id = tp.collaborator_id AND e.box_key = 'integracao:' || c.name)
  AND NOT EXISTS (
    SELECT 1 FROM public.appointments ap
    WHERE ap.type = 'integracao' AND ap.client_id = tp.client_id AND ap.collaborator_id = tp.collaborator_id
      AND coalesce(ap.completed_date, ap.scheduled_date) = tp.schedule_date AND ap.status NOT IN ('cancelled', 'canceled'));
