CREATE OR REPLACE FUNCTION public.billing_client_normalized(v text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path=public AS $$ SELECT regexp_replace(translate(upper(coalesce(v,'')), 'ÁÀÂÃÉÈÊÍÓÔÕÚÜÇ', 'AAAAEEEIOOOUUC'), '[^A-Z0-9]', '', 'g') $$;
CREATE TABLE public.billing_client_equivalences (
 source_key text PRIMARY KEY,
 source_name text NOT NULL,
 client_id uuid NOT NULL REFERENCES public.clients(id),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT billing_equivalence_source CHECK(source_key=public.billing_client_normalized(source_name) AND length(source_key)>0)
);
GRANT SELECT,INSERT,UPDATE,DELETE ON public.billing_client_equivalences TO authenticated;
GRANT ALL ON public.billing_client_equivalences TO service_role;
ALTER TABLE public.billing_client_equivalences ENABLE ROW LEVEL SECURITY;
CREATE POLICY billing_equivalences_access ON public.billing_client_equivalences FOR ALL TO authenticated USING(public.can_access_page('/relatorios/sincronizacao')) WITH CHECK(public.can_access_page('/relatorios/sincronizacao'));
INSERT INTO public.billing_client_equivalences(source_key,source_name,client_id) SELECT 'SPALJUNDIAI','SPAL JUNDIAI',id FROM public.clients WHERE name='COCA';
CREATE OR REPLACE FUNCTION public.billing_client_key(v text) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT coalesce((SELECT public.billing_client_normalized(c.name) FROM public.billing_client_equivalences e JOIN public.clients c ON c.id=e.client_id WHERE e.source_key=public.billing_client_normalized(v)),public.billing_client_normalized(v))
$$;