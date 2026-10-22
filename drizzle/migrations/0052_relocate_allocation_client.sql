CREATE OR REPLACE FUNCTION public.relocate_allocation_client(_alloc_id uuid, _client_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE c uuid; d date; col uuid; wid uuid; n int;
BEGIN
  SELECT w.client_id, s.schedule_date, a.collaborator_id INTO c, d, col FROM daily_allocations a
    JOIN works w ON w.id=a.work_id JOIN daily_schedules s ON s.id=a.schedule_id WHERE a.id=_alloc_id;
  IF c IS NULL OR NOT public.can_access_client(c) THEN RAISE EXCEPTION 'Sem permissão'; END IF;
  IF c = _client_id THEN RAISE EXCEPTION 'Colaborador já está neste cliente'; END IF;
  SELECT count(*) INTO n FROM works WHERE client_id=_client_id AND active;
  SELECT id INTO wid FROM works WHERE client_id=_client_id AND active ORDER BY name LIMIT 1;
  IF wid IS NULL THEN RAISE EXCEPTION 'Cliente sem serviço ativo'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('alloc:' || col::text || ':' || d::text));
  DELETE FROM transport_passengers WHERE schedule_date=d AND client_id=c AND collaborator_id=col;
  UPDATE daily_allocations SET work_id=wid, service_assigned=(n=1), source='manual' WHERE id=_alloc_id;
  UPDATE schedule_client_visibility SET visible=true, updated_at=now() WHERE schedule_date=d AND client_id=_client_id;
END $$;
GRANT EXECUTE ON FUNCTION public.relocate_allocation_client(uuid, uuid) TO authenticated;