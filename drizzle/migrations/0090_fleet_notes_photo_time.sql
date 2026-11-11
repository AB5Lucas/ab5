-- Frota › Notas: as notas são fotos (nome com data e hora). Sem a chave no nome, a foto é ligada
-- pela hora (o servidor manda a sugestão em doc_guess) e fica marcada para conferir.
ALTER TABLE public.fleet_fuel_notes DROP CONSTRAINT IF EXISTS fleet_fuel_notes_note_match_check;
ALTER TABLE public.fleet_fuel_notes ADD CONSTRAINT fleet_fuel_notes_note_match_check CHECK (note_match IN ('chave','nf','hora','manual'));

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
  -- Refaz só as ligações automáticas de linhas ainda não aprovadas; atribuição manual e aprovadas ficam.
  UPDATE fleet_fuel_notes f SET note_file = NULL, note_match = NULL
   WHERE f.ref_month = p_month AND f.approved_at IS NULL AND f.note_match IN ('chave','nf','hora');
  -- 1) chave de acesso no nome do arquivo
  UPDATE fleet_fuel_notes f SET note_file = d.file_name, note_match = 'chave'
    FROM fleet_note_docs d
   WHERE f.ref_month = p_month AND f.note_file IS NULL AND d.ref_month = p_month
     AND position(f.access_key IN regexp_replace(d.file_name, '\D', '', 'g')) > 0;
  -- 2) número da NF no nome (só quando é único dos dois lados)
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
  -- 3) foto mais próxima da hora do abastecimento (sugestão do servidor), se a foto ainda estiver livre
  UPDATE fleet_fuel_notes f SET note_file = r->>'doc_guess', note_match = 'hora'
    FROM jsonb_array_elements(p_notes) r
   WHERE r->>'access_key' = f.access_key AND f.ref_month = p_month AND f.note_file IS NULL AND nullif(r->>'doc_guess','') IS NOT NULL
     AND EXISTS (SELECT 1 FROM fleet_note_docs d WHERE d.ref_month = p_month AND d.file_name = r->>'doc_guess')
     AND NOT EXISTS (SELECT 1 FROM fleet_fuel_notes x WHERE x.ref_month = p_month AND x.note_file = r->>'doc_guess');
  INSERT INTO fleet_settings(key, value, updated_at) VALUES ('synced:' || p_month, now()::text, now())
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.fleet_fuel_notes_sync(text, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fleet_fuel_notes_sync(text, jsonb, jsonb) TO service_role;
