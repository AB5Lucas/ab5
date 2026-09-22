ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS has_toll boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS toll_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS trips_per_day integer NOT NULL DEFAULT 1;

ALTER TABLE public.driver_bonus_rules
  ADD COLUMN IF NOT EXISTS minimum_distance numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS maximum_distance numeric;

UPDATE public.clients SET trips_per_day = 2 WHERE name ILIKE '%suzano%';