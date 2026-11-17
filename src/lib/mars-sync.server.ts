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
  const firstRun = !(mapped ?? []).some((m) => m.action !== "contract");
  const date = ym === curMonth() ? today() : `${ym}-01`;
  let created = 0; let updated = 0; const notes: string[] = [];
  const items = rowsToSync(parsed, firstRun);
  const ignored = parsed.filter((r) => !r.contract).length - items.length;

  const saveOrders = async (w: MarsWork, orders: MarsOrder[]) => {
    const nums = [...new Set(orders.map((o) => String(o.number ?? "")).filter(Boolean))];
    const { error } = await supabaseAdmin.from("works").update({
      orders: orders as never, order_number: nums.join(" / ") || null,
      order_value: orders.reduce((a, o) => a + Number(o.value ?? 0), 0),
    }).eq("id", w.id);
    if (error) throw error;
    w.orders = orders;
  };
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
    const orders = [{ number: r.order ?? "", value: r.value, date }];
    const { data: w, error } = await supabaseAdmin.from("works").insert({
      client_id: client.id, name: r.description.slice(0, 200), quote_number: r.quote || null, order_number: r.order, order_value: r.value,
      orders: orders as never, budget_items: EMPTY_BUDGET as never, status: "active", active: true, monthly_enabled: false,
      manager_id: mgr?.id ?? null, supervisor_id: null,
      notes: [`MARS: ${r.requester}`, r.category].filter(Boolean).join(" · ") || null,
    } as never).select("id, name, quote_number, orders, active").single();
    if (error) throw error;
    const nw = w as unknown as MarsWork;
    works.push({ ...nw, order_number: r.order, order_value: r.value });
    const { error: pe } = await supabaseAdmin.from("work_progress").upsert({ work_id: nw.id, month: date, percent: 100 }, { onConflict: "work_id,month" });
    if (pe) throw pe;
    await upsertItem({ key: r.key, ...base(r), action: "created", work_id: nw.id, synced_order: r.order, synced_value: r.value });
    created++;
  }

  // Medição do contrato (só a tabela de ordens): novas linhas do pedido do contrato nos serviços que já o têm.
  const contract = parsed.find((r) => r.table === "ordens" && r.contract);
  const ckey = `C:${ym}`;
  if (contract && !byKey.has(ckey)) {
    const total = contract.value > 0 ? contract.value : MARS_CONTRACT_VALUE;
    if (contractMeasured(works, ym)) {
      await upsertItem({ key: ckey, ...base(contract), action: "contract", work_id: null, synced_order: MARS_CONTRACT_ORDER, synced_value: total });
    } else {
      const split = splitContract(works, ym, total);
      if (!split.length) notes.push("Medição do contrato sem serviços com o pedido do contrato no mês anterior");
      for (const s of split) {
        const w = works.find((x) => x.id === s.id)!;
        await saveOrders(w, [...(w.orders ?? []), { number: MARS_CONTRACT_ORDER, value: s.value, date }]);
        updated++;
      }
      if (split.length) await upsertItem({ key: ckey, ...base(contract), action: "contract", work_id: null, synced_order: MARS_CONTRACT_ORDER, synced_value: total });
    }
  }
  return { created, updated, ignored, firstRun, message: notes.join(" · ") };
}

async function upsertItem(row: Record<string, unknown>) {
  const { error } = await supabaseAdmin.from("mars_sync_items").upsert(row as never, { onConflict: "key" });
  if (error) throw error;
}
