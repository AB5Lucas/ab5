-- Observadores fixos em toda SC: Marcelo Barrella Martin e Vitória de Melo Brasilino (fora das SCs dela mesma).
CREATE OR REPLACE FUNCTION public.purchase_fixed_observers() RETURNS uuid[] LANGUAGE sql IMMUTABLE AS $$
  SELECT ARRAY['cfd87887-421e-48f6-871c-a229e8634700', '01d11e92-6fa0-4a73-acd8-9561d98de54e']::uuid[]
$$;
UPDATE public.purchase_requests SET observer_ids = observer_ids;
