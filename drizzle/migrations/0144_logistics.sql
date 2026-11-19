-- Logística (Veículos › Logística, /logistica): demandas de carga/descarga e busca de material, cálculo de peso/medidas,
-- veículo sugerido, programação por dia e veículo, mensagem D-1 ao motorista e alertas (lib/logistics.ts).
-- Quem acessa a página cria e programa (can_access_page('/logistica')).

-- Carga útil e carroceria do veículo (mesmo cadastro da Transporte/Frota).
ALTER TABLE public.vehicles ADD COLUMN IF NOT EXISTS cargo_capacity_kg numeric;
ALTER TABLE public.vehicles ADD COLUMN IF NOT EXISTS bed_length_m numeric;
ALTER TABLE public.vehicles ADD COLUMN IF NOT EXISTS bed_width_m numeric;
ALTER TABLE public.vehicles ADD COLUMN IF NOT EXISTS cargo_volume_m3 numeric;
ALTER TABLE public.vehicles ADD COLUMN IF NOT EXISTS cnh_category text;
ALTER TABLE public.vehicles ADD COLUMN IF NOT EXISTS has_crane boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.log_materials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  unit text NOT NULL DEFAULT 'UN',
  weight_kg numeric NOT NULL DEFAULT 0,
  length_m numeric,
  volume_m3 numeric,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.log_addresses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  street text,
  city text NOT NULL,
  uf text NOT NULL DEFAULT 'SP',
  receive_from time,
  receive_to time,
  needs_booking boolean NOT NULL DEFAULT false,
  notes text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.log_demands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL DEFAULT 'entregar' CHECK (kind IN ('entregar', 'buscar', 'retirar', 'transferir')),
  title text NOT NULL,
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  work_id uuid REFERENCES public.works(id) ON DELETE SET NULL,
  origin_id uuid REFERENCES public.log_addresses(id) ON DELETE SET NULL,
  dest_id uuid REFERENCES public.log_addresses(id) ON DELETE SET NULL,
  due_date date,
  contact text,
  notes text,
  status text NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'programada', 'concluida', 'cancelada')),
  scheduled_date date,
  departure_time time,
  vehicle_id uuid REFERENCES public.vehicles(id) ON DELETE SET NULL,
  driver_id uuid REFERENCES public.collaborators(id) ON DELETE SET NULL,
  trips int NOT NULL DEFAULT 1,
  message_sent_at timestamptz,
  requested_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS log_demands_date_idx ON public.log_demands (scheduled_date);

CREATE TABLE IF NOT EXISTS public.log_demand_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  demand_id uuid NOT NULL REFERENCES public.log_demands(id) ON DELETE CASCADE,
  material_id uuid REFERENCES public.log_materials(id) ON DELETE SET NULL,
  description text NOT NULL,
  qty numeric NOT NULL DEFAULT 1,
  unit_weight_kg numeric NOT NULL DEFAULT 0,
  length_m numeric,
  unit_volume_m3 numeric,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Restrições de circulação por cidade (rodízio por final de placa e horários).
CREATE TABLE IF NOT EXISTS public.log_city_restrictions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  city text NOT NULL,
  weekday int NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  plate_endings text NOT NULL,
  windows text NOT NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['log_materials','log_addresses','log_demands','log_demand_items','log_city_restrictions'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %1$s_select ON public.%1$s', t);
    EXECUTE format('CREATE POLICY %1$s_select ON public.%1$s FOR SELECT TO authenticated USING ((SELECT public.is_active_user()))', t);
    EXECUTE format('DROP POLICY IF EXISTS %1$s_write ON public.%1$s', t);
    EXECUTE format('CREATE POLICY %1$s_write ON public.%1$s FOR ALL TO authenticated USING ((SELECT public.can_access_page(''/logistica''))) WITH CHECK ((SELECT public.can_access_page(''/logistica'')))', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
  END LOOP;
END $$;

-- Rodízio de São Paulo: seg 1 e 2, ter 3 e 4, qua 5 e 6, qui 7 e 8, sex 9 e 0, das 7h às 10h e das 17h às 20h.
INSERT INTO public.log_city_restrictions (city, weekday, plate_endings, windows, notes)
SELECT 'São Paulo', d, e, '07:00-10:00,17:00-20:00', 'Rodízio municipal'
FROM (VALUES (1, '1,2'), (2, '3,4'), (3, '5,6'), (4, '7,8'), (5, '9,0')) v(d, e)
WHERE NOT EXISTS (SELECT 1 FROM public.log_city_restrictions);
