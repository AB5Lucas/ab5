CREATE OR REPLACE FUNCTION public.rdo_add_worker(_rdo_id uuid, _collaborator_id uuid, _position_id uuid, _entry time, _exit time)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; sid uuid; aid uuid; cid uuid; prev date; wd int;
BEGIN
  IF NOT public.can_edit_rdo(_rdo_id) THEN RAISE EXCEPTION 'Sem permissão'; END IF;
  SELECT * INTO r FROM rdos WHERE id = _rdo_id;
  wd := extract(dow from r.report_date);
  IF NOT public.can_write() AND wd NOT IN (0,6) AND NOT EXISTS (SELECT 1 FROM holidays WHERE date = r.report_date) THEN
    RAISE EXCEPTION 'Encarregado só adiciona colaboradores em finais de semana e feriados';
  END IF;
  SELECT id INTO sid FROM daily_schedules WHERE schedule_date = r.report_date;
  IF sid IS NULL THEN
    INSERT INTO daily_schedules(schedule_date, created_by) VALUES (r.report_date, auth.uid()) RETURNING id INTO sid;
  END IF;
  SELECT id INTO aid FROM daily_allocations WHERE schedule_id = sid AND work_id = r.work_id AND collaborator_id = _collaborator_id LIMIT 1;
  IF aid IS NULL THEN
    INSERT INTO daily_allocations(schedule_id, work_id, collaborator_id, position_id, source)
    VALUES (sid, r.work_id, _collaborator_id, _position_id, 'manual') RETURNING id INTO aid;
  END IF;
  UPDATE rdos SET schedule_id = sid WHERE id = _rdo_id AND schedule_id IS NULL;
  INSERT INTO rdo_workforce(rdo_id, work_id, report_date, collaborator_id, allocation_id, position_id, planned, entry_time, exit_time)
  VALUES (_rdo_id, r.work_id, r.report_date, _collaborator_id, aid, _position_id, true, _entry, _exit)
  ON CONFLICT (rdo_id, collaborator_id) DO NOTHING;
  -- Reexibe o cliente na programação do dia
  SELECT client_id INTO cid FROM works WHERE id = r.work_id;
  IF cid IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM schedule_client_visibility WHERE schedule_date = r.report_date) AND wd NOT IN (0,6) THEN
      SELECT max(schedule_date) INTO prev FROM schedule_client_visibility WHERE schedule_date < r.report_date;
      IF prev IS NOT NULL THEN
        INSERT INTO schedule_client_visibility(schedule_date, client_id, visible)
        SELECT r.report_date, client_id, visible FROM schedule_client_visibility WHERE schedule_date = prev;
      END IF;
    END IF;
    UPDATE schedule_client_visibility SET visible = true, updated_at = now() WHERE schedule_date = r.report_date AND client_id = cid;
    IF NOT FOUND THEN
      INSERT INTO schedule_client_visibility(schedule_date, client_id, visible) VALUES (r.report_date, cid, true);
    END IF;
  END IF;
END $$;
REVOKE EXECUTE ON FUNCTION public.rdo_add_worker(uuid, uuid, uuid, time, time) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.rdo_add_worker(uuid, uuid, uuid, time, time) TO authenticated;