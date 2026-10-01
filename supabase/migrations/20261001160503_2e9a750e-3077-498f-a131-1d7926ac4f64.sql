CREATE OR REPLACE FUNCTION public.copy_transport_prev(_client_id uuid, _date date)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE prev date; wd int; n int := 0; sid uuid; r record; vs uuid;
BEGIN
  IF NOT public.can_access_client(_client_id) THEN RAISE EXCEPTION 'Sem permissão'; END IF;
  wd := extract(dow from _date);
  prev := _date - CASE WHEN wd = 1 THEN 3 ELSE 1 END;
  SELECT id INTO sid FROM daily_schedules WHERE schedule_date = _date;
  IF sid IS NULL THEN RETURN 0; END IF;
  FOR r IN
    SELECT tp.collaborator_id, pv.vehicle_id, tp.vehicle_schedule_id
    FROM transport_passengers tp LEFT JOIN vehicle_schedules pv ON pv.id = tp.vehicle_schedule_id
    WHERE tp.schedule_date = prev AND tp.client_id = _client_id
      AND EXISTS (SELECT 1 FROM daily_allocations a JOIN works w ON w.id = a.work_id
                  WHERE a.schedule_id = sid AND a.collaborator_id = tp.collaborator_id AND w.client_id = _client_id)
      AND NOT EXISTS (SELECT 1 FROM transport_passengers x WHERE x.schedule_date = _date AND x.client_id = _client_id AND x.collaborator_id = tp.collaborator_id)
  LOOP
    vs := NULL;
    IF r.vehicle_schedule_id IS NOT NULL THEN
      SELECT id INTO vs FROM vehicle_schedules WHERE schedule_date = _date AND vehicle_id = r.vehicle_id
        AND (client_id = _client_id OR _client_id::text = ANY(extra_client_ids))
        AND driver_id IS DISTINCT FROM r.collaborator_id LIMIT 1;
      IF vs IS NULL THEN CONTINUE; END IF;
    END IF;
    PERFORM public.set_transport_passenger(_date, _client_id, vs, r.collaborator_id, false);
    n := n + 1;
  END LOOP;
  RETURN n;
END $$;