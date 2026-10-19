CREATE OR REPLACE FUNCTION public.billing_quote_key(v text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path=public AS $$
 SELECT CASE WHEN trim(coalesce(v,'')) ~ '^\d+\s*/\s*\d+$' THEN regexp_replace(split_part(trim(v),'/',1),'\D','','g')||lpad(regexp_replace(split_part(trim(v),'/',2),'\D','','g'),4,'0')
 ELSE regexp_replace(coalesce(v,''),'\D','','g') END $$;
CREATE OR REPLACE FUNCTION public.billing_entry_ref(p_work uuid,p_order text,p_quote text) RETURNS text LANGUAGE sql STABLE SET search_path=public AS $$
 SELECT coalesce(nullif(trim(coalesce(p_order,'')),''),
  (SELECT o->>'number' FROM works w, jsonb_array_elements(CASE WHEN jsonb_typeof(w.orders)='array' THEN w.orders ELSE '[]' END) o WHERE w.id=p_work AND billing_quote_key(p_quote)<>'' AND billing_quote_key(o->>'number')=billing_quote_key(p_quote) LIMIT 1),
  nullif(billing_quote_key(p_quote),''),
  (SELECT max(o->>'number') FROM works w, jsonb_array_elements(CASE WHEN jsonb_typeof(w.orders)='array' THEN w.orders ELSE '[]' END) o WHERE w.id=p_work AND nullif(trim(o->>'number'),'') IS NOT NULL HAVING count(DISTINCT o->>'number')=1),
  nullif(trim((SELECT order_number FROM works WHERE id=p_work)),''),'') $$;
CREATE OR REPLACE FUNCTION public.billing_entry_desc(p_note jsonb,p_work uuid) RETURNS text LANGUAGE sql STABLE SET search_path=public AS $$
 SELECT nullif(concat_ws(' · ', CASE WHEN coalesce((p_note->>'noInvoice')::boolean,false) THEN 'Sem NF' ELSE 'NFSe '||(p_note->>'invoice') END, 'Pedido '||nullif(billing_entry_ref(p_work,p_note->>'order',p_note->>'quote'),'')),'') $$;
CREATE OR REPLACE FUNCTION public.billing_sync_process(p_run uuid,p_notes jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE n jsonb; oldnote billing_sync_notes%ROWTYPE; nid uuid; eid uuid; wid uuid; meth text; state text; why text; tol integer; cents bigint; expected bigint; diff bigint; pc uuid[]; qc uuid[]; vc uuid[]; cc uuid[]; candidates jsonb; one jsonb; iscancel boolean; manual_count integer; manual_id uuid; stats jsonb := '{"analyzed":0,"inserted":0,"updated":0,"cancelled":0,"pending":0,"errors":0}'; action text; descr text;
BEGIN
 IF coalesce(auth.role(),'')<>'service_role' THEN RAISE EXCEPTION 'Unauthorized'; END IF;
 PERFORM pg_advisory_xact_lock(hashtext('billing_sync_financial'));
 SELECT coalesce((SELECT tolerance_cents FROM billing_sync_settings WHERE id=true),5) INTO tol;
 FOR n IN SELECT value FROM jsonb_array_elements(p_notes) LOOP
 BEGIN
  IF (n->>'issuedAt')::date < '2026-10-01' THEN CONTINUE; END IF;
  stats := jsonb_set(stats,'{analyzed}',to_jsonb((stats->>'analyzed')::int+1));
  cents:=(n->>'amountCents')::bigint; iscancel:=(n->>'cancelled')::boolean;
  SELECT * INTO oldnote FROM billing_sync_notes WHERE source_key=n->>'key' FOR UPDATE;
  IF oldnote.id IS NULL AND NOT coalesce((n->>'noInvoice')::boolean,false) THEN
   SELECT * INTO oldnote FROM billing_sync_notes s WHERE coalesce((s.original->>'noInvoice')::boolean,false) AND s.issued_at=(n->>'issuedAt')::date AND billing_client_key(s.client_name)=billing_client_key(n->>'client') AND round(s.amount*100)=cents AND coalesce(s.order_number,'')=coalesce(n->>'order','') AND NOT EXISTS(SELECT 1 FROM billing_sync_notes x WHERE x.source_key=n->>'key') ORDER BY s.issued_at LIMIT 1 FOR UPDATE;
   IF oldnote.id IS NOT NULL THEN UPDATE billing_sync_notes SET source_key=n->>'key' WHERE id=oldnote.id; END IF;
  END IF;
  nid:=oldnote.id; eid:=oldnote.entry_id; wid:=NULL; expected:=NULL; diff:=NULL; meth:=NULL; why:=NULL; state:='pending'; action:='attempt'; candidates:='[]';
  IF cents<0 OR nullif(n->>'invoice','') IS NULL OR nullif(n->>'client','') IS NULL THEN RAISE EXCEPTION 'Cliente ou valor inválido'; END IF;
  SELECT array_agg(DISTINCT c.id) INTO cc FROM clients c WHERE billing_client_key(c.name)=billing_client_key(n->>'client');
  SELECT array_agg(DISTINCT w.id) INTO pc FROM works w WHERE nullif(n->>'order','') IS NOT NULL AND (billing_doc_key(w.order_number)=billing_doc_key(n->>'order') OR EXISTS(SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(w.orders)='array' THEN w.orders ELSE '[]' END) o WHERE billing_doc_key(o->>'number')=billing_doc_key(n->>'order')));
  SELECT array_agg(DISTINCT w.id) INTO qc FROM works w WHERE billing_quote_key(n->>'quote')<>'' AND (billing_quote_key(w.quote_number)=billing_quote_key(n->>'quote') OR EXISTS(SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(w.orders)='array' THEN w.orders ELSE '[]' END) o WHERE billing_quote_key(o->>'number')=billing_quote_key(n->>'quote')));
  IF n ? 'error' THEN state:='error';why:=n->>'error';
  ELSIF cardinality(pc)=1 AND cardinality(qc)=1 AND pc[1]<>qc[1] THEN state:='divergence';why:='Pedido e orçamento apontam para serviços diferentes';
  ELSIF cardinality(pc)=1 THEN wid:=pc[1];meth:='order';
  ELSIF cardinality(qc)=1 THEN wid:=qc[1];meth:='quote';
  ELSIF coalesce(cardinality(pc),0)>1 OR coalesce(cardinality(qc),0)>1 THEN state:='ambiguity';why:='Identificador corresponde a mais de um serviço';
  ELSE
   WITH available AS (
    SELECT w.id,w.name, greatest(0,round(coalesce((SELECT sum((o->>'value')::numeric) FROM jsonb_array_elements(CASE WHEN jsonb_typeof(w.orders)='array' THEN w.orders ELSE '[]' END) o),w.order_value,0)*100)::bigint-coalesce((SELECT round(sum(e.amount)*100)::bigint FROM work_entries e WHERE e.work_id=w.id AND e.category='faturamento' AND NOT e.sync_cancelled AND (eid IS NULL OR e.id<>eid)),0)) balance
    FROM works w WHERE w.client_id=ANY(cc))
   SELECT array_agg(id),jsonb_agg(jsonb_build_object('workId',id,'service',name,'expectedCents',balance)) INTO vc,candidates FROM available WHERE balance>0 AND abs(balance-cents)<=tol;
   IF cardinality(cc)>1 THEN state:='ambiguity';why:='Nome do cliente corresponde a mais de um cadastro';
   ELSIF cardinality(vc)=1 THEN wid:=vc[1];meth:='reconciliation';expected:=(candidates->0->>'expectedCents')::bigint;diff:=abs(expected-cents);IF diff>0 THEN meth:='tolerance';END IF;
   ELSIF cardinality(vc)>1 THEN state:='ambiguity';why:='Mais de um serviço do cliente tem saldo compatível';
   ELSE why:='Pedido e orçamento não encontrados; cliente e saldo não permitem conciliação segura';END IF;
  END IF;
  IF wid IS NOT NULL AND NOT EXISTS(SELECT 1 FROM works w WHERE w.id=wid AND w.client_id=ANY(cc)) THEN wid:=NULL;state:='divergence';why:='Cliente da nota não corresponde ao cliente do serviço'; END IF;
  IF oldnote.entry_id IS NOT NULL AND wid IS NOT NULL AND oldnote.work_id<>wid THEN wid:=NULL;state:='divergence';why:='Vínculo financeiro mudou; conferir antes de realocar';END IF;
  IF wid IS NOT NULL AND NOT iscancel THEN
   SELECT count(*),min(id::text)::uuid INTO manual_count,manual_id FROM work_entries WHERE work_id=wid AND category='faturamento' AND sync_note_id IS NULL AND NOT sync_cancelled AND entry_date=(n->>'issuedAt')::date AND round(amount*100)=cents;
   IF manual_count>0 AND eid IS NULL THEN wid:=NULL;state:='divergence';why:='Existe faturamento manual com mesmo serviço, data e valor; conferir para evitar duplicidade';END IF;
  END IF;
  IF nid IS NULL THEN INSERT INTO billing_sync_notes(source_key,invoice_number,issued_at,client_name,amount,original) VALUES(n->>'key',n->>'invoice',(n->>'issuedAt')::date,n->>'client',cents/100.0,n) RETURNING id INTO nid;END IF;
  IF iscancel AND state<>'error' THEN
   IF eid IS NOT NULL THEN UPDATE work_entries SET sync_cancelled=true,updated_at=now() WHERE id=eid AND NOT sync_cancelled; IF FOUND THEN action:='cancelled';stats:=jsonb_set(stats,'{cancelled}',to_jsonb((stats->>'cancelled')::int+1)); END IF; END IF;
   state:='cancelled';why:='Nota cancelada na origem; nenhum efeito financeiro ativo';wid:=coalesce(oldnote.work_id,wid);
  ELSIF wid IS NOT NULL THEN
   state:='posted';why:=coalesce(why,CASE meth WHEN 'order' THEN 'Identificado por pedido' WHEN 'quote' THEN 'Identificado por orçamento' WHEN 'tolerance' THEN 'Cliente e saldo únicos; diferença dentro da tolerância' ELSE 'Cliente e saldo únicos; conciliação inteligente' END);
   descr:=billing_entry_desc(n,wid);
   IF eid IS NULL THEN
    INSERT INTO work_entries(work_id,entry_date,category,description,amount,sync_note_id) VALUES(wid,(n->>'issuedAt')::date,'faturamento',descr,cents/100.0,nid) RETURNING id INTO eid;
    action:='inserted';stats:=jsonb_set(stats,'{inserted}',to_jsonb((stats->>'inserted')::int+1));
   ELSE
    UPDATE work_entries SET entry_date=(n->>'issuedAt')::date,amount=cents/100.0,description=descr,sync_cancelled=false,updated_at=now() WHERE id=eid AND (sync_cancelled OR amount<>cents/100.0 OR entry_date<>(n->>'issuedAt')::date OR description IS DISTINCT FROM descr);
    IF FOUND THEN action:=CASE WHEN oldnote.cancelled THEN 'reactivated' ELSE 'updated' END;stats:=jsonb_set(stats,'{updated}',to_jsonb((stats->>'updated')::int+1));END IF;
   END IF;
  ELSE stats:=jsonb_set(stats,'{pending}',to_jsonb((stats->>'pending')::int+1)); END IF;
  IF state='error' THEN stats:=jsonb_set(stats,'{errors}',to_jsonb((stats->>'errors')::int+1));END IF;
  one:=jsonb_build_object('orderCandidates',coalesce(to_jsonb(pc),'[]'),'quoteCandidates',coalesce(to_jsonb(qc),'[]'),'valueCandidates',coalesce(candidates,'[]'),'normalizedOrder',billing_doc_key(n->>'order'),'normalizedQuote',billing_quote_key(n->>'quote'),'clientKey',billing_client_key(n->>'client'),'method',meth,'expectedCents',expected,'differenceCents',diff,'toleranceCents',tol,'status',state,'reason',why,'entryId',eid,'previous',to_jsonb(oldnote));
  UPDATE billing_sync_notes SET invoice_number=n->>'invoice',issued_at=(n->>'issuedAt')::date,client_name=n->>'client',amount=cents/100.0,order_number=n->>'order',quote_number=n->>'quote',cancelled=iscancel,cancelled_at=CASE WHEN iscancel THEN coalesce(cancelled_at,now()) ELSE NULL END,work_id=coalesce(wid,oldnote.work_id),entry_id=eid,method=meth,status=state,reason=why,expected_cents=expected,difference_cents=diff,tolerance_cents=tol,original=n,decision=one-'previous',last_attempt_at=now(),run_id=p_run WHERE id=nid;
  INSERT INTO billing_sync_history(note_id,run_id,action,snapshot) VALUES(nid,p_run,action,jsonb_build_object('source',n,'decision',one));
 EXCEPTION WHEN OTHERS THEN
  stats:=jsonb_set(stats,'{errors}',to_jsonb((stats->>'errors')::int+1));
  INSERT INTO billing_sync_history(run_id,action,snapshot) VALUES(p_run,'error',jsonb_build_object('source',n,'error',SQLERRM));
 END;
 END LOOP;
 UPDATE billing_sync_runs SET finished_at=now(),status=CASE WHEN (stats->>'errors')::int>0 THEN 'partial' ELSE 'completed' END,analyzed=(stats->>'analyzed')::int,inserted=(stats->>'inserted')::int,updated=(stats->>'updated')::int,cancelled=(stats->>'cancelled')::int,pending=(stats->>'pending')::int,errors=(stats->>'errors')::int WHERE id=p_run;
 RETURN stats;
END $$;
REVOKE ALL ON FUNCTION public.billing_sync_process(uuid,jsonb) FROM PUBLIC,anon,authenticated; GRANT EXECUTE ON FUNCTION public.billing_sync_process(uuid,jsonb) TO service_role;