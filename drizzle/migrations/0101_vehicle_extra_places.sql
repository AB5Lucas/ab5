-- Transporte: local digitado em cada obra adicional (mesma posição de extra_client_ids).
-- Usado quando a obra adicional é a Indústria (viagem fora, antigo "Externo"): aparece só o local e conta 100 km.
ALTER TABLE public.vehicle_schedules ADD COLUMN IF NOT EXISTS extra_places text[] NOT NULL DEFAULT '{}';
