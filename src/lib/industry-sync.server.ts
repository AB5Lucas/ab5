import * as XLSX from "xlsx";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { dropServicesInvoices, invoiceFolderName, missingStatus, monthsToSync, ordersFileName, parseInvoices, parseOrders, parseWorksBillingRows, pickOrders, previousMonths, stripZeros, type IndustryOrder } from "./industry-sync";

type Credentials = { lovableKey: string; excelKey: string };
export const DRIVE = "/drives/b!5V4Lk-rJCUCH4KwrKzBCgQtORfWyeVZNr7N5qacwdyb7xsyD9fxASIPz40EKW7xL";
const GATEWAY = "https://connector-gateway.lovable.dev/microsoft_excel";

class MissingFile extends Error {}

export async function graph(path: string, c: Credentials, binary = false): Promise<any> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(`${GATEWAY}${path}`, { headers: { Authorization: `Bearer ${c.lovableKey}`, "X-Connection-Api-Key": c.excelKey }, signal: AbortSignal.timeout(20000) });
    if (res.ok) return binary ? res.arrayBuffer() : res.json();
    const body = await res.text();
    console.error(`Excel [${res.status}] ${path}: ${body.slice(0, 300)}`);
    if (res.status === 404) throw new MissingFile("Arquivo ou pasta não encontrado");
    if ([429, 503, 504].includes(res.status) && attempt < 2) { await new Promise(r => setTimeout(r, 1500 * (attempt + 1))); continue; }
    throw new Error(`Erro de acesso à fonte (${res.status}): ${body.slice(0, 300)}`);
  }
  throw new Error("Não foi possível acessar a fonte");
}
const enc = (p: string) => p.split("/").map(encodeURIComponent).join("/");

function sources(ym: string) {
  const y = ym.slice(0, 4);
  return {
    pedidos: `PCP/PROGRAMAÇÃO/${y}/${ordersFileName(ym)}`,
    faturamento: `Faturamento/13 RELATÓRIOS - FATURAMENTO POR VENDEDOR/${y}/${invoiceFolderName(ym)}/Fat. Por Vendedor.xls`,
  };
}

type OrdersCache = Map<string, IndustryOrder[]>;

/** Parsed orders of one month's PCP sheet; a missing sheet counts as no orders. Cached per execution. */
async function monthOrders(ym: string, c: Credentials, cache: OrdersCache): Promise<IndustryOrder[]> {
  const hit = cache.get(ym);
  if (hit) return hit;
  let orders: IndustryOrder[] = [];
  try {
    const buf = await graph(`${DRIVE}/root:/${enc(sources(ym).pedidos)}:/content`, c, true);
    const sheet = XLSX.read(new Uint8Array(buf), { cellDates: false }).Sheets["Dados"];
    if (sheet) orders = parseOrders(XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: "" })).orders;
  } catch (err) {
    if (!(err instanceof MissingFile)) console.error(`Busca retroativa: falha ao ler pedidos de ${ym}`, err);
  }
  cache.set(ym, orders);
  return orders;
}

/**
 * Invoices of `ym` whose order is not in the database: search the previous
 * ORDER_LOOKBACK_MONTHS order sheets and import only the matching orders.
 * Invoices stay pending only when no sheet has their order.
 */
async function findOrdersInPastMonths(ym: string, invoiceRun: string, kind: string, c: Credentials, cache: OrdersCache) {
  const { data: missing, error } = await supabaseAdmin.from("industry_invoices").select("order_number")
    .eq("ref_month", ym).is("order_id", null).is("reversed_at", null).not("order_number", "is", null);
  if (error) throw error;
  const wanted = new Set((missing ?? []).map(i => stripZeros(i.order_number)).filter(Boolean));
  if (!wanted.size) return;
  for (const past of previousMonths(ym)) {
    if (!wanted.size) break;
    const found = pickOrders(await monthOrders(past, c, cache), wanted);
    if (!found.length) continue;
    const file = sources(past).pedidos;
    const { data: run, error: re } = await supabaseAdmin.from("billing_sync_runs").insert({ category: "industria", source: "pedidos", ref_month: past, file_path: file, trigger_kind: kind, status: "running" }).select("id").single();
    if (re) throw re;
    const { error: ae } = await supabaseAdmin.rpc("industry_sync_apply", { p_run: run.id, p_source: "pedidos", p_month: past, p_file: file, p_rows: JSON.parse(JSON.stringify(found)) });
    if (ae) {
      await supabaseAdmin.from("billing_sync_runs").update({ status: "error", finished_at: new Date().toISOString(), errors: 1, error_message: ae.message }).eq("id", run.id);
      throw ae;
    }
    for (const o of found) { wanted.delete(o.order); o.aliases.forEach(a => wanted.delete(a)); }
  }
  // The invoice run counted its pending before the search: refresh it.
  const { count, error: ce } = await supabaseAdmin.from("industry_invoices").select("id", { count: "exact", head: true }).eq("ref_month", ym).eq("status", "pending");
  if (ce) throw ce;
  await supabaseAdmin.from("billing_sync_runs").update({ pending: count ?? 0, status: count ? "completed_pending" : "completed" }).eq("id", invoiceRun);
}

async function runOne(source: "pedidos" | "faturamento", ym: string, today: string, kind: string, c: Credentials, cache: OrdersCache) {
  const file = sources(ym)[source];
  const { data: run, error } = await supabaseAdmin.from("billing_sync_runs").insert({ category: "industria", source, ref_month: ym, file_path: file, trigger_kind: kind, status: "running" }).select("id").single();
  if (error) throw error;
  try {
    const buf = await graph(`${DRIVE}/root:/${enc(file)}:/content`, c, true);
    const wb = XLSX.read(new Uint8Array(buf), { cellDates: false });
    const firstSheet = wb.SheetNames[0];
    const sheet = source === "pedidos" ? (wb.Sheets["Dados"] ?? null) : firstSheet ? wb.Sheets[firstSheet] : null;
    if (!sheet) throw new Error("Aba 'Dados' não encontrada na planilha de pedidos");
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: "" });
    let payload: unknown[]; let ignored = 0;
    if (source === "pedidos") { const p = parseOrders(rows); payload = p.orders; ignored = p.ignored; }
    else {
      const inv = parseInvoices(rows);
      const { data: svc, error: se } = await supabaseAdmin.from("billing_sync_notes").select("invoice_number, issued_at").eq("cancelled", false).not("source_key", "like", "INDUSTRIA-OBRAS%").not("invoice_number", "is", null);
      if (se) throw se;
      payload = dropServicesInvoices(inv, (svc ?? []).map(n => ({ invoice: n.invoice_number, date: n.issued_at })));
      ignored = inv.length - payload.length;
    }
    const { data, error: e2 } = await supabaseAdmin.rpc("industry_sync_apply", { p_run: run.id, p_source: source, p_month: ym, p_file: file, p_rows: JSON.parse(JSON.stringify(payload)) });
    if (e2) throw e2;
    // The invoices are already saved; a failed search leaves them pending instead of failing the run.
    if (source === "faturamento") await findOrdersInPastMonths(ym, run.id, kind, c, cache).catch(err => console.error(`Busca retroativa de pedidos falhou (${ym})`, err));
    if (source === "faturamento") {
      const notes = parseWorksBillingRows(rows);
      if (notes.length) {
        const { data: servicesRun, error: runError } = await supabaseAdmin.from("billing_sync_runs").insert({ category: "servicos", source: "faturamento", ref_month: ym, file_path: file, trigger_kind: kind, status: "running" }).select("id").single();
        if (runError) throw runError;
        const { error: servicesError } = await supabaseAdmin.rpc("billing_sync_import_external", { p_run: servicesRun.id, p_notes: JSON.parse(JSON.stringify(notes)) });
        if (servicesError) {
          await supabaseAdmin.from("billing_sync_runs").update({ status: "error", finished_at: new Date().toISOString(), errors: 1, error_message: servicesError.message }).eq("id", servicesRun.id);
          throw servicesError;
        }
      }
    }
    await supabaseAdmin.rpc("billing_purge_cross_duplicates");
    await supabaseAdmin.from("billing_sync_runs").update({ ignored }).eq("id", run.id);
    return { source, ym, ...(data as object) };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const status = err instanceof MissingFile ? (missingStatus(ym, today) === "waiting" ? "waiting" : "access_error") : msg.startsWith("Erro de acesso") ? "access_error" : "error";
    await supabaseAdmin.from("billing_sync_runs").update({ status, finished_at: new Date().toISOString(), errors: status === "waiting" ? 0 : 1, error_message: status === "waiting" ? `Aguardando a planilha ${file}` : msg }).eq("id", run.id);
    return { source, ym, status, message: msg };
  }
}

/** Orders first so invoices can link. Each source is independent. */
export async function executeIndustrySync(c: Credentials, kind: string, months?: string[]) {
  const today = new Date().toISOString().slice(0, 10);
  const list = months ?? monthsToSync(today);
  const results = []; const cache: OrdersCache = new Map();
  for (const ym of list) for (const s of ["pedidos", "faturamento"] as const) results.push(await runOne(s, ym, today, kind, c, cache));
  return results;
}
