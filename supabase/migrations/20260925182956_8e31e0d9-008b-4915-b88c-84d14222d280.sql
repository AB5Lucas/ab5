ALTER TABLE public.vehicle_schedules
  ADD COLUMN IF NOT EXISTS trips integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS is_suzano_local boolean NOT NULL DEFAULT false;
UPDATE public.vehicle_schedules vs SET trips = GREATEST(1, COALESCE(c.trips_per_day, 1))
FROM public.clients c WHERE c.id = vs.client_id AND COALESCE(c.trips_per_day, 1) > 1;