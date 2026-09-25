ALTER TABLE public.vehicle_schedules ALTER COLUMN extra_client_ids DROP DEFAULT;
ALTER TABLE public.vehicle_schedules ALTER COLUMN extra_client_ids TYPE text[] USING extra_client_ids::text[];
ALTER TABLE public.vehicle_schedules ALTER COLUMN extra_client_ids SET DEFAULT '{}';