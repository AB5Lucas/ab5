-- Imagem da fachada de cada cliente (gerada por IA no mesmo estilo para todos), mostrada nos quadros da página Clientes.
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS image_path text;
INSERT INTO storage.buckets (id, name, public) VALUES ('client-images', 'client-images', true) ON CONFLICT (id) DO NOTHING;
DROP POLICY IF EXISTS "client images read" ON storage.objects;
CREATE POLICY "client images read" ON storage.objects FOR SELECT USING (bucket_id = 'client-images');
DROP POLICY IF EXISTS "client images write" ON storage.objects;
CREATE POLICY "client images write" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'client-images' AND public.can_write());
DROP POLICY IF EXISTS "client images update" ON storage.objects;
CREATE POLICY "client images update" ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'client-images' AND public.can_write());
DROP POLICY IF EXISTS "client images delete" ON storage.objects;
CREATE POLICY "client images delete" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'client-images' AND public.can_write());
