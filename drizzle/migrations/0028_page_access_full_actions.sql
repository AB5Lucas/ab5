CREATE OR REPLACE FUNCTION public.can_write() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$ SELECT auth.uid() IS NOT NULL AND public.is_active_user(); $$;
DO $$ DECLARE r record; BEGIN
FOR r IN SELECT tablename, policyname FROM pg_policies WHERE schemaname='public' AND cmd='DELETE' AND qual='is_admin()' AND tablename NOT IN ('role_page_access','user_page_access') LOOP
  EXECUTE format('ALTER POLICY %I ON public.%I USING (public.can_write())', r.policyname, r.tablename);
END LOOP; END $$;