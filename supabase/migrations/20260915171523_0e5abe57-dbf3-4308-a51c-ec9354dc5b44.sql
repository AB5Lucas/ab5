CREATE TABLE public.client_integrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  collaborator_id uuid NOT NULL REFERENCES public.collaborators(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  integration_date date NOT NULL DEFAULT CURRENT_DATE,
  expires_at date,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_integrations TO authenticated;
GRANT ALL ON public.client_integrations TO service_role;

ALTER TABLE public.client_integrations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "integrations_select" ON public.client_integrations FOR SELECT TO authenticated USING (true);
CREATE POLICY "integrations_insert" ON public.client_integrations FOR INSERT TO authenticated WITH CHECK (public.can_write());
CREATE POLICY "integrations_update" ON public.client_integrations FOR UPDATE TO authenticated USING (public.can_write()) WITH CHECK (public.can_write());
CREATE POLICY "integrations_delete" ON public.client_integrations FOR DELETE TO authenticated USING (public.is_admin());

CREATE UNIQUE INDEX client_integrations_collaborator_client_key ON public.client_integrations (collaborator_id, client_id);
CREATE INDEX idx_client_integrations_client ON public.client_integrations (client_id);

CREATE TRIGGER trg_client_integrations_updated BEFORE UPDATE ON public.client_integrations
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();