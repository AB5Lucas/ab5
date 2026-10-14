ALTER TABLE public.andam_inventory ADD COLUMN location text NOT NULL DEFAULT 'obra' CHECK (location IN ('obra','central'));
ALTER TABLE public.andam_inventory ALTER COLUMN client_id DROP NOT NULL;
ALTER TABLE public.andam_inventory ADD CONSTRAINT andam_inventory_patio_chk CHECK ((location = 'central' AND client_id IS NULL AND work_id IS NULL) OR (location = 'obra' AND client_id IS NOT NULL));
CREATE OR REPLACE FUNCTION public.andam_finalize_inventory(_inv uuid)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE inv record; r record; diff numeric;
BEGIN
  IF NOT public.andam_can('/andaimes/inventario') THEN RAISE EXCEPTION 'Sem permissão'; END IF;
  SELECT * INTO inv FROM andam_inventory WHERE id = _inv FOR UPDATE;
  IF inv.status <> 'em_andamento' THEN RAISE EXCEPTION 'Inventário não está em andamento'; END IF;
  IF NOT public.andam_client_ok(inv.client_id) THEN RAISE EXCEPTION 'Sem permissão'; END IF;
  FOR r IN SELECT * FROM andam_inventory_items WHERE inventory_id = _inv AND counted_qty IS NOT NULL LOOP
    IF r.counted_qty < 0 THEN RAISE EXCEPTION 'Quantidade contada negativa'; END IF;
    PERFORM pg_advisory_xact_lock(hashtext('andam:' || r.item_id));
    SELECT coalesce(sum(quantity),0) INTO diff FROM andam_stock WHERE item_id = r.item_id AND location = inv.location
      AND client_id IS NOT DISTINCT FROM inv.client_id AND work_id IS NOT DISTINCT FROM inv.work_id;
    UPDATE andam_inventory_items SET system_qty = diff WHERE id = r.id;
    diff := r.counted_qty - diff;
    INSERT INTO andam_stock(item_id, location, client_id, work_id, quantity) VALUES (r.item_id, inv.location, inv.client_id, inv.work_id, r.counted_qty)
    ON CONFLICT (item_id, location, client_id, work_id) DO UPDATE SET quantity = r.counted_qty, updated_at = now();
    IF diff <> 0 THEN
      INSERT INTO andam_movements(item_id, kind, to_location, to_client_id, to_work_id, quantity, inventory_id, user_id, notes)
      VALUES (r.item_id, 'ajuste_inventario', inv.location, inv.client_id, inv.work_id, diff, _inv, auth.uid(), 'Inventário nº ' || inv.number);
    END IF;
  END LOOP;
  UPDATE andam_inventory SET status = 'finalizado', finalized_at = now(), finalized_by = auth.uid(), updated_at = now() WHERE id = _inv;
END $function$;