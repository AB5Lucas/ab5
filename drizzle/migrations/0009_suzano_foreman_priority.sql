CREATE TABLE public.closing_foreman_priority (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  collaborator_id uuid NOT NULL UNIQUE REFERENCES public.collaborators(id) ON DELETE CASCADE,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.closing_foreman_priority TO authenticated;
GRANT ALL ON public.closing_foreman_priority TO service_role;
ALTER TABLE public.closing_foreman_priority ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read priority" ON public.closing_foreman_priority FOR SELECT TO authenticated USING (public.can_access_page('/fechamentos/suzano'));
CREATE POLICY "write priority" ON public.closing_foreman_priority FOR ALL TO authenticated USING (public.can_write()) WITH CHECK (public.can_write());