CREATE TABLE public.user_saved_signatures (
  user_id uuid PRIMARY KEY DEFAULT auth.uid(),
  signer_name text NOT NULL,
  signature_data text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_saved_signatures TO authenticated;
GRANT ALL ON public.user_saved_signatures TO service_role;
ALTER TABLE public.user_saved_signatures ENABLE ROW LEVEL SECURITY;
CREATE POLICY uss_own ON public.user_saved_signatures FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER uss_updated BEFORE UPDATE ON public.user_saved_signatures
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();