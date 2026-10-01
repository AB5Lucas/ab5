CREATE TABLE public.closing_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  collaborator_id uuid NOT NULL REFERENCES public.collaborators(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('vt','premio')),
  entry_date date NOT NULL,
  description text,
  amount numeric NOT NULL DEFAULT 0,
  notes text,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.closing_adjustments TO authenticated;
GRANT ALL ON public.closing_adjustments TO service_role;
ALTER TABLE public.closing_adjustments ENABLE ROW LEVEL SECURITY;
CREATE POLICY ca_select ON public.closing_adjustments FOR SELECT TO authenticated USING (true);
CREATE POLICY ca_insert ON public.closing_adjustments FOR INSERT TO authenticated WITH CHECK (public.can_write());
CREATE POLICY ca_update ON public.closing_adjustments FOR UPDATE TO authenticated USING (public.can_write());
CREATE POLICY ca_delete ON public.closing_adjustments FOR DELETE TO authenticated USING (public.can_write());
CREATE INDEX ON public.closing_adjustments (entry_date);
CREATE TRIGGER trg_ca_updated BEFORE UPDATE ON public.closing_adjustments FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();