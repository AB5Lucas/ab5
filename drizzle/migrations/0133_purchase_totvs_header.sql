-- SC do TOTVS: o cabeçalho é preenchido como na planilha (categoria, natureza, prioridade, cliente, prazo, entrega,
-- justificativa, observações) e depois vem o nº + foto do TOTVS; vai direto para o Comprador.
DROP FUNCTION IF EXISTS public.purchase_request_create_totvs(text, text, uuid[]);
CREATE OR REPLACE FUNCTION public.purchase_request_create_totvs(_number text, _photo text, _observers uuid[] DEFAULT '{}', _p jsonb DEFAULT '{}')
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _name text; _id uuid; _n text := upper(trim(coalesce(_number, '')));
BEGIN
  IF NOT public.is_active_user() THEN RAISE EXCEPTION 'Usuário sem acesso'; END IF;
  IF _n = '' THEN RAISE EXCEPTION 'Informe o número da SC do TOTVS'; END IF;
  IF coalesce(trim(_photo), '') = '' THEN RAISE EXCEPTION 'Anexe a foto da SC do TOTVS'; END IF;
  IF EXISTS (SELECT 1 FROM purchase_requests WHERE number = 'TOTVS-' || _n) THEN RAISE EXCEPTION 'A SC % do TOTVS já foi lançada', _n; END IF;
  SELECT full_name INTO _name FROM users_profiles WHERE id = auth.uid();
  PERFORM set_config('purchase.rpc', '1', true);
  INSERT INTO purchase_requests (number, seq, requester_id, requester_name, system, delivery_kind, delivery_place, photo_path, observer_ids,
    category, nature, priority, client_id, due_date, notes, justification,
    stage, sent_at, approved_at, approver_notes, status, status_at)
  VALUES ('TOTVS-' || _n, 0, auth.uid(), public.purchase_requester_key(_name), 'TOTVS', coalesce(nullif(_p->>'delivery_kind', ''), 'ab5'),
    nullif(_p->>'delivery_place', ''), _photo, coalesce(_observers, '{}'),
    nullif(_p->>'category', ''), nullif(_p->>'nature', ''), nullif(_p->>'priority', ''), nullif(_p->>'client_id', '')::uuid,
    nullif(_p->>'due_date', '')::date, nullif(_p->>'notes', ''), nullif(trim(_p->>'justification'), ''),
    'compras', now(), now(), 'SC do TOTVS', 'SOLICITAÇÃO ENVIADA', (now() AT TIME ZONE 'America/Sao_Paulo')::date)
  RETURNING id INTO _id;
  RETURN _id;
END $$;
REVOKE EXECUTE ON FUNCTION public.purchase_request_create_totvs(text, text, uuid[], jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.purchase_request_create_totvs(text, text, uuid[], jsonb) TO authenticated;
