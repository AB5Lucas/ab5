ALTER TABLE public.works ADD COLUMN order_value numeric NOT NULL DEFAULT 0, ADD COLUMN budget_cost numeric NOT NULL DEFAULT 0;

CREATE TABLE public.work_progress (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_id uuid NOT NULL REFERENCES public.works(id) ON DELETE CASCADE,
  month date NOT NULL,
  percent numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (work_id, month)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.work_progress TO authenticated;
GRANT ALL ON public.work_progress TO service_role;
ALTER TABLE public.work_progress ENABLE ROW LEVEL SECURITY;
CREATE POLICY "wp read" ON public.work_progress FOR SELECT TO authenticated USING (public.can_write() OR public.has_role(auth.uid(),'viewer'));
CREATE POLICY "wp write" ON public.work_progress FOR ALL TO authenticated USING (public.can_write()) WITH CHECK (public.can_write());
CREATE TRIGGER trg_work_progress_updated BEFORE UPDATE ON public.work_progress FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.work_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_id uuid NOT NULL REFERENCES public.works(id) ON DELETE CASCADE,
  entry_date date NOT NULL,
  category text NOT NULL,
  description text,
  amount numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.work_entries TO authenticated;
GRANT ALL ON public.work_entries TO service_role;
ALTER TABLE public.work_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "we read" ON public.work_entries FOR SELECT TO authenticated USING (public.can_write() OR public.has_role(auth.uid(),'viewer'));
CREATE POLICY "we write" ON public.work_entries FOR ALL TO authenticated USING (public.can_write()) WITH CHECK (public.can_write());
CREATE TRIGGER trg_work_entries_updated BEFORE UPDATE ON public.work_entries FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();