-- Carro trocado de cliente na Transporte: os passageiros montados para o cliente antigo saem do carro
-- (voltam para a lista da montagem). Antes ficavam presos num carro que não aparecia mais no cliente.
CREATE OR REPLACE FUNCTION public.vehicle_schedules_drop_stale_passengers() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  DELETE FROM transport_passengers tp
   WHERE tp.vehicle_schedule_id = NEW.id
     AND tp.client_id IS DISTINCT FROM NEW.client_id
     AND NOT (tp.client_id::text = ANY (coalesce(NEW.extra_client_ids, '{}')));
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.vehicle_schedules_drop_stale_passengers() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_vehicle_schedules_drop_stale_passengers ON public.vehicle_schedules;
CREATE TRIGGER trg_vehicle_schedules_drop_stale_passengers AFTER UPDATE OF client_id, extra_client_ids ON public.vehicle_schedules
  FOR EACH ROW EXECUTE FUNCTION public.vehicle_schedules_drop_stale_passengers();
