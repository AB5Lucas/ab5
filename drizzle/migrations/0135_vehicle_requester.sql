-- Transporte (caminhão/pickup): Solicitante do frete + toggle Motorista; driver_id continua sendo o motorista que vale
-- (o marcado no toggle, senão o solicitante), por isso prêmio, CNH e ranking não mudam.
ALTER TABLE public.vehicle_schedules ADD COLUMN IF NOT EXISTS requester_id uuid;
ALTER TABLE public.vehicle_schedules ADD COLUMN IF NOT EXISTS driver_toggle boolean NOT NULL DEFAULT false;
ALTER TABLE public.vehicle_schedules ADD COLUMN IF NOT EXISTS extra_requester_ids text[] NOT NULL DEFAULT '{}';
ALTER TABLE public.vehicle_schedules ADD COLUMN IF NOT EXISTS extra_driver_toggles boolean[] NOT NULL DEFAULT '{}';
