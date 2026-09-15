ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS requires_integration boolean NOT NULL DEFAULT true;
UPDATE public.clients SET requires_integration = true;
UPDATE public.clients SET requires_integration = false WHERE name ILIKE '%ind%stria%';