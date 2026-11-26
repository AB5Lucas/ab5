-- Orçado de transporte da frota por mês guardado para o dashboard de Veículos abrir na hora (recalculado por trás quando velho).
create table if not exists public.fleet_budget_cache (
  ym text primary key, value numeric not null, computed_at timestamptz not null default now(), computed_by uuid default auth.uid());
alter table public.fleet_budget_cache enable row level security;
drop policy if exists fleet_budget_cache_select on public.fleet_budget_cache;
drop policy if exists fleet_budget_cache_write on public.fleet_budget_cache;
drop policy if exists fleet_budget_cache_update on public.fleet_budget_cache;
create policy fleet_budget_cache_select on public.fleet_budget_cache for select to authenticated using (public.can_access_page('/frota/custos'));
create policy fleet_budget_cache_write on public.fleet_budget_cache for insert to authenticated with check (public.can_access_page('/frota/custos'));
create policy fleet_budget_cache_update on public.fleet_budget_cache for update to authenticated using (public.can_access_page('/frota/custos')) with check (public.can_access_page('/frota/custos'));
