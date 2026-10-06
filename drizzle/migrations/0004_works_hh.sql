ALTER TABLE public.works ADD COLUMN hh_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE public.works ADD COLUMN hh_rates jsonb NOT NULL DEFAULT '{}'::jsonb;