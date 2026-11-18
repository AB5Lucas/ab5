-- Compras: "Autorizante/Autorização" passa a "Validador/Validação" (textos); o validador pode editar a SC (cabeçalho e
-- itens) enquanto ela está com ele; o Comprador escolhe a data do status (data em que a compra foi finalizada).

CREATE OR REPLACE FUNCTION public.purchase_can_edit(_r public.purchase_requests) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT (_r.requester_id = auth.uid() AND _r.stage = 'rascunho')
    OR (_r.stage = 'aprovacao' AND (_r.approver_id = auth.uid() OR public.purchase_effective_approver(_r) = auth.uid()))
$$;

DROP POLICY IF EXISTS purchase_requests_update ON public.purchase_requests;
CREATE POLICY purchase_requests_update ON public.purchase_requests FOR UPDATE TO authenticated
  USING (public.purchase_can_edit(purchase_requests)) WITH CHECK (public.purchase_can_edit(purchase_requests));
DROP POLICY IF EXISTS purchase_items_write ON public.purchase_request_items;
CREATE POLICY purchase_items_write ON public.purchase_request_items FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.purchase_requests r WHERE r.id = request_id AND public.purchase_can_edit(r)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.purchase_requests r WHERE r.id = request_id AND public.purchase_can_edit(r)));

DROP FUNCTION IF EXISTS public.purchase_request_set_status(uuid, text, text);
CREATE OR REPLACE FUNCTION public.purchase_request_set_status(_id uuid, _status text, _notes text, _date date DEFAULT NULL) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r purchase_requests;
BEGIN
  SELECT * INTO r FROM purchase_requests WHERE id = _id FOR UPDATE;
  IF r.id IS NULL OR NOT public.purchase_is_buyer() THEN RAISE EXCEPTION 'Sem acesso ao Comprador'; END IF;
  IF r.stage <> 'compras' THEN RAISE EXCEPTION 'Esta solicitação ainda não chegou em Compras'; END IF;
  PERFORM set_config('purchase.rpc', '1', true);
  UPDATE purchase_requests SET status = coalesce(nullif(_status, ''), status),
    status_at = coalesce(_date, CASE WHEN _status IS DISTINCT FROM r.status THEN (now() AT TIME ZONE 'America/Sao_Paulo')::date ELSE status_at END),
    buyer_notes = nullif(trim(coalesce(_notes, '')), '') WHERE id = _id;
END $$;
REVOKE EXECUTE ON FUNCTION public.purchase_request_set_status(uuid, text, text, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.purchase_request_set_status(uuid, text, text, date) TO authenticated;

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
  UPDATE purchase_requests SET stage = 'aprovacao', sent_at = now(), approver_id = _appr, approver_collab_id = _collab,
    substitute_id = CASE WHEN cfg.substitute_id = _appr THEN NULL ELSE cfg.substitute_id END, decided_by = NULL, approver_notes = NULL,
    return_notes = NULL, returned_by = NULL, status = 'SOLICITAÇÃO ENVIADA', status_at = _today WHERE id = _id;
  RETURN 'aprovacao';
END $$;

CREATE OR REPLACE FUNCTION public.purchase_request_decide(_id uuid, _approve boolean, _notes text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r purchase_requests;
BEGIN
  SELECT * INTO r FROM purchase_requests WHERE id = _id FOR UPDATE;
  IF r.id IS NULL OR NOT (public.purchase_effective_approver(r) = auth.uid() OR r.approver_id = auth.uid() OR public.has_role(auth.uid(), 'admin')) THEN
    RAISE EXCEPTION 'Você não é o validador desta solicitação';
  END IF;
  IF r.stage <> 'aprovacao' THEN RAISE EXCEPTION 'Esta solicitação não está aguardando validação'; END IF;
  IF NOT _approve AND coalesce(trim(_notes), '') = '' THEN RAISE EXCEPTION 'Escreva o motivo da devolução'; END IF;
  PERFORM set_config('purchase.rpc', '1', true);
  IF _approve THEN
    UPDATE purchase_requests SET stage = 'compras', approved_at = now(), decided_by = auth.uid(), approver_notes = nullif(trim(_notes), '') WHERE id = _id;
  ELSE
    UPDATE purchase_requests SET stage = 'rascunho', sent_at = NULL, approved_at = NULL, decided_by = auth.uid(), approver_notes = trim(_notes),
      return_notes = 'Validador: ' || trim(_notes), returned_by = auth.uid(),
      status = 'EM PREPARAÇÃO', status_at = (now() AT TIME ZONE 'America/Sao_Paulo')::date WHERE id = _id;
  END IF;
END $$;
