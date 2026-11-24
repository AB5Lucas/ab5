-- Montagem do transporte (aba Serviços): trocar o motorista do frete do cliente certo.
-- Quando o cliente é obra ADICIONAL do carro (extra_client_ids[i]), o motorista vai para extra_driver_ids[i];
-- quando é o cliente principal (ou _client_id nulo), segue set_vehicle_driver (driver_id + driver_bonus).
-- Função nova (set_vehicle_driver continua igual para o código que já está no ar).
CREATE OR REPLACE FUNCTION public.set_vehicle_driver_for_client(_vs_id uuid, _driver_id uuid, _client_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v public.vehicle_schedules%ROWTYPE;
  i int;
  d text[];
BEGIN
  SELECT * INTO v FROM public.vehicle_schedules WHERE id = _vs_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Programação do veículo não encontrada'; END IF;
  IF _client_id IS NULL OR v.client_id = _client_id THEN
    PERFORM public.set_vehicle_driver(_vs_id, _driver_id);
    RETURN;
  END IF;
  IF NOT public.can_access_client(_client_id) THEN RAISE EXCEPTION 'Sem permissão'; END IF;
  i := array_position(v.extra_client_ids, _client_id::text);
  IF i IS NULL THEN RAISE EXCEPTION 'O veículo não atende este cliente neste dia'; END IF;
  d := coalesce(v.extra_driver_ids, '{}'::text[]);
  WHILE coalesce(array_length(d, 1), 0) < cardinality(v.extra_client_ids) LOOP
    d := d || ''::text;
  END LOOP;
  d[i] := coalesce(_driver_id::text, '');
  UPDATE public.vehicle_schedules SET extra_driver_ids = d, updated_at = now() WHERE id = _vs_id;
  IF _driver_id IS NOT NULL THEN
    DELETE FROM public.transport_passengers
      WHERE schedule_date = v.schedule_date AND client_id = _client_id AND collaborator_id = _driver_id;
  END IF;
END $function$;

GRANT EXECUTE ON FUNCTION public.set_vehicle_driver_for_client(uuid, uuid, uuid) TO authenticated;
