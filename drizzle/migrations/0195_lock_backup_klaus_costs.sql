ALTER TABLE public.backup_klaus_costs_20261127 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.backup_klaus_costs_20261127 FROM anon, authenticated;
GRANT ALL ON public.backup_klaus_costs_20261127 TO service_role;