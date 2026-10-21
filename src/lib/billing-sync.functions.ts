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
export const syncIndustryNow = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d: { month?: string | undefined } | undefined) => ({ month: d?.month && /^\d{4}-\d{2}$/.test(d.month) ? d.month : undefined }))
  .handler(async ({ context, data }) => {
  const [{ data: a }, { data: b }] = await Promise.all([
    context.supabase.rpc("can_access_page", { _path: "/relatorios/sincronizacao" }),
    context.supabase.rpc("can_access_page", { _path: "/fechamentos/suzano" })]);
  if (!a && !b) throw new Error("Você não tem acesso à sincronização");
  const lovableKey = process.env["LOVABLE_API_KEY"];
  const excelKey = process.env["MICROSOFT_EXCEL_API_KEY"];
  if (!lovableKey || !excelKey) throw new Error("Conexão do Excel indisponível");
  const { executeIndustrySync } = await import("./industry-sync.server");
  return executeIndustrySync({ lovableKey, excelKey }, "manual", data.month ? [data.month] : undefined);
});
