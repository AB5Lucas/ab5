ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS completed_date date,
  ADD COLUMN IF NOT EXISTS completed_time time without time zone,
  ADD COLUMN IF NOT EXISTS completed_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS original_date date,
  ADD COLUMN IF NOT EXISTS original_time time without time zone,
  ADD COLUMN IF NOT EXISTS reschedules jsonb NOT NULL DEFAULT '[]'::jsonb;

UPDATE public.appointments SET original_date = scheduled_date, original_time = scheduled_time WHERE original_date IS NULL;