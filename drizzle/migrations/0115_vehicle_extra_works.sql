-- Transporte: serviço de cada obra adicional (caminhão/pickup), mesma posição de extra_client_ids; vazio = rateio do cliente.
ALTER TABLE public.vehicle_schedules ADD COLUMN IF NOT EXISTS extra_work_ids text[] NOT NULL DEFAULT '{}';
