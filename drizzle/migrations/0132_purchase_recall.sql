-- SC: o solicitante puxa de volta a SC enviada enquanto não validada, exceto se o validador estiver com ela aberta
-- (validator_open_by/at, renovado a cada 30 s pela tela do validador; vale por 90 s).
ALTER TABLE public.purchase_requests ADD COLUMN IF NOT EXISTS validator_open_by uuid;
ALTER TABLE public.purchase_requests ADD COLUMN IF NOT EXISTS validator_open_at timestamptz;

CREATE OR REPLACE FUNCTION public.purchase_request_validator_open(_id uuid, _open boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r purchase_requests;
BEGIN
  SELECT * INTO r FROM purchase_requests WHERE id = _id;
  IF r.id IS NULL OR r.stage <> 'aprovacao' OR NOT (public.purchase_effective_approver(r) = auth.uid() OR r.approver_id = auth.uid()) THEN RETURN; END IF;
  PERFORM set_config('purchase.rpc', '1', true);
  IF _open THEN
    UPDATE purchase_requests SET validator_open_by = auth.uid(), validator_open_at = now() WHERE id = _id;
  ELSE
    UPDATE purchase_requests SET validator_open_by = NULL, validator_open_at = NULL WHERE id = _id AND validator_open_by = auth.uid();
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.purchase_request_recall(_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r purchase_requests; _who text;
BEGIN
  SELECT * INTO r FROM purchase_requests WHERE id = _id FOR UPDATE;
  IF r.id IS NULL OR r.requester_id <> auth.uid() THEN RAISE EXCEPTION 'Só o solicitante pode puxar a SC de volta'; END IF;
  IF r.stage <> 'aprovacao' THEN RAISE EXCEPTION 'A SC não está aguardando validação'; END IF;
  IF r.validator_open_by IS NOT NULL AND r.validator_open_at > now() - interval '90 seconds' AND r.validator_open_by <> auth.uid() THEN
    SELECT coalesce(full_name, email) INTO _who FROM users_profiles WHERE id = r.validator_open_by;
    RAISE EXCEPTION 'Solicitação bloqueada: está aberta para o validador %', coalesce(_who, '');
  END IF;
  PERFORM set_config('purchase.rpc', '1', true);
  UPDATE purchase_requests SET stage = 'rascunho', sent_at = NULL, approved_at = NULL, return_notes = NULL, returned_by = NULL,
    validator_open_by = NULL, validator_open_at = NULL,
    status = 'EM PREPARAÇÃO', status_at = (now() AT TIME ZONE 'America/Sao_Paulo')::date WHERE id = _id;
END $$;

REVOKE EXECUTE ON FUNCTION public.purchase_request_validator_open(uuid, boolean), public.purchase_request_recall(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.purchase_request_validator_open(uuid, boolean), public.purchase_request_recall(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.purchase_requests_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $function$
BEGIN
  IF coalesce(current_setting('purchase.rpc', true), '') = '1' THEN RETURN NEW; END IF;
  NEW.number := OLD.number; NEW.seq := OLD.seq; NEW.requester_id := OLD.requester_id; NEW.requester_name := OLD.requester_name;
  NEW.request_date := OLD.request_date; NEW.stage := OLD.stage; NEW.sent_at := OLD.sent_at; NEW.approver_id := OLD.approver_id;
  NEW.approved_at := OLD.approved_at; NEW.approver_notes := OLD.approver_notes; NEW.status := OLD.status;
  NEW.status_at := OLD.status_at; NEW.buyer_notes := OLD.buyer_notes; NEW.approver_collab_id := OLD.approver_collab_id;
  NEW.substitute_id := OLD.substitute_id; NEW.decided_by := OLD.decided_by; NEW.cancelled_at := OLD.cancelled_at;
  NEW.return_notes := OLD.return_notes; NEW.returned_by := OLD.returned_by; NEW.system := OLD.system;
  NEW.validator_open_by := OLD.validator_open_by; NEW.validator_open_at := OLD.validator_open_at;
  RETURN NEW;
END $function$;
