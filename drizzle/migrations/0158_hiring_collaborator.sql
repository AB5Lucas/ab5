-- Contratações: colaborador contratado para a vaga (opcional). Ao vincular, o RH pode agendar o ASO admissional
-- e abrir o acompanhamento em Novos Clientes no cliente da vaga.
ALTER TABLE public.hiring_requests ADD COLUMN IF NOT EXISTS collaborator_id uuid
  REFERENCES public.collaborators(id) ON DELETE SET NULL;
