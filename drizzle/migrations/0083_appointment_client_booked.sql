-- Bolinha da aba Agendamentos: verde = já agendado na plataforma do cliente.
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS client_booked boolean NOT NULL DEFAULT false;
-- Qualquer mudança de data ou horário exige agendar de novo no cliente: volta a cinza.
CREATE OR REPLACE FUNCTION public.appointments_reset_client_booked() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.scheduled_date IS DISTINCT FROM OLD.scheduled_date OR NEW.scheduled_time IS DISTINCT FROM OLD.scheduled_time THEN
    NEW.client_booked := false;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_appointments_reset_client_booked ON public.appointments;
CREATE TRIGGER trg_appointments_reset_client_booked BEFORE UPDATE ON public.appointments
  FOR EACH ROW EXECUTE FUNCTION public.appointments_reset_client_booked();
