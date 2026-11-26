DROP POLICY IF EXISTS purchase_alcadas_select ON public.purchase_alcadas;
CREATE POLICY purchase_alcadas_select ON public.purchase_alcadas FOR SELECT TO authenticated
USING (
  public.is_active_user() AND (
    user_id = auth.uid()
    OR public.is_admin()
    OR public.can_access_page('/compras/aprovacao-compra')
    OR public.can_access_page('/compras/comprador')
  )
);