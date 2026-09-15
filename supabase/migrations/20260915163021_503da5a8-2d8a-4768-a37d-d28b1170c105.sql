ALTER TABLE public.clients DROP CONSTRAINT IF EXISTS clients_name_key;
DROP INDEX IF EXISTS public.clients_name_key;