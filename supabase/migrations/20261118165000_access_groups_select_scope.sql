DROP POLICY IF EXISTS access_groups_select ON public.access_groups;
CREATE POLICY access_groups_select ON public.access_groups FOR SELECT TO authenticated
USING (public.is_admin() OR id = (SELECT up.access_group_id FROM public.users_profiles up WHERE up.id = auth.uid()));
DROP POLICY IF EXISTS access_group_pages_select ON public.access_group_pages;
CREATE POLICY access_group_pages_select ON public.access_group_pages FOR SELECT TO authenticated
USING (public.is_admin() OR group_id = (SELECT up.access_group_id FROM public.users_profiles up WHERE up.id = auth.uid()));
