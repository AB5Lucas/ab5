DO $migration$
DECLARE definition text; original text; block text;
BEGIN
 original := pg_get_functiondef('public.industry_sync_apply(uuid,text,text,text,jsonb)'::regprocedure);
 block := $old$   IF coalesce((r->>'mp')::numeric,0)>0 AND r->>'date' IS NOT NULL THEN
    INSERT INTO work_entries(work_id,entry_date,category,description,amount,industry_order_id)
    VALUES(wid,(r->>'date')::date,'ferramentas','Matéria-prima · Pedido '||array_to_string(ARRAY[r->>'order']||v_al,' / ')||' · '||(r->>'client'),(r->>'mp')::numeric,v_oid)
    ON CONFLICT(industry_order_id) WHERE industry_order_id IS NOT NULL DO UPDATE SET category=EXCLUDED.category,work_id=EXCLUDED.work_id,entry_date=EXCLUDED.entry_date,description=EXCLUDED.description,amount=EXCLUDED.amount,updated_at=now();
   ELSE DELETE FROM work_entries WHERE industry_order_id=v_oid; END IF;$old$;
 definition := replace(original, block, '   -- raw_material is informational; ABCOM003 purchases own these costs.');
 IF definition=original THEN RAISE EXCEPTION 'industry_sync_apply MP block not found'; END IF;
 EXECUTE definition;
 original := pg_get_functiondef('public.industry_order_assign(uuid,uuid)'::regprocedure);
 block := $old$ IF coalesce(o.raw_material,0)>0 AND o.order_date IS NOT NULL THEN
  INSERT INTO work_entries(work_id,entry_date,category,description,amount,industry_order_id)
  VALUES(_work,o.order_date,'ferramentas','Matéria-prima · Pedido '||array_to_string(ARRAY[o.order_number]||coalesce(o.aliases,'{}'),' / ')||' · '||o.client_name,o.raw_material,o.id)
  ON CONFLICT(industry_order_id) WHERE industry_order_id IS NOT NULL DO UPDATE SET work_id=EXCLUDED.work_id,updated_at=now();
 END IF;$old$;
 definition := replace(original, block, ' -- raw_material is informational; no costs from order assignment.');
 IF definition=original THEN RAISE EXCEPTION 'industry_order_assign MP block not found'; END IF;
 EXECUTE definition;
 original := pg_get_functiondef('public.industry_sync_parts(uuid)'::regprocedure);
 block := $old$ first := o.splits->0;
 UPDATE work_entries SET amount=round(coalesce((first->>'mp')::numeric,0),2) WHERE industry_order_id=_oid;
 FOR p IN SELECT e FROM jsonb_array_elements(o.splits) WITH ORDINALITY t(e,n) WHERE n>1 LOOP
  v_w := industry_part_work(p->>'service'); IF v_w IS NULL THEN CONTINUE; END IF;
  IF coalesce((p->>'mp')::numeric,0)>0 AND o.order_date IS NOT NULL THEN
   INSERT INTO work_entries(work_id,entry_date,category,description,amount,industry_part,industry_part_ref)
   VALUES(v_w,o.order_date,'ferramentas','Matéria-prima · Pedido '||o.order_number||' · '||o.client_name,round((p->>'mp')::numeric,2),p->>'service',_oid);
  END IF;
 END LOOP;$old$;
 definition := replace(original, block, ' -- Split invoices only; raw_material never generates work_entries.');
 IF definition=original THEN RAISE EXCEPTION 'industry_sync_parts MP block not found'; END IF;
 EXECUTE definition;
END $migration$;
COMMENT ON COLUMN public.industry_orders.raw_material IS 'Informational source value only; costs are exclusively imported from ABCOM003 purchases.';
CREATE OR REPLACE FUNCTION public.purchase_replace_entries(_line uuid, _entries jsonb, _status text, _reason text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $function$
DECLARE line public.purchase_cc_lines; n integer; item jsonb;
BEGIN
 IF coalesce(auth.role(),'') <> 'service_role' THEN RAISE EXCEPTION 'Unauthorized'; END IF;
 SELECT * INTO line FROM public.purchase_cc_lines WHERE id=_line FOR UPDATE;
 IF line.id IS NULL THEN RAISE EXCEPTION 'Purchase CC not found'; END IF;
 IF _status NOT IN ('launched','pending') OR jsonb_typeof(_entries)<>'array' THEN RAISE EXCEPTION 'Invalid purchase replacement'; END IF;
 IF _status='launched' AND (jsonb_array_length(_entries)=0 OR round(line.amount,2)<>(SELECT coalesce(sum((e->>'amount')::numeric),0) FROM jsonb_array_elements(_entries) e)) THEN RAISE EXCEPTION 'Purchase totals do not match'; END IF;
 IF _status='pending' AND jsonb_array_length(_entries)<>0 THEN RAISE EXCEPTION 'Pending purchase has entries'; END IF;
 FOR item IN SELECT * FROM jsonb_array_elements(_entries) LOOP
  IF item->>'category' NOT IN ('materiais','andaimes') OR nullif(item->>'description','') IS NULL OR nullif(item->>'work_id','') IS NULL THEN RAISE EXCEPTION 'Invalid purchase item'; END IF;
 END LOOP;
 DELETE FROM public.work_entries WHERE purchase_cc_id=_line;
 INSERT INTO public.work_entries(work_id,entry_date,competence_month,category,amount,description,purchase_cc_id,split_group,split_total,split_note)
 SELECT (e->>'work_id')::uuid,(e->>'entry_date')::date,line.ref_month,e->>'category',(e->>'amount')::numeric,e->>'description',line.id,(e->>'split_group')::uuid,(e->>'split_total')::numeric,e->>'split_note' FROM jsonb_array_elements(_entries) e;
 GET DIAGNOSTICS n=ROW_COUNT;
 UPDATE public.purchase_cc_lines SET status=_status,reason=_reason WHERE id=_line;
 RETURN n;
END $function$;
REVOKE ALL ON FUNCTION public.purchase_replace_entries(uuid,jsonb,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purchase_replace_entries(uuid,jsonb,text,text) TO service_role;