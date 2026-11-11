import * as XLSX from "xlsx";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { DRIVE, graph } from "./industry-sync.server";
import { fuelFile, MAINTENANCE_FILE, parseFuel, parseMaintenance, type FleetExpenseRow } from "./fleet-costs";

type Credentials = { lovableKey: string; excelKey: string };
const enc = (p: string) => p.split("/").map(encodeURIComponent).join("/");

/** Baixa pelo caminho; se não estiver lá, procura o arquivo pelo nome na unidade inteira. */
async function download(file: string, c: Credentials): Promise<ArrayBuffer> {
  try {
    return await graph(`${DRIVE}/root:/${enc(file)}:/content`, c, true);
  } catch (err) {
    if (!/não encontrad/i.test(err instanceof Error ? err.message : "")) throw err;
    const name = file.split("/").pop()!;
    const found = await graph(`${DRIVE}/root/search(q='${encodeURIComponent(name.replace(/'/g, "''"))}')?$select=id,name&$top=50`, c);
    const hit = ((found?.value ?? []) as { id: string; name: string }[]).find((i) => i.name.trim().toLowerCase() === name.toLowerCase());
    if (!hit) throw new Error(`Arquivo ou pasta não encontrado: ${name}`);
    return graph(`${DRIVE}/items/${hit.id}/content`, c, true);
  }
}

async function sheetRows(file: string, sheet: string, c: Credentials): Promise<unknown[][]> {
  const buf = await download(file, c);
  // Só a aba usada: a planilha do posto é grande e tem várias abas com fórmulas.
  const wb = XLSX.read(new Uint8Array(buf), { cellDates: false, sheets: sheet, cellFormula: false, cellHTML: false, cellText: false });
  const ws = wb.Sheets[sheet];
  if (!ws) throw new Error(`Aba "${sheet}" não encontrada em ${file}`);
  return XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: "" });
}

async function replace(source: "combustivel" | "manutencao", file: string, rows: FleetExpenseRow[]) {
  const { data, error } = await supabaseAdmin.rpc("fleet_expenses_replace", { p_source: source, p_file: file, p_rows: JSON.parse(JSON.stringify(rows)) });
  if (error) throw error;
  return data as number;
}

/**
 * Lê as planilhas de Compras e troca os gastos guardados de cada uma: manutenção (Romildo) e
 * combustível (posto, arquivo do ano atual e do anterior). Uma planilha com erro não impede as outras.
 */
export async function executeFleetSync(c: Credentials) {
  const year = new Date().getUTCFullYear();
  const jobs: { source: "combustivel" | "manutencao"; file: string; sheet: string; parse: (r: unknown[][]) => FleetExpenseRow[]; optional?: boolean }[] = [
    { source: "manutencao", file: MAINTENANCE_FILE, sheet: "ROMILDO", parse: parseMaintenance },
    { source: "combustivel", file: fuelFile(year), sheet: "CONTROLE", parse: parseFuel },
    { source: "combustivel", file: fuelFile(year - 1), sheet: "CONTROLE", parse: parseFuel, optional: true },
  ];
  const results: { file: string; rows?: number; error?: string }[] = [];
  for (const j of jobs) {
    try {
      results.push({ file: j.file, rows: await replace(j.source, j.file, j.parse(await sheetRows(j.file, j.sheet, c))) });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (j.optional && /não encontrad/i.test(msg)) continue;
      console.error(`Manutenção: falha ao ler ${j.file}`, err);
      results.push({ file: j.file, error: msg });
    }
  }
  return results;
}
