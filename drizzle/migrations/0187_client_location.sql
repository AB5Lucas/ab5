-- Ponto do cliente no mapa (visão geral de Atividades); preenchido pelo endereço (OpenStreetMap) ou pelas fotos do Google Maps.
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS lat double precision, ADD COLUMN IF NOT EXISTS lon double precision;
