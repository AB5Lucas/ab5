import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { vaPaths, type JustRow, type PunchRow } from "./vale-alimentacao";

const DRIVE = "/drives/b!5V4Lk-rJCUCH4KwrKzBCgQtORfWyeVZNr7N5qacwdyb7xsyD9fxASIPz40EKW7xL";
const GATEWAY = "https://connector-gateway.lovable.dev/microsoft_excel";

const isoFromCell = (v: unknown): string | null => {
  if (typeof v === "number") { const d = new Date(Math.round((v - 25569) * 86400000)); return d.toISOString().slice(0, 10); }
  const s = String(v ?? "").trim(); const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
};
const minFromCell = (v: unknown): number => {
  if (typeof v === "number") return Math.round(v * 1440);
  const m = String(v ?? "").match(/(\d+):(\d{2})/); return m ? Number(m[1]) * 60 + Number(m[2]) : 0;
};

/** Lê as planilhas Atraso e Justificativa da competência; só retorna dados se as duas existirem na pasta do mês. */
export const loadVASheets = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d: { ym: string }) => { if (!/^\d{4}-\d{2}$/.test(d?.ym ?? "")) throw new Error("Mês inválido"); return { ym: d.ym }; })
  .handler(async ({ context, data }) => {
    const { data: ok } = await context.supabase.rpc("can_access_page", { _path: "/relatorios/vale-alimentacao" });
    if (!ok) throw new Error("Você não tem acesso ao Vale Alimentação");
    const lovableKey = process.env["LOVABLE_API_KEY"], excelKey = process.env["MICROSOFT_EXCEL_API_KEY"];
    if (!lovableKey || !excelKey) throw new Error("Conexão do Excel indisponível");
    const p = vaPaths(data.ym);
    const enc = (s: string) => s.split("/").map(encodeURIComponent).join("/");
    const get = async (file: string) => {
      const res = await fetch(`${GATEWAY}${DRIVE}/root:/${enc(`${p.folder}/${file}`)}:/content`, { headers: { Authorization: `Bearer ${lovableKey}`, "X-Connection-Api-Key": excelKey }, signal: AbortSignal.timeout(20000) });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`Erro ao ler ${file} (${res.status}): ${(await res.text()).slice(0, 200)}`);
      return new Uint8Array(await res.arrayBuffer());
    };
    const [a, j] = await Promise.all([get(p.atraso), get(p.justificativa)]);
    const missing = [!a && p.atraso, !j && p.justificativa].filter(Boolean) as string[];
    if (missing.length) return { found: false as const, folder: p.folder, missing, just: [] as JustRow[], punches: [] as PunchRow[] };
    const XLSX = await import("xlsx");
    // O ponto exporta horas como fórmula "(HH/24+TIME(h,m,s))" com valor em cache "0"; recalcula a partir da fórmula.
    const fromFormula = (f: string): number | null => {
      const m = f.match(/^\(?\s*(\d+)\s*\/\s*24\s*\+\s*TIME\((\d+),(\d+),(\d+)\)\s*\)?$/i);
      if (m) return (Number(m[1]) + Number(m[2])) / 24 + Number(m[3]) / 1440 + Number(m[4]) / 86400;
      const t = f.match(/^\(?\s*TIME\((\d+),(\d+),(\d+)\)\s*\)?$/i);
      return t ? Number(t[1]) / 24 + Number(t[2]) / 1440 + Number(t[3]) / 86400 : null;
    };
    const rowsOf = (buf: Uint8Array, sheet?: string) => {
      const wb = XLSX.read(buf, { cellFormula: true }); const ws = wb.Sheets[sheet && wb.Sheets[sheet] ? sheet : wb.SheetNames[0]!]!;
      for (const k of Object.keys(ws)) { const c = ws[k] as { f?: string; v?: unknown; t?: string } | undefined; if (k[0] === "!" || !c?.f) continue; const n = fromFormula(c.f); if (n != null && (c.v === "0" || c.v === 0 || c.v === "" || c.v == null)) { c.v = n; c.t = "n"; } }
      return XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: "" });
    };
    const jr = rowsOf(j!); const jh = (jr[0] ?? []).map((h) => String(h).trim().toLowerCase());
    const ci = (h: string[], ...names: string[]) => h.findIndex((x) => names.some((n) => x.startsWith(n)));
    const jd = ci(jh, "data"), jm = ci(jh, "matr"), jn = ci(jh, "funcion"), jj = ci(jh, "justif");
    const just: JustRow[] = jr.slice(1).map((r) => ({ date: isoFromCell(r[jd]) ?? "", reg: String(r[jm] ?? "").trim(), name: String(r[jn] ?? "").trim(), reason: String(r[jj] ?? "").trim() })).filter((r) => r.date && r.reason);
    const ar = rowsOf(a!, "Worksheet"); const ah = (ar[0] ?? []).map((h) => String(h).trim().toLowerCase());
    const ad = ci(ah, "data"), an = ci(ah, "funcion"), desc = ci(ah, "descont"), at = ah.findIndex((x) => x === "atrasos"), sa = ci(ah, "saída antecipada", "saida antecipada");
    const pIdx = ah.map((x, i) => (/^\d+º (entrada|saída|saida)/.test(x) ? i : -1)).filter((i) => i >= 0);
    const punches: PunchRow[] = ar.slice(1).map((r) => ({ date: isoFromCell(r[ad]) ?? "", name: String(r[an] ?? "").trim(), punches: pIdx.map((i) => String(r[i] ?? "").replace(/[a-z]$/i, "").trim()), discountMin: minFromCell(r[desc]), lateMin: at >= 0 ? minFromCell(r[at]) : 0, earlyMin: sa >= 0 ? minFromCell(r[sa]) : 0 })).filter((r) => r.date && r.name);
    return { found: true as const, folder: p.folder, missing, just, punches };
  });
