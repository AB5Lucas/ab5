-- Compras: comprador vê todas as SCs (qualquer etapa); o gestor (ou substituto) que recebe uma SC para validar
-- ganha o acesso à página Validação, mesmo fora da lista de validadores. Os gestores atuais com usuário já recebem.

CREATE OR REPLACE FUNCTION public.purchase_can_see(_r public.purchase_requests) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _r.requester_id = auth.uid() OR _r.approver_id = auth.uid() OR _r.decided_by = auth.uid()
    OR auth.uid() = ANY (_r.observer_ids)
    OR public.purchase_effective_approver(_r) = auth.uid()
    OR public.purchase_is_buyer() OR public.has_role(auth.uid(), 'admin')
$$;

CREATE OR REPLACE FUNCTION public.purchase_request_send(_id uuid) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r purchase_requests; cfg purchase_approvers; _items int; _missing int; _collab uuid; _appr uuid; _today date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  SELECT * INTO r FROM purchase_requests WHERE id = _id FOR UPDATE;
  IF r.id IS NULL OR r.requester_id <> auth.uid() THEN RAISE EXCEPTION 'Solicitação não encontrada'; END IF;
  IF r.stage <> 'rascunho' THEN RAISE EXCEPTION 'Esta solicitação já foi enviada'; END IF;
  SELECT count(*), count(*) FILTER (WHERE coalesce(budget, 0) <= 0) INTO _items, _missing FROM purchase_request_items WHERE request_id = _id;
  IF _items = 0 AND r.system <> 'TOTVS' THEN RAISE EXCEPTION 'Inclua ao menos um item'; END IF;
  IF r.system <> 'TOTVS' AND upper(coalesce(r.nature, '')) <> 'PROGRAMADA' AND coalesce(r.total_budget, 0) <= 0 AND _missing > 0 THEN
    RAISE EXCEPTION 'Informe a verba de cada item ou a verba total';
  END IF;
  SELECT * INTO cfg FROM purchase_approvers WHERE requester_id = r.requester_id;
  PERFORM set_config('purchase.rpc', '1', true);
  IF r.system = 'TOTVS' OR (cfg.requester_id IS NOT NULL AND NOT cfg.needs_approval) THEN
    UPDATE purchase_requests SET stage = 'compras', sent_at = now(), approved_at = now(), approver_id = NULL, approver_collab_id = NULL,
      substitute_id = NULL, decided_by = NULL, return_notes = NULL, returned_by = NULL,
      approver_notes = CASE WHEN r.system = 'TOTVS' THEN 'SC do TOTVS' ELSE 'Sem validação (solicitante liberado)' END,
      status = 'SOLICITAÇÃO ENVIADA', status_at = _today WHERE id = _id;
    RETURN 'compras';
  END IF;
  _collab := public.purchase_client_manager(r.client_id);
  IF _collab IS NULL THEN RAISE EXCEPTION 'O cliente desta SC não tem gestor cadastrado nos serviços (Clientes › Serviços)'; END IF;
  _appr := public.purchase_user_of_collaborator(_collab);
  IF _appr IS NULL THEN _appr := cfg.substitute_id; END IF;
  IF _appr IS NULL THEN
    RAISE EXCEPTION 'O gestor % não tem usuário no sistema; cadastre um substituto em Compras › Comprador › Validadores',
      (SELECT full_name FROM collaborators WHERE id = _collab);
  END IF;
  -- Gestor (ou substituto) que recebe a SC vira validador: ganha o acesso à página Validação.
  INSERT INTO user_page_access (user_id, path, allowed, updated_at) VALUES (_appr, '/compras/aprovacao', true, now())
  ON CONFLICT (user_id, path) DO UPDATE SET allowed = true, updated_at = now();
  UPDATE purchase_requests SET stage = 'aprovacao', sent_at = now(), approver_id = _appr, approver_collab_id = _collab,
    substitute_id = CASE WHEN cfg.substitute_id = _appr THEN NULL ELSE cfg.substitute_id END, decided_by = NULL, approver_notes = NULL,
    return_notes = NULL, returned_by = NULL, status = 'SOLICITAÇÃO ENVIADA', status_at = _today WHERE id = _id;
  RETURN 'aprovacao';
END $$;

INSERT INTO public.user_page_access (user_id, path, allowed, updated_at)
SELECT DISTINCT u, '/compras/aprovacao', true, now()
FROM (SELECT public.purchase_user_of_collaborator(manager_id) u FROM public.works WHERE manager_id IS NOT NULL AND active GROUP BY manager_id) g
WHERE u IS NOT NULL
ON CONFLICT (user_id, path) DO UPDATE SET allowed = true, updated_at = now();
