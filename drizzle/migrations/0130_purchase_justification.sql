-- SC: justificativa obrigatória no cabeçalho (acima das observações).
ALTER TABLE public.purchase_requests ADD COLUMN IF NOT EXISTS justification text;
CREATE OR REPLACE FUNCTION public.purchase_request_create(_p jsonb) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _name text; _key text; _n int; _id uuid;
BEGIN
  IF NOT public.is_active_user() THEN RAISE EXCEPTION 'Usuário sem acesso'; END IF;
  IF coalesce(trim(_p->>'justification'), '') = '' THEN RAISE EXCEPTION 'Preencha a justificativa'; END IF;
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
    due_date, delivery_kind, delivery_place, notes, observer_ids, justification)
  VALUES ('SC-' || _key || '-' || lpad(_n::text, 3, '0'), _n, auth.uid(), _key, 'PLANILHA', _p->>'category', _p->>'nature',
    _p->>'priority', nullif(_p->>'client_id', '')::uuid, (_p->>'due_date')::date, coalesce(_p->>'delivery_kind', 'ab5'),
    nullif(_p->>'delivery_place', ''), nullif(_p->>'notes', ''),
    coalesce(ARRAY(SELECT jsonb_array_elements_text(coalesce(_p->'observer_ids', '[]'::jsonb))::uuid), '{}'),
    trim(_p->>'justification'))
  RETURNING id INTO _id;
  RETURN _id;
END $$;
