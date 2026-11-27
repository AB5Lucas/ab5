-- Aprovação dupla: itens só viram APROVADO na 2ª aprovação; a 1ª deixa APROVAÇÃO PENDENTE.
CREATE OR REPLACE FUNCTION public.purchase_fa_decide(_id uuid, _approve boolean, _notes text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE r purchase_requests; _rule text; _ack boolean; _who text; _b uuid; _k text; _side text; _partial boolean := false; _u uuid; _some_rej boolean;
BEGIN
  SELECT * INTO r FROM purchase_requests WHERE id = _id FOR UPDATE;
  IF r.id IS NULL THEN RAISE EXCEPTION 'SC não encontrada'; END IF;
  IF r.fa_state IS DISTINCT FROM 'em_aprovacao' THEN RAISE EXCEPTION 'Esta SC não está em aprovação'; END IF;
  _rule := public.purchase_fa_rule(r);
  IF NOT public.purchase_fa_can_decide(r) THEN
    RAISE EXCEPTION '%', CASE
      WHEN _rule = 'diretor' THEN 'Acima da verba (total ou algum item) e com prazo maior que 2 dias: só o nível Executivo aprova'
      WHEN _rule = 'dupla' AND r.fa_partial_side IS NOT NULL AND public.purchase_fa_side(r) = r.fa_partial_side
        THEN 'Aprovação dupla: falta a aprovação do ' || CASE r.fa_partial_side WHEN 'gestor' THEN 'nível Operacional' ELSE 'gestor da obra' END
      ELSE 'Você não é aprovador desta SC' END;
  END IF;
  IF _approve AND NOT EXISTS (SELECT 1 FROM purchase_request_items WHERE request_id = _id AND status IN ('APROVAÇÃO PENDENTE', 'APROVADO')) THEN
    RAISE EXCEPTION 'Todos os itens estão recusados: envie como recusa';
  END IF;
  IF NOT _approve AND coalesce(trim(_notes), '') = '' AND EXISTS (SELECT 1 FROM purchase_request_items WHERE request_id = _id
      AND status IN ('APROVAÇÃO PENDENTE', 'APROVADO', 'RECUSADO')
      AND (nullif(trim(coalesce(fa_item_reason, '')), '') IS NULL OR fa_item_reason = 'Recusado na decisão geral')) THEN
    RAISE EXCEPTION 'Escreva o motivo da recusa';
  END IF;
  _some_rej := EXISTS (SELECT 1 FROM purchase_request_items WHERE request_id = _id AND status = 'RECUSADO' AND fa_prev_status IS NOT NULL);
  _who := (SELECT nullif(trim(full_name), '') FROM users_profiles WHERE id = auth.uid());
  _side := public.purchase_fa_side(r);
  _k := 'sc:' || _id || ':fa_dec:' || extract(epoch FROM now())::bigint || ':';
  PERFORM set_config('purchase.rpc', '1', true);
  IF _approve AND _rule = 'dupla' AND NOT public.purchase_fa_is_exec(auth.uid()) AND r.fa_partial_side IS NULL THEN
    UPDATE purchase_requests SET fa_partial_by = auth.uid(), fa_partial_at = now(), fa_partial_side = _side,
      fa_decision_notes = nullif(trim(coalesce(_notes, '')), '') WHERE id = _id;
    -- Aprovação dupla: a 1ª aprovação não libera o item; fica APROVAÇÃO PENDENTE até o outro lado aprovar (recusados ficam).
    UPDATE purchase_request_items SET status = 'APROVAÇÃO PENDENTE', status_at = (now() AT TIME ZONE 'America/Sao_Paulo')::date
      WHERE request_id = _id AND status = 'APROVADO' AND fa_prev_status IS NOT NULL;
    FOR _u IN SELECT DISTINCT x FROM (
        SELECT public.purchase_client_gestor_users(r.client_id) x WHERE _side = 'comprador'
        UNION SELECT r.approver_id WHERE _side = 'comprador'
        UNION SELECT public.purchase_alcada_members('compartilhada') WHERE _side = 'gestor') s WHERE x IS NOT NULL LOOP
      PERFORM public.notify_user(_u, 'compras', 'sc_aprovacao_nova', 'Aprovação dupla: falta a sua aprovação',
        concat_ws(' · ', 'Aprovada' || coalesce(' por ' || _who, '') || ' (' || _side || ')', public.purchase_notif_desc(r)),
        '/compras/aprovacao-compra?sc=' || _id, r.number, 'purchase_request', _id, _k || 'partial:' || _u);
    END LOOP;
    RETURN;
  END IF;
  _ack := _approve AND NOT public.purchase_fa_is_exec(auth.uid());
  UPDATE purchase_requests SET fa_state = CASE WHEN _approve THEN 'aprovada' ELSE 'recusada' END, fa_rule = _rule,
    fa_decided_by = auth.uid(), fa_decided_at = now(),
    fa_decision_notes = nullif(concat_ws(' · ', CASE WHEN _approve THEN fa_decision_notes END, nullif(trim(coalesce(_notes, '')), '')), ''),
    fa_ack_needed = _ack, fa_ack_at = NULL,
    status = CASE WHEN _approve AND _some_rej THEN 'APROVADA PARCIALMENTE' WHEN _approve THEN 'APROVADA' ELSE 'COTAR' END, status_at = (now() AT TIME ZONE 'America/Sao_Paulo')::date WHERE id = _id;
  IF _approve THEN
    UPDATE purchase_request_items SET status = 'APROVADO', status_at = (now() AT TIME ZONE 'America/Sao_Paulo')::date,
      fa_item_by = coalesce(fa_item_by, auth.uid()), fa_item_at = coalesce(fa_item_at, now())
      WHERE request_id = _id AND status IN ('SOLICITAÇÃO ENVIADA', 'EM ANÁLISE', 'COTAR', 'COTANDO', 'APROVAÇÃO PENDENTE');
    UPDATE purchase_request_items SET fa_prev_status = NULL WHERE request_id = _id AND fa_prev_status IS NOT NULL;
  ELSE
    UPDATE purchase_request_items SET status = 'RECUSADO', status_at = (now() AT TIME ZONE 'America/Sao_Paulo')::date,
      fa_item_reason = CASE WHEN nullif(trim(coalesce(fa_item_reason, '')), '') IS NULL OR fa_item_reason = 'Recusado na decisão geral' THEN coalesce(nullif(trim(coalesce(_notes, '')), ''), 'Recusado na decisão geral') ELSE fa_item_reason END,
      fa_item_by = auth.uid(), fa_item_at = now()
      WHERE request_id = _id AND status IN ('APROVAÇÃO PENDENTE', 'APROVADO', 'RECUSADO');
  END IF;
  FOR _b IN SELECT DISTINCT x FROM (SELECT public.notif_buyer_ids() x UNION SELECT r.fa_sent_by) s WHERE x IS NOT NULL LOOP
    PERFORM public.notify_user(_b, 'compras', CASE WHEN _approve THEN 'sc_aprovada' ELSE 'sc_aprovacao_recusada' END,
      CASE WHEN _approve AND _some_rej THEN 'SC aprovada parcialmente: comprar só os itens aprovados' WHEN _approve THEN 'SC aprovada: pode comprar' ELSE 'SC recusada na aprovação' END,
      concat_ws(' · ', CASE WHEN _approve AND _some_rej THEN 'Aprovada parcialmente' WHEN _approve THEN 'Aprovada' ELSE 'Recusada' END || coalesce(' por ' || _who, ''), nullif(trim(coalesce(_notes, '')), '')),
      '/compras/solicitacoes/' || _id, r.number, 'purchase_request', _id, _k || _b);
  END LOOP;
  IF _ack THEN
    FOR _u IN SELECT DISTINCT x FROM public.purchase_fa_exec_for(r.client_id) x WHERE x IS NOT NULL LOOP
      PERFORM public.notify_user(_u, 'compras', 'sc_aprovacao_ciencia', 'Compra aprovada: dar ciência',
        concat_ws(' · ', CASE WHEN _rule = 'dupla' THEN 'Aprovação dupla (Operacional + Gestor da obra)' ELSE 'Aprovada pelo nível Operacional' END, public.purchase_notif_desc(r)),
        '/compras/aprovacao-compra?sc=' || _id, r.number, 'purchase_request', _id, _k || 'ack:' || _u);
    END LOOP;
  END IF;
END $function$;

-- SCs já com a 1ª aprovação: volta os itens aprovados para pendente.
SELECT set_config('purchase.rpc', '1', true);
UPDATE purchase_request_items i SET status = 'APROVAÇÃO PENDENTE'
  FROM purchase_requests r WHERE r.id = i.request_id AND r.fa_state = 'em_aprovacao' AND r.fa_partial_side IS NOT NULL
  AND i.status = 'APROVADO' AND i.fa_prev_status IS NOT NULL;
