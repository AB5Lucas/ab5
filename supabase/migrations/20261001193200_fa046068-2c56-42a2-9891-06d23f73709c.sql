CREATE OR REPLACE FUNCTION public.weekend_add_vehicle(_client_id uuid, _date date, _vehicle_id uuid, _driver_id uuid)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE st text; other text; vid uuid; km numeric;
BEGIN
  IF NOT public.can_access_client(_client_id) THEN RAISE EXCEPTION 'Sem permissão'; END IF;
  IF extract(dow from _date) NOT IN (0,6) THEN RAISE EXCEPTION 'Adicionar veículos pela aba Serviços só em sábado e domingo'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('veh:' || _vehicle_id::text || ':' || _date::text));
  SELECT status::text INTO st FROM vehicles WHERE id=_vehicle_id;
  IF st IN ('maintenance','inactive') THEN RAISE EXCEPTION 'Veículo indisponível (manutenção ou inativo)'; END IF;
  SELECT coalesce(c.name, 'outro uso') INTO other FROM vehicle_schedules v LEFT JOIN clients c ON c.id=v.client_id
    WHERE v.vehicle_id=_vehicle_id AND v.schedule_date=_date LIMIT 1;
  IF other IS NOT NULL THEN RAISE EXCEPTION 'Veículo já alocado em outra obra neste dia (%)', other; END IF;
  IF _driver_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext('alloc:' || _driver_id::text || ':' || _date::text));
    IF EXISTS (SELECT 1 FROM daily_allocations a JOIN daily_schedules s ON s.id=a.schedule_id JOIN works w ON w.id=a.work_id
               WHERE s.schedule_date=_date AND a.collaborator_id=_driver_id AND w.client_id IS DISTINCT FROM _client_id) THEN
      RAISE EXCEPTION 'Motorista já escalado em outra obra neste dia';
    END IF;
    IF EXISTS (SELECT 1 FROM vehicle_schedules WHERE schedule_date=_date AND driver_id=_driver_id) THEN
      RAISE EXCEPTION 'Motorista já dirige outro veículo neste dia';
    END IF;
  END IF;
  SELECT coalesce(distance_km,0) INTO km FROM clients WHERE id=_client_id;
  INSERT INTO vehicle_schedules(schedule_date, vehicle_id, driver_id, client_id, km, driver_bonus)
  VALUES (_date, _vehicle_id, _driver_id, _client_id, km, _driver_id IS NOT NULL) RETURNING id INTO vid;
  IF _driver_id IS NOT NULL THEN
    DELETE FROM transport_passengers WHERE schedule_date=_date AND client_id=_client_id AND collaborator_id=_driver_id;
  END IF;
  RETURN vid;
END $$;

CREATE OR REPLACE FUNCTION public.weekend_vehicle_bonus() RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF extract(dow from NEW.schedule_date) IN (0,6) AND NEW.driver_id IS NOT NULL
     AND NEW.driver_id IS DISTINCT FROM OLD.driver_id THEN
    NEW.driver_bonus := true;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_weekend_vehicle_bonus ON public.vehicle_schedules;
CREATE TRIGGER trg_weekend_vehicle_bonus BEFORE UPDATE OF driver_id ON public.vehicle_schedules
FOR EACH ROW EXECUTE FUNCTION public.weekend_vehicle_bonus();