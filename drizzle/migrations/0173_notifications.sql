-- Sistema de notificações: tabela central (in-app), fila de envio por canal (push/e-mail/WhatsApp),
-- preferências por usuário, inscrições de Web Push, configuração global de prazos e resumos diários.
-- Criar notificação só por notify_user (ON CONFLICT (dedupe_key) DO NOTHING: nunca duplica nem recria).

CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  module text NOT NULL,
  kind text NOT NULL,
  title text NOT NULL,
  body text,
  link text,
  ref text,
  entity_type text,
  entity_id uuid,
  dedupe_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz
);
CREATE INDEX IF NOT EXISTS notifications_user_created_idx ON public.notifications (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS notifications_user_unread_idx ON public.notifications (user_id) WHERE read_at IS NULL;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.notifications FROM anon, authenticated;
GRANT SELECT ON public.notifications TO authenticated;
GRANT UPDATE (read_at) ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;
DROP POLICY IF EXISTS notifications_sel ON public.notifications;
CREATE POLICY notifications_sel ON public.notifications FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS notifications_upd ON public.notifications;
CREATE POLICY notifications_upd ON public.notifications FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'notifications') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
  END IF;
END $$;

-- Fila de envio (um registro por notificação × canal). O servidor (/api/public/jobs/notifications) processa.
CREATE TABLE IF NOT EXISTS public.notification_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_id uuid NOT NULL REFERENCES public.notifications(id) ON DELETE CASCADE,
  channel text NOT NULL CHECK (channel IN ('push', 'email', 'whatsapp')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'skipped_no_config', 'skipped_no_target')),
  error text,
  attempts int NOT NULL DEFAULT 0,
  locked_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  UNIQUE (notification_id, channel)
);
CREATE INDEX IF NOT EXISTS notification_deliveries_pending_idx ON public.notification_deliveries (created_at) WHERE status = 'pending';
ALTER TABLE public.notification_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.notification_deliveries FROM anon, authenticated;
GRANT SELECT ON public.notification_deliveries TO authenticated;
GRANT ALL ON public.notification_deliveries TO service_role;
DROP POLICY IF EXISTS notification_deliveries_sel ON public.notification_deliveries;
CREATE POLICY notification_deliveries_sel ON public.notification_deliveries FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.notifications n WHERE n.id = notification_id AND n.user_id = auth.uid()));

-- Preferências: app sempre ligado (não é coluna); pelo menos um canal além do app (CHECK).
CREATE TABLE IF NOT EXISTS public.notification_prefs (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  push_enabled boolean NOT NULL DEFAULT false,
  email_enabled boolean NOT NULL DEFAULT true,
  whatsapp_enabled boolean NOT NULL DEFAULT false,
  whatsapp_phone text,
  digest_enabled boolean NOT NULL DEFAULT false,
  digest_days int[] NOT NULL DEFAULT '{1,2,3,4,5}',
  digest_time time NOT NULL DEFAULT '07:30',
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT notification_prefs_one_channel CHECK (push_enabled OR email_enabled OR whatsapp_enabled),
  CONSTRAINT notification_prefs_digest_days CHECK (digest_days <@ ARRAY[0,1,2,3,4,5,6])
);
ALTER TABLE public.notification_prefs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.notification_prefs FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.notification_prefs TO authenticated;
GRANT ALL ON public.notification_prefs TO service_role;
DROP POLICY IF EXISTS notification_prefs_own ON public.notification_prefs;
CREATE POLICY notification_prefs_own ON public.notification_prefs FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- Padrão para quem já existe (e-mail ligado) e para todo usuário novo.
INSERT INTO public.notification_prefs (user_id)
SELECT up.id FROM public.users_profiles up WHERE EXISTS (SELECT 1 FROM auth.users u WHERE u.id = up.id)
ON CONFLICT (user_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.notification_prefs_default() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.notification_prefs (user_id) VALUES (NEW.id) ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_users_profiles_notification_prefs ON public.users_profiles;
CREATE TRIGGER trg_users_profiles_notification_prefs AFTER INSERT ON public.users_profiles
  FOR EACH ROW EXECUTE FUNCTION public.notification_prefs_default();

-- Web Push: uma inscrição por navegador/celular.
CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint text NOT NULL UNIQUE,
  p256dh text NOT NULL,
  auth text NOT NULL,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_ok_at timestamptz
);
CREATE INDEX IF NOT EXISTS push_subscriptions_user_idx ON public.push_subscriptions (user_id);
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.push_subscriptions FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.push_subscriptions TO authenticated;
GRANT ALL ON public.push_subscriptions TO service_role;
DROP POLICY IF EXISTS push_subscriptions_own ON public.push_subscriptions;
CREATE POLICY push_subscriptions_own ON public.push_subscriptions FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- Configuração global (uma linha): dias de antecedência e de urgência do prazo das SCs. Só admin altera.
CREATE TABLE IF NOT EXISTS public.notification_settings (
  id int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  advance_days int NOT NULL DEFAULT 5 CHECK (advance_days BETWEEN 1 AND 60),
  urgent_days int NOT NULL DEFAULT 2 CHECK (urgent_days BETWEEN 0 AND 30),
  started_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  CONSTRAINT notification_settings_order CHECK (urgent_days < advance_days)
);
INSERT INTO public.notification_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
ALTER TABLE public.notification_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.notification_settings FROM anon, authenticated;
GRANT SELECT ON public.notification_settings TO authenticated;
GRANT UPDATE (advance_days, urgent_days, updated_at, updated_by) ON public.notification_settings TO authenticated;
GRANT ALL ON public.notification_settings TO service_role;
DROP POLICY IF EXISTS notification_settings_sel ON public.notification_settings;
CREATE POLICY notification_settings_sel ON public.notification_settings FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS notification_settings_upd ON public.notification_settings;
CREATE POLICY notification_settings_upd ON public.notification_settings FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Resumo diário pelo WhatsApp: um por usuário e dia (o envio grava aqui antes de mandar; nunca repete).
CREATE TABLE IF NOT EXISTS public.notification_digests (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  day date NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'empty', 'skipped_no_config', 'skipped_no_target')),
  body text,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  PRIMARY KEY (user_id, day)
);
ALTER TABLE public.notification_digests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.notification_digests FROM anon, authenticated;
GRANT SELECT ON public.notification_digests TO authenticated;
GRANT ALL ON public.notification_digests TO service_role;
DROP POLICY IF EXISTS notification_digests_sel ON public.notification_digests;
CREATE POLICY notification_digests_sel ON public.notification_digests FOR SELECT TO authenticated USING (user_id = auth.uid());

-- Colaborador do usuário (nome do usuário contido no nome do cadastro, mesmo primeiro nome, só com um casamento).
CREATE OR REPLACE FUNCTION public.notif_collaborator_of_user(_user uuid) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH u AS (SELECT regexp_split_to_array(trim(translate(upper(full_name), 'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ', 'AAAAAEEEEIIIIOOOOOUUUUC')), '\s+') w
             FROM users_profiles WHERE id = _user AND coalesce(trim(full_name), '') <> ''),
  c AS (SELECT id, regexp_split_to_array(trim(translate(upper(full_name), 'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ', 'AAAAAEEEEIIIIOOOOOUUUUC')), '\s+') w
        FROM collaborators WHERE status = 'active'),
  hit AS (SELECT c.id FROM c, u WHERE c.w[1] = u.w[1] AND u.w <@ c.w)
  SELECT CASE WHEN (SELECT count(*) FROM hit) = 1 THEN (SELECT id FROM hit) END
$$;
REVOKE ALL ON FUNCTION public.notif_collaborator_of_user(uuid) FROM PUBLIC, anon, authenticated;

-- WhatsApp do usuário: o digitado na preferência, senão o telefone do cadastro do colaborador.
CREATE OR REPLACE FUNCTION public.notif_whatsapp_phone(_user uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(
    (SELECT nullif(trim(whatsapp_phone), '') FROM notification_prefs WHERE user_id = _user),
    (SELECT nullif(trim(phone), '') FROM collaborators WHERE id = public.notif_collaborator_of_user(_user)))
$$;
REVOKE ALL ON FUNCTION public.notif_whatsapp_phone(uuid) FROM PUBLIC, anon, authenticated;

-- Contato do próprio usuário para a tela de preferências (e-mail do login e telefone do cadastro).
CREATE OR REPLACE FUNCTION public.notification_my_contact() RETURNS TABLE (email text, collaborator_phone text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT up.email, (SELECT nullif(trim(c.phone), '') FROM collaborators c WHERE c.id = public.notif_collaborator_of_user(up.id))
  FROM users_profiles up WHERE up.id = auth.uid()
$$;
REVOKE ALL ON FUNCTION public.notification_my_contact() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.notification_my_contact() TO authenticated;

-- Compradores = mesma regra do aviso do menu Comprador: exceção da pessoa em /compras/comprador manda; sem exceção, grupo de acesso "Compras".
CREATE OR REPLACE FUNCTION public.notif_buyer_ids() RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT up.id FROM users_profiles up
  LEFT JOIN user_page_access x ON x.user_id = up.id AND x.path = '/compras/comprador'
  LEFT JOIN access_groups g ON g.id = up.access_group_id
  WHERE up.active AND coalesce(x.allowed, trim(g.name) ~* '^compras$', false)
$$;
REVOKE ALL ON FUNCTION public.notif_buyer_ids() FROM PUBLIC, anon, authenticated;

-- Única porta de criação. Não notifica o autor da ação (auth.uid()) nem usuário inativo; dedupe_key nunca repete.
CREATE OR REPLACE FUNCTION public.notify_user(_user uuid, _module text, _kind text, _title text, _body text, _link text,
  _ref text, _entity_type text, _entity_id uuid, _dedupe text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _id uuid;
BEGIN
  IF _user IS NULL OR _dedupe IS NULL OR _user = auth.uid() THEN RETURN NULL; END IF;
  IF NOT EXISTS (SELECT 1 FROM users_profiles WHERE id = _user AND active) THEN RETURN NULL; END IF;
  INSERT INTO notifications (user_id, module, kind, title, body, link, ref, entity_type, entity_id, dedupe_key)
  VALUES (_user, _module, _kind, _title, _body, _link, _ref, _entity_type, _entity_id, _dedupe)
  ON CONFLICT (dedupe_key) DO NOTHING RETURNING id INTO _id;
  RETURN _id;
END $$;
REVOKE ALL ON FUNCTION public.notify_user(uuid, text, text, text, text, text, text, text, uuid, text) FROM PUBLIC, anon, authenticated;

-- Cada notificação nova entra na fila dos canais ligados na preferência (sem preferência = e-mail).
CREATE OR REPLACE FUNCTION public.notifications_enqueue() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE p notification_prefs;
BEGIN
  SELECT * INTO p FROM notification_prefs WHERE user_id = NEW.user_id;
  IF p.user_id IS NULL THEN p.push_enabled := false; p.email_enabled := true; p.whatsapp_enabled := false; END IF;
  INSERT INTO notification_deliveries (notification_id, channel)
  SELECT NEW.id, ch FROM unnest(ARRAY[
    CASE WHEN p.push_enabled THEN 'push' END,
    CASE WHEN p.email_enabled THEN 'email' END,
    CASE WHEN p.whatsapp_enabled THEN 'whatsapp' END]) ch
  WHERE ch IS NOT NULL
  ON CONFLICT (notification_id, channel) DO NOTHING;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_notifications_enqueue ON public.notifications;
CREATE TRIGGER trg_notifications_enqueue AFTER INSERT ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION public.notifications_enqueue();

-- Notificação de teste para o próprio usuário (tela de preferências); no máximo uma por minuto.
CREATE OR REPLACE FUNCTION public.notification_send_test() RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _id uuid;
BEGIN
  IF NOT public.is_active_user() THEN RAISE EXCEPTION 'Usuário sem acesso'; END IF;
  INSERT INTO notifications (user_id, module, kind, title, body, link, dedupe_key)
  VALUES (auth.uid(), 'sistema', 'teste', 'Notificação de teste', 'Se você recebeu esta mensagem, o canal está funcionando.', '/notificacoes',
    'test:' || auth.uid() || ':' || to_char(now(), 'YYYYMMDDHH24MI'))
  ON CONFLICT (dedupe_key) DO NOTHING RETURNING id INTO _id;
  RETURN _id;
END $$;
REVOKE ALL ON FUNCTION public.notification_send_test() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.notification_send_test() TO authenticated;
