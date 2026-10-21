export const BILLING_START = "2026-10-01";
export const BILLING_METHODS: Record<string, string> = { order: "Pedido", quote: "Orçamento", reconciliation: "Conciliação inteligente", tolerance: "Tolerância de centavos" };
export const BILLING_STATES: Record<string, string> = { posted: "Lançado", pending: "Pendente de identificação", ambiguity: "Ambiguidade", divergence: "Divergência", cancelled: "Cancelamento processado", error: "Erro de sincronização" };
export function documentKey(value: unknown): string {
  return String(value ?? "").trim().toUpperCase().replace(/\s+/g, "").split(/([/.-])/).map(p => /^\d+$/.test(p) ? p.replace(/^0+(?=\d)/, "") : p).join("");
}
export function moneyCents(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? Math.round(value * 100) : null;
  const s = String(value ?? "").replace(/R\$|\s/g, "");
  const canonical = s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s;
  if (!/^-?\d+(\.\d{1,2})?$/.test(canonical)) return null;
  const negative = canonical.startsWith("-");
  const [whole = "0", fraction = ""] = canonical.replace(/^-/, "").split(".");
  return (Number(whole) * 100 + Number(fraction.padEnd(2, "0"))) * (negative ? -1 : 1);
}
export function excelDate(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return new Date(Date.UTC(1899, 11, 30) + Math.floor(value) * 86400000).toISOString().slice(0, 10);
  const s = String(value ?? "").trim();
  const br = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
  const iso = br ? `${br[3]}-${br[2]}-${br[1]}` : s;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const date = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === iso ? iso : null;
}
export type BillingNote = { key: string; invoice: string; noInvoice?: boolean; issuedAt: string; client: string; order: string; quote: string; amountCents: number; cancelled: boolean; raw: unknown[]; row: number; error?: string };
/** Orçamento "26/256" → "260256" (zero após os 2 primeiros números), igual ao lançado como pedido. */
export function quoteKey(v: unknown): string {
  const s = String(v ?? "").trim();
  const m = /^(\d+)\s*\/\s*(\d+)$/.exec(s);
  return m ? `${m[1]}${m[2]!.padStart(4, "0")}` : s.replace(/\D/g, "");
}
/** Um faturamento liquida o pedido quando a descrição contém o número (pedido ou orçamento), em qualquer formato. */
export function billingMatchesOrder(description: string, orderNumber: string): boolean {
  const num = orderNumber.replace(/\s+/g, "").toLowerCase();
  if (!num) return false;
  const d = description.replace(/\s+/g, "").toLowerCase();
  if (d.includes(num)) return true;
  const q = quoteKey(orderNumber);
  if (q.length < 4) return false;
  const tokens = description.match(/\d+\s*\/\s*\d+|\d+/g) ?? [];
  return tokens.some((t) => quoteKey(t) === q);
}
const norm = (s: unknown) => String(s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
const doc = (s: unknown) => ["n/a", "na", "-", ""].includes(norm(s)) ? "" : String(s).trim();
export function parseBillingRows(rows: unknown[][]): { notes: BillingNote[]; ignored: number; invalid: number } {
  const header = rows[0]?.map(norm) ?? [];
  const col = (names: string[]) => header.findIndex(h => names.includes(h));
  const columns = { date: col(["data"]), client: col(["cliente"]), invoice: col(["nfse"]), order: col(["nro. pedido"]), quote: col(["proposta"]), amount: col(["r$ bruto"]), cancelled: col(["cancelada?"]), issuer: col(["empresa emissora", "cnpj emissor"]), series: col(["serie"]) };
  if ([columns.date, columns.client, columns.invoice, columns.order, columns.quote, columns.amount, columns.cancelled].some(i => i < 0)) throw new Error("A planilha não contém todas as colunas obrigatórias de faturamento.");
  const notes: BillingNote[] = []; let ignored = 0; let invalid = 0;
  for (const [index, row] of rows.slice(1).entries()) {
    if (!row.some(v => v !== "" && v !== null)) continue;
    const issuedAt = excelDate(row[columns.date]);
    if (!issuedAt) { invalid++; continue; }
    if (issuedAt < BILLING_START) { ignored++; continue; }
    const invoice = doc(row[columns.invoice]); const client = doc(row[columns.client]);
    const amountCents = moneyCents(row[columns.amount]);
    const cancellation = norm(row[columns.cancelled]);
    if (!amountCents) { ignored++; continue; } // sem montante: desconsiderar, não é erro
    const error = !client || amountCents === null || amountCents <= 0 ? "Cliente ou valor inválido" : !["", "sim", "nao", "s", "n"].includes(cancellation) ? "Situação de cancelamento inválida" : undefined;
    const issuer = columns.issuer >= 0 ? doc(row[columns.issuer]) : "AB5-servicos";
    const series = columns.series >= 0 ? doc(row[columns.series]) : "sem-serie";
    const order = doc(row[columns.order]); const quote = doc(row[columns.quote]);
    // Sem NF: chave estável pelo conteúdo; quando a NF for preenchida, a sincronização adota o mesmo lançamento
    const ident = invoice ? documentKey(invoice) : `SEMNF-${issuedAt}-${client.toUpperCase().replace(/[^A-Z0-9]/g, "")}-${documentKey(order || quote)}-${amountCents ?? 0}`;
    notes.push({ key: [issuer, series, issuedAt.slice(0, 4), ident].join("|"), invoice: invoice || "Sem NF", ...(invoice ? {} : { noInvoice: true }), client: client || "Cliente não informado", issuedAt, order, quote, amountCents: amountCents ?? 0, cancelled: ["sim", "s"].includes(cancellation), raw: row, row: index + 2, ...(error ? { error } : {}) });
  }
  const grouped = new Map<string, BillingNote[]>();
  for (const n of notes) grouped.set(n.key, [...(grouped.get(n.key) ?? []), n]);
  // Mesma NF em linhas diferentes (outro pedido/valor) é lançada separadamente; a primeira mantém a chave original.
  const out: BillingNote[] = [];
  for (const group of grouped.values()) {
    const seen = new Map<string, BillingNote>();
    for (const n of group) {
      const sig = JSON.stringify([n.issuedAt, n.client, n.order, n.quote, n.amountCents]);
      const prev = seen.get(sig);
      if (prev) { if (prev.cancelled !== n.cancelled) prev.error = "Mesma nota repetida com situação de cancelamento diferente"; continue; }
      const key = seen.size === 0 ? n.key : `${n.key}|L-${documentKey(n.order || n.quote) || "x"}-${n.amountCents}`;
      const note = { ...n, key }; seen.set(sig, note); out.push(note);
    }
  }
  return { notes: out, ignored, invalid };
}
export function activeFinancialEntries<T extends { sync_cancelled?: boolean }>(entries: T[]): T[] { return entries.filter(e => !e.sync_cancelled); }