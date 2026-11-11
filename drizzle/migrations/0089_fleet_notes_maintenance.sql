-- Frota (menu próprio): Custos, Manutenção e Notas.

-- Mesmas permissões de Transporte para as páginas novas (ajustáveis em Acessos).
INSERT INTO public.role_page_access(role, path, allowed)
SELECT a.role, p.path, a.allowed
FROM public.role_page_access a CROSS JOIN (VALUES ('/frota/custos'), ('/frota/manutencao'), ('/frota/notas')) p(path)
WHERE a.path = '/veiculos/transporte'
ON CONFLICT DO NOTHING;

-- Gastos da frota (Custos) passam a ser lidos por Transporte ou Frota › Custos.
DROP POLICY IF EXISTS fleet_expenses_read ON public.fleet_expenses;
DROP POLICY IF EXISTS fleet_expense_files_read ON public.fleet_expense_files;
CREATE POLICY fleet_expenses_read ON public.fleet_expenses FOR SELECT TO authenticated
  USING ((SELECT public.can_access_page('/frota/custos')) OR (SELECT public.can_access_page('/veiculos/transporte')));
CREATE POLICY fleet_expense_files_read ON public.fleet_expense_files FOR SELECT TO authenticated
  USING ((SELECT public.can_access_page('/frota/custos')) OR (SELECT public.can_access_page('/veiculos/transporte')));

-- Configurações (pastas dos XML e das notas no SharePoint).
CREATE TABLE IF NOT EXISTS public.fleet_settings (
  key text PRIMARY KEY,
  value text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Um abastecimento por XML do posto (nome do arquivo = chave de acesso).
CREATE TABLE IF NOT EXISTS public.fleet_fuel_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  access_key text NOT NULL UNIQUE,
  ref_month text NOT NULL,
  xml_file text NOT NULL,
  issued_at timestamptz,
  nf_number text,
  issuer text,
  plate text,
  km numeric(12,1),
  driver text,
  fuel text,
  quantity numeric(12,3),
  unit_price numeric(12,4),
  total numeric(12,2),
  info text,
  plate_fix text,
  km_fix numeric(12,1),
  driver_fix text,
  note_file text,
  note_match text CHECK (note_match IN ('chave','nf','manual')),
  notes text,
  approved_at timestamptz,
  approved_by uuid,
  approval_notes text,
  allocation jsonb,
  synced_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS fleet_fuel_notes_month ON public.fleet_fuel_notes(ref_month);
CREATE INDEX IF NOT EXISTS fleet_fuel_notes_plate ON public.fleet_fuel_notes(plate, issued_at);

-- Arquivos da pasta de notas de cada mês (para conferir e atribuir).
CREATE TABLE IF NOT EXISTS public.fleet_note_docs (
  ref_month text NOT NULL,
  file_name text NOT NULL,
  item_id text,
  PRIMARY KEY (ref_month, file_name)
);

-- Equivalência centro de custo → item conta (código de 4 dígitos vale para o cliente inteiro).
CREATE TABLE IF NOT EXISTS public.fleet_item_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cc_code text NOT NULL UNIQUE,
  item_account text NOT NULL,
  description text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Manutenção: regra por veículo e revisões feitas.
CREATE TABLE IF NOT EXISTS public.vehicle_maintenance_plans (
  vehicle_id uuid PRIMARY KEY REFERENCES public.vehicles(id) ON DELETE CASCADE,
  interval_km integer,
  interval_months integer,
  base_km numeric(12,1),
  base_date date,
  notes text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.vehicle_maintenance_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,
  service_date date NOT NULL,
  km numeric(12,1),
  kind text NOT NULL DEFAULT 'preventiva' CHECK (kind IN ('preventiva','corretiva')),
  description text,
  cost numeric(12,2),
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS vehicle_maintenance_records_vehicle ON public.vehicle_maintenance_records(vehicle_id, service_date DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.fleet_settings, public.fleet_item_accounts, public.vehicle_maintenance_plans, public.vehicle_maintenance_records TO authenticated;
GRANT SELECT, UPDATE ON public.fleet_fuel_notes TO authenticated;
GRANT SELECT ON public.fleet_note_docs TO authenticated;
GRANT ALL ON public.fleet_settings, public.fleet_fuel_notes, public.fleet_note_docs, public.fleet_item_accounts, public.vehicle_maintenance_plans, public.vehicle_maintenance_records TO service_role;
ALTER TABLE public.fleet_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fleet_fuel_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fleet_note_docs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fleet_item_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicle_maintenance_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicle_maintenance_records ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS fleet_settings_all ON public.fleet_settings;
DROP POLICY IF EXISTS fleet_fuel_notes_read ON public.fleet_fuel_notes;
DROP POLICY IF EXISTS fleet_fuel_notes_update ON public.fleet_fuel_notes;
DROP POLICY IF EXISTS fleet_note_docs_read ON public.fleet_note_docs;
DROP POLICY IF EXISTS fleet_item_accounts_all ON public.fleet_item_accounts;
DROP POLICY IF EXISTS vehicle_maintenance_plans_all ON public.vehicle_maintenance_plans;
DROP POLICY IF EXISTS vehicle_maintenance_records_all ON public.vehicle_maintenance_records;
CREATE POLICY fleet_settings_all ON public.fleet_settings FOR ALL TO authenticated
  USING ((SELECT public.can_access_page('/frota/notas'))) WITH CHECK ((SELECT public.can_access_page('/frota/notas')));
CREATE POLICY fleet_fuel_notes_read ON public.fleet_fuel_notes FOR SELECT TO authenticated
  USING ((SELECT public.can_access_page('/frota/notas')) OR (SELECT public.can_access_page('/frota/manutencao')));
CREATE POLICY fleet_fuel_notes_update ON public.fleet_fuel_notes FOR UPDATE TO authenticated
  USING ((SELECT public.can_access_page('/frota/notas'))) WITH CHECK ((SELECT public.can_access_page('/frota/notas')));
CREATE POLICY fleet_note_docs_read ON public.fleet_note_docs FOR SELECT TO authenticated
  USING ((SELECT public.can_access_page('/frota/notas')));
CREATE POLICY fleet_item_accounts_all ON public.fleet_item_accounts FOR ALL TO authenticated
  USING ((SELECT public.can_access_page('/frota/notas'))) WITH CHECK ((SELECT public.can_access_page('/frota/notas')));
CREATE POLICY vehicle_maintenance_plans_all ON public.vehicle_maintenance_plans FOR ALL TO authenticated
  USING ((SELECT public.can_access_page('/frota/manutencao'))) WITH CHECK ((SELECT public.can_access_page('/frota/manutencao')));
CREATE POLICY vehicle_maintenance_records_all ON public.vehicle_maintenance_records FOR ALL TO authenticated
  USING ((SELECT public.can_access_page('/frota/manutencao'))) WITH CHECK ((SELECT public.can_access_page('/frota/manutencao')));

-- Quem usa a tela só mexe em correções, nota atribuída, observações e aprovação; o XML fica como veio.
CREATE OR REPLACE FUNCTION public.fleet_fuel_notes_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF coalesce(auth.role(), '') = 'service_role' THEN RETURN NEW; END IF;
  NEW.access_key := OLD.access_key; NEW.ref_month := OLD.ref_month; NEW.xml_file := OLD.xml_file;
  NEW.issued_at := OLD.issued_at; NEW.nf_number := OLD.nf_number; NEW.issuer := OLD.issuer;
  NEW.plate := OLD.plate; NEW.km := OLD.km; NEW.driver := OLD.driver; NEW.fuel := OLD.fuel;
  NEW.quantity := OLD.quantity; NEW.unit_price := OLD.unit_price; NEW.total := OLD.total; NEW.info := OLD.info;
  NEW.synced_at := OLD.synced_at;
  IF NEW.approved_at IS NOT NULL AND OLD.approved_at IS NULL THEN
    NEW.approved_at := now(); NEW.approved_by := auth.uid();
  ELSIF NEW.approved_at IS NULL THEN
    NEW.approved_by := NULL; NEW.allocation := NULL;
  ELSE
    NEW.approved_at := OLD.approved_at; NEW.approved_by := OLD.approved_by;
  END IF;
  IF NEW.note_file IS DISTINCT FROM OLD.note_file THEN
    NEW.note_match := CASE WHEN NEW.note_file IS NULL THEN NULL ELSE 'manual' END;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS fleet_fuel_notes_guard ON public.fleet_fuel_notes;
CREATE TRIGGER fleet_fuel_notes_guard BEFORE UPDATE ON public.fleet_fuel_notes FOR EACH ROW EXECUTE FUNCTION public.fleet_fuel_notes_guard();

-- Leitura das pastas de um mês (só o servidor chama): grava os XML, troca a lista de notas e
-- refaz a conferência automática (nome com a chave de acesso; senão o número da NF, se único).
CREATE OR REPLACE FUNCTION public.fleet_fuel_notes_sync(p_month text, p_notes jsonb, p_docs jsonb) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n integer;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('fleet_fuel_notes:' || p_month));
  INSERT INTO fleet_fuel_notes(access_key, ref_month, xml_file, issued_at, nf_number, issuer, plate, km, driver, fuel, quantity, unit_price, total, info, synced_at)
  SELECT r->>'access_key', p_month, r->>'xml_file', nullif(r->>'issued_at','')::timestamptz, nullif(r->>'nf_number',''), nullif(r->>'issuer',''),
         nullif(r->>'plate',''), nullif(r->>'km','')::numeric, nullif(r->>'driver',''), nullif(r->>'fuel',''),
         nullif(r->>'quantity','')::numeric, nullif(r->>'unit_price','')::numeric, nullif(r->>'total','')::numeric, nullif(r->>'info',''), now()
  FROM jsonb_array_elements(p_notes) r
  ON CONFLICT (access_key) DO UPDATE SET ref_month = EXCLUDED.ref_month, xml_file = EXCLUDED.xml_file, issued_at = EXCLUDED.issued_at,
    nf_number = EXCLUDED.nf_number, issuer = EXCLUDED.issuer, plate = EXCLUDED.plate, km = EXCLUDED.km, driver = EXCLUDED.driver,
    fuel = EXCLUDED.fuel, quantity = EXCLUDED.quantity, unit_price = EXCLUDED.unit_price, total = EXCLUDED.total, info = EXCLUDED.info, synced_at = now();
  GET DIAGNOSTICS n = ROW_COUNT;
  -- XML que saiu da pasta some da lista, a não ser que já tenha sido aprovado.
  DELETE FROM fleet_fuel_notes f WHERE f.ref_month = p_month AND f.approved_at IS NULL
    AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_notes) r WHERE r->>'access_key' = f.access_key);
  DELETE FROM fleet_note_docs WHERE ref_month = p_month;
  INSERT INTO fleet_note_docs(ref_month, file_name, item_id)
  SELECT p_month, d->>'name', d->>'id' FROM jsonb_array_elements(p_docs) d ON CONFLICT DO NOTHING;
  UPDATE fleet_fuel_notes f SET note_file = NULL, note_match = NULL
   WHERE f.ref_month = p_month AND f.note_match IN ('chave','nf');
  UPDATE fleet_fuel_notes f SET note_file = d.file_name, note_match = 'chave'
    FROM fleet_note_docs d
   WHERE f.ref_month = p_month AND f.note_file IS NULL AND d.ref_month = p_month AND position(f.access_key IN regexp_replace(d.file_name, '\D', '', 'g')) > 0;
  UPDATE fleet_fuel_notes f SET note_file = m.file_name, note_match = 'nf'
    FROM (
      SELECT f2.id, min(d.file_name) AS file_name
        FROM fleet_fuel_notes f2 JOIN fleet_note_docs d ON d.ref_month = p_month
       WHERE f2.ref_month = p_month AND f2.note_file IS NULL AND f2.nf_number IS NOT NULL
         AND d.file_name ~ ('(^|\D)0*' || ltrim(f2.nf_number, '0') || '(\D|$)')
         AND NOT EXISTS (SELECT 1 FROM fleet_fuel_notes x WHERE x.ref_month = p_month AND x.note_file = d.file_name)
       GROUP BY f2.id HAVING count(*) = 1
    ) m
   WHERE f.id = m.id
     AND (SELECT count(*) FROM fleet_fuel_notes y WHERE y.ref_month = p_month AND y.nf_number = f.nf_number) = 1;
  INSERT INTO fleet_settings(key, value, updated_at) VALUES ('synced:' || p_month, now()::text, now())
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.fleet_fuel_notes_sync(text, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fleet_fuel_notes_sync(text, jsonb, jsonb) TO service_role;
