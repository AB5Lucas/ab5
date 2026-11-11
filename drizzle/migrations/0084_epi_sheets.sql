-- Fichas de EPI: uma por colaborador, mesmo controle do ASO (vence 1 ano após a entrega − 1 dia).
CREATE TABLE IF NOT EXISTS public.epi_sheets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  collaborator_id uuid NOT NULL UNIQUE REFERENCES public.collaborators(id) ON DELETE CASCADE,
  delivered_at date,
  expires_at date GENERATED ALWAYS AS (((delivered_at + '1 year'::interval))::date - 1) STORED,
  -- Arquivada: não sinaliza mais vencimento nem falta (como "Documentação" nas Integrações).
  archived boolean NOT NULL DEFAULT false,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
DROP TRIGGER IF EXISTS trg_epi_sheets_updated ON public.epi_sheets;
CREATE TRIGGER trg_epi_sheets_updated BEFORE UPDATE ON public.epi_sheets FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
GRANT SELECT, INSERT, UPDATE, DELETE ON public.epi_sheets TO authenticated;
GRANT ALL ON public.epi_sheets TO service_role;
ALTER TABLE public.epi_sheets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS epi_sheets_select ON public.epi_sheets;
DROP POLICY IF EXISTS epi_sheets_insert ON public.epi_sheets;
DROP POLICY IF EXISTS epi_sheets_update ON public.epi_sheets;
DROP POLICY IF EXISTS epi_sheets_delete ON public.epi_sheets;
CREATE POLICY epi_sheets_select ON public.epi_sheets FOR SELECT TO authenticated USING ((SELECT public.is_active_user()));
CREATE POLICY epi_sheets_insert ON public.epi_sheets FOR INSERT TO authenticated WITH CHECK ((SELECT public.can_write()));
CREATE POLICY epi_sheets_update ON public.epi_sheets FOR UPDATE TO authenticated USING ((SELECT public.can_write())) WITH CHECK ((SELECT public.can_write()));
CREATE POLICY epi_sheets_delete ON public.epi_sheets FOR DELETE TO authenticated USING ((SELECT public.can_write()));
