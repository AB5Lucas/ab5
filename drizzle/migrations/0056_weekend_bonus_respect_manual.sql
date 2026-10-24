CREATE OR REPLACE FUNCTION public.weekend_vehicle_bonus()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public'
AS $function$
BEGIN
  -- Only turn the bonus on when the driver changes on a weekend and the user did not set the bonus explicitly.
  IF TG_OP = 'UPDATE' AND extract(dow from NEW.schedule_date) IN (0,6) AND NEW.driver_id IS NOT NULL
     AND NEW.client_id IS NOT NULL AND NOT NEW.is_external AND NOT NEW.is_maintenance
     AND NEW.driver_id IS DISTINCT FROM OLD.driver_id
     AND NEW.driver_bonus IS NOT DISTINCT FROM OLD.driver_bonus THEN
    NEW.driver_bonus := true;
  END IF;
  RETURN NEW;
END $function$;