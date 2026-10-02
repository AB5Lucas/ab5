ALTER TABLE public.works ADD COLUMN IF NOT EXISTS night_shift boolean NOT NULL DEFAULT false;
ALTER TABLE public.rdos ADD COLUMN IF NOT EXISTS shift text NOT NULL DEFAULT 'day';