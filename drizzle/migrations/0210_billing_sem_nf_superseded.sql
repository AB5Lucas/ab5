-- Faturamento (Serviços): linha "Sem NF" não pode continuar somando depois que a NF do mesmo pedido chega.
-- 1) Linha "Sem NF" que saiu da planilha também é cancelada (antes só as notas numeradas eram).
-- 2) Linha "Sem NF" com NF lançada do mesmo cliente, pedido e valor, emitida de 0 a 20 dias depois,
--    é cancelada como substituída (uma NF substitui uma só linha "Sem NF").

CREATE OR REPLACE FUNCTION public.billing_sem_nf_supersede(p_note uuid, p_run uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE s billing_sync_notes%ROWTYPE; x uuid; xinv text; was_active boolean;
BEGIN
  SELECT * INTO s FROM billing_sync_notes WHERE id = p_note FOR UPDATE;
  IF s.id IS NULL OR NOT coalesce((s.original->>'noInvoice')::boolean, false)
     OR billing_doc_key(coalesce(s.order_number, '')) = ''
     OR (s.cancelled AND s.decision->>'supersededBy' IS NULL) THEN
    RETURN false;
  END IF;
  SELECT n.id, n.invoice_number INTO x, xinv
    FROM billing_sync_notes n
   WHERE n.id <> s.id
     AND split_part(n.source_key, '|', 1) = split_part(s.source_key, '|', 1)
     AND NOT n.cancelled AND n.status = 'posted'
     AND NOT coalesce((n.original->>'noInvoice')::boolean, false)
     AND billing_client_key(n.client_name) = billing_client_key(s.client_name)
     AND billing_doc_key(n.order_number) = billing_doc_key(s.order_number)
     AND round(n.amount * 100) = round(s.amount * 100)
     AND n.issued_at BETWEEN s.issued_at AND s.issued_at + 20
     AND NOT EXISTS (SELECT 1 FROM billing_sync_notes y WHERE y.id <> s.id AND y.decision->>'supersededBy' = n.id::text)
   ORDER BY n.issued_at, n.id
   LIMIT 1;
  IF x IS NULL THEN RETURN false; END IF;
  was_active := NOT s.cancelled;
  UPDATE work_entries SET sync_cancelled = true, updated_at = now()
   WHERE (sync_note_id = s.id OR sync_split_note_id = s.id) AND NOT sync_cancelled;
  UPDATE billing_sync_notes
     SET cancelled = true, cancelled_at = coalesce(cancelled_at, now()), status = 'cancelled',
         reason = format('Linha Sem NF substituída pela NF %s (mesmo pedido e valor)', xinv),
         decision = coalesce(decision, '{}'::jsonb) || jsonb_build_object('supersededBy', x),
         last_attempt_at = now(), run_id = coalesce(p_run, run_id)
   WHERE id = s.id;
  IF was_active THEN
    INSERT INTO billing_sync_history(note_id, run_id, action, snapshot)
    VALUES (s.id, p_run, 'superseded', jsonb_build_object('by', x, 'invoice', xinv));
  END IF;
  RETURN true;
END $$;

REVOKE ALL ON FUNCTION public.billing_sem_nf_supersede(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- Ajustes pontuais em billing_sync_process sobre a definição atual (idempotente).
DO $do$
DECLARE def text;
BEGIN
  def := pg_get_functiondef('public.billing_sync_process(uuid, jsonb)'::regprocedure);
  IF position('billing_sem_nf_supersede' IN def) > 0 THEN RETURN; END IF;
  -- 1) limpeza de linhas que saíram da planilha inclui as "Sem NF"
  def := replace(def, ' AND NOT coalesce((s.original->>''noInvoice'')::boolean,false)', '');
  -- 2) linha "Sem NF" já substituída por NF não volta a ser lançada
  def := replace(def,
    E'cents:=(n->>''amountCents'')::bigint; iscancel:=(n->>''cancelled'')::boolean;\n',
    E'cents:=(n->>''amountCents'')::bigint; iscancel:=(n->>''cancelled'')::boolean;\n'
    || E'  IF coalesce((n->>''noInvoice'')::boolean,false) AND NOT iscancel THEN\n'
    || E'   SELECT id INTO stale_id FROM billing_sync_notes WHERE source_key=n->>''key'';\n'
    || E'   IF stale_id IS NOT NULL AND billing_sem_nf_supersede(stale_id,p_run) THEN CONTINUE; END IF;\n'
    || E'  END IF;\n');
  -- 3) depois do laço, as NF novas desta leitura substituem as linhas "Sem NF" correspondentes
  def := replace(def,
    ' UPDATE billing_sync_runs SET finished_at=now()',
    E' PERFORM billing_sem_nf_supersede(s.id,p_run) FROM billing_sync_notes s WHERE s.source_key LIKE ''AB5-servicos|%'' AND NOT s.cancelled AND coalesce((s.original->>''noInvoice'')::boolean,false);\n'
    || ' UPDATE billing_sync_runs SET finished_at=now()');
  IF position('billing_sem_nf_supersede(stale_id' IN def) = 0 OR position('PERFORM billing_sem_nf_supersede' IN def) = 0 THEN
    RAISE EXCEPTION 'billing_sync_process: trecho esperado não encontrado';
  END IF;
  EXECUTE def;
END $do$;
