-- Outros prefixos de CC do mesmo cliente nos relatórios de Compras (2111 GENERAL MILLS = Três Corações)
-- e remoção dos 72 lançamentos manuais de out/26 da Três Corações que repetiam itens do relatório (cópia em backup_work_entries_20261126).
alter table public.clients add column if not exists cc_alt_prefixes text[] not null default '{}';
comment on column public.clients.cc_alt_prefixes is 'Outros prefixos de CC do mesmo cliente nos relatórios de Compras (ex.: 2111 GENERAL MILLS = Três Corações).';
update public.clients set cc_alt_prefixes = array['2111'] where cc_prefix='2117' and name ilike 'TR%S CORA%';
create table if not exists public.backup_work_entries_20261126 as select * from public.work_entries where false;
insert into public.backup_work_entries_20261126 select e.* from public.work_entries e join public.works w on w.id=e.work_id join public.clients c on c.id=w.client_id
  where e.purchase_cc_id is null and e.category='materiais' and e.description like 'Rateio por hora trabalhada%' and e.entry_date='2026-10-31' and c.cc_prefix='2117';
alter table public.backup_work_entries_20261126 enable row level security;
delete from public.work_entries e using public.backup_work_entries_20261126 b where e.id=b.id;
