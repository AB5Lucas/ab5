ALTER TABLE public.vehicle_schedules
  ADD COLUMN IF NOT EXISTS extra_client_ids uuid[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS extra_km numeric NOT NULL DEFAULT 0;