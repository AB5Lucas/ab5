-- Comprador não edita mais o Prazo de entrega da SC (só Categoria, Natureza e Prioridade). Pedido do usuário em 26/11.
CREATE OR REPLACE FUNCTION public.purchase_request_buyer_edit(_id uuid, _field text, _value text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r purchase_requests; _old text; _v text := nullif(trim(coalesce(_value, '')), '');
BEGIN
  SELECT * INTO r FROM purchase_requests WHERE id = _id FOR UPDATE;
  IF r.id IS NULL OR NOT public.purchase_is_buyer() THEN RAISE EXCEPTION 'Sem acesso ao Comprador'; END IF;
  IF r.stage <> 'compras' THEN RAISE EXCEPTION 'Esta solicitação não está em Compras'; END IF;
  IF r.fa_state = 'em_aprovacao' THEN RAISE EXCEPTION 'Esta SC está em aprovação: puxe de volta para editar'; END IF;
  IF _field NOT IN ('category', 'nature', 'priority') THEN RAISE EXCEPTION 'Campo não editável pelo comprador: %', _field; END IF;
  _old := CASE _field WHEN 'category' THEN r.category WHEN 'nature' THEN r.nature ELSE r.priority END;
  IF _old IS NOT DISTINCT FROM _v THEN RETURN; END IF;
  PERFORM set_config('purchase.rpc', '1', true);
  IF _field = 'category' THEN UPDATE purchase_requests SET category = _v WHERE id = _id;
  ELSIF _field = 'nature' THEN UPDATE purchase_requests SET nature = _v WHERE id = _id;
  ELSE UPDATE purchase_requests SET priority = _v WHERE id = _id; END IF;
  INSERT INTO purchase_request_edits (request_id, field, old_value, new_value) VALUES (_id, _field, _old, _v);
END $$;
