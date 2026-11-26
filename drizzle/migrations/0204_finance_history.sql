-- Histórico financeiro de antes do sistema (planilha DADOS FINANCEIRO SERVIÇOS AB5, 01/2024–09/2026), só consulta.
-- Os dados foram carregados à parte (26/11); não vira serviço nem lançamento: os dashboards leem desta tabela.
CREATE TABLE IF NOT EXISTS public.finance_history (
  id bigserial PRIMARY KEY, ym text NOT NULL, client text NOT NULL, sheet_client text, pedido text, obra text,
  fat numeric NOT NULL DEFAULT 0, mo numeric NOT NULL DEFAULT 0, mat numeric NOT NULL DEFAULT 0, andaimes numeric NOT NULL DEFAULT 0,
  ferr numeric NOT NULL DEFAULT 0, transp numeric NOT NULL DEFAULT 0);
ALTER TABLE public.finance_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS finance_history_select ON public.finance_history;
CREATE POLICY finance_history_select ON public.finance_history FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'coordenador'));
