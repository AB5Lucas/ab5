-- Faturamento › Serviços: nota pendente lançada à mão num serviço escolhido (cliente → serviço).
-- Cria o pedido no serviço com os dados da nota (nº do pedido da nota, senão o orçamento, senão "NFSe <nº>";
-- valor e data da nota) e lança o faturamento ligado à nota (method manual: a sincronização não desfaz,
-- billing_keep_manual_entry). Recusa se já existe faturamento manual igual (mesmo serviço, data e valor).
create or replace function public.billing_note_post_to_work(_note uuid, _work uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare n record; w record; num text; eid uuid; descr text; has_order boolean;
begin
  if not public.can_access_page('/relatorios/sincronizacao') then raise exception 'Sem acesso'; end if;
  perform pg_advisory_xact_lock(hashtext('billing_sync_financial'));
  select * into n from billing_sync_notes where id = _note for update;
  if n.id is null then raise exception 'Nota não encontrada'; end if;
  if n.status = 'posted' then raise exception 'Nota já lançada'; end if;
  if n.cancelled or n.status = 'cancelled' then raise exception 'Nota cancelada'; end if;
  select * into w from works where id = _work for update;
  if w.id is null then raise exception 'Serviço não encontrado'; end if;
  if exists (select 1 from work_entries e where e.work_id = _work and e.category = 'faturamento' and not e.sync_cancelled
             and e.sync_note_id is null and e.sync_split_note_id is null and e.entry_date = n.issued_at and round(e.amount * 100) = round(n.amount * 100)) then
    raise exception 'Já existe faturamento lançado à mão nesse serviço com a mesma data e valor; use "Substituir lançamento"';
  end if;
  num := coalesce(nullif(trim(n.order_number), ''), nullif(trim(n.quote_number), ''), 'NFSe ' || n.invoice_number);
  select exists (select 1 from jsonb_array_elements(case when jsonb_typeof(w.orders) = 'array' then w.orders else '[]' end) o
                 where billing_doc_key(o->>'number') = billing_doc_key(num)) or billing_doc_key(w.order_number) = billing_doc_key(num)
    into has_order;
  if not has_order then
    update works set orders = (case when jsonb_typeof(orders) = 'array' then orders else '[]' end)
      || jsonb_build_array(jsonb_build_object('number', num, 'value', n.amount, 'date', n.issued_at))
    where id = _work;
  end if;
  perform set_config('app.industry_manual', 'on', true);
  descr := coalesce(billing_entry_desc(coalesce(n.original, '{}'::jsonb) || jsonb_build_object('invoice', n.invoice_number, 'order', num), _work),
                    'NFSe ' || n.invoice_number);
  insert into work_entries(work_id, entry_date, category, description, amount, sync_note_id)
    values (_work, n.issued_at, 'faturamento', descr, n.amount, n.id) returning id into eid;
  update billing_sync_notes set status = 'posted', entry_id = eid, work_id = _work, method = 'manual',
    reason = case when has_order then 'Lançada à mão no serviço ' || w.name || ' (pedido ' || num || ' já existia)'
                  else 'Lançada à mão: pedido ' || num || ' criado no serviço ' || w.name end,
    last_attempt_at = now()
  where id = n.id;
  insert into billing_sync_history(note_id, action, snapshot)
    values (n.id, 'manual_post', jsonb_build_object('by', auth.uid(), 'work', _work, 'entry', eid, 'order', num, 'order_created', not has_order));
  return eid;
end $$;
revoke all on function public.billing_note_post_to_work(uuid, uuid) from public;
grant execute on function public.billing_note_post_to_work(uuid, uuid) to authenticated;

-- A sincronização não mexe em nota lançada à mão (method manual, posted) enquanto valor e situação não mudarem na origem
-- (sem isso, nota sem pedido/orçamento voltava a "pendente" na leitura seguinte). Remendo no corpo atual da função.
do $do$
declare d text; anchor text := E'SELECT * INTO oldnote FROM billing_sync_notes WHERE source_key=n->>''key'' FOR UPDATE;\n';
begin
  d := pg_get_functiondef('public.billing_sync_process(uuid,jsonb)'::regprocedure);
  if position('manual_kept' in d) = 0 then
    if position(anchor in d) = 0 then raise exception 'anchor not found'; end if;
    d := replace(d, anchor, anchor || E'  -- manual_kept: nota lançada à mão (Substituir / lançar no serviço) fica como está enquanto valor e situação não mudarem na origem\n  IF oldnote.id IS NOT NULL AND oldnote.method=''manual'' AND oldnote.status=''posted'' AND oldnote.entry_id IS NOT NULL AND NOT coalesce((n->>''cancelled'')::boolean,false) AND round(oldnote.amount*100)=(n->>''amountCents'')::bigint THEN CONTINUE; END IF;\n');
    execute d;
  end if;
end $do$;
