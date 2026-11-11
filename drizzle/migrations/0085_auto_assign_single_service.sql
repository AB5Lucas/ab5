-- Cliente com um único serviço ativo: a MO escalada nesse serviço já entra distribuída (service_assigned),
-- sem passar pela aba Serviços. Vale ao escalar (insert) e ao mudar a pessoa de serviço/cliente (work_id).
CREATE OR REPLACE FUNCTION public.auto_assign_single_service() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_client uuid; v_n int; v_only uuid;
BEGIN
  IF NEW.service_assigned OR NEW.work_id IS NULL THEN RETURN NEW; END IF;
  SELECT client_id INTO v_client FROM works WHERE id = NEW.work_id;
  IF v_client IS NULL THEN RETURN NEW; END IF;
  SELECT count(*), min(id::text)::uuid INTO v_n, v_only FROM works WHERE client_id = v_client AND active;
  IF v_n = 1 AND v_only = NEW.work_id THEN NEW.service_assigned := true; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_auto_assign_single_service ON public.daily_allocations;
CREATE TRIGGER trg_auto_assign_single_service BEFORE INSERT OR UPDATE OF work_id ON public.daily_allocations
  FOR EACH ROW EXECUTE FUNCTION public.auto_assign_single_service();
