DROP POLICY IF EXISTS rdo_media_read ON storage.objects;
CREATE POLICY rdo_media_read ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'rdo-media' AND public.can_access_rdo(((storage.foldername(name))[1])::uuid));