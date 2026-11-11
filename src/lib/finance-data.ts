import { supabase } from "@/integrations/supabase/client";
import { activeFinancialEntries } from "./billing-sync";
import { marginPercent } from "./result-labor";
import { buildBase, fetchAll, progressUntil, sliceResultRaw, totalMargin, type loadResultShared } from "./results-engine";

/**
 * Carregamento do Fechamento Financeiro em lote.
 * Antes: ~17 consultas por cliente (loadWorkData), centenas por tela.
 * Agora: cada tabela é lida uma vez para todos os clientes do período e o
 * "raw" de cada cliente é montado em memória, no mesmo formato de loadWorkData.
 * Por quê: mesmos totais, poucas idas ao banco.
 */
export const FIN_TAX = 0.185; // imposto do relatório Financeiro

type Shared = Awaited<ReturnType<typeof loadResultShared>>;
export type FinanceBatch = { key: string; work: any; ids: string[] };

const CHUNK = 50;
const chunks = <T,>(xs: T[], n = CHUNK) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));
const groupBy = <T,>(rows: T[], key: (r: T) => string | null | undefined) => {
  const out = new Map<string, T[]>();
  for (const r of rows) { const k = key(r); if (k == null) continue; const list = out.get(k); if (list) list.push(r); else out.set(k, [r]); }
  return out;
};
const pick = <T,>(by: Map<string, T[]>, ids: Iterable<string>) => { const out: T[] = []; for (const id of ids) out.push(...(by.get(id) ?? [])); return out; };
/** Lê linhas de várias obras em paralelo (lotes de ids), cada lote paginado e ordenado por id. */
async function byWorks<T>(ids: string[], build: (ids: string[], a: number, b: number) => PromiseLike<{ data: T[] | null; error: unknown }>) {
  const parts = await Promise.all(chunks(ids).map((part) => fetchAll<T>((a, b) => build(part, a, b))));
  return parts.flat();
}
const must = <T,>(r: { data: T | null; error: unknown }) => { if (r.error) throw r.error; return r.data; };

/** Serviços com movimento no período (lançamentos, RDOs ou escala). */
export async function loadFinanceActive(start: string, end: string) {
  const out = new Set<string>();
  const [ent, rdo, sch] = await Promise.all([
    fetchAll<any>((a, b) =>
      supabase.from("work_entries").select("work_id").eq("sync_cancelled", false)
        .or(`and(entry_date.gte.${start},entry_date.lte.${end}),and(competence_month.gte.${start.slice(0, 7)},competence_month.lte.${end.slice(0, 7)})`)
        .order("id").range(a, b),
    ),
    fetchAll<any>((a, b) => supabase.from("rdos").select("work_id").gte("report_date", start).lte("report_date", end).order("id").range(a, b)),
    fetchAll<any>((a, b) => supabase.from("daily_schedules").select("id").gte("schedule_date", start).lte("schedule_date", end).order("id").range(a, b)),
  ]);
  ent.forEach((r) => out.add(r.work_id));
  rdo.forEach((r) => out.add(r.work_id));
  // Lotes de escala em paralelo (antes eram sequenciais)
  const allocs = await Promise.all(chunks(sch.map((s) => s.id), 200).map((ids) =>
    fetchAll<any>((a, b) => supabase.from("daily_allocations").select("work_id").in("schedule_id", ids).order("id").range(a, b))));
  for (const rows of allocs) rows.forEach((r) => out.add(r.work_id));
  return out;
}

/** Qualquer serviço (inclusive concluído/inativo) com movimento ou pedido datado no período. */
export function financeList(works: any[], active: Set<string> | undefined, start: string, end: string) {
  return works.filter((w: any) =>
    active?.has(w.id) ||
    (Array.isArray(w.orders) && w.orders.some((o: any) => o?.date && String(o.date).slice(0, 10) >= start && String(o.date).slice(0, 10) <= end)),
  );
}

export function financeBatches(list: any[]): FinanceBatch[] {
  return [...new Set(list.map((w: any) => w.client_id ?? w.id))].map((key) => {
    const selected = list.filter((w: any) => (w.client_id ?? w.id) === key);
    return { key, work: selected[0], ids: selected.map((w: any) => w.id) };
  });
}

/** Equivalente em lote de loadWorkData(batch.work, batch.ids, false, shared) para todos os lotes. */
export async function loadFinanceRaws(batches: FinanceBatch[], shared: Shared): Promise<Map<string, any>> {
  const out = new Map<string, any>();
  if (!batches.length) return out;
  const allIds = [...new Set(batches.flatMap((b) => b.ids))];
  const clientIds = [...new Set(batches.map((b) => b.work.client_id).filter(Boolean))] as string[];
  // Recorrências precisam existir antes de ler os lançamentos; rodam junto com serviços/clientes.
  const [generated, siblingRows, clientRows] = await Promise.all([
    supabase.rpc("generate_recurring_entries", { _work_ids: allIds }),
    clientIds.length ? supabase.from("works").select("id, client_id, monthly_enabled, night_shift").in("client_id", clientIds) : Promise.resolve({ data: [], error: null }),
    clientIds.length ? supabase.from("clients").select("id, name, has_toll, toll_amount, city, distance_km, needs_transport_voucher").in("id", clientIds) : Promise.resolve({ data: [], error: null }),
  ]);
  if (generated.error) throw generated.error;
  const siblingsByClient = groupBy((must(siblingRows as any) ?? []) as any[], (r) => r.client_id);
  const clientById = new Map(((must(clientRows as any) ?? []) as any[]).map((c) => [c.id, c]));
  const sibIdsOf = (b: FinanceBatch) => (b.work.client_id ? (siblingsByClient.get(b.work.client_id) ?? []).map((x: any) => x.id as string) : []);
  // Serviços de todos os clientes envolvidos (selecionados + irmãos)
  const scope = [...new Set([...allIds, ...batches.flatMap(sibIdsOf)])];
  const clientNames = [...new Set(clientIds.map((id) => clientById.get(id)?.name).filter(Boolean))] as string[];

  const [allocs, rdoWf, progress, entries, vs, workVt, workTravel, integAppts, integBoxes, rdos, support] = await Promise.all([
    byWorks<any>(scope, (ids, a, b) => supabase.from("daily_allocations").select("id, work_id, collaborator_id, schedule_id, driver, vt_override, travel_bonus_override, daily_schedules(schedule_date)").in("work_id", ids).order("id").range(a, b)),
    byWorks<any>(scope, (ids, a, b) => supabase.from("rdo_workforce").select("id, work_id, collaborator_id, report_date, present, worked_hours, entry_time, exit_time, break_minutes, position_id, collaborators(position_id), rdos(shift)").in("work_id", ids).order("id").range(a, b)),
    supabase.from("work_progress").select("*").in("work_id", allIds).order("month"),
    byWorks<any>(allIds, (ids, a, b) => supabase.from("work_entries").select("*").eq("sync_cancelled", false).in("work_id", ids).order("entry_date", { ascending: false }).order("id").range(a, b)),
    clientIds.length
      ? fetchAll<any>((a, b) => supabase.from("vehicle_schedules").select("id, schedule_date, km, trips, client_id, work_id, driver_id, driver_bonus, is_suzano_local, vehicles(km_rate, plate, assign_by_work), collaborators(full_name)").or(`client_id.in.(${clientIds.join(",")}),is_suzano_local.eq.true`).order("id").range(a, b))
      : Promise.resolve([] as any[]),
    byWorks<any>(scope, (ids, a, b) => supabase.from("schedule_work_vt").select("schedule_id, work_id, pays_vt").in("work_id", ids).order("schedule_id").order("work_id").range(a, b)),
    byWorks<any>(scope, (ids, a, b) => supabase.from("schedule_work_travel").select("schedule_id, work_id, pays_bonus").in("work_id", ids).order("schedule_id").order("work_id").range(a, b)),
    clientIds.length
      ? fetchAll<any>((a, b) => supabase.from("appointments").select("id, client_id, collaborator_id, scheduled_date, completed_date, status, pays_transport_voucher").eq("type", "integracao").in("client_id", clientIds).order("id").range(a, b))
      : Promise.resolve([] as any[]),
    clientNames.length
      ? fetchAll<any>((a, b) => supabase.from("daily_status_entries").select("id, box_key, collaborator_id, daily_schedules(schedule_date)").in("box_key", clientNames.map((n) => `integracao:${n}`)).order("id").range(a, b))
      : Promise.resolve([] as any[]),
    byWorks<any>(scope, (ids, a, b) => supabase.from("rdos").select("id, work_id, report_date").in("work_id", ids).order("id").range(a, b)),
    clientIds.length ? supabase.from("result_support_allocations").select("client_id, collaborator_id").in("client_id", clientIds) : Promise.resolve({ data: [], error: null }),
  ]);
  for (const r of [progress, support] as any[]) if (r.error) throw r.error;

  // Remove colunas auxiliares (id/client_id/box_key) para manter o formato de loadWorkData
  const strip = <T extends Record<string, any>>(rows: T[], keys: string[]) => rows.map((r) => { const o: any = { ...r }; for (const k of keys) delete o[k]; return o; });
  const allocBy = groupBy(strip(allocs, ["id"]), (r) => r.work_id);
  const rdoWfBy = groupBy(strip(rdoWf, ["id"]), (r) => r.work_id);
  const sibRdoBy = groupBy(strip(rdoWf, ["id", "position_id", "collaborators"]), (r) => r.work_id);
  const progressBy = groupBy(((progress as any).data ?? []) as any[], (r) => r.work_id);
  const entriesBy = groupBy(entries, (r) => r.work_id);
  const vtBy = groupBy(workVt, (r) => r.work_id);
  const travelBy = groupBy(workTravel, (r) => r.work_id);
  const apptBy = groupBy(strip(integAppts, ["id"]), (r) => (r as any).client_id);
  const boxBy = groupBy(integBoxes, (r) => r.box_key);
  const rdosBy = groupBy(strip(rdos, ["id"]), (r) => r.work_id);
  const supportBy = groupBy(((support as any).data ?? []) as any[], (r) => r.client_id);

  for (const batch of batches) {
    const w = batch.work, workIds = batch.ids;
    const siblings = w.client_id ? (siblingsByClient.get(w.client_id) ?? []) : [];
    const sibIds: string[] = siblings.map((x: any) => x.id);
    const near = [...new Set([...workIds, ...sibIds])];
    const nearSet = new Set(near);
    const client = w.client_id ? (clientById.get(w.client_id) ?? null) : null;
    const clientOut = client ? (({ id: _id, ...rest }: any) => rest)(client) : null;
    // Mesmo conjunto que .or(client_id.eq.X, is_suzano_local.eq.true), sem duplicar linhas
    const vsRows = w.client_id ? strip(vs.filter((v) => v.client_id === w.client_id || v.is_suzano_local === true), ["id"]) : [];
    const raw = {
      clientRdos: pick(rdosBy, near),
      otherClientRdos: shared.allRdoWorkforce.filter((r: any) => !nearSet.has(r.work_id)),
      supportIds: w.client_id ? (supportBy.get(w.client_id) ?? []).map((r: any) => r.collaborator_id) : [],
      allocs: pick(allocBy, workIds),
      sibAllocs: sibIds.length ? pick(allocBy, sibIds) : [],
      sibRdo: sibIds.length ? pick(sibRdoBy, sibIds) : [],
      integAppts: w.client_id ? strip(apptBy.get(w.client_id) ?? [], ["client_id"]) : [],
      integBoxes: client?.name ? strip(boxBy.get(`integracao:${client.name}`) ?? [], ["id", "box_key"]) : [],
      rdoWf: pick(rdoWfBy, workIds),
      progress: pick(progressBy, workIds).sort((a: any, b: any) => (a.month < b.month ? -1 : a.month > b.month ? 1 : 0)),
      entries: activeFinancialEntries(pick(entriesBy, workIds).sort((a: any, b: any) => (a.entry_date === b.entry_date ? (a.id < b.id ? -1 : 1) : a.entry_date < b.entry_date ? 1 : -1))).map((e: any) =>
        e.category === "faturamento" && e.competence_month && e.competence_month !== String(e.entry_date).slice(0, 7)
          ? { ...e, doc_date: e.entry_date, entry_date: `${e.competence_month}-01` }
          : e,
      ),
      people: shared.people,
      monthlyIds: siblings.filter((x: any) => x.monthly_enabled).map((x: any) => x.id as string),
      nightIds: siblings.filter((x: any) => x.night_shift).map((x: any) => x.id as string),
      siblingCount: Math.max(1, siblings.length || 1),
      vs: vsRows,
      client: clientOut,
      workVt: pick(vtBy, near),
      workTravelRows: pick(travelBy, near),
      clientWorkTravelRows: pick(travelBy, near),
      noVtRows: shared.noVtRows,
      leaves: shared.leaves,
      daysOff: shared.daysOff,
      vacations: shared.vacations,
      vtRules: shared.vtRules.data ?? [],
      dbRules: shared.dbRules.data ?? [],
      tbRules: shared.tbRules.data ?? [],
      cityDist: shared.cityDist.data ?? [],
    };
    for (const id of workIds) out.set(id, sliceResultRaw(raw, id));
  }
  return out;
}

export type FinanceLine = {
  work: any; billed: number; tax: number; mo: number; transport: number; materials: number;
  margin: number; progress: number; monthPct: number | null; total: { margin: number; pct: number | null }; full: any; raw: any;
};

/** Linhas do Fechamento por cliente (mesma regra que estava na página). */
export function buildFinanceGroups(list: any[], rawByWork: Map<string, any>, yms: string[], year: string, holidays: string[], allWorks: any[]) {
  const sel = new Set(yms);
  const by = new Map<string, { key: string; name: string; lines: FinanceLine[] }>();
  list.forEach((w: any) => {
    const raw = rawByWork.get(w.id);
    if (!raw) return;
    const full = buildBase(w, raw, "", "", { isAll: false, workIds: [w.id], holidays, allWorks });
    if (!full) return;
    let mo = 0, transport = 0, materials = 0, compBilled = 0, billed = 0;
    for (const r of full.rows) if (sel.has(r.ym)) { mo += r.labor; transport += r.transport; }
    for (const e of raw.entries as any[]) {
      const v = Number(e.amount);
      // Valor faturado exibido pelo mês do lançamento; margem pela competência
      if (e.category === "faturamento" && sel.has(String(e.doc_date ?? e.entry_date).slice(0, 7))) billed += v;
      if (!sel.has(e.entry_date.slice(0, 7))) continue;
      if (e.category === "faturamento") compBilled += v;
      else if (e.category === "mao_obra") mo += v;
      else if (e.category === "terceiros") transport += v;
      else if (["materiais", "ferramentas", "andaimes"].includes(e.category)) materials += v;
    }
    const tax = billed * FIN_TAX;
    const margin = compBilled * (1 - FIN_TAX) - mo - transport - materials;
    const hasOrder = (Array.isArray(w.orders) ? w.orders : []).some((o: any) => o?.date && sel.has(String(o.date).slice(0, 7)));
    if (!billed && !compBilled && !mo && !transport && !materials && !hasOrder) return;
    const lastYm = yms[yms.length - 1] ?? `${year}-12`;
    const progress = progressUntil(w, full, lastYm);
    const key = w.client_id ?? `n:${w.client ?? "Sem cliente"}`;
    const g = by.get(key) ?? { key, name: w.clients?.name ?? w.client ?? "Sem cliente", lines: [] as FinanceLine[] };
    const upto = buildBase(w, raw, "", lastYm, { isAll: false, workIds: [w.id], holidays, allWorks, accumulated: true }) ?? full;
    // Margem total usa todo o histórico até o último mês; margem do período permanece inalterada.
    const total = totalMargin(w, upto);
    g.lines.push({ work: w, billed, tax, mo, transport, materials, margin, progress, monthPct: marginPercent(margin, compBilled), total, full, raw });
    by.set(key, g);
  });
  return [...by.values()].sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}
