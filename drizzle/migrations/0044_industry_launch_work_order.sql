CREATE OR REPLACE FUNCTION public.industry_add_work_order(_work uuid, _number text, _date date, _value numeric) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $f$
 UPDATE works SET orders = coalesce(orders,'[]'::jsonb) || jsonb_build_array(jsonb_build_object('date',_date,'number',_number,'value',_value))
 WHERE id=_work AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(orders,'[]'::jsonb)) e WHERE e->>'number'=_number);
$f$;
REVOKE EXECUTE ON FUNCTION public.industry_add_work_order(uuid,text,date,numeric) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.industry_invoice_launch(_invoice uuid, _work uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE i record; v_ord text; v_oid uuid; o record; n int;
BEGIN
 IF NOT (public.can_access_page('/relatorios/sincronizacao') OR public.can_access_page('/fechamentos/suzano')) THEN RAISE EXCEPTION 'Sem acesso'; END IF;
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
END $f$;
GRANT EXECUTE ON FUNCTION public.industry_invoice_launch(uuid,uuid) TO authenticated;

SELECT public.industry_add_work_order(o.manual_work_id, o.order_number, o.order_date, o.amount) FROM industry_orders o WHERE o.manual_work_id IS NOT NULL;