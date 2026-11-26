-- SC já efetivada (ou almoxarifado/cancelada/recusada) não pode mais ser cancelada.
CREATE OR REPLACE FUNCTION public.purchase_request_cancel(_id uuid)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE r purchase_requests;
BEGIN
  SELECT * INTO r FROM purchase_requests WHERE id = _id FOR UPDATE;
  IF r.id IS NULL OR r.requester_id <> auth.uid() THEN RAISE EXCEPTION 'Solicitação não encontrada'; END IF;
  IF r.stage NOT IN ('aprovacao', 'compras') THEN RAISE EXCEPTION 'Só dá para cancelar uma solicitação enviada'; END IF;
  IF r.status IN ('COMPRA EFETIVADA', 'ALMOXARIFADO', 'CANCELADA', 'RECUSADA') THEN RAISE EXCEPTION 'Compra já efetivada: não dá para cancelar'; END IF;
  PERFORM set_config('purchase.rpc', '1', true);
  UPDATE purchase_requests SET stage = 'cancelada', status = 'CANCELADA', cancelled_at = now(),
    status_at = (now() AT TIME ZONE 'America/Sao_Paulo')::date WHERE id = _id;
END $function$;

CREATE OR REPLACE FUNCTION public.purchase_request_buyer_cancel(_id uuid, _notes text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE r purchase_requests;
BEGIN
  SELECT * INTO r FROM purchase_requests WHERE id = _id FOR UPDATE;
  IF r.id IS NULL OR NOT public.purchase_is_buyer() THEN RAISE EXCEPTION 'Sem acesso ao Comprador'; END IF;
  IF r.stage <> 'compras' THEN RAISE EXCEPTION 'Esta solicitação não está em Compras'; END IF;
  IF r.status IN ('COMPRA EFETIVADA', 'ALMOXARIFADO', 'CANCELADA', 'RECUSADA') THEN RAISE EXCEPTION 'Compra já efetivada: não dá para cancelar'; END IF;
  IF coalesce(trim(_notes), '') = '' THEN RAISE EXCEPTION 'Escreva o motivo do cancelamento'; END IF;
  PERFORM set_config('purchase.rpc', '1', true);
  UPDATE purchase_requests SET stage = 'cancelada', status = 'CANCELADA', cancelled_at = now(),
    buyer_notes = 'Cancelada pelo Comprador: ' || trim(_notes), status_at = (now() AT TIME ZONE 'America/Sao_Paulo')::date WHERE id = _id;
END $function$;
