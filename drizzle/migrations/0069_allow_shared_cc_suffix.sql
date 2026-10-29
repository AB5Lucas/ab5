DROP INDEX IF EXISTS public.works_cc_suffix_uniq;
CREATE INDEX IF NOT EXISTS works_cc_suffix_idx ON public.works(client_id, cc_suffix) WHERE cc_suffix IS NOT NULL;