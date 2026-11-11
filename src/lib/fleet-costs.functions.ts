import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Lê agora as planilhas de manutenção e combustível (botão da aba Frota › Custos). */
export const syncFleetCostsNow = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth]).handler(async ({ context }) => {
  const { data: allowed, error } = await context.supabase.rpc("can_access_page", { _path: "/frota/custos" });
  if (error || !allowed) throw new Error("Você não tem acesso a Frota › Custos");
  const lovableKey = process.env["LOVABLE_API_KEY"];
  const excelKey = process.env["MICROSOFT_EXCEL_API_KEY"];
  if (!lovableKey || !excelKey) throw new Error("Conexão do Excel indisponível");
  const { executeFleetSync } = await import("./fleet-costs.server");
  return executeFleetSync({ lovableKey, excelKey });
});
