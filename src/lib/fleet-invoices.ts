/**
 * Frota › Abastecimento › Fiscal: faturas quinzenais do posto (PDF da Blaster) lidas da pasta 03 FATURAS.
 * O PDF tem o texto em claro (Tj/TJ); quando o conteúdo vem comprimido (FlateDecode), é descomprimido antes.
 */

export const DEFAULT_INVOICE_FOLDER = "Compras/04 COMPRAS/03 RATEIOS E CONFERÊNCIAS/02 CONFERÊNCIA/04 CONSUMO VEICULAR/03 FATURAS";

export type FleetInvoice = {
  number: string; issued_on: string | null; due_on: string | null; total: number | null;
  period_from: string | null; period_to: string | null; coupon_keys: string[];
};

const latin1 = (bytes: Uint8Array) => { let s = ""; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return s; };

async function inflate(bytes: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream("deflate");
  const out = new Response(new Blob([bytes]).stream().pipeThrough(ds));
  return new Uint8Array(await out.arrayBuffer());
}

/** Texto de uma string literal do PDF: "(...)" com escapes \( \) \\ \n \ddd. */
function literal(s: string): string {
  return s.replace(/\\([nrtbf()\\]|[0-7]{1,3}|\r?\n)/g, (_, e: string) =>
    e === "n" ? "\n" : e === "r" ? "\r" : e === "t" ? "\t" : e === "b" ? "\b" : e === "f" ? "\f"
      : /^[0-7]+$/.test(e) ? String.fromCharCode(parseInt(e, 8)) : /^\r?\n$/.test(e) ? "" : e);
}

/** Textos escritos no PDF, na ordem (cada Tj/TJ vira um item). */
export async function pdfTexts(buf: ArrayBuffer | Uint8Array): Promise<string[]> {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const raw = latin1(bytes);
  const out: string[] = [];
  const re = /stream\r?\n/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    const start = m.index + m[0].length;
    const end = raw.indexOf("endstream", start);
    if (end < 0) break;
    const dict = raw.slice(Math.max(0, raw.lastIndexOf("<<", m.index)), m.index);
    let content = raw.slice(start, end);
    if (/FlateDecode/.test(dict)) {
      try { content = latin1(await inflate(bytes.subarray(start, end))); } catch { continue; }
    }
    if (!/T[jJ]/.test(content)) continue;
    // (texto) Tj  e  [(a) -10 (b)] TJ
    const ops = /\(((?:\\.|[^\\)])*)\)\s*Tj|\[((?:\\.|[^\]])*)\]\s*TJ/gs;
    let o: RegExpExecArray | null;
    while ((o = ops.exec(content))) {
      if (o[1] != null) out.push(literal(o[1]));
      else out.push([...o[2]!.matchAll(/\(((?:\\.|[^\\)])*)\)/g)].map((x) => literal(x[1]!)).join(""));
    }
    re.lastIndex = end;
  }
  return out.map((t) => t.trim()).filter(Boolean);
}

const DATE = /^(\d{2})\/(\d{2})\/(\d{4})$/;
const iso = (d: string | undefined | null) => { const x = d?.match(/(\d{2})\/(\d{2})\/(\d{4})/); return x ? `${x[3]}-${x[2]}-${x[1]}` : null; };
const MONEY = /^\d{1,3}(?:\.\d{3})*,\d{2}$/;
const money = (s: string) => Number(s.replace(/\./g, "").replace(",", "."));

/** Dados da fatura a partir dos textos do PDF. Null se não achar o número da fatura. */
export function parseInvoiceTexts(parts: string[]): FleetInvoice | null {
  const idx = parts.findIndex((p) => /^\d{6,}-\d{2}$/.test(p));
  if (idx < 0) return null;
  const after = parts.slice(idx + 1, idx + 12);
  const dates = after.filter((p) => DATE.test(p));
  const value = after.find((p) => MONEY.test(p));
  const full = parts.join(" ");
  const period = full.match(/PER[IÍ]ODO FATURADO\s*:?\s*DE\s+(\d{2}\/\d{2}\/\d{4})\s+\S{1,3}\s+(\d{2}\/\d{2}\/\d{4})/i);
  const keys = [...new Set([...full.matchAll(/(?<!\d)(\d{4}(?:\s+\d{4}){10})(?!\d)/g)].map((k) => k[1]!.replace(/\s+/g, "")))];
  return {
    number: parts[idx]!.split("-")[0]!.replace(/^0+/, "") || "0",
    issued_on: iso(dates[0]), due_on: iso(dates[1]), total: value ? money(value) : null,
    period_from: iso(period?.[1]), period_to: iso(period?.[2]), coupon_keys: keys,
  };
}

/**
 * Mês e quinzena da cobrança, pela data de emissão (regra de Compras): emitida do dia 1 ao 5 = 2ª quinzena do mês
 * anterior; do dia 16 ao 20 = 1ª quinzena do mesmo mês. Emitida em outro dia: pelo período faturado do PDF
 * (início até o dia 15 = 1ª quinzena) e, sem período, pela emissão (até o dia 15 = 2ª do mês anterior).
 */
export function invoiceFortnight(periodFrom: string | null, issuedOn: string | null): { month: number | null; year: number | null; fortnight: 1 | 2 | null } {
  const prevMonth = (y: number, m: number) => (m === 1 ? { month: 12, year: y - 1 } : { month: m - 1, year: y });
  const issued = issuedOn ? (issuedOn.split("-").map(Number) as [number, number, number]) : null;
  if (issued) {
    const [y, m, d] = issued;
    if (d >= 1 && d <= 5) return { ...prevMonth(y, m), fortnight: 2 };
    if (d >= 16 && d <= 20) return { month: m, year: y, fortnight: 1 };
  }
  if (periodFrom) {
    const [y, m, d] = periodFrom.split("-").map(Number) as [number, number, number];
    return { month: m, year: y, fortnight: d <= 15 ? 1 : 2 };
  }
  if (!issued) return { month: null, year: null, fortnight: null };
  const [y, m, d] = issued;
  return d > 15 ? { month: m, year: y, fortnight: 1 } : { ...prevMonth(y, m), fortnight: 2 };
}

/** Número como na planilha de Compras: 9 dígitos ("1105629" → "001105629"). */
export const invoiceNumber = (n: string) => n.padStart(9, "0");
