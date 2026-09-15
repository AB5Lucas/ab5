ALTER TABLE public.trainings DROP CONSTRAINT IF EXISTS trainings_name_key;
CREATE UNIQUE INDEX IF NOT EXISTS trainings_name_description_key
  ON public.trainings (name, coalesce(description, ''));