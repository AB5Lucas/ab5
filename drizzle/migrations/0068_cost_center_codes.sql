ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS cc_prefix text;
ALTER TABLE public.works ADD COLUMN IF NOT EXISTS cc_suffix text;
ALTER TABLE public.clients ADD CONSTRAINT clients_cc_prefix_fmt CHECK (cc_prefix IS NULL OR cc_prefix ~ '^[0-9]{4}$');
ALTER TABLE public.works ADD CONSTRAINT works_cc_suffix_fmt CHECK (cc_suffix IS NULL OR cc_suffix ~ '^[0-9]{3}$');
CREATE UNIQUE INDEX IF NOT EXISTS clients_cc_prefix_uniq ON public.clients(cc_prefix) WHERE cc_prefix IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS works_cc_suffix_uniq ON public.works(client_id, cc_suffix) WHERE cc_suffix IS NOT NULL;