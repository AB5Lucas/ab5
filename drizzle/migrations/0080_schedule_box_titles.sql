CREATE TABLE public.schedule_box_titles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id uuid NOT NULL REFERENCES public.daily_schedules(id) ON DELETE CASCADE,
  box_key text NOT NULL,
  title text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (schedule_id, box_key)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.schedule_box_titles TO authenticated;
GRANT ALL ON public.schedule_box_titles TO service_role;
ALTER TABLE public.schedule_box_titles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "box titles read" ON public.schedule_box_titles FOR SELECT TO authenticated USING (true);
CREATE POLICY "box titles write" ON public.schedule_box_titles FOR ALL TO authenticated USING (public.can_write()) WITH CHECK (public.can_write());
CREATE TRIGGER trg_schedule_box_titles_updated BEFORE UPDATE ON public.schedule_box_titles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();