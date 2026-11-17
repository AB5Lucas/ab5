-- Compras: autorizante (antes "aprovador") só com um ajuste por solicitante (precisa de autorizante: sim/não);
-- observadores em cópia (Lucas Garcia e Marcelo Barrella sempre, sem como tirar); cotação/orçamento (foto ou PDF)
-- na verba; devolução pelo Comprador; SC do TOTVS só com número + foto, direto para o Comprador.
-- Serviços sem gestor recebem o gestor mais frequente do cliente (antigos e novos).

-- 1) Sem "aprova as próprias": quem aprovava as próprias passa a não precisar de autorizante.
UPDATE public.purchase_approvers SET needs_approval = false, self_approve = false WHERE self_approve;

-- 2) Colunas novas
ALTER TABLE public.purchase_requests
  ADD COLUMN IF NOT EXISTS observer_ids uuid[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS return_notes text,
  ADD COLUMN IF NOT EXISTS returned_by uuid,
  ADD COLUMN IF NOT EXISTS photo_path text,
  ADD COLUMN IF NOT EXISTS quote_path text;
ALTER TABLE public.purchase_requests ALTER COLUMN category DROP NOT NULL, ALTER COLUMN nature DROP NOT NULL,
  ALTER COLUMN priority DROP NOT NULL, ALTER COLUMN due_date DROP NOT NULL;
ALTER TABLE public.purchase_request_items ADD COLUMN IF NOT EXISTS quote_path text;
CREATE INDEX IF NOT EXISTS idx_purchase_requests_observers ON public.purchase_requests USING gin (observer_ids);

-- Observadores fixos: Lucas Garcia e Marcelo Barrella Martin.
CREATE OR REPLACE FUNCTION public.purchase_fixed_observers() RETURNS uuid[] LANGUAGE sql IMMUTABLE AS $$
  SELECT ARRAY['f3c94145-62f8-452f-a665-eb5e56cffd6a', 'cfd87887-421e-48f6-871c-a229e8634700']::uuid[]
$$;

CREATE OR REPLACE FUNCTION public.purchase_requests_observers() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.observer_ids := ARRAY(SELECT DISTINCT x FROM unnest(coalesce(NEW.observer_ids, '{}') || public.purchase_fixed_observers()) x
    WHERE x IS NOT NULL AND x <> NEW.requester_id);
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_purchase_requests_observers ON public.purchase_requests;
CREATE TRIGGER trg_purchase_requests_observers BEFORE INSERT OR UPDATE OF observer_ids, requester_id ON public.purchase_requests
  FOR EACH ROW EXECUTE FUNCTION public.purchase_requests_observers();
UPDATE public.purchase_requests SET observer_ids = observer_ids;

CREATE OR REPLACE FUNCTION public.purchase_can_see(_r public.purchase_requests) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _r.requester_id = auth.uid() OR _r.approver_id = auth.uid() OR _r.decided_by = auth.uid()
    OR auth.uid() = ANY (_r.observer_ids)
    OR public.purchase_effective_approver(_r) = auth.uid()
    OR (_r.stage = 'compras' AND public.purchase_is_buyer()) OR public.has_role(auth.uid(), 'admin')
$$;

CREATE OR REPLACE FUNCTION public.purchase_requests_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF coalesce(current_setting('purchase.rpc', true), '') = '1' THEN RETURN NEW; END IF;
  NEW.number := OLD.number; NEW.seq := OLD.seq; NEW.requester_id := OLD.requester_id; NEW.requester_name := OLD.requester_name;
  NEW.request_date := OLD.request_date; NEW.stage := OLD.stage; NEW.sent_at := OLD.sent_at; NEW.approver_id := OLD.approver_id;
  NEW.approved_at := OLD.approved_at; NEW.approver_notes := OLD.approver_notes; NEW.status := OLD.status;
  NEW.status_at := OLD.status_at; NEW.buyer_notes := OLD.buyer_notes; NEW.approver_collab_id := OLD.approver_collab_id;
  NEW.substitute_id := OLD.substitute_id; NEW.decided_by := OLD.decided_by; NEW.cancelled_at := OLD.cancelled_at;
  NEW.return_notes := OLD.return_notes; NEW.returned_by := OLD.returned_by; NEW.system := OLD.system;
  RETURN NEW;
END $$;

-- 3) Criar com observadores
CREATE OR REPLACE FUNCTION public.purchase_request_create(_p jsonb) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _name text; _key text; _n int; _id uuid;
BEGIN
  IF NOT public.is_active_user() THEN RAISE EXCEPTION 'Usuário sem acesso'; END IF;
  SELECT full_name INTO _name FROM users_profiles WHERE id = auth.uid();
  _key := public.purchase_requester_key(_name);
  IF _key = '' THEN RAISE EXCEPTION 'Cadastre seu nome no perfil antes de abrir uma SC'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('purchase_sc:' || _key));
  INSERT INTO purchase_sc_seq (requester_key, last_number) VALUES (_key, 0) ON CONFLICT (requester_key) DO NOTHING;
  UPDATE purchase_sc_seq SET last_number = greatest(last_number,
      coalesce((SELECT max(seq) FROM purchase_requests WHERE number LIKE 'SC-' || _key || '-%'), 0)) + 1
    WHERE requester_key = _key RETURNING last_number INTO _n;
  PERFORM set_config('purchase.rpc', '1', true);
  INSERT INTO purchase_requests (number, seq, requester_id, requester_name, system, category, nature, priority, client_id,
    due_date, delivery_kind, delivery_place, notes, observer_ids)
  VALUES ('SC-' || _key || '-' || lpad(_n::text, 3, '0'), _n, auth.uid(), _key, 'PLANILHA', _p->>'category', _p->>'nature',
    _p->>'priority', nullif(_p->>'client_id', '')::uuid, (_p->>'due_date')::date, coalesce(_p->>'delivery_kind', 'ab5'),
    nullif(_p->>'delivery_place', ''), nullif(_p->>'notes', ''),
    coalesce(ARRAY(SELECT jsonb_array_elements_text(coalesce(_p->'observer_ids', '[]'::jsonb))::uuid), '{}'))
  RETURNING id INTO _id;
  RETURN _id;
END $$;

-- 4) SC do TOTVS: número do TOTVS + foto; vai direto para o Comprador (a autorização é no próprio TOTVS).
CREATE OR REPLACE FUNCTION public.purchase_request_create_totvs(_number text, _photo text, _observers uuid[] DEFAULT '{}')
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _name text; _id uuid; _n text := upper(trim(coalesce(_number, '')));
BEGIN
  IF NOT public.is_active_user() THEN RAISE EXCEPTION 'Usuário sem acesso'; END IF;
  IF _n = '' THEN RAISE EXCEPTION 'Informe o número da SC do TOTVS'; END IF;
  IF coalesce(trim(_photo), '') = '' THEN RAISE EXCEPTION 'Anexe a foto da SC do TOTVS'; END IF;
  IF EXISTS (SELECT 1 FROM purchase_requests WHERE number = 'TOTVS-' || _n) THEN RAISE EXCEPTION 'A SC % do TOTVS já foi lançada', _n; END IF;
  SELECT full_name INTO _name FROM users_profiles WHERE id = auth.uid();
  PERFORM set_config('purchase.rpc', '1', true);
  INSERT INTO purchase_requests (number, seq, requester_id, requester_name, system, delivery_kind, photo_path, observer_ids,
    stage, sent_at, approved_at, approver_notes, status, status_at)
  VALUES ('TOTVS-' || _n, 0, auth.uid(), public.purchase_requester_key(_name), 'TOTVS', 'ab5', _photo, coalesce(_observers, '{}'),
    'compras', now(), now(), 'SC do TOTVS', 'SOLICITAÇÃO ENVIADA', (now() AT TIME ZONE 'America/Sao_Paulo')::date)
  RETURNING id INTO _id;
  RETURN _id;
END $$;

-- 5) Enviar: sem "aprova as próprias"; limpa a devolução.
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
      approver_notes = CASE WHEN r.system = 'TOTVS' THEN 'SC do TOTVS' ELSE 'Sem autorização (solicitante liberado)' END,
      status = 'SOLICITAÇÃO ENVIADA', status_at = _today WHERE id = _id;
    RETURN 'compras';
  END IF;
  _collab := public.purchase_client_manager(r.client_id);
  IF _collab IS NULL THEN RAISE EXCEPTION 'O cliente desta SC não tem gestor cadastrado nos serviços (Clientes › Serviços)'; END IF;
  _appr := public.purchase_user_of_collaborator(_collab);
  IF _appr IS NULL THEN _appr := cfg.substitute_id; END IF;
  IF _appr IS NULL THEN
    RAISE EXCEPTION 'O gestor % não tem usuário no sistema; cadastre um substituto em Compras › Comprador › Autorizantes',
      (SELECT full_name FROM collaborators WHERE id = _collab);
  END IF;
  UPDATE purchase_requests SET stage = 'aprovacao', sent_at = now(), approver_id = _appr, approver_collab_id = _collab,
    substitute_id = CASE WHEN cfg.substitute_id = _appr THEN NULL ELSE cfg.substitute_id END, decided_by = NULL, approver_notes = NULL,
    return_notes = NULL, returned_by = NULL, status = 'SOLICITAÇÃO ENVIADA', status_at = _today WHERE id = _id;
  RETURN 'aprovacao';
END $$;

-- 6) Autorizante devolve (motivo em return_notes também).
CREATE OR REPLACE FUNCTION public.purchase_request_decide(_id uuid, _approve boolean, _notes text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r purchase_requests;
BEGIN
  SELECT * INTO r FROM purchase_requests WHERE id = _id FOR UPDATE;
  IF r.id IS NULL OR NOT (public.purchase_effective_approver(r) = auth.uid() OR r.approver_id = auth.uid() OR public.has_role(auth.uid(), 'admin')) THEN
    RAISE EXCEPTION 'Você não é o autorizante desta solicitação';
  END IF;
  IF r.stage <> 'aprovacao' THEN RAISE EXCEPTION 'Esta solicitação não está aguardando autorização'; END IF;
  IF NOT _approve AND coalesce(trim(_notes), '') = '' THEN RAISE EXCEPTION 'Escreva o motivo da devolução'; END IF;
  PERFORM set_config('purchase.rpc', '1', true);
  IF _approve THEN
    UPDATE purchase_requests SET stage = 'compras', approved_at = now(), decided_by = auth.uid(), approver_notes = nullif(trim(_notes), '') WHERE id = _id;
  ELSE
    UPDATE purchase_requests SET stage = 'rascunho', sent_at = NULL, approved_at = NULL, decided_by = auth.uid(), approver_notes = trim(_notes),
      return_notes = 'Autorizante: ' || trim(_notes), returned_by = auth.uid(),
      status = 'EM PREPARAÇÃO', status_at = (now() AT TIME ZONE 'America/Sao_Paulo')::date WHERE id = _id;
  END IF;
END $$;

-- 7) Comprador devolve ao solicitante (SC já autorizada).
CREATE OR REPLACE FUNCTION public.purchase_request_return(_id uuid, _notes text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r purchase_requests;
BEGIN
  SELECT * INTO r FROM purchase_requests WHERE id = _id FOR UPDATE;
  IF r.id IS NULL OR NOT public.purchase_is_buyer() THEN RAISE EXCEPTION 'Sem acesso ao Comprador'; END IF;
  IF r.stage <> 'compras' THEN RAISE EXCEPTION 'Esta solicitação não está em Compras'; END IF;
  IF coalesce(trim(_notes), '') = '' THEN RAISE EXCEPTION 'Escreva o motivo da devolução'; END IF;
  PERFORM set_config('purchase.rpc', '1', true);
  UPDATE purchase_requests SET stage = 'rascunho', sent_at = NULL, approved_at = NULL, return_notes = 'Comprador: ' || trim(_notes),
    returned_by = auth.uid(), status = 'EM PREPARAÇÃO', status_at = (now() AT TIME ZONE 'America/Sao_Paulo')::date WHERE id = _id;
END $$;

REVOKE EXECUTE ON FUNCTION public.purchase_request_return(uuid, text), public.purchase_request_create_totvs(text, text, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.purchase_request_return(uuid, text), public.purchase_request_create_totvs(text, text, uuid[]) TO authenticated;

-- 8) Zerar a numeração da Vitória Brasilino (a SC em rascunho vira a 001).
UPDATE public.purchase_sc_seq SET last_number = 0 WHERE requester_key IN ('VITORIA BRASILINO', 'VITORIA DE');
DO $$
DECLARE _id uuid;
BEGIN
  SELECT id INTO _id FROM public.purchase_requests WHERE number LIKE 'SC-VITORIA BRASILINO-%' ORDER BY created_at LIMIT 1;
  IF _id IS NOT NULL AND (SELECT count(*) FROM public.purchase_requests WHERE number LIKE 'SC-VITORIA BRASILINO-%') = 1 THEN
    PERFORM set_config('purchase.rpc', '1', true);
    UPDATE public.purchase_requests SET number = 'SC-VITORIA BRASILINO-001', seq = 1 WHERE id = _id;
    UPDATE public.purchase_sc_seq SET last_number = 1 WHERE requester_key = 'VITORIA BRASILINO';
  END IF;
END $$;

-- 9) Serviço sem gestor: o gestor mais frequente nos serviços do cliente (novos e antigos).
CREATE OR REPLACE FUNCTION public.works_default_manager() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.manager_id IS NULL AND NEW.client_id IS NOT NULL THEN
    SELECT manager_id INTO NEW.manager_id FROM works WHERE client_id = NEW.client_id AND manager_id IS NOT NULL
    GROUP BY manager_id ORDER BY count(*) FILTER (WHERE active) DESC, count(*) DESC, manager_id LIMIT 1;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_works_default_manager ON public.works;
CREATE TRIGGER trg_works_default_manager BEFORE INSERT ON public.works FOR EACH ROW EXECUTE FUNCTION public.works_default_manager();

UPDATE public.works w SET manager_id = m.manager_id
FROM (SELECT DISTINCT ON (client_id) client_id, manager_id FROM public.works WHERE manager_id IS NOT NULL
      GROUP BY client_id, manager_id ORDER BY client_id, count(*) FILTER (WHERE active) DESC, count(*) DESC, manager_id) m
WHERE w.client_id = m.client_id AND w.manager_id IS NULL;
