-- Feriados automáticos (Configurações › Feriados):
-- * holidays continua sendo a lista que vale para todos (todas as telas leem só a data); ganhou tipo, cidade e "trocado de".
-- * Nacionais (+ 09/07 de SP) são calculados por holidays_sync_year (Páscoa pelo algoritmo de Meeus) para o ano atual e o seguinte.
-- * city_holiday_catalog = feriados por cidade; auto = cadastrado sozinho para todos (Mogi Guaçu, sede); os demais geram aviso
--   na Programação quando há equipe escalada num cliente daquela cidade, para cadastrar só para o cliente ou ignorar.
-- * client_holidays = exceção por cliente: is_holiday true = feriado só para o cliente; false = o cliente trabalha naquele feriado geral.
-- * holiday_skips = feriado automático removido ou trocado para todos (a sincronização não recria).
-- * holiday_move troca um feriado por outro dia, para todos ou para um cliente.

ALTER TABLE public.holidays ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'manual';
ALTER TABLE public.holidays ADD COLUMN IF NOT EXISTS city text;
ALTER TABLE public.holidays ADD COLUMN IF NOT EXISTS moved_from date;
CREATE UNIQUE INDEX IF NOT EXISTS holidays_date_uniq ON public.holidays(date);

CREATE TABLE IF NOT EXISTS public.holiday_skips (date date PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS public.client_holidays (
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  date date NOT NULL,
  is_holiday boolean NOT NULL DEFAULT true,
  name text,
  moved_from date,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (client_id, date)
);
CREATE TABLE IF NOT EXISTS public.city_holiday_catalog (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  city text NOT NULL,
  month int CHECK (month BETWEEN 1 AND 12),
  day int CHECK (day BETWEEN 1 AND 31),
  easter_offset int,
  name text NOT NULL,
  auto boolean NOT NULL DEFAULT false,
  from_year int,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((month IS NOT NULL AND day IS NOT NULL) OR easter_offset IS NOT NULL)
);
CREATE TABLE IF NOT EXISTS public.holiday_alert_decisions (
  date date NOT NULL,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  decision text NOT NULL CHECK (decision IN ('cadastrado', 'ignorado')),
  decided_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (date, client_id)
);

ALTER TABLE public.holiday_skips ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_holidays ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.city_holiday_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.holiday_alert_decisions ENABLE ROW LEVEL SECURITY;
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['holiday_skips','client_holidays','city_holiday_catalog','holiday_alert_decisions'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %1$s_select ON public.%1$s', t);
    EXECUTE format('CREATE POLICY %1$s_select ON public.%1$s FOR SELECT TO authenticated USING ((SELECT public.is_active_user()))', t);
    EXECUTE format('DROP POLICY IF EXISTS %1$s_write ON public.%1$s', t);
    EXECUTE format('CREATE POLICY %1$s_write ON public.%1$s FOR ALL TO authenticated USING ((SELECT public.can_write())) WITH CHECK ((SELECT public.can_write()))', t);
  END LOOP;
END $$;

-- Domingo de Páscoa (algoritmo de Meeus/Jones/Butcher).
CREATE OR REPLACE FUNCTION public.easter_date(y int) RETURNS date LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE a int := y % 19; b int := y / 100; c int := y % 100; d int := b / 4; e int := b % 4; f int := (b + 8) / 25;
  g int := (b - f + 1) / 3; h int := (19 * a + b - d - g + 15) % 30; i int := c / 4; k int := c % 4;
  l int := (32 + 2 * e + 2 * i - h - k) % 7; m int := (a + 11 * h + 22 * l) / 451;
  mo int := (h + l - 7 * m + 114) / 31; dy int := ((h + l - 7 * m + 114) % 31) + 1;
BEGIN RETURN make_date(y, mo, dy); END $$;

CREATE OR REPLACE FUNCTION public.norm_city(t text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT lower(regexp_replace(translate(coalesce(t, ''), 'ÁÀÂÃÄáàâãäÉÈÊËéèêëÍÌÎÏíìîïÓÒÔÕÖóòôõöÚÙÛÜúùûüÇç', 'AAAAAaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCc'), '[^a-zA-Z]', '', 'g'))
$$;

-- Data do feriado da cidade num ano (fixo ou pela Páscoa); nulo se ainda não vale no ano.
CREATE OR REPLACE FUNCTION public.city_holiday_on(c public.city_holiday_catalog, y int) RETURNS date LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN c.from_year IS NOT NULL AND y < c.from_year THEN NULL
    WHEN c.easter_offset IS NOT NULL THEN public.easter_date(y) + c.easter_offset
    ELSE make_date(y, c.month, c.day) END
$$;

CREATE OR REPLACE FUNCTION public.holidays_sync_year(y int) RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n int := 0; p date := public.easter_date(y);
BEGIN
  WITH src(d, nm, k, ct) AS (
    VALUES (make_date(y, 1, 1), 'Confraternização Universal', 'nacional', NULL::text),
      (p - 2, 'Sexta-feira Santa', 'nacional', NULL), (make_date(y, 4, 21), 'Tiradentes', 'nacional', NULL),
      (make_date(y, 5, 1), 'Dia do Trabalho', 'nacional', NULL), (make_date(y, 7, 9), 'Revolução Constitucionalista (SP)', 'estadual', NULL),
      (make_date(y, 9, 7), 'Independência do Brasil', 'nacional', NULL), (make_date(y, 10, 12), 'Nossa Senhora Aparecida', 'nacional', NULL),
      (make_date(y, 11, 2), 'Finados', 'nacional', NULL), (make_date(y, 11, 15), 'Proclamação da República', 'nacional', NULL),
      (make_date(y, 11, 20), 'Consciência Negra', 'nacional', NULL), (make_date(y, 12, 25), 'Natal', 'nacional', NULL)
    UNION ALL
    SELECT public.city_holiday_on(c, y), c.name, 'municipal', c.city FROM city_holiday_catalog c WHERE c.auto
  )
  INSERT INTO holidays (date, name, kind, city)
  SELECT DISTINCT ON (d) d, nm, k, ct FROM src
  WHERE d IS NOT NULL AND NOT EXISTS (SELECT 1 FROM holiday_skips s WHERE s.date = src.d)
  ON CONFLICT (date) DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

-- Remove um feriado; se era automático, não volta na próxima sincronização.
CREATE OR REPLACE FUNCTION public.holiday_remove(_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE h holidays;
BEGIN
  IF NOT public.can_write() THEN RAISE EXCEPTION 'Sem permissão'; END IF;
  SELECT * INTO h FROM holidays WHERE id = _id;
  IF h.id IS NULL THEN RETURN; END IF;
  IF h.kind <> 'manual' THEN INSERT INTO holiday_skips(date) VALUES (h.date) ON CONFLICT DO NOTHING; END IF;
  DELETE FROM holidays WHERE id = _id;
END $$;

-- Troca: o feriado de _date passa para _new_date (para todos ou só para um cliente).
CREATE OR REPLACE FUNCTION public.holiday_move(_date date, _new_date date, _client_id uuid DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE h holidays; _name text;
BEGIN
  IF NOT public.can_write() THEN RAISE EXCEPTION 'Sem permissão'; END IF;
  IF _new_date IS NULL OR _new_date = _date THEN RAISE EXCEPTION 'Escolha outro dia'; END IF;
  SELECT * INTO h FROM holidays WHERE date = _date;
  _name := coalesce(h.name, (SELECT name FROM client_holidays WHERE client_id = _client_id AND date = _date), 'Feriado');
  IF _client_id IS NULL THEN
    IF h.id IS NULL THEN RAISE EXCEPTION 'Não há feriado geral em %', to_char(_date, 'DD/MM/YYYY'); END IF;
    IF EXISTS (SELECT 1 FROM holidays WHERE date = _new_date) THEN RAISE EXCEPTION 'Já existe feriado em %', to_char(_new_date, 'DD/MM/YYYY'); END IF;
    INSERT INTO holiday_skips(date) VALUES (_date) ON CONFLICT DO NOTHING;
    DELETE FROM holidays WHERE id = h.id;
    INSERT INTO holidays(date, name, kind, city, moved_from) VALUES (_new_date, _name || ' (trocado de ' || to_char(_date, 'DD/MM') || ')', 'troca', h.city, _date);
  ELSE
    INSERT INTO client_holidays(client_id, date, is_holiday, name, moved_from) VALUES (_client_id, _date, false, _name || ' (trabalhado)', NULL)
      ON CONFLICT (client_id, date) DO UPDATE SET is_holiday = false, name = excluded.name;
    INSERT INTO client_holidays(client_id, date, is_holiday, name, moved_from) VALUES (_client_id, _new_date, true, _name || ' (trocado de ' || to_char(_date, 'DD/MM') || ')', _date)
      ON CONFLICT (client_id, date) DO UPDATE SET is_holiday = true, name = excluded.name, moved_from = excluded.moved_from;
  END IF;
END $$;

REVOKE EXECUTE ON FUNCTION public.holidays_sync_year(int), public.holiday_remove(uuid), public.holiday_move(date, date, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.holidays_sync_year(int), public.holiday_remove(uuid), public.holiday_move(date, date, uuid) TO authenticated;

-- Catálogo inicial (fontes: calendários municipais; conferir na prefeitura). Mogi Guaçu = sede, automático.
INSERT INTO public.city_holiday_catalog (city, month, day, easter_offset, name, auto, from_year)
SELECT * FROM (VALUES
  ('Mogi Guaçu', 4, 9, NULL::int, 'Aniversário de Mogi Guaçu', true, NULL::int),
  ('Mogi Mirim', 3, 19, NULL, 'São José (padroeiro de Mogi Mirim)', false, NULL),
  ('Mogi Mirim', NULL, NULL, 60, 'Corpus Christi (Mogi Mirim)', false, NULL),
  ('Mogi Mirim', 8, 10, NULL, 'Dia do Evangélico (Mogi Mirim)', false, 2027),
  ('Mogi Mirim', 10, 22, NULL, 'Aniversário de Mogi Mirim', false, NULL)
) v(city, month, day, easter_offset, name, auto, from_year)
WHERE NOT EXISTS (SELECT 1 FROM public.city_holiday_catalog);

-- Feriados já cadastrados que coincidem com os nacionais passam a ser do tipo nacional.
SELECT public.holidays_sync_year(extract(year from now())::int);
SELECT public.holidays_sync_year(extract(year from now())::int + 1);

-- Catálogo das cidades dos clientes (pesquisa em listas do TJSP/CSM, TRT-15/TRT-3 e prefeituras; Engenheiro Coelho sem feriado confirmado).
INSERT INTO public.city_holiday_catalog (city, month, day, easter_offset, name, auto, from_year)
SELECT v.* FROM (VALUES
  ('Mogi Guaçu', 12, 8, NULL::int, 'Imaculada Conceição (Mogi Guaçu)', true, NULL::int),
  ('Amparo', 4, 8, NULL, 'Aniversário de Amparo', false, NULL), ('Amparo', 9, 8, NULL, 'Nossa Senhora do Amparo (Amparo)', false, NULL),
  ('Guararema', NULL, NULL, 60, 'Corpus Christi (Guararema)', false, NULL), ('Guararema', 9, 19, NULL, 'Aniversário de Guararema', false, NULL),
  ('Itapira', NULL, NULL, 60, 'Corpus Christi (Itapira)', false, NULL), ('Itapira', 5, 13, NULL, 'São Benedito (Itapira)', false, NULL),
  ('Itapira', 9, 8, NULL, 'Nossa Senhora da Penha (Itapira)', false, NULL), ('Itapira', 10, 24, NULL, 'Aniversário de Itapira', false, NULL),
  ('Itu', 2, 2, NULL, 'Aniversário de Itu', false, NULL), ('Itu', NULL, NULL, 60, 'Corpus Christi (Itu)', false, NULL),
  ('Jaguariúna', NULL, NULL, 60, 'Corpus Christi (Jaguariúna)', false, NULL), ('Jaguariúna', 9, 12, NULL, 'Aniversário de Jaguariúna', false, NULL),
  ('Jundiaí', NULL, NULL, 60, 'Corpus Christi (Jundiaí)', false, NULL), ('Jundiaí', 8, 15, NULL, 'Nossa Senhora do Desterro (Jundiaí)', false, NULL),
  ('Leme', 6, 17, NULL, 'São Manoel (Leme)', false, NULL), ('Leme', 8, 29, NULL, 'Aniversário de Leme', false, NULL),
  ('Leme', NULL, NULL, 60, 'Corpus Christi (Leme)', false, NULL),
  ('Limeira', 9, 15, NULL, 'Aniversário de Limeira', false, NULL), ('Limeira', NULL, NULL, 60, 'Corpus Christi (Limeira)', false, NULL),
  ('Paulínia', 2, 28, NULL, 'Emancipação de Paulínia', false, NULL), ('Paulínia', NULL, NULL, 68, 'Sagrado Coração de Jesus (Paulínia)', false, NULL),
  ('Paulínia', NULL, NULL, 60, 'Corpus Christi (Paulínia)', false, NULL),
  ('Pouso Alegre', 8, 6, NULL, 'Senhor Bom Jesus (Pouso Alegre)', false, NULL), ('Pouso Alegre', 10, 19, NULL, 'Aniversário de Pouso Alegre', false, NULL),
  ('Pouso Alegre', NULL, NULL, 60, 'Corpus Christi (Pouso Alegre)', false, NULL),
  ('Salto de Pirapora', 6, 24, NULL, 'Aniversário de Salto de Pirapora', false, NULL), ('Salto de Pirapora', 12, 30, NULL, 'Emancipação de Salto de Pirapora', false, NULL),
  ('Salto de Pirapora', NULL, NULL, 60, 'Corpus Christi (Salto de Pirapora)', false, NULL),
  ('Sumaré', 7, 26, NULL, 'Fundação de Sumaré (Sant''Ana)', false, NULL), ('Sumaré', NULL, NULL, 60, 'Corpus Christi (Sumaré)', false, NULL),
  ('Valinhos', 1, 20, NULL, 'São Sebastião (Valinhos)', false, NULL), ('Valinhos', 5, 28, NULL, 'Aniversário de Valinhos', false, NULL),
  ('Valinhos', NULL, NULL, 60, 'Corpus Christi (Valinhos)', false, NULL)
) v(city, month, day, easter_offset, name, auto, from_year)
WHERE NOT EXISTS (SELECT 1 FROM public.city_holiday_catalog c WHERE c.city = v.city AND c.name = v.name);
SELECT public.holidays_sync_year(extract(year from now())::int);
SELECT public.holidays_sync_year(extract(year from now())::int + 1);
