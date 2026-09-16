CREATE TABLE public.appointments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL CHECK (type IN ('aso','treinamento','integracao')),
  collaborator_id uuid NOT NULL REFERENCES public.collaborators(id) ON DELETE CASCADE,
  scheduled_date date NOT NULL,
  training_id uuid REFERENCES public.trainings(id) ON DELETE SET NULL,
  work_id uuid REFERENCES public.works(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'agendado' CHECK (status IN ('agendado','realizado','cancelado')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.appointments TO authenticated;
GRANT ALL ON public.appointments TO service_role;

ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "appointments_select" ON public.appointments FOR SELECT TO authenticated USING (true);
CREATE POLICY "appointments_insert" ON public.appointments FOR INSERT TO authenticated WITH CHECK (public.can_write());
CREATE POLICY "appointments_update" ON public.appointments FOR UPDATE TO authenticated USING (public.can_write()) WITH CHECK (public.can_write());
CREATE POLICY "appointments_delete" ON public.appointments FOR DELETE TO authenticated USING (public.is_admin());

CREATE INDEX idx_appointments_date ON public.appointments (scheduled_date);
CREATE INDEX idx_appointments_collaborator ON public.appointments (collaborator_id);

CREATE TRIGGER trg_appointments_updated BEFORE UPDATE ON public.appointments
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();