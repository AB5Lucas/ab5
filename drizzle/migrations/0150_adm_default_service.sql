-- Cliente ADM: quem é escalado no quadro do cliente sem serviço distribuído vai sempre para o serviço Administração
-- (todo dia, sem ficar pendente na aba Serviços). Escolha feita à mão (ex.: Diretoria) não é mexida.
CREATE OR REPLACE FUNCTION public.adm_default_service()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _adm uuid; _work uuid;
BEGIN
  IF NEW.service_assigned OR NEW.work_id IS NULL THEN RETURN NEW; END IF;
  SELECT w.client_id INTO _adm FROM works w JOIN clients c ON c.id = w.client_id WHERE w.id = NEW.work_id AND upper(trim(c.name)) = 'ADM';
  IF _adm IS NULL THEN RETURN NEW; END IF;
  SELECT id INTO _work FROM works WHERE client_id = _adm AND active AND upper(trim(name)) IN ('ADMINISTRAÇÃO', 'ADMINISTRACAO', 'ADMINISTRATIVO') ORDER BY created_at LIMIT 1;
  IF _work IS NULL THEN RETURN NEW; END IF;
  NEW.work_id := _work;
  NEW.service_assigned := true;
  RETURN NEW;
END $function$;
DROP TRIGGER IF EXISTS trg_adm_default_service ON public.daily_allocations;
CREATE TRIGGER trg_adm_default_service BEFORE INSERT OR UPDATE OF work_id, service_assigned ON public.daily_allocations
  FOR EACH ROW EXECUTE FUNCTION public.adm_default_service();
-- Dias já programados (de hoje em diante) que ficaram pendentes.
UPDATE public.daily_allocations a SET service_assigned = false
  FROM daily_schedules s, works w, clients c
 WHERE s.id = a.schedule_id AND w.id = a.work_id AND c.id = w.client_id AND upper(trim(c.name)) = 'ADM'
   AND NOT a.service_assigned AND s.schedule_date >= (now() AT TIME ZONE 'America/Sao_Paulo')::date;
