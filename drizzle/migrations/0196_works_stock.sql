-- Almoxarifado do cliente: serviço fictício e temporário que recebe compras do cliente sem serviço com movimentação no mês.
alter table public.works add column if not exists is_stock boolean not null default false;
comment on column public.works.is_stock is 'Serviço fictício Almoxarifado do cliente: recebe compras do cliente sem serviço com movimentação no mês; temporário (apagado quando fica sem custos), fora da aba Serviços.';
