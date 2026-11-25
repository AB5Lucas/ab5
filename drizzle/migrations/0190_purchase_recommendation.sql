-- Compras › Recomendação (subaba do Comprador) e Aprovação (aba nova).
-- Cotações anexadas pelo comprador (PDF, foto, Excel) são lidas pela IA para purchase_quotes/purchase_quote_items;
-- cada item da cotação é ligado a um item da SC (com fator/tipo de conversão, como a "Seleção de Pedidos de Compra"
-- do TOTVS) ou descartado. A melhor escolha é calculada na tela pelos critérios (valor, prazo de entrega,
-- condição de pagamento = maior prazo); o comprador pode trocar por item (rec_quote_item_id).
-- "Enviar ao Aprovador" grava o retrato (fa_snapshot) e põe a SC EM APROVAÇÃO (continua na etapa compras).
-- Regra: dentro da verba = Vitória ou Marcelo; acima e prazo ≤ 2 dias = aprovação dupla (Vitória, gestor ou
-- Marcelo; sem o Marcelo fica pendente a ciência dele); acima e prazo > 2 dias = só o Marcelo.
-- Aprovada → volta ao Comprador como APROVADA; recusada → volta ao Comprador (COTAR) com o motivo.

ALTER TABLE public.purchase_requests
  ADD COLUMN IF NOT EXISTS rec_criteria text[] NOT NULL DEFAULT '{valor}',
  ADD COLUMN IF NOT EXISTS fa_state text CHECK (fa_state IN ('em_aprovacao', 'aprovada', 'recusada')),
  ADD COLUMN IF NOT EXISTS fa_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS fa_sent_by uuid,
  ADD COLUMN IF NOT EXISTS fa_notes text,
  ADD COLUMN IF NOT EXISTS fa_total numeric,
  ADD COLUMN IF NOT EXISTS fa_budget numeric,
  ADD COLUMN IF NOT EXISTS fa_rule text,
  ADD COLUMN IF NOT EXISTS fa_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS fa_decided_by uuid,
  ADD COLUMN IF NOT EXISTS fa_decided_at timestamptz,
  ADD COLUMN IF NOT EXISTS fa_decision_notes text,
  ADD COLUMN IF NOT EXISTS fa_ack_needed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS fa_ack_at timestamptz;

CREATE TABLE IF NOT EXISTS public.purchase_quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.purchase_requests(id) ON DELETE CASCADE,
  file_path text NOT NULL,
  file_name text,
  source text NOT NULL DEFAULT 'comprador' CHECK (source IN ('comprador', 'solicitante')),
  supplier text,
  supplier_doc text,
  quote_number text,
  quote_date date,
  payment_terms text,
  payment_days integer,
  delivery_days integer,
  freight numeric,
  total numeric,
  read_status text NOT NULL DEFAULT 'pendente' CHECK (read_status IN ('pendente', 'lido', 'erro')),
  read_error text,
  matched boolean NOT NULL DEFAULT false,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (request_id, file_path)
);

CREATE TABLE IF NOT EXISTS public.purchase_quote_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id uuid NOT NULL REFERENCES public.purchase_quotes(id) ON DELETE CASCADE,
  line_no integer NOT NULL DEFAULT 1,
  description text NOT NULL,
  quantity numeric,
  unit text,
  unit_price numeric,
  total numeric,
  request_item_id uuid REFERENCES public.purchase_request_items(id) ON DELETE SET NULL,
  conv_factor numeric NOT NULL DEFAULT 1 CHECK (conv_factor > 0),
  conv_type text NOT NULL DEFAULT 'M' CHECK (conv_type IN ('M', 'D')),
  discarded boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS purchase_quote_items_quote_idx ON public.purchase_quote_items (quote_id);
CREATE INDEX IF NOT EXISTS purchase_quote_items_req_item_idx ON public.purchase_quote_items (request_item_id);

ALTER TABLE public.purchase_request_items
  ADD COLUMN IF NOT EXISTS rec_quote_item_id uuid REFERENCES public.purchase_quote_items(id) ON DELETE SET NULL;

ALTER TABLE public.purchase_quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_quote_items ENABLE ROW LEVEL SECURITY;

-- Lê quem vê a SC; grava só o comprador e só fora da aprovação.
CREATE OR REPLACE FUNCTION public.purchase_quote_can_write(_request uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT public.purchase_is_buyer() AND EXISTS (
    SELECT 1 FROM purchase_requests r WHERE r.id = _request AND r.stage = 'compras' AND r.fa_state IS DISTINCT FROM 'em_aprovacao')
$$;

DROP POLICY IF EXISTS purchase_quotes_select ON public.purchase_quotes;
CREATE POLICY purchase_quotes_select ON public.purchase_quotes FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM purchase_requests r WHERE r.id = request_id));
DROP POLICY IF EXISTS purchase_quotes_write ON public.purchase_quotes;
CREATE POLICY purchase_quotes_write ON public.purchase_quotes FOR ALL TO authenticated
  USING (public.purchase_quote_can_write(request_id)) WITH CHECK (public.purchase_quote_can_write(request_id));

DROP POLICY IF EXISTS purchase_quote_items_select ON public.purchase_quote_items;
CREATE POLICY purchase_quote_items_select ON public.purchase_quote_items FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM purchase_quotes q WHERE q.id = quote_id));
DROP POLICY IF EXISTS purchase_quote_items_write ON public.purchase_quote_items;
CREATE POLICY purchase_quote_items_write ON public.purchase_quote_items FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM purchase_quotes q WHERE q.id = quote_id AND public.purchase_quote_can_write(q.request_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM purchase_quotes q WHERE q.id = quote_id AND public.purchase_quote_can_write(q.request_id)));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.purchase_quotes, public.purchase_quote_items TO authenticated;

-- Guarda: os campos da aprovação só mudam pelas funções.
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
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.purchase_items_guard()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $function$
BEGIN
  IF coalesce(current_setting('purchase.rpc', true), '') = '1' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' THEN
    NEW.status := OLD.status; NEW.order_number := OLD.order_number; NEW.request_id := OLD.request_id; NEW.order_file_path := OLD.order_file_path;
    NEW.status_at := OLD.status_at; NEW.rec_quote_item_id := OLD.rec_quote_item_id;
  END IF;
  RETURN NEW;
END $function$;

-- Pessoas fixas da aprovação.
CREATE OR REPLACE FUNCTION public.purchase_fa_director() RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT 'cfd87887-421e-48f6-871c-a229e8634700'::uuid $$;
CREATE OR REPLACE FUNCTION public.purchase_fa_vitoria() RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT '01d11e92-6fa0-4a73-acd8-9561d98de54e'::uuid $$;

-- Verba da SC: a total, senão a soma dos itens (null = sem verba).
CREATE OR REPLACE FUNCTION public.purchase_fa_budget(_id uuid)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT coalesce(nullif(r.total_budget, 0), (SELECT nullif(sum(coalesce(i.budget, 0)), 0) FROM purchase_request_items i WHERE i.request_id = r.id))
  FROM purchase_requests r WHERE r.id = _id
$$;

-- Regra da aprovação: verba | dupla | diretor.
CREATE OR REPLACE FUNCTION public.purchase_fa_rule_of(_total numeric, _budget numeric, _due date)
RETURNS text LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN _budget IS NOT NULL AND coalesce(_total, 0) <= _budget THEN 'verba'
    WHEN _due IS NOT NULL AND _due - (now() AT TIME ZONE 'America/Sao_Paulo')::date <= 2 THEN 'dupla'
    ELSE 'diretor' END
$$;

-- Quem pode aprovar agora esta SC.
CREATE OR REPLACE FUNCTION public.purchase_fa_can_decide(_r purchase_requests)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT _r.fa_state = 'em_aprovacao' AND (
    auth.uid() = public.purchase_fa_director()
    OR (public.purchase_fa_rule_of(_r.fa_total, _r.fa_budget, _r.due_date) IN ('verba', 'dupla') AND auth.uid() = public.purchase_fa_vitoria())
    OR (public.purchase_fa_rule_of(_r.fa_total, _r.fa_budget, _r.due_date) = 'dupla'
        AND (auth.uid() = _r.approver_id OR auth.uid() = public.purchase_effective_approver(_r))))
$$;

CREATE OR REPLACE FUNCTION public.purchase_rec_set_criteria(_id uuid, _criteria text[])
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT public.purchase_quote_can_write(_id) THEN RAISE EXCEPTION 'Sem acesso à recomendação desta SC'; END IF;
  IF _criteria IS NULL OR cardinality(_criteria) = 0 OR NOT (_criteria <@ ARRAY['valor', 'prazo', 'pagamento']) THEN RAISE EXCEPTION 'Escolha ao menos um critério'; END IF;
  PERFORM set_config('purchase.rpc', '1', true);
  UPDATE purchase_requests SET rec_criteria = _criteria WHERE id = _id;
END $$;

-- Escolha manual do item da cotação para o item da SC (null = volta para a melhor pelos critérios).
CREATE OR REPLACE FUNCTION public.purchase_rec_choose(_item uuid, _quote_item uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _req uuid;
BEGIN
  SELECT request_id INTO _req FROM purchase_request_items WHERE id = _item;
  IF _req IS NULL OR NOT public.purchase_quote_can_write(_req) THEN RAISE EXCEPTION 'Sem acesso à recomendação desta SC'; END IF;
  IF _quote_item IS NOT NULL AND NOT EXISTS (SELECT 1 FROM purchase_quote_items qi JOIN purchase_quotes q ON q.id = qi.quote_id
      WHERE qi.id = _quote_item AND q.request_id = _req AND qi.request_item_id = _item AND NOT qi.discarded) THEN
    RAISE EXCEPTION 'Este item da cotação não está ligado a este item da SC';
  END IF;
  PERFORM set_config('purchase.rpc', '1', true);
  UPDATE purchase_request_items SET rec_quote_item_id = _quote_item WHERE id = _item;
END $$;

-- Enviar ao Aprovador: grava o retrato calculado na tela, a regra e põe EM APROVAÇÃO; avisa quem pode aprovar.
CREATE OR REPLACE FUNCTION public.purchase_fa_send(_id uuid, _notes text, _total numeric, _snapshot jsonb)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r purchase_requests; _budget numeric; _rule text; _gestor uuid; _u uuid; _desc text; _k text;
BEGIN
  SELECT * INTO r FROM purchase_requests WHERE id = _id FOR UPDATE;
  IF r.id IS NULL OR NOT public.purchase_is_buyer() THEN RAISE EXCEPTION 'Sem acesso ao Comprador'; END IF;
  IF r.stage <> 'compras' THEN RAISE EXCEPTION 'Esta solicitação não está em Compras'; END IF;
  IF r.fa_state = 'em_aprovacao' THEN RAISE EXCEPTION 'Esta SC já está em aprovação'; END IF;
  IF _snapshot IS NULL OR jsonb_array_length(coalesce(_snapshot -> 'items', '[]'::jsonb)) = 0 THEN RAISE EXCEPTION 'Nenhum item com cotação escolhida'; END IF;
  _budget := public.purchase_fa_budget(_id);
  _rule := public.purchase_fa_rule_of(_total, _budget, r.due_date);
  _gestor := public.purchase_effective_approver(r);
  PERFORM set_config('purchase.rpc', '1', true);
  UPDATE purchase_requests SET fa_state = 'em_aprovacao', fa_sent_at = now(), fa_sent_by = auth.uid(), fa_notes = nullif(trim(coalesce(_notes, '')), ''),
    fa_total = _total, fa_budget = _budget, fa_rule = _rule, fa_snapshot = _snapshot, fa_decided_by = NULL, fa_decided_at = NULL,
    fa_decision_notes = NULL, fa_ack_needed = false, fa_ack_at = NULL,
    status = 'EM APROVAÇÃO', status_at = (now() AT TIME ZONE 'America/Sao_Paulo')::date WHERE id = _id;
  -- O gestor da aprovação dupla ganha acesso à página Aprovação.
  IF _rule = 'dupla' AND _gestor IS NOT NULL THEN
    INSERT INTO user_page_access (user_id, path, allowed) VALUES (_gestor, '/compras/aprovacao-compra', true)
      ON CONFLICT (user_id, path) DO UPDATE SET allowed = true;
  END IF;
  _desc := concat_ws(' · ', public.purchase_notif_desc(r), 'Total ' || to_char(_total, 'FM999G999G990D00'),
    CASE _rule WHEN 'verba' THEN 'dentro da verba' WHEN 'dupla' THEN 'acima da verba, urgente (aprovação dupla)' ELSE 'acima da verba' END);
  _k := 'sc:' || _id || ':fa_new:' || extract(epoch FROM now())::bigint || ':';
  FOR _u IN SELECT DISTINCT x FROM unnest(ARRAY[public.purchase_fa_director(),
      CASE WHEN _rule IN ('verba', 'dupla') THEN public.purchase_fa_vitoria() END,
      CASE WHEN _rule = 'dupla' THEN _gestor END]) x WHERE x IS NOT NULL LOOP
    PERFORM public.notify_user(_u, 'compras', 'sc_aprovacao_nova', 'SC para aprovar', _desc, '/compras/aprovacao-compra?sc=' || _id, r.number,
      'purchase_request', _id, _k || _u);
  END LOOP;
  RETURN _rule;
END $$;

-- Comprador puxa de volta da aprovação (ainda não decidida).
CREATE OR REPLACE FUNCTION public.purchase_fa_recall(_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r purchase_requests;
BEGIN
  SELECT * INTO r FROM purchase_requests WHERE id = _id FOR UPDATE;
  IF r.id IS NULL OR NOT public.purchase_is_buyer() THEN RAISE EXCEPTION 'Sem acesso ao Comprador'; END IF;
  IF r.fa_state IS DISTINCT FROM 'em_aprovacao' THEN RAISE EXCEPTION 'Esta SC não está em aprovação'; END IF;
  PERFORM set_config('purchase.rpc', '1', true);
  UPDATE purchase_requests SET fa_state = NULL, status = 'COTAR', status_at = (now() AT TIME ZONE 'America/Sao_Paulo')::date WHERE id = _id;
END $$;

-- Aprovar ou recusar: volta ao Comprador (APROVADA, ou COTAR com o motivo). Dupla sem o Marcelo fica pendente a ciência dele.
CREATE OR REPLACE FUNCTION public.purchase_fa_decide(_id uuid, _approve boolean, _notes text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r purchase_requests; _rule text; _ack boolean; _who text; _b uuid; _k text;
BEGIN
  SELECT * INTO r FROM purchase_requests WHERE id = _id FOR UPDATE;
  IF r.id IS NULL THEN RAISE EXCEPTION 'SC não encontrada'; END IF;
  IF r.fa_state IS DISTINCT FROM 'em_aprovacao' THEN RAISE EXCEPTION 'Esta SC não está em aprovação'; END IF;
  IF NOT public.purchase_fa_can_decide(r) THEN
    RAISE EXCEPTION '%', CASE public.purchase_fa_rule_of(r.fa_total, r.fa_budget, r.due_date)
      WHEN 'diretor' THEN 'Acima da verba e com prazo maior que 2 dias: só o Marcelo Barrella aprova'
      ELSE 'Você não é aprovador desta SC' END;
  END IF;
  IF NOT _approve AND coalesce(trim(_notes), '') = '' THEN RAISE EXCEPTION 'Escreva o motivo da recusa'; END IF;
  _rule := public.purchase_fa_rule_of(r.fa_total, r.fa_budget, r.due_date);
  _ack := _approve AND _rule = 'dupla' AND auth.uid() <> public.purchase_fa_director();
  _who := (SELECT nullif(trim(full_name), '') FROM users_profiles WHERE id = auth.uid());
  PERFORM set_config('purchase.rpc', '1', true);
  UPDATE purchase_requests SET fa_state = CASE WHEN _approve THEN 'aprovada' ELSE 'recusada' END, fa_rule = _rule,
    fa_decided_by = auth.uid(), fa_decided_at = now(), fa_decision_notes = nullif(trim(coalesce(_notes, '')), ''),
    fa_ack_needed = _ack, fa_ack_at = NULL,
    status = CASE WHEN _approve THEN 'APROVADA' ELSE 'COTAR' END, status_at = (now() AT TIME ZONE 'America/Sao_Paulo')::date WHERE id = _id;
  IF _approve THEN
    UPDATE purchase_request_items SET status = 'APROVADO', status_at = (now() AT TIME ZONE 'America/Sao_Paulo')::date
      WHERE request_id = _id AND status IN ('SOLICITAÇÃO ENVIADA', 'EM ANÁLISE', 'COTAR', 'COTANDO', 'APROVAÇÃO PENDENTE');
  END IF;
  _k := 'sc:' || _id || ':fa_dec:' || extract(epoch FROM now())::bigint || ':';
  FOR _b IN SELECT DISTINCT x FROM (SELECT public.notif_buyer_ids() x UNION SELECT r.fa_sent_by) s WHERE x IS NOT NULL LOOP
    PERFORM public.notify_user(_b, 'compras', CASE WHEN _approve THEN 'sc_aprovada' ELSE 'sc_aprovacao_recusada' END,
      CASE WHEN _approve THEN 'SC aprovada: pode comprar' ELSE 'SC recusada na aprovação' END,
      concat_ws(' · ', CASE WHEN _approve THEN 'Aprovada' ELSE 'Recusada' END || coalesce(' por ' || _who, ''), nullif(trim(coalesce(_notes, '')), '')),
      '/compras/comprador#recomendacao', r.number, 'purchase_request', _id, _k || _b);
  END LOOP;
  IF _ack THEN
    PERFORM public.notify_user(public.purchase_fa_director(), 'compras', 'sc_aprovacao_ciencia', 'Aprovação dupla: dar ciência',
      concat_ws(' · ', 'Aprovada' || coalesce(' por ' || _who, '') || ' acima da verba (urgente)', public.purchase_notif_desc(r)),
      '/compras/aprovacao-compra?sc=' || _id, r.number, 'purchase_request', _id, _k || 'ack');
  END IF;
END $$;

-- Ciência do Marcelo na aprovação dupla.
CREATE OR REPLACE FUNCTION public.purchase_fa_ack(_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF auth.uid() <> public.purchase_fa_director() THEN RAISE EXCEPTION 'Só o Marcelo Barrella dá ciência'; END IF;
  PERFORM set_config('purchase.rpc', '1', true);
  UPDATE purchase_requests SET fa_ack_needed = false, fa_ack_at = now() WHERE id = _id AND fa_ack_needed;
END $$;

GRANT EXECUTE ON FUNCTION public.purchase_rec_set_criteria(uuid, text[]), public.purchase_rec_choose(uuid, uuid),
  public.purchase_fa_send(uuid, text, numeric, jsonb), public.purchase_fa_recall(uuid), public.purchase_fa_decide(uuid, boolean, text),
  public.purchase_fa_ack(uuid), public.purchase_fa_can_decide(purchase_requests), public.purchase_fa_budget(uuid) TO authenticated;

-- Página Aprovação: fechada por perfil (menos admin); liberada para Marcelo, Vitória e quem compra; gestor ganha no envio.
INSERT INTO role_page_access (role, path, allowed)
SELECT x::app_role, '/compras/aprovacao-compra', false FROM unnest(ARRAY['programmer', 'coordenador', 'encarregado', 'viewer', 'cliente']) x
ON CONFLICT DO NOTHING;
INSERT INTO user_page_access (user_id, path, allowed)
SELECT u, '/compras/aprovacao-compra', true FROM unnest(ARRAY[public.purchase_fa_director(), public.purchase_fa_vitoria()]) u
ON CONFLICT (user_id, path) DO UPDATE SET allowed = true;
INSERT INTO access_group_pages (group_id, path, allowed)
SELECT group_id, '/compras/aprovacao-compra', allowed FROM access_group_pages WHERE path = '/compras/comprador'
ON CONFLICT DO NOTHING;
INSERT INTO user_page_access (user_id, path, allowed)
SELECT user_id, '/compras/aprovacao-compra', allowed FROM user_page_access WHERE path = '/compras/comprador'
ON CONFLICT (user_id, path) DO NOTHING;
