/** Pasta dos pedidos de compras no SharePoint ("...\servidor dados - Compras\04 COMPRAS\02 PEDIDOS DE COMPRAS\<ano>"). */
export const purchaseOrdersFolder = (year: number | string) => `Compras/04 COMPRAS/02 PEDIDOS DE COMPRAS/${year}`;

/** Só os dígitos do nº do pedido digitado (ex.: "PC 012345" → "012345"). */
export const orderDigits = (s: string | null | undefined) => String(s ?? "").replace(/\D/g, "");

/** O arquivo é do pedido quando o nome traz o número inteiro, sem outros dígitos colados (12345 ≠ 123456). */
export function fileMatchesOrder(fileName: string, order: string) {
  const n = orderDigits(order);
  if (n.length < 3) return false;
  const base = fileName.replace(/\.[^.]+$/, "");
  return base.split(/\D+/).some((part) => part === n || (part.replace(/^0+/, "") === n.replace(/^0+/, "") && part.replace(/^0+/, "") !== ""));
}
