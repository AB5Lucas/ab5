-- Frota › Notas: a IA lê cada foto da nota (nº da NF, chave, placa e valor) uma vez; a leitura fica guardada
-- no arquivo e a foto é ligada ao abastecimento pelo que está escrito nela.
ALTER TABLE public.fleet_note_docs ADD COLUMN IF NOT EXISTS read_nf text;
ALTER TABLE public.fleet_note_docs ADD COLUMN IF NOT EXISTS read_key text;
ALTER TABLE public.fleet_note_docs ADD COLUMN IF NOT EXISTS read_plate text;
ALTER TABLE public.fleet_note_docs ADD COLUMN IF NOT EXISTS read_total numeric(12,2);
ALTER TABLE public.fleet_note_docs ADD COLUMN IF NOT EXISTS read_at timestamptz;
ALTER TABLE public.fleet_note_docs ADD COLUMN IF NOT EXISTS read_error text;

ALTER TABLE public.fleet_fuel_notes DROP CONSTRAINT IF EXISTS fleet_fuel_notes_note_match_check;
ALTER TABLE public.fleet_fuel_notes ADD CONSTRAINT fleet_fuel_notes_note_match_check CHECK (note_match IN ('chave','nf','hora','leitura','manual'));

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
  DELETE FROM fleet_fuel_notes f WHERE f.ref_month = p_month AND f.approved_at IS NULL
    AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_notes) r WHERE r->>'access_key' = f.access_key);

  -- Arquivos da pasta: mantém a leitura já feita; o servidor manda leituras novas (read_at preenchido).
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

  -- Refaz só as ligações automáticas de linhas não aprovadas; atribuição manual e aprovadas ficam.
  UPDATE fleet_fuel_notes f SET note_file = NULL, note_match = NULL
   WHERE f.ref_month = p_month AND f.approved_at IS NULL AND f.note_match IN ('chave','nf','hora','leitura');
  -- 1) chave de acesso no nome do arquivo
  UPDATE fleet_fuel_notes f SET note_file = d.file_name, note_match = 'chave'
    FROM fleet_note_docs d
   WHERE f.ref_month = p_month AND f.note_file IS NULL AND d.ref_month = p_month
     AND position(f.access_key IN regexp_replace(d.file_name, '\D', '', 'g')) > 0;
  -- 2) chave de acesso lida na foto
  UPDATE fleet_fuel_notes f SET note_file = d.file_name, note_match = 'leitura'
    FROM fleet_note_docs d
   WHERE f.ref_month = p_month AND f.note_file IS NULL AND d.ref_month = p_month AND d.read_key = f.access_key
     AND NOT EXISTS (SELECT 1 FROM fleet_fuel_notes x WHERE x.ref_month = p_month AND x.note_file = d.file_name);
  -- 3) nº da NF lido na foto (valor lido, se houver, tem de bater) e
  -- 4) NF ilegível: placa lida + mesmo valor. Só quando o par é único dos dois lados.
  UPDATE fleet_fuel_notes f SET note_file = z.file_name, note_match = 'leitura'
    FROM (
      SELECT id, file_name FROM (
        SELECT f2.id, d.file_name, count(*) OVER (PARTITION BY f2.id) AS cn, count(*) OVER (PARTITION BY d.file_name) AS cd
          FROM fleet_fuel_notes f2 JOIN fleet_note_docs d ON d.ref_month = p_month
         WHERE f2.ref_month = p_month AND f2.note_file IS NULL
           AND NOT EXISTS (SELECT 1 FROM fleet_fuel_notes x WHERE x.ref_month = p_month AND x.note_file = d.file_name)
           AND (
             (coalesce(ltrim(d.read_nf, '0'), '') <> '' AND ltrim(d.read_nf, '0') = ltrim(f2.nf_number, '0')
               AND (d.read_total IS NULL OR f2.total IS NULL OR abs(d.read_total - f2.total) <= 1))
             OR (d.read_nf IS NULL AND d.read_plate IS NOT NULL AND d.read_total IS NOT NULL
               AND d.read_plate = coalesce(f2.plate_fix, f2.plate) AND abs(d.read_total - f2.total) <= 0.05)
           )
      ) w WHERE cn = 1 AND cd = 1
    ) z
   WHERE f.id = z.id;
  -- 5) nº da NF no nome do arquivo (único dos dois lados)
  UPDATE fleet_fuel_notes f SET note_file = m.file_name, note_match = 'nf'
    FROM (
      SELECT f2.id, min(d.file_name) AS file_name
        FROM fleet_fuel_notes f2 JOIN fleet_note_docs d ON d.ref_month = p_month
       WHERE f2.ref_month = p_month AND f2.note_file IS NULL AND coalesce(ltrim(f2.nf_number, '0'), '') <> ''
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
