-- 1) Frota › Abastecimento › Fiscal: faturas quinzenais do posto lidas dos PDF da pasta 03 FATURAS.
--    Os dados vêm só da leitura (service role); na tela só muda o "Pago?".
CREATE TABLE IF NOT EXISTS public.fleet_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  file_name text NOT NULL UNIQUE,
  item_id text,
  number text,
  issued_on date,
  due_on date,
  period_from date,
  period_to date,
  total numeric,
  coupon_keys jsonb NOT NULL DEFAULT '[]'::jsonb,
  paid boolean NOT NULL DEFAULT false,
  paid_by uuid,
  paid_at timestamptz,
  synced_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.fleet_invoices ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS fleet_invoices_read ON public.fleet_invoices;
CREATE POLICY fleet_invoices_read ON public.fleet_invoices FOR SELECT TO authenticated USING ((SELECT can_access_page('/frota/notas')));
DROP POLICY IF EXISTS fleet_invoices_update ON public.fleet_invoices;
CREATE POLICY fleet_invoices_update ON public.fleet_invoices FOR UPDATE TO authenticated
  USING ((SELECT can_access_page('/frota/notas'))) WITH CHECK ((SELECT can_access_page('/frota/notas')));

CREATE OR REPLACE FUNCTION public.fleet_invoices_guard()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public'
AS $function$
BEGIN
  IF coalesce(auth.role(), '') = 'service_role' THEN RETURN NEW; END IF;
  NEW.file_name := OLD.file_name; NEW.item_id := OLD.item_id; NEW.number := OLD.number; NEW.issued_on := OLD.issued_on;
  NEW.due_on := OLD.due_on; NEW.period_from := OLD.period_from; NEW.period_to := OLD.period_to; NEW.total := OLD.total;
  NEW.coupon_keys := OLD.coupon_keys; NEW.synced_at := OLD.synced_at;
  IF NEW.paid IS DISTINCT FROM OLD.paid THEN
    NEW.paid_by := CASE WHEN NEW.paid THEN auth.uid() END; NEW.paid_at := CASE WHEN NEW.paid THEN now() END;
  ELSE
    NEW.paid_by := OLD.paid_by; NEW.paid_at := OLD.paid_at;
  END IF;
  RETURN NEW;
END $function$;
DROP TRIGGER IF EXISTS fleet_invoices_guard ON public.fleet_invoices;
CREATE TRIGGER fleet_invoices_guard BEFORE UPDATE ON public.fleet_invoices FOR EACH ROW EXECUTE FUNCTION public.fleet_invoices_guard();

CREATE OR REPLACE FUNCTION public.fleet_invoices_sync(p_rows jsonb)
 RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE n integer;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('fleet_invoices'));
  INSERT INTO fleet_invoices(file_name, item_id, number, issued_on, due_on, period_from, period_to, total, coupon_keys, synced_at)
  SELECT r->>'file_name', nullif(r->>'item_id',''), nullif(r->>'number',''), nullif(r->>'issued_on','')::date, nullif(r->>'due_on','')::date,
         nullif(r->>'period_from','')::date, nullif(r->>'period_to','')::date, nullif(r->>'total','')::numeric,
         coalesce(r->'coupon_keys', '[]'::jsonb), now()
  FROM jsonb_array_elements(p_rows) r
  ON CONFLICT (file_name) DO UPDATE SET item_id = EXCLUDED.item_id, number = EXCLUDED.number, issued_on = EXCLUDED.issued_on,
    due_on = EXCLUDED.due_on, period_from = EXCLUDED.period_from, period_to = EXCLUDED.period_to, total = EXCLUDED.total,
    coupon_keys = EXCLUDED.coupon_keys, synced_at = now();
  GET DIAGNOSTICS n = ROW_COUNT;
  DELETE FROM fleet_invoices f WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_rows) r WHERE r->>'file_name' = f.file_name);
  INSERT INTO fleet_settings(key, value, updated_at) VALUES ('synced:faturas', now()::text, now())
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
  RETURN n;
END $function$;

INSERT INTO public.fleet_settings(key, value, updated_at)
VALUES ('invoice_folder', 'Compras/04 COMPRAS/03 RATEIOS E CONFERÊNCIAS/02 CONFERÊNCIA/04 CONSUMO VEICULAR/03 FATURAS', now())
ON CONFLICT (key) DO NOTHING;

-- 2) Liberação: motorista também pode ser um nome digitado, fora da lista de colaboradores com CNH.
ALTER TABLE public.fleet_release_drivers ADD COLUMN IF NOT EXISTS id uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE public.fleet_release_drivers ADD COLUMN IF NOT EXISTS name text;
ALTER TABLE public.fleet_release_drivers DROP CONSTRAINT IF EXISTS fleet_release_drivers_pkey;
ALTER TABLE public.fleet_release_drivers ADD CONSTRAINT fleet_release_drivers_pkey PRIMARY KEY (id);
ALTER TABLE public.fleet_release_drivers ALTER COLUMN collaborator_id DROP NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS fleet_release_drivers_collaborator ON public.fleet_release_drivers (collaborator_id) WHERE collaborator_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS fleet_release_drivers_name ON public.fleet_release_drivers (upper(name)) WHERE collaborator_id IS NULL;
ALTER TABLE public.fleet_release_drivers DROP CONSTRAINT IF EXISTS fleet_release_drivers_who;
ALTER TABLE public.fleet_release_drivers ADD CONSTRAINT fleet_release_drivers_who CHECK (collaborator_id IS NOT NULL OR nullif(trim(name), '') IS NOT NULL);

-- 3) Liberação: placa também pode ser digitada (placa + nome do veículo), fora do cadastro de veículos.
ALTER TABLE public.fleet_release_vehicles ADD COLUMN IF NOT EXISTS id uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE public.fleet_release_vehicles ADD COLUMN IF NOT EXISTS plate text;
ALTER TABLE public.fleet_release_vehicles ADD COLUMN IF NOT EXISTS label text;
ALTER TABLE public.fleet_release_vehicles DROP CONSTRAINT IF EXISTS fleet_release_vehicles_pkey;
ALTER TABLE public.fleet_release_vehicles ADD CONSTRAINT fleet_release_vehicles_pkey PRIMARY KEY (id);
ALTER TABLE public.fleet_release_vehicles ALTER COLUMN vehicle_id DROP NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS fleet_release_vehicles_vehicle ON public.fleet_release_vehicles (vehicle_id) WHERE vehicle_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS fleet_release_vehicles_plate ON public.fleet_release_vehicles (upper(plate)) WHERE vehicle_id IS NULL;
ALTER TABLE public.fleet_release_vehicles DROP CONSTRAINT IF EXISTS fleet_release_vehicles_which;
ALTER TABLE public.fleet_release_vehicles ADD CONSTRAINT fleet_release_vehicles_which CHECK (vehicle_id IS NOT NULL OR nullif(trim(plate), '') IS NOT NULL);
