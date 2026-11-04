CREATE TABLE public.work_entry_recurrences (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 work_id uuid NOT NULL REFERENCES public.works(id) ON DELETE CASCADE,
 category text NOT NULL CHECK (category IN ('mao_obra','terceiros','materiais','ferramentas','andaimes')),
 description text NOT NULL DEFAULT '',
 amount numeric(15,2) NOT NULL CHECK (amount > 0),
 start_month date NOT NULL CHECK (extract(day from start_month)=1),
 end_month date CHECK (extract(day from end_month)=1 AND end_month >= start_month),
 active boolean NOT NULL DEFAULT true,
 created_by uuid DEFAULT auth.uid(),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(work_id,category,description,amount,start_month)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.work_entry_recurrences TO authenticated;
GRANT ALL ON public.work_entry_recurrences TO service_role;
ALTER TABLE public.work_entry_recurrences ENABLE ROW LEVEL SECURITY;
CREATE POLICY recurrence_read ON public.work_entry_recurrences FOR SELECT TO authenticated USING (public.can_access_work(work_id));
CREATE POLICY recurrence_write ON public.work_entry_recurrences FOR ALL TO authenticated USING (public.can_write() AND public.can_access_work(work_id) AND public.can_access_page('/obras/resultado')) WITH CHECK (public.can_write() AND public.can_access_work(work_id) AND public.can_access_page('/obras/resultado'));
ALTER TABLE public.work_entries ADD COLUMN recurrence_id uuid REFERENCES public.work_entry_recurrences(id);
ALTER TABLE public.work_entries ADD COLUMN recurrence_month date;
ALTER TABLE public.work_entries ADD CONSTRAINT work_entries_recurrence_pair CHECK ((recurrence_id IS NULL AND recurrence_month IS NULL) OR (recurrence_id IS NOT NULL AND recurrence_month IS NOT NULL AND extract(day from recurrence_month)=1));
CREATE UNIQUE INDEX work_entries_recurrence_month_unique ON public.work_entries(recurrence_id,recurrence_month) WHERE recurrence_id IS NOT NULL;
CREATE TRIGGER recurrence_updated BEFORE UPDATE ON public.work_entry_recurrences FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE OR REPLACE FUNCTION public.generate_recurring_entries(_work_ids uuid[] DEFAULT NULL)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r record; m date; eid uuid; total integer := 0; service_caller boolean := coalesce(auth.role(),'')='service_role' OR current_user='postgres' AND auth.uid() IS NULL;
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