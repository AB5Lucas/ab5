CREATE OR REPLACE FUNCTION public.billing_protect_sync_entry()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $function$
 BEGIN
 IF coalesce(auth.role(),'') <> 'service_role' AND coalesce(current_setting('app.industry_manual', true),'') <> 'on' AND ((TG_OP <> 'INSERT' AND (OLD.sync_note_id IS NOT NULL OR OLD.industry_order_id IS NOT NULL OR OLD.industry_invoice_id IS NOT NULL)) OR (TG_OP <> 'DELETE' AND (NEW.sync_note_id IS NOT NULL OR NEW.industry_order_id IS NOT NULL OR NEW.industry_invoice_id IS NOT NULL))) THEN RAISE EXCEPTION 'Lançamento sincronizado: alterações somente pela planilha de origem.'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF; END $function$;

CREATE OR REPLACE FUNCTION public.industry_order_assign(_order uuid, _work uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE o record; n int:=0; i record;
BEGIN
 IF NOT (public.can_access_page('/relatorios/sincronizacao') OR public.can_access_page('/fechamentos/suzano')) THEN RAISE EXCEPTION 'Sem acesso'; END IF;
 IF NOT EXISTS(SELECT 1 FROM works w JOIN clients c ON c.id=w.client_id WHERE w.id=_work AND c.name ILIKE 'INDUSTRIA') THEN RAISE EXCEPTION 'Serviço inválido'; END IF;
 PERFORM pg_advisory_xact_lock(hashtext('industry_sync'));
 PERFORM set_config('app.industry_manual','on',true);
 UPDATE industry_orders SET manual_work_id=_work, work_id=_work, status='ok', issue=NULL, updated_at=now() WHERE id=_order RETURNING * INTO o;
 IF o.id IS NULL THEN RAISE EXCEPTION 'Pedido não encontrado'; END IF;
 IF coalesce(o.raw_material,0)>0 AND o.order_date IS NOT NULL THEN
  INSERT INTO work_entries(work_id,entry_date,category,description,amount,industry_order_id)
  VALUES(_work,o.order_date,'ferramentas','Matéria-prima · Pedido '||array_to_string(ARRAY[o.order_number]||coalesce(o.aliases,'{}'),' / ')||' · '||o.client_name,o.raw_material,o.id)
  ON CONFLICT(industry_order_id) WHERE industry_order_id IS NOT NULL DO UPDATE SET work_id=EXCLUDED.work_id,updated_at=now();
 END IF;
 FOR i IN SELECT * FROM industry_invoices WHERE order_number=o.order_number OR order_number=ANY(coalesce(o.aliases,'{}')) LOOP
  UPDATE industry_invoices SET order_id=o.id,status='posted',issue=NULL WHERE id=i.id;
  INSERT INTO work_entries(work_id,entry_date,category,description,amount,industry_invoice_id)
  VALUES(_work,i.issued_at,'faturamento','NF '||i.invoice_number||' · Pedido '||i.order_number||' · '||i.client_name,i.amount,i.id)
  ON CONFLICT(industry_invoice_id) WHERE industry_invoice_id IS NOT NULL DO UPDATE SET work_id=EXCLUDED.work_id,updated_at=now();
  n:=n+1;
 END LOOP;
 PERFORM set_config('app.industry_manual','',true);
 RETURN n;
END $f$;