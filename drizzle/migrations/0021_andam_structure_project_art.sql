ALTER TABLE public.andam_structures
  ADD COLUMN IF NOT EXISTS has_project_art boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS project_number text,
  ADD COLUMN IF NOT EXISTS project_file_path text,
  ADD COLUMN IF NOT EXISTS art_number text,
  ADD COLUMN IF NOT EXISTS art_file_path text;

CREATE POLICY "andam docs read" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'andam-docs' AND public.is_active_user() AND public.andam_can('/andaimes/acompanhamento'));
CREATE POLICY "andam docs insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'andam-docs' AND public.is_active_user() AND public.andam_can('/andaimes/acompanhamento'));
CREATE POLICY "andam docs delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'andam-docs' AND public.is_active_user() AND public.andam_can('/andaimes/acompanhamento'));