-- Treinamentos exigidos por cliente (cadastro do cliente). A Programação bloqueia a escalação de quem está sem
-- o treinamento ou com ele vencido, salvo aceite na Conferência para aquele cliente.
CREATE TABLE IF NOT EXISTS public.client_required_trainings (
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  training_id uuid NOT NULL REFERENCES public.trainings(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (client_id, training_id)
);
CREATE INDEX IF NOT EXISTS client_required_trainings_training_idx ON public.client_required_trainings (training_id);
ALTER TABLE public.client_required_trainings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS client_required_trainings_select ON public.client_required_trainings;
CREATE POLICY client_required_trainings_select ON public.client_required_trainings FOR SELECT TO authenticated
  USING ((SELECT public.is_active_user()));
DROP POLICY IF EXISTS client_required_trainings_write ON public.client_required_trainings;
CREATE POLICY client_required_trainings_write ON public.client_required_trainings FOR ALL TO authenticated
  USING ((SELECT public.can_write())) WITH CHECK ((SELECT public.can_write()));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_required_trainings TO authenticated;
