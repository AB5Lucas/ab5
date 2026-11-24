-- Origem real da imagem do cliente: foto de referência (colada no cadastro ou link) e de onde veio a imagem final.
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS image_source text, ADD COLUMN IF NOT EXISTS image_origin text;
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS image_source_kind text;
