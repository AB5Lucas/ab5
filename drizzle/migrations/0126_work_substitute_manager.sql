-- Compras: o substituto do gestor (valida enquanto o gestor está de férias ou quando ele não tem usuário) passa
-- a ser cadastrado no serviço (works.substitute_manager_id, opcional), não mais por solicitante na aba Validadores.

ALTER TABLE public.works ADD COLUMN IF NOT EXISTS substitute_manager_id uuid REFERENCES public.collaborators(id) ON DELETE SET NULL;

-- Substituto do gestor no cliente: o mais frequente nos serviços ativos desse gestor (senão em qualquer serviço do cliente).
CREATE OR REPLACE FUNCTION public.purchase_client_substitute(_client uuid, _manager uuid) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT substitute_manager_id FROM works WHERE client_id = _client AND active AND substitute_manager_id IS NOT NULL
  GROUP BY substitute_manager_id ORDER BY count(*) FILTER (WHERE manager_id = _manager) DESC, count(*) DESC, substitute_manager_id LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.purchase_request_send(_id uuid) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r purchase_requests; cfg purchase_approvers; _items int; _missing int; _collab uuid; _appr uuid; _sub uuid; _today date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
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
  -- Substituto do gestor: cadastro do serviço (Clientes › Serviços), não mais por solicitante.
  _sub := public.purchase_user_of_collaborator(public.purchase_client_substitute(r.client_id, _collab));
  _appr := public.purchase_user_of_collaborator(_collab);
  IF _appr IS NULL THEN _appr := _sub; END IF;
  IF _appr IS NULL THEN
    RAISE EXCEPTION 'O gestor % não tem usuário no sistema; cadastre um substituto do gestor no serviço (Clientes › Serviços)',
      (SELECT full_name FROM collaborators WHERE id = _collab);
  END IF;
  -- Gestor e substituto que recebem a SC viram validadores: ganham o acesso à página Validação.
  INSERT INTO user_page_access (user_id, path, allowed, updated_at)
  SELECT DISTINCT u, '/compras/aprovacao', true, now() FROM unnest(ARRAY[_appr, _sub]) u WHERE u IS NOT NULL
  ON CONFLICT (user_id, path) DO UPDATE SET allowed = true, updated_at = now();
  UPDATE purchase_requests SET stage = 'aprovacao', sent_at = now(), approver_id = _appr, approver_collab_id = _collab,
    substitute_id = CASE WHEN _sub = _appr THEN NULL ELSE _sub END, decided_by = NULL, approver_notes = NULL,
    return_notes = NULL, returned_by = NULL, status = 'SOLICITAÇÃO ENVIADA', status_at = _today WHERE id = _id;
  RETURN 'aprovacao';
END $$;
