import { parseBillingRows } from "./billing-sync";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
type Credentials = { lovableKey: string; excelKey: string };
const DRIVE = "/drives/b!5V4Lk-rJCUCH4KwrKzBCgQtORfWyeVZNr7N5qacwdyb7xsyD9fxASIPz40EKW7xL";
const FOLDER = "01FSZSL2Z6G3GHBF3CLNBLV7FKL4CE5HP2"; // Serviços/FATURAMENTO - SERVIÇOS
const SHEET = "CONTROLE DE FATURAMENTOS";
async function readExcel(path: string, credentials: Credentials): Promise<any> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await fetch(`https://connector-gateway.lovable.dev/microsoft_excel${path}`, { headers: { Authorization: `Bearer ${credentials.lovableKey}`, "X-Connection-Api-Key": credentials.excelKey }, signal: AbortSignal.timeout(9000) });
    if (response.ok) return response.json();
    const body = await response.text();
    console.error(`Excel [${response.status}]: ${body}`);
    if ([429,503,504].includes(response.status) && attempt < 2) {
      const delay = Math.min(3000, Number(response.headers.get("Retry-After") ?? attempt + 1) * 1000);
      await new Promise(resolve => setTimeout(resolve, delay)); continue;
    }
    throw new Error(`Excel indisponível (${response.status}). A execução será tentada novamente. ${body.slice(0, 500)}`);
  }
  throw new Error("Não foi possível consultar o Excel");
}
/** Finds "VENDAS SERVIÇOS <ano>.xlsx"; in the first 7 days of a new year falls back to the previous year's file. */
async function resolveWorkbook(credentials: Credentials) {
  const now = new Date(); const year = now.getUTCFullYear();
  const list = await readExcel(`${DRIVE}/items/${FOLDER}/children?$select=id,name&$top=200`, credentials);
  const find = (y: number) => (list.value as { id: string; name: string }[]).find(i => new RegExp(`^VENDAS SERVI[ÇC]OS\\s*${y}\\s*\\.xlsx$`, "i").test(i.name.trim()));
  const cur = find(year);
  if (cur) return { id: cur.id, name: cur.name.trim(), waiting: false };
  const dayOfYear = (now.getTime() - Date.UTC(year, 0, 1)) / 86400000;
  const prev = find(year - 1);
  if (prev && dayOfYear < 7) return { id: prev.id, name: prev.name.trim(), waiting: true };
  throw new Error(`Planilha VENDAS SERVIÇOS ${year} não encontrada na pasta FATURAMENTO - SERVIÇOS`);
}
export async function executeBillingSync(credentials: Credentials, kind: string) {
  const { data: runId, error: startError } = await supabaseAdmin.rpc("billing_sync_start", { p_kind: kind });
  if (startError) throw startError;
  if (!runId) return { status: "running", message: "Já existe uma sincronização em andamento" };
  try {
    const wbInfo = await resolveWorkbook(credentials);
    await supabaseAdmin.from("billing_sync_runs").update({ file_path: wbInfo.name, ref_month: String(new Date().getUTCFullYear()) }).eq("id", runId);
    const workbook = `${DRIVE}/items/${wbInfo.id}/workbook/worksheets/${SHEET}`;
    const bounds = await readExcel(`${workbook}/usedRange(valuesOnly=true)?$select=rowCount,columnCount`, credentials);
    const rows: unknown[][] = [];
    const count = Number(bounds.rowCount);
    if (!Number.isInteger(count) || count < 1 || count > 100000) throw new Error("Tamanho da planilha inválido");
    for (let start = 1; start <= count; start += 1000) {
      const page = await readExcel(`${workbook}/range(address='A${start}:AF${Math.min(start + 999, count)}')?$select=values`, credentials);
      if (!Array.isArray(page.values)) throw new Error("Valores da planilha indisponíveis");
      rows.push(...page.values);
    }
    const parsed = parseBillingRows(rows);
    const { data, error } = await supabaseAdmin.rpc("billing_sync_import_external", { p_run: runId, p_notes: JSON.parse(JSON.stringify(parsed.notes)) });
    if (error) throw error;
    if (parsed.invalid) {
      await supabaseAdmin.from("billing_sync_history").insert({ run_id: runId, action: "invalid_dates", snapshot: { invalid: parsed.invalid, reason: "Linhas sem data de emissão válida não foram importadas" } });
    }
    if (wbInfo.waiting) await supabaseAdmin.from("billing_sync_runs").update({ error_message: `Planilha do novo ano ainda não criada; usando ${wbInfo.name}` }).eq("id", runId);
    return { status: "completed", runId, stats: data, ignored: parsed.ignored, invalid: parsed.invalid };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await supabaseAdmin.from("billing_sync_runs").update({ status: "error", finished_at: new Date().toISOString(), errors: 1, error_message: message }).eq("id", runId);
    throw error;
  }
}
