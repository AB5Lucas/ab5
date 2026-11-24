/**
 * Importar planilha de itens na SC (regras puras, sem banco): lê as linhas já extraídas da planilha
 * (matriz de células), acha a linha de títulos, casa as colunas (com/sem acento e variações) e devolve
 * cada linha com os valores no formato do formulário da SC e os erros/avisos por linha.
 */
import { SC_UNITS } from "./purchase-requests";

/** Colunas do modelo (Baixar modelo), nesta ordem. */
export const SC_IMPORT_COLUMNS = ["Item", "Qtd", "Un. medida", "Descrição", "Verba (R$)", "Observações", "Centro de custo", "CC"] as const;

export const SC_IMPORT_RATEIO = "__rateio__";

type Field = "item" | "quantity" | "unit" | "description" | "budget" | "notes" | "work" | "cc";

/** Texto sem acento, minúsculo e só letras/números (para casar títulos e nomes). */
export const normKey = (s: unknown) =>
  String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");

const HEADERS: Record<Field, string[]> = {
  item: ["item", "itens", "n", "no", "num", "numero", "nitem"],
  quantity: ["qtd", "qtde", "qt", "quant", "quantidade"],
  unit: ["un", "und", "unid", "unidade", "unmedida", "unidmedida", "unidadedemedida", "unidademedida", "undmedida", "medida"],
  description: ["descricao", "desc", "descricaodoitem", "item descricao", "produto", "material", "especificacao"].map(normKey),
  budget: ["verba", "verbars", "verbar", "valor", "valorrs", "valorestimado", "orcamento"],
  notes: ["obs", "observacao", "observacoes", "obsitem"],
  work: ["centrodecusto", "centrocusto", "centrodecustos", "servico", "obra"],
  cc: ["cc", "codigocc", "codcc", "ccdigitado"],
};

/** Mapa coluna → campo a partir de uma linha de títulos (null se não for linha de títulos). */
export function headerMap(row: unknown[]): Map<number, Field> | null {
  const m = new Map<number, Field>();
  const used = new Set<Field>();
  row.forEach((cell, i) => {
    const k = normKey(cell);
    if (!k) return;
    for (const f of Object.keys(HEADERS) as Field[]) {
      if (used.has(f)) continue;
      if (HEADERS[f].includes(k)) { m.set(i, f); used.add(f); return; }
    }
  });
  return used.has("description") && used.has("quantity") ? m : null;
}

/** Número em formato brasileiro ou planilha: "1.234,50", "R$ 50", "1,5", 12.5. null = vazio; NaN = inválido. */
export function parseBrNumber(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : NaN;
  let s = String(v).replace(/R\$/gi, "").replace(/\s/g, "").replace(/ /g, "");
  if (!s) return null;
  if (s.includes(",") && s.includes(".")) s = s.lastIndexOf(",") > s.lastIndexOf(".") ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  else if (s.includes(",")) s = s.replace(",", ".");
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");
  if (!/^-?\d+(\.\d+)?$/.test(s)) return NaN;
  return Number(s);
}

/** Número de volta para o campo do formulário (vírgula decimal, sem milhar). */
export const toField = (n: number) => String(Math.round(n * 1e6) / 1e6).replace(".", ",");

const UNIT_ALIAS: Record<string, string> = {
  UND: "UN", UNID: "UN", UNIDADE: "UN", UNIDADES: "UN", U: "UN", PÇ: "PC", PCS: "PC", PECA: "PC", PEÇA: "PC", PECAS: "PC", PEÇAS: "PC",
  CAIXA: "CX", M2: "M²", M3: "M³", LT: "L", LITRO: "L", LITROS: "L", METRO: "M", MT: "M", METROS: "M", ROLO: "RL", JOGO: "JG",
  SACO: "SC", GALAO: "GL", GALÃO: "GL", TUBO: "TB", SERVIÇO: "SERV", SERVICO: "SERV", SV: "SERV", KGS: "KG", QUILO: "KG",
};
/** Unidade em maiúsculas; sinônimos comuns viram a sigla da lista. known = está em SC_UNITS. */
export function normUnit(v: unknown): { unit: string; known: boolean } {
  const raw = String(v ?? "").trim().toUpperCase().replace(/\.$/, "");
  if (!raw) return { unit: "UN", known: true };
  const unit = UNIT_ALIAS[raw] ?? raw;
  return { unit, known: (SC_UNITS as readonly string[]).includes(unit) };
}

export type ImportWork = { id: string; name: string; order_number?: string | null };

/** Centro de custo pelo nome do serviço do cliente (ou nº do pedido); vazio/"Rateio" = rateio geral. */
export function matchWork(v: unknown, works: ImportWork[]): { id: string } | { error: string } {
  const k = normKey(v);
  if (!k || k.startsWith("rateio")) return { id: SC_IMPORT_RATEIO };
  const label = (w: ImportWork) => {
    const orders = (w.order_number ?? "").split(/[\s/;,]+/).filter(Boolean);
    return orders.length ? `${orders[0]} - ${w.name}` : w.name;
  };
  const exact = works.filter((w) => normKey(w.name) === k || normKey(label(w)) === k);
  if (exact.length === 1) return { id: exact[0]!.id };
  const byOrder = works.filter((w) => (w.order_number ?? "").split(/[\s/;,]+/).some((o) => o && normKey(o) === k));
  if (byOrder.length === 1) return { id: byOrder[0]!.id };
  const partial = works.filter((w) => normKey(w.name).includes(k) || k.includes(normKey(w.name)));
  if (exact.length > 1 || partial.length > 1) return { error: `Centro de custo "${String(v).trim()}" casa com mais de um serviço` };
  if (partial.length === 1) return { id: partial[0]!.id };
  return { error: `Centro de custo "${String(v).trim()}" não encontrado nos serviços do cliente` };
}

export type ImportedRow = {
  line: number; // linha na planilha (1 = primeira)
  quantity: string; unit: string; description: string; budget: string; notes: string; work_id: string; cc: string;
  errors: string[]; warnings: string[];
};

/**
 * Linhas da planilha (matriz, a 1ª aba) → itens. A linha de títulos é a primeira (entre as 15 primeiras)
 * que tem Descrição e Qtd; linhas vazias são puladas; a coluna Item é só numeração.
 */
export function parseScImport(matrix: unknown[][], works: ImportWork[]): { rows: ImportedRow[]; error?: string } {
  let hIdx = -1;
  let map: Map<number, Field> | null = null;
  for (let i = 0; i < Math.min(matrix.length, 15); i++) {
    map = headerMap(matrix[i] ?? []);
    if (map) { hIdx = i; break; }
  }
  if (!map) return { rows: [], error: "Não achei a linha de títulos (precisa ter ao menos Qtd e Descrição). Use o modelo." };
  const rows: ImportedRow[] = [];
  for (let i = hIdx + 1; i < matrix.length; i++) {
    const line = matrix[i] ?? [];
    const cell = (f: Field) => { for (const [c, ff] of map!) if (ff === f) return line[c]; return undefined; };
    const text = (f: Field) => String(cell(f) ?? "").trim();
    const meaningful = (["quantity", "unit", "description", "budget", "notes", "work", "cc"] as Field[]).some((f) => text(f) !== "");
    if (!meaningful) continue;
    const errors: string[] = [];
    const warnings: string[] = [];
    const q = parseBrNumber(cell("quantity"));
    if (q == null) errors.push("Qtd vazia");
    else if (!Number.isFinite(q) || q <= 0) errors.push(`Qtd inválida ("${text("quantity")}")`);
    const description = text("description");
    if (!description) errors.push("Descrição vazia");
    const u = normUnit(cell("unit"));
    if (!text("unit")) warnings.push("Sem unidade: ficou UN");
    else if (!u.known) warnings.push(`Unidade "${u.unit}" fora da lista`);
    const b = parseBrNumber(cell("budget"));
    if (b != null && (!Number.isFinite(b) || b < 0)) errors.push(`Verba inválida ("${text("budget")}")`);
    const w = matchWork(cell("work"), works);
    if ("error" in w) errors.push(w.error);
    const cc = text("cc").replace(/[^\w]/g, "");
    rows.push({
      line: i + 1,
      quantity: q != null && Number.isFinite(q) && q > 0 ? toField(q) : text("quantity"),
      unit: u.unit, description, budget: b != null && Number.isFinite(b) && b >= 0 ? toField(b) : "",
      notes: text("notes"), work_id: "id" in w ? w.id : SC_IMPORT_RATEIO, cc, errors, warnings,
    });
  }
  return { rows };
}
