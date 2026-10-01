CREATE OR REPLACE FUNCTION public.can_access_client(_client_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT public.can_write() OR EXISTS (
    SELECT 1 FROM public.foreman_works fw JOIN public.works w ON w.id = fw.work_id
    WHERE fw.user_id = auth.uid() AND w.client_id = _client_id);
$$;

CREATE OR REPLACE FUNCTION public.move_allocation_service(_alloc_id uuid, _work_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE a record; oc uuid; nc uuid;
BEGIN
  SELECT * INTO a FROM daily_allocations WHERE id = _alloc_id;
  IF a IS NULL THEN RAISE EXCEPTION 'Alocação não encontrada'; END IF;
  SELECT client_id INTO oc FROM works WHERE id = a.work_id;
  SELECT client_id INTO nc FROM works WHERE id = _work_id;
  IF oc IS NULL OR oc IS DISTINCT FROM nc THEN RAISE EXCEPTION 'Serviço de outro cliente'; END IF;
  IF NOT public.can_access_client(nc) THEN RAISE EXCEPTION 'Sem permissão'; END IF;
  UPDATE daily_allocations SET work_id = _work_id WHERE id = _alloc_id;
END $$;

CREATE OR REPLACE FUNCTION public.copy_service_split(_client_id uuid, _date date)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE prev date; wd int; n int := 0; sid uuid; psid uuid;
BEGIN
  IF NOT public.can_access_client(_client_id) THEN RAISE EXCEPTION 'Sem permissão'; END IF;
  wd := extract(dow from _date);
  prev := _date - CASE WHEN wd = 1 THEN 3 ELSE 1 END;
  SELECT id INTO sid FROM daily_schedules WHERE schedule_date = _date;
  SELECT id INTO psid FROM daily_schedules WHERE schedule_date = prev;
  IF sid IS NULL OR psid IS NULL THEN RETURN 0; END IF;
  UPDATE daily_allocations a SET work_id = p.work_id
  FROM daily_allocations p, works wp, works wa
  WHERE a.schedule_id = sid AND p.schedule_id = psid AND p.collaborator_id = a.collaborator_id
    AND wp.id = p.work_id AND wa.id = a.work_id AND wp.client_id = _client_id AND wa.client_id = _client_id
    AND wp.active AND a.work_id <> p.work_id;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

CREATE OR REPLACE FUNCTION public.create_client_service(_client_id uuid, _name text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE nid uuid; cname text;
BEGIN
  IF NOT public.can_access_client(_client_id) THEN RAISE EXCEPTION 'Sem permissão'; END IF;
  IF coalesce(trim(_name),'') = '' THEN RAISE EXCEPTION 'Informe o nome do serviço'; END IF;
  SELECT name INTO cname FROM clients WHERE id = _client_id;
  INSERT INTO works (name, client_id, client, status, active)
  VALUES (trim(_name), _client_id, cname, 'active', true) RETURNING id INTO nid;
  IF NOT public.can_write() THEN
    INSERT INTO foreman_works (user_id, work_id) VALUES (auth.uid(), nid);
  END IF;
  RETURN nid;
END $$;

REVOKE EXECUTE ON FUNCTION public.move_allocation_service(uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.copy_service_split(uuid, date) FROM anon;
REVOKE EXECUTE ON FUNCTION public.create_client_service(uuid, text) FROM anon;