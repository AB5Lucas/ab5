CREATE OR REPLACE FUNCTION public.industry_mirror_work_order() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE v_ind uuid; v_val numeric; v_date date;
BEGIN
 SELECT id INTO v_ind FROM clients WHERE name ILIKE 'INDUSTRIA' LIMIT 1;
 IF v_ind IS NULL THEN RETURN NEW; END IF;
 -- Remove o pedido de qualquer outro serviço da Indústria (ex.: mudou de PPO para Carrinhos)
 UPDATE works w SET orders = (SELECT coalesce(jsonb_agg(e),'[]'::jsonb) FROM jsonb_array_elements(w.orders) e WHERE e->>'number' IS DISTINCT FROM NEW.order_number)
  WHERE w.client_id=v_ind AND (NEW.work_id IS NULL OR w.id<>NEW.work_id) AND jsonb_typeof(w.orders)='array'
    AND EXISTS (SELECT 1 FROM jsonb_array_elements(w.orders) e WHERE e->>'number'=NEW.order_number);
 IF NEW.work_id IS NULL THEN RETURN NEW; END IF;
 -- Valor = planilha, nunca abaixo do total já faturado
 SELECT greatest(coalesce(NEW.amount,0), coalesce(sum(i.amount),0)) INTO v_val FROM industry_invoices i
  WHERE i.status='posted' AND (i.order_number=NEW.order_number OR i.order_number=ANY(NEW.aliases));
 SELECT coalesce(NEW.order_date, min(i.issued_at), (NEW.ref_month||'-01')::date) INTO v_date FROM industry_invoices i
  WHERE i.order_number=NEW.order_number OR i.order_number=ANY(NEW.aliases);
 UPDATE works w SET orders = (SELECT coalesce(jsonb_agg(e),'[]'::jsonb) FROM jsonb_array_elements(coalesce(w.orders,'[]'::jsonb)) e WHERE e->>'number' IS DISTINCT FROM NEW.order_number)
   || jsonb_build_array(jsonb_build_object('date',v_date,'number',NEW.order_number,'value',round(v_val,2)))
  WHERE w.id=NEW.work_id AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(w.orders,'[]'::jsonb)) e
    WHERE e->>'number'=NEW.order_number AND e->>'date'=v_date::text AND round(coalesce(nullif(e->>'value','')::numeric,0),2)=round(v_val,2));
 RETURN NEW;
END $f$;
REVOKE EXECUTE ON FUNCTION public.industry_mirror_work_order() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS industry_mirror_work_order ON public.industry_orders;
CREATE TRIGGER industry_mirror_work_order AFTER INSERT OR UPDATE ON public.industry_orders
FOR EACH ROW EXECUTE FUNCTION public.industry_mirror_work_order();
UPDATE public.industry_orders SET updated_at=now() WHERE ref_month='2026-10';