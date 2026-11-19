-- Comprador devolve a SC para o Validador (volta à Validação) ou para o solicitante (rascunho).
DROP FUNCTION IF EXISTS public.purchase_request_return(uuid, text);
CREATE OR REPLACE FUNCTION public.purchase_request_return(_id uuid, _notes text, _target text DEFAULT 'solicitante')
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE r purchase_requests;
BEGIN
  SELECT * INTO r FROM purchase_requests WHERE id = _id FOR UPDATE;
  IF r.id IS NULL OR NOT public.purchase_is_buyer() THEN RAISE EXCEPTION 'Sem acesso ao Comprador'; END IF;
  IF r.stage <> 'compras' THEN RAISE EXCEPTION 'Esta solicitação não está em Compras'; END IF;
  IF coalesce(trim(_notes), '') = '' THEN RAISE EXCEPTION 'Escreva o motivo da devolução'; END IF;
  PERFORM set_config('purchase.rpc', '1', true);
  IF _target = 'validador' THEN
    IF r.approver_id IS NULL THEN RAISE EXCEPTION 'Esta SC não passou por validador; devolva ao solicitante'; END IF;
    UPDATE purchase_requests SET stage = 'aprovacao', approved_at = NULL, decided_by = NULL,
      return_notes = 'Comprador (ao validador): ' || trim(_notes), returned_by = auth.uid() WHERE id = _id;
  ELSE
    UPDATE purchase_requests SET stage = 'rascunho', sent_at = NULL, approved_at = NULL, return_notes = 'Comprador: ' || trim(_notes),
      returned_by = auth.uid(), status = 'EM PREPARAÇÃO', status_at = (now() AT TIME ZONE 'America/Sao_Paulo')::date WHERE id = _id;
  END IF;
END $function$;
GRANT EXECUTE ON FUNCTION public.purchase_request_return(uuid, text, text) TO authenticated;
