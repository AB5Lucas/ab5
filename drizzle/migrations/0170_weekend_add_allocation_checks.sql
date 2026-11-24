-- Aba Serviços (weekend_add_allocation), mesma assinatura: antes a inserção de quem estava num quadro do dia era
-- ignorada em silêncio pelo trg_allocation_skips_boxed (a função devolvia nulo e a tela mostrava sucesso).
-- Agora recusa com mensagem clara: quadro do dia, aviso prévio encerrado e agendamento (ASO, treinamento, integração).
CREATE OR REPLACE FUNCTION public.weekend_add_allocation(_work_id uuid, _date date, _collaborator_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE c uuid; sid uuid; aid uuid; other text; pos uuid; who text; nend date; box text; appt text;
BEGIN
  SELECT client_id INTO c FROM works WHERE id = _work_id;
  IF c IS NULL OR NOT public.can_access_client(c) THEN RAISE EXCEPTION 'Sem permissão'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('alloc:' || _collaborator_id::text || ':' || _date::text));
  SELECT full_name, notice_end INTO who, nend FROM collaborators WHERE id = _collaborator_id;
  who := coalesce(who, 'Colaborador');
  IF EXISTS (SELECT 1 FROM days_off WHERE collaborator_id=_collaborator_id AND date<=_date AND coalesce(end_date,date)>=_date)
     OR EXISTS (SELECT 1 FROM vacations WHERE collaborator_id=_collaborator_id AND start_date<=_date AND end_date>=_date)
     OR EXISTS (SELECT 1 FROM medical_leaves WHERE collaborator_id=_collaborator_id AND start_date<=_date AND end_date>=_date) THEN
    RAISE EXCEPTION 'Colaborador ausente (folga, férias ou atestado) neste dia';
  END IF;
  IF nend IS NOT NULL AND _date > nend THEN
    RAISE EXCEPTION '% não pode ser escalado: aviso prévio terminou em %', who, to_char(nend, 'DD/MM/YYYY');
  END IF;
  SELECT CASE a.type WHEN 'aso' THEN 'ASO'
                     WHEN 'treinamento' THEN 'treinamento' || coalesce(' ' || t.name, '')
                     WHEN 'integracao' THEN 'integração' || coalesce(' ' || cl.name, '')
                     ELSE a.type END
    INTO appt
    FROM appointments a LEFT JOIN trainings t ON t.id = a.training_id LEFT JOIN clients cl ON cl.id = a.client_id
   WHERE a.collaborator_id = _collaborator_id AND a.scheduled_date = _date AND a.status IN ('agendado', 'realizado')
   LIMIT 1;
  IF appt IS NOT NULL THEN
    RAISE EXCEPTION '% tem agendamento neste dia (%)', who, appt;
  END IF;
  SELECT id INTO sid FROM daily_schedules WHERE schedule_date = _date;
  IF sid IS NULL THEN
    INSERT INTO daily_schedules(schedule_date, created_by) VALUES (_date, auth.uid())
    ON CONFLICT (schedule_date) DO NOTHING RETURNING id INTO sid;
    IF sid IS NULL THEN SELECT id INTO sid FROM daily_schedules WHERE schedule_date = _date; END IF;
  END IF;
  SELECT CASE WHEN e.box_key LIKE 'integracao:%' THEN 'INTEGRAÇÃO - ' || upper(substr(e.box_key, 12))
              ELSE upper(CASE e.box_key WHEN 'ferias' THEN 'férias' WHEN 'medico' THEN 'médico' WHEN 'licenca' THEN 'licença'
                                        WHEN 'integracao' THEN 'integração' WHEN 'folga' THEN 'folgas' ELSE e.box_key END) END
    INTO box
    FROM daily_status_entries e WHERE e.schedule_id = sid AND e.collaborator_id = _collaborator_id LIMIT 1;
  IF box IS NOT NULL THEN
    RAISE EXCEPTION '% está no quadro % neste dia', who, box;
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
  IF aid IS NULL THEN
    RAISE EXCEPTION '% está num quadro da Programação neste dia', who;
  END IF;
  UPDATE schedule_client_visibility SET visible=true, updated_at=now() WHERE schedule_date=_date AND client_id=c;
  RETURN aid;
END $function$;
