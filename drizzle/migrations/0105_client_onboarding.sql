-- Documentação em novos clientes: acompanhamento, como a Conferência, mas sem depender de integração cadastrada.
-- Um acompanhamento por colaborador × cliente; cada documento enviado (ASO, treinamento ou outro) é aceito à parte.
CREATE TABLE IF NOT EXISTS public.client_onboardings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  collaborator_id uuid NOT NULL REFERENCES public.collaborators(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'concluido')),
  sent_at date,
  next_check_date date,
  notes text,
  completed_at timestamptz,
  completed_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid DEFAULT auth.uid()
);
-- Só um acompanhamento aberto por pessoa e cliente.
CREATE UNIQUE INDEX IF NOT EXISTS uq_client_onboardings_open ON public.client_onboardings (client_id, collaborator_id) WHERE status = 'pendente';
CREATE TABLE IF NOT EXISTS public.client_onboarding_docs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  onboarding_id uuid NOT NULL REFERENCES public.client_onboardings(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('aso', 'treinamento', 'outro')),
  training_id uuid REFERENCES public.trainings(id) ON DELETE SET NULL,
  label text,
  approved boolean NOT NULL DEFAULT false,
  approved_at timestamptz,
  approved_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_client_onboarding_docs_onb ON public.client_onboarding_docs (onboarding_id);

ALTER TABLE public.client_onboardings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_onboarding_docs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS client_onboardings_select ON public.client_onboardings;
CREATE POLICY client_onboardings_select ON public.client_onboardings FOR SELECT TO authenticated USING ((SELECT public.is_active_user()));
DROP POLICY IF EXISTS client_onboardings_write ON public.client_onboardings;
CREATE POLICY client_onboardings_write ON public.client_onboardings FOR ALL TO authenticated
  USING ((SELECT public.can_write())) WITH CHECK ((SELECT public.can_write()));
DROP POLICY IF EXISTS client_onboarding_docs_select ON public.client_onboarding_docs;
CREATE POLICY client_onboarding_docs_select ON public.client_onboarding_docs FOR SELECT TO authenticated USING ((SELECT public.is_active_user()));
DROP POLICY IF EXISTS client_onboarding_docs_write ON public.client_onboarding_docs;
CREATE POLICY client_onboarding_docs_write ON public.client_onboarding_docs FOR ALL TO authenticated
  USING ((SELECT public.can_write())) WITH CHECK ((SELECT public.can_write()));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_onboardings, public.client_onboarding_docs TO authenticated;
