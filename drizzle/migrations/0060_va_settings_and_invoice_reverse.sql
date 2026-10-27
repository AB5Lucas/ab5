ALTER TABLE public.industry_invoices ADD COLUMN IF NOT EXISTS reversed_at timestamptz;
CREATE TABLE IF NOT EXISTS public.va_settings (id boolean PRIMARY KEY DEFAULT true CHECK (id), base_value numeric NOT NULL DEFAULT 200, tolerance_min int NOT NULL DEFAULT 15, pct1 numeric NOT NULL DEFAULT 50, pct2 numeric NOT NULL DEFAULT 70, pct3 numeric NOT NULL DEFAULT 100, unjustified_reasons text[] NOT NULL DEFAULT '{FALTA INJUSTIFICADA}', justified_reasons text[] NOT NULL DEFAULT '{ATESTADO MEDICO,AFASTAMENTO}', abono_reasons text[] NOT NULL DEFAULT '{DECLARACAO DE HORAS,ABONO}', updated_at timestamptz NOT NULL DEFAULT now());
GRANT SELECT, INSERT, UPDATE ON public.va_settings TO authenticated;
GRANT ALL ON public.va_settings TO service_role;
ALTER TABLE public.va_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY va_read ON public.va_settings FOR SELECT TO authenticated USING (public.can_access_page('/relatorios/vale-alimentacao'));
CREATE POLICY va_ins ON public.va_settings FOR INSERT TO authenticated WITH CHECK (public.can_access_page('/relatorios/vale-alimentacao'));
CREATE POLICY va_upd ON public.va_settings FOR UPDATE TO authenticated USING (public.can_access_page('/relatorios/vale-alimentacao'));
INSERT INTO public.va_settings(id) VALUES (true) ON CONFLICT DO NOTHING;
CREATE OR REPLACE FUNCTION public.industry_invoice_reverse(_invoice uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
 IF NOT (public.can_access_page('/relatorios/sincronizacao') OR public.can_access_page('/fechamentos/suzano')) THEN RAISE EXCEPTION 'Sem acesso'; END IF;
 DELETE FROM work_entries WHERE industry_invoice_id=_invoice;
 UPDATE industry_invoices SET status='pending', reversed_at=now(), issue='Estornado: realocar no pedido correto', updated_at=now() WHERE id=_invoice;
END $$;
GRANT EXECUTE ON FUNCTION public.industry_invoice_reverse(uuid) TO authenticated;
CREATE OR REPLACE FUNCTION public.industry_invoice_launch(_invoice uuid, _work uuid)
 RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE i record; v_ord text; v_oid uuid; o record; n int;
BEGIN
 IF NOT (public.can_access_page('/relatorios/sincronizacao') OR public.can_access_page('/fechamentos/suzano')) THEN RAISE EXCEPTION 'Sem acesso'; END IF;
 UPDATE industry_invoices SET reversed_at=NULL WHERE id=_invoice;
 SELECT * INTO i FROM industry_invoices WHERE id=_invoice;
 IF i.id IS NULL THEN RAISE EXCEPTION 'Nota não encontrada'; END IF;
 v_ord := coalesce(nullif(i.order_number,''), i.invoice_number);
 IF i.order_number IS NULL OR i.order_number='' THEN UPDATE industry_invoices SET order_number=v_ord WHERE id=i.id; END IF;
 SELECT id INTO v_oid FROM industry_orders WHERE order_number=v_ord OR v_ord=ANY(aliases) ORDER BY (order_number=v_ord) DESC LIMIT 1;
 IF v_oid IS NULL THEN
  INSERT INTO industry_orders(order_number,client_name,service_code,work_id,manual_work_id,amount,order_date,ref_month,source_file,status)
  VALUES(v_ord,i.client_name,'MANUAL',_work,_work,i.amount,i.issued_at,i.ref_month,'Lançamento manual','ok') RETURNING id INTO v_oid;
 END IF;
 n := public.industry_order_assign(v_oid,_work);
 SELECT * INTO o FROM industry_orders WHERE id=v_oid;
 PERFORM public.industry_add_work_order(_work, o.order_number, coalesce(o.order_date,i.issued_at), CASE WHEN coalesce(o.amount,0)>0 THEN o.amount ELSE i.amount END);
 RETURN n;
END $function$;
CREATE OR REPLACE FUNCTION public.industry_sync_apply(p_run uuid, p_source text, p_month text, p_file text, p_rows jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE r jsonb; v_oid uuid; wid uuid; ins int:=0; upd int:=0; pend int:=0; ex boolean; ord record; v_al text[]; v_man uuid;
BEGIN
 IF coalesce(auth.role(),'')<>'service_role' THEN RAISE EXCEPTION 'Unauthorized'; END IF;
 PERFORM pg_advisory_xact_lock(hashtext('industry_sync'));
 IF p_source='pedidos' THEN
  FOR r IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
   SELECT EXISTS(SELECT 1 FROM industry_orders WHERE order_number=r->>'order') INTO ex;
   v_al := coalesce(ARRAY(SELECT jsonb_array_elements_text(r->'aliases')), '{}');
   v_man := (SELECT manual_work_id FROM industry_orders WHERE order_number=r->>'order');
   wid := coalesce(v_man, (SELECT w.id FROM works w JOIN clients c ON c.id=w.client_id WHERE c.name ILIKE 'INDUSTRIA' AND w.name=r->>'service' LIMIT 1));
   INSERT INTO industry_orders(order_number,client_name,service_code,work_id,amount,raw_material,order_date,ref_month,source_file,status,issue,aliases,splits,lines)
   VALUES(r->>'order',r->>'client',r->>'code',wid,coalesce((r->>'amount')::numeric,0),(r->>'mp')::numeric,(r->>'date')::date,p_month,p_file,
     CASE WHEN wid IS NULL OR (r->>'issue' IS NOT NULL AND v_man IS NULL) THEN 'pending' ELSE 'ok' END, CASE WHEN v_man IS NOT NULL THEN NULL ELSE coalesce(r->>'issue', CASE WHEN wid IS NULL THEN 'Serviço não identificado' END) END, v_al, CASE WHEN jsonb_array_length(coalesce(r->'splits','[]'))>1 THEN r->'splits' END, r->'lines')
   ON CONFLICT(order_number) DO UPDATE SET client_name=EXCLUDED.client_name,service_code=EXCLUDED.service_code,work_id=EXCLUDED.work_id,amount=EXCLUDED.amount,raw_material=EXCLUDED.raw_material,order_date=EXCLUDED.order_date,source_file=EXCLUDED.source_file,status=EXCLUDED.status,issue=EXCLUDED.issue,splits=EXCLUDED.splits,lines=EXCLUDED.lines,
     aliases=CASE WHEN cardinality(EXCLUDED.aliases)>0 THEN EXCLUDED.aliases ELSE industry_orders.aliases END,updated_at=now()
   RETURNING id INTO v_oid;
   IF ex THEN upd:=upd+1; ELSE ins:=ins+1; END IF;
   IF wid IS NULL THEN pend:=pend+1; DELETE FROM work_entries WHERE industry_order_id=v_oid; CONTINUE; END IF;
   IF coalesce((r->>'mp')::numeric,0)>0 AND r->>'date' IS NOT NULL THEN
    INSERT INTO work_entries(work_id,entry_date,category,description,amount,industry_order_id)
    VALUES(wid,(r->>'date')::date,'ferramentas','Matéria-prima · Pedido '||array_to_string(ARRAY[r->>'order']||v_al,' / ')||' · '||(r->>'client'),(r->>'mp')::numeric,v_oid)
    ON CONFLICT(industry_order_id) WHERE industry_order_id IS NOT NULL DO UPDATE SET category=EXCLUDED.category,work_id=EXCLUDED.work_id,entry_date=EXCLUDED.entry_date,description=EXCLUDED.description,amount=EXCLUDED.amount,updated_at=now();
   ELSE DELETE FROM work_entries WHERE industry_order_id=v_oid; END IF;
  END LOOP;
 END IF;
 IF p_source='faturamento' THEN
  FOR r IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
   SELECT EXISTS(SELECT 1 FROM industry_invoices WHERE invoice_number=r->>'invoice' AND issued_at=(r->>'date')::date) INTO ex;
   INSERT INTO industry_invoices(invoice_number,issued_at,order_number,client_name,amount,items,ref_month,source_file)
   VALUES(r->>'invoice',(r->>'date')::date,nullif(r->>'order',''),r->>'client',(r->>'amount')::numeric,coalesce(r->'items','[]'),p_month,p_file)
   ON CONFLICT(invoice_number,issued_at) DO UPDATE SET order_number=coalesce(EXCLUDED.order_number,industry_invoices.order_number),client_name=EXCLUDED.client_name,amount=EXCLUDED.amount,items=EXCLUDED.items,source_file=EXCLUDED.source_file,updated_at=now();
   IF ex THEN upd:=upd+1; ELSE ins:=ins+1; END IF;
  END LOOP;
 END IF;
 FOR ord IN SELECT i.id iid, i.invoice_number, i.issued_at, i.amount, i.client_name, i.order_number, o.id ooid, o.work_id FROM industry_invoices i
   LEFT JOIN LATERAL (SELECT o.* FROM industry_orders o WHERE o.order_number=i.order_number OR i.order_number=ANY(o.aliases) ORDER BY (o.order_number=i.order_number) DESC LIMIT 1) o ON true WHERE i.reversed_at IS NULL LOOP
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
 PERFORM industry_sync_parts(id) FROM industry_orders WHERE coalesce(jsonb_array_length(splits),0)>1 OR id IN (SELECT DISTINCT industry_part_ref FROM work_entries WHERE industry_part_ref IS NOT NULL);
 IF p_source='faturamento' THEN SELECT count(*) INTO pend FROM industry_invoices WHERE ref_month=p_month AND status='pending'; END IF;
 UPDATE billing_sync_runs SET status=CASE WHEN pend>0 THEN 'completed_pending' ELSE 'completed' END, finished_at=now(), inserted=ins, updated=upd, pending=pend, analyzed=jsonb_array_length(p_rows) WHERE id=p_run;
 RETURN jsonb_build_object('inserted',ins,'updated',upd,'pending',pend);
END $function$;