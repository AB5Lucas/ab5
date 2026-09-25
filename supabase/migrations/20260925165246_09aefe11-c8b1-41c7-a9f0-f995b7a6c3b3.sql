UPDATE public.vehicle_schedules SET km = 100 WHERE is_external = true AND km = 200;
UPDATE public.vehicle_schedules v SET km = 50
FROM public.clients c
WHERE c.id = v.client_id AND v.is_external = false AND v.km = 100
  AND (c.name ILIKE 'industria%' OR c.name ILIKE 'indústria%');