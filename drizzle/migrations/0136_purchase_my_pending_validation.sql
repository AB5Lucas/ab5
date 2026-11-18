-- Aviso do menu Validação: só as SCs que estão com a pessoa agora (gestor; substituto enquanto o gestor está de férias).
CREATE OR REPLACE FUNCTION public.purchase_my_pending_validation() RETURNS TABLE(due_date date)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT r.due_date FROM purchase_requests r
  WHERE r.stage = 'aprovacao' AND public.purchase_effective_approver(r) = auth.uid()
$$;
REVOKE EXECUTE ON FUNCTION public.purchase_my_pending_validation() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.purchase_my_pending_validation() TO authenticated;
