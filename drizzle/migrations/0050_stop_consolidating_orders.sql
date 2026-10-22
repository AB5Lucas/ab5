-- Orders with the same number stay as separate entries, each with its own value.
CREATE OR REPLACE FUNCTION public.works_consolidate_orders() RETURNS trigger
LANGUAGE plpgsql SET search_path TO 'public' AS $function$
BEGIN RETURN NEW; END $function$;