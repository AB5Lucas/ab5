CREATE OR REPLACE FUNCTION public.industry_mirror_work_order() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE v_ind uuid; v_date date; l jsonb; v_w uuid; v_main text; v_split boolean;
BEGIN
 SELECT id INTO v_ind FROM clients WHERE name ILIKE 'INDUSTRIA' LIMIT 1;
 IF v_ind IS NULL THEN RETURN NEW; END IF;
 SELECT coalesce(NEW.order_date, min(i.issued_at), (NEW.ref_month||'-01')::date) INTO v_date FROM industry_invoices i
  WHERE i.order_number=NEW.order_number OR i.order_number=ANY(NEW.aliases);
 UPDATE works w SET orders = (SELECT coalesce(jsonb_agg(e),'[]'::jsonb) FROM jsonb_array_elements(w.orders) e WHERE e->>'number' IS DISTINCT FROM NEW.order_number)
  WHERE w.client_id=v_ind AND jsonb_typeof(w.orders)='array'
    AND EXISTS (SELECT 1 FROM jsonb_array_elements(w.orders) e WHERE e->>'number'=NEW.order_number);
 PERFORM industry_sync_parts(NEW.id);
 IF NEW.work_id IS NULL THEN RETURN NEW; END IF;
 v_split := coalesce(jsonb_array_length(NEW.splits),0)>1;
 v_main := NEW.splits->0->>'service';
 IF jsonb_array_length(coalesce(NEW.lines,'[]'))=0 THEN
  UPDATE works SET orders = coalesce(orders,'[]'::jsonb) || jsonb_build_array(jsonb_build_object('date',v_date,'number',NEW.order_number,'value',round(coalesce(NEW.amount,0),2))) WHERE id=NEW.work_id;
  RETURN NEW;
 END IF;
 -- Every spreadsheet line is its own entry with its exact value, dated like the order (sheet month).
 FOR l IN SELECT * FROM jsonb_array_elements(NEW.lines) LOOP
  v_w := CASE WHEN NOT v_split OR l->>'service' = v_main OR coalesce(l->>'service','')='' THEN NEW.work_id ELSE industry_part_work(l->>'service') END;
  IF v_w IS NULL THEN v_w := NEW.work_id; END IF;
  UPDATE works SET orders = coalesce(orders,'[]'::jsonb) || jsonb_build_array(jsonb_build_object('date',v_date,'number',NEW.order_number,'value',round(coalesce((l->>'amount')::numeric,0),2))) WHERE id=v_w;
 END LOOP;
 RETURN NEW;
END $f$;
REVOKE EXECUTE ON FUNCTION public.industry_mirror_work_order() FROM PUBLIC, anon, authenticated;