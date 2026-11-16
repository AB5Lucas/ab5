-- Todo veículo do tipo Caminhão escolhe cliente e serviço na Transporte (assign_by_work), inclusive os que entrarem depois.
CREATE OR REPLACE FUNCTION public.vehicles_truck_by_work() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.type IS NOT NULL AND translate(lower(NEW.type), 'ã', 'a') LIKE 'caminh%' THEN NEW.assign_by_work := true; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_vehicles_truck_by_work ON public.vehicles;
CREATE TRIGGER trg_vehicles_truck_by_work BEFORE INSERT OR UPDATE ON public.vehicles FOR EACH ROW EXECUTE FUNCTION public.vehicles_truck_by_work();
UPDATE public.vehicles SET assign_by_work = true WHERE translate(lower(type), 'ã', 'a') LIKE 'caminh%' AND NOT assign_by_work;
