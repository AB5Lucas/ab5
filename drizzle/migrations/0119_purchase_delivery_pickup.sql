-- Local de entrega da SC: opção "Retirar" (o material é retirado no fornecedor).
ALTER TABLE public.purchase_requests DROP CONSTRAINT IF EXISTS purchase_requests_delivery_kind_check;
ALTER TABLE public.purchase_requests ADD CONSTRAINT purchase_requests_delivery_kind_check CHECK (delivery_kind IN ('ab5', 'cliente', 'outro', 'retirar'));
