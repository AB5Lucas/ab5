CREATE TABLE public.result_support_allocations (collaborator_id uuid NOT NULL REFERENCES public.collaborators(id) ON DELETE CASCADE, client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (collaborator_id,client_id));
GRANT SELECT,INSERT,UPDATE,DELETE ON public.result_support_allocations TO authenticated;
GRANT ALL ON public.result_support_allocations TO service_role;
ALTER TABLE public.result_support_allocations ENABLE ROW LEVEL SECURITY;
CREATE POLICY result_support_read ON public.result_support_allocations FOR SELECT TO authenticated USING (public.can_access_client(client_id));
CREATE POLICY result_support_write ON public.result_support_allocations FOR ALL TO authenticated USING (public.can_write() AND public.can_access_client(client_id) AND public.can_access_page('/obras/resultado')) WITH CHECK (public.can_write() AND public.can_access_client(client_id) AND public.can_access_page('/obras/resultado'));