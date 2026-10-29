CREATE TABLE public.purchase_cc_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ref_month text NOT NULL,
  cc_code text NOT NULL,
  cc_name text,
  amount numeric NOT NULL DEFAULT 0,
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  file_path text,
  status text NOT NULL DEFAULT 'pending',
  reason text,
  target_client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  target_work_id uuid REFERENCES public.works(id) ON DELETE SET NULL,
  directed_by uuid,
  synced_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (ref_month, cc_code)
);
GRANT SELECT ON public.purchase_cc_lines TO authenticated;
GRANT ALL ON public.purchase_cc_lines TO service_role;
ALTER TABLE public.purchase_cc_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Compras visíveis a quem acessa a página" ON public.purchase_cc_lines FOR SELECT TO authenticated USING (public.can_access_page('/obras/compras'));
ALTER TABLE public.work_entries ADD COLUMN purchase_cc_id uuid REFERENCES public.purchase_cc_lines(id) ON DELETE CASCADE;
CREATE INDEX work_entries_purchase_cc_idx ON public.work_entries(purchase_cc_id);