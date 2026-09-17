CREATE TABLE public.schedule_client_visibility (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_date date NOT NULL,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  visible boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (schedule_date, client_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.schedule_client_visibility TO authenticated;
GRANT ALL ON public.schedule_client_visibility TO service_role;

ALTER TABLE public.schedule_client_visibility ENABLE ROW LEVEL SECURITY;

CREATE POLICY "scv_select" ON public.schedule_client_visibility FOR SELECT TO authenticated USING (true);
CREATE POLICY "scv_insert" ON public.schedule_client_visibility FOR INSERT TO authenticated WITH CHECK (public.can_write());
CREATE POLICY "scv_update" ON public.schedule_client_visibility FOR UPDATE TO authenticated USING (public.can_write()) WITH CHECK (public.can_write());
CREATE POLICY "scv_delete" ON public.schedule_client_visibility FOR DELETE TO authenticated USING (public.can_write());

CREATE TRIGGER trg_scv_updated BEFORE UPDATE ON public.schedule_client_visibility
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_scv_date ON public.schedule_client_visibility (schedule_date);

ALTER TABLE public.appointments ADD COLUMN client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL;

UPDATE public.appointments a
SET client_id = w.client_id
FROM public.works w
WHERE a.work_id = w.id AND a.client_id IS NULL;