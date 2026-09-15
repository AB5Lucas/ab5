CREATE TABLE public.daily_status_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id uuid NOT NULL REFERENCES public.daily_schedules(id) ON DELETE CASCADE,
  collaborator_id uuid NOT NULL REFERENCES public.collaborators(id) ON DELETE CASCADE,
  box_key text NOT NULL,
  notes text,
  sort_order numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX daily_status_entries_unique ON public.daily_status_entries (schedule_id, collaborator_id);
CREATE INDEX idx_daily_status_entries_schedule ON public.daily_status_entries (schedule_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.daily_status_entries TO authenticated;
GRANT ALL ON public.daily_status_entries TO service_role;

ALTER TABLE public.daily_status_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY status_entries_select ON public.daily_status_entries FOR SELECT TO authenticated USING (true);
CREATE POLICY status_entries_insert ON public.daily_status_entries FOR INSERT TO authenticated WITH CHECK (can_write());
CREATE POLICY status_entries_update ON public.daily_status_entries FOR UPDATE TO authenticated USING (can_write()) WITH CHECK (can_write());
CREATE POLICY status_entries_delete ON public.daily_status_entries FOR DELETE TO authenticated USING (can_write());

CREATE TRIGGER trg_daily_status_entries_updated BEFORE UPDATE ON public.daily_status_entries
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();