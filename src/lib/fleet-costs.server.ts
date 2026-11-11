import * as XLSX from "xlsx";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { DRIVE, graph } from "./industry-sync.server";
import { fuelFile, MAINTENANCE_FILE, parseFuel, parseMaintenance, type FleetExpenseRow } from "./fleet-costs";

type Credentials = { lovableKey: string; excelKey: string };
const enc = (p: string) => p.split("/").map(encodeURIComponent).join("/");

async function sheetRows(file: string, sheet: string, c: Credentials): Promise<unknown[][]> {
  const buf = await graph(`${DRIVE}/root:/${enc(file)}:/content`, c, true);
  const wb = XLSX.read(new Uint8Array(buf), { cellDates: false });
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
