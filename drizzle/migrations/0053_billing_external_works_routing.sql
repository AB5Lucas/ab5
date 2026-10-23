CREATE OR REPLACE FUNCTION public.billing_sync_import_external(p_run uuid, p_notes jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public AS $$
DECLARE n jsonb; normalized jsonb := '[]'::jsonb; matches text[];
BEGIN
  IF coalesce(auth.role(),'') <> 'service_role' THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('billing_sync_financial'));
  FOR n IN SELECT value FROM jsonb_array_elements(p_notes) LOOP
    IF NOT EXISTS (SELECT 1 FROM billing_sync_notes WHERE source_key = n->>'key') THEN
      SELECT array_agg(s.source_key) INTO matches FROM billing_sync_notes s
      WHERE (s.source_key LIKE 'INDUSTRIA-OBRAS|%') <> ((n->>'key') LIKE 'INDUSTRIA-OBRAS|%')
        AND NOT coalesce((n->>'noInvoice')::boolean,false)
        AND billing_doc_key(s.invoice_number) = billing_doc_key(n->>'invoice')
        AND s.issued_at = (n->>'issuedAt')::date
        AND billing_client_key(s.client_name) = billing_client_key(n->>'client')
        AND round(s.amount*100) = (n->>'amountCents')::bigint
        AND billing_doc_key(coalesce(s.order_number,'')) = billing_doc_key(coalesce(n->>'order',''));
      IF cardinality(matches) = 1 THEN
        n := jsonb_set(n,'{key}',to_jsonb(matches[1]));
      ELSIF cardinality(matches) > 1 THEN
        n := n || jsonb_build_object('error','Mais de um lançamento corresponde à nota nas duas fontes; conferir para evitar duplicidade');
      END IF;
    END IF;
    normalized := normalized || jsonb_build_array(n);
  END LOOP;
  RETURN public.billing_sync_process(p_run, normalized);
END;
$$;
REVOKE ALL ON FUNCTION public.billing_sync_import_external(uuid,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.billing_sync_import_external(uuid,jsonb) TO service_role;