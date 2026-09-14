
-- ENUMS
CREATE TYPE public.app_role AS ENUM ('admin','programmer','viewer');
CREATE TYPE public.collaborator_status AS ENUM ('active','inactive');
CREATE TYPE public.work_status AS ENUM ('planned','active','paused','completed','cancelled');
CREATE TYPE public.schedule_status AS ENUM ('draft','in_progress','finalized');
CREATE TYPE public.confirmation_status AS ENUM ('confirmed','pending');
CREATE TYPE public.allocation_source AS ENUM ('base_team','copied_previous_day','manual');
CREATE TYPE public.requirement_type AS ENUM ('training','certification','position','driver_license','medical_exam','custom');
CREATE TYPE public.training_status AS ENUM ('valid','expiring','expired');
CREATE TYPE public.vehicle_status AS ENUM ('available','in_use','maintenance','inactive');
CREATE TYPE public.bonus_calculation_type AS ENUM ('daily','trip','round_trip');

-- UTIL
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

-- PROFILES
CREATE TABLE public.users_profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.users_profiles TO authenticated;
GRANT ALL ON public.users_profiles TO service_role;
ALTER TABLE public.users_profiles ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
$$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_role(auth.uid(), 'admin');
$$;

CREATE OR REPLACE FUNCTION public.can_write()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'programmer');
$$;

CREATE POLICY "profiles_select_authenticated" ON public.users_profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "profiles_update_own" ON public.users_profiles FOR UPDATE TO authenticated USING (id = auth.uid()) WITH CHECK (id = auth.uid());
CREATE POLICY "profiles_admin_all" ON public.users_profiles FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

CREATE POLICY "roles_select_authenticated" ON public.user_roles FOR SELECT TO authenticated USING (true);
CREATE POLICY "roles_admin_all" ON public.user_roles FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE first_user BOOLEAN;
BEGIN
  INSERT INTO public.users_profiles (id, full_name, email)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name',''), COALESCE(NEW.email,''));
  SELECT NOT EXISTS (SELECT 1 FROM public.user_roles) INTO first_user;
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, CASE WHEN first_user THEN 'admin'::public.app_role ELSE 'viewer'::public.app_role END);
  RETURN NEW;
END; $$;

CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

CREATE TRIGGER trg_users_profiles_updated BEFORE UPDATE ON public.users_profiles
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- CATALOGS
CREATE TABLE public.departments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE public.sectors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id UUID REFERENCES public.departments(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE public.positions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- COLLABORATORS
CREATE TABLE public.collaborators (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  registration_number TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  social_name TEXT,
  cpf TEXT,
  phone TEXT,
  email TEXT,
  birth_date DATE,
  hire_date DATE,
  position_id UUID REFERENCES public.positions(id) ON DELETE SET NULL,
  department_id UUID REFERENCES public.departments(id) ON DELETE SET NULL,
  sector_id UUID REFERENCES public.sectors(id) ON DELETE SET NULL,
  supervisor_id UUID REFERENCES public.collaborators(id) ON DELETE SET NULL,
  status public.collaborator_status NOT NULL DEFAULT 'active',
  photo_url TEXT,
  is_driver BOOLEAN NOT NULL DEFAULT false,
  driver_license_category TEXT,
  driver_license_expiry DATE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_collaborators_status ON public.collaborators(status);
CREATE INDEX idx_collaborators_name ON public.collaborators(full_name);
CREATE TRIGGER trg_collaborators_updated BEFORE UPDATE ON public.collaborators
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- WORKS
CREATE TABLE public.works (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  client TEXT,
  address TEXT, number TEXT, neighborhood TEXT, city TEXT, state TEXT, zip_code TEXT,
  latitude NUMERIC, longitude NUMERIC,
  distance_km NUMERIC,
  estimated_travel_time INTEGER,
  start_date DATE, expected_end_date DATE,
  status public.work_status NOT NULL DEFAULT 'planned',
  supervisor_id UUID REFERENCES public.collaborators(id) ON DELETE SET NULL,
  manager_id UUID REFERENCES public.collaborators(id) ON DELETE SET NULL,
  entry_time TIME, exit_time TIME,
  notes TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_works_updated BEFORE UPDATE ON public.works
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.work_base_teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_id UUID NOT NULL REFERENCES public.works(id) ON DELETE CASCADE,
  collaborator_id UUID NOT NULL REFERENCES public.collaborators(id) ON DELETE CASCADE,
  position_id UUID REFERENCES public.positions(id) ON DELETE SET NULL,
  start_date DATE NOT NULL DEFAULT CURRENT_DATE,
  end_date DATE,
  active BOOLEAN NOT NULL DEFAULT true,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX idx_base_team_unique_active ON public.work_base_teams(work_id, collaborator_id) WHERE active;
CREATE TRIGGER trg_base_teams_updated BEFORE UPDATE ON public.work_base_teams
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.trainings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  validity_months INTEGER NOT NULL DEFAULT 12,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.collaborator_trainings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  collaborator_id UUID NOT NULL REFERENCES public.collaborators(id) ON DELETE CASCADE,
  training_id UUID NOT NULL REFERENCES public.trainings(id) ON DELETE CASCADE,
  completed_at DATE NOT NULL,
  expires_at DATE,
  document_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_collab_trainings ON public.collaborator_trainings(collaborator_id, training_id);
CREATE TRIGGER trg_collab_trainings_updated BEFORE UPDATE ON public.collaborator_trainings
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.work_requirements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_id UUID NOT NULL REFERENCES public.works(id) ON DELETE CASCADE,
  requirement_type public.requirement_type NOT NULL,
  requirement_id UUID,
  requirement_label TEXT,
  mandatory BOOLEAN NOT NULL DEFAULT true,
  blocking BOOLEAN NOT NULL DEFAULT false,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_work_requirements_work ON public.work_requirements(work_id);

-- ABSENCES
CREATE TABLE public.vacations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  collaborator_id UUID NOT NULL REFERENCES public.collaborators(id) ON DELETE CASCADE,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled',
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_vacations_dates ON public.vacations(collaborator_id, start_date, end_date);

CREATE TABLE public.medical_leaves (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  collaborator_id UUID NOT NULL REFERENCES public.collaborators(id) ON DELETE CASCADE,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  document_url TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_leaves_dates ON public.medical_leaves(collaborator_id, start_date, end_date);

CREATE TABLE public.days_off (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  collaborator_id UUID NOT NULL REFERENCES public.collaborators(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  reason TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_days_off_date ON public.days_off(collaborator_id, date);

CREATE TABLE public.holidays (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date DATE NOT NULL UNIQUE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- VEHICLES
CREATE TABLE public.vehicles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plate TEXT NOT NULL UNIQUE,
  brand TEXT, model TEXT, year INTEGER, color TEXT, type TEXT,
  passenger_capacity INTEGER NOT NULL DEFAULT 4,
  fuel_type TEXT,
  status public.vehicle_status NOT NULL DEFAULT 'available',
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_vehicles_updated BEFORE UPDATE ON public.vehicles
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- SCHEDULES
CREATE TABLE public.daily_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_date DATE NOT NULL UNIQUE,
  status public.schedule_status NOT NULL DEFAULT 'draft',
  copied_from_schedule_id UUID REFERENCES public.daily_schedules(id) ON DELETE SET NULL,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  finalized_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_schedules_updated BEFORE UPDATE ON public.daily_schedules
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.daily_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id UUID NOT NULL REFERENCES public.daily_schedules(id) ON DELETE CASCADE,
  work_id UUID NOT NULL REFERENCES public.works(id) ON DELETE CASCADE,
  collaborator_id UUID NOT NULL REFERENCES public.collaborators(id) ON DELETE CASCADE,
  position_id UUID REFERENCES public.positions(id) ON DELETE SET NULL,
  vehicle_id UUID REFERENCES public.vehicles(id) ON DELETE SET NULL,
  driver BOOLEAN NOT NULL DEFAULT false,
  confirmation_status public.confirmation_status NOT NULL DEFAULT 'pending',
  confirmed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  confirmed_at TIMESTAMPTZ,
  source public.allocation_source NOT NULL DEFAULT 'manual',
  has_pending_requirement BOOLEAN NOT NULL DEFAULT false,
  sort_order INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (schedule_id, collaborator_id)
);
CREATE INDEX idx_allocations_schedule ON public.daily_allocations(schedule_id);
CREATE INDEX idx_allocations_work ON public.daily_allocations(schedule_id, work_id);
CREATE TRIGGER trg_allocations_updated BEFORE UPDATE ON public.daily_allocations
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.transport_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id UUID NOT NULL REFERENCES public.daily_schedules(id) ON DELETE CASCADE,
  work_id UUID NOT NULL REFERENCES public.works(id) ON DELETE CASCADE,
  vehicle_id UUID REFERENCES public.vehicles(id) ON DELETE SET NULL,
  driver_id UUID REFERENCES public.collaborators(id) ON DELETE SET NULL,
  departure_time TIME,
  return_time TIME,
  passenger_count INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_transport_schedule ON public.transport_allocations(schedule_id);
CREATE TRIGGER trg_transport_updated BEFORE UPDATE ON public.transport_allocations
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- BENEFITS
CREATE TABLE public.transport_voucher_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  calculation_type TEXT NOT NULL DEFAULT 'fixed',
  amount NUMERIC NOT NULL DEFAULT 0,
  applies_to_drivers BOOLEAN NOT NULL DEFAULT false,
  applies_to_collaborators BOOLEAN NOT NULL DEFAULT true,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.travel_bonus_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  minimum_distance NUMERIC NOT NULL DEFAULT 0,
  maximum_distance NUMERIC,
  bonus_amount NUMERIC NOT NULL DEFAULT 0,
  calculation_type public.bonus_calculation_type NOT NULL DEFAULT 'daily',
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- AUDIT
CREATE TABLE public.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID,
  old_data JSONB,
  new_data JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_created ON public.audit_logs(created_at DESC);
GRANT SELECT, INSERT ON public.audit_logs TO authenticated;
GRANT ALL ON public.audit_logs TO service_role;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "audit_select_admin" ON public.audit_logs FOR SELECT TO authenticated USING (public.is_admin());
CREATE POLICY "audit_insert_auth" ON public.audit_logs FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

-- GRANTS + RLS for operational tables
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'departments','sectors','positions','collaborators','works','work_base_teams',
    'trainings','collaborator_trainings','work_requirements','vacations','medical_leaves',
    'days_off','holidays','vehicles','daily_schedules','daily_allocations',
    'transport_allocations','transport_voucher_rules','travel_bonus_rules'
  ] LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY "%s_select" ON public.%I FOR SELECT TO authenticated USING (true)', t, t);
    EXECUTE format('CREATE POLICY "%s_insert" ON public.%I FOR INSERT TO authenticated WITH CHECK (public.can_write())', t, t);
    EXECUTE format('CREATE POLICY "%s_update" ON public.%I FOR UPDATE TO authenticated USING (public.can_write()) WITH CHECK (public.can_write())', t, t);
    EXECUTE format('CREATE POLICY "%s_delete" ON public.%I FOR DELETE TO authenticated USING (public.is_admin())', t, t);
  END LOOP;
END $$;