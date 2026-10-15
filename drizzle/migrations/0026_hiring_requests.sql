CREATE OR REPLACE FUNCTION public.is_hiring_rh() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  select public.is_active_user() and (public.has_role(auth.uid(),'admin') or public.has_role(auth.uid(),'programmer'))
$$;

CREATE TABLE public.hiring_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  requester_id uuid NOT NULL DEFAULT auth.uid(),
  requester_name text,
  client_id uuid NOT NULL REFERENCES public.clients(id),
  work_id uuid NOT NULL REFERENCES public.works(id),
  position_id uuid REFERENCES public.positions(id),
  position_name text NOT NULL,
  quantity int NOT NULL CHECK (quantity > 0),
  filled int NOT NULL DEFAULT 0 CHECK (filled >= 0),
  reason text NOT NULL,
  desired_date date,
  priority text NOT NULL DEFAULT 'normal' CHECK (priority in ('baixa','normal','alta','urgente')),
  notes text,
  status text NOT NULL DEFAULT 'aberta' CHECK (status in ('aberta','analise','aguardando','processo','parcial','atendida','cancelada')),
  rh_owner_id uuid,
  rh_owner_name text
);
GRANT SELECT, INSERT, UPDATE ON public.hiring_requests TO authenticated;
GRANT ALL ON public.hiring_requests TO service_role;
ALTER TABLE public.hiring_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY hr_select ON public.hiring_requests FOR SELECT TO authenticated USING (
  public.is_hiring_rh() OR (public.is_active_user() AND public.can_access_page('/demandas/contratacoes') AND (requester_id = auth.uid() OR public.can_access_client(client_id))));
CREATE POLICY hr_insert ON public.hiring_requests FOR INSERT TO authenticated WITH CHECK (
  public.is_active_user() AND public.can_access_page('/demandas/contratacoes') AND requester_id = auth.uid() AND status='aberta' AND filled=0
  AND (public.is_hiring_rh() OR public.can_access_client(client_id)));
CREATE POLICY hr_update ON public.hiring_requests FOR UPDATE TO authenticated USING (public.is_hiring_rh()) WITH CHECK (public.is_hiring_rh());

CREATE TABLE public.hiring_request_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.hiring_requests(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  user_name text,
  event text NOT NULL,
  old_status text,
  new_status text,
  filled int,
  note text
);
GRANT SELECT, INSERT ON public.hiring_request_events TO authenticated;
GRANT ALL ON public.hiring_request_events TO service_role;
ALTER TABLE public.hiring_request_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY hre_select ON public.hiring_request_events FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.hiring_requests r WHERE r.id=request_id));
CREATE POLICY hre_insert ON public.hiring_request_events FOR INSERT TO authenticated WITH CHECK (user_id=auth.uid() AND EXISTS (SELECT 1 FROM public.hiring_requests r WHERE r.id=request_id) AND (public.is_hiring_rh() OR event='abertura'));

CREATE TABLE public.hiring_email_configs (
  client_id uuid PRIMARY KEY REFERENCES public.clients(id),
  to_emails text[] NOT NULL DEFAULT '{}',
  cc_emails text[] NOT NULL DEFAULT '{}',
  active boolean NOT NULL DEFAULT true,
  notes text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid DEFAULT auth.uid()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.hiring_email_configs TO authenticated;
GRANT ALL ON public.hiring_email_configs TO service_role;
ALTER TABLE public.hiring_email_configs ENABLE ROW LEVEL SECURITY;
CREATE POLICY hec_all ON public.hiring_email_configs FOR ALL TO authenticated USING (public.is_hiring_rh()) WITH CHECK (public.is_hiring_rh());

CREATE TABLE public.hiring_email_config_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL,
  to_emails text[], cc_emails text[], active boolean, notes text,
  changed_at timestamptz NOT NULL DEFAULT now(),
  changed_by uuid DEFAULT auth.uid()
);
GRANT SELECT, INSERT ON public.hiring_email_config_history TO authenticated;
GRANT ALL ON public.hiring_email_config_history TO service_role;
ALTER TABLE public.hiring_email_config_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY hech_sel ON public.hiring_email_config_history FOR SELECT TO authenticated USING (public.is_hiring_rh());
CREATE POLICY hech_ins ON public.hiring_email_config_history FOR INSERT TO authenticated WITH CHECK (public.is_hiring_rh());

CREATE TABLE public.hiring_email_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.hiring_requests(id) ON DELETE CASCADE,
  event_id uuid UNIQUE REFERENCES public.hiring_request_events(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  event text NOT NULL,
  to_emails text[] NOT NULL DEFAULT '{}',
  cc_emails text[] NOT NULL DEFAULT '{}',
  result text NOT NULL CHECK (result in ('pendente','enviado','falha','sem_destinatarios')),
  error text
);
GRANT SELECT, INSERT, UPDATE ON public.hiring_email_log TO authenticated;
GRANT ALL ON public.hiring_email_log TO service_role;
ALTER TABLE public.hiring_email_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY hel_sel ON public.hiring_email_log FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.hiring_requests r WHERE r.id=request_id));
CREATE POLICY hel_ins ON public.hiring_email_log FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM public.hiring_requests r WHERE r.id=request_id));
CREATE POLICY hel_upd ON public.hiring_email_log FOR UPDATE TO authenticated USING (public.is_hiring_rh()) WITH CHECK (public.is_hiring_rh());

-- registra destinatários do cliente na hora do evento (e-mail fica pendente até o envio ser ligado)
CREATE OR REPLACE FUNCTION public.hiring_log_email() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE c public.hiring_email_configs; r public.hiring_requests;
BEGIN
  SELECT * INTO r FROM public.hiring_requests WHERE id=NEW.request_id;
  SELECT * INTO c FROM public.hiring_email_configs WHERE client_id=r.client_id AND active;
  IF c.client_id IS NULL OR coalesce(array_length(c.to_emails,1),0)=0 THEN
    INSERT INTO public.hiring_email_log(request_id,event_id,event,result,error) VALUES (r.id,NEW.id,NEW.event,'sem_destinatarios','Cliente sem destinatários configurados');
  ELSE
    INSERT INTO public.hiring_email_log(request_id,event_id,event,to_emails,cc_emails,result,error) VALUES (r.id,NEW.id,NEW.event,c.to_emails,c.cc_emails,'pendente','Envio de e-mail aguardando configuração do domínio');
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER hiring_events_email AFTER INSERT ON public.hiring_request_events FOR EACH ROW EXECUTE FUNCTION public.hiring_log_email();