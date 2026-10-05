CREATE TABLE public.work_shifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  is_default boolean NOT NULL DEFAULT false,
  schedule jsonb NOT NULL DEFAULT '{}'::jsonb,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.work_shifts TO authenticated;
GRANT ALL ON public.work_shifts TO service_role;
ALTER TABLE public.work_shifts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read shifts" ON public.work_shifts FOR SELECT TO authenticated USING (true);
CREATE POLICY "insert shifts" ON public.work_shifts FOR INSERT TO authenticated WITH CHECK (public.can_write());
CREATE POLICY "update shifts" ON public.work_shifts FOR UPDATE TO authenticated USING (public.can_write());
CREATE POLICY "delete shifts" ON public.work_shifts FOR DELETE TO authenticated USING (public.can_write() AND NOT is_default);
CREATE TRIGGER trg_work_shifts_updated BEFORE UPDATE ON public.work_shifts FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE UNIQUE INDEX work_shifts_one_default ON public.work_shifts (is_default) WHERE is_default;
INSERT INTO public.work_shifts (name, is_default, schedule) SELECT 'Padrão', true,
 '{"1":{"start":"07:00","end":"17:00"},"2":{"start":"07:00","end":"17:00"},"3":{"start":"07:00","end":"17:00"},"4":{"start":"07:00","end":"17:00"},"5":{"start":"07:00","end":"16:00"}}'::jsonb;
ALTER TABLE public.collaborators ADD COLUMN shift_id uuid REFERENCES public.work_shifts(id) ON DELETE SET NULL;
COMMENT ON COLUMN public.collaborators.shift_id IS 'Turno do colaborador; NULL = turno Padrão';