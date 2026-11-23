-- Transporte: "Revisão" no seletor do veículo, como a Manutenção (is_maintenance, 0 km, sem prêmios); maintenance_kind diferencia.
ALTER TABLE public.vehicle_schedules ADD COLUMN IF NOT EXISTS maintenance_kind text;
ALTER TABLE public.vehicle_schedules DROP CONSTRAINT IF EXISTS vehicle_schedules_maintenance_kind_check;
ALTER TABLE public.vehicle_schedules ADD CONSTRAINT vehicle_schedules_maintenance_kind_check CHECK (maintenance_kind IS NULL OR maintenance_kind IN ('manutencao', 'revisao'));
