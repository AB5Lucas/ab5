-- Status da SC pelos itens (Comprador): algum item COMPRADO (ou ALMOXARIFADO), mas não todos = COMPRA PARCIAL;
-- todos = COMPRA EFETIVADA. Itens RECUSADO e CANCELADO não contam no total. A data do status = a mais recente entre os itens comprados.
-- Não mexe em SC cancelada, recusada ou já no almoxarifado, nem fora de Compras.
CREATE OR REPLACE FUNCTION public.purchase_request_status_from_items() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r purchase_requests; _total int; _bought int; _last date; _new text;
BEGIN
  SELECT * INTO r FROM purchase_requests WHERE id = NEW.request_id;
  IF r.id IS NULL OR r.stage <> 'compras' OR r.status IN ('CANCELADA', 'RECUSADA', 'ALMOXARIFADO') THEN RETURN NEW; END IF;
  SELECT count(*) FILTER (WHERE status NOT IN ('RECUSADO', 'CANCELADO')), count(*) FILTER (WHERE status IN ('COMPRADO', 'ALMOXARIFADO')),
    max(status_at) FILTER (WHERE status IN ('COMPRADO', 'ALMOXARIFADO'))
    INTO _total, _bought, _last FROM purchase_request_items WHERE request_id = NEW.request_id;
  IF _bought = 0 THEN RETURN NEW; END IF;
  _new := CASE WHEN _bought >= _total THEN 'COMPRA EFETIVADA' ELSE 'COMPRA PARCIAL' END;
  IF r.status IS DISTINCT FROM _new OR r.status_at IS DISTINCT FROM coalesce(_last, r.status_at) THEN
    PERFORM set_config('purchase.rpc', '1', true);
    UPDATE purchase_requests SET status = _new, status_at = coalesce(_last, (now() AT TIME ZONE 'America/Sao_Paulo')::date) WHERE id = r.id;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_purchase_request_status_from_items ON public.purchase_request_items;
CREATE TRIGGER trg_purchase_request_status_from_items AFTER UPDATE OF status, status_at ON public.purchase_request_items
  FOR EACH ROW EXECUTE FUNCTION public.purchase_request_status_from_items();

-- Comprador cancela a SC inteira (com motivo, que fica nas observações do comprador).
CREATE OR REPLACE FUNCTION public.purchase_request_buyer_cancel(_id uuid, _notes text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r purchase_requests;
BEGIN
  SELECT * INTO r FROM purchase_requests WHERE id = _id FOR UPDATE;
  IF r.id IS NULL OR NOT public.purchase_is_buyer() THEN RAISE EXCEPTION 'Sem acesso ao Comprador'; END IF;
  IF r.stage <> 'compras' THEN RAISE EXCEPTION 'Esta solicitação não está em Compras'; END IF;
  IF coalesce(trim(_notes), '') = '' THEN RAISE EXCEPTION 'Escreva o motivo do cancelamento'; END IF;
  PERFORM set_config('purchase.rpc', '1', true);
  UPDATE purchase_requests SET stage = 'cancelada', status = 'CANCELADA', cancelled_at = now(),
    buyer_notes = 'Cancelada pelo Comprador: ' || trim(_notes), status_at = (now() AT TIME ZONE 'America/Sao_Paulo')::date WHERE id = _id;
END $$;
REVOKE EXECUTE ON FUNCTION public.purchase_request_buyer_cancel(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.purchase_request_buyer_cancel(uuid, text) TO authenticated;
