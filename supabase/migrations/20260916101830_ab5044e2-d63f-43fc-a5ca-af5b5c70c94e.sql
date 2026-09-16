CREATE TABLE public.asos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  collaborator_id uuid NOT NULL REFERENCES public.collaborators(id) ON DELETE CASCADE,
  exam_date date NOT NULL,
  expires_at date NOT NULL GENERATED ALWAYS AS ((exam_date + interval '1 year')::date) STORED,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.asos TO authenticated;
GRANT ALL ON public.asos TO service_role;

ALTER TABLE public.asos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "asos_select" ON public.asos FOR SELECT TO authenticated USING (true);
CREATE POLICY "asos_insert" ON public.asos FOR INSERT TO authenticated WITH CHECK (public.can_write());
CREATE POLICY "asos_update" ON public.asos FOR UPDATE TO authenticated USING (public.can_write()) WITH CHECK (public.can_write());
CREATE POLICY "asos_delete" ON public.asos FOR DELETE TO authenticated USING (public.is_admin());

CREATE UNIQUE INDEX asos_collaborator_key ON public.asos (collaborator_id);

CREATE TRIGGER trg_asos_updated BEFORE UPDATE ON public.asos
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();