-- Transporte, cliente ADM: local digitado no lugar do serviço (só o nome que aparece; não muda km nem prêmio).
ALTER TABLE public.vehicle_schedules ADD COLUMN IF NOT EXISTS adm_place text;
