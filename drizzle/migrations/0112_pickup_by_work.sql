-- Pickups também escolhem cliente, serviço e local na Transporte (como os caminhões).
CREATE OR REPLACE FUNCTION public.vehicles_truck_by_work() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.type IS NOT NULL AND (translate(lower(NEW.type), 'ã', 'a') LIKE 'caminh%' OR lower(NEW.type) LIKE 'pick%') THEN NEW.assign_by_work := true; END IF;
  RETURN NEW;
END $$;
UPDATE public.vehicles SET assign_by_work = true WHERE lower(type) LIKE 'pick%' AND NOT assign_by_work;
