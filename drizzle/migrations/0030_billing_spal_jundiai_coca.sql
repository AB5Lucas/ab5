CREATE OR REPLACE FUNCTION public.billing_client_key(v text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE normalized WHEN 'SPALJUNDIAI' THEN 'COCA' ELSE normalized END
  FROM (SELECT regexp_replace(translate(upper(coalesce(v,'')), 'ÁÀÂÃÉÈÊÍÓÔÕÚÜÇ', 'AAAAEEEIOOOUUC'), '[^A-Z0-9]', '', 'g') AS normalized) keys
$$;