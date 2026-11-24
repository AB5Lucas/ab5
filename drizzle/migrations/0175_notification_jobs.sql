-- Prazos das SCs (Antecedência / Urgente / Atrasado), resumo diário e fila de envio.
-- Mesma regra de nível em src/lib/notifications.ts (deadlineLevel). Datas sempre no fuso de Brasília.

CREATE OR REPLACE FUNCTION public.purchase_deadline_level(_due date, _today date, _advance int, _urgent int) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN _due IS NULL THEN NULL
    WHEN _due < _today THEN 'atrasado'
    WHEN _due - _today <= _urgent THEN 'urgente'
    WHEN _due - _today <= _advance THEN 'antecedencia'
  END
$$;

-- Cada nível dispara uma vez por SC × prazo × destinatário; para sozinho quando a SC sai da etapa, é comprada ou cancelada.
-- Também garante a "Nova SC para validar" ao validador efetivo (ex.: substituto quando o gestor entra de férias).
CREATE OR REPLACE FUNCTION public.purchase_notify_deadlines() RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  s notification_settings;
  r purchase_requests;
  _today date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  _lvl text; _days int; _title text; _u uuid; _n int := 0; _desc text;
BEGIN
  SELECT * INTO s FROM notification_settings WHERE id = 1;
  IF s.id IS NULL THEN s.advance_days := 5; s.urgent_days := 2; s.started_at := now(); END IF;
  FOR r IN SELECT * FROM purchase_requests
           WHERE stage IN ('aprovacao', 'compras') AND status NOT IN ('COMPRA EFETIVADA', 'ALMOXARIFADO', 'CANCELADA', 'RECUSADA') LOOP
    _desc := public.purchase_notif_desc(r);
    IF r.stage = 'aprovacao' AND r.sent_at >= s.started_at THEN
      _u := public.purchase_effective_approver(r);
      IF public.notify_user(_u, 'compras', 'sc_validacao_nova', 'Nova SC para validar', _desc, '/compras/solicitacoes/' || r.id, r.number,
           'purchase_request', r.id, 'sc:' || r.id || ':val_new:' || extract(epoch FROM r.sent_at)::bigint || ':' || _u) IS NOT NULL THEN
        _n := _n + 1;
      END IF;
    END IF;
    _lvl := public.purchase_deadline_level(r.due_date, _today, s.advance_days, s.urgent_days);
    CONTINUE WHEN _lvl IS NULL;
    _days := r.due_date - _today;
    _title := CASE _lvl
      WHEN 'atrasado' THEN 'SC atrasada: prazo venceu em ' || to_char(r.due_date, 'DD/MM')
      WHEN 'urgente' THEN CASE WHEN _days = 0 THEN 'Urgente: SC vence hoje' WHEN _days = 1 THEN 'Urgente: SC vence amanhã' ELSE 'Urgente: SC vence em ' || _days || ' dias' END
      ELSE 'SC vence em ' || _days || ' dias' END;
    FOR _u IN
      SELECT public.purchase_effective_approver(r) WHERE r.stage = 'aprovacao'
      UNION SELECT b FROM public.notif_buyer_ids() b WHERE r.stage = 'compras'
    LOOP
      IF public.notify_user(_u, 'compras', 'sc_prazo_' || _lvl, _title,
           concat_ws(' · ', CASE WHEN r.stage = 'aprovacao' THEN 'Aguardando sua validação' ELSE 'Aguardando compra' END, _desc),
           '/compras/solicitacoes/' || r.id, r.number, 'purchase_request', r.id,
           'sc:' || r.id || ':prazo:' || _lvl || ':' || r.due_date || ':' || _u) IS NOT NULL THEN
        _n := _n + 1;
      END IF;
    END LOOP;
  END LOOP;
  RETURN _n;
END $$;
REVOKE ALL ON FUNCTION public.purchase_notify_deadlines() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purchase_notify_deadlines() TO service_role;

-- Pendências do usuário por responsabilidade (resumo diário). role: solicitante | validador | comprador.
CREATE OR REPLACE FUNCTION public.notification_digest_rows(_user uuid)
RETURNS TABLE (role text, id uuid, number text, due_date date, status text, client_name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT 'solicitante', r.id, r.number, r.due_date, r.status, c.name
  FROM purchase_requests r LEFT JOIN clients c ON c.id = r.client_id
  WHERE r.requester_id = _user AND r.stage = 'rascunho' AND r.returned_by IS NOT NULL
  UNION ALL
  SELECT 'validador', r.id, r.number, r.due_date, r.status, c.name
  FROM purchase_requests r LEFT JOIN clients c ON c.id = r.client_id
  WHERE r.stage = 'aprovacao' AND public.purchase_effective_approver(r) = _user
  UNION ALL
  SELECT 'comprador', r.id, r.number, r.due_date, r.status, c.name
  FROM purchase_requests r LEFT JOIN clients c ON c.id = r.client_id
  WHERE r.stage = 'compras' AND r.status NOT IN ('COMPRA EFETIVADA', 'ALMOXARIFADO', 'CANCELADA', 'RECUSADA')
    AND _user IN (SELECT public.notif_buyer_ids())
$$;
REVOKE ALL ON FUNCTION public.notification_digest_rows(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notification_digest_rows(uuid) TO service_role;

-- Quem deve receber o resumo agora: ligado, dia da semana marcado, entre o horário escolhido e 2 h depois (Brasília), ainda não feito hoje.
CREATE OR REPLACE FUNCTION public.notification_digests_due()
RETURNS TABLE (user_id uuid, day date, phone text, full_name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH n AS (SELECT (now() AT TIME ZONE 'America/Sao_Paulo') AS t)
  SELECT p.user_id, n.t::date, public.notif_whatsapp_phone(p.user_id), up.full_name
  FROM notification_prefs p CROSS JOIN n
  JOIN users_profiles up ON up.id = p.user_id AND up.active
  WHERE p.digest_enabled
    AND extract(dow FROM n.t)::int = ANY (p.digest_days)
    AND n.t::time >= p.digest_time AND n.t::time < p.digest_time + interval '2 hours'
    AND NOT EXISTS (SELECT 1 FROM notification_digests d WHERE d.user_id = p.user_id AND d.day = n.t::date)
$$;
REVOKE ALL ON FUNCTION public.notification_digests_due() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notification_digests_due() TO service_role;

-- Reserva entregas pendentes para envio (trava de 5 min; execuções simultâneas não pegam as mesmas).
-- Pendentes com mais de 24 h viram falha (não manda aviso velho quando um canal é configurado depois).
CREATE OR REPLACE FUNCTION public.notification_deliveries_claim(_limit int DEFAULT 100)
RETURNS TABLE (id uuid, channel text, attempts int, user_id uuid, kind text, title text, body text, link text, ref text, email text, phone text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
BEGIN
  UPDATE notification_deliveries d SET status = 'failed', error = 'Expirada (mais de 24 h na fila)', updated_at = now()
  WHERE d.status = 'pending' AND d.created_at < now() - interval '24 hours';
  RETURN QUERY
  WITH c AS (
    SELECT d.id FROM notification_deliveries d
    WHERE d.status = 'pending' AND (d.locked_until IS NULL OR d.locked_until < now())
    ORDER BY d.created_at LIMIT greatest(1, least(_limit, 500)) FOR UPDATE SKIP LOCKED
  ), u AS (
    UPDATE notification_deliveries d SET attempts = d.attempts + 1, locked_until = now() + interval '5 minutes', updated_at = now()
    FROM c WHERE d.id = c.id RETURNING d.id, d.channel, d.attempts, d.notification_id
  )
  SELECT u.id, u.channel, u.attempts, n.user_id, n.kind, n.title, n.body, n.link, n.ref, up.email,
    CASE WHEN u.channel = 'whatsapp' THEN public.notif_whatsapp_phone(n.user_id) END
  FROM u JOIN notifications n ON n.id = u.notification_id LEFT JOIN users_profiles up ON up.id = n.user_id;
END $$;
REVOKE ALL ON FUNCTION public.notification_deliveries_claim(int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notification_deliveries_claim(int) TO service_role;

-- Prazos a cada 15 min no próprio banco (pg_cron, sem chamar a API). O envio por push/e-mail/WhatsApp e o resumo
-- diário ficam no endpoint /api/public/jobs/notifications (agendar no Lovable; ver relatório).
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'purchase-deadline-notifications';
    PERFORM cron.schedule('purchase-deadline-notifications', '*/15 * * * *', 'SELECT public.purchase_notify_deadlines()');
  END IF;
END $$;
