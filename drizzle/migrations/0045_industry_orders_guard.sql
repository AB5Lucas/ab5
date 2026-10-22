-- Pedidos do serviço: mesmo número nunca fica em várias linhas (soma os valores)
CREATE OR REPLACE FUNCTION public.works_consolidate_orders() RETURNS trigger
LANGUAGE plpgsql SET search_path TO 'public' AS $f$
BEGIN
 IF NEW.orders IS NOT NULL AND jsonb_typeof(NEW.orders)='array' AND jsonb_array_length(NEW.orders)>1
    AND (SELECT count(*) <> count(DISTINCT e->>'number') FROM jsonb_array_elements(NEW.orders) e WHERE coalesce(e->>'number','')<>'') THEN
  NEW.orders := (
   SELECT coalesce(jsonb_agg(x ORDER BY x->>'date', x->>'number'),'[]'::jsonb) FROM (
    SELECT jsonb_build_object('date',min(e->>'date'),'number',e->>'number','value',round(sum(coalesce(nullif(e->>'value','')::numeric,0)),2)) x
    FROM jsonb_array_elements(NEW.orders) e WHERE coalesce(e->>'number','')<>'' GROUP BY e->>'number'
    UNION ALL SELECT e FROM jsonb_array_elements(NEW.orders) e WHERE coalesce(e->>'number','')='') s);
 END IF;
 RETURN NEW;
END $f$;
DROP TRIGGER IF EXISTS works_consolidate_orders ON public.works;
CREATE TRIGGER works_consolidate_orders BEFORE INSERT OR UPDATE OF orders ON public.works
FOR EACH ROW EXECUTE FUNCTION public.works_consolidate_orders();

-- Nota da Indústria maior que o pedido: o pedido do serviço passa a valer o total faturado (nunca saldo negativo)
CREATE OR REPLACE FUNCTION public.industry_fit_work_order() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE v_num text; v_tot numeric;
BEGIN
 IF NEW.industry_invoice_id IS NULL OR NEW.category<>'faturamento' OR NEW.work_id IS NULL THEN RETURN NEW; END IF;
 SELECT coalesce(o.order_number, i.order_number) INTO v_num FROM industry_invoices i
  LEFT JOIN LATERAL (SELECT order_number FROM industry_orders o WHERE o.order_number=i.order_number OR i.order_number=ANY(o.aliases) ORDER BY (o.order_number=i.order_number) DESC LIMIT 1) o ON true
  WHERE i.id=NEW.industry_invoice_id;
 IF v_num IS NULL THEN RETURN NEW; END IF;
 SELECT sum(i.amount) INTO v_tot FROM industry_invoices i
  WHERE i.status='posted' AND (i.order_number=v_num OR i.order_number IN (SELECT unnest(aliases) FROM industry_orders WHERE order_number=v_num) OR i.id=NEW.industry_invoice_id);
 UPDATE works w SET orders = (SELECT jsonb_agg(CASE WHEN e->>'number'=v_num AND coalesce(nullif(e->>'value','')::numeric,0) < v_tot THEN jsonb_set(e,'{value}',to_jsonb(round(v_tot,2))) ELSE e END) FROM jsonb_array_elements(w.orders) e)
  WHERE w.id=NEW.work_id AND EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(w.orders,'[]')) e WHERE e->>'number'=v_num AND coalesce(nullif(e->>'value','')::numeric,0) < v_tot);
 RETURN NEW;
END $f$;
REVOKE EXECUTE ON FUNCTION public.industry_fit_work_order() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS industry_fit_work_order ON public.work_entries;
CREATE TRIGGER industry_fit_work_order AFTER INSERT OR UPDATE OF amount, work_id ON public.work_entries
FOR EACH ROW EXECUTE FUNCTION public.industry_fit_work_order();