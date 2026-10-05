CREATE TABLE public.timeclock_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rdo_workforce_id uuid NOT NULL REFERENCES public.rdo_workforce(id) ON DELETE CASCADE,
  kind text NOT NULL,
  status text NOT NULL DEFAULT 'tratado',
  treated_by uuid DEFAULT auth.uid(),
  treated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (rdo_workforce_id, kind)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.timeclock_adjustments TO authenticated;
GRANT ALL ON public.timeclock_adjustments TO service_role;
ALTER TABLE public.timeclock_adjustments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Ajuste de ponto: leitura" ON public.timeclock_adjustments FOR SELECT TO authenticated
  USING (public.is_admin() OR public.can_access_page('/relatorios/ajuste-ponto'));
CREATE POLICY "Ajuste de ponto: inserir" ON public.timeclock_adjustments FOR INSERT TO authenticated
  WITH CHECK (public.is_admin() OR public.can_access_page('/relatorios/ajuste-ponto'));
CREATE POLICY "Ajuste de ponto: alterar" ON public.timeclock_adjustments FOR UPDATE TO authenticated
  USING (public.is_admin() OR public.can_access_page('/relatorios/ajuste-ponto'));