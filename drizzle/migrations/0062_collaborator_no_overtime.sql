ALTER TABLE public.collaborators ADD COLUMN IF NOT EXISTS no_overtime_premium boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.collaborators.no_overtime_premium IS 'Exceção: fim de semana/feriado/HE pagos como hora normal no custo de MO';
UPDATE public.collaborators SET no_overtime_premium = true WHERE id = '011d615e-d8df-4afe-9f11-9cfa0d9304f3';