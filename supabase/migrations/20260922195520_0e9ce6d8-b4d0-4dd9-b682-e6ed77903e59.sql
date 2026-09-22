UPDATE public.vehicle_schedules vs
SET km = CASE
  WHEN vs.is_external THEN 200
  WHEN c.name ~* 'ind[uú]stria' THEN 100
  ELSE COALESCE(c.distance_km, 0)
END
FROM public.clients c
WHERE vs.client_id = c.id;

UPDATE public.vehicle_schedules
SET km = 200
WHERE is_external = true;