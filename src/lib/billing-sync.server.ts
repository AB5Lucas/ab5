import { parseBillingRows } from "./billing-sync";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
type Credentials = { lovableKey: string; excelKey: string };
const workbook = "/drives/b!5V4Lk-rJCUCH4KwrKzBCgQtORfWyeVZNr7N5qacwdyb7xsyD9fxASIPz40EKW7xL/items/01FSZSL22JQMSG3X7RNJDZNJ4ONM7K7OQV/workbook/worksheets/CONTROLE DE FATURAMENTOS";
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
export async function executeBillingSync(credentials: Credentials, kind: string) {
  const { data: runId, error: startError } = await supabaseAdmin.rpc("billing_sync_start", { p_kind: kind });
  if (startError) throw startError;
  if (!runId) return { status: "running", message: "Já existe uma sincronização em andamento" };
  try {
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
    const { data, error } = await supabaseAdmin.rpc("billing_sync_process", { p_run: runId, p_notes: JSON.parse(JSON.stringify(parsed.notes)) });
    if (error) throw error;
    if (parsed.invalid) {
      await supabaseAdmin.from("billing_sync_history").insert({ run_id: runId, action: "invalid_dates", snapshot: { invalid: parsed.invalid, reason: "Linhas sem data de emissão válida não foram importadas" } });
    }
    return { status: "completed", runId, stats: data, ignored: parsed.ignored, invalid: parsed.invalid };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await supabaseAdmin.from("billing_sync_runs").update({ status: "error", finished_at: new Date().toISOString(), errors: 1, error_message: message }).eq("id", runId);
    throw error;
  }
}