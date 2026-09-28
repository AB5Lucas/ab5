CREATE OR REPLACE FUNCTION public.rdo_report_absence(_wf_id uuid, _reason text, _note text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE w record; sid uuid;
BEGIN
  SELECT * INTO w FROM public.rdo_workforce WHERE id = _wf_id;
  IF w IS NULL OR NOT public.can_edit_rdo(w.rdo_id) THEN RAISE EXCEPTION 'Sem permissão'; END IF;
  IF _reason NOT IN ('falta','atestado','medico','interjornada','outro') THEN RAISE EXCEPTION 'Motivo inválido'; END IF;
  IF _reason = 'outro' THEN
    UPDATE public.rdo_workforce SET present=false, reported_reason=_reason, reported_note=_note, occurrence_status='pending' WHERE id=_wf_id;
    RETURN;
  END IF;
  SELECT id INTO sid FROM public.daily_schedules WHERE schedule_date = w.report_date;
  IF sid IS NULL THEN
    INSERT INTO public.daily_schedules (schedule_date) VALUES (w.report_date) RETURNING id INTO sid;
  END IF;
  DELETE FROM public.daily_allocations WHERE schedule_id=sid AND collaborator_id=w.collaborator_id AND work_id=w.work_id;
  INSERT INTO public.daily_status_entries (schedule_id, collaborator_id, box_key, sort_order)
  VALUES (sid, w.collaborator_id, _reason, extract(epoch from now())/1e10)
  ON CONFLICT (schedule_id, collaborator_id) DO UPDATE SET box_key = EXCLUDED.box_key;
  UPDATE public.rdo_workforce SET present=false, reported_reason=_reason, reported_note=_note,
    occurrence_status='classified', final_classification=_reason, classified_by=auth.uid(), classified_at=now()
  WHERE id=_wf_id;
END; $$;
REVOKE EXECUTE ON FUNCTION public.rdo_report_absence(uuid,text,text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.rdo_report_absence(uuid,text,text) TO authenticated;