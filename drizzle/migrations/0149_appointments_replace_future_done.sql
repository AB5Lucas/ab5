-- Agendamento novo também cancela o do mesmo tipo marcado "realizado" com data futura (marcação por engano:
-- realizado no futuro não existe e continuava aparecendo no quadro do dia).
CREATE OR REPLACE FUNCTION public.appointments_replace_future()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _today date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  IF NEW.status IS DISTINCT FROM 'agendado' THEN RETURN NEW; END IF;
  UPDATE appointments a SET status = 'cancelado'
   WHERE a.id <> NEW.id AND a.collaborator_id = NEW.collaborator_id AND a.type = NEW.type
     AND ((a.status = 'agendado' AND a.scheduled_date >= _today) OR (a.status = 'realizado' AND a.scheduled_date > _today))
     AND (NEW.type <> 'treinamento' OR a.training_id IS NOT DISTINCT FROM NEW.training_id)
     AND (NEW.type <> 'integracao' OR a.client_id IS NOT DISTINCT FROM NEW.client_id);
  RETURN NEW;
END $function$;
-- Marcio Fernandes (MARS GUA): integração de 23/11 marcada realizada por engano em 19/11; a válida é a de 30/11.
UPDATE public.appointments SET status = 'cancelado' WHERE id = 'cde2a40b-4c46-4e3b-a6d2-d1272ed50abd' AND status = 'realizado';
