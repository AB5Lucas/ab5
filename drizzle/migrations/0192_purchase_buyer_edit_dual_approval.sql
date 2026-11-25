-- Compras, revisão da Recomendação/Aprovação (25/11):
-- 1) Comprador edita Categoria/Natureza/Prioridade/Prazo do cabeçalho na SC em Compras (purchase_request_buyer_edit);
--    cada troca fica em purchase_request_edits (histórico no reloginho).
-- 2) Aprovação dupla (acima da verba, prazo ≤ 2 dias) = Comprador + Gestor: a 1ª aprovação fica parcial
--    (fa_partial_*), a do outro lado conclui (e fica a ciência do Marcelo); o Marcelo aprova sozinho; recusa de qualquer
--    um encerra. Gestor = usuário do gestor/substituto do cliente (cadastro) ou o validador da SC.
-- 3) Cotação por link (purchase_quotes.kind = 'link', file_path = URL); links do item (solicitante/validador) entram.
-- 4) Gestores dos clientes ganham acesso à página Aprovação (agora e quando o cadastro do cliente muda).

ALTER TABLE public.purchase_requests
  ADD COLUMN IF NOT EXISTS fa_partial_by uuid,
  ADD COLUMN IF NOT EXISTS fa_partial_at timestamptz,
  ADD COLUMN IF NOT EXISTS fa_partial_side text CHECK (fa_partial_side IN ('comprador', 'gestor'));
ALTER TABLE public.purchase_quotes ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'file' CHECK (kind IN ('file', 'link'));

CREATE TABLE IF NOT EXISTS public.purchase_request_edits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.purchase_requests(id) ON DELETE CASCADE,
  field text NOT NULL,
  old_value text,
  new_value text,
  edited_by uuid DEFAULT auth.uid(),
  edited_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS purchase_request_edits_req_idx ON public.purchase_request_edits (request_id, edited_at DESC);
ALTER TABLE public.purchase_request_edits ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS purchase_request_edits_select ON public.purchase_request_edits;
CREATE POLICY purchase_request_edits_select ON public.purchase_request_edits FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM purchase_requests r WHERE r.id = request_id));
GRANT SELECT ON public.purchase_request_edits TO authenticated;

-- Guarda: campos novos só pelas funções.
CREATE OR REPLACE FUNCTION public.purchase_requests_guard()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $function$
BEGIN
  IF coalesce(current_setting('purchase.rpc', true), '') = '1' THEN RETURN NEW; END IF;
  NEW.number := OLD.number; NEW.seq := OLD.seq; NEW.requester_id := OLD.requester_id; NEW.requester_name := OLD.requester_name;
  NEW.request_date := OLD.request_date; NEW.stage := OLD.stage; NEW.sent_at := OLD.sent_at; NEW.approver_id := OLD.approver_id;
  NEW.approved_at := OLD.approved_at; NEW.approver_notes := OLD.approver_notes; NEW.status := OLD.status;
  NEW.status_at := OLD.status_at; NEW.buyer_notes := OLD.buyer_notes; NEW.approver_collab_id := OLD.approver_collab_id;
  NEW.substitute_id := OLD.substitute_id; NEW.decided_by := OLD.decided_by; NEW.cancelled_at := OLD.cancelled_at;
  NEW.return_notes := OLD.return_notes; NEW.returned_by := OLD.returned_by; NEW.system := OLD.system;
  NEW.validator_open_by := OLD.validator_open_by; NEW.validator_open_at := OLD.validator_open_at;
  NEW.rec_criteria := OLD.rec_criteria; NEW.fa_state := OLD.fa_state; NEW.fa_sent_at := OLD.fa_sent_at; NEW.fa_sent_by := OLD.fa_sent_by;
  NEW.fa_notes := OLD.fa_notes; NEW.fa_total := OLD.fa_total; NEW.fa_budget := OLD.fa_budget; NEW.fa_rule := OLD.fa_rule;
  NEW.fa_snapshot := OLD.fa_snapshot; NEW.fa_decided_by := OLD.fa_decided_by; NEW.fa_decided_at := OLD.fa_decided_at;
  NEW.fa_decision_notes := OLD.fa_decision_notes; NEW.fa_ack_needed := OLD.fa_ack_needed; NEW.fa_ack_at := OLD.fa_ack_at;
  NEW.fa_partial_by := OLD.fa_partial_by; NEW.fa_partial_at := OLD.fa_partial_at; NEW.fa_partial_side := OLD.fa_partial_side;
  RETURN NEW;
END $function$;

-- Usuários gestores do cliente (gestor e substituto do cadastro).
CREATE OR REPLACE FUNCTION public.purchase_client_gestor_users(_client uuid)
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT u FROM clients c, LATERAL unnest(ARRAY[public.purchase_user_of_collaborator(c.manager_id), public.purchase_user_of_collaborator(c.substitute_manager_id)]) u
  WHERE c.id = _client AND u IS NOT NULL
$$;

CREATE OR REPLACE FUNCTION public.purchase_fa_is_gestor(_r purchase_requests)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT auth.uid() IS NOT NULL AND (auth.uid() = _r.approver_id OR auth.uid() = public.purchase_effective_approver(_r)
    OR auth.uid() IN (SELECT public.purchase_client_gestor_users(_r.client_id)))
$$;

-- Lado de quem está aprovando: comprador (grupo Compras/Vitória) ou gestor.
CREATE OR REPLACE FUNCTION public.purchase_fa_side(_r purchase_requests)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT CASE WHEN public.purchase_fa_is_gestor(_r) THEN 'gestor'
    WHEN auth.uid() = public.purchase_fa_vitoria() OR public.purchase_is_buyer() THEN 'comprador' END
$$;

CREATE OR REPLACE FUNCTION public.purchase_fa_can_decide(_r purchase_requests)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT _r.fa_state = 'em_aprovacao' AND (
    auth.uid() = public.purchase_fa_director()
    OR (public.purchase_fa_rule_of(_r.fa_total, _r.fa_budget, _r.due_date) = 'verba' AND auth.uid() = public.purchase_fa_vitoria())
    OR (public.purchase_fa_rule_of(_r.fa_total, _r.fa_budget, _r.due_date) = 'dupla'
        AND public.purchase_fa_side(_r) IS NOT NULL AND public.purchase_fa_side(_r) IS DISTINCT FROM _r.fa_partial_side))
$$;

CREATE OR REPLACE FUNCTION public.purchase_fa_decide(_id uuid, _approve boolean, _notes text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
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
  -- Dupla: 1ª aprovação (comprador ou gestor) fica parcial; falta a do outro lado.
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
    UPDATE purchase_request_items SET status = 'APROVADO', status_at = (now() AT TIME ZONE 'America/Sao_Paulo')::date
      WHERE request_id = _id AND status IN ('SOLICITAÇÃO ENVIADA', 'EM ANÁLISE', 'COTAR', 'COTANDO', 'APROVAÇÃO PENDENTE');
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
END $$;

-- Envio: limpa a aprovação parcial; gestores do cliente recebem acesso e aviso na dupla.
CREATE OR REPLACE FUNCTION public.purchase_fa_send(_id uuid, _notes text, _total numeric, _snapshot jsonb)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
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
END $$;

-- SCs em aprovação/decididas em que sou gestor (para a lista da página Aprovação).
CREATE OR REPLACE FUNCTION public.purchase_fa_my_gestor_ids()
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT r.id FROM purchase_requests r WHERE r.fa_state IS NOT NULL AND public.purchase_fa_is_gestor(r)
$$;

-- Comprador edita campos do cabeçalho (com histórico).
CREATE OR REPLACE FUNCTION public.purchase_request_buyer_edit(_id uuid, _field text, _value text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r purchase_requests; _old text; _v text := nullif(trim(coalesce(_value, '')), '');
BEGIN
  SELECT * INTO r FROM purchase_requests WHERE id = _id FOR UPDATE;
  IF r.id IS NULL OR NOT public.purchase_is_buyer() THEN RAISE EXCEPTION 'Sem acesso ao Comprador'; END IF;
  IF r.stage <> 'compras' THEN RAISE EXCEPTION 'Esta solicitação não está em Compras'; END IF;
  IF r.fa_state = 'em_aprovacao' THEN RAISE EXCEPTION 'Esta SC está em aprovação: puxe de volta para editar'; END IF;
  IF _field NOT IN ('category', 'nature', 'priority', 'due_date') THEN RAISE EXCEPTION 'Campo não editável: %', _field; END IF;
  _old := CASE _field WHEN 'category' THEN r.category WHEN 'nature' THEN r.nature WHEN 'priority' THEN r.priority ELSE r.due_date::text END;
  IF _old IS NOT DISTINCT FROM _v THEN RETURN; END IF;
  PERFORM set_config('purchase.rpc', '1', true);
  IF _field = 'category' THEN UPDATE purchase_requests SET category = _v WHERE id = _id;
  ELSIF _field = 'nature' THEN UPDATE purchase_requests SET nature = _v WHERE id = _id;
  ELSIF _field = 'priority' THEN UPDATE purchase_requests SET priority = _v WHERE id = _id;
  ELSE UPDATE purchase_requests SET due_date = _v::date WHERE id = _id; END IF;
  INSERT INTO purchase_request_edits (request_id, field, old_value, new_value) VALUES (_id, _field, _old, _v);
END $$;

GRANT EXECUTE ON FUNCTION public.purchase_request_buyer_edit(uuid, text, text), public.purchase_fa_my_gestor_ids(),
  public.purchase_fa_is_gestor(purchase_requests), public.purchase_fa_side(purchase_requests) TO authenticated;

-- Acesso à Aprovação para os gestores dos clientes (agora e ao mudar o cadastro do cliente).
INSERT INTO user_page_access (user_id, path, allowed)
SELECT DISTINCT g, '/compras/aprovacao-compra', true FROM clients c, LATERAL public.purchase_client_gestor_users(c.id) g
ON CONFLICT (user_id, path) DO UPDATE SET allowed = true;

CREATE OR REPLACE FUNCTION public.trg_clients_gestor_approval_access()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  INSERT INTO user_page_access (user_id, path, allowed)
  SELECT g, '/compras/aprovacao-compra', true FROM public.purchase_client_gestor_users(NEW.id) g
  ON CONFLICT (user_id, path) DO UPDATE SET allowed = true;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_clients_gestor_approval_access ON public.clients;
CREATE TRIGGER trg_clients_gestor_approval_access AFTER INSERT OR UPDATE OF manager_id, substitute_manager_id ON public.clients
  FOR EACH ROW EXECUTE FUNCTION public.trg_clients_gestor_approval_access();

-- Gestor do cliente vê a SC que chegou à aprovação.
CREATE OR REPLACE FUNCTION public.purchase_can_see(_r purchase_requests)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT _r.requester_id = auth.uid() OR _r.approver_id = auth.uid() OR _r.decided_by = auth.uid()
    OR auth.uid() = ANY (_r.observer_ids)
    OR public.purchase_effective_approver(_r) = auth.uid()
    OR public.purchase_is_buyer() OR public.has_role(auth.uid(), 'admin')
    OR (_r.fa_state IS NOT NULL AND auth.uid() IN (SELECT public.purchase_client_gestor_users(_r.client_id)))
$function$;
