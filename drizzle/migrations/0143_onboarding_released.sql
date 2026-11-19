-- Novos Clientes: concluir a documentação deixa a pessoa "liberada para integrar" (status liberado, aviso laranja);
-- quando a integração naquele cliente é agendada/realizada ou lançada válida, o acompanhamento vai sozinho para o histórico.
ALTER TABLE public.client_onboardings DROP CONSTRAINT IF EXISTS client_onboardings_status_check;
ALTER TABLE public.client_onboardings ADD CONSTRAINT client_onboardings_status_check CHECK (status IN ('pendente', 'liberado', 'concluido'));
DROP INDEX IF EXISTS public.uq_client_onboardings_open;
CREATE UNIQUE INDEX IF NOT EXISTS uq_client_onboardings_open ON public.client_onboardings (client_id, collaborator_id) WHERE status IN ('pendente', 'liberado');

CREATE OR REPLACE FUNCTION public.onboarding_close_on_integration() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_TABLE_NAME = 'appointments' THEN
    IF NEW.type <> 'integracao' OR NEW.client_id IS NULL OR NEW.status NOT IN ('agendado', 'realizado') THEN RETURN NEW; END IF;
  ELSIF NEW.expires_at IS NOT NULL AND NEW.expires_at < (now() AT TIME ZONE 'America/Sao_Paulo')::date THEN
    RETURN NEW;
  END IF;
  UPDATE client_onboardings SET status = 'concluido', completed_at = coalesce(completed_at, now())
  WHERE collaborator_id = NEW.collaborator_id AND client_id = NEW.client_id AND status = 'liberado';
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_onboarding_close_on_appointment ON public.appointments;
CREATE TRIGGER trg_onboarding_close_on_appointment AFTER INSERT OR UPDATE OF status ON public.appointments
  FOR EACH ROW EXECUTE FUNCTION public.onboarding_close_on_integration();
DROP TRIGGER IF EXISTS trg_onboarding_close_on_integration ON public.client_integrations;
CREATE TRIGGER trg_onboarding_close_on_integration AFTER INSERT OR UPDATE OF expires_at ON public.client_integrations
  FOR EACH ROW EXECUTE FUNCTION public.onboarding_close_on_integration();
