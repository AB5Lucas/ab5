UPDATE public.collaborators SET city = 'Mogi Guaçu' WHERE city IS NULL OR btrim(city) = '';
ALTER TABLE public.collaborators ALTER COLUMN city SET DEFAULT 'Mogi Guaçu';