CREATE OR REPLACE FUNCTION public.industry_sync_apply(p_run uuid, p_source text, p_month text, p_file text, p_rows jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE r jsonb; v_oid uuid; wid uuid; ins int:=0; upd int:=0; pend int:=0; ex boolean; ord record;
BEGIN
 IF coalesce(auth.role(),'')<>'service_role' THEN RAISE EXCEPTION 'Unauthorized'; END IF;
 PERFORM pg_advisory_xact_lock(hashtext('industry_sync'));
 IF p_source='pedidos' THEN
  FOR r IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
   SELECT EXISTS(SELECT 1 FROM industry_orders WHERE order_number=r->>'order') INTO ex;
   wid := (SELECT w.id FROM works w JOIN clients c ON c.id=w.client_id WHERE c.name ILIKE 'INDUSTRIA' AND w.name=r->>'service' LIMIT 1);
   INSERT INTO industry_orders(order_number,client_name,service_code,work_id,amount,raw_material,order_date,ref_month,source_file,status,issue)
   VALUES(r->>'order',r->>'client',r->>'code',wid,coalesce((r->>'amount')::numeric,0),(r->>'mp')::numeric,(r->>'date')::date,p_month,p_file,
     CASE WHEN wid IS NULL OR r->>'issue' IS NOT NULL THEN 'pending' ELSE 'ok' END, coalesce(r->>'issue', CASE WHEN wid IS NULL THEN 'Serviço não identificado' END))
   ON CONFLICT(order_number) DO UPDATE SET client_name=EXCLUDED.client_name,service_code=EXCLUDED.service_code,work_id=EXCLUDED.work_id,amount=EXCLUDED.amount,raw_material=EXCLUDED.raw_material,order_date=EXCLUDED.order_date,source_file=EXCLUDED.source_file,status=EXCLUDED.status,issue=EXCLUDED.issue,updated_at=now()
   RETURNING id INTO v_oid;
   IF ex THEN upd:=upd+1; ELSE ins:=ins+1; END IF;
   IF wid IS NULL THEN pend:=pend+1; DELETE FROM work_entries WHERE industry_order_id=v_oid; CONTINUE; END IF;
   IF coalesce((r->>'mp')::numeric,0)>0 AND r->>'date' IS NOT NULL THEN
    INSERT INTO work_entries(work_id,entry_date,category,description,amount,industry_order_id)
    VALUES(wid,(r->>'date')::date,'ferramentas','Matéria-prima · Pedido '||(r->>'order')||' · '||(r->>'client'),(r->>'mp')::numeric,v_oid)
    ON CONFLICT(industry_order_id) WHERE industry_order_id IS NOT NULL DO UPDATE SET category=EXCLUDED.category,work_id=EXCLUDED.work_id,entry_date=EXCLUDED.entry_date,description=EXCLUDED.description,amount=EXCLUDED.amount,updated_at=now();
   ELSE DELETE FROM work_entries WHERE industry_order_id=v_oid; END IF;
  END LOOP;
 END IF;
 IF p_source='faturamento' THEN
  FOR r IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
   SELECT EXISTS(SELECT 1 FROM industry_invoices WHERE invoice_number=r->>'invoice' AND issued_at=(r->>'date')::date) INTO ex;
   INSERT INTO industry_invoices(invoice_number,issued_at,order_number,client_name,amount,items,ref_month,source_file)
   VALUES(r->>'invoice',(r->>'date')::date,nullif(r->>'order',''),r->>'client',(r->>'amount')::numeric,coalesce(r->'items','[]'),p_month,p_file)
   ON CONFLICT(invoice_number,issued_at) DO UPDATE SET order_number=EXCLUDED.order_number,client_name=EXCLUDED.client_name,amount=EXCLUDED.amount,items=EXCLUDED.items,source_file=EXCLUDED.source_file,updated_at=now();
   IF ex THEN upd:=upd+1; ELSE ins:=ins+1; END IF;
  END LOOP;
 END IF;
 FOR ord IN SELECT i.id iid, i.invoice_number, i.issued_at, i.amount, i.client_name, i.order_number, o.id ooid, o.work_id FROM industry_invoices i LEFT JOIN industry_orders o ON o.order_number=i.order_number LOOP
  IF ord.work_id IS NULL THEN
   UPDATE industry_invoices SET order_id=ord.ooid,status='pending',issue=CASE WHEN ord.ooid IS NULL THEN 'Pedido ainda não importado' ELSE 'Pedido sem serviço identificado' END WHERE id=ord.iid;
   DELETE FROM work_entries WHERE industry_invoice_id=ord.iid;
  ELSE
   UPDATE industry_invoices SET order_id=ord.ooid,status='posted',issue=NULL WHERE id=ord.iid;
   INSERT INTO work_entries(work_id,entry_date,category,description,amount,industry_invoice_id)
   VALUES(ord.work_id,ord.issued_at,'faturamento','NF '||ord.invoice_number||' · Pedido '||ord.order_number||' · '||ord.client_name,ord.amount,ord.iid)
   ON CONFLICT(industry_invoice_id) WHERE industry_invoice_id IS NOT NULL DO UPDATE SET work_id=EXCLUDED.work_id,entry_date=EXCLUDED.entry_date,description=EXCLUDED.description,amount=EXCLUDED.amount,updated_at=now();
  END IF;
 END LOOP;
 IF p_source='faturamento' THEN SELECT count(*) INTO pend FROM industry_invoices WHERE ref_month=p_month AND status='pending'; END IF;
 UPDATE billing_sync_runs SET status=CASE WHEN pend>0 THEN 'completed_pending' ELSE 'completed' END, finished_at=now(), inserted=ins, updated=upd, pending=pend, analyzed=jsonb_array_length(p_rows) WHERE id=p_run;
 RETURN jsonb_build_object('inserted',ins,'updated',upd,'pending',pend);
END $function$;
ALTER TABLE public.work_entries DISABLE TRIGGER protect_billing_sync_entries;
UPDATE public.work_entries SET category='ferramentas' WHERE industry_order_id IS NOT NULL AND category='materiais';
ALTER TABLE public.work_entries ENABLE TRIGGER protect_billing_sync_entries;