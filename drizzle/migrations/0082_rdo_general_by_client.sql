ALTER TABLE public.works ADD COLUMN IF NOT EXISTS rdo_general boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX IF NOT EXISTS works_rdo_general_client_uq ON public.works(client_id) WHERE rdo_general;
CREATE OR REPLACE FUNCTION public.rdo_general_work(_client_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _id uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_active_user() OR NOT public.can_access_client(_client_id) THEN
    RAISE EXCEPTION 'Sem acesso a este cliente';
  END IF;
  SELECT id INTO _id FROM public.works WHERE client_id = _client_id AND rdo_general;
  IF _id IS NULL THEN
    INSERT INTO public.works (name, client_id, active, rdo_general)
    VALUES ('RDO Geral', _client_id, false, true)
    ON CONFLICT DO NOTHING RETURNING id INTO _id;
    IF _id IS NULL THEN SELECT id INTO _id FROM public.works WHERE client_id = _client_id AND rdo_general; END IF;
  END IF;
  RETURN _id;
END $$;
GRANT EXECUTE ON FUNCTION public.rdo_general_work(uuid) TO authenticated;