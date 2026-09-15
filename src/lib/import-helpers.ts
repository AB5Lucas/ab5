import type { ImportResult } from "@/components/import-dialog";

export const normText = (v: string) =>
  v
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();

/** Aceita AAAA-MM-DD, DD/MM/AAAA e datas do Excel já formatadas. Retorna AAAA-MM-DD ou null. */
export function parseDate(v: string): string | null {
  const s = (v ?? "").trim();
  if (!s) return null;
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const br = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/);
  if (br) return `${br[3]}-${br[2]!.padStart(2, "0")}-${br[1]!.padStart(2, "0")}`;
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return null;
}

export function parseBool(v: string): boolean {
  return ["sim", "s", "true", "1", "x", "yes"].includes(normText(v ?? ""));
}

export function parseNum(v: string): number | null {
  const s = (v ?? "").trim().replace(/\./g, "").replace(",", ".");
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

const SMALL_WORDS = new Set(["de", "da", "do", "das", "dos", "e", "em", "no", "na", "nos", "nas", "a", "o", "as", "os", "para", "com", "por", "ao", "aos"]);

/**
 * Corrige textos digitados totalmente em CAIXA ALTA para "Iniciais Maiúsculas".
 * Ex.: "MONTADOR DE ANDAIMES N1" -> "Montador de Andaimes N1".
 * Textos que já possuem minúsculas são mantidos como estão.
 */
export function titleCase(v: string): string {
  const s = (v ?? "").trim().replace(/\s+/g, " ");
  if (s === "" || /[a-zà-ÿ]/.test(s)) return s;
  return s
    .toLocaleLowerCase("pt-BR")
    .split(" ")
    .map((word, i) =>
      word
        .split("-")
        .map((part) => {
          if (part === "") return part;
          if (/\d/.test(part)) return part.toLocaleUpperCase("pt-BR");
          if (i > 0 && SMALL_WORDS.has(part)) return part;
          return part.charAt(0).toLocaleUpperCase("pt-BR") + part.slice(1);
        })
        .join("-"),
    )
    .join(" ");
}

/** Igual a emptyToNull, mas ajusta CAIXA ALTA para iniciais maiúsculas. */
export const titleCaseOrNull = (v: string) => {
  const s = titleCase(v ?? "");
  return s === "" ? null : s;
};

const STOP_WORDS = new Set([
  "de", "da", "do", "das", "dos", "e", "em", "no", "na", "nos", "nas",
  "a", "o", "as", "os", "para", "com", "por", "ao", "aos", "the",
]);

/** Reduz uma palavra a um radical tolerante a gênero/plural: "tecnica"/"tecnicos" -> "tecnic". */
function stemWord(w: string): string {
  let s = w.replace(/[^a-z0-9]/g, "");
  if (!s) return "";
  if (/\d/.test(s)) return s;
  s = s.replace(/(oes|aes|ais|eis|ns)$/, "");
  s = s.replace(/s$/, "");
  s = s.replace(/[aoe]$/, "");
  return s;
}

/** Chave canônica de um nome: sem acentos, sem preposições, tolerante a gênero e plural. */
export function nameKey(v: string): string {
  return normText(v ?? "")
    .split(/[\s/\-_.]+/)
    .filter((w) => w && !STOP_WORDS.has(w))
    .map(stemWord)
    .filter(Boolean)
    .join(" ");
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(
        prev[j]! + 1,
        cur[j - 1]! + 1,
        prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = cur;
  }
  return prev[n]!;
}

function similarity(a: string, b: string): number {
  const max = Math.max(a.length, b.length);
  if (!max) return 0;
  return 1 - levenshtein(a, b) / max;
}

const ROMAN_LEVEL: Record<string, string> = { i: "1", ii: "2", iii: "3", iv: "4" };

/**
 * Extrai o nível de uma função: "N1", "nivel 2", "niv. 3", "III" -> "1" | "2" | "3" | "4".
 * Retorna null quando o nome não indica nível.
 */
export function extractLevel(v: string): string | null {
  const s = normText(v ?? "");
  const m =
    s.match(/\bn[ivel]*\s*\.?\s*([1-4])\b/) ??
    s.match(/\b([1-4])\b\s*$/) ??
    null;
  if (m) return m[1]!;
  const r = s.match(/\b(i{1,3}|iv)\b\s*$/);
  if (r) return ROMAN_LEVEL[r[1]!] ?? null;
  return null;
}

/** Remove a marcação de nível do nome, para comparar apenas a função base. */
function stripLevel(v: string): string {
  return normText(v ?? "")
    .replace(/\bn[ivel]*\s*\.?\s*[1-4]\b/g, " ")
    .replace(/\b(i{1,3}|iv)\b\s*$/g, " ")
    .replace(/\b[1-4]\b\s*$/g, " ")
    .trim();
}

/**
 * Cria um localizador de registros por nome tolerante a erros de planilha:
 * ignora acentos, maiúsculas, preposições, gênero ("Técnica" = "Técnico"),
 * plural e pequenas diferenças de digitação — mas NUNCA mistura níveis
 * diferentes ("Montador de Andaimes N1" ≠ "Montador de Andaimes N2").
 */
export function createNameMatcher<T extends { id: string; name: string }>(list: T[]) {
  const exact = new Map<string, T>();
  const keyed = new Map<string, T>();
  const levelOf = new Map<string, string | null>();
  for (const item of list) {
    exact.set(normText(item.name), item);
    const k = nameKey(stripLevel(item.name));
    const lvl = extractLevel(item.name);
    const mapKey = `${lvl ?? ""}|${k}`;
    if (k && !keyed.has(mapKey)) {
      keyed.set(mapKey, item);
      levelOf.set(mapKey, lvl);
    }
  }
  const entries = [...keyed.entries()];

  return function match(value: string): T | null {
    const raw = (value ?? "").trim();
    if (!raw) return null;
    const direct = exact.get(normText(raw));
    if (direct) return direct;
    const level = extractLevel(raw);
    const key = nameKey(stripLevel(raw));
    if (!key) return null;
    const byKey = keyed.get(`${level ?? ""}|${key}`);
    if (byKey) return byKey;

    // só compara candidatos do mesmo nível
    const sameLevel = entries.filter(([mk]) => (levelOf.get(mk) ?? null) === level);
    const stripped = sameLevel.map(([mk, item]) => [mk.slice(mk.indexOf("|") + 1), item] as const);

    // contém / está contido (ex.: "Tecnico Seguranca" x "Tecnico de Seguranca do Trabalho")
    const contains = stripped.filter(([k]) => k.includes(key) || key.includes(k));
    if (contains.length === 1) return contains[0]![1];

    // aproximação por similaridade
    let best: { item: T; score: number } | null = null;
    for (const [k, item] of stripped) {
      const score = similarity(key, k);
      if (!best || score > best.score) best = { item, score };
    }
    return best && best.score >= 0.85 ? best.item : null;
  };
}


export const emptyToNull = (v: string) => {
  const s = (v ?? "").trim();
  return s === "" ? null : s;
};

/** Insere registro a registro para conseguir reportar a linha com problema. */
export async function insertSequentially(
  records: { line: number; values: Record<string, unknown> }[],
  insert: (values: Record<string, unknown>) => Promise<{ error: { message: string } | null }>,
  preErrors: string[] = [],
): Promise<ImportResult> {
  const errors = [...preErrors];
  let inserted = 0;
  for (const rec of records) {
    const { error } = await insert(rec.values);
    if (error) errors.push(`Linha ${rec.line}: ${error.message}`);
    else inserted++;
  }
  return { inserted, errors };
}
