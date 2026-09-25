CREATE TABLE public.schedule_work_vt (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id uuid NOT NULL REFERENCES public.daily_schedules(id) ON DELETE CASCADE,
  work_id uuid NOT NULL REFERENCES public.works(id) ON DELETE CASCADE,
  pays_vt boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (schedule_id, work_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.schedule_work_vt TO authenticated;
GRANT ALL ON public.schedule_work_vt TO service_role;
ALTER TABLE public.schedule_work_vt ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read vt" ON public.schedule_work_vt FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth write vt" ON public.schedule_work_vt FOR ALL TO authenticated USING (true) WITH CHECK (true);

ALTER TABLE public.daily_allocations ADD COLUMN vt_override boolean;

INSERT INTO public.schedule_work_vt (schedule_id, work_id, pays_vt)
SELECT DISTINCT a.schedule_id, a.work_id, COALESCE(c.needs_transport_voucher, false)
FROM public.daily_allocations a
JOIN public.works w ON w.id = a.work_id
LEFT JOIN public.clients c ON c.id = w.client_id
WHERE a.work_id IS NOT NULL
ON CONFLICT DO NOTHING;