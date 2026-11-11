-- Manutenção (Transporte): veículo próprio ou alugado, com locação mensal.
ALTER TABLE public.vehicles ADD COLUMN IF NOT EXISTS ownership text NOT NULL DEFAULT 'proprio';
ALTER TABLE public.vehicles ADD COLUMN IF NOT EXISTS monthly_rent numeric(12,2) NOT NULL DEFAULT 0;
DO $$ BEGIN
  ALTER TABLE public.vehicles ADD CONSTRAINT vehicles_ownership_check CHECK (ownership IN ('proprio','alugado'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Gastos reais lidos das planilhas de Compras (combustível do posto, manutenção do Romildo).
CREATE TABLE IF NOT EXISTS public.fleet_expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL CHECK (source IN ('combustivel','manutencao')),
  plate text NOT NULL,
  expense_date date NOT NULL,
  amount numeric(12,2) NOT NULL,
  document text,
  description text,
  file_path text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS fleet_expenses_date ON public.fleet_expenses(expense_date, plate);
CREATE TABLE IF NOT EXISTS public.fleet_expense_files (
  file_path text PRIMARY KEY,
  source text NOT NULL,
  rows integer NOT NULL DEFAULT 0,
  synced_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.fleet_expenses, public.fleet_expense_files TO authenticated;
GRANT ALL ON public.fleet_expenses, public.fleet_expense_files TO service_role;
ALTER TABLE public.fleet_expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fleet_expense_files ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS fleet_expenses_read ON public.fleet_expenses;
DROP POLICY IF EXISTS fleet_expense_files_read ON public.fleet_expense_files;
CREATE POLICY fleet_expenses_read ON public.fleet_expenses FOR SELECT TO authenticated USING ((SELECT public.can_access_page('/veiculos/transporte')));
CREATE POLICY fleet_expense_files_read ON public.fleet_expense_files FOR SELECT TO authenticated USING ((SELECT public.can_access_page('/veiculos/transporte')));

-- Troca, de uma vez, todas as linhas de uma planilha pelas lidas agora (só o servidor chama).
CREATE OR REPLACE FUNCTION public.fleet_expenses_replace(p_source text, p_file text, p_rows jsonb) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n integer;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('fleet_expenses:' || p_file));
  DELETE FROM fleet_expenses WHERE file_path = p_file;
  INSERT INTO fleet_expenses(source, plate, expense_date, amount, document, description, file_path)
  SELECT p_source, r->>'plate', (r->>'date')::date, (r->>'amount')::numeric, nullif(r->>'document',''), nullif(r->>'description',''), p_file
  FROM jsonb_array_elements(p_rows) r;
  GET DIAGNOSTICS n = ROW_COUNT;
  INSERT INTO fleet_expense_files(file_path, source, rows, synced_at) VALUES (p_file, p_source, n, now())
  ON CONFLICT (file_path) DO UPDATE SET rows = EXCLUDED.rows, synced_at = now(), source = EXCLUDED.source;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.fleet_expenses_replace(text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fleet_expenses_replace(text, text, jsonb) TO service_role;
