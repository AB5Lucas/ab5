-- Usuário novo (cadastro pela tela de login) fica pendente até o admin ativar/desativar ou trocar o perfil:
-- bolinha vermelha no rodapé do menu para quem acessa Usuários.
ALTER TABLE public.users_profiles ADD COLUMN IF NOT EXISTS pending boolean NOT NULL DEFAULT false;
CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE first_user BOOLEAN;
BEGIN
  SELECT NOT EXISTS (SELECT 1 FROM public.user_roles) INTO first_user;
  INSERT INTO public.users_profiles (id, full_name, email, active, pending)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name',''), COALESCE(NEW.email,''), first_user, NOT first_user);
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, CASE WHEN first_user THEN 'admin'::public.app_role ELSE 'viewer'::public.app_role END);
  RETURN NEW;
END; $function$;
CREATE OR REPLACE FUNCTION public.users_profiles_clear_pending() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.active IS DISTINCT FROM OLD.active THEN NEW.pending := false; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_users_profiles_clear_pending ON public.users_profiles;
CREATE TRIGGER trg_users_profiles_clear_pending BEFORE UPDATE OF active ON public.users_profiles FOR EACH ROW EXECUTE FUNCTION public.users_profiles_clear_pending();
