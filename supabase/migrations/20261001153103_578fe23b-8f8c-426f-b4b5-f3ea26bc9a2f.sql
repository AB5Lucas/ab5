ALTER TABLE public.daily_allocations ADD COLUMN IF NOT EXISTS service_assigned boolean NOT NULL DEFAULT false;

CREATE TABLE public.service_display_prefs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  hidden_work_ids uuid[] NOT NULL DEFAULT '{}',
  work_order uuid[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, client_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.service_display_prefs TO authenticated;
GRANT ALL ON public.service_display_prefs TO service_role;
ALTER TABLE public.service_display_prefs ENABLE ROW LEVEL SECURITY;
CREATE POLICY sdp_own ON public.service_display_prefs FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE TABLE public.transport_passengers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_date date NOT NULL,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  vehicle_schedule_id uuid REFERENCES public.vehicle_schedules(id) ON DELETE CASCADE,
  collaborator_id uuid NOT NULL REFERENCES public.collaborators(id) ON DELETE CASCADE,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (schedule_date, client_id, collaborator_id)
);
GRANT SELECT ON public.transport_passengers TO authenticated;
GRANT ALL ON public.transport_passengers TO service_role;
ALTER TABLE public.transport_passengers ENABLE ROW LEVEL SECURITY;
CREATE POLICY tp_select ON public.transport_passengers FOR SELECT TO authenticated USING (public.can_access_client(client_id));

CREATE OR REPLACE FUNCTION public.move_allocation_service(_alloc_id uuid, _work_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a record; oc uuid; nc uuid;
BEGIN
  SELECT * INTO a FROM daily_allocations WHERE id = _alloc_id;
  IF a IS NULL THEN RAISE EXCEPTION 'Alocação não encontrada'; END IF;
  SELECT client_id INTO oc FROM works WHERE id = a.work_id;
  SELECT client_id INTO nc FROM works WHERE id = _work_id;
  IF oc IS NULL OR oc IS DISTINCT FROM nc THEN RAISE EXCEPTION 'Serviço de outro cliente'; END IF;
  IF NOT public.can_access_client(nc) THEN RAISE EXCEPTION 'Sem permissão'; END IF;
  UPDATE daily_allocations SET work_id = _work_id, service_assigned = true WHERE id = _alloc_id;
END $$;

CREATE OR REPLACE FUNCTION public.unassign_allocation_service(_alloc_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c uuid;
BEGIN
  SELECT w.client_id INTO c FROM daily_allocations a JOIN works w ON w.id = a.work_id WHERE a.id = _alloc_id;
  IF c IS NULL OR NOT public.can_access_client(c) THEN RAISE EXCEPTION 'Sem permissão'; END IF;
  UPDATE daily_allocations SET service_assigned = false WHERE id = _alloc_id;
END $$;

CREATE OR REPLACE FUNCTION public.copy_service_split(_client_id uuid, _date date)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE prev date; wd int; n int := 0; sid uuid; psid uuid;
BEGIN
  IF NOT public.can_access_client(_client_id) THEN RAISE EXCEPTION 'Sem permissão'; END IF;
  wd := extract(dow from _date);
  prev := _date - CASE WHEN wd = 1 THEN 3 ELSE 1 END;
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

-- _vs_id NULL = Próprio; _remove = tirar do transporte
CREATE OR REPLACE FUNCTION public.set_transport_passenger(_date date, _client_id uuid, _vs_id uuid, _collaborator_id uuid, _remove boolean DEFAULT false)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE sid uuid;
BEGIN
  IF NOT public.can_access_client(_client_id) THEN RAISE EXCEPTION 'Sem permissão'; END IF;
  SELECT id INTO sid FROM daily_schedules WHERE schedule_date = _date;
  IF _remove THEN
    DELETE FROM transport_passengers WHERE schedule_date = _date AND client_id = _client_id AND collaborator_id = _collaborator_id;
  ELSE
    INSERT INTO transport_passengers (schedule_date, client_id, vehicle_schedule_id, collaborator_id)
    VALUES (_date, _client_id, _vs_id, _collaborator_id)
    ON CONFLICT (schedule_date, client_id, collaborator_id) DO UPDATE SET vehicle_schedule_id = EXCLUDED.vehicle_schedule_id;
  END IF;
  IF sid IS NOT NULL THEN
    UPDATE daily_allocations a SET vt_override = CASE WHEN NOT _remove AND _vs_id IS NULL THEN true ELSE NULL END
    FROM works w WHERE a.schedule_id = sid AND a.collaborator_id = _collaborator_id AND w.id = a.work_id AND w.client_id = _client_id;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.set_vehicle_driver(_vs_id uuid, _driver_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c uuid;
BEGIN
  SELECT client_id INTO c FROM vehicle_schedules WHERE id = _vs_id;
  IF c IS NULL OR NOT public.can_access_client(c) THEN RAISE EXCEPTION 'Sem permissão'; END IF;
  UPDATE vehicle_schedules SET driver_id = _driver_id, updated_at = now() WHERE id = _vs_id;
  DELETE FROM transport_passengers tp USING vehicle_schedules v
    WHERE v.id = _vs_id AND tp.schedule_date = v.schedule_date AND tp.client_id = c AND tp.collaborator_id = _driver_id;
END $$;

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
        AND (client_id = _client_id OR _client_id = ANY(extra_client_ids))
        AND driver_id IS DISTINCT FROM r.collaborator_id LIMIT 1;
      IF vs IS NULL THEN CONTINUE; END IF;
    END IF;
    PERFORM public.set_transport_passenger(_date, _client_id, vs, r.collaborator_id, false);
    n := n + 1;
  END LOOP;
  RETURN n;
END $$;