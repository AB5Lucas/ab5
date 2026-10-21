ALTER TABLE public.billing_sync_runs ADD COLUMN category text NOT NULL DEFAULT 'servicos', ADD COLUMN source text NOT NULL DEFAULT 'faturamento', ADD COLUMN ref_month text, ADD COLUMN file_path text, ADD COLUMN ignored integer NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.billing_sync_start(p_kind text DEFAULT 'daily') RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
 DECLARE rid uuid; BEGIN
 IF coalesce(auth.role(),'')<>'service_role' THEN RAISE EXCEPTION 'Unauthorized'; END IF;
 PERFORM pg_advisory_xact_lock(hashtext('billing_sync_run'));
 IF EXISTS(SELECT 1 FROM billing_sync_runs WHERE category='servicos' AND status='running' AND started_at>now()-interval '10 minutes') THEN RETURN NULL; END IF;
 UPDATE billing_sync_runs SET status='error',finished_at=now(),error_message='Execução interrompida; retomada na próxima tentativa.' WHERE status='running' AND category='servicos';
 INSERT INTO billing_sync_runs(trigger_kind) VALUES(p_kind) RETURNING id INTO rid; RETURN rid; END $$;

CREATE TABLE public.industry_orders (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 order_number text NOT NULL UNIQUE,
 client_name text NOT NULL,
 service_code text,
 work_id uuid REFERENCES public.works(id),
 amount numeric NOT NULL DEFAULT 0,
 raw_material numeric,
 order_date date,
 ref_month text NOT NULL,
 source_file text,
 status text NOT NULL DEFAULT 'ok',
 issue text,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.industry_invoices (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 invoice_number text NOT NULL,
 issued_at date NOT NULL,
 order_number text,
 client_name text NOT NULL,
 amount numeric NOT NULL,
 items jsonb NOT NULL DEFAULT '[]',
 order_id uuid REFERENCES public.industry_orders(id),
 ref_month text NOT NULL,
 source_file text,
 status text NOT NULL DEFAULT 'pending',
 issue text,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE (invoice_number, issued_at));
GRANT SELECT ON public.industry_orders, public.industry_invoices TO authenticated;
GRANT ALL ON public.industry_orders, public.industry_invoices TO service_role;
ALTER TABLE public.industry_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.industry_invoices ENABLE ROW LEVEL SECURITY;
CREATE POLICY industry_orders_read ON public.industry_orders FOR SELECT TO authenticated USING (public.can_access_page('/fechamentos/suzano') OR public.can_access_page('/relatorios/sincronizacao'));
CREATE POLICY industry_invoices_read ON public.industry_invoices FOR SELECT TO authenticated USING (public.can_access_page('/fechamentos/suzano') OR public.can_access_page('/relatorios/sincronizacao'));

ALTER TABLE public.work_entries ADD COLUMN industry_order_id uuid REFERENCES public.industry_orders(id), ADD COLUMN industry_invoice_id uuid REFERENCES public.industry_invoices(id);
CREATE UNIQUE INDEX work_entries_industry_order_uq ON public.work_entries(industry_order_id) WHERE industry_order_id IS NOT NULL;
CREATE UNIQUE INDEX work_entries_industry_invoice_uq ON public.work_entries(industry_invoice_id) WHERE industry_invoice_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.billing_protect_sync_entry() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
 BEGIN
 IF coalesce(auth.role(),'') <> 'service_role' AND ((TG_OP <> 'INSERT' AND (OLD.sync_note_id IS NOT NULL OR OLD.industry_order_id IS NOT NULL OR OLD.industry_invoice_id IS NOT NULL)) OR (TG_OP <> 'DELETE' AND (NEW.sync_note_id IS NOT NULL OR NEW.industry_order_id IS NOT NULL OR NEW.industry_invoice_id IS NOT NULL))) THEN RAISE EXCEPTION 'Lançamento sincronizado: alterações somente pela planilha de origem.'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF; END $$;

CREATE OR REPLACE FUNCTION public.industry_sync_apply(p_run uuid, p_source text, p_month text, p_file text, p_rows jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
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
    VALUES(wid,(r->>'date')::date,'materiais','Matéria-prima · Pedido '||(r->>'order')||' · '||(r->>'client'),(r->>'mp')::numeric,v_oid)
    ON CONFLICT(industry_order_id) WHERE industry_order_id IS NOT NULL DO UPDATE SET work_id=EXCLUDED.work_id,entry_date=EXCLUDED.entry_date,description=EXCLUDED.description,amount=EXCLUDED.amount,updated_at=now();
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
END $$;
REVOKE ALL ON FUNCTION public.industry_sync_apply(uuid,text,text,text,jsonb) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.industry_sync_apply(uuid,text,text,text,jsonb) TO service_role;