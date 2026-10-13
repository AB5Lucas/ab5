CREATE OR REPLACE FUNCTION public.is_active_user()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (SELECT 1 FROM public.users_profiles WHERE id = auth.uid() AND active);
$$;

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT tablename, policyname, cmd FROM pg_policies
    WHERE schemaname='public' AND (qual='true' OR with_check='true')
  LOOP
    IF r.tablename IN ('users_profiles','user_roles') THEN
      EXECUTE format('ALTER POLICY %I ON public.%I USING (public.is_active_user() OR %s = auth.uid())',
        r.policyname, r.tablename, CASE WHEN r.tablename='users_profiles' THEN 'id' ELSE 'user_id' END);
    ELSIF r.cmd = 'ALL' THEN
      EXECUTE format('ALTER POLICY %I ON public.%I USING (public.is_active_user()) WITH CHECK (public.is_active_user())', r.policyname, r.tablename);
    ELSE
      EXECUTE format('ALTER POLICY %I ON public.%I USING (public.is_active_user())', r.policyname, r.tablename);
    END IF;
  END LOOP;
END $$;