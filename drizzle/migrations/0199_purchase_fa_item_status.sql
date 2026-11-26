-- Aprovação de compras item a item: ao enviar ao aprovador os itens escolhidos ficam APROVAÇÃO PENDENTE;
-- o aprovador marca cada um Aprovado ou Recusado (recusa com motivo). Recusa geral ou "Puxar da aprovação"
-- devolvem os itens ao status de antes do envio.
ALTER TABLE purchase_request_items
  ADD COLUMN IF NOT EXISTS fa_prev_status text,
  ADD COLUMN IF NOT EXISTS fa_item_reason text,
  ADD COLUMN IF NOT EXISTS fa_item_by uuid,
  ADD COLUMN IF NOT EXISTS fa_item_at timestamptz;

CREATE OR REPLACE FUNCTION public.purchase_fa_restore_items(_id uuid)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM set_config('purchase.rpc', '1', true);
  UPDATE purchase_request_items SET status = fa_prev_status, fa_prev_status = NULL
    WHERE request_id = _id AND fa_prev_status IS NOT NULL AND status IN ('APROVAÇÃO PENDENTE', 'APROVADO', 'RECUSADO');
  UPDATE purchase_request_items SET fa_prev_status = NULL WHERE request_id = _id AND fa_prev_status IS NOT NULL;
END $function$;
REVOKE ALL ON FUNCTION public.purchase_fa_restore_items(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.purchase_fa_item_decide(_item uuid, _status text, _reason text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE it purchase_request_items; r purchase_requests;
BEGIN
  SELECT * INTO it FROM purchase_request_items WHERE id = _item;
  IF it.id IS NULL THEN RAISE EXCEPTION 'Item não encontrado'; END IF;
  SELECT * INTO r FROM purchase_requests WHERE id = it.request_id FOR UPDATE;
  IF r.fa_state IS DISTINCT FROM 'em_aprovacao' THEN RAISE EXCEPTION 'Esta SC não está em aprovação'; END IF;
  IF NOT public.purchase_fa_can_decide(r) THEN RAISE EXCEPTION 'Você não é aprovador desta SC'; END IF;
  IF _status NOT IN ('APROVADO', 'RECUSADO', 'APROVAÇÃO PENDENTE') THEN RAISE EXCEPTION 'Status inválido'; END IF;
  IF it.status NOT IN ('APROVAÇÃO PENDENTE', 'APROVADO', 'RECUSADO') THEN RAISE EXCEPTION 'Este item não está em aprovação'; END IF;
  IF _status = 'RECUSADO' AND coalesce(trim(_reason), '') = '' THEN RAISE EXCEPTION 'Escreva o motivo da recusa do item'; END IF;
  PERFORM set_config('purchase.rpc', '1', true);
  UPDATE purchase_request_items SET status = _status, status_at = (now() AT TIME ZONE 'America/Sao_Paulo')::date,
    fa_prev_status = coalesce(fa_prev_status, it.status),
    fa_item_reason = CASE WHEN _status = 'RECUSADO' THEN trim(_reason) END,
    fa_item_by = CASE WHEN _status = 'APROVAÇÃO PENDENTE' THEN NULL ELSE auth.uid() END,
    fa_item_at = CASE WHEN _status = 'APROVAÇÃO PENDENTE' THEN NULL ELSE now() END
    WHERE id = _item;
END $function$;
GRANT EXECUTE ON FUNCTION public.purchase_fa_item_decide(uuid, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.purchase_fa_send(_id uuid, _notes text, _total numeric, _snapshot jsonb)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE r purchase_requests; _budget numeric; _rule text; _u uuid; _desc text; _k text;
BEGIN
  SELECT * INTO r FROM purchase_requests WHERE id = _id FOR UPDATE;
  IF r.id IS NULL OR NOT public.purchase_is_buyer() THEN RAISE EXCEPTION 'Sem acesso ao Comprador'; END IF;
  IF r.stage <> 'compras' THEN RAISE EXCEPTION 'Esta solicitação não está em Compras'; END IF;
  IF r.fa_state = 'em_aprovacao' THEN RAISE EXCEPTION 'Esta SC já está em aprovação'; END IF;
  IF _snapshot IS NULL OR jsonb_array_length(coalesce(_snapshot -> 'items', '[]'::jsonb)) = 0 THEN RAISE EXCEPTION 'Nenhum item com cotação escolhida'; END IF;
  _budget := public.purchase_fa_budget(_id);
  _rule := public.purchase_fa_rule_of(_total, _budget, r.due_date);
  PERFORM set_config('purchase.rpc', '1', true);
  UPDATE purchase_requests SET fa_state = 'em_aprovacao', fa_sent_at = now(), fa_sent_by = auth.uid(), fa_notes = nullif(trim(coalesce(_notes, '')), ''),
    fa_total = _total, fa_budget = _budget, fa_rule = _rule, fa_snapshot = _snapshot, fa_decided_by = NULL, fa_decided_at = NULL,
    fa_decision_notes = NULL, fa_ack_needed = false, fa_ack_at = NULL, fa_partial_by = NULL, fa_partial_at = NULL, fa_partial_side = NULL,
    status = 'EM APROVAÇÃO', status_at = (now() AT TIME ZONE 'America/Sao_Paulo')::date WHERE id = _id;
  -- Itens que vão para a aprovação: APROVAÇÃO PENDENTE (guarda o status de antes para a recusa/puxar de volta).
  UPDATE purchase_request_items SET fa_prev_status = coalesce(fa_prev_status, status), status = 'APROVAÇÃO PENDENTE',
    status_at = (now() AT TIME ZONE 'America/Sao_Paulo')::date, fa_item_reason = NULL, fa_item_by = NULL, fa_item_at = NULL
    WHERE request_id = _id AND status NOT IN ('COMPRADO', 'ALMOXARIFADO', 'CANCELADO')
      AND id IN (SELECT (x ->> 'item_id')::uuid FROM jsonb_array_elements(_snapshot -> 'items') x);
  INSERT INTO user_page_access (user_id, path, allowed)
    SELECT g, '/compras/aprovacao-compra', true FROM public.purchase_client_gestor_users(r.client_id) g
    ON CONFLICT (user_id, path) DO UPDATE SET allowed = true;
  _desc := concat_ws(' · ', public.purchase_notif_desc(r), 'Total ' || to_char(_total, 'FM999G999G990D00'),
    CASE _rule WHEN 'verba' THEN 'dentro da verba' WHEN 'dupla' THEN 'acima da verba, urgente (aprovação dupla: comprador + gestor)' ELSE 'acima da verba' END);
  _k := 'sc:' || _id || ':fa_new:' || extract(epoch FROM now())::bigint || ':';
  FOR _u IN SELECT DISTINCT x FROM (
      SELECT public.purchase_fa_director() x
      UNION SELECT public.purchase_fa_vitoria() WHERE _rule IN ('verba', 'dupla')
      UNION SELECT public.purchase_client_gestor_users(r.client_id) WHERE _rule = 'dupla'
      UNION SELECT public.purchase_effective_approver(r) WHERE _rule = 'dupla') s WHERE x IS NOT NULL LOOP
    PERFORM public.notify_user(_u, 'compras', 'sc_aprovacao_nova', 'SC para aprovar', _desc, '/compras/aprovacao-compra?sc=' || _id, r.number,
      'purchase_request', _id, _k || _u);
  END LOOP;
  RETURN _rule;
END $function$;

CREATE OR REPLACE FUNCTION public.purchase_fa_recall(_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE r purchase_requests;
BEGIN
  SELECT * INTO r FROM purchase_requests WHERE id = _id FOR UPDATE;
  IF r.id IS NULL OR NOT public.purchase_is_buyer() THEN RAISE EXCEPTION 'Sem acesso ao Comprador'; END IF;
  IF r.fa_state IS DISTINCT FROM 'em_aprovacao' THEN RAISE EXCEPTION 'Esta SC não está em aprovação'; END IF;
  PERFORM set_config('purchase.rpc', '1', true);
  UPDATE purchase_requests SET fa_state = NULL, status = 'COTAR', status_at = (now() AT TIME ZONE 'America/Sao_Paulo')::date WHERE id = _id;
  PERFORM public.purchase_fa_restore_items(_id);
END $function$;

CREATE OR REPLACE FUNCTION public.purchase_fa_decide(_id uuid, _approve boolean, _notes text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE r purchase_requests; _rule text; _ack boolean; _who text; _b uuid; _k text; _side text; _partial boolean := false; _u uuid;
BEGIN
  SELECT * INTO r FROM purchase_requests WHERE id = _id FOR UPDATE;
  IF r.id IS NULL THEN RAISE EXCEPTION 'SC não encontrada'; END IF;
  IF r.fa_state IS DISTINCT FROM 'em_aprovacao' THEN RAISE EXCEPTION 'Esta SC não está em aprovação'; END IF;
  _rule := public.purchase_fa_rule_of(r.fa_total, r.fa_budget, r.due_date);
  IF NOT public.purchase_fa_can_decide(r) THEN
    RAISE EXCEPTION '%', CASE
      WHEN _rule = 'diretor' THEN 'Acima da verba e com prazo maior que 2 dias: só o Marcelo Barrella aprova'
      WHEN _rule = 'dupla' AND r.fa_partial_side IS NOT NULL AND public.purchase_fa_side(r) = r.fa_partial_side
        THEN 'Aprovação dupla: falta a aprovação do ' || CASE r.fa_partial_side WHEN 'gestor' THEN 'comprador' ELSE 'gestor' END
      ELSE 'Você não é aprovador desta SC' END;
  END IF;
  IF NOT _approve AND coalesce(trim(_notes), '') = '' THEN RAISE EXCEPTION 'Escreva o motivo da recusa'; END IF;
  _who := (SELECT nullif(trim(full_name), '') FROM users_profiles WHERE id = auth.uid());
  _side := public.purchase_fa_side(r);
  _k := 'sc:' || _id || ':fa_dec:' || extract(epoch FROM now())::bigint || ':';
  PERFORM set_config('purchase.rpc', '1', true);
  IF _approve AND _rule = 'dupla' AND auth.uid() <> public.purchase_fa_director() AND r.fa_partial_side IS NULL THEN
    UPDATE purchase_requests SET fa_partial_by = auth.uid(), fa_partial_at = now(), fa_partial_side = _side,
      fa_decision_notes = nullif(trim(coalesce(_notes, '')), '') WHERE id = _id;
    FOR _u IN SELECT DISTINCT x FROM (
        SELECT public.purchase_client_gestor_users(r.client_id) x WHERE _side = 'comprador'
        UNION SELECT r.approver_id WHERE _side = 'comprador'
        UNION SELECT public.notif_buyer_ids() WHERE _side = 'gestor'
        UNION SELECT public.purchase_fa_vitoria() WHERE _side = 'gestor') s WHERE x IS NOT NULL LOOP
      PERFORM public.notify_user(_u, 'compras', 'sc_aprovacao_nova', 'Aprovação dupla: falta a sua aprovação',
        concat_ws(' · ', 'Aprovada' || coalesce(' por ' || _who, '') || ' (' || _side || ')', public.purchase_notif_desc(r)),
        '/compras/aprovacao-compra?sc=' || _id, r.number, 'purchase_request', _id, _k || 'partial:' || _u);
    END LOOP;
    RETURN;
  END IF;
  _ack := _approve AND _rule = 'dupla' AND auth.uid() <> public.purchase_fa_director();
  UPDATE purchase_requests SET fa_state = CASE WHEN _approve THEN 'aprovada' ELSE 'recusada' END, fa_rule = _rule,
    fa_decided_by = auth.uid(), fa_decided_at = now(),
    fa_decision_notes = nullif(concat_ws(' · ', CASE WHEN _approve THEN fa_decision_notes END, nullif(trim(coalesce(_notes, '')), '')), ''),
    fa_ack_needed = _ack, fa_ack_at = NULL,
    status = CASE WHEN _approve THEN 'APROVADA' ELSE 'COTAR' END, status_at = (now() AT TIME ZONE 'America/Sao_Paulo')::date WHERE id = _id;
  IF _approve THEN
    -- Itens ainda pendentes viram APROVADO; os recusados item a item continuam RECUSADO.
    UPDATE purchase_request_items SET status = 'APROVADO', status_at = (now() AT TIME ZONE 'America/Sao_Paulo')::date,
      fa_item_by = coalesce(fa_item_by, auth.uid()), fa_item_at = coalesce(fa_item_at, now())
      WHERE request_id = _id AND status IN ('SOLICITAÇÃO ENVIADA', 'EM ANÁLISE', 'COTAR', 'COTANDO', 'APROVAÇÃO PENDENTE');
    UPDATE purchase_request_items SET fa_prev_status = NULL WHERE request_id = _id AND fa_prev_status IS NOT NULL;
  ELSE
    PERFORM public.purchase_fa_restore_items(_id);
  END IF;
  FOR _b IN SELECT DISTINCT x FROM (SELECT public.notif_buyer_ids() x UNION SELECT r.fa_sent_by) s WHERE x IS NOT NULL LOOP
    PERFORM public.notify_user(_b, 'compras', CASE WHEN _approve THEN 'sc_aprovada' ELSE 'sc_aprovacao_recusada' END,
      CASE WHEN _approve THEN 'SC aprovada: pode comprar' ELSE 'SC recusada na aprovação' END,
      concat_ws(' · ', CASE WHEN _approve THEN 'Aprovada' ELSE 'Recusada' END || coalesce(' por ' || _who, ''), nullif(trim(coalesce(_notes, '')), '')),
      '/compras/solicitacoes/' || _id, r.number, 'purchase_request', _id, _k || _b);
  END LOOP;
  IF _ack THEN
    PERFORM public.notify_user(public.purchase_fa_director(), 'compras', 'sc_aprovacao_ciencia', 'Aprovação dupla: dar ciência',
      concat_ws(' · ', 'Aprovada pelo comprador e pelo gestor acima da verba (urgente)', public.purchase_notif_desc(r)),
      '/compras/aprovacao-compra?sc=' || _id, r.number, 'purchase_request', _id, _k || 'ack');
  END IF;
END $function$;

-- SCs já em aprovação: itens escolhidos passam a APROVAÇÃO PENDENTE.
DO $$
BEGIN
  PERFORM set_config('purchase.rpc', '1', true);
  UPDATE purchase_request_items i SET fa_prev_status = i.status, status = 'APROVAÇÃO PENDENTE'
    FROM purchase_requests r
    WHERE r.id = i.request_id AND r.fa_state = 'em_aprovacao' AND i.status NOT IN ('COMPRADO', 'ALMOXARIFADO', 'CANCELADO', 'RECUSADO', 'APROVADO', 'APROVAÇÃO PENDENTE')
      AND i.id IN (SELECT (x ->> 'item_id')::uuid FROM jsonb_array_elements(r.fa_snapshot -> 'items') x);
END $$;
