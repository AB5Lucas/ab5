-- Frota › Abastecimento › Liberação: data de liberação, data de exclusão e situação (ativo/inativo), editáveis.
-- A nota usa quem estava ativo e entre as duas datas no dia do abastecimento.
ALTER TABLE public.fleet_release_drivers ADD COLUMN IF NOT EXISTS released_at date DEFAULT CURRENT_DATE;
ALTER TABLE public.fleet_release_drivers ADD COLUMN IF NOT EXISTS removed_at date;
ALTER TABLE public.fleet_release_drivers ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;
ALTER TABLE public.fleet_release_vehicles ADD COLUMN IF NOT EXISTS released_at date DEFAULT CURRENT_DATE;
ALTER TABLE public.fleet_release_vehicles ADD COLUMN IF NOT EXISTS removed_at date;
ALTER TABLE public.fleet_release_vehicles ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;
UPDATE public.fleet_release_drivers SET released_at = created_at::date WHERE released_at IS NULL;
UPDATE public.fleet_release_vehicles SET released_at = created_at::date WHERE released_at IS NULL;
