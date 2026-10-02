ALTER TABLE public.collaborators ADD COLUMN IF NOT EXISTS travel_bonus_enabled boolean NOT NULL DEFAULT true;
ALTER TABLE public.daily_allocations ADD COLUMN IF NOT EXISTS travel_bonus_override boolean;
CREATE TABLE public.schedule_work_travel (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id uuid NOT NULL REFERENCES public.daily_schedules(id) ON DELETE CASCADE,
  work_id uuid NOT NULL REFERENCES public.works(id) ON DELETE CASCADE,
  pays_bonus boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (schedule_id, work_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.schedule_work_travel TO authenticated;
GRANT ALL ON public.schedule_work_travel TO service_role;
ALTER TABLE public.schedule_work_travel ENABLE ROW LEVEL SECURITY;
CREATE POLICY swt_select ON public.schedule_work_travel FOR SELECT TO authenticated USING (true);
CREATE POLICY swt_write ON public.schedule_work_travel FOR ALL TO authenticated USING (public.can_write()) WITH CHECK (public.can_write());