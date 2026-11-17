-- Compras › Comprador: anexo do pedido de compras por item (order_file_path), gravado só por purchase_item_set_file.
ALTER TABLE public.purchase_request_items ADD COLUMN IF NOT EXISTS order_file_path text;
CREATE OR REPLACE FUNCTION public.purchase_items_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF coalesce(current_setting('purchase.rpc', true), '') = '1' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' THEN NEW.status := OLD.status; NEW.order_number := OLD.order_number; NEW.request_id := OLD.request_id; NEW.order_file_path := OLD.order_file_path; END IF;
  RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION public.purchase_item_set_file(_item uuid, _path text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.purchase_is_buyer() THEN RAISE EXCEPTION 'Sem acesso ao Comprador'; END IF;
  IF NOT EXISTS (SELECT 1 FROM purchase_request_items i JOIN purchase_requests r ON r.id = i.request_id WHERE i.id = _item AND r.stage = 'compras') THEN
    RAISE EXCEPTION 'Item não está em Compras';
  END IF;
  PERFORM set_config('purchase.rpc', '1', true);
  UPDATE purchase_request_items SET order_file_path = nullif(trim(coalesce(_path, '')), '') WHERE id = _item;
END $$;
REVOKE EXECUTE ON FUNCTION public.purchase_item_set_file(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.purchase_item_set_file(uuid, text) TO authenticated;
