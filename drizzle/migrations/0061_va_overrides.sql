CREATE TABLE public.va_overrides (ym text NOT NULL, collaborator_id uuid NOT NULL, value numeric NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (ym, collaborator_id));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.va_overrides TO authenticated;
GRANT ALL ON public.va_overrides TO service_role;
ALTER TABLE public.va_overrides ENABLE ROW LEVEL SECURITY;
CREATE POLICY vao_all ON public.va_overrides FOR ALL TO authenticated USING (public.can_access_page('/relatorios/vale-alimentacao')) WITH CHECK (public.can_access_page('/relatorios/vale-alimentacao'));