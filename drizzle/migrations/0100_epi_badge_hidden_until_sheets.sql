-- Aviso de Fichas de EPI escondido enquanto nenhuma ficha foi lançada (todos os ativos apareciam como vencidos).
CREATE OR REPLACE FUNCTION public.menu_badge_counts(
  p_today date, p_docs boolean, p_purchases boolean, p_orders boolean, p_billing boolean
) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
WITH act AS (SELECT id FROM collaborators WHERE status = 'active' AND p_docs),
cov AS (
  SELECT CASE WHEN lower(type) LIKE '%aso%' THEN 'aso' WHEN lower(type) LIKE 'trein%' THEN 'trn' WHEN lower(type) LIKE 'integ%' THEN 'int' END AS k, collaborator_id
  FROM appointments WHERE p_docs AND status = 'agendado'
  UNION ALL
  SELECT CASE WHEN lower(type) LIKE '%aso%' THEN 'aso' WHEN lower(type) LIKE 'trein%' THEN 'trn' WHEN lower(type) LIKE 'integ%' THEN 'int' END, collaborator_id
  FROM conference_items WHERE p_docs AND status <> 'concluido'
),
lat AS (
  SELECT 'aso'::text AS k, collaborator_id AS cid, max(expires_at) AS exp FROM asos
   WHERE collaborator_id IN (SELECT id FROM act) AND expires_at IS NOT NULL GROUP BY collaborator_id
  UNION ALL
  SELECT 'trn', collaborator_id, max(expires_at) FROM collaborator_trainings
   WHERE collaborator_id IN (SELECT id FROM act) AND expires_at IS NOT NULL GROUP BY collaborator_id, training_id
  UNION ALL
  SELECT 'int', collaborator_id, max(expires_at) FROM client_integrations
   WHERE collaborator_id IN (SELECT id FROM act) AND expires_at IS NOT NULL AND NOT coalesce(documentation, false) GROUP BY collaborator_id, client_id
),
docs AS (
  SELECT k, count(*) FILTER (WHERE exp < p_today) AS expired, count(*) FILTER (WHERE exp >= p_today AND exp <= p_today + 30) AS expiring
  FROM lat WHERE NOT EXISTS (SELECT 1 FROM cov WHERE cov.k = lat.k AND cov.collaborator_id = lat.cid) GROUP BY k
),
epi AS (
  SELECT count(*) FILTER (WHERE e.id IS NULL OR e.expires_at IS NULL OR e.expires_at < p_today) AS expired,
         count(*) FILTER (WHERE e.expires_at >= p_today AND e.expires_at <= p_today + 30) AS expiring
  FROM act a LEFT JOIN epi_sheets e ON e.collaborator_id = a.id WHERE NOT coalesce(e.archived, false)
    AND EXISTS (SELECT 1 FROM epi_sheets) -- sem nenhuma ficha lançada ainda, o aviso de EPI fica escondido
),
conf AS (
  SELECT min(c.next_check_date) AS d FROM conference_checks c JOIN conference_items i ON i.id = c.item_id
  WHERE p_docs AND i.status <> 'concluido' AND NOT c.approved AND c.next_check_date IS NOT NULL GROUP BY c.item_id
)
SELECT jsonb_build_object(
  'byKind', jsonb_build_object(
    'agendamentos', jsonb_build_object('expired', (SELECT count(*) FROM appointments WHERE p_docs AND status = 'agendado' AND scheduled_date < p_today), 'expiring', 0),
    'aso', jsonb_build_object('expired', coalesce((SELECT expired FROM docs WHERE k = 'aso'), 0), 'expiring', coalesce((SELECT expiring FROM docs WHERE k = 'aso'), 0)),
    'int', jsonb_build_object('expired', coalesce((SELECT expired FROM docs WHERE k = 'int'), 0), 'expiring', coalesce((SELECT expiring FROM docs WHERE k = 'int'), 0)),
    'trn', jsonb_build_object('expired', coalesce((SELECT expired FROM docs WHERE k = 'trn'), 0), 'expiring', coalesce((SELECT expiring FROM docs WHERE k = 'trn'), 0)),
    'epi', jsonb_build_object('expired', coalesce((SELECT expired FROM epi), 0), 'expiring', coalesce((SELECT expiring FROM epi), 0))
  ),
  'conference', jsonb_build_object('expired', (SELECT count(*) FROM conf WHERE d < p_today), 'expiring', (SELECT count(*) FROM conf WHERE d = p_today)),
  'purchases', (SELECT count(*) FROM purchase_cc_lines WHERE p_purchases AND status = 'pending'),
  'orders', (SELECT count(*) FROM industry_orders WHERE p_orders AND status = 'pending'),
  'billingInd', (SELECT count(*) FROM industry_invoices WHERE p_billing AND status = 'pending'),
  'billingSrv', (SELECT count(*) FROM billing_sync_notes WHERE p_billing AND status NOT IN ('posted', 'cancelled'))
);
$$;
