CREATE OR REPLACE FUNCTION public.can_access_client(_client_id uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT public.can_access_page('/programacao/servicos') AND (
    public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'programmer') OR EXISTS (
      SELECT 1 FROM public.foreman_works fw JOIN public.works w ON w.id = fw.work_id
      WHERE fw.user_id = auth.uid() AND w.client_id = _client_id));
$$;

CREATE OR REPLACE FUNCTION public.weekend_add_allocation(_work_id uuid, _date date, _collaborator_id uuid)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE c uuid; sid uuid; aid uuid; other text; pos uuid;
BEGIN
  SELECT client_id INTO c FROM works WHERE id = _work_id;
  IF c IS NULL OR NOT public.can_access_client(c) THEN RAISE EXCEPTION 'Sem permissão'; END IF;
  IF extract(dow from _date) NOT IN (0,6) THEN RAISE EXCEPTION 'Adicionar colaboradores pela aba Serviços só em sábado e domingo'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('alloc:' || _collaborator_id::text || ':' || _date::text));
  IF EXISTS (SELECT 1 FROM days_off WHERE collaborator_id=_collaborator_id AND date<=_date AND coalesce(end_date,date)>=_date)
     OR EXISTS (SELECT 1 FROM vacations WHERE collaborator_id=_collaborator_id AND start_date<=_date AND end_date>=_date)
     OR EXISTS (SELECT 1 FROM medical_leaves WHERE collaborator_id=_collaborator_id AND start_date<=_date AND end_date>=_date) THEN
    RAISE EXCEPTION 'Colaborador ausente (folga, férias ou atestado) neste dia';
  END IF;
  SELECT id INTO sid FROM daily_schedules WHERE schedule_date = _date;
  IF sid IS NULL THEN
    INSERT INTO daily_schedules(schedule_date, created_by) VALUES (_date, auth.uid()) RETURNING id INTO sid;
  END IF;
  SELECT coalesce(w.client,'') || ' - ' || w.name INTO other FROM daily_allocations a JOIN works w ON w.id=a.work_id
    WHERE a.schedule_id=sid AND a.collaborator_id=_collaborator_id AND w.client_id IS DISTINCT FROM c LIMIT 1;
  IF other IS NOT NULL THEN RAISE EXCEPTION 'Colaborador já escalado em outra obra neste dia (%)', other; END IF;
  SELECT a.id INTO aid FROM daily_allocations a JOIN works w ON w.id=a.work_id
    WHERE a.schedule_id=sid AND a.collaborator_id=_collaborator_id AND w.client_id=c LIMIT 1;
  IF aid IS NOT NULL THEN
    UPDATE daily_allocations SET work_id=_work_id, service_assigned=true WHERE id=aid;
    RETURN aid;
  END IF;
  SELECT position_id INTO pos FROM collaborators WHERE id=_collaborator_id;
  INSERT INTO daily_allocations(schedule_id, work_id, collaborator_id, position_id, source, service_assigned)
  VALUES (sid, _work_id, _collaborator_id, pos, 'manual', true) RETURNING id INTO aid;
  UPDATE schedule_client_visibility SET visible=true, updated_at=now() WHERE schedule_date=_date AND client_id=c;
  RETURN aid;
END $$;

CREATE OR REPLACE FUNCTION public.weekend_remove_allocation(_alloc_id uuid)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE c uuid; d date; col uuid;
BEGIN
  SELECT w.client_id, s.schedule_date, a.collaborator_id INTO c, d, col FROM daily_allocations a
    JOIN works w ON w.id=a.work_id JOIN daily_schedules s ON s.id=a.schedule_id WHERE a.id=_alloc_id;
  IF c IS NULL OR NOT public.can_access_client(c) THEN RAISE EXCEPTION 'Sem permissão'; END IF;
  IF extract(dow from d) NOT IN (0,6) THEN RAISE EXCEPTION 'Remover do dia pela aba Serviços só em sábado e domingo'; END IF;
  DELETE FROM transport_passengers WHERE schedule_date=d AND client_id=c AND collaborator_id=col;
  DELETE FROM daily_allocations WHERE id=_alloc_id;
END $$;

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
  INSERT INTO vehicle_schedules(schedule_date, vehicle_id, driver_id, client_id, km)
  VALUES (_date, _vehicle_id, _driver_id, _client_id, km) RETURNING id INTO vid;
  IF _driver_id IS NOT NULL THEN
    DELETE FROM transport_passengers WHERE schedule_date=_date AND client_id=_client_id AND collaborator_id=_driver_id;
  END IF;
  RETURN vid;
END $$;

REVOKE EXECUTE ON FUNCTION public.weekend_add_allocation(uuid,date,uuid), public.weekend_remove_allocation(uuid), public.weekend_add_vehicle(uuid,date,uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.weekend_add_allocation(uuid,date,uuid), public.weekend_remove_allocation(uuid), public.weekend_add_vehicle(uuid,date,uuid,uuid) TO authenticated;