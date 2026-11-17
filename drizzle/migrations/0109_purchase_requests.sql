-- Compras › Solicitações de compra (SC): o solicitante cria e envia; passa pelo aprovador ligado a ele e depois vai
-- para o Comprador, que atualiza o status (com a data) e os itens. Modelo: planilha CONTROLE DE SOLICITAÇÕES e
-- FR-CPS-SC-(requisitante)-XXX.xlsm.

-- Aprovador de cada solicitante (aba Aprovadores).
CREATE TABLE IF NOT EXISTS public.purchase_approvers (
  requester_id uuid PRIMARY KEY REFERENCES public.users_profiles(id) ON DELETE CASCADE,
  approver_id uuid NOT NULL REFERENCES public.users_profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (requester_id <> approver_id)
);

-- Último número de SC por nome (SC-LUCAS GARCIA-001); começa pelo que já existia na planilha (aba 1ª SC).
CREATE TABLE IF NOT EXISTS public.purchase_sc_seq (
  requester_key text PRIMARY KEY,
  last_number int NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS public.purchase_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number text NOT NULL UNIQUE,
  seq int NOT NULL,
  requester_id uuid NOT NULL DEFAULT auth.uid(),
  requester_name text NOT NULL,
  request_date date NOT NULL DEFAULT ((now() AT TIME ZONE 'America/Sao_Paulo')::date),
  system text NOT NULL CHECK (system IN ('PLANILHA', 'TOTVS')),
  category text NOT NULL,
  nature text NOT NULL,
  priority text NOT NULL,
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  due_date date NOT NULL,
  delivery_kind text NOT NULL DEFAULT 'ab5' CHECK (delivery_kind IN ('ab5', 'cliente', 'outro')),
  delivery_place text,
  notes text,
  total_budget numeric CHECK (total_budget IS NULL OR total_budget >= 0),
  stage text NOT NULL DEFAULT 'rascunho' CHECK (stage IN ('rascunho', 'aprovacao', 'compras')),
  sent_at timestamptz,
  approver_id uuid,
  approved_at timestamptz,
  approver_notes text,
  status text NOT NULL DEFAULT 'EM PREPARAÇÃO',
  status_at date NOT NULL DEFAULT ((now() AT TIME ZONE 'America/Sao_Paulo')::date),
  buyer_notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_purchase_requests_requester ON public.purchase_requests (requester_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_purchase_requests_stage ON public.purchase_requests (stage);

CREATE TABLE IF NOT EXISTS public.purchase_request_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.purchase_requests(id) ON DELETE CASCADE,
  item_no int NOT NULL,
  quantity numeric NOT NULL CHECK (quantity > 0),
  unit text NOT NULL,
  description text NOT NULL,
  budget numeric CHECK (budget IS NULL OR budget >= 0),
  notes text,
  work_id uuid REFERENCES public.works(id) ON DELETE SET NULL, -- nulo = rateio geral do cliente
  photo_path text,
  status text NOT NULL DEFAULT 'SOLICITAÇÃO ENVIADA',
  order_number text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_purchase_request_items_req ON public.purchase_request_items (request_id, item_no);

-- Quem pode o quê
CREATE OR REPLACE FUNCTION public.purchase_is_buyer() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_active_user() AND public.can_access_page('/compras/comprador')
$$;
CREATE OR REPLACE FUNCTION public.purchase_is_approver_of(_requester uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.purchase_approvers a WHERE a.requester_id = _requester AND a.approver_id = auth.uid())
$$;
CREATE OR REPLACE FUNCTION public.purchase_can_see(_r public.purchase_requests) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _r.requester_id = auth.uid() OR public.purchase_is_approver_of(_r.requester_id)
    OR (_r.stage = 'compras' AND public.purchase_is_buyer()) OR public.has_role(auth.uid(), 'admin')
$$;

-- Campos de fluxo só mudam pelas funções abaixo (que ligam purchase.rpc).
CREATE OR REPLACE FUNCTION public.purchase_requests_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF coalesce(current_setting('purchase.rpc', true), '') = '1' THEN RETURN NEW; END IF;
  NEW.number := OLD.number; NEW.seq := OLD.seq; NEW.requester_id := OLD.requester_id; NEW.requester_name := OLD.requester_name;
  NEW.request_date := OLD.request_date; NEW.stage := OLD.stage; NEW.sent_at := OLD.sent_at; NEW.approver_id := OLD.approver_id;
  NEW.approved_at := OLD.approved_at; NEW.approver_notes := OLD.approver_notes; NEW.status := OLD.status;
  NEW.status_at := OLD.status_at; NEW.buyer_notes := OLD.buyer_notes;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_purchase_requests_guard ON public.purchase_requests;
CREATE TRIGGER trg_purchase_requests_guard BEFORE UPDATE ON public.purchase_requests FOR EACH ROW EXECUTE FUNCTION public.purchase_requests_guard();

CREATE OR REPLACE FUNCTION public.purchase_items_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF coalesce(current_setting('purchase.rpc', true), '') = '1' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' THEN NEW.status := OLD.status; NEW.order_number := OLD.order_number; NEW.request_id := OLD.request_id; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_purchase_items_guard ON public.purchase_request_items;
CREATE TRIGGER trg_purchase_items_guard BEFORE UPDATE ON public.purchase_request_items FOR EACH ROW EXECUTE FUNCTION public.purchase_items_guard();

ALTER TABLE public.purchase_approvers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_sc_seq ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_request_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS purchase_approvers_select ON public.purchase_approvers;
CREATE POLICY purchase_approvers_select ON public.purchase_approvers FOR SELECT TO authenticated USING ((SELECT public.is_active_user()));
DROP POLICY IF EXISTS purchase_approvers_write ON public.purchase_approvers;
CREATE POLICY purchase_approvers_write ON public.purchase_approvers FOR ALL TO authenticated
  USING ((SELECT public.can_access_page('/compras/aprovadores'))) WITH CHECK ((SELECT public.can_access_page('/compras/aprovadores')));

DROP POLICY IF EXISTS purchase_requests_select ON public.purchase_requests;
CREATE POLICY purchase_requests_select ON public.purchase_requests FOR SELECT TO authenticated USING (public.purchase_can_see(purchase_requests));
DROP POLICY IF EXISTS purchase_requests_update ON public.purchase_requests;
CREATE POLICY purchase_requests_update ON public.purchase_requests FOR UPDATE TO authenticated
  USING (requester_id = auth.uid() AND stage = 'rascunho') WITH CHECK (requester_id = auth.uid());
DROP POLICY IF EXISTS purchase_requests_delete ON public.purchase_requests;
CREATE POLICY purchase_requests_delete ON public.purchase_requests FOR DELETE TO authenticated
  USING (requester_id = auth.uid() AND stage = 'rascunho' AND sent_at IS NULL);

DROP POLICY IF EXISTS purchase_items_select ON public.purchase_request_items;
CREATE POLICY purchase_items_select ON public.purchase_request_items FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.purchase_requests r WHERE r.id = request_id));
DROP POLICY IF EXISTS purchase_items_write ON public.purchase_request_items;
CREATE POLICY purchase_items_write ON public.purchase_request_items FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.purchase_requests r WHERE r.id = request_id AND r.requester_id = auth.uid() AND r.stage = 'rascunho'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.purchase_requests r WHERE r.id = request_id AND r.requester_id = auth.uid() AND r.stage = 'rascunho'));

GRANT SELECT, UPDATE, DELETE ON public.purchase_requests TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.purchase_request_items, public.purchase_approvers TO authenticated;

-- Nome no número: dois primeiros nomes do usuário, em maiúsculas e sem acento (SC-LUCAS GARCIA-001).
CREATE OR REPLACE FUNCTION public.purchase_requester_key(_name text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT array_to_string((regexp_split_to_array(trim(translate(upper(coalesce(_name, '')),
    'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ', 'AAAAAEEEEIIIIOOOOOUUUUC')), '\s+'))[1:2], ' ')
$$;

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
    due_date, delivery_kind, delivery_place, notes)
  VALUES ('SC-' || _key || '-' || lpad(_n::text, 3, '0'), _n, auth.uid(), _key, _p->>'system', _p->>'category', _p->>'nature',
    _p->>'priority', nullif(_p->>'client_id', '')::uuid, (_p->>'due_date')::date, coalesce(_p->>'delivery_kind', 'ab5'),
    nullif(_p->>'delivery_place', ''), nullif(_p->>'notes', ''))
  RETURNING id INTO _id;
  RETURN _id;
END $$;

CREATE OR REPLACE FUNCTION public.purchase_request_send(_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r purchase_requests; _appr uuid; _items int; _missing int;
BEGIN
  SELECT * INTO r FROM purchase_requests WHERE id = _id FOR UPDATE;
  IF r.id IS NULL OR r.requester_id <> auth.uid() THEN RAISE EXCEPTION 'Solicitação não encontrada'; END IF;
  IF r.stage <> 'rascunho' THEN RAISE EXCEPTION 'Esta solicitação já foi enviada'; END IF;
  SELECT count(*), count(*) FILTER (WHERE coalesce(budget, 0) <= 0) INTO _items, _missing FROM purchase_request_items WHERE request_id = _id;
  IF _items = 0 THEN RAISE EXCEPTION 'Inclua ao menos um item'; END IF;
  IF upper(r.nature) <> 'PROGRAMADA' AND coalesce(r.total_budget, 0) <= 0 AND _missing > 0 THEN
    RAISE EXCEPTION 'Informe a verba de cada item ou a verba total';
  END IF;
  SELECT approver_id INTO _appr FROM purchase_approvers WHERE requester_id = r.requester_id;
  IF _appr IS NULL THEN RAISE EXCEPTION 'Você ainda não tem aprovador cadastrado (Compras › Aprovadores)'; END IF;
  PERFORM set_config('purchase.rpc', '1', true);
  UPDATE purchase_requests SET stage = 'aprovacao', sent_at = now(), approver_id = _appr, approver_notes = NULL,
    status = 'SOLICITAÇÃO ENVIADA', status_at = (now() AT TIME ZONE 'America/Sao_Paulo')::date WHERE id = _id;
END $$;

-- Aprovador: aprova (vai para Compras) ou devolve ao solicitante com o motivo.
CREATE OR REPLACE FUNCTION public.purchase_request_decide(_id uuid, _approve boolean, _notes text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r purchase_requests;
BEGIN
  SELECT * INTO r FROM purchase_requests WHERE id = _id FOR UPDATE;
  IF r.id IS NULL OR NOT (public.purchase_is_approver_of(r.requester_id) OR public.has_role(auth.uid(), 'admin')) THEN
    RAISE EXCEPTION 'Você não é o aprovador desta solicitação';
  END IF;
  IF r.stage <> 'aprovacao' THEN RAISE EXCEPTION 'Esta solicitação não está aguardando aprovação'; END IF;
  IF NOT _approve AND coalesce(trim(_notes), '') = '' THEN RAISE EXCEPTION 'Escreva o motivo da devolução'; END IF;
  PERFORM set_config('purchase.rpc', '1', true);
  IF _approve THEN
    UPDATE purchase_requests SET stage = 'compras', approved_at = now(), approver_id = auth.uid(), approver_notes = nullif(trim(_notes), '') WHERE id = _id;
  ELSE
    UPDATE purchase_requests SET stage = 'rascunho', sent_at = NULL, approved_at = NULL, approver_notes = trim(_notes),
      status = 'EM PREPARAÇÃO', status_at = (now() AT TIME ZONE 'America/Sao_Paulo')::date WHERE id = _id;
  END IF;
END $$;

-- Comprador: status da SC (a data do status é a do dia) e observação.
CREATE OR REPLACE FUNCTION public.purchase_request_set_status(_id uuid, _status text, _notes text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r purchase_requests;
BEGIN
  SELECT * INTO r FROM purchase_requests WHERE id = _id FOR UPDATE;
  IF r.id IS NULL OR NOT public.purchase_is_buyer() THEN RAISE EXCEPTION 'Sem acesso ao Comprador'; END IF;
  IF r.stage <> 'compras' THEN RAISE EXCEPTION 'Esta solicitação ainda não chegou em Compras'; END IF;
  PERFORM set_config('purchase.rpc', '1', true);
  UPDATE purchase_requests SET status = coalesce(nullif(_status, ''), status),
    status_at = CASE WHEN _status IS DISTINCT FROM r.status THEN (now() AT TIME ZONE 'America/Sao_Paulo')::date ELSE status_at END,
    buyer_notes = nullif(trim(coalesce(_notes, '')), '') WHERE id = _id;
END $$;

CREATE OR REPLACE FUNCTION public.purchase_item_set(_item uuid, _status text, _order text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.purchase_is_buyer() THEN RAISE EXCEPTION 'Sem acesso ao Comprador'; END IF;
  IF NOT EXISTS (SELECT 1 FROM purchase_request_items i JOIN purchase_requests r ON r.id = i.request_id WHERE i.id = _item AND r.stage = 'compras') THEN
    RAISE EXCEPTION 'Item não está em Compras';
  END IF;
  PERFORM set_config('purchase.rpc', '1', true);
  UPDATE purchase_request_items SET status = coalesce(nullif(_status, ''), status), order_number = nullif(trim(coalesce(_order, '')), '') WHERE id = _item;
END $$;

REVOKE EXECUTE ON FUNCTION public.purchase_request_create(jsonb), public.purchase_request_send(uuid), public.purchase_request_decide(uuid, boolean, text),
  public.purchase_request_set_status(uuid, text, text), public.purchase_item_set(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.purchase_request_create(jsonb), public.purchase_request_send(uuid), public.purchase_request_decide(uuid, boolean, text),
  public.purchase_request_set_status(uuid, text, text), public.purchase_item_set(uuid, text, text) TO authenticated;

-- Fotos dos itens
INSERT INTO storage.buckets (id, name, public) VALUES ('purchase-photos', 'purchase-photos', false) ON CONFLICT (id) DO NOTHING;
DROP POLICY IF EXISTS "purchase photos read" ON storage.objects;
CREATE POLICY "purchase photos read" ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'purchase-photos' AND public.is_active_user());
DROP POLICY IF EXISTS "purchase photos insert" ON storage.objects;
CREATE POLICY "purchase photos insert" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'purchase-photos' AND public.is_active_user());
DROP POLICY IF EXISTS "purchase photos delete" ON storage.objects;
CREATE POLICY "purchase photos delete" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'purchase-photos' AND owner = auth.uid());

-- Comprador e Aprovadores fechados por padrão para quem não é admin/programador (liberar em Acessos).
INSERT INTO public.role_page_access (role, path, allowed) VALUES
  ('viewer', '/compras/comprador', false), ('viewer', '/compras/aprovadores', false),
  ('coordenador', '/compras/solicitacoes', true), ('encarregado', '/compras/solicitacoes', true)
ON CONFLICT DO NOTHING;

-- Numeração já usada na planilha (aba 1ª SC), para não repetir números.
INSERT INTO public.purchase_sc_seq (requester_key, last_number) VALUES
  ('CAROLINA', 2), ('FELIPE OKI', 3), ('HELDER', 21), ('JACO', 2), ('LUCAS GARCIA', 27), ('LUIS ROBERTO', 1),
  ('MARCELO CARVALHO', 98), ('MARCELO NEGRO', 2), ('MARCOS COIMBRA', 1), ('MAURILIO', 7), ('NEILSON', 1), ('RAFAEL', 2),
  ('RICARDO CENEDESI', 1), ('SUZIELMO', 5), ('THIAGO', 6), ('VITORIA', 31)
ON CONFLICT (requester_key) DO NOTHING;
