/** Pasta dos pedidos de compras no SharePoint ("...\servidor dados - Compras\04 COMPRAS\02 PEDIDOS DE COMPRAS\<ano>"). */
export const purchaseOrdersFolder = (year: number | string) => `Compras/04 COMPRAS/02 PEDIDOS DE COMPRAS/${year}`;

/** Só os dígitos do nº do pedido digitado (ex.: "PC 012345" → "012345"). */
export const orderDigits = (s: string | null | undefined) => String(s ?? "").replace(/\D/g, "");

/** A saved order can be corrected after the item's status moves past approval. */
export const canEditPurchaseOrder = (status: string, savedOrder: string | null | undefined): boolean =>
  status === "APROVADO" || Boolean(savedOrder?.trim());

/** O arquivo é do pedido quando o nome traz o número inteiro, sem outros dígitos colados (12345 ≠ 123456). */
export function fileMatchesOrder(fileName: string, order: string) {
  const n = orderDigits(order);
  if (n.length < 3) return false;
  const base = fileName.replace(/\.[^.]+$/, "");
  return base.split(/\D+/).some((part) => part === n || (part.replace(/^0+/, "") === n.replace(/^0+/, "") && part.replace(/^0+/, "") !== ""));
}

/** Vários pedidos no mesmo item, separados por ";" (ex.: "35828; 35829"). */
export const splitOrders = (s: string | null | undefined) => String(s ?? "").split(";").map((x) => x.trim()).filter(Boolean);
/** order_file_path guarda um link por pedido, na mesma ordem, separados por quebra de linha (vazio = não achado). */
export const orderFilePaths = (s: string | null | undefined) => (s ? s.split("\n") : []);
