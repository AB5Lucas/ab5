CREATE TABLE public.andam_structures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id),
  work_id uuid REFERENCES public.works(id),
  order_code text,
  location_desc text,
  status text NOT NULL DEFAULT 'montagem' CHECK (status IN ('montagem','liberado','aguardando_desmontagem','desmontagem','desmontado')),
  assembled_at date,
  released_at date,
  inspection_valid_until date,
  dismantled_at date,
  responsible text,
  notes text,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.andam_structure_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  structure_id uuid NOT NULL REFERENCES public.andam_structures(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES public.andam_items(id),
  quantity numeric NOT NULL DEFAULT 0 CHECK (quantity >= 0)
);
CREATE TABLE public.andam_asset_values (
  item_id uuid PRIMARY KEY REFERENCES public.andam_items(id) ON DELETE CASCADE,
  acquisition_value numeric NOT NULL DEFAULT 0,
  replacement_value numeric NOT NULL DEFAULT 0,
  rental_value_month numeric NOT NULL DEFAULT 0,
  useful_life_months integer NOT NULL DEFAULT 60,
  acquired_at date,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.andam_structures, public.andam_structure_items, public.andam_asset_values TO authenticated;
GRANT ALL ON public.andam_structures, public.andam_structure_items, public.andam_asset_values TO service_role;
ALTER TABLE public.andam_structures ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.andam_structure_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.andam_asset_values ENABLE ROW LEVEL SECURITY;
CREATE POLICY andam_st_sel ON public.andam_structures FOR SELECT TO authenticated USING (public.andam_client_ok(client_id));
CREATE POLICY andam_st_ins ON public.andam_structures FOR INSERT TO authenticated WITH CHECK (public.andam_can('/andaimes/acompanhamento') AND public.andam_client_ok(client_id));
CREATE POLICY andam_st_upd ON public.andam_structures FOR UPDATE TO authenticated USING (public.andam_can('/andaimes/acompanhamento') AND public.andam_client_ok(client_id)) WITH CHECK (public.andam_can('/andaimes/acompanhamento') AND public.andam_client_ok(client_id));
CREATE POLICY andam_st_del ON public.andam_structures FOR DELETE TO authenticated USING (public.andam_can('/andaimes/acompanhamento') AND public.andam_client_ok(client_id) AND (status = 'montagem' OR public.is_admin()));
CREATE POLICY andam_sti_sel ON public.andam_structure_items FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.andam_structures s WHERE s.id = structure_id AND public.andam_client_ok(s.client_id)));
CREATE POLICY andam_sti_wr ON public.andam_structure_items FOR ALL TO authenticated
  USING (public.andam_can('/andaimes/acompanhamento') AND EXISTS (SELECT 1 FROM public.andam_structures s WHERE s.id = structure_id AND public.andam_client_ok(s.client_id)))
  WITH CHECK (public.andam_can('/andaimes/acompanhamento') AND EXISTS (SELECT 1 FROM public.andam_structures s WHERE s.id = structure_id AND public.andam_client_ok(s.client_id)));
CREATE POLICY andam_av_admin ON public.andam_asset_values FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE TRIGGER andam_st_upd_at BEFORE UPDATE ON public.andam_structures FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER andam_av_upd_at BEFORE UPDATE ON public.andam_asset_values FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();