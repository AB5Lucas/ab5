-- Notificações de Compras geradas por gatilhos (nada nas telas). Só para quem precisa agir; o autor da ação
-- (auth.uid()) não recebe (notify_user). Chave de deduplicação por SC × evento × ciclo × destinatário.

CREATE OR REPLACE FUNCTION public.purchase_notif_desc(r public.purchase_requests) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT concat_ws(' · ',
    (SELECT nullif(trim(full_name), '') FROM users_profiles WHERE id = r.requester_id),
    (SELECT name FROM clients WHERE id = r.client_id),
    CASE WHEN r.due_date IS NULL THEN 'sem prazo' ELSE 'prazo ' || to_char(r.due_date, 'DD/MM/YYYY') END)
$$;
REVOKE ALL ON FUNCTION public.purchase_notif_desc(public.purchase_requests) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.purchase_notify_request() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _link text := '/compras/solicitacoes/' || NEW.id;
  _k text := 'sc:' || NEW.id || ':';
  _t text := extract(epoch FROM now())::bigint::text;
  _old text;
  _desc text := public.purchase_notif_desc(NEW);
  _who text := (SELECT nullif(trim(full_name), '') FROM users_profiles WHERE id = auth.uid());
  _appr uuid;
  _b uuid;
  _cycle text;
BEGIN
  _old := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.stage END;

  IF NEW.stage IS DISTINCT FROM _old THEN
    IF NEW.stage = 'aprovacao' THEN
      _appr := public.purchase_effective_approver(NEW);
      IF _old = 'compras' THEN
        -- Comprador devolveu ao validador (migração 0146).
        PERFORM public.notify_user(_appr, 'compras', 'sc_validacao_devolvida', 'SC devolvida pelo comprador para validação',
          concat_ws(' · ', NEW.return_notes, _desc), _link, NEW.number, 'purchase_request', NEW.id, _k || 'val_dev:' || _t || ':' || _appr);
        PERFORM public.notify_user(NEW.requester_id, 'compras', 'sc_movimentada', 'SC voltou para a validação',
          concat_ws(' · ', NEW.return_notes, _desc), _link, NEW.number, 'purchase_request', NEW.id, _k || 'req_val_dev:' || _t);
      ELSE
        _cycle := extract(epoch FROM coalesce(NEW.sent_at, now()))::bigint::text;
        PERFORM public.notify_user(_appr, 'compras', 'sc_validacao_nova', 'Nova SC para validar',
          _desc, _link, NEW.number, 'purchase_request', NEW.id, _k || 'val_new:' || _cycle || ':' || _appr);
      END IF;

    ELSIF NEW.stage = 'compras' THEN
      _cycle := extract(epoch FROM coalesce(NEW.approved_at, NEW.sent_at, now()))::bigint::text;
      FOR _b IN SELECT public.notif_buyer_ids() LOOP
        PERFORM public.notify_user(_b, 'compras', 'sc_compras_nova',
          CASE WHEN _old = 'aprovacao' THEN 'SC validada: nova SC em Compras' ELSE 'Nova SC em Compras' END,
          _desc, _link, NEW.number, 'purchase_request', NEW.id, _k || 'compras:' || _cycle || ':' || _b);
      END LOOP;
      IF _old = 'aprovacao' THEN
        PERFORM public.notify_user(NEW.requester_id, 'compras', 'sc_validada', 'SC validada e enviada para Compras',
          concat_ws(' · ', 'Validada' || coalesce(' por ' || _who, ''), NEW.approver_notes), _link, NEW.number, 'purchase_request', NEW.id,
          _k || 'validada:' || _cycle);
      END IF;

    ELSIF NEW.stage = 'rascunho' AND _old IN ('aprovacao', 'compras') AND NEW.returned_by IS NOT NULL THEN
      -- Devolvida para correção (validador ou comprador). Puxar de volta (recall) não tem returned_by.
      PERFORM public.notify_user(NEW.requester_id, 'compras', 'sc_devolvida', 'SC devolvida para correção',
        concat_ws(' · ', NEW.return_notes, 'Corrija e envie de novo'), _link, NEW.number, 'purchase_request', NEW.id, _k || 'devolvida:' || _t);

    ELSIF NEW.stage = 'cancelada' AND _old IS NOT NULL THEN
      PERFORM public.notify_user(NEW.requester_id, 'compras', 'sc_cancelada', 'SC cancelada',
        concat_ws(' · ', CASE WHEN NEW.buyer_notes ILIKE 'Cancelada pelo Comprador%' THEN NEW.buyer_notes END, _desc),
        _link, NEW.number, 'purchase_request', NEW.id, _k || 'cancelada');
      IF _old = 'compras' THEN
        FOR _b IN SELECT public.notif_buyer_ids() LOOP
          PERFORM public.notify_user(_b, 'compras', 'sc_cancelada', 'SC cancelada' || coalesce(' por ' || _who, ''), _desc, _link, NEW.number,
            'purchase_request', NEW.id, _k || 'cancelada:' || _b);
        END LOOP;
      ELSIF _old = 'aprovacao' THEN
        _appr := public.purchase_effective_approver(OLD);
        PERFORM public.notify_user(_appr, 'compras', 'sc_cancelada', 'SC cancelada' || coalesce(' por ' || _who, ''), _desc, _link, NEW.number,
          'purchase_request', NEW.id, _k || 'cancelada:' || _appr);
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN RETURN NEW; END IF;

  -- Mesmo estágio: validador trocado (ex.: substituto) recebe a SC; mesma chave do envio = não repete.
  IF NEW.stage = 'aprovacao' AND (NEW.approver_id IS DISTINCT FROM OLD.approver_id OR NEW.substitute_id IS DISTINCT FROM OLD.substitute_id) THEN
    _appr := public.purchase_effective_approver(NEW);
    _cycle := extract(epoch FROM coalesce(NEW.sent_at, now()))::bigint::text;
    PERFORM public.notify_user(_appr, 'compras', 'sc_validacao_nova', 'Nova SC para validar',
      _desc, _link, NEW.number, 'purchase_request', NEW.id, _k || 'val_new:' || _cycle || ':' || _appr);
  END IF;

  -- Mudança de status em Compras: avisa o solicitante.
  IF NEW.stage = 'compras' AND NEW.status IS DISTINCT FROM OLD.status THEN
    PERFORM public.notify_user(NEW.requester_id, 'compras', 'sc_status', 'Status da SC: ' || NEW.status,
      concat_ws(' · ', 'Antes: ' || OLD.status, CASE WHEN NEW.buyer_notes IS DISTINCT FROM OLD.buyer_notes THEN NEW.buyer_notes END),
      _link, NEW.number, 'purchase_request', NEW.id, _k || 'status:' || md5(NEW.status) || ':' || _t);
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.purchase_notify_request() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_purchase_requests_notify ON public.purchase_requests;
CREATE TRIGGER trg_purchase_requests_notify AFTER INSERT OR UPDATE OF stage, status, approver_id, substitute_id ON public.purchase_requests
  FOR EACH ROW EXECUTE FUNCTION public.purchase_notify_request();

-- Itens: pedido de compra (PC) incluído/alterado e item recusado/cancelado avisam o solicitante.
CREATE OR REPLACE FUNCTION public.purchase_notify_item() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r purchase_requests; _ord text := nullif(trim(coalesce(NEW.order_number, '')), ''); _item text;
BEGIN
  SELECT * INTO r FROM purchase_requests WHERE id = NEW.request_id;
  IF r.id IS NULL THEN RETURN NEW; END IF;
  _item := 'Item ' || NEW.item_no || ' (' || left(NEW.description, 60) || ')';
  IF _ord IS NOT NULL AND _ord IS DISTINCT FROM nullif(trim(coalesce(OLD.order_number, '')), '') THEN
    PERFORM public.notify_user(r.requester_id, 'compras', 'sc_pedido', 'Pedido de compra incluído na SC',
      _item || ': pedido ' || _ord, '/compras/solicitacoes/' || r.id, r.number, 'purchase_request', r.id,
      'sci:' || NEW.id || ':pc:' || md5(_ord));
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN ('RECUSADO', 'CANCELADO') THEN
    PERFORM public.notify_user(r.requester_id, 'compras', 'sc_item_status', 'Item ' || lower(NEW.status) || ' na SC',
      _item, '/compras/solicitacoes/' || r.id, r.number, 'purchase_request', r.id, 'sci:' || NEW.id || ':st:' || NEW.status);
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.purchase_notify_item() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_purchase_items_notify ON public.purchase_request_items;
CREATE TRIGGER trg_purchase_items_notify AFTER UPDATE OF order_number, status ON public.purchase_request_items
  FOR EACH ROW EXECUTE FUNCTION public.purchase_notify_item();
