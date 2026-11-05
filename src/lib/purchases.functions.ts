import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function guard(supabase: { rpc: (f: "can_access_page", a: { _path: string }) => PromiseLike<{ data: unknown }> }) {
  const { data } = await supabase.rpc("can_access_page", { _path: "/obras/compras" });
  if (!data) throw new Error("Você não tem acesso a Compras");
}

async function writeGuard(client: Parameters<typeof guard>[0]) {
  await guard(client);
  const { data, error } = await (client as unknown as { rpc: (f: string) => PromiseLike<{ data: unknown; error: unknown }> }).rpc("can_write");
  if (error || !data) throw new Error("Você não tem acesso de escrita em Compras");
}

export const syncPurchasesNow = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth]).handler(async ({ context }) => {
  await writeGuard(context.supabase);
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
    await writeGuard(context.supabase);
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

export const reprocessPurchasesNow = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth]).handler(async ({ context }) => {
  await writeGuard(context.supabase);
  const { reprocessPurchases } = await import("./purchases.server");
  return reprocessPurchases();
});

export const savePurchaseAsset = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d: { line_id: string; item_key: string; is_asset: boolean; mode: "pending" | "integral" | "installments"; months: number; monthly_amount: number | null; category: string; target_client_id?: string | null; target_work_id?: string | null }) => {
    if (!d.line_id || !d.item_key || !["pending", "integral", "installments"].includes(d.mode) || !["materiais", "transporte", "ferramentas", "andaimes", "mo"].includes(d.category) || !Number.isInteger(d.months) || d.months < 1 || d.months > 120) throw new Error("Decisão inválida");
    return d;
  }).handler(async ({ context, data }) => {
    await writeGuard(context.supabase);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { purchaseItemKeys, installmentPlan } = await import("./purchase-policy");
    const { data: line, error } = await supabaseAdmin.from("purchase_cc_lines").select("items,ref_month").eq("id", data.line_id).single();
    if (error) throw error;
    const items = line.items as import("./purchases").CcItem[];
    const index = purchaseItemKeys(items).indexOf(data.item_key);
    const item = items[index];
    if (!item) throw new Error("Item não encontrado no relatório atual");
    if (data.mode === "installments") installmentPlan(item.amount, line.ref_month, data.months, data.monthly_amount);
    let targetClient = data.target_client_id ?? null;
    if (data.target_work_id) {
      const { data: work, error: we } = await supabaseAdmin.from("works").select("client_id").eq("id", data.target_work_id).single();
      if (we || !work?.client_id) throw new Error("Serviço inválido");
      targetClient = work.client_id;
    }
    const up = await supabaseAdmin.from("purchase_asset_decisions").upsert({ purchase_cc_id: data.line_id, item_key: data.item_key, is_asset: data.is_asset, mode: data.mode, months: data.months, monthly_amount: data.monthly_amount, category: data.category, target_client_id: targetClient, target_work_id: data.target_work_id ?? null, decided_amount: item.amount, decided_by: context.userId, updated_at: new Date().toISOString() }, { onConflict: "purchase_cc_id,item_key" });
    if (up.error) throw up.error;
    const { applyLine } = await import("./purchases.server");
    return applyLine(data.line_id);
  });
