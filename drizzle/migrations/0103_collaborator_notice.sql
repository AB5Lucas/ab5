-- Aviso prévio no cadastro do colaborador: início e fim. Na Programação a pessoa aparece com degradê vermelho
-- discreto; depois do fim não pode ser escalada em obras. A inativação continua manual (fechamento do RH).
ALTER TABLE public.collaborators ADD COLUMN IF NOT EXISTS notice_start date, ADD COLUMN IF NOT EXISTS notice_end date;
