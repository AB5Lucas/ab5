-- Alojamentos (Americana e Mogi Guaçu): quem está alojado e desde/até quando.
-- Americana: sem VT e sem prêmio viagem na Suzano; nas outras obras o prêmio viagem é pela distância de Americana.
-- Mogi Guaçu: tratado como morador de Mogi Guaçu (VT e prêmio pela distância de Mogi Guaçu).
CREATE TABLE IF NOT EXISTS public.lodging_stays (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  collaborator_id uuid NOT NULL REFERENCES public.collaborators(id) ON DELETE CASCADE,
  lodging text NOT NULL CHECK (lodging IN ('americana', 'mogi_guacu')),
  start_date date NOT NULL DEFAULT CURRENT_DATE,
  end_date date,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid DEFAULT auth.uid(),
  CHECK (end_date IS NULL OR end_date >= start_date)
);
CREATE INDEX IF NOT EXISTS idx_lodging_stays_collaborator ON public.lodging_stays (collaborator_id, start_date);
ALTER TABLE public.lodging_stays ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lodging_stays_select ON public.lodging_stays;
CREATE POLICY lodging_stays_select ON public.lodging_stays FOR SELECT TO authenticated USING ((SELECT public.is_active_user()));
DROP POLICY IF EXISTS lodging_stays_write ON public.lodging_stays;
CREATE POLICY lodging_stays_write ON public.lodging_stays FOR ALL TO authenticated
  USING ((SELECT public.can_write()) OR (SELECT public.can_access_page('/programacao/diaria')))
  WITH CHECK ((SELECT public.can_write()) OR (SELECT public.can_access_page('/programacao/diaria')));
