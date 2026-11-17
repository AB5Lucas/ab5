-- Novo agendamento substitui o futuro do mesmo tipo: ASO; treinamento da mesma NR; integração no mesmo cliente.
CREATE OR REPLACE FUNCTION public.appointments_replace_future() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM 'agendado' THEN RETURN NEW; END IF;
  UPDATE appointments a SET status = 'cancelado'
   WHERE a.id <> NEW.id AND a.collaborator_id = NEW.collaborator_id AND a.type = NEW.type AND a.status = 'agendado'
     AND a.scheduled_date >= (now() AT TIME ZONE 'America/Sao_Paulo')::date
     AND (NEW.type <> 'treinamento' OR a.training_id IS NOT DISTINCT FROM NEW.training_id)
     AND (NEW.type <> 'integracao' OR a.client_id IS NOT DISTINCT FROM NEW.client_id);
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_appointments_replace_future ON public.appointments;
CREATE TRIGGER trg_appointments_replace_future AFTER INSERT ON public.appointments FOR EACH ROW EXECUTE FUNCTION public.appointments_replace_future();
