-- Inscrição de Web Push: o mesmo navegador pode ter sido de outra pessoa; o endpoint passa para quem inscreveu agora.
CREATE OR REPLACE FUNCTION public.push_subscription_save(_endpoint text, _p256dh text, _auth text, _ua text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_active_user() THEN RAISE EXCEPTION 'Usuário sem acesso'; END IF;
  IF coalesce(_endpoint, '') !~ '^https://' OR coalesce(_p256dh, '') = '' OR coalesce(_auth, '') = '' THEN RAISE EXCEPTION 'Inscrição inválida'; END IF;
  INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
  VALUES (auth.uid(), _endpoint, _p256dh, _auth, left(_ua, 300))
  ON CONFLICT (endpoint) DO UPDATE SET user_id = auth.uid(), p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth,
    user_agent = EXCLUDED.user_agent, created_at = now(), last_ok_at = NULL;
END $$;
REVOKE ALL ON FUNCTION public.push_subscription_save(text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.push_subscription_save(text, text, text, text) TO authenticated;
