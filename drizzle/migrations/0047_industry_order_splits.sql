ALTER TABLE public.industry_orders ADD COLUMN IF NOT EXISTS splits jsonb;
ALTER TABLE public.work_entries ADD COLUMN IF NOT EXISTS industry_part text, ADD COLUMN IF NOT EXISTS industry_part_ref uuid;
CREATE INDEX IF NOT EXISTS work_entries_industry_part_ref ON public.work_entries(industry_part_ref) WHERE industry_part_ref IS NOT NULL;

CREATE OR REPLACE FUNCTION public.industry_part_work(_service text) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
 SELECT w.id FROM works w JOIN clients c ON c.id=w.client_id WHERE c.name ILIKE 'INDUSTRIA' AND w.name=_service LIMIT 1
$$;
REVOKE EXECUTE ON FUNCTION public.industry_part_work(text) FROM PUBLIC, anon, authenticated;

-- Rebuilds the secondary-sector entries of an OP split across sectors and scales the main entries to the main share.
CREATE OR REPLACE FUNCTION public.industry_sync_parts(_oid uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE o record; p jsonb; tot numeric; v_w uuid; inv record; first jsonb; acc numeric; v numeric;
BEGIN
 PERFORM set_config('app.industry_manual','on',true);
 SELECT * INTO o FROM industry_orders WHERE id=_oid;
 DELETE FROM work_entries WHERE industry_part_ref=_oid OR industry_part_ref IN (SELECT id FROM industry_invoices WHERE order_id=_oid);
 IF o.id IS NULL OR o.work_id IS NULL OR jsonb_array_length(coalesce(o.splits,'[]'))<2 THEN RETURN; END IF;
 SELECT sum((e->>'amount')::numeric) INTO tot FROM jsonb_array_elements(o.splits) e;
 IF coalesce(tot,0)=0 THEN RETURN; END IF;
 first := o.splits->0;
 UPDATE work_entries SET amount=round(coalesce((first->>'mp')::numeric,0),2) WHERE industry_order_id=_oid;
 FOR p IN SELECT e FROM jsonb_array_elements(o.splits) WITH ORDINALITY t(e,n) WHERE n>1 LOOP
  v_w := industry_part_work(p->>'service'); IF v_w IS NULL THEN CONTINUE; END IF;
  IF coalesce((p->>'mp')::numeric,0)>0 AND o.order_date IS NOT NULL THEN
   INSERT INTO work_entries(work_id,entry_date,category,description,amount,industry_part,industry_part_ref)
   VALUES(v_w,o.order_date,'ferramentas','Matéria-prima · Pedido '||o.order_number||' · '||o.client_name,round((p->>'mp')::numeric,2),p->>'service',_oid);
  END IF;
 END LOOP;
 FOR inv IN SELECT * FROM industry_invoices WHERE order_id=_oid AND status='posted' LOOP
  acc := 0;
  FOR p IN SELECT e FROM jsonb_array_elements(o.splits) WITH ORDINALITY t(e,n) WHERE n>1 LOOP
   v_w := industry_part_work(p->>'service'); IF v_w IS NULL THEN CONTINUE; END IF;
   v := round(inv.amount*(p->>'amount')::numeric/tot,2); acc := acc+v;
   INSERT INTO work_entries(work_id,entry_date,category,description,amount,industry_part,industry_part_ref)
   VALUES(v_w,inv.issued_at,'faturamento','NF '||inv.invoice_number||' · Pedido '||o.order_number||' · '||inv.client_name,v,p->>'service',inv.id);
  END LOOP;
  UPDATE work_entries SET amount=inv.amount-acc WHERE industry_invoice_id=inv.id;
 END LOOP;
END $f$;
REVOKE EXECUTE ON FUNCTION public.industry_sync_parts(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.billing_protect_sync_entry() RETURNS trigger
LANGUAGE plpgsql SET search_path TO 'public' AS $function$
 BEGIN
 IF coalesce(auth.role(),'') <> 'service_role' AND coalesce(current_setting('app.industry_manual', true),'') <> 'on' AND ((TG_OP <> 'INSERT' AND (OLD.sync_note_id IS NOT NULL OR OLD.industry_order_id IS NOT NULL OR OLD.industry_invoice_id IS NOT NULL OR OLD.industry_part_ref IS NOT NULL)) OR (TG_OP <> 'DELETE' AND (NEW.sync_note_id IS NOT NULL OR NEW.industry_order_id IS NOT NULL OR NEW.industry_invoice_id IS NOT NULL OR NEW.industry_part_ref IS NOT NULL))) THEN RAISE EXCEPTION 'Lançamento sincronizado: alterações somente pela planilha de origem.'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF; END $function$;

-- Split OPs: the order value never grows to the full invoice in one sector.
CREATE OR REPLACE FUNCTION public.industry_fit_work_order() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_num text; v_tot numeric; v_split boolean;
BEGIN
 IF NEW.industry_invoice_id IS NULL OR NEW.category<>'faturamento' OR NEW.work_id IS NULL THEN RETURN NEW; END IF;
 SELECT coalesce(o.order_number, i.order_number), coalesce(jsonb_array_length(o.splits),0)>1 INTO v_num, v_split FROM industry_invoices i
  LEFT JOIN LATERAL (SELECT order_number, splits FROM industry_orders o WHERE o.order_number=i.order_number OR i.order_number=ANY(o.aliases) ORDER BY (o.order_number=i.order_number) DESC LIMIT 1) o ON true
  WHERE i.id=NEW.industry_invoice_id;
 IF v_num IS NULL OR v_split THEN RETURN NEW; END IF;
 SELECT sum(i.amount) INTO v_tot FROM industry_invoices i
  WHERE i.status='posted' AND (i.order_number=v_num OR i.order_number IN (SELECT unnest(aliases) FROM industry_orders WHERE order_number=v_num) OR i.id=NEW.industry_invoice_id);
 UPDATE works w SET orders = (SELECT jsonb_agg(CASE WHEN e->>'number'=v_num AND coalesce(nullif(e->>'value','')::numeric,0) < v_tot THEN jsonb_set(e,'{value}',to_jsonb(round(v_tot,2))) ELSE e END) FROM jsonb_array_elements(w.orders) e)
  WHERE w.id=NEW.work_id AND EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(w.orders,'[]')) e WHERE e->>'number'=v_num AND coalesce(nullif(e->>'value','')::numeric,0) < v_tot);
 RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.industry_mirror_work_order() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE v_ind uuid; v_val numeric; v_date date; v_keep uuid[]; p jsonb; v_w uuid; n int := 0;
BEGIN
 SELECT id INTO v_ind FROM clients WHERE name ILIKE 'INDUSTRIA' LIMIT 1;
 IF v_ind IS NULL THEN RETURN NEW; END IF;
 SELECT coalesce(NEW.order_date, min(i.issued_at), (NEW.ref_month||'-01')::date) INTO v_date FROM industry_invoices i
  WHERE i.order_number=NEW.order_number OR i.order_number=ANY(NEW.aliases);
 IF NEW.work_id IS NOT NULL AND coalesce(jsonb_array_length(NEW.splits),0)>1 THEN
  v_keep := '{}';
  FOR p IN SELECT * FROM jsonb_array_elements(NEW.splits) LOOP
   n := n+1;
   v_w := CASE WHEN n=1 THEN NEW.work_id ELSE industry_part_work(p->>'service') END;
   IF v_w IS NULL OR v_w = ANY(v_keep) THEN CONTINUE; END IF;
   v_keep := v_keep || v_w;
   UPDATE works w SET orders = (SELECT coalesce(jsonb_agg(e),'[]'::jsonb) FROM jsonb_array_elements(coalesce(w.orders,'[]'::jsonb)) e WHERE e->>'number' IS DISTINCT FROM NEW.order_number)
     || jsonb_build_array(jsonb_build_object('date',v_date,'number',NEW.order_number,'value',round((p->>'amount')::numeric,2)))
    WHERE w.id=v_w;
  END LOOP;
  UPDATE works w SET orders = (SELECT coalesce(jsonb_agg(e),'[]'::jsonb) FROM jsonb_array_elements(w.orders) e WHERE e->>'number' IS DISTINCT FROM NEW.order_number)
   WHERE w.client_id=v_ind AND NOT (w.id = ANY(v_keep)) AND jsonb_typeof(w.orders)='array'
     AND EXISTS (SELECT 1 FROM jsonb_array_elements(w.orders) e WHERE e->>'number'=NEW.order_number);
  PERFORM industry_sync_parts(NEW.id);
  RETURN NEW;
 END IF;
 UPDATE works w SET orders = (SELECT coalesce(jsonb_agg(e),'[]'::jsonb) FROM jsonb_array_elements(w.orders) e WHERE e->>'number' IS DISTINCT FROM NEW.order_number)
  WHERE w.client_id=v_ind AND (NEW.work_id IS NULL OR w.id<>NEW.work_id) AND jsonb_typeof(w.orders)='array'
    AND EXISTS (SELECT 1 FROM jsonb_array_elements(w.orders) e WHERE e->>'number'=NEW.order_number);
 PERFORM industry_sync_parts(NEW.id);
 IF NEW.work_id IS NULL THEN RETURN NEW; END IF;
 SELECT greatest(coalesce(NEW.amount,0), coalesce(sum(i.amount),0)) INTO v_val FROM industry_invoices i
  WHERE i.status='posted' AND (i.order_number=NEW.order_number OR i.order_number=ANY(NEW.aliases));
 UPDATE works w SET orders = (SELECT coalesce(jsonb_agg(e),'[]'::jsonb) FROM jsonb_array_elements(coalesce(w.orders,'[]'::jsonb)) e WHERE e->>'number' IS DISTINCT FROM NEW.order_number)
   || jsonb_build_array(jsonb_build_object('date',v_date,'number',NEW.order_number,'value',round(v_val,2)))
  WHERE w.id=NEW.work_id AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(w.orders,'[]'::jsonb)) e
    WHERE e->>'number'=NEW.order_number AND e->>'date'=v_date::text AND round(coalesce(nullif(e->>'value','')::numeric,0),2)=round(v_val,2));
 RETURN NEW;
END $f$;
REVOKE EXECUTE ON FUNCTION public.industry_mirror_work_order() FROM PUBLIC, anon, authenticated;