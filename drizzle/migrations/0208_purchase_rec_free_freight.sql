-- Recomendação: critério extra 'frete' (frete grátis), sempre junto de ao menos um critério principal.
CREATE OR REPLACE FUNCTION public.purchase_rec_set_criteria(_id uuid, _criteria text[])
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.purchase_quote_can_write(_id) THEN RAISE EXCEPTION 'Sem acesso à recomendação desta SC'; END IF;
  IF _criteria IS NULL OR NOT (_criteria <@ ARRAY['valor', 'prazo', 'pagamento', 'frete'])
     OR NOT (_criteria && ARRAY['valor', 'prazo', 'pagamento']) THEN RAISE EXCEPTION 'Escolha ao menos um critério'; END IF;
  PERFORM set_config('purchase.rpc', '1', true);
  UPDATE purchase_requests SET rec_criteria = _criteria WHERE id = _id;
END $function$;
