import { DRIVE, graph } from "./industry-sync.server";
import { fileMatchesOrder, purchaseOrdersFolder } from "./purchase-orders";

type Credentials = { lovableKey: string; excelKey: string };
type Item = { id: string; name: string; webUrl?: string; folder?: unknown; file?: unknown };
const enc = (p: string) => p.split("/").map(encodeURIComponent).join("/");
const GRAPH = "https://graph.microsoft.com/v1.0";

async function children(path: string, c: Credentials): Promise<Item[]> {
  const out: Item[] = [];
  let next: string | null = `${DRIVE}/root:/${enc(path)}:/children?$select=id,name,webUrl,folder,file&$top=999`;
  while (next) {
    let page: any;
    try { page = await graph(next, c); } catch { return out; } // pasta do ano ainda não existe
    out.push(...((page?.value ?? []) as Item[]));
    const link = page?.["@odata.nextLink"] as string | undefined;
    next = link ? link.replace(GRAPH, "") : null;
  }
  return out;
}

/**
 * Procura o arquivo do pedido de compras na pasta do ano (e nas subpastas de 1 nível, ex.: meses);
 * se não achar, no ano anterior. Devolve o link do SharePoint para abrir.
 */
export async function findPurchaseOrderFile(order: string, year: number, c: Credentials): Promise<{ name: string; url: string } | null> {
  for (const y of [year, year - 1]) {
    const base = purchaseOrdersFolder(y);
    const top = await children(base, c);
    const hit = top.find((i) => i.file && fileMatchesOrder(i.name, order));
    if (hit?.webUrl) return { name: hit.name, url: hit.webUrl };
    for (const f of top.filter((i) => i.folder)) {
      const inner = (await children(`${base}/${f.name}`, c)).find((i) => i.file && fileMatchesOrder(i.name, order));
      if (inner?.webUrl) return { name: inner.name, url: inner.webUrl };
    }
  }
  return null;
}
