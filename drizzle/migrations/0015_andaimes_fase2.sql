CREATE TABLE public.andam_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number bigserial NOT NULL,
  client_id uuid NOT NULL REFERENCES public.clients(id),
  work_id uuid REFERENCES public.works(id),
  request_date date NOT NULL DEFAULT current_date,
  needed_date date,
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('baixa','normal','alta','urgente')),
  status text NOT NULL DEFAULT 'aberta' CHECK (status IN ('aberta','em_analise','aguardando_separacao','em_separacao','parcialmente_separada','separada','compra_necessaria','compra_realizada','em_transito','recebida','atendida','cancelada')),
  notes text,
  user_id uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.andam_request_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.andam_requests(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES public.andam_items(id),
  requested_qty numeric NOT NULL CHECK (requested_qty > 0),
  separated_qty numeric NOT NULL DEFAULT 0 CHECK (separated_qty >= 0),
  purchase_status text CHECK (purchase_status IN ('compra_necessaria','compra_solicitada','compra_realizada','recebido')),
  UNIQUE (request_id, item_id)
);
CREATE TABLE public.andam_romaneios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number bigserial NOT NULL,
  request_id uuid REFERENCES public.andam_requests(id) ON DELETE SET NULL,
  client_id uuid NOT NULL REFERENCES public.clients(id),
  work_id uuid REFERENCES public.works(id),
  romaneio_date date NOT NULL DEFAULT current_date,
  status text NOT NULL DEFAULT 'rascunho' CHECK (status IN ('rascunho','em_transito','recebido','retornado','cancelado')),
  notes text,
  user_id uuid DEFAULT auth.uid(),
  sent_at timestamptz, received_at timestamptz, returned_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.andam_romaneio_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  romaneio_id uuid NOT NULL REFERENCES public.andam_romaneios(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES public.andam_items(id),
  requested_qty numeric NOT NULL DEFAULT 0,
  separated_qty numeric NOT NULL DEFAULT 0,
  sent_qty numeric NOT NULL DEFAULT 0 CHECK (sent_qty >= 0),
  ret_bom numeric NOT NULL DEFAULT 0 CHECK (ret_bom >= 0),
  ret_danificado numeric NOT NULL DEFAULT 0 CHECK (ret_danificado >= 0),
  ret_quebrado numeric NOT NULL DEFAULT 0 CHECK (ret_quebrado >= 0),
  ret_inutilizado numeric NOT NULL DEFAULT 0 CHECK (ret_inutilizado >= 0),
  ret_manutencao numeric NOT NULL DEFAULT 0 CHECK (ret_manutencao >= 0),
  UNIQUE (romaneio_id, item_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.andam_requests, public.andam_request_items, public.andam_romaneios, public.andam_romaneio_items TO authenticated;
GRANT ALL ON public.andam_requests, public.andam_request_items, public.andam_romaneios, public.andam_romaneio_items TO service_role;
GRANT USAGE ON SEQUENCE public.andam_requests_number_seq, public.andam_romaneios_number_seq TO authenticated;
ALTER TABLE public.andam_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.andam_request_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.andam_romaneios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.andam_romaneio_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY andam_req_sel ON public.andam_requests FOR SELECT TO authenticated USING (public.andam_client_ok(client_id));
CREATE POLICY andam_req_ins ON public.andam_requests FOR INSERT TO authenticated WITH CHECK (public.andam_can('/andaimes/solicitacoes') AND public.andam_client_ok(client_id));
CREATE POLICY andam_req_upd ON public.andam_requests FOR UPDATE TO authenticated USING (public.andam_can('/andaimes/solicitacoes') AND public.andam_client_ok(client_id)) WITH CHECK (public.andam_can('/andaimes/solicitacoes') AND public.andam_client_ok(client_id));
CREATE POLICY andam_req_del ON public.andam_requests FOR DELETE TO authenticated USING (public.andam_can('/andaimes/solicitacoes') AND public.andam_client_ok(client_id) AND (status IN ('aberta','em_analise','cancelada') OR public.is_admin()));
CREATE POLICY andam_reqi_sel ON public.andam_request_items FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.andam_requests r WHERE r.id = request_id AND public.andam_client_ok(r.client_id)));
CREATE POLICY andam_reqi_wr ON public.andam_request_items FOR ALL TO authenticated
  USING (public.andam_can('/andaimes/solicitacoes') AND EXISTS (SELECT 1 FROM public.andam_requests r WHERE r.id = request_id AND public.andam_client_ok(r.client_id)))
  WITH CHECK (public.andam_can('/andaimes/solicitacoes') AND EXISTS (SELECT 1 FROM public.andam_requests r WHERE r.id = request_id AND public.andam_client_ok(r.client_id)));

CREATE POLICY andam_rom_sel ON public.andam_romaneios FOR SELECT TO authenticated USING (public.andam_client_ok(client_id));
CREATE POLICY andam_rom_ins ON public.andam_romaneios FOR INSERT TO authenticated WITH CHECK (public.andam_can('/andaimes/romaneios') AND public.andam_client_ok(client_id) AND status = 'rascunho');
CREATE POLICY andam_rom_upd ON public.andam_romaneios FOR UPDATE TO authenticated USING (public.andam_can('/andaimes/romaneios') AND public.andam_client_ok(client_id) AND status IN ('rascunho','cancelado')) WITH CHECK (public.andam_can('/andaimes/romaneios') AND status IN ('rascunho','cancelado'));
CREATE POLICY andam_rom_del ON public.andam_romaneios FOR DELETE TO authenticated USING (public.andam_can('/andaimes/romaneios') AND public.andam_client_ok(client_id) AND status IN ('rascunho','cancelado'));
CREATE POLICY andam_romi_sel ON public.andam_romaneio_items FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.andam_romaneios r WHERE r.id = romaneio_id AND public.andam_client_ok(r.client_id)));
CREATE POLICY andam_romi_wr ON public.andam_romaneio_items FOR ALL TO authenticated
  USING (public.andam_can('/andaimes/romaneios') AND EXISTS (SELECT 1 FROM public.andam_romaneios r WHERE r.id = romaneio_id AND public.andam_client_ok(r.client_id) AND r.status IN ('rascunho','recebido')))
  WITH CHECK (public.andam_can('/andaimes/romaneios') AND EXISTS (SELECT 1 FROM public.andam_romaneios r WHERE r.id = romaneio_id AND public.andam_client_ok(r.client_id) AND r.status IN ('rascunho','recebido')));

CREATE TRIGGER andam_req_upd_at BEFORE UPDATE ON public.andam_requests FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER andam_rom_upd_at BEFORE UPDATE ON public.andam_romaneios FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public._andam_move(_item uuid, _fl text, _fc uuid, _fw uuid, _tl text, _tc uuid, _tw uuid, _qty numeric, _kind text, _note text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE cur numeric; n int;
BEGIN
  IF _qty <= 0 THEN RETURN; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('andam:' || _item));
  SELECT quantity INTO cur FROM andam_stock WHERE item_id=_item AND location=_fl AND client_id IS NOT DISTINCT FROM _fc AND work_id IS NOT DISTINCT FROM _fw;
  IF coalesce(cur,0) < _qty THEN RAISE EXCEPTION 'Estoque insuficiente em % para o material %', _fl, (SELECT name FROM andam_items WHERE id=_item); END IF;
  UPDATE andam_stock SET quantity=quantity-_qty, updated_at=now() WHERE item_id=_item AND location=_fl AND client_id IS NOT DISTINCT FROM _fc AND work_id IS NOT DISTINCT FROM _fw;
  UPDATE andam_stock SET quantity=quantity+_qty, updated_at=now() WHERE item_id=_item AND location=_tl AND client_id IS NOT DISTINCT FROM _tc AND work_id IS NOT DISTINCT FROM _tw;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n = 0 THEN INSERT INTO andam_stock(item_id, location, client_id, work_id, quantity) VALUES (_item,_tl,_tc,_tw,_qty); END IF;
  INSERT INTO andam_movements(item_id, kind, from_location, from_client_id, from_work_id, to_location, to_client_id, to_work_id, quantity, user_id, notes)
  VALUES (_item,_kind,_fl,_fc,_fw,_tl,_tc,_tw,_qty,auth.uid(),_note);
END $$;
REVOKE ALL ON FUNCTION public._andam_move(uuid,text,uuid,uuid,text,uuid,uuid,numeric,text,text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.andam_romaneio_send(_rom uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r andam_romaneios; it record;
BEGIN
  SELECT * INTO r FROM andam_romaneios WHERE id=_rom FOR UPDATE;
  IF r.id IS NULL OR NOT public.andam_can('/andaimes/romaneios') OR NOT public.andam_client_ok(r.client_id) THEN RAISE EXCEPTION 'Sem permissão'; END IF;
  IF r.status <> 'rascunho' THEN RAISE EXCEPTION 'Romaneio já enviado'; END IF;
  IF NOT EXISTS (SELECT 1 FROM andam_romaneio_items WHERE romaneio_id=_rom AND sent_qty>0) THEN RAISE EXCEPTION 'Informe as quantidades enviadas'; END IF;
  FOR it IN SELECT * FROM andam_romaneio_items WHERE romaneio_id=_rom AND sent_qty>0 LOOP
    PERFORM public._andam_move(it.item_id,'central',NULL,NULL,'transito',r.client_id,r.work_id,it.sent_qty,'romaneio_saida','ROM-'||lpad(r.number::text,6,'0'));
  END LOOP;
  UPDATE andam_romaneios SET status='em_transito', sent_at=now() WHERE id=_rom;
  IF r.request_id IS NOT NULL THEN UPDATE andam_requests SET status='em_transito' WHERE id=r.request_id; END IF;
END $$;

CREATE OR REPLACE FUNCTION public.andam_romaneio_receive(_rom uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r andam_romaneios; it record; is_full boolean;
BEGIN
  SELECT * INTO r FROM andam_romaneios WHERE id=_rom FOR UPDATE;
  IF r.id IS NULL OR NOT (public.andam_can('/andaimes/romaneios') OR public.andam_can('/andaimes/solicitacoes')) OR NOT public.andam_client_ok(r.client_id) THEN RAISE EXCEPTION 'Sem permissão'; END IF;
  IF r.status <> 'em_transito' THEN RAISE EXCEPTION 'Romaneio não está em trânsito'; END IF;
  FOR it IN SELECT * FROM andam_romaneio_items WHERE romaneio_id=_rom AND sent_qty>0 LOOP
    PERFORM public._andam_move(it.item_id,'transito',r.client_id,r.work_id,'obra',r.client_id,r.work_id,it.sent_qty,'romaneio_recebimento','ROM-'||lpad(r.number::text,6,'0'));
  END LOOP;
  UPDATE andam_romaneios SET status='recebido', received_at=now() WHERE id=_rom;
  IF r.request_id IS NOT NULL THEN
    SELECT bool_and(coalesce(s.sent,0) >= ri.requested_qty) INTO is_full FROM andam_request_items ri
      LEFT JOIN (SELECT ii.item_id, sum(ii.sent_qty) AS sent FROM andam_romaneio_items ii JOIN andam_romaneios rr ON rr.id=ii.romaneio_id
                 WHERE rr.request_id=r.request_id AND rr.status IN ('recebido','retornado') GROUP BY ii.item_id) s ON s.item_id=ri.item_id
      WHERE ri.request_id=r.request_id;
    UPDATE andam_requests SET status = CASE WHEN coalesce(is_full,false) THEN 'atendida' ELSE 'recebida' END WHERE id=r.request_id;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.andam_romaneio_return(_rom uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r andam_romaneios; it record; note text; bad numeric;
BEGIN
  SELECT * INTO r FROM andam_romaneios WHERE id=_rom FOR UPDATE;
  IF r.id IS NULL OR NOT public.andam_can('/andaimes/romaneios') OR NOT public.andam_client_ok(r.client_id) THEN RAISE EXCEPTION 'Sem permissão'; END IF;
  IF r.status <> 'recebido' THEN RAISE EXCEPTION 'O retorno só pode ser registrado após o recebimento na obra'; END IF;
  note := 'Retorno ROM-'||lpad(r.number::text,6,'0');
  FOR it IN SELECT * FROM andam_romaneio_items WHERE romaneio_id=_rom LOOP
    IF it.ret_bom+it.ret_danificado+it.ret_quebrado+it.ret_inutilizado+it.ret_manutencao > it.sent_qty THEN
      RAISE EXCEPTION 'Retorno maior que o enviado em %', (SELECT name FROM andam_items WHERE id=it.item_id); END IF;
    PERFORM public._andam_move(it.item_id,'obra',r.client_id,r.work_id,'central',NULL,NULL,it.ret_bom,'romaneio_retorno',note);
    bad := it.ret_danificado+it.ret_quebrado+it.ret_inutilizado;
    PERFORM public._andam_move(it.item_id,'obra',r.client_id,r.work_id,'danificado',NULL,NULL,bad,'romaneio_retorno',note);
    PERFORM public._andam_move(it.item_id,'obra',r.client_id,r.work_id,'manutencao',NULL,NULL,it.ret_manutencao,'romaneio_retorno',note);
  END LOOP;
  UPDATE andam_romaneios SET status='retornado', returned_at=now() WHERE id=_rom;
END $$;
GRANT EXECUTE ON FUNCTION public.andam_romaneio_send(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.andam_romaneio_receive(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.andam_romaneio_return(uuid) TO authenticated;