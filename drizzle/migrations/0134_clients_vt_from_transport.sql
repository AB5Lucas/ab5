-- Cliente sem transporte da empresa = VT por padrão para quem é escalado (needs_transport_voucher derivado).
-- Antes de aplicar, os dias anteriores a 01/11/2026 sem regra desses clientes foram gravados como "sem VT" (mantém meses fechados).
CREATE OR REPLACE FUNCTION public.clients_vt_from_transport() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.needs_transport_voucher := NOT coalesce(NEW.needs_company_transport, false);
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_clients_vt_from_transport ON public.clients;
CREATE TRIGGER trg_clients_vt_from_transport BEFORE INSERT OR UPDATE OF needs_company_transport, needs_transport_voucher ON public.clients
  FOR EACH ROW EXECUTE FUNCTION public.clients_vt_from_transport();
UPDATE public.clients SET needs_transport_voucher = NOT coalesce(needs_company_transport, false)
  WHERE needs_transport_voucher IS DISTINCT FROM NOT coalesce(needs_company_transport, false);
