-- Compras: o solicitante também é avisado quando um item é marcado como comprado (ou entregue no almoxarifado),
-- além do pedido de compras incluído (que já avisava) e de recusado/cancelado.
CREATE OR REPLACE FUNCTION public.purchase_notify_item()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE r purchase_requests; _ord text := nullif(trim(coalesce(NEW.order_number, '')), ''); _item text;
BEGIN
  SELECT * INTO r FROM purchase_requests WHERE id = NEW.request_id;
  IF r.id IS NULL THEN RETURN NEW; END IF;
  _item := 'Item ' || NEW.item_no || ' (' || left(NEW.description, 60) || ')';
  IF _ord IS NOT NULL AND _ord IS DISTINCT FROM nullif(trim(coalesce(OLD.order_number, '')), '') THEN
    PERFORM public.notify_user(r.requester_id, 'compras', 'sc_pedido', 'Pedido de compra incluído na SC',
      _item || ': pedido ' || _ord, '/compras/solicitacoes/' || r.id, r.number, 'purchase_request', r.id,
      'sci:' || NEW.id || ':pc:' || md5(_ord));
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN ('COMPRADO', 'ALMOXARIFADO') THEN
    PERFORM public.notify_user(r.requester_id, 'compras', 'sc_item_comprado',
      CASE WHEN NEW.status = 'COMPRADO' THEN 'Item comprado na SC' ELSE 'Item no almoxarifado' END,
      concat_ws(' · ', _item, CASE WHEN _ord IS NOT NULL THEN 'pedido ' || _ord END),
      '/compras/solicitacoes/' || r.id, r.number, 'purchase_request', r.id, 'sci:' || NEW.id || ':st:' || NEW.status);
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN ('RECUSADO', 'CANCELADO') THEN
    PERFORM public.notify_user(r.requester_id, 'compras', 'sc_item_status', 'Item ' || lower(NEW.status) || ' na SC',
      _item, '/compras/solicitacoes/' || r.id, r.number, 'purchase_request', r.id, 'sci:' || NEW.id || ':st:' || NEW.status);
  END IF;
  RETURN NEW;
END $function$;
