CREATE TABLE public.schedule_box_vt (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id uuid NOT NULL REFERENCES public.daily_schedules(id) ON DELETE CASCADE,
  box_key text NOT NULL,
  pays_vt boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (schedule_id, box_key)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.schedule_box_vt TO authenticated;
GRANT ALL ON public.schedule_box_vt TO service_role;
ALTER TABLE public.schedule_box_vt ENABLE ROW LEVEL SECURITY;
CREATE POLICY "box vt read" ON public.schedule_box_vt FOR SELECT TO authenticated USING (true);
CREATE POLICY "box vt write" ON public.schedule_box_vt FOR ALL TO authenticated USING (public.can_write()) WITH CHECK (public.can_write());
CREATE TRIGGER trg_schedule_box_vt_updated BEFORE UPDATE ON public.schedule_box_vt FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.schedule_person_vt (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id uuid NOT NULL REFERENCES public.daily_schedules(id) ON DELETE CASCADE,
  box_key text NOT NULL,
  collaborator_id uuid NOT NULL REFERENCES public.collaborators(id) ON DELETE CASCADE,
  pays_vt boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (schedule_id, box_key, collaborator_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.schedule_person_vt TO authenticated;
GRANT ALL ON public.schedule_person_vt TO service_role;
ALTER TABLE public.schedule_person_vt ENABLE ROW LEVEL SECURITY;
CREATE POLICY "person vt read" ON public.schedule_person_vt FOR SELECT TO authenticated USING (true);
CREATE POLICY "person vt write" ON public.schedule_person_vt FOR ALL TO authenticated USING (public.can_write()) WITH CHECK (public.can_write());
CREATE TRIGGER trg_schedule_person_vt_updated BEFORE UPDATE ON public.schedule_person_vt FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();