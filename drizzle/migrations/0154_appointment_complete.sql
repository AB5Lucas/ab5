-- Confirmar realização de agendamento numa transação só (antes: 3 gravações soltas do navegador).
-- Um item da Conferência por agendamento: o índice impede duplicar ao confirmar duas vezes.
-- (Verificado em 24/11/2026: nenhum appointment_id repetido em conference_items.)
CREATE UNIQUE INDEX IF NOT EXISTS conference_items_appointment_key
  ON public.conference_items (appointment_id) WHERE appointment_id IS NOT NULL;

-- Marca o agendamento como realizado (data real), cria o item da Conferência e os aceites por cliente:
-- integração = só o cliente do agendamento; ASO/treinamento = clientes com integração cadastrada ou agendada.
-- Idempotente: se o agendamento já tem item na Conferência, só atualiza a data do documento (se não concluído).
CREATE OR REPLACE FUNCTION public.appointment_complete(_id uuid, _date date, _time time DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $f$
DECLARE
  a public.appointments%ROWTYPE;
  v_item uuid;
  v_integ boolean;
BEGIN
  IF NOT public.can_write() THEN
    RAISE EXCEPTION 'Sem permissão para confirmar agendamentos';
  END IF;
  IF _date IS NULL THEN
    RAISE EXCEPTION 'Informe a data real de realização';
  END IF;
  SELECT * INTO a FROM public.appointments WHERE id = _id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Agendamento não encontrado';
  END IF;
  v_integ := lower(a.type) LIKE 'integ%';
  IF v_integ AND a.client_id IS NULL THEN
    RAISE EXCEPTION 'O agendamento não tem cliente vinculado';
  END IF;

  UPDATE public.appointments
     SET status = 'realizado', completed_date = _date,
         completed_time = coalesce(_time, a.scheduled_time), completed_at = now()
   WHERE id = _id;

  SELECT id INTO v_item FROM public.conference_items WHERE appointment_id = _id;
  IF v_item IS NOT NULL THEN
    UPDATE public.conference_items SET document_date = _date WHERE id = v_item AND status <> 'concluido';
    RETURN v_item;
  END IF;

  INSERT INTO public.conference_items (appointment_id, collaborator_id, type, training_id, client_id, document_date, notes)
  VALUES (_id, a.collaborator_id, a.type, a.training_id, a.client_id, _date, a.notes)
  ON CONFLICT (appointment_id) WHERE appointment_id IS NOT NULL DO NOTHING
  RETURNING id INTO v_item;
  IF v_item IS NULL THEN
    SELECT id INTO v_item FROM public.conference_items WHERE appointment_id = _id;
    RETURN v_item;
  END IF;

  IF v_integ THEN
    INSERT INTO public.conference_checks (item_id, client_id) VALUES (v_item, a.client_id)
    ON CONFLICT (item_id, client_id) DO NOTHING;
  ELSE
    INSERT INTO public.conference_checks (item_id, client_id)
    SELECT DISTINCT v_item, c FROM (
      SELECT client_id AS c FROM public.client_integrations WHERE collaborator_id = a.collaborator_id
      UNION
      SELECT client_id FROM public.appointments
       WHERE collaborator_id = a.collaborator_id AND status = 'agendado' AND client_id IS NOT NULL AND lower(type) LIKE 'integ%'
    ) x WHERE c IS NOT NULL
    ON CONFLICT (item_id, client_id) DO NOTHING;
  END IF;
  RETURN v_item;
END
$f$;
REVOKE ALL ON FUNCTION public.appointment_complete(uuid, date, time) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.appointment_complete(uuid, date, time) TO authenticated;
