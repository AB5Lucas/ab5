CREATE TABLE public.foreman_works (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  work_id uuid NOT NULL REFERENCES public.works(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, work_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.foreman_works TO authenticated;
GRANT ALL ON public.foreman_works TO service_role;
ALTER TABLE public.foreman_works ENABLE ROW LEVEL SECURITY;
CREATE POLICY fw_select ON public.foreman_works FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.can_write());
CREATE POLICY fw_admin ON public.foreman_works FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

CREATE OR REPLACE FUNCTION public.can_access_work(_work_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.can_write() OR EXISTS (SELECT 1 FROM public.foreman_works WHERE user_id = auth.uid() AND work_id = _work_id);
$$;

CREATE TABLE public.rdo_user_prefs (
  user_id uuid PRIMARY KEY DEFAULT auth.uid(),
  last_work_id uuid REFERENCES public.works(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rdo_user_prefs TO authenticated;
GRANT ALL ON public.rdo_user_prefs TO service_role;
ALTER TABLE public.rdo_user_prefs ENABLE ROW LEVEL SECURITY;
CREATE POLICY rup_own ON public.rdo_user_prefs FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE TRIGGER trg_rdo_user_prefs_updated BEFORE UPDATE ON public.rdo_user_prefs FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.rdos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_id uuid NOT NULL REFERENCES public.works(id) ON DELETE CASCADE,
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  schedule_id uuid REFERENCES public.daily_schedules(id) ON DELETE SET NULL,
  report_date date NOT NULL,
  user_id uuid DEFAULT auth.uid(),
  responsible_name text,
  status text NOT NULL DEFAULT 'draft',
  activities text,
  notes text,
  finalized_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (work_id, report_date)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rdos TO authenticated;
GRANT ALL ON public.rdos TO service_role;
ALTER TABLE public.rdos ENABLE ROW LEVEL SECURITY;
CREATE POLICY rdos_select ON public.rdos FOR SELECT TO authenticated USING (public.can_access_work(work_id) OR public.has_role(auth.uid(),'viewer'));
CREATE POLICY rdos_insert ON public.rdos FOR INSERT TO authenticated WITH CHECK (public.can_access_work(work_id));
CREATE POLICY rdos_update ON public.rdos FOR UPDATE TO authenticated USING (public.can_write() OR (public.can_access_work(work_id) AND status = 'draft'));
CREATE POLICY rdos_delete ON public.rdos FOR DELETE TO authenticated USING (public.is_admin());
CREATE TRIGGER trg_rdos_updated BEFORE UPDATE ON public.rdos FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.can_access_rdo(_rdo_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.rdos r WHERE r.id = _rdo_id AND public.can_access_work(r.work_id));
$$;
CREATE OR REPLACE FUNCTION public.can_edit_rdo(_rdo_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.rdos r WHERE r.id = _rdo_id AND (public.can_write() OR (public.can_access_work(r.work_id) AND r.status = 'draft')));
$$;

CREATE TABLE public.rdo_workforce (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rdo_id uuid NOT NULL REFERENCES public.rdos(id) ON DELETE CASCADE,
  work_id uuid NOT NULL REFERENCES public.works(id) ON DELETE CASCADE,
  report_date date NOT NULL,
  collaborator_id uuid NOT NULL REFERENCES public.collaborators(id) ON DELETE CASCADE,
  allocation_id uuid REFERENCES public.daily_allocations(id) ON DELETE SET NULL,
  position_id uuid REFERENCES public.positions(id) ON DELETE SET NULL,
  planned boolean NOT NULL DEFAULT true,
  present boolean NOT NULL DEFAULT true,
  entry_time time,
  exit_time time,
  break_minutes integer NOT NULL DEFAULT 60,
  worked_hours numeric GENERATED ALWAYS AS (
    CASE WHEN present AND entry_time IS NOT NULL AND exit_time IS NOT NULL
      THEN GREATEST(0, round((EXTRACT(EPOCH FROM (exit_time - entry_time)) / 3600.0 - break_minutes / 60.0)::numeric, 2))
      ELSE 0 END
  ) STORED,
  reported_reason text,
  reported_note text,
  final_classification text,
  occurrence_status text NOT NULL DEFAULT 'none',
  classified_by uuid,
  classified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (rdo_id, collaborator_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rdo_workforce TO authenticated;
GRANT ALL ON public.rdo_workforce TO service_role;
ALTER TABLE public.rdo_workforce ENABLE ROW LEVEL SECURITY;
CREATE POLICY rw_select ON public.rdo_workforce FOR SELECT TO authenticated USING (public.can_access_rdo(rdo_id) OR public.has_role(auth.uid(),'viewer'));
CREATE POLICY rw_insert ON public.rdo_workforce FOR INSERT TO authenticated WITH CHECK (public.can_edit_rdo(rdo_id));
CREATE POLICY rw_update ON public.rdo_workforce FOR UPDATE TO authenticated USING (public.can_edit_rdo(rdo_id));
CREATE POLICY rw_delete ON public.rdo_workforce FOR DELETE TO authenticated USING (public.can_edit_rdo(rdo_id));
CREATE TRIGGER trg_rdo_workforce_updated BEFORE UPDATE ON public.rdo_workforce FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE INDEX idx_rdo_workforce_pending ON public.rdo_workforce (report_date, occurrence_status);

CREATE TABLE public.rdo_services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rdo_id uuid NOT NULL REFERENCES public.rdos(id) ON DELETE CASCADE,
  category text NOT NULL,
  description text NOT NULL,
  location text,
  quantity numeric,
  unit text,
  productivity numeric,
  team text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.rdo_scaffolds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rdo_id uuid NOT NULL REFERENCES public.rdos(id) ON DELETE CASCADE,
  scaffold_type text,
  location text,
  length_m numeric,
  width_m numeric,
  height_m numeric,
  quantity numeric NOT NULL DEFAULT 1,
  operation text NOT NULL DEFAULT 'montagem',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.rdo_media (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rdo_id uuid NOT NULL REFERENCES public.rdos(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'photo',
  storage_path text NOT NULL,
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.rdo_signatures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rdo_id uuid NOT NULL REFERENCES public.rdos(id) ON DELETE CASCADE,
  kind text NOT NULL,
  signer_name text NOT NULL,
  signature_data text NOT NULL,
  signed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (rdo_id, kind)
);
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['rdo_services','rdo_scaffolds','rdo_media','rdo_signatures'] LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.can_access_rdo(rdo_id) OR public.has_role(auth.uid(),''viewer''))', t||'_sel', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (public.can_edit_rdo(rdo_id))', t||'_ins', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (public.can_edit_rdo(rdo_id))', t||'_upd', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (public.can_edit_rdo(rdo_id))', t||'_del', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column()', 'trg_'||t||'_updated', t);
  END LOOP;
END $$;

CREATE POLICY rdo_media_read ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'rdo-media');
CREATE POLICY rdo_media_write ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'rdo-media' AND public.can_edit_rdo(((storage.foldername(name))[1])::uuid));
CREATE POLICY rdo_media_delete ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'rdo-media' AND public.can_edit_rdo(((storage.foldername(name))[1])::uuid));