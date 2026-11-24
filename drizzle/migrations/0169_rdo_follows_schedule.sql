-- RDO acompanha a Programação no banco: o efetivo (rdo_workforce) dos RDOs em RASCUNHO é sincronizado a cada
-- alteração de daily_allocations, com a mesma regra do useEffect do rdo-editor.tsx (que continua como reserva):
--  * planejados = escalados no serviço (no RDO Geral, em qualquer serviço do cliente) menos quem está de folga,
--    férias, atestado, com agendamento no dia ou em quadro de treinamento/integração; mais quem está em integração
--    no cliente e foi lançado neste serviço na aba Serviços (integration_service_choices) e segue em integração;
--  * entra quem é planejado e não está no efetivo (função = última usada no RDO do serviço, senão a da escala,
--    senão a do cadastro; horário padrão do serviço/turno);
--  * sai a linha planejada de quem deixou de ser planejado se estava presente sem ocorrência, ou se está bloqueado
--    (ausência/agendamento/quadro). Linha com ausência informada ou classificada fica.
-- RDO finalizado não muda (vira aviso na Programação).
CREATE OR REPLACE FUNCTION public.rdo_sync_workforce(_rdo_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  r record; w record; sid uuid; scope uuid[]; cname text; ent time; ext time; wd int;
  v_integ uuid[]; v_blocked uuid[]; v_planned uuid[];
BEGIN
  SELECT id, work_id, report_date, status, shift INTO r FROM public.rdos WHERE id = _rdo_id;
  IF r.id IS NULL OR r.status <> 'draft' THEN RETURN; END IF;
  SELECT id, client_id, rdo_general, entry_time, exit_time, exit_time_weekend INTO w FROM public.works WHERE id = r.work_id;
  IF w.id IS NULL THEN RETURN; END IF;
  IF coalesce(w.rdo_general, false) AND w.client_id IS NOT NULL THEN
    SELECT array_agg(id) INTO scope FROM public.works WHERE client_id = w.client_id;
  ELSE
    scope := ARRAY[w.id];
  END IF;
  SELECT id INTO sid FROM public.daily_schedules WHERE schedule_date = r.report_date;
  SELECT name INTO cname FROM public.clients WHERE id = w.client_id;
  IF r.shift = 'night' THEN
    ent := '21:30'; ext := '05:30';
  ELSE
    wd := extract(dow FROM r.report_date)::int;
    ent := coalesce(w.entry_time, '07:00');
    ext := coalesce(CASE WHEN wd IN (0, 5, 6) AND w.exit_time_weekend IS NOT NULL THEN w.exit_time_weekend ELSE w.exit_time END, '17:00');
  END IF;

  -- Integração lançada num serviço do escopo e ainda em integração no cliente no dia.
  v_integ := ARRAY(
    SELECT DISTINCT isc.collaborator_id FROM public.integration_service_choices isc
     WHERE w.client_id IS NOT NULL AND isc.schedule_date = r.report_date AND isc.work_id = ANY(scope)
       AND (EXISTS (SELECT 1 FROM public.appointments ap WHERE ap.type = 'integracao' AND ap.client_id = w.client_id
                     AND ap.scheduled_date = r.report_date AND ap.status <> 'cancelado' AND ap.collaborator_id = isc.collaborator_id)
            OR (sid IS NOT NULL AND cname IS NOT NULL AND EXISTS (SELECT 1 FROM public.daily_status_entries e
                     WHERE e.schedule_id = sid AND e.box_key = 'integracao:' || cname AND e.collaborator_id = isc.collaborator_id))));

  -- Escalados com ausência, agendamento ou quadro de treinamento/integração no dia não entram (a ausência prevalece).
  v_blocked := ARRAY(
    SELECT DISTINCT a.collaborator_id FROM public.daily_allocations a
     WHERE sid IS NOT NULL AND a.schedule_id = sid AND a.work_id = ANY(scope)
       AND (EXISTS (SELECT 1 FROM public.days_off o WHERE o.collaborator_id = a.collaborator_id AND o.date <= r.report_date
                      AND coalesce(o.end_date, o.date) >= r.report_date)
         OR EXISTS (SELECT 1 FROM public.vacations v WHERE v.collaborator_id = a.collaborator_id AND v.start_date <= r.report_date
                      AND v.end_date >= r.report_date AND v.status <> 'cancelled')
         OR EXISTS (SELECT 1 FROM public.medical_leaves m WHERE m.collaborator_id = a.collaborator_id AND m.start_date <= r.report_date
                      AND m.end_date >= r.report_date)
         OR (NOT (a.collaborator_id = ANY(v_integ)) AND (
              EXISTS (SELECT 1 FROM public.appointments ap WHERE ap.collaborator_id = a.collaborator_id
                        AND ap.scheduled_date = r.report_date AND ap.status IN ('agendado', 'realizado'))
           OR EXISTS (SELECT 1 FROM public.daily_status_entries e WHERE e.schedule_id = sid AND e.collaborator_id = a.collaborator_id
                        AND (e.box_key = 'treinamento' OR e.box_key LIKE 'integracao%'))))));

  v_planned := ARRAY(
    SELECT a.collaborator_id FROM public.daily_allocations a
     WHERE sid IS NOT NULL AND a.schedule_id = sid AND a.work_id = ANY(scope) AND NOT (a.collaborator_id = ANY(v_blocked))
  ) || v_integ;

  -- Entra quem é planejado e ainda não está no efetivo.
  INSERT INTO public.rdo_workforce (rdo_id, work_id, report_date, collaborator_id, allocation_id, position_id, planned, entry_time, exit_time)
  SELECT r.id, r.work_id, r.report_date, p.collaborator_id, p.allocation_id,
         coalesce(
           (SELECT rw.position_id FROM public.rdo_workforce rw
             WHERE rw.work_id = r.work_id AND rw.collaborator_id = p.collaborator_id AND rw.report_date < r.report_date
               AND rw.position_id IS NOT NULL ORDER BY rw.report_date DESC LIMIT 1),
           p.position_id,
           (SELECT c.position_id FROM public.collaborators c WHERE c.id = p.collaborator_id)),
         true, ent, ext
    FROM (
      SELECT DISTINCT ON (a.collaborator_id) a.collaborator_id, a.id AS allocation_id, a.position_id
        FROM public.daily_allocations a
       WHERE sid IS NOT NULL AND a.schedule_id = sid AND a.work_id = ANY(scope) AND NOT (a.collaborator_id = ANY(v_blocked))
       ORDER BY a.collaborator_id, a.created_at DESC
    ) p
   WHERE NOT EXISTS (SELECT 1 FROM public.rdo_workforce x WHERE x.rdo_id = r.id AND x.collaborator_id = p.collaborator_id)
  ON CONFLICT (rdo_id, collaborator_id) DO NOTHING;
  INSERT INTO public.rdo_workforce (rdo_id, work_id, report_date, collaborator_id, allocation_id, position_id, planned, entry_time, exit_time)
  SELECT r.id, r.work_id, r.report_date, i.cid, NULL,
         coalesce(
           (SELECT rw.position_id FROM public.rdo_workforce rw
             WHERE rw.work_id = r.work_id AND rw.collaborator_id = i.cid AND rw.report_date < r.report_date
               AND rw.position_id IS NOT NULL ORDER BY rw.report_date DESC LIMIT 1),
           (SELECT c.position_id FROM public.collaborators c WHERE c.id = i.cid)),
         true, ent, ext
    FROM unnest(v_integ) AS i(cid)
   WHERE NOT EXISTS (SELECT 1 FROM public.rdo_workforce x WHERE x.rdo_id = r.id AND x.collaborator_id = i.cid)
  ON CONFLICT (rdo_id, collaborator_id) DO NOTHING;

  -- Sai quem deixou de ser planejado (presente sem ocorrência) ou está bloqueado no dia.
  DELETE FROM public.rdo_workforce x
   WHERE x.rdo_id = r.id AND x.planned
     AND NOT (x.collaborator_id = ANY(v_planned))
     AND ((x.present AND x.occurrence_status = 'none') OR x.collaborator_id = ANY(v_blocked));
END $function$;

-- RDOs em rascunho afetados por alterações de alocação (serviço + dia; RDO Geral do cliente do serviço).
CREATE OR REPLACE FUNCTION public.rdo_sync_changed(_pairs jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE x record;
BEGIN
  IF _pairs IS NULL OR jsonb_array_length(_pairs) = 0 THEN RETURN; END IF;
  FOR x IN
    SELECT DISTINCT r.id
      FROM jsonb_to_recordset(_pairs) AS p(s uuid, w uuid)
      JOIN public.daily_schedules ds ON ds.id = p.s
      JOIN public.works pw ON pw.id = p.w
      JOIN public.rdos r ON r.report_date = ds.schedule_date AND r.status = 'draft'
      JOIN public.works rw ON rw.id = r.work_id
     WHERE r.work_id = p.w OR (coalesce(rw.rdo_general, false) AND rw.client_id IS NOT NULL AND rw.client_id = pw.client_id)
  LOOP
    PERFORM public.rdo_sync_workforce(x.id);
  END LOOP;
END $function$;

CREATE OR REPLACE FUNCTION public.rdo_sync_after_alloc_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  PERFORM public.rdo_sync_changed((SELECT jsonb_agg(DISTINCT jsonb_build_object('s', schedule_id, 'w', work_id)) FROM new_rows));
  RETURN NULL;
END $function$;

CREATE OR REPLACE FUNCTION public.rdo_sync_after_alloc_delete()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  PERFORM public.rdo_sync_changed((SELECT jsonb_agg(DISTINCT jsonb_build_object('s', schedule_id, 'w', work_id)) FROM old_rows));
  RETURN NULL;
END $function$;

CREATE OR REPLACE FUNCTION public.rdo_sync_after_alloc_update()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  PERFORM public.rdo_sync_changed((
    SELECT jsonb_agg(DISTINCT x) FROM (
      SELECT jsonb_build_object('s', o.schedule_id, 'w', o.work_id) AS x
        FROM old_rows o JOIN new_rows n ON n.id = o.id
       WHERE o.work_id IS DISTINCT FROM n.work_id OR o.schedule_id IS DISTINCT FROM n.schedule_id OR o.collaborator_id IS DISTINCT FROM n.collaborator_id
      UNION ALL
      SELECT jsonb_build_object('s', n.schedule_id, 'w', n.work_id)
        FROM old_rows o JOIN new_rows n ON n.id = o.id
       WHERE o.work_id IS DISTINCT FROM n.work_id OR o.schedule_id IS DISTINCT FROM n.schedule_id OR o.collaborator_id IS DISTINCT FROM n.collaborator_id
    ) t));
  RETURN NULL;
END $function$;

DROP TRIGGER IF EXISTS trg_rdo_sync_alloc_insert ON public.daily_allocations;
DROP TRIGGER IF EXISTS trg_rdo_sync_alloc_delete ON public.daily_allocations;
DROP TRIGGER IF EXISTS trg_rdo_sync_alloc_update ON public.daily_allocations;
CREATE TRIGGER trg_rdo_sync_alloc_insert AFTER INSERT ON public.daily_allocations
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.rdo_sync_after_alloc_insert();
CREATE TRIGGER trg_rdo_sync_alloc_delete AFTER DELETE ON public.daily_allocations
  REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION public.rdo_sync_after_alloc_delete();
CREATE TRIGGER trg_rdo_sync_alloc_update AFTER UPDATE ON public.daily_allocations
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION public.rdo_sync_after_alloc_update();

REVOKE ALL ON FUNCTION public.rdo_sync_workforce(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.rdo_sync_changed(jsonb) FROM anon;
