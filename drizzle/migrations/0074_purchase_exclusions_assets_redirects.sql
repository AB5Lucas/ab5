CREATE TABLE public.purchase_exclusion_rules (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), match_type text NOT NULL CHECK (match_type IN ('code','prefix')), value text NOT NULL, reason text NOT NULL, active boolean NOT NULL DEFAULT true, UNIQUE(match_type,value));
GRANT SELECT,INSERT,UPDATE,DELETE ON public.purchase_exclusion_rules TO authenticated;
GRANT ALL ON public.purchase_exclusion_rules TO service_role;
ALTER TABLE public.purchase_exclusion_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY purchase_rules_read ON public.purchase_exclusion_rules FOR SELECT TO authenticated USING(public.can_access_page('/obras/compras'));
CREATE POLICY purchase_rules_write ON public.purchase_exclusion_rules FOR ALL TO authenticated USING(public.can_access_page('/obras/compras') AND public.can_write()) WITH CHECK(public.can_access_page('/obras/compras') AND public.can_write());
CREATE TABLE public.purchase_cc_redirects (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), source_cc text NOT NULL UNIQUE, target_cc text NOT NULL, active boolean NOT NULL DEFAULT true, CHECK(source_cc<>target_cc));
GRANT SELECT,INSERT,UPDATE,DELETE ON public.purchase_cc_redirects TO authenticated;
GRANT ALL ON public.purchase_cc_redirects TO service_role;
ALTER TABLE public.purchase_cc_redirects ENABLE ROW LEVEL SECURITY;
CREATE POLICY purchase_redirect_read ON public.purchase_cc_redirects FOR SELECT TO authenticated USING(public.can_access_page('/obras/compras'));
CREATE POLICY purchase_redirect_write ON public.purchase_cc_redirects FOR ALL TO authenticated USING(public.can_access_page('/obras/compras') AND public.can_write()) WITH CHECK(public.can_access_page('/obras/compras') AND public.can_write());
CREATE TABLE public.purchase_asset_decisions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), purchase_cc_id uuid NOT NULL REFERENCES public.purchase_cc_lines(id) ON DELETE CASCADE, item_key text NOT NULL, is_asset boolean NOT NULL DEFAULT true, mode text NOT NULL DEFAULT 'pending' CHECK(mode IN ('pending','integral','installments')), months integer NOT NULL DEFAULT 12 CHECK(months BETWEEN 1 AND 120), monthly_amount numeric, category text NOT NULL DEFAULT 'materiais' CHECK(category IN ('materiais','transporte','andaimes','ferramentas','mo')), decided_amount numeric NOT NULL DEFAULT 0, decided_by uuid, updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(purchase_cc_id,item_key));
GRANT SELECT ON public.purchase_asset_decisions TO authenticated;
GRANT ALL ON public.purchase_asset_decisions TO service_role;
ALTER TABLE public.purchase_asset_decisions ENABLE ROW LEVEL SECURITY;
CREATE POLICY purchase_asset_read ON public.purchase_asset_decisions FOR SELECT TO authenticated USING(public.can_access_page('/obras/compras'));
ALTER TABLE public.purchase_cc_lines ADD COLUMN excluded_amount numeric NOT NULL DEFAULT 0, ADD COLUMN pending_amount numeric NOT NULL DEFAULT 0, ADD COLUMN launched_amount numeric NOT NULL DEFAULT 0, ADD COLUMN effective_cc text, ADD COLUMN item_states jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.work_entries ADD COLUMN purchase_item_key text;
CREATE OR REPLACE FUNCTION public.purchase_replace_entries(_line uuid,_entries jsonb,_status text,_reason text) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE line public.purchase_cc_lines; n integer; item jsonb; total numeric; states_total numeric;
BEGIN
 IF coalesce(auth.role(),'')<>'service_role' THEN RAISE EXCEPTION 'Unauthorized'; END IF;
 SELECT * INTO line FROM public.purchase_cc_lines WHERE id=_line FOR UPDATE;
 IF line.id IS NULL THEN RAISE EXCEPTION 'Purchase CC not found'; END IF;
 IF _status NOT IN ('launched','pending') OR jsonb_typeof(_entries)<>'array' THEN RAISE EXCEPTION 'Invalid purchase replacement'; END IF;
 SELECT coalesce(sum((e->>'amount')::numeric),0) INTO total FROM jsonb_array_elements(_entries) e;
 SELECT coalesce(sum((s->>'excluded')::numeric+(s->>'pending')::numeric+(s->>'launched')::numeric),0) INTO states_total FROM jsonb_array_elements(line.item_states) s;
 IF round(line.amount,2)<>round(line.excluded_amount+line.pending_amount+line.launched_amount,2) OR round(total,2)<>round(line.amount-line.excluded_amount-line.pending_amount,2) OR round(states_total,2)<>round(line.amount,2) THEN RAISE EXCEPTION 'Purchase totals do not match: report minus excluded minus pending'; END IF;
 FOR item IN SELECT * FROM jsonb_array_elements(_entries) LOOP
  IF item->>'category' NOT IN ('materiais','andaimes','transporte','terceiros','mao_obra','ferramentas') OR nullif(item->>'description','') IS NULL OR nullif(item->>'purchase_item_key','') IS NULL OR NOT EXISTS(SELECT 1 FROM public.works WHERE id=(item->>'work_id')::uuid) THEN RAISE EXCEPTION 'Invalid purchase item'; END IF;
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(line.item_states) s WHERE s->>'key'=item->>'purchase_item_key' AND s->>'status'='launched') THEN RAISE EXCEPTION 'Excluded or pending item cannot be posted'; END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(line.item_states) s WHERE round((s->>'launched')::numeric,2)<>round((SELECT coalesce(sum((e->>'amount')::numeric),0) FROM jsonb_array_elements(_entries) e WHERE e->>'purchase_item_key'=s->>'key'),2)) THEN RAISE EXCEPTION 'Purchase item totals do not match'; END IF;
 DELETE FROM public.work_entries WHERE purchase_cc_id=_line;
 INSERT INTO public.work_entries(work_id,entry_date,competence_month,category,amount,description,purchase_cc_id,purchase_item_key,split_group,split_total,split_note)
 SELECT (e->>'work_id')::uuid,(e->>'entry_date')::date,coalesce(e->>'competence_month',line.ref_month),e->>'category',(e->>'amount')::numeric,e->>'description',line.id,e->>'purchase_item_key',(e->>'split_group')::uuid,(e->>'split_total')::numeric,e->>'split_note' FROM jsonb_array_elements(_entries) e;
 GET DIAGNOSTICS n=ROW_COUNT;
 UPDATE public.purchase_cc_lines SET status=_status,reason=_reason WHERE id=_line;
 RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.purchase_replace_entries(uuid,jsonb,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.purchase_replace_entries(uuid,jsonb,text,text) TO service_role;