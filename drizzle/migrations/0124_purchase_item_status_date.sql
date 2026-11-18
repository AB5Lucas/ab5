-- Compras: data real do status de cada item (status_at), escolhida pelo Comprador (purchase_item_set _date);
-- sem data, vale hoje quando o status muda.
ALTER TABLE public.purchase_request_items ADD COLUMN IF NOT EXISTS status_at date;
CREATE OR REPLACE FUNCTION public.purchase_items_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF coalesce(current_setting('purchase.rpc', true), '') = '1' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' THEN NEW.status := OLD.status; NEW.order_number := OLD.order_number; NEW.request_id := OLD.request_id; NEW.order_file_path := OLD.order_file_path; NEW.status_at := OLD.status_at; END IF;
  RETURN NEW;
END $$;
DROP FUNCTION IF EXISTS public.purchase_item_set(uuid, text, text);
CREATE OR REPLACE FUNCTION public.purchase_item_set(_item uuid, _status text, _order text, _date date DEFAULT NULL) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE i purchase_request_items;
BEGIN
  IF NOT public.purchase_is_buyer() THEN RAISE EXCEPTION 'Sem acesso ao Comprador'; END IF;
  SELECT it.* INTO i FROM purchase_request_items it JOIN purchase_requests r ON r.id = it.request_id WHERE it.id = _item AND r.stage = 'compras';
  IF i.id IS NULL THEN RAISE EXCEPTION 'Item não está em Compras'; END IF;
  PERFORM set_config('purchase.rpc', '1', true);
  UPDATE purchase_request_items SET status = coalesce(nullif(_status, ''), status), order_number = nullif(trim(coalesce(_order, '')), ''),
    status_at = coalesce(_date, CASE WHEN nullif(_status, '') IS DISTINCT FROM i.status THEN (now() AT TIME ZONE 'America/Sao_Paulo')::date ELSE i.status_at END)
  WHERE id = _item;
END $$;
REVOKE EXECUTE ON FUNCTION public.purchase_item_set(uuid, text, text, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.purchase_item_set(uuid, text, text, date) TO authenticated;
