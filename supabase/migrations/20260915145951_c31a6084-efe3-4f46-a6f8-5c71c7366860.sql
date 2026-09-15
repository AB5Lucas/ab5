CREATE TABLE public.clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  address text,
  number text,
  neighborhood text,
  city text,
  state text,
  zip_code text,
  distance_km numeric,
  notes text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.clients TO authenticated;
GRANT ALL ON public.clients TO service_role;

ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;

CREATE POLICY clients_select ON public.clients FOR SELECT TO authenticated USING (true);
CREATE POLICY clients_insert ON public.clients FOR INSERT TO authenticated WITH CHECK (public.can_write());
CREATE POLICY clients_update ON public.clients FOR UPDATE TO authenticated USING (public.can_write()) WITH CHECK (public.can_write());
CREATE POLICY clients_delete ON public.clients FOR DELETE TO authenticated USING (public.is_admin());

CREATE TRIGGER trg_clients_updated BEFORE UPDATE ON public.clients
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.works ADD COLUMN client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL;
ALTER TABLE public.works ADD COLUMN exit_time_weekend time DEFAULT '16:00';
ALTER TABLE public.works ALTER COLUMN code DROP NOT NULL;
ALTER TABLE public.works ALTER COLUMN entry_time SET DEFAULT '07:00';
ALTER TABLE public.works ALTER COLUMN exit_time SET DEFAULT '17:00';

UPDATE public.works SET
  entry_time = COALESCE(entry_time, '07:00'),
  exit_time = COALESCE(exit_time, '17:00'),
  exit_time_weekend = COALESCE(exit_time_weekend, '16:00');

CREATE INDEX idx_works_client_id ON public.works (client_id);