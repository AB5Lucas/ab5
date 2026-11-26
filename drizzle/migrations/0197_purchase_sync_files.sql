-- Último relatório de Compras lido por mês (pular arquivo sem mudança) e o erro da leitura, se houver.
create table if not exists public.purchase_sync_files (
  ym text primary key, file_path text not null, etag text, size bigint, synced_at timestamptz not null default now(), ok boolean not null default true, message text);
alter table public.purchase_sync_files enable row level security;
drop policy if exists purchase_sync_files_select on public.purchase_sync_files;
create policy purchase_sync_files_select on public.purchase_sync_files for select to authenticated using (public.can_access_page('/obras/compras'));
