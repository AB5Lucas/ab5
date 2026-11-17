-- Número da SC com o primeiro e o último nome do usuário (SC-LUCAS FRADE-001), não mais o primeiro e o segundo.
CREATE OR REPLACE FUNCTION public.purchase_requester_key(_name text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  WITH w AS (SELECT regexp_split_to_array(trim(translate(upper(coalesce(_name, '')),
    'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ', 'AAAAAEEEEIIIIOOOOOUUUUC')), '\s+') a)
  SELECT CASE WHEN coalesce(array_length(a, 1), 0) <= 1 THEN coalesce(a[1], '') ELSE a[1] || ' ' || a[array_length(a, 1)] END FROM w
$$;
