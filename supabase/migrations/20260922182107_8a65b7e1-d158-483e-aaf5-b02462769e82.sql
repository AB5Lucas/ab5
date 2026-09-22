ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS needs_company_transport boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS needs_transport_voucher boolean NOT NULL DEFAULT false;

ALTER TABLE public.clients
  ADD CONSTRAINT clients_transport_mode_check
  CHECK (NOT (needs_company_transport AND needs_transport_voucher));

CREATE TABLE public.vehicle_schedules (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  schedule_date date NOT NULL,
  vehicle_id uuid NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,
  driver_id uuid REFERENCES public.collaborators(id) ON DELETE SET NULL,
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  is_external boolean NOT NULL DEFAULT false,
  driver_bonus boolean NOT NULL DEFAULT false,
  km numeric NOT NULL DEFAULT 0,
  notes text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (schedule_date, vehicle_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.vehicle_schedules TO authenticated;
GRANT ALL ON public.vehicle_schedules TO service_role;
ALTER TABLE public.vehicle_schedules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "vehicle_schedules_select" ON public.vehicle_schedules FOR SELECT TO authenticated USING (true);
CREATE POLICY "vehicle_schedules_insert" ON public.vehicle_schedules FOR INSERT TO authenticated WITH CHECK (public.can_write());
CREATE POLICY "vehicle_schedules_update" ON public.vehicle_schedules FOR UPDATE TO authenticated USING (public.can_write()) WITH CHECK (public.can_write());
CREATE POLICY "vehicle_schedules_delete" ON public.vehicle_schedules FOR DELETE TO authenticated USING (public.can_write());
CREATE TRIGGER trg_vehicle_schedules_updated BEFORE UPDATE ON public.vehicle_schedules FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE INDEX idx_vehicle_schedules_date ON public.vehicle_schedules (schedule_date);

CREATE TABLE public.driver_bonus_rules (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  calculation_type text NOT NULL DEFAULT 'daily',
  amount numeric NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.driver_bonus_rules TO authenticated;
GRANT ALL ON public.driver_bonus_rules TO service_role;
ALTER TABLE public.driver_bonus_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "driver_bonus_rules_select" ON public.driver_bonus_rules FOR SELECT TO authenticated USING (true);
CREATE POLICY "driver_bonus_rules_insert" ON public.driver_bonus_rules FOR INSERT TO authenticated WITH CHECK (public.can_write());
CREATE POLICY "driver_bonus_rules_update" ON public.driver_bonus_rules FOR UPDATE TO authenticated USING (public.can_write()) WITH CHECK (public.can_write());
CREATE POLICY "driver_bonus_rules_delete" ON public.driver_bonus_rules FOR DELETE TO authenticated USING (public.is_admin());
CREATE TRIGGER trg_driver_bonus_rules_updated BEFORE UPDATE ON public.driver_bonus_rules FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.vehicle_view_prefs (
  user_id uuid NOT NULL PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  hidden_vehicle_ids uuid[] NOT NULL DEFAULT '{}',
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.vehicle_view_prefs TO authenticated;
GRANT ALL ON public.vehicle_view_prefs TO service_role;
ALTER TABLE public.vehicle_view_prefs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "vehicle_view_prefs_own" ON public.vehicle_view_prefs FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER trg_vehicle_view_prefs_updated BEFORE UPDATE ON public.vehicle_view_prefs FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();