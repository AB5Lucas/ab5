-- RDO: incluir quem está em integração no cliente no dia (agendamento de integração ou quadro integracao:<cliente>).
-- Grava a escolha do serviço (integration_service_choices, a mesma da aba Serviços: 100% do dia nesse serviço e
-- fora do rateio) e já põe a pessoa no efetivo do RDO. RDO Geral não: lá não há um serviço só.
CREATE OR REPLACE FUNCTION public.rdo_add_integration(_rdo_id uuid, _collaborator_id uuid, _entry time, _exit time)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; w record; _cname text; _sid uuid; _pos uuid;
BEGIN
  IF NOT public.can_edit_rdo(_rdo_id) THEN RAISE EXCEPTION 'Sem permissão'; END IF;
  SELECT * INTO r FROM rdos WHERE id = _rdo_id;
  SELECT id, client_id, coalesce(rdo_general, false) AS general INTO w FROM works WHERE id = r.work_id;
  IF w.client_id IS NULL THEN RAISE EXCEPTION 'Serviço sem cliente'; END IF;
  IF w.general THEN RAISE EXCEPTION 'No RDO Geral não dá para escolher o serviço: inclua pelo RDO do serviço'; END IF;
  SELECT name INTO _cname FROM clients WHERE id = w.client_id;
  SELECT id INTO _sid FROM daily_schedules WHERE schedule_date = r.report_date;
  IF NOT EXISTS (SELECT 1 FROM appointments a WHERE a.type = 'integracao' AND a.client_id = w.client_id AND a.scheduled_date = r.report_date
      AND a.collaborator_id = _collaborator_id AND a.status <> 'cancelado')
     AND NOT EXISTS (SELECT 1 FROM daily_status_entries e WHERE e.schedule_id = _sid AND e.collaborator_id = _collaborator_id
      AND e.box_key = 'integracao:' || _cname) THEN
    RAISE EXCEPTION 'Essa pessoa não está em integração neste cliente no dia';
  END IF;
  INSERT INTO integration_service_choices (schedule_date, collaborator_id, client_id, work_id)
  VALUES (r.report_date, _collaborator_id, w.client_id, w.id)
  ON CONFLICT (schedule_date, collaborator_id, client_id) DO UPDATE SET work_id = excluded.work_id;
  SELECT position_id INTO _pos FROM collaborators WHERE id = _collaborator_id;
  INSERT INTO rdo_workforce (rdo_id, work_id, report_date, collaborator_id, position_id, planned, entry_time, exit_time)
  VALUES (_rdo_id, r.work_id, r.report_date, _collaborator_id, _pos, true, _entry, _exit)
  ON CONFLICT (rdo_id, collaborator_id) DO NOTHING;
END $$;
REVOKE EXECUTE ON FUNCTION public.rdo_add_integration(uuid, uuid, time, time) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rdo_add_integration(uuid, uuid, time, time) TO authenticated;
