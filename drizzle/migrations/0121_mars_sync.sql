-- Pedidos › MARS MM: controle da leitura diária da planilha "Faturamento MARS <ano>.xlsx" (lib/mars-sync*.ts).
-- Uma linha por item lido (chave = Nº Orç., ou pedido + descrição) e uma por medição do contrato (C:<mês>):
-- action created = serviço criado pela leitura; existing = já havia serviço; contract = linhas da medição.
-- Só o servidor grava (service role); quem acessa Pedidos ou Sincronização lê.
CREATE TABLE IF NOT EXISTS public.mars_sync_items (
  key text PRIMARY KEY,
  ref_month text NOT NULL,
  source text NOT NULL,
  quote text,
  order_number text,
  description text NOT NULL,
  value numeric NOT NULL DEFAULT 0,
  requester text,
  category text,
  sheet_status text,
  notes text,
  action text NOT NULL CHECK (action IN ('created', 'existing', 'contract')),
  work_id uuid REFERENCES public.works(id) ON DELETE SET NULL,
  synced_order text,
  synced_value numeric,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.mars_sync_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mars_sync_items_select ON public.mars_sync_items;
CREATE POLICY mars_sync_items_select ON public.mars_sync_items FOR SELECT TO authenticated
  USING ((SELECT public.can_access_page('/fechamentos/suzano')) OR (SELECT public.can_access_page('/relatorios/sincronizacao')));
GRANT SELECT ON public.mars_sync_items TO authenticated;
