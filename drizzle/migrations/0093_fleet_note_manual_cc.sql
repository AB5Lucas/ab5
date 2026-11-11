-- Frota › Abastecimento: CC informado à mão no Editar (ex.: diesel comprado à parte, placa fictícia ABC1234).
-- Com CC à mão, o abastecimento vai 100% para esse CC/item conta, sem rateio pela Transporte.
ALTER TABLE public.fleet_fuel_notes ADD COLUMN IF NOT EXISTS cc_fix text;
ALTER TABLE public.fleet_fuel_notes ADD COLUMN IF NOT EXISTS item_account_fix text;
ALTER TABLE public.fleet_fuel_notes ADD COLUMN IF NOT EXISTS cc_label_fix text;

-- Placa fictícia para lançar diesel comprado à parte e afins (inativa: não aparece na programação da Transporte).
INSERT INTO public.vehicles (plate, brand, model, type, passenger_capacity, status, notes)
SELECT 'ABC1234', 'AVULSO', 'Placa fictícia (diesel avulso)', 'Avulso', 0, 'inactive',
       'Placa fictícia para lançar em Frota › Abastecimento compras de combustível fora do posto (diesel comprado à parte etc.).'
WHERE NOT EXISTS (SELECT 1 FROM public.vehicles WHERE upper(replace(plate, '-', '')) IN ('ABC1234', 'ABC1C34'));
