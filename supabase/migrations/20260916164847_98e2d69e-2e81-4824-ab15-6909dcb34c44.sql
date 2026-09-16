ALTER TABLE public.transport_allocations ALTER COLUMN work_id DROP NOT NULL;
ALTER TABLE public.transport_allocations ADD COLUMN IF NOT EXISTS purpose text NOT NULL DEFAULT 'obra';