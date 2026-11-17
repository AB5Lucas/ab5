-- Aprovadores virou subaba do Comprador: quem acessa o Comprador cadastra os aprovadores. A aba Aprovação saiu
-- (o aprovador usa o filtro "Minhas aprovações" em Solicitações).
DROP POLICY IF EXISTS purchase_approvers_write ON public.purchase_approvers;
CREATE POLICY purchase_approvers_write ON public.purchase_approvers FOR ALL TO authenticated
  USING ((SELECT public.can_access_page('/compras/comprador'))) WITH CHECK ((SELECT public.can_access_page('/compras/comprador')));
DELETE FROM public.role_page_access WHERE path IN ('/compras/aprovadores', '/compras/aprovacao');
