CREATE TABLE public.andam_flow_roles (
  key text PRIMARY KEY CHECK (key IN ('coordenador','patio')),
  user_id uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.andam_flow_roles TO authenticated;
GRANT ALL ON public.andam_flow_roles TO service_role;
ALTER TABLE public.andam_flow_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY andam_fr_sel ON public.andam_flow_roles FOR SELECT TO authenticated USING (public.is_active_user());
CREATE POLICY andam_fr_wr ON public.andam_flow_roles FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

ALTER TABLE public.andam_requests ADD COLUMN flow_stage text NOT NULL DEFAULT 'aguardando_aprovacao'
  CHECK (flow_stage IN ('aguardando_aprovacao','em_separacao','aguardando_aprovacao_saida','aguardando_recebimento_obra','em_obra','aguardando_recebimento_patio','aguardando_encerramento','encerrada','cancelada'));
ALTER TABLE public.andam_romaneios ADD COLUMN kind text NOT NULL DEFAULT 'saida' CHECK (kind IN ('saida','retorno'));

UPDATE public.andam_requests r SET flow_stage = CASE
  WHEN r.status='cancelada' THEN 'cancelada'
  WHEN EXISTS (SELECT 1 FROM andam_romaneios x WHERE x.request_id=r.id AND x.status='retornado') THEN 'aguardando_encerramento'
  WHEN EXISTS (SELECT 1 FROM andam_romaneios x WHERE x.request_id=r.id AND x.status='recebido') THEN 'em_obra'
  WHEN EXISTS (SELECT 1 FROM andam_romaneios x WHERE x.request_id=r.id AND x.status='em_transito') THEN 'aguardando_recebimento_obra'
  WHEN r.status IN ('em_separacao') THEN 'em_separacao'
  WHEN r.status IN ('separada','parcialmente_separada','compra_realizada') THEN 'aguardando_aprovacao_saida'
  ELSE 'aguardando_aprovacao' END;

CREATE TABLE public.andam_request_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.andam_requests(id) ON DELETE CASCADE,
  action text NOT NULL,
  from_stage text,
  to_stage text,
  user_id uuid DEFAULT auth.uid(),
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.andam_request_events TO authenticated;
GRANT ALL ON public.andam_request_events TO service_role;
ALTER TABLE public.andam_request_events ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.andam_flow_user(_key text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT public.is_active_user() AND (public.is_admin() OR EXISTS (SELECT 1 FROM andam_flow_roles WHERE key=_key AND user_id=auth.uid()))
$$;
CREATE OR REPLACE FUNCTION public.andam_req_visible(_req uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (SELECT 1 FROM andam_requests r WHERE r.id=_req AND (public.andam_client_ok(r.client_id) OR r.user_id=auth.uid()
    OR public.andam_flow_user('coordenador') OR public.andam_flow_user('patio')))
$$;

CREATE POLICY andam_ev_sel ON public.andam_request_events FOR SELECT TO authenticated USING (public.andam_req_visible(request_id));
CREATE POLICY andam_req_sel_flow ON public.andam_requests FOR SELECT TO authenticated USING (public.andam_req_visible(id));
CREATE POLICY andam_reqi_sel_flow ON public.andam_request_items FOR SELECT TO authenticated USING (public.andam_req_visible(request_id));
CREATE POLICY andam_rom_sel_flow ON public.andam_romaneios FOR SELECT TO authenticated USING (request_id IS NOT NULL AND public.andam_req_visible(request_id));
CREATE POLICY andam_romi_sel_flow ON public.andam_romaneio_items FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM andam_romaneios r WHERE r.id=romaneio_id AND r.request_id IS NOT NULL AND public.andam_req_visible(r.request_id)));

CREATE OR REPLACE FUNCTION public.andam_flow_set_qty(_line uuid, _field text, _qty numeric) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE req andam_requests; rom andam_romaneios; rid uuid;
BEGIN
  IF _qty IS NULL OR _qty < 0 THEN RAISE EXCEPTION 'Quantidade inválida'; END IF;
  IF _field = 'separated_qty' THEN
    SELECT r.* INTO req FROM andam_request_items i JOIN andam_requests r ON r.id=i.request_id WHERE i.id=_line;
    IF req.id IS NULL OR req.flow_stage<>'em_separacao' OR NOT public.andam_flow_user('patio') THEN RAISE EXCEPTION 'Sem permissão para separar'; END IF;
    UPDATE andam_request_items SET separated_qty=_qty WHERE id=_line;
  ELSIF _field IN ('ret_bom','ret_danificado','ret_quebrado','ret_inutilizado','ret_manutencao') THEN
    SELECT ro.* INTO rom FROM andam_romaneio_items i JOIN andam_romaneios ro ON ro.id=i.romaneio_id WHERE i.id=_line;
    SELECT * INTO req FROM andam_requests WHERE id=rom.request_id;
    IF req.id IS NULL OR NOT ((req.flow_stage='em_obra' AND (req.user_id=auth.uid() OR public.is_admin()))
       OR (req.flow_stage='aguardando_recebimento_patio' AND public.andam_flow_user('patio'))) THEN RAISE EXCEPTION 'Sem permissão para informar retorno'; END IF;
    EXECUTE format('UPDATE andam_romaneio_items SET %I=$1 WHERE id=$2', _field) USING _qty, _line;
  ELSE RAISE EXCEPTION 'Campo inválido'; END IF;
END $$;

CREATE OR REPLACE FUNCTION public.andam_flow_advance(_req uuid, _action text, _note text DEFAULT NULL) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r andam_requests; nxt text; rom uuid; ro andam_romaneios; it record; tag text; bad numeric;
BEGIN
  SELECT * INTO r FROM andam_requests WHERE id=_req FOR UPDATE;
  IF r.id IS NULL THEN RAISE EXCEPTION 'Solicitação não encontrada'; END IF;
  IF _action='cancelar' THEN
    IF r.flow_stage NOT IN ('aguardando_aprovacao','em_separacao','aguardando_aprovacao_saida') OR NOT (public.andam_flow_user('coordenador') OR r.user_id=auth.uid()) THEN RAISE EXCEPTION 'Não é possível cancelar nesta etapa'; END IF;
    nxt := 'cancelada'; UPDATE andam_requests SET status='cancelada' WHERE id=_req;
  ELSIF _action='aprovar_solicitacao' AND r.flow_stage='aguardando_aprovacao' THEN
    IF NOT public.andam_flow_user('coordenador') THEN RAISE EXCEPTION 'Somente o coordenador de andaimes aprova'; END IF;
    nxt := 'em_separacao'; UPDATE andam_requests SET status='em_separacao' WHERE id=_req;
  ELSIF _action='concluir_separacao' AND r.flow_stage='em_separacao' THEN
    IF NOT public.andam_flow_user('patio') THEN RAISE EXCEPTION 'Somente o encarregado do pátio separa'; END IF;
    IF NOT EXISTS (SELECT 1 FROM andam_request_items WHERE request_id=_req AND separated_qty>0) THEN RAISE EXCEPTION 'Informe as quantidades separadas'; END IF;
    nxt := 'aguardando_aprovacao_saida';
    UPDATE andam_requests SET status = CASE WHEN NOT EXISTS (SELECT 1 FROM andam_request_items WHERE request_id=_req AND separated_qty<requested_qty) THEN 'separada' ELSE 'parcialmente_separada' END WHERE id=_req;
  ELSIF _action='devolver_separacao' AND r.flow_stage='aguardando_aprovacao_saida' THEN
    IF NOT public.andam_flow_user('coordenador') THEN RAISE EXCEPTION 'Somente o coordenador de andaimes'; END IF;
    nxt := 'em_separacao'; UPDATE andam_requests SET status='em_separacao' WHERE id=_req;
  ELSIF _action='aprovar_saida' AND r.flow_stage='aguardando_aprovacao_saida' THEN
    IF NOT public.andam_flow_user('coordenador') THEN RAISE EXCEPTION 'Somente o coordenador de andaimes aprova a saída'; END IF;
    INSERT INTO andam_romaneios(request_id, client_id, work_id, kind) VALUES (_req, r.client_id, r.work_id, 'saida') RETURNING id INTO rom;
    INSERT INTO andam_romaneio_items(romaneio_id, item_id, requested_qty, separated_qty, sent_qty)
      SELECT rom, item_id, requested_qty, separated_qty, separated_qty FROM andam_request_items WHERE request_id=_req AND separated_qty>0;
    SELECT * INTO ro FROM andam_romaneios WHERE id=rom; tag := 'ROM-'||lpad(ro.number::text,6,'0');
    FOR it IN SELECT * FROM andam_romaneio_items WHERE romaneio_id=rom LOOP
      PERFORM public._andam_move(it.item_id,'central',NULL,NULL,'transito',r.client_id,r.work_id,it.sent_qty,'romaneio_saida',tag);
    END LOOP;
    UPDATE andam_romaneios SET status='em_transito', sent_at=now() WHERE id=rom;
    nxt := 'aguardando_recebimento_obra'; UPDATE andam_requests SET status='em_transito' WHERE id=_req;
  ELSIF _action='receber_obra' AND r.flow_stage='aguardando_recebimento_obra' THEN
    IF NOT (r.user_id=auth.uid() OR public.is_admin()) THEN RAISE EXCEPTION 'Somente o encarregado solicitante confirma o recebimento'; END IF;
    SELECT * INTO ro FROM andam_romaneios WHERE request_id=_req AND kind='saida' AND status='em_transito' ORDER BY number DESC LIMIT 1 FOR UPDATE;
    tag := 'ROM-'||lpad(ro.number::text,6,'0');
    FOR it IN SELECT * FROM andam_romaneio_items WHERE romaneio_id=ro.id AND sent_qty>0 LOOP
      PERFORM public._andam_move(it.item_id,'transito',r.client_id,r.work_id,'obra',r.client_id,r.work_id,it.sent_qty,'romaneio_recebimento',tag);
    END LOOP;
    UPDATE andam_romaneios SET status='recebido', received_at=now() WHERE id=ro.id;
    nxt := 'em_obra'; UPDATE andam_requests SET status='recebida' WHERE id=_req;
  ELSIF _action='gerar_retorno' AND r.flow_stage='em_obra' THEN
    IF NOT (r.user_id=auth.uid() OR public.is_admin()) THEN RAISE EXCEPTION 'Somente o encarregado solicitante gera o retorno'; END IF;
    UPDATE andam_romaneios SET kind='retorno' WHERE request_id=_req AND status='recebido';
    nxt := 'aguardando_recebimento_patio';
  ELSIF _action='receber_patio' AND r.flow_stage='aguardando_recebimento_patio' THEN
    IF NOT public.andam_flow_user('patio') THEN RAISE EXCEPTION 'Somente o encarregado do pátio confirma o retorno'; END IF;
    FOR ro IN SELECT * FROM andam_romaneios WHERE request_id=_req AND status='recebido' FOR UPDATE LOOP
      tag := 'Retorno ROM-'||lpad(ro.number::text,6,'0');
      FOR it IN SELECT * FROM andam_romaneio_items WHERE romaneio_id=ro.id LOOP
        IF it.ret_bom+it.ret_danificado+it.ret_quebrado+it.ret_inutilizado+it.ret_manutencao > it.sent_qty THEN
          RAISE EXCEPTION 'Retorno maior que o enviado em %', (SELECT name FROM andam_items WHERE id=it.item_id); END IF;
        PERFORM public._andam_move(it.item_id,'obra',ro.client_id,ro.work_id,'central',NULL,NULL,it.ret_bom,'romaneio_retorno',tag);
        bad := it.ret_danificado+it.ret_quebrado+it.ret_inutilizado;
        PERFORM public._andam_move(it.item_id,'obra',ro.client_id,ro.work_id,'danificado',NULL,NULL,bad,'romaneio_retorno',tag);
        PERFORM public._andam_move(it.item_id,'obra',ro.client_id,ro.work_id,'manutencao',NULL,NULL,it.ret_manutencao,'romaneio_retorno',tag);
      END LOOP;
      UPDATE andam_romaneios SET status='retornado', returned_at=now() WHERE id=ro.id;
    END LOOP;
    nxt := 'aguardando_encerramento';
  ELSIF _action='encerrar' AND r.flow_stage='aguardando_encerramento' THEN
    IF NOT public.andam_flow_user('coordenador') THEN RAISE EXCEPTION 'Somente o coordenador de andaimes encerra'; END IF;
    nxt := 'encerrada'; UPDATE andam_requests SET status='atendida' WHERE id=_req;
  ELSE RAISE EXCEPTION 'Ação não permitida nesta etapa';
  END IF;
  UPDATE andam_requests SET flow_stage=nxt WHERE id=_req;
  INSERT INTO andam_request_events(request_id, action, from_stage, to_stage, note) VALUES (_req, _action, r.flow_stage, nxt, _note);
END $$;

GRANT EXECUTE ON FUNCTION public.andam_flow_advance(uuid,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.andam_flow_set_qty(uuid,text,numeric) TO authenticated;