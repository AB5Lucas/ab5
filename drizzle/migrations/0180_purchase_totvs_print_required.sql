-- SC do TOTVS: o print da solicitação (imagem colada, purchase_requests.photo_path) é obrigatório para criar e para enviar.
-- Compatível: SCs já enviadas não mudam; só o envio de um rascunho do TOTVS sem print passa a ser recusado.
CREATE OR REPLACE FUNCTION public.purchase_request_create_totvs(_number text, _photo text, _observers uuid[] DEFAULT '{}'::uuid[], _p jsonb DEFAULT '{}'::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _name text; _id uuid; _n text := upper(trim(coalesce(_number, '')));
BEGIN
  IF NOT public.is_active_user() THEN RAISE EXCEPTION 'Usuário sem acesso'; END IF;
  IF _n = '' THEN RAISE EXCEPTION 'Informe o número da SC do TOTVS'; END IF;
  IF coalesce(trim(_photo), '') = '' THEN RAISE EXCEPTION 'O print da solicitação é obrigatório.'; END IF;
  IF EXISTS (SELECT 1 FROM purchase_requests WHERE number = 'TOTVS-' || _n) THEN RAISE EXCEPTION 'A SC % do TOTVS já foi lançada', _n; END IF;
  SELECT full_name INTO _name FROM users_profiles WHERE id = auth.uid();
  PERFORM set_config('purchase.rpc', '1', true);
  INSERT INTO purchase_requests (number, seq, requester_id, requester_name, system, delivery_kind, delivery_place, photo_path, observer_ids,
    category, nature, priority, client_id, due_date, notes, justification, work_id, cc_code, stage, status, status_at)
  VALUES ('TOTVS-' || _n, 0, auth.uid(), public.purchase_requester_key(_name), 'TOTVS', coalesce(nullif(_p->>'delivery_kind', ''), 'ab5'),
    nullif(_p->>'delivery_place', ''), _photo, coalesce(_observers, '{}'),
    nullif(_p->>'category', ''), nullif(_p->>'nature', ''), nullif(_p->>'priority', ''), nullif(_p->>'client_id', '')::uuid,
    nullif(_p->>'due_date', '')::date, nullif(_p->>'notes', ''), nullif(trim(_p->>'justification'), ''),
    nullif(_p->>'work_id', '')::uuid, nullif(trim(_p->>'cc_code'), ''),
    'rascunho', 'EM PREPARAÇÃO', (now() AT TIME ZONE 'America/Sao_Paulo')::date)
  RETURNING id INTO _id;
  RETURN _id;
END $function$;

CREATE OR REPLACE FUNCTION public.purchase_request_send(_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE r purchase_requests; cfg purchase_approvers; _items int; _missing int; _collab uuid; _appr uuid; _sub uuid; _today date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  SELECT * INTO r FROM purchase_requests WHERE id = _id FOR UPDATE;
  IF r.id IS NULL OR NOT (r.requester_id = auth.uid() OR public.has_role(auth.uid(), 'admin')) THEN RAISE EXCEPTION 'Solicitação não encontrada'; END IF;
  IF r.stage <> 'rascunho' THEN RAISE EXCEPTION 'Esta solicitação já foi enviada'; END IF;
  IF r.system = 'TOTVS' AND coalesce(trim(r.photo_path), '') = '' THEN RAISE EXCEPTION 'O print da solicitação é obrigatório.'; END IF;
  SELECT count(*), count(*) FILTER (WHERE coalesce(budget, 0) <= 0) INTO _items, _missing FROM purchase_request_items WHERE request_id = _id;
  IF _items = 0 AND r.system <> 'TOTVS' THEN RAISE EXCEPTION 'Inclua ao menos um item'; END IF;
  IF r.system <> 'TOTVS' AND upper(coalesce(r.nature, '')) <> 'PROGRAMADA' AND coalesce(r.total_budget, 0) <= 0 AND _missing > 0 THEN
    RAISE EXCEPTION 'Informe a verba de cada item ou a verba total';
  END IF;
  SELECT * INTO cfg FROM purchase_approvers WHERE requester_id = r.requester_id;
  PERFORM set_config('purchase.rpc', '1', true);
  IF cfg.requester_id IS NOT NULL AND NOT cfg.needs_approval THEN
    UPDATE purchase_requests SET stage = 'compras', sent_at = now(), approved_at = now(), approver_id = NULL, approver_collab_id = NULL,
      substitute_id = NULL, decided_by = NULL, return_notes = NULL, returned_by = NULL,
      approver_notes = 'Sem validação (solicitante liberado)', status = 'SOLICITAÇÃO ENVIADA', status_at = _today WHERE id = _id;
    RETURN 'compras';
  END IF;
  _collab := public.purchase_client_manager(r.client_id);
  IF _collab IS NULL THEN RAISE EXCEPTION 'O cliente desta SC não tem gestor cadastrado nos serviços (Clientes › Serviços)'; END IF;
  _sub := public.purchase_user_of_collaborator(public.purchase_client_substitute(r.client_id, _collab));
  _appr := public.purchase_user_of_collaborator(_collab);
  IF _appr IS NULL THEN _appr := _sub; END IF;
  IF _appr IS NULL THEN
    RAISE EXCEPTION 'O gestor % não tem usuário no sistema; cadastre um substituto do gestor no serviço (Clientes › Serviços)',
      (SELECT full_name FROM collaborators WHERE id = _collab);
  END IF;
  INSERT INTO user_page_access (user_id, path, allowed, updated_at)
  SELECT DISTINCT u, '/compras/aprovacao', true, now() FROM unnest(ARRAY[_appr, _sub]) u WHERE u IS NOT NULL
  ON CONFLICT (user_id, path) DO UPDATE SET allowed = true, updated_at = now();
  UPDATE purchase_requests SET stage = 'aprovacao', sent_at = now(), approver_id = _appr, approver_collab_id = _collab,
    substitute_id = CASE WHEN _sub = _appr THEN NULL ELSE _sub END, decided_by = NULL, approver_notes = NULL,
    return_notes = NULL, returned_by = NULL, status = 'SOLICITAÇÃO ENVIADA', status_at = _today WHERE id = _id;
  RETURN 'aprovacao';
END $function$;
