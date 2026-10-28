CREATE OR REPLACE FUNCTION public.billing_note_replace(_note uuid, _entry uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE n record; e record; old_note uuid;
BEGIN
 IF NOT public.can_access_page('/relatorios/sincronizacao') THEN RAISE EXCEPTION 'Sem acesso'; END IF;
 SELECT * INTO n FROM billing_sync_notes WHERE id=_note FOR UPDATE;
 IF n.id IS NULL THEN RAISE EXCEPTION 'Nota não encontrada'; END IF;
 IF n.status='posted' THEN RAISE EXCEPTION 'Nota já lançada'; END IF;
 SELECT * INTO e FROM work_entries WHERE id=_entry AND category='faturamento' FOR UPDATE;
 IF e.id IS NULL THEN RAISE EXCEPTION 'Lançamento não encontrado'; END IF;
 old_note := e.sync_note_id;
 IF old_note IS NOT NULL THEN
  UPDATE billing_sync_notes SET status='cancelled', cancelled=true, cancelled_at=now(), entry_id=NULL,
   reason='Substituída pela NFSe '||n.invoice_number WHERE id=old_note;
 END IF;
 PERFORM set_config('app.industry_manual','on',true);
 UPDATE work_entries SET sync_note_id=n.id, sync_cancelled=false, amount=n.amount, entry_date=n.issued_at,
  description='NFSe '||n.invoice_number||' · Substitui '||e.description WHERE id=e.id;
 UPDATE billing_sync_notes SET status='posted', entry_id=e.id, work_id=e.work_id, method='manual',
  reason='Substituiu lançamento anterior ('||e.description||')', last_attempt_at=now() WHERE id=n.id;
 INSERT INTO billing_sync_history(note_id, action, snapshot)
 VALUES(n.id,'replaced',jsonb_build_object('by',auth.uid(),'entry',e.id,'previous_description',e.description,'previous_amount',e.amount,'previous_date',e.entry_date,'previous_note',old_note));
END $$;
GRANT EXECUTE ON FUNCTION public.billing_note_replace(uuid,uuid) TO authenticated;