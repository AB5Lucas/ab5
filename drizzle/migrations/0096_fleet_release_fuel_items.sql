-- Frota › Abastecimento
-- 1) Liberação: motoristas e placas liberados no posto (o nome e a placa da nota casam primeiro com esta lista).
CREATE TABLE IF NOT EXISTS public.fleet_release_drivers (
  collaborator_id uuid PRIMARY KEY REFERENCES public.collaborators(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.fleet_release_vehicles (
  vehicle_id uuid PRIMARY KEY REFERENCES public.vehicles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.fleet_release_drivers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fleet_release_vehicles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS fleet_release_drivers_all ON public.fleet_release_drivers;
CREATE POLICY fleet_release_drivers_all ON public.fleet_release_drivers FOR ALL TO authenticated
  USING ((SELECT can_access_page('/frota/notas'))) WITH CHECK ((SELECT can_access_page('/frota/notas')));
DROP POLICY IF EXISTS fleet_release_vehicles_all ON public.fleet_release_vehicles;
CREATE POLICY fleet_release_vehicles_all ON public.fleet_release_vehicles FOR ALL TO authenticated
  USING ((SELECT can_access_page('/frota/notas'))) WITH CHECK ((SELECT can_access_page('/frota/notas')));

-- 2) Uma linha por item de combustível do XML (ex.: Diesel + Arla = duas linhas, cada uma com a sua placa).
ALTER TABLE public.fleet_fuel_notes ADD COLUMN IF NOT EXISTS item_no integer NOT NULL DEFAULT 1;
ALTER TABLE public.fleet_fuel_notes DROP CONSTRAINT IF EXISTS fleet_fuel_notes_access_key_key;
ALTER TABLE public.fleet_fuel_notes DROP CONSTRAINT IF EXISTS fleet_fuel_notes_access_key_item_key;
ALTER TABLE public.fleet_fuel_notes ADD CONSTRAINT fleet_fuel_notes_access_key_item_key UNIQUE (access_key, item_no);

CREATE OR REPLACE FUNCTION public.fleet_fuel_notes_guard()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public'
AS $function$
BEGIN
  IF coalesce(auth.role(), '') = 'service_role' THEN RETURN NEW; END IF;
  NEW.access_key := OLD.access_key; NEW.item_no := OLD.item_no; NEW.ref_month := OLD.ref_month; NEW.xml_file := OLD.xml_file;
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
END $function$;

-- A foto é de um XML: a ligação é feita no item 1 e copiada para os outros itens do mesmo XML.
CREATE OR REPLACE FUNCTION public.fleet_fuel_notes_sync(p_month text, p_notes jsonb, p_docs jsonb)
 RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE n integer;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('fleet_fuel_notes:' || p_month));
  INSERT INTO fleet_fuel_notes(access_key, item_no, ref_month, xml_file, issued_at, nf_number, issuer, plate, km, driver, fuel, quantity, unit_price, total, info, synced_at)
  SELECT r->>'access_key', coalesce(nullif(r->>'item_no','')::int, 1), p_month, r->>'xml_file', nullif(r->>'issued_at','')::timestamptz, nullif(r->>'nf_number',''), nullif(r->>'issuer',''),
         nullif(r->>'plate',''), nullif(r->>'km','')::numeric, nullif(r->>'driver',''), nullif(r->>'fuel',''),
         nullif(r->>'quantity','')::numeric, nullif(r->>'unit_price','')::numeric, nullif(r->>'total','')::numeric, nullif(r->>'info',''), now()
  FROM jsonb_array_elements(p_notes) r
  ON CONFLICT (access_key, item_no) DO UPDATE SET ref_month = EXCLUDED.ref_month, xml_file = EXCLUDED.xml_file, issued_at = EXCLUDED.issued_at,
    nf_number = EXCLUDED.nf_number, issuer = EXCLUDED.issuer, plate = EXCLUDED.plate, km = EXCLUDED.km, driver = EXCLUDED.driver,
    fuel = EXCLUDED.fuel, quantity = EXCLUDED.quantity, unit_price = EXCLUDED.unit_price, total = EXCLUDED.total, info = EXCLUDED.info, synced_at = now();
  GET DIAGNOSTICS n = ROW_COUNT;
  DELETE FROM fleet_fuel_notes f WHERE f.ref_month = p_month AND f.approved_at IS NULL
    AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_notes) r
                     WHERE r->>'access_key' = f.access_key AND coalesce(nullif(r->>'item_no','')::int, 1) = f.item_no);

  DELETE FROM fleet_note_docs d WHERE d.ref_month = p_month
    AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_docs) x WHERE x->>'name' = d.file_name);
  INSERT INTO fleet_note_docs(ref_month, file_name, item_id, read_nf, read_key, read_plate, read_total, read_at, read_error)
  SELECT p_month, x->>'name', x->>'id', nullif(x->>'read_nf',''), nullif(x->>'read_key',''), nullif(x->>'read_plate',''),
         nullif(x->>'read_total','')::numeric, nullif(x->>'read_at','')::timestamptz, nullif(x->>'read_error','')
  FROM jsonb_array_elements(p_docs) x
  ON CONFLICT (ref_month, file_name) DO UPDATE SET item_id = EXCLUDED.item_id,
    read_nf = CASE WHEN EXCLUDED.read_at IS NOT NULL THEN EXCLUDED.read_nf ELSE fleet_note_docs.read_nf END,
    read_key = CASE WHEN EXCLUDED.read_at IS NOT NULL THEN EXCLUDED.read_key ELSE fleet_note_docs.read_key END,
    read_plate = CASE WHEN EXCLUDED.read_at IS NOT NULL THEN EXCLUDED.read_plate ELSE fleet_note_docs.read_plate END,
    read_total = CASE WHEN EXCLUDED.read_at IS NOT NULL THEN EXCLUDED.read_total ELSE fleet_note_docs.read_total END,
    read_error = CASE WHEN EXCLUDED.read_at IS NOT NULL THEN EXCLUDED.read_error ELSE fleet_note_docs.read_error END,
    read_at = coalesce(EXCLUDED.read_at, fleet_note_docs.read_at);

  UPDATE fleet_fuel_notes f SET note_file = NULL, note_match = NULL
   WHERE f.ref_month = p_month AND f.approved_at IS NULL AND f.note_match IN ('chave','nf','hora','leitura');
  -- Item 1 manual: os outros itens do XML seguem a mesma foto.
  UPDATE fleet_fuel_notes f SET note_file = s.note_file, note_match = s.note_match
    FROM fleet_fuel_notes s
   WHERE f.ref_month = p_month AND f.item_no > 1 AND f.note_file IS NULL AND f.approved_at IS NULL
     AND s.access_key = f.access_key AND s.item_no = 1 AND s.note_file IS NOT NULL;
  UPDATE fleet_fuel_notes f SET note_file = d.file_name, note_match = 'chave'
    FROM fleet_note_docs d
   WHERE f.ref_month = p_month AND f.item_no = 1 AND f.note_file IS NULL AND d.ref_month = p_month
     AND position(f.access_key IN regexp_replace(d.file_name, '\D', '', 'g')) > 0;
  UPDATE fleet_fuel_notes f SET note_file = d.file_name, note_match = 'leitura'
    FROM fleet_note_docs d
   WHERE f.ref_month = p_month AND f.item_no = 1 AND f.note_file IS NULL AND d.ref_month = p_month AND d.read_key = f.access_key
     AND NOT EXISTS (SELECT 1 FROM fleet_fuel_notes x WHERE x.ref_month = p_month AND x.note_file = d.file_name AND x.access_key <> f.access_key);
  UPDATE fleet_fuel_notes f SET note_file = z.file_name, note_match = 'leitura'
    FROM (
      SELECT id, file_name FROM (
        SELECT f2.id, d.file_name, count(*) OVER (PARTITION BY f2.id) AS cn, count(*) OVER (PARTITION BY d.file_name) AS cd
          FROM (SELECT g.*, (SELECT sum(t.total) FROM fleet_fuel_notes t WHERE t.access_key = g.access_key) AS note_total
                  FROM fleet_fuel_notes g WHERE g.ref_month = p_month AND g.item_no = 1 AND g.note_file IS NULL) f2
          JOIN fleet_note_docs d ON d.ref_month = p_month
         WHERE NOT EXISTS (SELECT 1 FROM fleet_fuel_notes x WHERE x.ref_month = p_month AND x.note_file = d.file_name)
           AND (
             (coalesce(ltrim(d.read_nf, '0'), '') <> '' AND ltrim(d.read_nf, '0') = ltrim(f2.nf_number, '0')
               AND (d.read_total IS NULL OR f2.note_total IS NULL OR abs(d.read_total - f2.note_total) <= 1))
             OR (d.read_nf IS NULL AND d.read_plate IS NOT NULL AND d.read_total IS NOT NULL
               AND d.read_plate = coalesce(f2.plate_fix, f2.plate) AND abs(d.read_total - f2.note_total) <= 0.05)
           )
      ) w WHERE cn = 1 AND cd = 1
    ) z
   WHERE f.id = z.id;
  UPDATE fleet_fuel_notes f SET note_file = m.file_name, note_match = 'nf'
    FROM (
      SELECT f2.id, min(d.file_name) AS file_name
        FROM fleet_fuel_notes f2 JOIN fleet_note_docs d ON d.ref_month = p_month
       WHERE f2.ref_month = p_month AND f2.item_no = 1 AND f2.note_file IS NULL AND coalesce(ltrim(f2.nf_number, '0'), '') <> ''
         AND d.file_name ~ ('(^|\D)0*' || ltrim(f2.nf_number, '0') || '(\D|$)')
         AND NOT EXISTS (SELECT 1 FROM fleet_fuel_notes x WHERE x.ref_month = p_month AND x.note_file = d.file_name)
       GROUP BY f2.id HAVING count(*) = 1
    ) m
   WHERE f.id = m.id
     AND (SELECT count(DISTINCT y.access_key) FROM fleet_fuel_notes y WHERE y.ref_month = p_month AND y.nf_number = f.nf_number) = 1;
  -- Itens 2, 3... do mesmo XML ficam com a foto que o item 1 achou.
  UPDATE fleet_fuel_notes f SET note_file = s.note_file, note_match = s.note_match
    FROM fleet_fuel_notes s
   WHERE f.ref_month = p_month AND f.item_no > 1 AND f.note_file IS NULL AND f.approved_at IS NULL
     AND s.access_key = f.access_key AND s.item_no = 1 AND s.note_file IS NOT NULL;
  INSERT INTO fleet_settings(key, value, updated_at) VALUES ('synced:' || p_month, now()::text, now())
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
  RETURN n;
END $function$;
