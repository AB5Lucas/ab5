-- Pessoa num quadro do dia (treinamento personalizado, folga, atestado…) não pode estar também numa obra.
CREATE OR REPLACE FUNCTION public.status_entry_removes_allocation() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  DELETE FROM daily_allocations WHERE schedule_id = NEW.schedule_id AND collaborator_id = NEW.collaborator_id;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_status_entry_removes_allocation ON public.daily_status_entries;
CREATE TRIGGER trg_status_entry_removes_allocation AFTER INSERT ON public.daily_status_entries
  FOR EACH ROW EXECUTE FUNCTION public.status_entry_removes_allocation();

CREATE OR REPLACE FUNCTION public.allocation_skips_boxed() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM daily_status_entries e WHERE e.schedule_id = NEW.schedule_id AND e.collaborator_id = NEW.collaborator_id) THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_allocation_skips_boxed ON public.daily_allocations;
CREATE TRIGGER trg_allocation_skips_boxed BEFORE INSERT ON public.daily_allocations
  FOR EACH ROW EXECUTE FUNCTION public.allocation_skips_boxed();
