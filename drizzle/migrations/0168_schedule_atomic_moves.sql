-- Gravações em várias etapas viram uma transação só (antes, uma falha no meio deixava a pessoa sem obra e sem quadro).

-- Classificar ocorrência do RDO: tira da obra, põe no quadro da classificação e marca o RDO, tudo junto.
-- SECURITY INVOKER: valem as mesmas permissões (RLS) das gravações que a tela fazia uma a uma.
CREATE OR REPLACE FUNCTION public.classify_occurrence(_workforce_id uuid, _key text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $function$
DECLARE o record; sid uuid;
BEGIN
  SELECT id, work_id, report_date, collaborator_id INTO o FROM public.rdo_workforce WHERE id = _workforce_id;
  IF o.id IS NULL THEN RAISE EXCEPTION 'Ocorrência não encontrada'; END IF;
  sid := public.ensure_schedule(o.report_date);
  DELETE FROM public.daily_allocations
   WHERE schedule_id = sid AND collaborator_id = o.collaborator_id AND work_id = o.work_id;
  INSERT INTO public.daily_status_entries (schedule_id, collaborator_id, box_key, sort_order)
  VALUES (sid, o.collaborator_id, _key, (extract(epoch FROM now()) * 1000) / 1e10)
  ON CONFLICT (schedule_id, collaborator_id) DO UPDATE SET box_key = excluded.box_key, sort_order = excluded.sort_order;
  UPDATE public.rdo_workforce
     SET final_classification = _key, occurrence_status = 'classified', classified_by = auth.uid(), classified_at = now()
   WHERE id = _workforce_id;
  RETURN sid;
END $function$;

-- Arrastar de um quadro (folga, treinamento…) para uma obra: sai do quadro e entra na obra na mesma transação.
-- Ao mudar de obra, VT e prêmio viagem voltam à regra da obra nova (como no arrastar comum).
CREATE OR REPLACE FUNCTION public.schedule_entry_to_work(_entry_id uuid, _work_id uuid, _sort integer, _pending boolean)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $function$
DECLARE e record; aid uuid; oldw uuid; pos uuid;
BEGIN
  SELECT id, schedule_id, collaborator_id INTO e FROM public.daily_status_entries WHERE id = _entry_id;
  IF e.id IS NULL THEN
    RAISE EXCEPTION 'A pessoa já saiu deste quadro (outro usuário alterou o dia)' USING ERRCODE = '23505';
  END IF;
  DELETE FROM public.daily_status_entries WHERE id = _entry_id;
  SELECT id, work_id INTO aid, oldw FROM public.daily_allocations
   WHERE schedule_id = e.schedule_id AND collaborator_id = e.collaborator_id;
  IF aid IS NOT NULL THEN
    UPDATE public.daily_allocations
       SET work_id = _work_id, sort_order = _sort, has_pending_requirement = _pending,
           vt_override = CASE WHEN oldw IS DISTINCT FROM _work_id THEN NULL ELSE vt_override END,
           travel_bonus_override = CASE WHEN oldw IS DISTINCT FROM _work_id THEN NULL ELSE travel_bonus_override END
     WHERE id = aid;
  ELSE
    SELECT position_id INTO pos FROM public.collaborators WHERE id = e.collaborator_id;
    INSERT INTO public.daily_allocations
      (schedule_id, work_id, collaborator_id, position_id, driver, source, confirmation_status, has_pending_requirement, sort_order)
    VALUES (e.schedule_id, _work_id, e.collaborator_id, pos, false, 'manual', 'pending', _pending, _sort)
    RETURNING id INTO aid;
    IF aid IS NULL THEN RAISE EXCEPTION 'Não foi possível escalar: a pessoa está em outro quadro neste dia'; END IF;
  END IF;
  RETURN aid;
END $function$;

REVOKE ALL ON FUNCTION public.classify_occurrence(uuid, text) FROM anon;
REVOKE ALL ON FUNCTION public.schedule_entry_to_work(uuid, uuid, integer, boolean) FROM anon;
