-- Compras: aprovador = gestor do cliente da SC (works.manager_id, colaborador ligado ao usuário pelo nome).
-- Por solicitante (aba Aprovadores): precisa de aprovador (padrão sim; não = vai direto para Compras), aprova as
-- próprias (ex.: Vitória Brasilino) e substituto, que recebe as SCs enquanto o gestor está de férias (Programação).
-- SC não enviada pode ser apagada; enviada pode ser cancelada.

ALTER TABLE public.purchase_approvers
  ALTER COLUMN approver_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS needs_approval boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS self_approve boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS substitute_id uuid REFERENCES public.users_profiles(id) ON DELETE SET NULL;
ALTER TABLE public.purchase_approvers DROP CONSTRAINT IF EXISTS purchase_approvers_check;

ALTER TABLE public.purchase_requests
  ADD COLUMN IF NOT EXISTS approver_collab_id uuid REFERENCES public.collaborators(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS substitute_id uuid,
  ADD COLUMN IF NOT EXISTS decided_by uuid,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;
ALTER TABLE public.purchase_requests DROP CONSTRAINT IF EXISTS purchase_requests_stage_check;
ALTER TABLE public.purchase_requests ADD CONSTRAINT purchase_requests_stage_check CHECK (stage IN ('rascunho', 'aprovacao', 'compras', 'cancelada'));

-- Usuário do sistema de um colaborador: mesmo primeiro nome e todas as palavras do usuário no nome do colaborador
-- (ex.: "Sidney Pestana" ↔ "Sidney Pestana Bispo"); só se um único usuário ativo combinar.
CREATE OR REPLACE FUNCTION public.purchase_user_of_collaborator(_collab uuid) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH c AS (SELECT regexp_split_to_array(trim(translate(upper(full_name), 'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ', 'AAAAAEEEEIIIIOOOOOUUUUC')), '\s+') w FROM collaborators WHERE id = _collab),
  u AS (SELECT up.id, regexp_split_to_array(trim(translate(upper(up.full_name), 'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ', 'AAAAAEEEEIIIIOOOOOUUUUC')), '\s+') w
        FROM users_profiles up WHERE up.active AND coalesce(trim(up.full_name), '') <> ''),
  hit AS (SELECT u.id FROM u, c WHERE u.w[1] = c.w[1] AND u.w <@ c.w)
  SELECT CASE WHEN (SELECT count(*) FROM hit) = 1 THEN (SELECT id FROM hit) END
$$;

-- Gestor do cliente: o gestor mais frequente nos serviços ativos do cliente.
CREATE OR REPLACE FUNCTION public.purchase_client_manager(_client uuid) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT manager_id FROM works WHERE client_id = _client AND active AND manager_id IS NOT NULL
  GROUP BY manager_id ORDER BY count(*) DESC, manager_id LIMIT 1
$$;

-- Aprovador da vez: o substituto enquanto o gestor está de férias hoje; senão o aprovador gravado no envio.
CREATE OR REPLACE FUNCTION public.purchase_effective_approver(_r public.purchase_requests) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN _r.substitute_id IS NOT NULL AND _r.approver_collab_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM vacations v WHERE v.collaborator_id = _r.approver_collab_id
        AND v.start_date <= (now() AT TIME ZONE 'America/Sao_Paulo')::date AND v.end_date >= (now() AT TIME ZONE 'America/Sao_Paulo')::date
        AND coalesce(v.status, '') NOT ILIKE 'cancel%')
    THEN _r.substitute_id ELSE _r.approver_id END
$$;

CREATE OR REPLACE FUNCTION public.purchase_can_see(_r public.purchase_requests) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _r.requester_id = auth.uid() OR _r.approver_id = auth.uid() OR _r.decided_by = auth.uid()
    OR public.purchase_effective_approver(_r) = auth.uid()
    OR (_r.stage = 'compras' AND public.purchase_is_buyer()) OR public.has_role(auth.uid(), 'admin')
$$;

CREATE OR REPLACE FUNCTION public.purchase_requests_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF coalesce(current_setting('purchase.rpc', true), '') = '1' THEN RETURN NEW; END IF;
  NEW.number := OLD.number; NEW.seq := OLD.seq; NEW.requester_id := OLD.requester_id; NEW.requester_name := OLD.requester_name;
  NEW.request_date := OLD.request_date; NEW.stage := OLD.stage; NEW.sent_at := OLD.sent_at; NEW.approver_id := OLD.approver_id;
  NEW.approved_at := OLD.approved_at; NEW.approver_notes := OLD.approver_notes; NEW.status := OLD.status;
  NEW.status_at := OLD.status_at; NEW.buyer_notes := OLD.buyer_notes; NEW.approver_collab_id := OLD.approver_collab_id;
  NEW.substitute_id := OLD.substitute_id; NEW.decided_by := OLD.decided_by; NEW.cancelled_at := OLD.cancelled_at;
  RETURN NEW;
END $$;

DROP FUNCTION IF EXISTS public.purchase_request_send(uuid);
CREATE OR REPLACE FUNCTION public.purchase_request_send(_id uuid) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r purchase_requests; cfg purchase_approvers; _items int; _missing int; _collab uuid; _appr uuid; _today date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  SELECT * INTO r FROM purchase_requests WHERE id = _id FOR UPDATE;
  IF r.id IS NULL OR r.requester_id <> auth.uid() THEN RAISE EXCEPTION 'Solicitação não encontrada'; END IF;
  IF r.stage <> 'rascunho' THEN RAISE EXCEPTION 'Esta solicitação já foi enviada'; END IF;
  SELECT count(*), count(*) FILTER (WHERE coalesce(budget, 0) <= 0) INTO _items, _missing FROM purchase_request_items WHERE request_id = _id;
  IF _items = 0 THEN RAISE EXCEPTION 'Inclua ao menos um item'; END IF;
  IF upper(r.nature) <> 'PROGRAMADA' AND coalesce(r.total_budget, 0) <= 0 AND _missing > 0 THEN
    RAISE EXCEPTION 'Informe a verba de cada item ou a verba total';
  END IF;
  SELECT * INTO cfg FROM purchase_approvers WHERE requester_id = r.requester_id;
  PERFORM set_config('purchase.rpc', '1', true);
  IF cfg.requester_id IS NOT NULL AND NOT cfg.needs_approval THEN
    UPDATE purchase_requests SET stage = 'compras', sent_at = now(), approved_at = now(), approver_id = NULL, approver_collab_id = NULL,
      substitute_id = NULL, decided_by = NULL, approver_notes = 'Sem aprovação (solicitante liberado)', status = 'SOLICITAÇÃO ENVIADA', status_at = _today WHERE id = _id;
    RETURN 'compras';
  END IF;
  IF coalesce(cfg.self_approve, false) THEN
    _appr := r.requester_id; _collab := NULL;
  ELSE
    _collab := public.purchase_client_manager(r.client_id);
    IF _collab IS NULL THEN RAISE EXCEPTION 'O cliente desta SC não tem gestor cadastrado nos serviços (Clientes › Serviços)'; END IF;
    _appr := public.purchase_user_of_collaborator(_collab);
    IF _appr IS NULL THEN _appr := cfg.substitute_id; END IF;
    IF _appr IS NULL THEN
      RAISE EXCEPTION 'O gestor % não tem usuário no sistema; cadastre um substituto em Compras › Comprador › Aprovadores',
        (SELECT full_name FROM collaborators WHERE id = _collab);
    END IF;
  END IF;
  UPDATE purchase_requests SET stage = 'aprovacao', sent_at = now(), approver_id = _appr, approver_collab_id = _collab,
    substitute_id = CASE WHEN cfg.substitute_id = _appr THEN NULL ELSE cfg.substitute_id END, decided_by = NULL, approver_notes = NULL,
    status = 'SOLICITAÇÃO ENVIADA', status_at = _today WHERE id = _id;
  RETURN 'aprovacao';
END $$;

CREATE OR REPLACE FUNCTION public.purchase_request_decide(_id uuid, _approve boolean, _notes text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r purchase_requests;
BEGIN
  SELECT * INTO r FROM purchase_requests WHERE id = _id FOR UPDATE;
  IF r.id IS NULL OR NOT (public.purchase_effective_approver(r) = auth.uid() OR r.approver_id = auth.uid() OR public.has_role(auth.uid(), 'admin')) THEN
    RAISE EXCEPTION 'Você não é o aprovador desta solicitação';
  END IF;
  IF r.stage <> 'aprovacao' THEN RAISE EXCEPTION 'Esta solicitação não está aguardando aprovação'; END IF;
  IF NOT _approve AND coalesce(trim(_notes), '') = '' THEN RAISE EXCEPTION 'Escreva o motivo da devolução'; END IF;
  PERFORM set_config('purchase.rpc', '1', true);
  IF _approve THEN
    UPDATE purchase_requests SET stage = 'compras', approved_at = now(), decided_by = auth.uid(), approver_notes = nullif(trim(_notes), '') WHERE id = _id;
  ELSE
    UPDATE purchase_requests SET stage = 'rascunho', sent_at = NULL, approved_at = NULL, decided_by = auth.uid(), approver_notes = trim(_notes),
      status = 'EM PREPARAÇÃO', status_at = (now() AT TIME ZONE 'America/Sao_Paulo')::date WHERE id = _id;
  END IF;
END $$;

-- Solicitante cancela a SC já enviada (com o aprovador ou em Compras).
CREATE OR REPLACE FUNCTION public.purchase_request_cancel(_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r purchase_requests;
BEGIN
  SELECT * INTO r FROM purchase_requests WHERE id = _id FOR UPDATE;
  IF r.id IS NULL OR r.requester_id <> auth.uid() THEN RAISE EXCEPTION 'Solicitação não encontrada'; END IF;
  IF r.stage NOT IN ('aprovacao', 'compras') THEN RAISE EXCEPTION 'Só dá para cancelar uma solicitação enviada'; END IF;
  PERFORM set_config('purchase.rpc', '1', true);
  UPDATE purchase_requests SET stage = 'cancelada', status = 'CANCELADA', cancelled_at = now(),
    status_at = (now() AT TIME ZONE 'America/Sao_Paulo')::date WHERE id = _id;
END $$;

-- Apagar: só a SC nunca enviada (também a devolvida pelo aprovador).
DROP POLICY IF EXISTS purchase_requests_delete ON public.purchase_requests;
CREATE POLICY purchase_requests_delete ON public.purchase_requests FOR DELETE TO authenticated
  USING (requester_id = auth.uid() AND stage = 'rascunho');

REVOKE EXECUTE ON FUNCTION public.purchase_request_cancel(uuid), public.purchase_request_send(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.purchase_request_cancel(uuid), public.purchase_request_send(uuid) TO authenticated;

-- Vitória de Melo Brasilino aprova as próprias solicitações.
INSERT INTO public.purchase_approvers (requester_id, self_approve)
SELECT id, true FROM public.users_profiles WHERE full_name ILIKE 'Vit_ria de Melo Brasilino'
ON CONFLICT (requester_id) DO UPDATE SET self_approve = true;
