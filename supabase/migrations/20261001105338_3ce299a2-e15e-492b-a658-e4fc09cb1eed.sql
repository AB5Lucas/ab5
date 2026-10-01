ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'coordenador';

CREATE TABLE public.role_page_access (
  role public.app_role NOT NULL,
  path text NOT NULL,
  allowed boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (role, path)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.role_page_access TO authenticated;
GRANT ALL ON public.role_page_access TO service_role;
ALTER TABLE public.role_page_access ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Autenticados leem acessos" ON public.role_page_access FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admin insere acessos" ON public.role_page_access FOR INSERT TO authenticated WITH CHECK (public.is_admin());
CREATE POLICY "Admin altera acessos" ON public.role_page_access FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "Admin exclui acessos" ON public.role_page_access FOR DELETE TO authenticated USING (public.is_admin());

-- Administrador nunca perde a página Acessos
CREATE OR REPLACE FUNCTION public.protect_admin_access()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.role = 'admin' AND NEW.path = '/admin/acessos' THEN NEW.allowed := true; END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER trg_protect_admin_access BEFORE INSERT OR UPDATE ON public.role_page_access
FOR EACH ROW EXECUTE FUNCTION public.protect_admin_access();