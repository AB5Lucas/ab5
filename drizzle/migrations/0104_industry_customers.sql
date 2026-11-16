-- Clientes Indústria (logística do caminhão): lista própria, separada dos clientes de Serviços.
-- km_one_way = quilometragem de ida; na Transporte o local escolhido conta ida × 2. Sem km preenchido, segue 100 km.
CREATE TABLE IF NOT EXISTS public.industry_customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  km_one_way numeric CHECK (km_one_way IS NULL OR km_one_way >= 0),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid DEFAULT auth.uid()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_industry_customers_name ON public.industry_customers (upper(trim(name)));
ALTER TABLE public.industry_customers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS industry_customers_select ON public.industry_customers;
CREATE POLICY industry_customers_select ON public.industry_customers FOR SELECT TO authenticated USING ((SELECT public.is_active_user()));
DROP POLICY IF EXISTS industry_customers_write ON public.industry_customers;
CREATE POLICY industry_customers_write ON public.industry_customers FOR ALL TO authenticated
  USING ((SELECT public.can_write())) WITH CHECK ((SELECT public.can_write()));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.industry_customers TO authenticated;
-- Pedágio do local (valor de ida; conta × 2 × viagens como o do cliente).
ALTER TABLE public.industry_customers ADD COLUMN IF NOT EXISTS has_toll boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS toll_amount numeric CHECK (toll_amount IS NULL OR toll_amount >= 0);
-- Pedágio (ida) do local Indústria do caminhão, gravado ao salvar; quando preenchido substitui o pedágio do cliente.
ALTER TABLE public.vehicle_schedules ADD COLUMN IF NOT EXISTS place_toll numeric;
