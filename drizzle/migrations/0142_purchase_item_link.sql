-- Item da SC: link de referência do produto (ícone ao lado do clipe da cotação).
ALTER TABLE public.purchase_request_items ADD COLUMN IF NOT EXISTS link_url text;
