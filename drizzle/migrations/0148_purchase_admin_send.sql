-- Emergência: administrador (diretoria) envia e edita o rascunho de outro solicitante.
-- purchase_request_send: a checagem do dono passou a ser "requester_id = auth.uid() OR has_role(admin)" (resto igual à versão anterior).
DO $$ DECLARE d text; BEGIN
  SELECT pg_get_functiondef(oid) INTO d FROM pg_proc WHERE proname = 'purchase_request_send';
  d := replace(d, 'IF r.id IS NULL OR r.requester_id <> auth.uid() THEN RAISE EXCEPTION ''Solicitação não encontrada''; END IF;',
    'IF r.id IS NULL OR NOT (r.requester_id = auth.uid() OR public.has_role(auth.uid(), ''admin'')) THEN RAISE EXCEPTION ''Solicitação não encontrada''; END IF;');
  EXECUTE d;
END $$;
CREATE OR REPLACE FUNCTION public.purchase_can_edit(_r purchase_requests)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$ SELECT (_r.stage = 'rascunho' AND (_r.requester_id = auth.uid() OR public.has_role(auth.uid(), 'admin')))
  OR (_r.stage = 'aprovacao' AND (_r.approver_id = auth.uid() OR public.purchase_effective_approver(_r) = auth.uid() OR public.has_role(auth.uid(), 'admin'))) $$;
