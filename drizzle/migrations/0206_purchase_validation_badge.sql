-- Aviso do menu Validação conta o mesmo que a tela (validador ou substituto da SC, além do validador efetivo).
CREATE OR REPLACE FUNCTION public.purchase_my_pending_validation()
 RETURNS TABLE(due_date date) LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT r.due_date FROM purchase_requests r
  WHERE r.stage = 'aprovacao'
    AND (r.approver_id = auth.uid() OR r.substitute_id = auth.uid() OR public.purchase_effective_approver(r) = auth.uid())
$function$;
