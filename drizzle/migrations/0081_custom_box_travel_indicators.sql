ALTER TABLE public.schedule_box_vt ADD COLUMN pays_bonus boolean NOT NULL DEFAULT false, ADD COLUMN overnight boolean NOT NULL DEFAULT false;
ALTER TABLE public.schedule_person_vt ADD COLUMN pays_bonus boolean, ADD COLUMN overnight boolean;
COMMENT ON COLUMN public.schedule_box_vt.pays_bonus IS 'Prêmio viagem do quadro personalizado; VT mantém sua configuração independente.';
COMMENT ON COLUMN public.schedule_person_vt.pays_bonus IS 'Exceção individual de prêmio viagem; NULL herda o quadro.';