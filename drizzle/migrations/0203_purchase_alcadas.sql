-- Alçadas de aprovação de compras (aba Alçadas do Aprovador): quem compra, quem aprova em cada nível.
-- Comprador = acesso à tela do Comprador (sincroniza user_page_access); Executiva Indústria / Serviços Externos =
-- aprovam tudo e dão ciência; Operacional = dentro da verba ou PROGRAMADA; Compartilhada = lado Operacional da
-- aprovação dupla (com o Gestor da obra). Só admin (Lucas, Marcelo) e a Vitória alteram.
CREATE TABLE IF NOT EXISTS public.purchase_alcadas (
  user_id uuid NOT NULL REFERENCES public.users_profiles(id) ON DELETE CASCADE,
  alcada text NOT NULL CHECK (alcada IN ('comprador', 'exec_industria', 'exec_servicos', 'operacional', 'compartilhada')),
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, alcada)
);
ALTER TABLE public.purchase_alcadas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS purchase_alcadas_select ON public.purchase_alcadas;
CREATE POLICY purchase_alcadas_select ON public.purchase_alcadas FOR SELECT TO authenticated USING (true);

CREATE OR REPLACE FUNCTION public.purchase_alcada_editor()
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$ SELECT auth.uid() IS NOT NULL AND (public.has_role(auth.uid(), 'admin') OR auth.uid() = public.purchase_fa_vitoria()) $function$;

CREATE OR REPLACE FUNCTION public.purchase_alcada_members(_a text)
 RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$ SELECT a.user_id FROM purchase_alcadas a JOIN users_profiles up ON up.id = a.user_id AND up.active WHERE a.alcada = _a $function$;

CREATE OR REPLACE FUNCTION public.purchase_alcada_has(_uid uuid, _a text)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$ SELECT _uid IS NOT NULL AND EXISTS (SELECT 1 FROM purchase_alcadas WHERE user_id = _uid AND alcada = _a) $function$;

CREATE OR REPLACE FUNCTION public.purchase_fa_is_exec(_uid uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$ SELECT _uid IS NOT NULL AND EXISTS (SELECT 1 FROM purchase_alcadas WHERE user_id = _uid AND alcada IN ('exec_industria', 'exec_servicos')) $function$;

-- Executivos para avisar: Indústria → Executiva Indústria; demais clientes → Serviços Externos; bloco vazio = todos os executivos.
CREATE OR REPLACE FUNCTION public.purchase_fa_exec_for(_client uuid)
 RETURNS SETOF uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _ind boolean; _a text;
BEGIN
  _ind := EXISTS (SELECT 1 FROM clients WHERE id = _client AND translate(upper(trim(name)), 'ÚÍ', 'UI') = 'INDUSTRIA');
  _a := CASE WHEN _ind THEN 'exec_industria' ELSE 'exec_servicos' END;
  IF EXISTS (SELECT 1 FROM public.purchase_alcada_members(_a)) THEN RETURN QUERY SELECT public.purchase_alcada_members(_a); RETURN; END IF;
  RETURN QUERY SELECT DISTINCT x FROM (SELECT public.purchase_alcada_members('exec_industria') x UNION SELECT public.purchase_alcada_members('exec_servicos')) s;
END $function$;

CREATE OR REPLACE FUNCTION public.purchase_alcada_set(_user uuid, _alcada text, _on boolean)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.purchase_alcada_editor() THEN RAISE EXCEPTION 'Só a Diretoria e a Vitória alteram as alçadas'; END IF;
  IF _alcada NOT IN ('comprador', 'exec_industria', 'exec_servicos', 'operacional', 'compartilhada') THEN RAISE EXCEPTION 'Alçada inválida'; END IF;
  IF _on THEN
    INSERT INTO purchase_alcadas (user_id, alcada) VALUES (_user, _alcada) ON CONFLICT DO NOTHING;
  ELSE
    DELETE FROM purchase_alcadas WHERE user_id = _user AND alcada = _alcada;
  END IF;
  -- Comprador = acesso à tela do Comprador; quem entra num bloco de aprovação ganha acesso ao Aprovador.
  IF _alcada = 'comprador' THEN
    INSERT INTO user_page_access (user_id, path, allowed) VALUES (_user, '/compras/comprador', _on)
      ON CONFLICT (user_id, path) DO UPDATE SET allowed = EXCLUDED.allowed;
  ELSIF _on THEN
    INSERT INTO user_page_access (user_id, path, allowed) VALUES (_user, '/compras/aprovacao-compra', true)
      ON CONFLICT (user_id, path) DO UPDATE SET allowed = true;
  END IF;
END $function$;
GRANT EXECUTE ON FUNCTION public.purchase_alcada_set(uuid, text, boolean) TO authenticated;

-- Carga inicial: compradores de hoje; Marcelo nas duas executivas; Vitória no Operacional e na Compartilhada.
INSERT INTO purchase_alcadas (user_id, alcada) SELECT x, 'comprador' FROM public.notif_buyer_ids() x ON CONFLICT DO NOTHING;
INSERT INTO purchase_alcadas (user_id, alcada) VALUES
  (public.purchase_fa_director(), 'exec_industria'), (public.purchase_fa_director(), 'exec_servicos'),
  (public.purchase_fa_vitoria(), 'operacional'), (public.purchase_fa_vitoria(), 'compartilhada')
  ON CONFLICT DO NOTHING;

-- Compra programada (natureza PROGRAMADA) também é do nível Operacional.
CREATE OR REPLACE FUNCTION public.purchase_fa_rule(_r purchase_requests)
 RETURNS text LANGUAGE sql STABLE
AS $function$ SELECT CASE WHEN upper(coalesce(_r.nature, '')) = 'PROGRAMADA' THEN 'verba'
  ELSE public.purchase_fa_rule_of(_r.fa_total, _r.fa_budget, _r.due_date, _r.fa_over_items) END $function$;

-- Lado na aprovação dupla: gestor da obra, ou nível Operacional (bloco Compartilhada; valor interno 'comprador').
CREATE OR REPLACE FUNCTION public.purchase_fa_side(_r purchase_requests)
 RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT CASE WHEN public.purchase_fa_is_gestor(_r) THEN 'gestor'
    WHEN public.purchase_alcada_has(auth.uid(), 'compartilhada') THEN 'comprador' END
$function$;

CREATE OR REPLACE FUNCTION public.purchase_fa_can_decide(_r purchase_requests)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT _r.fa_state = 'em_aprovacao' AND (
    public.purchase_fa_is_exec(auth.uid())
    OR (public.purchase_fa_rule(_r) = 'verba' AND public.purchase_alcada_has(auth.uid(), 'operacional'))
    OR (public.purchase_fa_rule(_r) = 'dupla'
        AND public.purchase_fa_side(_r) IS NOT NULL AND public.purchase_fa_side(_r) IS DISTINCT FROM _r.fa_partial_side))
$function$;

CREATE OR REPLACE FUNCTION public.purchase_fa_ack(_id uuid)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.purchase_fa_is_exec(auth.uid()) THEN RAISE EXCEPTION 'Só o nível Executivo dá ciência'; END IF;
  PERFORM set_config('purchase.rpc', '1', true);
  UPDATE purchase_requests SET fa_ack_needed = false, fa_ack_at = now() WHERE id = _id AND fa_ack_needed;
END $function$;

-- O que a pessoa pode fazer no Aprovador (a tela usa isto em vez de repetir as regras).
CREATE OR REPLACE FUNCTION public.purchase_fa_my_perms()
 RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    'exec', public.purchase_fa_is_exec(auth.uid()),
    'oper', public.purchase_alcada_has(auth.uid(), 'operacional'),
    'shared', public.purchase_alcada_has(auth.uid(), 'compartilhada'),
    'editor', public.purchase_alcada_editor(),
    'decide', coalesce((SELECT jsonb_agg(r.id) FROM purchase_requests r WHERE r.fa_state = 'em_aprovacao' AND public.purchase_fa_can_decide(r)), '[]'::jsonb))
$function$;
GRANT EXECUTE ON FUNCTION public.purchase_fa_my_perms() TO authenticated;

CREATE OR REPLACE FUNCTION public.purchase_fa_send(_id uuid, _notes text, _total numeric, _snapshot jsonb)
 RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE r purchase_requests; _over boolean; _budget numeric; _rule text; _u uuid; _desc text; _k text;
BEGIN
  SELECT * INTO r FROM purchase_requests WHERE id = _id FOR UPDATE;
  IF r.id IS NULL OR NOT public.purchase_is_buyer() THEN RAISE EXCEPTION 'Sem acesso ao Comprador'; END IF;
  IF r.stage <> 'compras' THEN RAISE EXCEPTION 'Esta solicitação não está em Compras'; END IF;
  IF r.fa_state = 'em_aprovacao' THEN RAISE EXCEPTION 'Esta SC já está em aprovação'; END IF;
  IF _snapshot IS NULL OR jsonb_array_length(coalesce(_snapshot -> 'items', '[]'::jsonb)) = 0 THEN RAISE EXCEPTION 'Nenhum item com cotação escolhida'; END IF;
  _budget := public.purchase_fa_budget(_id);
  _over := public.purchase_fa_items_over(_id, _snapshot);
  _rule := CASE WHEN upper(coalesce(r.nature, '')) = 'PROGRAMADA' THEN 'verba' ELSE public.purchase_fa_rule_of(_total, _budget, r.due_date, _over) END;
  PERFORM set_config('purchase.rpc', '1', true);
  UPDATE purchase_requests SET fa_state = 'em_aprovacao', fa_sent_at = now(), fa_sent_by = auth.uid(), fa_notes = nullif(trim(coalesce(_notes, '')), ''),
    fa_total = _total, fa_budget = _budget, fa_rule = _rule, fa_over_items = _over, fa_snapshot = _snapshot, fa_decided_by = NULL, fa_decided_at = NULL,
    fa_decision_notes = NULL, fa_ack_needed = false, fa_ack_at = NULL, fa_partial_by = NULL, fa_partial_at = NULL, fa_partial_side = NULL,
    status = 'EM APROVAÇÃO', status_at = (now() AT TIME ZONE 'America/Sao_Paulo')::date WHERE id = _id;
  UPDATE purchase_request_items SET fa_prev_status = coalesce(fa_prev_status, status), status = 'APROVAÇÃO PENDENTE',
    status_at = (now() AT TIME ZONE 'America/Sao_Paulo')::date, fa_item_reason = NULL, fa_item_by = NULL, fa_item_at = NULL
    WHERE request_id = _id AND status NOT IN ('COMPRADO', 'ALMOXARIFADO', 'CANCELADO')
      AND id IN (SELECT (x ->> 'item_id')::uuid FROM jsonb_array_elements(_snapshot -> 'items') x);
  INSERT INTO user_page_access (user_id, path, allowed)
    SELECT g, '/compras/aprovacao-compra', true FROM public.purchase_client_gestor_users(r.client_id) g
    ON CONFLICT (user_id, path) DO UPDATE SET allowed = true;
  _desc := concat_ws(' · ', public.purchase_notif_desc(r), 'Total ' || to_char(_total, 'FM999G999G990D00'),
    CASE _rule WHEN 'verba' THEN 'dentro da verba ou programada (nível Operacional)' WHEN 'dupla' THEN 'acima da verba, urgente (aprovação dupla: Operacional + Gestor da obra)' ELSE 'acima da verba (nível Executivo)' END);
  _k := 'sc:' || _id || ':fa_new:' || extract(epoch FROM now())::bigint || ':';
  FOR _u IN SELECT DISTINCT x FROM (
      SELECT public.purchase_fa_exec_for(r.client_id) x
      UNION SELECT public.purchase_alcada_members('operacional') WHERE _rule = 'verba'
      UNION SELECT public.purchase_alcada_members('compartilhada') WHERE _rule = 'dupla'
      UNION SELECT public.purchase_client_gestor_users(r.client_id) WHERE _rule = 'dupla'
      UNION SELECT public.purchase_effective_approver(r) WHERE _rule = 'dupla') s WHERE x IS NOT NULL LOOP
    PERFORM public.notify_user(_u, 'compras', 'sc_aprovacao_nova', 'SC para aprovar', _desc, '/compras/aprovacao-compra?sc=' || _id, r.number,
      'purchase_request', _id, _k || _u);
  END LOOP;
  RETURN _rule;
END $function$;

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
