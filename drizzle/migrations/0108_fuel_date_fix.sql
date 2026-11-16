-- Data do abastecimento corrigida no Editar (Frota › Abastecimento); vale no lugar da data do XML.
ALTER TABLE public.fleet_fuel_notes ADD COLUMN IF NOT EXISTS issued_on_fix date;
CREATE INDEX IF NOT EXISTS idx_fleet_fuel_notes_issued_on_fix ON public.fleet_fuel_notes (issued_on_fix) WHERE issued_on_fix IS NOT NULL;
