CREATE TABLE public.prize_hours (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 collaborator_id uuid NOT NULL REFERENCES public.collaborators(id),
 entry_date date NOT NULL,
 hours numeric(8,2) NOT NULL CHECK (hours > 0),
 hourly_rate numeric(12,4) NOT NULL DEFAULT 0,
 multiplier numeric(3,1) NOT NULL DEFAULT 1.6,
 created_by uuid DEFAULT auth.uid(),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(collaborator_id, entry_date)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.prize_hours TO authenticated;
GRANT ALL ON public.prize_hours TO service_role;
ALTER TABLE public.prize_hours ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Only administrators and programmers manage prize hours" ON public.prize_hours FOR ALL TO authenticated USING (public.is_active_user() AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'programmer'))) WITH CHECK (public.is_active_user() AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'programmer')));
CREATE OR REPLACE FUNCTION public.prize_hours_validate() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE rate numeric; dow integer; holiday boolean;
BEGIN
 dow := extract(isodow FROM NEW.entry_date);
 SELECT EXISTS(SELECT 1 FROM public.holidays WHERE date = NEW.entry_date) INTO holiday;
 IF dow NOT IN (6,7) AND NOT holiday THEN RAISE EXCEPTION 'Horas Prêmio somente em sábados, domingos ou feriados'; END IF;
 SELECT salary INTO rate FROM public.collaborators WHERE id=NEW.collaborator_id;
 IF rate IS NULL OR rate <= 0 THEN RAISE EXCEPTION 'Colaborador sem valor hora cadastrado'; END IF;
 NEW.hourly_rate := rate;
 NEW.multiplier := CASE WHEN dow=7 OR holiday THEN 2 ELSE 1.6 END;
 NEW.updated_at := now();
 RETURN NEW;
END $$;
CREATE TRIGGER prize_hours_validate BEFORE INSERT OR UPDATE ON public.prize_hours FOR EACH ROW EXECUTE FUNCTION public.prize_hours_validate();