CREATE TABLE public.conference_items (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  appointment_id uuid REFERENCES public.appointments(id) ON DELETE SET NULL,
  collaborator_id uuid NOT NULL REFERENCES public.collaborators(id) ON DELETE CASCADE,
  type text NOT NULL,
  training_id uuid REFERENCES public.trainings(id) ON DELETE SET NULL,
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  document_date date NOT NULL,
  status text NOT NULL DEFAULT 'pendente',
  notes text,
  completed_at timestamp with time zone,
  completed_by uuid REFERENCES auth.users(id),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.conference_items TO authenticated;
GRANT ALL ON public.conference_items TO service_role;
ALTER TABLE public.conference_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "conference_items_select" ON public.conference_items FOR SELECT TO authenticated USING (true);
CREATE POLICY "conference_items_insert" ON public.conference_items FOR INSERT TO authenticated WITH CHECK (public.can_write());
CREATE POLICY "conference_items_update" ON public.conference_items FOR UPDATE TO authenticated USING (public.can_write());
CREATE POLICY "conference_items_delete" ON public.conference_items FOR DELETE TO authenticated USING (public.can_write());

CREATE TABLE public.conference_checks (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  item_id uuid NOT NULL REFERENCES public.conference_items(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  approved boolean NOT NULL DEFAULT false,
  approved_at timestamp with time zone,
  next_check_date date,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (item_id, client_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.conference_checks TO authenticated;
GRANT ALL ON public.conference_checks TO service_role;
ALTER TABLE public.conference_checks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "conference_checks_select" ON public.conference_checks FOR SELECT TO authenticated USING (true);
CREATE POLICY "conference_checks_insert" ON public.conference_checks FOR INSERT TO authenticated WITH CHECK (public.can_write());
CREATE POLICY "conference_checks_update" ON public.conference_checks FOR UPDATE TO authenticated USING (public.can_write());
CREATE POLICY "conference_checks_delete" ON public.conference_checks FOR DELETE TO authenticated USING (public.can_write());

CREATE TRIGGER update_conference_items_updated_at BEFORE UPDATE ON public.conference_items
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_conference_checks_updated_at BEFORE UPDATE ON public.conference_checks
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();