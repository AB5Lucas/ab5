import { excelDate, moneyCents } from "./billing-sync";

export const MONTHS = ["JANEIRO","FEVEREIRO","MARÇO","ABRIL","MAIO","JUNHO","JULHO","AGOSTO","SETEMBRO","OUTUBRO","NOVEMBRO","DEZEMBRO"];
export const MONTHS_SHORT = ["JAN","FEV","MAR","ABR","MAI","JUN","JUL","AGO","SET","OUT","NOV","DEZ"];
export const TOLERANCE_DAYS = 7;

/** "027578" → "27578"; preserves "0". */
export function stripZeros(v: unknown): string {
  const s = String(v ?? "").trim();
  return s.replace(/^0+(?=\d)/, "");
}

const SERVICE_MAP: Record<string, string> = { PPO: "PPO", N: "PPO", REN: "PPO", "PPO N": "PPO", CARR: "Carrinhos", PLQ: "Pliq", REM: "Remoção", JATO: "Jato" };
export function classifyService(code: unknown): string | null {
  const k = String(code ?? "").trim().replace(/\s+/g, " ").toUpperCase();
  return SERVICE_MAP[k] ?? null;
}

/** ym = "2026-10" */
export function ordersFileName(ym: string) {
  const [y, m] = ym.split("-").map(Number) as [number, number];
  return `${String(y).slice(2)} ${MONTHS_SHORT[m - 1]}.xlsx`;
}
export function invoiceFolderName(ym: string) {
  const [y, m] = ym.split("-").map(Number) as [number, number];
  return `${String(m).padStart(2, "0")} ${MONTHS[m - 1]} ${y}`;
}
export function servicesFileName(year: number) { return `VENDAS SERVIÇOS ${year}.xlsx`; }

/** Months to read on `today` (YYYY-MM-DD): current, plus previous while inside tolerance. */
export function monthsToSync(today: string, tolerance = TOLERANCE_DAYS): string[] {
  const [y, m, d] = today.split("-").map(Number) as [number, number, number];
  const cur = `${y}-${String(m).padStart(2, "0")}`;
  if (d > tolerance) return [cur];
  const py = m === 1 ? y - 1 : y; const pm = m === 1 ? 12 : m - 1;
  return [`${py}-${String(pm).padStart(2, "0")}`, cur];
}
/** Missing file for ym is "waiting" while within tolerance days of the month start. */
export function missingStatus(ym: string, today: string, tolerance = TOLERANCE_DAYS): "waiting" | "access_error" {
  const start = new Date(`${ym}-01T00:00:00Z`).getTime();
  const days = (new Date(`${today}T00:00:00Z`).getTime() - start) / 86400000;
  return days < tolerance ? "waiting" : "access_error";
}

export type IndustryOrder = { order: string; client: string; code: string; service: string | null; amount: number; mp: number | null; date: string | null; issue?: string };
const num = (v: unknown) => { const c = moneyCents(v); return c === null ? null : c / 100; };

/** Sheet "Dados": B=OP, D=Cliente, G=DIV, J=MP, M=Valor, O=Data. */
/** Older sheets have no DIV code (e.g. "VENDA"); infer the service from the client/material text. */
export function serviceFromText(text: unknown): string | null {
  const t = String(text ?? "").toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (/CARRINHO|\bCARR\b/.test(t)) return "Carrinhos";
  if (/REMOCAO|\bREM\b/.test(t)) return "Remoção";
  if (/\bJATO\b/.test(t)) return "Jato";
  if (/\bPLIQ|\bPLQ\b/.test(t)) return "Pliq";
  return null;
}
export function parseOrders(rows: unknown[][]): { orders: IndustryOrder[]; ignored: number } {
  const h = rows.findIndex(r => String(r[1] ?? "").trim().toUpperCase() === "OP");
  const head = (rows[h] ?? []).map(v => String(v ?? "").trim().toUpperCase());
  const col = (names: string[], def: number) => { const i = head.findIndex(x => names.includes(x)); return i >= 0 ? i : def; };
  const cClient = col(["CLIENTE"], 3), cDiv = col(["DIV"], 6), cMp = col(["MP REAL"], 9), cAmt = col(["REALIZ. R$"], 12), cDate = col(["DATA FINAL", "TERM EFETIVO"], 14), cMat = col(["MATERIAL"], -1);
  const out = new Map<string, IndustryOrder>(); let ignored = 0;
  for (const r of rows.slice(h + 1)) {
    const raw = String(r[1] ?? "").trim();
    if (!/^\d+$/.test(raw)) { if (raw) ignored++; continue; }
    const order = stripZeros(raw);
    const code = String(r[cDiv] ?? "").trim();
    const service = classifyService(code) ?? serviceFromText(`${r[cClient] ?? ""} ${cMat >= 0 ? r[cMat] ?? "" : ""}`);
    const amount = r[cAmt] === "" || r[cAmt] == null ? 0 : num(r[cAmt]); const mp = r[cMp] === "" || r[cMp] == null ? null : num(r[cMp]);
    const date = r[cDate] === "" || r[cDate] == null ? null : excelDate(r[cDate]);
    const issue = !service ? `Código de serviço desconhecido: ${code || "vazio"}` : amount === null ? "Valor inválido" : undefined;
    out.set(order, { order, client: String(r[cClient] ?? "").trim() || "Cliente não informado", code, service, amount: amount ?? 0, mp, date, ...(issue ? { issue } : {}) });
  }
  return { orders: [...out.values()], ignored };
}

export type IndustryInvoice = { invoice: string; date: string; order: string; client: string; amount: number; items: { order: string; amount: number }[] };
/** Fat. Por Vendedor: B=NF, H=Emissão, M=Cliente, Q=Pedido, AR=Valor. Items of the same NF+date are summed. */
export function isWorksBilling(desc: unknown) {
  return String(desc ?? "").toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").includes("SERVICOS COBRANCA OBRAS");
}
/** Clientes faturados pela aba Serviços: nunca entram no faturamento da Indústria. */
export const SERVICES_ONLY_CLIENTS = ["TENNECO"];
export function isServicesClient(client: unknown) {
  const c = String(client ?? "").toUpperCase();
  return SERVICES_ONLY_CLIENTS.some(k => c.includes(k));
}
export function parseInvoices(rows: unknown[][]): IndustryInvoice[] {
  const map = new Map<string, IndustryInvoice>();
  for (const r of rows) {
    const nf = String(r[1] ?? "").trim();
    if (!/^\d+$/.test(nf)) continue;
    // Medições de obras (Serviços) não pertencem ao faturamento fabril.
    if (isWorksBilling(r[25]) || isServicesClient(r[12])) continue;
    const date = excelDate(r[7]); const cents = moneyCents(r[43]);
    if (!date || cents === null) continue;
    const invoice = stripZeros(nf); const order = stripZeros(r[16]);
    const key = `${invoice}|${date}`;
    const cur = map.get(key) ?? { invoice, date, order, client: String(r[12] ?? "").trim(), amount: 0, items: [] };
    cur.amount = Math.round(cur.amount * 100 + cents) / 100;
    cur.items.push({ order, amount: cents / 100 });
    if (!cur.order && order) cur.order = order;
    map.set(key, cur);
  }
  return [...map.values()];
}
