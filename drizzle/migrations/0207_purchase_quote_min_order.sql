-- Faturamento mínimo do fornecedor na cotação (null = não lido/informado; 0 = sem mínimo).
alter table public.purchase_quotes add column if not exists min_order numeric;
comment on column public.purchase_quotes.min_order is 'Faturamento mínimo do fornecedor (R$). null = não lido/informado; 0 = sem mínimo.';
