import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { orderFilePaths, splitOrders } from "./purchase-orders";

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

/** PDF do pedido de compras do item (índice = Pedido 1, 2…), lido do SharePoint pelo app e devolvido em base64 só para exibir/baixar. */
export const fetchPurchaseOrderPdf = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { item: string; index: number }) => {
    if (!d?.item || typeof d.item !== "string" || typeof d.index !== "number") throw new Error("Pedido inválido");
    return d;
  })
  .handler(async ({ data, context }) => {
    // RLS: só quem enxerga a SC enxerga o item (e o pedido dele).
    const { data: it, error } = await context.supabase.from("purchase_request_items").select("order_number, order_file_path").eq("id", data.item).maybeSingle();
    if (error) throw new Error(error.message);
    if (!it) throw new Error("Item não encontrado");
    const order = splitOrders(it.order_number)[data.index];
    if (!order) throw new Error("Pedido não informado");
    const lovableKey = process.env["LOVABLE_API_KEY"];
    const excelKey = process.env["MICROSOFT_EXCEL_API_KEY"];
    if (!lovableKey || !excelKey) throw new Error("Conexão do SharePoint indisponível");
    const { downloadPurchaseOrderFile } = await import("./purchase-orders.server");
    const year = Number(new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 4));
    const file = await downloadPurchaseOrderFile(order, orderFilePaths(it.order_file_path)[data.index] || null, year, { lovableKey, excelKey });
    if (!file) throw new Error(`Pedido ${order} não encontrado na pasta de pedidos de compras`);
    // base64 sem Buffer (o servidor roda fora do Node): em blocos para não estourar a pilha.
    const u8 = new Uint8Array(file.bytes);
    let bin = "";
    for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode(...u8.subarray(i, i + 0x8000));
    return { name: file.name, base64: btoa(bin) };
  });
