import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function guard(supabase: { rpc: (f: "can_access_page", a: { _path: string }) => PromiseLike<{ data: unknown }> }) {
  const { data } = await supabase.rpc("can_access_page", { _path: "/obras/compras" });
  if (!data) throw new Error("Você não tem acesso a Compras");
}

export const syncPurchasesNow = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth]).handler(async ({ context }) => {
  await guard(context.supabase);
  const lovableKey = process.env["LOVABLE_API_KEY"], excelKey = process.env["MICROSOFT_EXCEL_API_KEY"];
  if (!lovableKey || !excelKey) throw new Error("Conexão do Excel indisponível");
  const { executePurchaseSync } = await import("./purchases.server");
  return executePurchaseSync({ lovableKey, excelKey });
});

/** Direciona uma compra para um cliente (rateio entre serviços com movimentação) ou um serviço (valor total). */
export const directPurchase = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string; client_id?: string | null; work_id?: string | null }) => {
    if (!d?.id) throw new Error("Linha inválida");
    return { id: d.id, client_id: d.client_id ?? null, work_id: d.work_id ?? null };
  })
  .handler(async ({ context, data }) => {
    await guard(context.supabase);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let client = data.client_id;
    if (data.work_id) {
      const { data: w } = await supabaseAdmin.from("works").select("client_id").eq("id", data.work_id).single();
      client = w?.client_id ?? client;
    }
    const up = await supabaseAdmin.from("purchase_cc_lines").update({ target_client_id: client, target_work_id: data.work_id, directed_by: context.userId }).eq("id", data.id);
    if (up.error) throw up.error;
    const { applyLine } = await import("./purchases.server");
    return applyLine(data.id);
  });
