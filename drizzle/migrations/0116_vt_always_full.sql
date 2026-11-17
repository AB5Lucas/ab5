-- VT cheio: recebe VT em todo dia trabalhado no Fechamento, independente da obra (inclusive externas) e do transporte.
ALTER TABLE public.collaborators ADD COLUMN IF NOT EXISTS vt_always_full boolean NOT NULL DEFAULT false;
UPDATE public.collaborators SET vt_always_full = true WHERE full_name IN ('Ricardo Cenedesi', 'Thiago Bruno Quaresma');
