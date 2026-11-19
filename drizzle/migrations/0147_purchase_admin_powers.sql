-- Diretoria / administração do sistema (perfil administrador) faz tudo em Compras: comprador, validar/devolver e editar SC em validação.
CREATE OR REPLACE FUNCTION public.purchase_is_buyer()
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$ SELECT public.is_active_user() AND (public.can_access_page('/compras/comprador') OR public.has_role(auth.uid(), 'admin')) $$;

CREATE OR REPLACE FUNCTION public.purchase_can_edit(_r purchase_requests)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$ SELECT (_r.requester_id = auth.uid() AND _r.stage = 'rascunho')
  OR (_r.stage = 'aprovacao' AND (_r.approver_id = auth.uid() OR public.purchase_effective_approver(_r) = auth.uid() OR public.has_role(auth.uid(), 'admin'))) $$;
