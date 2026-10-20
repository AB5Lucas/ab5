CREATE OR REPLACE FUNCTION public.hiring_mail_recipients(_client_ids uuid[])
RETURNS TABLE(client_id uuid, to_emails text[], cc_emails text[])
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT c.client_id, c.to_emails, c.cc_emails FROM public.hiring_email_configs c
  WHERE c.client_id = ANY(_client_ids) AND c.active
    AND (public.is_hiring_rh() OR public.can_access_page('/demandas/contratacoes'));
$$;
REVOKE ALL ON FUNCTION public.hiring_mail_recipients(uuid[]) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.hiring_mail_recipients(uuid[]) TO authenticated;