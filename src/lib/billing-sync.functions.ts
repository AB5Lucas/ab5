import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
export const syncBillingNow = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth]).handler(async ({ context }) => {
  const { data: allowed, error } = await context.supabase.rpc("can_access_page", { _path: "/relatorios/sincronizacao" });
  if (error || !allowed) throw new Error("Você não tem acesso à sincronização");
  const lovableKey = process.env["LOVABLE_API_KEY"];
  const excelKey = process.env["MICROSOFT_EXCEL_API_KEY"];
  if (!lovableKey || !excelKey) throw new Error("Conexão do Excel indisponível");
  const { executeBillingSync } = await import("./billing-sync.server");
  return executeBillingSync({ lovableKey, excelKey }, "manual");
});