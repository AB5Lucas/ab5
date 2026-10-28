CREATE OR REPLACE FUNCTION public.billing_keep_manual_replace() RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
 IF OLD.method='manual' AND OLD.status='posted' AND NOT coalesce(NEW.cancelled,false) THEN
  NEW.status:=OLD.status; NEW.entry_id:=OLD.entry_id; NEW.work_id:=OLD.work_id; NEW.method:=OLD.method; NEW.reason:=OLD.reason;
 END IF;
 RETURN NEW; END $$;
DROP TRIGGER IF EXISTS keep_manual_replace ON public.billing_sync_notes;
CREATE TRIGGER keep_manual_replace BEFORE UPDATE ON public.billing_sync_notes FOR EACH ROW EXECUTE FUNCTION public.billing_keep_manual_replace();
CREATE OR REPLACE FUNCTION public.billing_keep_manual_entry() RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
 IF NEW.sync_note_id IS NOT NULL AND EXISTS(SELECT 1 FROM billing_sync_notes s WHERE s.id=NEW.sync_note_id AND s.method='manual' AND s.status='posted' AND NOT s.cancelled) THEN
  NEW.sync_cancelled:=false; NEW.work_id:=OLD.work_id; NEW.description:=OLD.description;
 END IF;
 RETURN NEW; END $$;
DROP TRIGGER IF EXISTS keep_manual_entry ON public.work_entries;
CREATE TRIGGER keep_manual_entry BEFORE UPDATE ON public.work_entries FOR EACH ROW WHEN (OLD.sync_note_id IS NOT NULL) EXECUTE FUNCTION public.billing_keep_manual_entry();