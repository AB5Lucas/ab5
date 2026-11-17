-- Observador fixo em toda SC: só Marcelo Barrella Martin (Lucas Garcia deixa de ser obrigatório).
CREATE OR REPLACE FUNCTION public.purchase_fixed_observers() RETURNS uuid[] LANGUAGE sql IMMUTABLE AS $$
  SELECT ARRAY['cfd87887-421e-48f6-871c-a229e8634700']::uuid[]
$$;
UPDATE public.purchase_requests SET observer_ids = array_remove(observer_ids, 'f3c94145-62f8-452f-a665-eb5e56cffd6a');
