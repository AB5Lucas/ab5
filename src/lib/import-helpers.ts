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
