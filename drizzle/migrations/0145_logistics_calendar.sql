-- Logística como agenda (estilo Outlook): cada demanda tem início e fim no dia; pode ser feita por veículo nosso (ab5)
-- ou só registrar o cliente/terceiro que vem em determinado horário (empresa, placa, motorista, telefone digitados).
ALTER TABLE public.log_demands ADD COLUMN IF NOT EXISTS end_time time;
ALTER TABLE public.log_demands ADD COLUMN IF NOT EXISTS carrier text NOT NULL DEFAULT 'ab5';
ALTER TABLE public.log_demands ADD COLUMN IF NOT EXISTS carrier_name text;
ALTER TABLE public.log_demands ADD COLUMN IF NOT EXISTS carrier_plate text;
ALTER TABLE public.log_demands ADD COLUMN IF NOT EXISTS carrier_driver text;
ALTER TABLE public.log_demands ADD COLUMN IF NOT EXISTS carrier_phone text;
ALTER TABLE public.log_demands DROP CONSTRAINT IF EXISTS log_demands_carrier_check;
ALTER TABLE public.log_demands ADD CONSTRAINT log_demands_carrier_check CHECK (carrier IN ('ab5', 'cliente', 'terceiro'));
-- Novos tipos: cliente/fornecedor traz material (receber) e cliente retira (expedir).
ALTER TABLE public.log_demands DROP CONSTRAINT IF EXISTS log_demands_kind_check;
ALTER TABLE public.log_demands ADD CONSTRAINT log_demands_kind_check CHECK (kind IN ('entregar', 'buscar', 'retirar', 'transferir', 'receber', 'expedir'));
