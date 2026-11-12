-- Frota › Abastecimento: o Editar aceita mais de um centro de custo, cada um com a sua %.
-- cc_split = [{cc_code, item_account, label, pct}]; com linhas, o valor vai para esses CCs, sem rateio pela Transporte.
ALTER TABLE public.fleet_fuel_notes ADD COLUMN IF NOT EXISTS cc_split jsonb;
-- O CC único que já existia (cc_fix) passa para a lista.
UPDATE public.fleet_fuel_notes SET cc_split = jsonb_build_array(jsonb_build_object('cc_code', cc_fix, 'item_account', item_account_fix, 'label', cc_label_fix, 'pct', 100))
WHERE cc_fix IS NOT NULL AND cc_split IS NULL;
