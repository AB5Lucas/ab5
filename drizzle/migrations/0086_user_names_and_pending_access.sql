-- Nomes de usuário padronizados: só a primeira letra de cada nome em maiúscula, espaços simples.
CREATE OR REPLACE FUNCTION public.title_case_name(_name text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT initcap(lower(regexp_replace(btrim(coalesce(_name, '')), '\s+', ' ', 'g')))
$$;
CREATE OR REPLACE FUNCTION public.users_profiles_title_case() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.full_name := public.title_case_name(NEW.full_name);
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_users_profiles_title_case ON public.users_profiles;
CREATE TRIGGER trg_users_profiles_title_case BEFORE INSERT OR UPDATE OF full_name ON public.users_profiles
  FOR EACH ROW EXECUTE FUNCTION public.users_profiles_title_case();
UPDATE public.users_profiles SET full_name = public.title_case_name(full_name)
  WHERE full_name IS DISTINCT FROM public.title_case_name(full_name);

-- Usuário novo entra sem nenhum acesso (inativo) até o administrador liberar em Usuários.
-- O primeiro usuário do sistema continua virando administrador ativo.
CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE first_user BOOLEAN;
BEGIN
  SELECT NOT EXISTS (SELECT 1 FROM public.user_roles) INTO first_user;
  INSERT INTO public.users_profiles (id, full_name, email, active)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name',''), COALESCE(NEW.email,''), first_user);
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, CASE WHEN first_user THEN 'admin'::public.app_role ELSE 'viewer'::public.app_role END);
  RETURN NEW;
END; $function$;

-- Só o administrador libera ou bloqueia o acesso: o próprio usuário não pode mudar "active".
CREATE OR REPLACE FUNCTION public.users_profiles_guard_active() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.active IS DISTINCT FROM OLD.active AND coalesce(auth.role(), '') <> 'service_role' AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Somente o administrador pode liberar ou bloquear o acesso.';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_users_profiles_guard_active ON public.users_profiles;
CREATE TRIGGER trg_users_profiles_guard_active BEFORE UPDATE OF active ON public.users_profiles
  FOR EACH ROW EXECUTE FUNCTION public.users_profiles_guard_active();
