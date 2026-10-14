CREATE OR REPLACE FUNCTION public.andam_client_ok(_client uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_active_user() AND (
    public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'programmer') OR public.has_role(auth.uid(),'viewer') AND NOT (public.has_role(auth.uid(),'coordenador') OR public.has_role(auth.uid(),'encarregado'))
    OR EXISTS (SELECT 1 FROM public.foreman_works fw JOIN public.works w ON w.id = fw.work_id WHERE fw.user_id = auth.uid() AND w.client_id = _client));
$$;
DROP POLICY IF EXISTS andam_inv_sel ON public.andam_inventory;
CREATE POLICY andam_inv_sel ON public.andam_inventory FOR SELECT TO authenticated USING (public.andam_client_ok(client_id));
DROP POLICY IF EXISTS andam_inv_ins ON public.andam_inventory;
CREATE POLICY andam_inv_ins ON public.andam_inventory FOR INSERT TO authenticated WITH CHECK (public.andam_can('/andaimes/inventario') AND status = 'em_andamento' AND public.andam_client_ok(client_id));
DROP POLICY IF EXISTS andam_inv_upd ON public.andam_inventory;
CREATE POLICY andam_inv_upd ON public.andam_inventory FOR UPDATE TO authenticated USING (public.andam_can('/andaimes/inventario') AND public.andam_client_ok(client_id) AND (status = 'em_andamento' OR public.is_admin())) WITH CHECK (public.andam_can('/andaimes/inventario') AND public.andam_client_ok(client_id) AND (status <> 'finalizado' OR public.is_admin()));
CREATE POLICY andam_inv_del ON public.andam_inventory FOR DELETE TO authenticated USING (public.andam_can('/andaimes/inventario') AND public.andam_client_ok(client_id) AND (status <> 'finalizado' OR public.is_admin()));
GRANT DELETE ON public.andam_inventory TO authenticated;
DROP POLICY IF EXISTS andam_invi_sel ON public.andam_inventory_items;
CREATE POLICY andam_invi_sel ON public.andam_inventory_items FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.andam_inventory i WHERE i.id = inventory_id AND public.andam_client_ok(i.client_id)));