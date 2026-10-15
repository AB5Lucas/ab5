CREATE TABLE public.training_cert_data (
  training_id uuid PRIMARY KEY REFERENCES public.trainings(id) ON DELETE CASCADE,
  code text, subject text, workload_hours numeric, schedule_text text,
  cert_phrase text, legal_basis text, program text, objectives text, norms text,
  default_location text DEFAULT 'Mogi Guaçu', is_periodic_label boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid
);
CREATE TABLE public.tst_instructors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name text NOT NULL, cpf text, registration text, council text,
  role_title text DEFAULT 'Téc. Seg. Trabalho', company text, active boolean NOT NULL DEFAULT true,
  notes text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.training_certificates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  collaborator_id uuid NOT NULL REFERENCES public.collaborators(id) ON DELETE CASCADE,
  training_id uuid NOT NULL REFERENCES public.trainings(id) ON DELETE CASCADE,
  training_date date NOT NULL, tst_id uuid REFERENCES public.tst_instructors(id),
  kind text NOT NULL, kind_manual boolean NOT NULL DEFAULT false,
  version int NOT NULL DEFAULT 1, snapshot jsonb NOT NULL,
  issued_by uuid DEFAULT auth.uid(), issued_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.training_certificates (training_date);
CREATE TABLE public.attendance_lists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  training_id uuid NOT NULL REFERENCES public.trainings(id) ON DELETE CASCADE,
  training_date date NOT NULL, tst_id uuid REFERENCES public.tst_instructors(id),
  version int NOT NULL DEFAULT 1, snapshot jsonb NOT NULL,
  issued_by uuid DEFAULT auth.uid(), issued_at timestamptz NOT NULL DEFAULT now()
);
DO $$ DECLARE t text; BEGIN
FOREACH t IN ARRAY ARRAY['training_cert_data','tst_instructors','training_certificates','attendance_lists'] LOOP
  EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
  EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
  EXECUTE format('CREATE POLICY "read" ON public.%I FOR SELECT TO authenticated USING (public.is_active_user() AND public.can_access_page(''/demandas/certificados''))', t);
  EXECUTE format('CREATE POLICY "ins" ON public.%I FOR INSERT TO authenticated WITH CHECK (public.is_active_user() AND public.can_access_page(''/demandas/certificados''))', t);
  EXECUTE format('CREATE POLICY "upd" ON public.%I FOR UPDATE TO authenticated USING (public.is_active_user() AND public.can_access_page(''/demandas/certificados'')) WITH CHECK (public.is_active_user() AND public.can_access_page(''/demandas/certificados''))', t);
END LOOP; END $$;
CREATE POLICY "del" ON public.tst_instructors FOR DELETE TO authenticated USING (public.is_admin());
CREATE POLICY "del" ON public.training_cert_data FOR DELETE TO authenticated USING (public.is_admin());