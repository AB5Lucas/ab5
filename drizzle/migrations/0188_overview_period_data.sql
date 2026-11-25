-- Visão geral de Atividades: dados do período numa só chamada, já compactados (escalações, horas do RDO,
-- RDOs, custos somados por dia/serviço/categoria e km por dia). SECURITY INVOKER: valem as políticas (RLS).
create or replace function public.overview_period_data(_from date, _to date)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'allocs', coalesce((select jsonb_agg(jsonb_build_array(s.schedule_date, a.work_id, a.collaborator_id))
      from daily_allocations a join daily_schedules s on s.id = a.schedule_id
      where s.schedule_date between _from and _to and a.work_id is not null), '[]'::jsonb),
    'wf', coalesce((select jsonb_agg(jsonb_build_array(w.collaborator_id, w.work_id, w.report_date, w.worked_hours))
      from rdo_workforce w where w.report_date between _from and _to and w.worked_hours is not null), '[]'::jsonb),
    'rdos', coalesce((select jsonb_agg(jsonb_build_array(r.report_date, r.work_id, r.client_id, r.status = 'finalized'))
      from rdos r where r.report_date between _from and _to), '[]'::jsonb),
    'costs', coalesce((select jsonb_agg(jsonb_build_array(c.entry_date, c.work_id, c.category, c.total)) from (
      select e.entry_date, e.work_id, e.category, sum(e.amount) as total from work_entries e
      where e.category in ('mao_obra','terceiros','materiais','ferramentas','andaimes') and e.entry_date between _from and _to
      group by 1, 2, 3) c), '[]'::jsonb),
    'km', coalesce((select jsonb_agg(jsonb_build_array(k.schedule_date, k.km)) from (
      select v.schedule_date, sum(coalesce(v.km, 0) * 2 * coalesce(nullif(v.trips, 0), 1) + coalesce(v.extra_km, 0)) as km
      from vehicle_schedules v where v.schedule_date between _from and _to and not coalesce(v.is_maintenance, false)
      group by 1) k), '[]'::jsonb)
  );
$$;
grant execute on function public.overview_period_data(date, date) to authenticated;
