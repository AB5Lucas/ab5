CREATE OR REPLACE FUNCTION public.billing_purge_cross_duplicates()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public AS $$
DECLARE n_svc int := 0; n_ind int := 0;
BEGIN
  -- Serviços tem prioridade: remove cópias vindas da Indústria (obras) sem lançamento
  CREATE TEMP TABLE IF NOT EXISTS _dup_notes(id uuid) ON COMMIT DROP;
  TRUNCATE _dup_notes;
  INSERT INTO _dup_notes SELECT o.id FROM billing_sync_notes o
   WHERE o.source_key LIKE 'INDUSTRIA-OBRAS|%'
     AND NOT EXISTS (SELECT 1 FROM work_entries w WHERE w.sync_note_id = o.id)
     AND EXISTS (SELECT 1 FROM billing_sync_notes s WHERE s.source_key NOT LIKE 'INDUSTRIA-OBRAS|%' AND NOT s.cancelled
                 AND billing_doc_key(s.invoice_number) = billing_doc_key(o.invoice_number));
  DELETE FROM billing_sync_history h WHERE h.note_id IN (SELECT id FROM _dup_notes);
  DELETE FROM billing_sync_notes b WHERE b.id IN (SELECT id FROM _dup_notes);
  GET DIAGNOSTICS n_svc = ROW_COUNT;
  -- Indústria: remove NF que já existe na Serviços (sem lançamento)
  DELETE FROM industry_invoices i
   WHERE NOT EXISTS (SELECT 1 FROM work_entries w WHERE w.industry_invoice_id = i.id)
     AND EXISTS (SELECT 1 FROM billing_sync_notes s WHERE NOT s.cancelled
                 AND billing_doc_key(s.invoice_number) = billing_doc_key(i.invoice_number));
  GET DIAGNOSTICS n_ind = ROW_COUNT;
  RETURN jsonb_build_object('servicos', n_svc, 'industria', n_ind);
END;
$$;
REVOKE ALL ON FUNCTION public.billing_purge_cross_duplicates() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.billing_purge_cross_duplicates() TO service_role;
SELECT public.billing_purge_cross_duplicates();