CREATE OR REPLACE FUNCTION public.rdo_undo_absence(_wf_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE w record; sid uuid; aid uuid;
BEGIN
  SELECT * INTO w FROM public.rdo_workforce WHERE id = _wf_id;
  IF w IS NULL OR NOT public.can_edit_rdo(w.rdo_id) THEN RAISE EXCEPTION 'Sem permissão'; END IF;
  SELECT id INTO sid FROM public.daily_schedules WHERE schedule_date = w.report_date;
  IF sid IS NOT NULL AND w.final_classification IS NOT NULL THEN
    DELETE FROM public.daily_status_entries
     WHERE schedule_id = sid AND collaborator_id = w.collaborator_id AND box_key = w.final_classification;
  END IF;
  IF w.planned THEN
    IF sid IS NULL THEN
      INSERT INTO public.daily_schedules (schedule_date) VALUES (w.report_date) RETURNING id INTO sid;
    END IF;
    SELECT id INTO aid FROM public.daily_allocations WHERE schedule_id=sid AND collaborator_id=w.collaborator_id AND work_id=w.work_id;
    IF aid IS NULL THEN
      INSERT INTO public.daily_allocations (schedule_id, work_id, collaborator_id, position_id, source)
      VALUES (sid, w.work_id, w.collaborator_id, w.position_id, 'manual') RETURNING id INTO aid;
    END IF;
  END IF;
  UPDATE public.rdo_workforce SET present=true, reported_reason=null, reported_note=null,
    occurrence_status='none', final_classification=null, classified_by=null, classified_at=null,
    allocation_id=COALESCE(aid, allocation_id)
  WHERE id=_wf_id;
END; $$;
REVOKE EXECUTE ON FUNCTION public.rdo_undo_absence(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.rdo_undo_absence(uuid) TO authenticated;