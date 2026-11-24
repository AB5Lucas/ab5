-- Gestor e substituto passam do serviço para o cliente.
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS manager_id uuid REFERENCES public.collaborators(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS substitute_manager_id uuid REFERENCES public.collaborators(id) ON DELETE SET NULL;
UPDATE public.clients c SET manager_id = (SELECT manager_id FROM works w WHERE w.client_id = c.id AND manager_id IS NOT NULL GROUP BY manager_id ORDER BY count(*) FILTER (WHERE active) DESC, count(*) DESC, manager_id LIMIT 1),
  substitute_manager_id = (SELECT substitute_manager_id FROM works w WHERE w.client_id = c.id AND substitute_manager_id IS NOT NULL GROUP BY substitute_manager_id ORDER BY count(*) FILTER (WHERE active) DESC, count(*) DESC, substitute_manager_id LIMIT 1);
CREATE OR REPLACE FUNCTION public.purchase_client_manager(_client uuid) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
  SELECT manager_id FROM clients WHERE id = _client
$f$;
CREATE OR REPLACE FUNCTION public.purchase_client_substitute(_client uuid, _manager uuid) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
  SELECT substitute_manager_id FROM clients WHERE id = _client
$f$;
DROP TRIGGER IF EXISTS trg_works_default_manager ON public.works;
DROP FUNCTION IF EXISTS public.works_default_manager();
ALTER TABLE public.works DROP COLUMN IF EXISTS manager_id, DROP COLUMN IF EXISTS substitute_manager_id;
