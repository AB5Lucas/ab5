CREATE OR REPLACE FUNCTION public.prev_business_day(_date date)
RETURNS date LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE d date := _date - 1; i int := 0;
BEGIN
  WHILE i < 30 AND (extract(dow from d) IN (0,6) OR EXISTS (SELECT 1 FROM holidays WHERE date = d)) LOOP
    d := d - 1; i := i + 1;
  END LOOP;
  RETURN d;
END $$;

CREATE OR REPLACE FUNCTION public.copy_service_split(_client_id uuid, _date date)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE prev date; n int := 0; sid uuid; psid uuid;
BEGIN
  IF NOT public.can_access_client(_client_id) THEN RAISE EXCEPTION 'Sem permissão'; END IF;
  prev := public.prev_business_day(_date);
  SELECT id INTO sid FROM daily_schedules WHERE schedule_date = _date;
  SELECT id INTO psid FROM daily_schedules WHERE schedule_date = prev;
  IF sid IS NULL OR psid IS NULL THEN RETURN 0; END IF;
  UPDATE daily_allocations a SET work_id = p.work_id, service_assigned = true
  FROM daily_allocations p, works wp, works wa
  WHERE a.schedule_id = sid AND p.schedule_id = psid AND p.collaborator_id = a.collaborator_id
    AND wp.id = p.work_id AND wa.id = a.work_id AND wp.client_id = _client_id AND wa.client_id = _client_id
    AND wp.active AND p.service_assigned;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

REVOKE EXECUTE ON FUNCTION public.prev_business_day(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.prev_business_day(date) TO authenticated;