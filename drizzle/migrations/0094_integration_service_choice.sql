-- Programação › Serviços: quem está em integração num cliente fica no Rateio (padrão, sem linha aqui)
-- ou vai para um serviço do cliente, que arca com todo o custo do dia e recebe a pessoa no RDO.
CREATE TABLE IF NOT EXISTS public.integration_service_choices (
  schedule_date date NOT NULL,
  collaborator_id uuid NOT NULL REFERENCES public.collaborators(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  work_id uuid NOT NULL REFERENCES public.works(id) ON DELETE CASCADE,
  updated_by uuid DEFAULT auth.uid(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (schedule_date, collaborator_id, client_id)
);
CREATE INDEX IF NOT EXISTS integration_service_choices_client ON public.integration_service_choices(client_id, schedule_date);

-- O serviço tem de ser do mesmo cliente.
CREATE OR REPLACE FUNCTION public.integration_service_choices_check() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM works w WHERE w.id = NEW.work_id AND w.client_id = NEW.client_id) THEN
    RAISE EXCEPTION 'O serviço escolhido não é deste cliente';
  END IF;
  NEW.updated_at := now();
  NEW.updated_by := coalesce(auth.uid(), NEW.updated_by);
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS integration_service_choices_check ON public.integration_service_choices;
CREATE TRIGGER integration_service_choices_check BEFORE INSERT OR UPDATE ON public.integration_service_choices
  FOR EACH ROW EXECUTE FUNCTION public.integration_service_choices_check();

GRANT SELECT, INSERT, UPDATE, DELETE ON public.integration_service_choices TO authenticated;
GRANT ALL ON public.integration_service_choices TO service_role;
ALTER TABLE public.integration_service_choices ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS integration_service_choices_read ON public.integration_service_choices;
DROP POLICY IF EXISTS integration_service_choices_write ON public.integration_service_choices;
-- Leitura: usuários ativos (RDO, Resultados e Financeiro usam a escolha). Escrita: quem acessa Serviços e o cliente.
CREATE POLICY integration_service_choices_read ON public.integration_service_choices FOR SELECT TO authenticated
  USING ((SELECT public.is_active_user()));
CREATE POLICY integration_service_choices_write ON public.integration_service_choices FOR ALL TO authenticated
  USING ((SELECT public.can_access_page('/programacao/servicos')) AND public.can_access_client(client_id))
  WITH CHECK ((SELECT public.can_access_page('/programacao/servicos')) AND public.can_access_client(client_id));
