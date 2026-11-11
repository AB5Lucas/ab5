DROP POLICY IF EXISTS "box titles read" ON public.schedule_box_titles;
CREATE POLICY "box titles read" ON public.schedule_box_titles FOR SELECT TO authenticated
USING ((SELECT public.is_active_user()) AND (SELECT public.can_access_page('/programacao/diaria')));