import * as XLSX from "xlsx";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { DRIVE, graph } from "./industry-sync.server";
import {
  MARS_CLIENT, MARS_CONTRACT_ORDER, MARS_CONTRACT_VALUE, MARS_MANAGER, contractMeasured, marsFile, marsSheetName, matchWork,
  parseMarsSheet, prevMonth, rowsToSync, splitContract, type MarsOrder, type MarsRow, type MarsWork,
} from "./mars-sync";

type Credentials = { lovableKey: string; excelKey: string };
const enc = (p: string) => p.split("/").map(encodeURIComponent).join("/");
const today = () => new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);
const curMonth = () => today().slice(0, 7);
const EMPTY_BUDGET = { mo: 0, materiais: 0, ferramentas: 0, andaimes: 0, transporte: 0, bdi: 1 };

/**
 * Lê a aba do mês da planilha da MARS e cria/atualiza os serviços (lib/mars-sync.ts tem as regras).
 * 1ª leitura (tabela de controle vazia): também a tabela de faturamento; depois só a de ordens de serviço.
 */
export async function executeMarsSync(c: Credentials, kind: string, month?: string) {
  const ym = month ?? curMonth();
  // Leitura antiga parada em "running" (servidor interrompido): fecha como erro para não confundir.
  await supabaseAdmin.from("billing_sync_runs").update({ status: "error", finished_at: new Date().toISOString(), errors: 1, error_message: "Leitura interrompida antes de terminar" })
    .eq("category", "mars").eq("status", "running").lt("started_at", new Date(Date.now() - 10 * 60_000).toISOString());
  const file = marsFile(ym);
  const { data: run, error: re } = await supabaseAdmin.from("billing_sync_runs")
    .insert({ category: "mars", source: "ordens", ref_month: ym, file_path: file, trigger_kind: kind, status: "running" }).select("id").single();
  if (re) throw re;
  const finish = (patch: Record<string, unknown>) => supabaseAdmin.from("billing_sync_runs").update({ finished_at: new Date().toISOString(), ...patch }).eq("id", run.id);
  try {
    let buf: ArrayBuffer;
    try { buf = await graph(`${DRIVE}/root:/${enc(file)}:/content`, c, true); }
    catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await finish({ status: "access_error", errors: 1, error_message: `${file}: ${msg}` });
      return { status: "access_error", message: msg };
    }
    const wb = XLSX.read(new Uint8Array(buf), { cellDates: false });
    // Começo do mês sem a aba nova: usa a do mês anterior.
    let sheetYm = ym;
    let sheet = wb.Sheets[marsSheetName(ym)];
    if (!sheet && !month) { sheetYm = prevMonth(ym); sheet = wb.Sheets[marsSheetName(sheetYm)]; }
    if (!sheet) {
      await finish({ status: "waiting", error_message: `Aguardando a aba "${marsSheetName(ym)}" em ${file}` });
      return { status: "waiting" };
    }
    const parsed = parseMarsSheet(XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: "" }));
    const res = await applyMars(parsed, sheetYm);
    await finish({ status: "completed", ref_month: sheetYm, analyzed: parsed.length, inserted: res.created, updated: res.updated, ignored: res.ignored, error_message: res.message || null });
    return { status: "completed", ...res };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await finish({ status: "error", errors: 1, error_message: msg });
    return { status: "error", message: msg };
  }
}

async function applyMars(parsed: MarsRow[], ym: string) {
  const { data: client, error: ce } = await supabaseAdmin.from("clients").select("id").eq("name", MARS_CLIENT).maybeSingle();
  if (ce) throw ce;
  if (!client) throw new Error(`Cliente ${MARS_CLIENT} não encontrado`);
  const { data: mgr } = await supabaseAdmin.from("collaborators").select("id").eq("full_name", MARS_MANAGER).maybeSingle();
  const { data: worksData, error: we } = await supabaseAdmin.from("works").select("id, name, quote_number, orders, active, order_number, order_value").eq("client_id", client.id);
  if (we) throw we;
  const works = (worksData ?? []) as (MarsWork & { order_number: string | null; order_value: number | null })[];
  const { data: mapped, error: me } = await supabaseAdmin.from("mars_sync_items").select("*");
  if (me) throw me;
  const byKey = new Map((mapped ?? []).map((m) => [m.key, m]));
  // 1ª leitura = nenhuma leitura concluída ainda (também a tabela de faturamento).
  const { count: doneRuns } = await supabaseAdmin.from("billing_sync_runs").select("id", { count: "exact", head: true }).eq("category", "mars").eq("status", "completed");
  const firstRun = !doneRuns;
  const date = ym === curMonth() ? today() : `${ym}-01`;
  let created = 0; let updated = 0; const notes: string[] = [];
  const items = rowsToSync(parsed, firstRun);
  const ignored = parsed.filter((r) => !r.contract).length - items.length;

  // Tudo é juntado na memória e gravado em lote no fim (uma linha por vez estourava o tempo do servidor).
  const changedOrders = new Map<string, MarsWork>();
  const saveOrders = async (w: MarsWork, orders: MarsOrder[]) => { w.orders = orders; changedOrders.set(w.id, w); };
  const itemRows: Record<string, unknown>[] = [];
  const upsertItem = async (row: Record<string, unknown>) => { itemRows.push(row); };
  const newWorks: Record<string, unknown>[] = [];
  const base = (r: MarsRow) => ({
    ref_month: ym, source: r.table, quote: r.quote || null, order_number: r.order, description: r.description, value: r.value,
    requester: r.requester || null, category: r.category || null, sheet_status: r.status || null, notes: r.notes || null,
    updated_at: new Date().toISOString(),
  });

  for (const r of items) {
    const m = byKey.get(r.key);
    if (m) {
      // Serviço criado pela leitura: o pedido que chegou depois ("SEM" → número) ou o valor novo troca a linha que a leitura gravou.
      const w = m.work_id ? works.find((x) => x.id === m.work_id) : undefined;
      if (m.action === "created" && w && ((r.order ?? null) !== (m.synced_order ?? null) || r.value !== Number(m.synced_value ?? 0))) {
        const orders = (w.orders ?? []).slice();
        const i = orders.findIndex((o) => String(o.number ?? "") === (m.synced_order ?? "") && Number(o.value ?? 0) === Number(m.synced_value ?? 0));
        if (i >= 0) {
          orders[i] = { ...orders[i], number: r.order ?? "", value: r.value };
          await saveOrders(w, orders);
          updated++;
          await upsertItem({ key: r.key, ...base(r), action: "created", work_id: w.id, synced_order: r.order, synced_value: r.value });
          continue;
        }
      }
      await upsertItem({ key: r.key, ...base(r), action: m.action, work_id: m.work_id, synced_order: m.synced_order, synced_value: m.synced_value });
      continue;
    }
    const hit = matchWork(r, works);
    if (hit) {
      // Já existe: só acrescenta o pedido se o serviço ainda não o tem (ex.: medição mensal do Inbound).
      if (r.order && !(hit.orders ?? []).some((o) => String(o.number ?? "") === r.order)) {
        await saveOrders(hit, [...(hit.orders ?? []), { number: r.order, value: r.value, date }]);
        updated++;
      }
      await upsertItem({ key: r.key, ...base(r), action: "existing", work_id: hit.id, synced_order: r.order, synced_value: r.value });
      continue;
    }
    const id = crypto.randomUUID();
    const orders = [{ number: r.order ?? "", value: r.value, date }];
    newWorks.push({
      id, client_id: client.id, name: r.description.slice(0, 200), quote_number: r.quote || null, order_number: r.order, order_value: r.value,
      orders, budget_items: EMPTY_BUDGET, status: "active", active: true, monthly_enabled: false,
      manager_id: mgr?.id ?? null, supervisor_id: null,
      notes: [`MARS: ${r.requester}`, r.category].filter(Boolean).join(" · ") || null,
    });
    // Entra na lista para casar repetições na mesma leitura (mesmo pedido em outro orçamento continua sendo serviço próprio).
    works.push({ id, name: r.description, quote_number: r.quote || null, orders: [], order_number: r.order, order_value: r.value });
    await upsertItem({ key: r.key, ...base(r), action: "created", work_id: id, synced_order: r.order, synced_value: r.value });
    created++;
  }

  // Medição do contrato (só a tabela de ordens): novas linhas nos serviços do contrato. Cada medição tem pedido novo
  // (na planilha vem "Medição"): usa o pedido do faturamento da MARS no mês com o valor do contrato; sem ele, um
  // provisório "MEDIÇÃO <mês>", trocado nas leituras seguintes quando o faturamento chegar.
  const contract = parsed.find((r) => r.table === "ordens" && r.contract);
  const ckey = `C:${ym}`;
  if (contract) {
    const total = contract.value > 0 ? contract.value : MARS_CONTRACT_VALUE;
    const used = new Set(works.flatMap((w) => (w.orders ?? []).map((o) => String(o.number ?? ""))));
    const placeholder = `MEDIÇÃO ${ym}`;
    const { data: noteRows } = await supabaseAdmin.from("billing_sync_notes").select("order_number, amount, issued_at")
      .ilike("client_name", "%MARS%").eq("cancelled", false).gte("issued_at", `${ym}-01`).lte("issued_at", `${ym}-31`)
      .gte("amount", total - 1).lte("amount", total + 1).not("order_number", "is", null);
    const realOrder = (noteRows ?? []).map((n) => String(n.order_number ?? "").trim()).find((o) => /^\d{6,}$/.test(o) && (!used.has(o) || byKey.get(ckey)?.synced_order === o));
    const m = byKey.get(ckey);
    if (!m) {
      // Contrato já medido no mês à mão (linhas do pedido do contrato com data no mês): só registra.
      if (contractMeasured(works, ym)) {
        await upsertItem({ key: ckey, ...base(contract), action: "contract", work_id: null, synced_order: MARS_CONTRACT_ORDER, synced_value: total });
      } else {
        const split = splitContract(works, ym, total);
        if (!split.length) notes.push("Medição do contrato sem serviços com o pedido do contrato no mês anterior");
        const number = realOrder ?? placeholder;
        for (const s of split) {
          const w = works.find((x) => x.id === s.id)!;
          await saveOrders(w, [...(w.orders ?? []), { number, value: s.value, date }]);
          updated++;
        }
        if (split.length) await upsertItem({ key: ckey, ...base(contract), action: "contract", work_id: null, synced_order: number, synced_value: total });
      }
    } else if (m.synced_order === placeholder && realOrder) {
      for (const w of works.filter((x) => (x.orders ?? []).some((o) => String(o.number ?? "") === placeholder))) {
        await saveOrders(w, (w.orders ?? []).map((o) => (String(o.number ?? "") === placeholder ? { ...o, number: realOrder } : o)));
        updated++;
      }
      await upsertItem({ key: ckey, ...base(contract), action: "contract", work_id: null, synced_order: realOrder, synced_value: m.synced_value });
    }
  }
  if (newWorks.length) {
    const { error } = await supabaseAdmin.from("works").insert(newWorks as never);
    if (error) throw error;
    const { error: pe } = await supabaseAdmin.from("work_progress")
      .upsert(newWorks.map((w) => ({ work_id: w["id"] as string, month: date, percent: 100 })), { onConflict: "work_id,month" });
    if (pe) throw pe;
  }
  await Promise.all([...changedOrders.values()].filter((w) => !newWorks.some((n) => n["id"] === w.id)).map(async (w) => {
    const orders = w.orders ?? [];
    const nums = [...new Set(orders.map((o) => String(o.number ?? "")).filter(Boolean))];
    const { error } = await supabaseAdmin.from("works").update({
      orders: orders as never, order_number: nums.join(" / ") || null, order_value: orders.reduce((a, o) => a + Number(o.value ?? 0), 0),
    }).eq("id", w.id);
    if (error) throw error;
  }));
  if (itemRows.length) {
    const { error } = await supabaseAdmin.from("mars_sync_items").upsert(itemRows as never, { onConflict: "key" });
    if (error) throw error;
  }
  return { created, updated, ignored, firstRun, message: notes.join(" · ") };
}
