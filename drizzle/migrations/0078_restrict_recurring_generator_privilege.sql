CREATE OR REPLACE FUNCTION public.generate_recurring_entries(_work_ids uuid[] DEFAULT NULL)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r record; m date; eid uuid; total integer := 0; service_caller boolean := coalesce(auth.role(),'')='service_role';
BEGIN
 IF NOT service_caller AND (auth.uid() IS NULL OR NOT public.is_active_user()) THEN RAISE EXCEPTION 'Unauthorized'; END IF;
 IF NOT service_caller AND _work_ids IS NULL THEN RAISE EXCEPTION 'Service required'; END IF;
 FOR r IN SELECT * FROM public.work_entry_recurrences WHERE active AND (_work_ids IS NULL OR work_id=ANY(_work_ids)) ORDER BY work_id,id LOOP
  IF NOT service_caller AND NOT public.can_access_work(r.work_id) THEN RAISE EXCEPTION 'Forbidden'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('recurring:'||r.work_id::text,0));
  FOR m IN SELECT generate_series(r.start_month,least(coalesce(r.end_month,current_date),date_trunc('month',current_date)::date),'1 month'::interval)::date LOOP
   IF EXISTS(SELECT 1 FROM public.work_entries WHERE recurrence_id=r.id AND recurrence_month=m) THEN CONTINUE; END IF;
   SELECT id INTO eid FROM public.work_entries WHERE work_id=r.work_id AND category=r.category AND coalesce(description,'')=r.description AND amount=r.amount AND entry_date>=m AND entry_date<(m+interval '1 month') AND recurrence_id IS NULL AND NOT sync_cancelled AND sync_note_id IS NULL AND sync_split_note_id IS NULL AND purchase_cc_id IS NULL AND industry_invoice_id IS NULL AND industry_order_id IS NULL AND split_group IS NULL ORDER BY entry_date,id LIMIT 1 FOR UPDATE;
   IF eid IS NOT NULL THEN
    UPDATE public.work_entries SET recurrence_id=r.id,recurrence_month=m WHERE id=eid;
   ELSE
    INSERT INTO public.work_entries(work_id,entry_date,category,description,amount,recurrence_id,recurrence_month) VALUES(r.work_id,m,r.category,r.description,r.amount,r.id,m);
   END IF;
   total:=total+1;
  END LOOP;
 END LOOP;
 RETURN total;
END $$;
REVOKE ALL ON FUNCTION public.generate_recurring_entries(uuid[]) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.generate_recurring_entries(uuid[]) TO authenticated,service_role;