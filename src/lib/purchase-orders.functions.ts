import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { splitOrders } from "./purchase-orders";

/** Comprador digitou o nº do pedido: acha o PDF na pasta de pedidos de compras e liga ao item da SC. */
export const linkPurchaseOrderFile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { item: string; order: string }) => {
    if (!d?.item || typeof d.item !== "string" || typeof d.order !== "string") throw new Error("Pedido inválido");
    return d;
  })
  .handler(async ({ data, context }) => {
    const { data: allowed } = await context.supabase.rpc("can_access_page", { _path: "/compras/comprador" });
    if (!allowed) throw new Error("Você não tem acesso ao Comprador");
    const lovableKey = process.env["LOVABLE_API_KEY"];
    const excelKey = process.env["MICROSOFT_EXCEL_API_KEY"];
    if (!lovableKey || !excelKey) throw new Error("Conexão do SharePoint indisponível");
    const { findPurchaseOrderFile } = await import("./purchase-orders.server");
    const year = Number(new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 4));
    // Vários pedidos separados por ";": um link por pedido, na mesma ordem (Pedido 1, Pedido 2…).
    const orders = splitOrders(data.order);
    const files = await Promise.all(orders.map((o) => findPurchaseOrderFile(o, year, { lovableKey, excelKey })));
    const path = files.some(Boolean) ? files.map((f) => f?.url ?? "").join("\n") : "";
    const { error } = await context.supabase.rpc("purchase_item_set_file", { _item: data.item, _path: path });
    if (error) throw new Error(error.message);
    return { found: files.flatMap((f) => (f ? [f.name] : [])), missing: orders.filter((_, k) => !files[k]) };
  });
