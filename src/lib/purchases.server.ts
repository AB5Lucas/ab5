import * as XLSX from "xlsx";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { DRIVE, graph } from "./industry-sync.server";
import { STOCK_REASON, STOCK_WORK_NAME, allocatePurchase, isIndustryClient, parsePurchaseReportChecked, purchaseFileMonth, purchaseItemEntries, type CcItem, type PClient, type PWork } from "./purchases";
import { assetCategory, clientPurchaseExclusionReason, detectPurchaseAsset, effectivePurchaseCc, exclusionReason, installmentPlan, purchaseItemKeys, purchaseDecisionRequired, type AssetDecision, type ExclusionRule, type PurchaseItemState } from "./purchase-policy";
import { purchaseMonthHours } from "./purchase-hours";

type Credentials = { lovableKey: string; excelKey: string };
/**
 * Relatórios de Compras por centro de custo: Compras/04 COMPRAS/05 ANÁLISES E RELATÓRIOS/02 FECHAMENTOS/<ano>/<MM.ano>/
 * (o arquivo do mês fica na pasta do mês ou na subpasta Serviços; as outras subpastas — Indústria, Mars, Yara… — são
 * recortes por cliente e não são lidas, senão o mês teria dois relatórios). Antes era a pasta Compras/RELATÓRIOS.
 */
const FOLDER = "Compras/04 COMPRAS/05 ANÁLISES E RELATÓRIOS/02 FECHAMENTOS";
const MONTH_SUBFOLDER = "serviços";
/** Primeiro mês lido dos relatórios (o que veio antes ficou lançado à mão nos serviços; ler de novo duplicaria custos). */
const PURCHASE_START = "2026-10";
const enc = (p: string) => p.split("/").map(encodeURIComponent).join("/");

function monthRange(ym: string) {
  const [y, m] = ym.split("-").map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${ym}-01`, to: `${ym}-${String(last).padStart(2, "0")}` };
}

/** Resolve each person/day using the same attendance rules as Results. */
async function monthHours(ym: string) {
  const { from, to } = monthRange(ym);
  async function all<T>(query: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>) {
    const rows: T[] = [];
    for (let page = 0; ; page++) {
      const { data, error } = await query(page * 1000, page * 1000 + 999);
      if (error) throw error;
      rows.push(...(data ?? []));
      if (!data || data.length < 1000) return rows;
    }
  }
  const [works, rows, headers, allocations, supports, daysOff, vacations, leaves, noVtRows] = await Promise.all([
    all((a, b) => supabaseAdmin.from("works").select("id,client_id").order("id").range(a, b)),
    all((a, b) => supabaseAdmin.from("rdo_workforce").select("work_id,collaborator_id,report_date,present,worked_hours").gte("report_date", from).lte("report_date", to).order("id").range(a, b)),
    all((a, b) => supabaseAdmin.from("rdos").select("work_id,report_date").gte("report_date", from).lte("report_date", to).order("id").range(a, b)),
    all((a, b) => supabaseAdmin.from("daily_allocations").select("work_id,collaborator_id,daily_schedules!inner(schedule_date)").gte("daily_schedules.schedule_date", from).lte("daily_schedules.schedule_date", to).order("id").range(a, b)),
    all((a, b) => supabaseAdmin.from("result_support_allocations").select("client_id,collaborator_id").order("client_id").order("collaborator_id").range(a, b)),
    all((a, b) => supabaseAdmin.from("days_off").select("collaborator_id,date,end_date").lte("date", to).or(`end_date.gte.${from},and(end_date.is.null,date.gte.${from})`).order("id").range(a, b)),
    all((a, b) => supabaseAdmin.from("vacations").select("collaborator_id,start_date,end_date").lte("start_date", to).gte("end_date", from).order("id").range(a, b)),
    all((a, b) => supabaseAdmin.from("medical_leaves").select("collaborator_id,start_date,end_date").lte("start_date", to).gte("end_date", from).order("id").range(a, b)),
    all((a, b) => supabaseAdmin.from("daily_status_entries").select("collaborator_id,daily_schedules!inner(schedule_date)").in("box_key", ["folga", "ferias", "afastado", "falta", "atestado", "medico", "interjornada", "licenca", "abono"]).gte("daily_schedules.schedule_date", from).lte("daily_schedules.schedule_date", to).order("id").range(a, b)),
  ]);
  return purchaseMonthHours(works, allocations, rows, headers, supports, { daysOff, vacations, leaves, noVtRows });
}

async function loadRefs() {
  const [c, w, rules, redirects] = await Promise.all([
    supabaseAdmin.from("clients").select("id, name, cc_prefix, cc_alt_prefixes"),
    supabaseAdmin.from("works").select("id, client_id, cc_suffix, is_stock"),
    supabaseAdmin.from("purchase_exclusion_rules").select("*"),
    supabaseAdmin.from("purchase_cc_redirects").select("*"),
  ]);
  if (c.error) throw c.error;
  if (w.error) throw w.error;
  if (rules.error) throw rules.error;
  if (redirects.error) throw redirects.error;
  const clients: PClient[] = (c.data ?? []).map((x) => ({ id: x.id, prefix: x.cc_prefix, altPrefixes: ((x as { cc_alt_prefixes?: string[] | null }).cc_alt_prefixes ?? []) }));
  const works: PWork[] = (w.data ?? []).flatMap((x) => x.client_id ? [{ id: x.id, client_id: x.client_id, suffix: x.cc_suffix, stock: !!(x as { is_stock?: boolean }).is_stock }] : []);
  const industryClients = new Set((c.data ?? []).filter((x) => isIndustryClient(x.name)).map((x) => x.id));
  const industryWorkIds = new Set(works.filter((x) => industryClients.has(x.client_id)).map((x) => x.id));
  return { clients, works, clientNames: new Map((c.data ?? []).map((x) => [x.id, x.name])), industryWorkIds, rules: rules.data as ExclusionRule[], redirects: redirects.data };
}

/** Almoxarifado do cliente: serviço fictício (is_stock, inativo, fora da aba Serviços) que recebe as compras
 * do cliente enquanto nenhum serviço dele tem movimentação no mês. */
async function ensureStockWork(clientId: string, r: Awaited<ReturnType<typeof loadRefs>>) {
  if (r.works.some((w) => w.client_id === clientId && w.stock)) return;
  const { data: found } = await supabaseAdmin.from("works").select("id").eq("client_id", clientId).eq("is_stock" as never, true as never).limit(1).maybeSingle();
  let id = (found as { id: string } | null)?.id;
  if (!id) {
    const { data, error } = await supabaseAdmin.from("works").insert({ name: STOCK_WORK_NAME, client_id: clientId, active: false, is_stock: true } as never).select("id").single();
    if (error) throw error;
    id = (data as { id: string }).id;
  }
  r.works.push({ id, client_id: clientId, suffix: null, stock: true });
}

/** Apaga os Almoxarifados que ficaram sem nenhum custo (o custo foi realocado para um serviço do cliente). */
export async function cleanupStockWorks() {
  const { data: stocks, error } = await supabaseAdmin.from("works").select("id").eq("is_stock" as never, true as never);
  if (error) throw error;
  let removed = 0;
  for (const w of (stocks ?? []) as { id: string }[]) {
    const { count } = await supabaseAdmin.from("work_entries").select("id", { count: "exact", head: true }).eq("work_id", w.id);
    if (count) continue;
    const { error: de } = await supabaseAdmin.from("works").delete().eq("id", w.id);
    if (!de) removed++;
  }
  return removed;
}

/** Recalcula os lançamentos de uma linha (apaga e recria os gastos dela nos serviços). */
export async function applyLine(lineId: string, refs?: Awaited<ReturnType<typeof loadRefs>>, hoursCache?: Map<string, Map<string, number>>) {
  const { data: line, error } = await supabaseAdmin.from("purchase_cc_lines").select("*").eq("id", lineId).single();
  if (error) throw error;
  const r = refs ?? (await loadRefs());
  let hours = hoursCache?.get(line.ref_month);
  if (!hours) { hours = await monthHours(line.ref_month); hoursCache?.set(line.ref_month, hours); }
  const cc = effectivePurchaseCc(line.cc_code, r.redirects, !!(line.target_client_id || line.target_work_id));
  let direction = { client_id: line.target_client_id, work_id: line.target_work_id };
  let alloc = allocatePurchase(cc, Number(line.amount), r.clients, r.works, hours, direction);
  // Cliente sem serviço com movimentação: cria o Almoxarifado do cliente (serviço fictício) e lança nele.
  if (alloc.status === "pending" && alloc.reason === STOCK_REASON) {
    const clientId = direction.client_id ?? (r.clients.find((c) => c.prefix === cc.slice(0, 4)) ?? r.clients.find((c) => (c.altPrefixes ?? []).includes(cc.slice(0, 4))))?.id;
    if (clientId) {
      await ensureStockWork(clientId, r);
      alloc = allocatePurchase(cc, Number(line.amount), r.clients, r.works, hours, direction);
    }
  }
  // Ficaria pendente sem decisão própria: reaproveita a última decisão manual do mesmo centro de custo.
  if (alloc.status === "pending" && !line.target_client_id && !line.target_work_id) {
    const { data: prev } = await supabaseAdmin.from("purchase_cc_lines").select("target_client_id, target_work_id")
      .eq("cc_code", line.cc_code).neq("id", line.id).or("target_client_id.not.is.null,target_work_id.not.is.null")
      .order("ref_month", { ascending: false }).limit(1).maybeSingle();
    if (prev) {
      const again = allocatePurchase(cc, Number(line.amount), r.clients, r.works, hours, { client_id: prev.target_client_id, work_id: prev.target_work_id });
      if (again.status === "launched") {
        alloc = { ...again, reason: "Direcionado como na decisão anterior" };
        direction = { client_id: prev.target_client_id, work_id: prev.target_work_id };
        await supabaseAdmin.from("purchase_cc_lines").update({ target_client_id: prev.target_client_id, target_work_id: prev.target_work_id }).eq("id", line.id);
      }
    }
  }
  const { data: decisions, error: de } = await supabaseAdmin.from("purchase_asset_decisions").select("*").eq("purchase_cc_id", line.id);
  if (de) throw de;
  const items = line.items as CcItem[];
  const keys = purchaseItemKeys(items);
  const states: PurchaseItemState[] = [];
  const entries: (ReturnType<typeof purchaseItemEntries>[number] & { purchase_item_key: string; competence_month: string })[] = [];
  // Source cents must reconcile before classifying or splitting.
  const itemCents = items.map((item) => Math.round(item.amount * 100));
  const delta = Math.round(Number(line.amount) * 100) - itemCents.reduce((a, b) => a + b, 0);
  if (Math.abs(delta) > 1) throw new Error(`Total de itens divergente no CC ${line.cc_code}`);
  if (itemCents.length) itemCents[itemCents.length - 1] = (itemCents[itemCents.length - 1] ?? 0) + delta;
  async function cachedHours(ym: string) {
    const cached = hoursCache?.get(ym);
    if (cached) return cached;
    const h = await monthHours(ym);
    hoursCache?.set(ym, h);
    return h;
  }
  async function assetAllocation(ym: string, amount: number, dest = direction, destCc = cc) {
    let h = await cachedHours(ym);
    let a = allocatePurchase(destCc, amount, r.clients, r.works, h, dest);
    // Search the latest actual movement month for the relevant CC, not global hours.
    const [sy, sm] = ym.split("-").map(Number);
    for (let back = 1; back <= 120 && !a.parts.some((part) => (h.get(part.work_id) ?? 0) > 0); back++) {
      const prevMonth = new Date(Date.UTC(sy ?? 0, (sm ?? 1) - 1 - back, 1)).toISOString().slice(0, 7);
      h = await cachedHours(prevMonth);
      a = allocatePurchase(destCc, amount, r.clients, r.works, h, dest);
      if (dest.work_id) break;
    }
    return { allocation: a, hours: h };
  }
  for (const [index, original] of items.entries()) {
    const key = keys[index] ?? "";
    const item = { ...original, amount: (itemCents[index] ?? 0) / 100 };
    const decision = (decisions as AssetDecision[]).find((d) => d.item_key === key);
    const asset = decision ? decision.is_asset : !!detectPurchaseAsset(item);
    const needsDecision = purchaseDecisionRequired(item, decision);
    const controlled = asset || !!decision || needsDecision;
    const targetWork = decision?.target_work_id ?? direction.work_id;
    const targetClient = targetWork ? r.works.find((w) => w.id === targetWork)?.client_id : decision?.target_client_id ?? direction.client_id ?? r.clients.find((c) => c.prefix === cc.slice(0, 4))?.id;
    const reason = clientPurchaseExclusionReason(item.code, targetClient ? r.clientNames.get(targetClient) ?? "" : "") ?? (asset || decision ? null : exclusionReason(item.code, r.rules));
    const state: PurchaseItemState = { key, index, asset, status: "launched", reason: null, category: decision?.category ?? (asset ? assetCategory(item) : null), excluded: 0, pending: 0, launched: 0 };
    if (reason) { Object.assign(state, { status: "excluded", reason, excluded: item.amount }); }
    else if (needsDecision || decision?.mode === "pending") {
      Object.assign(state, { status: "pending", reason: decision ? "Decisão do usuário pendente ou valor alterado" : "EPI ≥ R$ 20.000: decisão necessária", pending: item.amount });
    } else {
      const plan = decision?.mode === "installments" ? installmentPlan(item.amount, line.ref_month, decision.months, decision.monthly_amount) : [{ month: line.ref_month, amount: item.amount }];
      const itemDirection = decision?.target_work_id || decision?.target_client_id ? { client_id: decision.target_client_id ?? null, work_id: decision.target_work_id ?? null } : direction;
      const itemCc = effectivePurchaseCc(line.cc_code, r.redirects, !!(itemDirection.client_id || itemDirection.work_id));
      const planned: typeof entries = [];
      let pendingReason: string | null = null;
      for (const [partIndex, part] of plan.entries()) {
        const resolved = controlled ? await assetAllocation(part.month, part.amount, itemDirection, itemCc) : { allocation: alloc, hours };
        if (!resolved.allocation.parts.length) { pendingReason = resolved.allocation.reason; break; }
        const portion: CcItem = { ...item, amount: part.amount, date: controlled ? null : item.date ?? null };
        const rows = purchaseItemEntries([portion], part.amount, resolved.allocation, resolved.hours, r.industryWorkIds, monthRange(part.month).from);
        planned.push(...rows.map((row) => ({ ...row, category: decision ? (decision.category === "transporte" ? "terceiros" : decision.category === "mo" ? "mao_obra" : decision.category) as typeof row.category : row.category, description: plan.length > 1 ? `${row.description} · Parcela ${partIndex + 1}/${plan.length}` : row.description, purchase_item_key: key, competence_month: part.month })));
      }
      if (pendingReason || !planned.length) Object.assign(state, { status: "pending", reason: pendingReason ?? "Sem destino", pending: item.amount });
      else { entries.push(...planned); state.launched = item.amount; }
    }
    states.push(state);
  }
  const sum = (field: "excluded" | "pending" | "launched") => states.reduce((a, s) => a + Math.round(s[field] * 100), 0) / 100;
  const pending = sum("pending");
  const status = pending !== 0 ? "pending" : "launched";
  // Summary and entries are replaced together; a rejected total preserves previous costs.
  const db: SupabaseClient = supabaseAdmin;
  const result = await db.rpc("purchase_apply_policy", { _line: line.id, _entries: entries, _summary: { excluded: sum("excluded"), pending, launched: sum("launched"), effective_cc: cc, states, status, reason: pending ? "Itens pendentes de decisão ou destino" : null } });
  if (result.error) throw result.error;
  return status;
}

export async function reprocessPurchases() {
  const refs = await loadRefs();
  const cache = new Map<string, Map<string, number>>();
  const { data, error } = await supabaseAdmin.from("purchase_cc_lines").select("id").order("ref_month");
  if (error) throw error;
  for (const line of data) await applyLine(line.id, refs, cache);
  await cleanupStockWorks();
  return { processed: data.length };
}

/** Lê todos os relatórios da pasta; para cada mês usa o arquivo com o período mais longo. */
export async function executePurchaseSync(c: Credentials, opts: { force?: boolean } = {}) {
  type Entry = { name: string; folder?: unknown; eTag?: string; size?: number };
  const children = async (path: string): Promise<Entry[]> => {
    try { return ((await graph(`${DRIVE}/root:/${enc(path)}:/children?$top=500`, c))?.value ?? []) as Entry[]; }
    catch (e) { if ((e as Error).name === "MissingFile" || /não encontrado/.test((e as Error).message)) return []; throw e; }
  };
  // Ano atual e o anterior (em janeiro o fechamento de dezembro ainda é lido).
  const year = new Date().getFullYear();
  const best = new Map<string, { path: string; name: string; end: string; etag: string | null; size: number | null }>();
  const consider = (dir: string, f: Entry) => {
    if (f.folder || !/\.xlsx?$/i.test(f.name)) return;
    const m = purchaseFileMonth(f.name);
    if (!m || m.ym < PURCHASE_START) return;
    const cur = best.get(m.ym);
    // Período mais longo; empate: .xls (o relatório original do sistema) antes do .xlsx.
    if (!cur || m.end > cur.end || (m.end === cur.end && /\.xls$/i.test(f.name) && !/\.xls$/i.test(cur.name))) best.set(m.ym, { path: `${dir}/${f.name}`, name: f.name, end: m.end, etag: f.eTag ?? null, size: f.size ?? null });
  };
  for (const y of [year - 1, year].filter((y) => y >= Number(PURCHASE_START.slice(0, 4)))) {
    for (const mf of await children(`${FOLDER}/${y}`)) {
      if (!mf.folder || !/^\d{2}\.\d{4}$/.test(mf.name.trim())) continue;
      const dir = `${FOLDER}/${y}/${mf.name}`;
      for (const f of await children(dir)) {
        if (f.folder && f.name.trim().toLowerCase() === MONTH_SUBFOLDER) for (const g of await children(`${dir}/${f.name}`)) consider(`${dir}/${f.name}`, g);
        else consider(dir, f);
      }
    }
  }
  const refs = await loadRefs();
  const hoursCache = new Map<string, Map<string, number>>();
  const out: { ym: string; file: string; launched: number; pending: number; skipped?: boolean; error?: string }[] = [];
  // Arquivo igual ao já lido (mesmo caminho e eTag/tamanho) não é lido de novo; o mês mais novo vem primeiro,
  // e o erro de um mês fica registrado em purchase_sync_files sem impedir os outros.
  const { data: seen } = await supabaseAdmin.from("purchase_sync_files" as never).select("ym, file_path, etag, size, ok");
  const prev = new Map(((seen ?? []) as { ym: string; file_path: string; etag: string | null; size: number | null; ok: boolean }[]).map((x) => [x.ym, x]));
  const log = async (ym: string, f: { path: string; etag: string | null; size: number | null }, ok: boolean, message: string | null) => {
    await supabaseAdmin.from("purchase_sync_files" as never).upsert({ ym, file_path: f.path, etag: f.etag, size: f.size, synced_at: new Date().toISOString(), ok, message } as never, { onConflict: "ym" });
  };
  for (const [ym, f] of [...best.entries()].sort().reverse()) {
    const p0 = prev.get(ym);
    if (!opts.force && p0?.ok && p0.file_path === f.path && ((f.etag && p0.etag === f.etag) || (!f.etag && f.size != null && p0.size === f.size))) {
      out.push({ ym, file: f.name, launched: 0, pending: 0, skipped: true });
      continue;
    }
    try {
    const file = f.path;
    const buf = await graph(`${DRIVE}/root:/${enc(file)}:/content`, c, true);
    const wb = XLSX.read(new Uint8Array(buf), { cellDates: true });
    const sheetName = wb.SheetNames[0];
    const sheet = sheetName ? wb.Sheets[sheetName] : undefined;
    if (!sheet) throw new Error(`Relatório vazio: ${file}`);
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: "" });
    // CC com total divergente fica de fora (sem lançar e sem apagar o que já havia); os demais entram.
    const { lines, issues } = parsePurchaseReportChecked(rows, { lenient: true });
    const { data: existing, error } = await supabaseAdmin.from("purchase_cc_lines").select("id, cc_code").eq("ref_month", ym);
    if (error) throw error;
    const keep = new Set([...lines.map((l) => l.cc), ...issues.map((i) => i.cc)]);
    const stale = (existing ?? []).filter((e) => !keep.has(e.cc_code)).map((e) => e.id);
    if (stale.length) { const d = await supabaseAdmin.from("purchase_cc_lines").delete().in("id", stale); if (d.error) throw d.error; }
    let launched = 0, pending = 0;
    for (const l of lines) {
      const { data: row, error: ue } = await supabaseAdmin.from("purchase_cc_lines")
        .upsert({ ref_month: ym, cc_code: l.cc, cc_name: l.name, amount: l.amount, items: l.items, file_path: file, synced_at: new Date().toISOString() }, { onConflict: "ref_month,cc_code" })
        .select("id").single();
      if (ue) throw ue;
      const st = await applyLine(row.id, refs, hoursCache);
      if (st === "launched") launched++; else pending++;
    }
    if (issues.length) {
      const shown = issues.slice(0, 3).map((i) => i.message).join("; ");
      const more = issues.length > 3 ? ` (e mais ${issues.length - 3})` : "";
      const msg = `ABCOM003: ${shown}${more}. O que não conferiu ficou sem lançar; os demais CCs (${lines.length}) foram importados.`;
      out.push({ ym, file: f.name, launched, pending, error: msg });
      await log(ym, f, false, msg);
      // Diagnóstico: começo do arquivo e as linhas em volta do 1º problema (células não vazias com a coluna).
      const firstRow = Number(issues[0]?.message.match(/linha (\d+)/)?.[1] ?? 0);
      const pick = (a: number, b: number) => rows.slice(Math.max(0, a), b).map((r, k) => ({ row: Math.max(0, a) + k + 1, cells: r.map((v, i) => [i, v]).filter(([, v]) => v !== "" && v != null) }));
      await supabaseAdmin.from("purchase_sync_files" as never).update({ debug: { head: pick(0, 25), around: pick(firstRow - 30, firstRow + 5) } } as never).eq("ym", ym);
    } else {
      out.push({ ym, file: f.name, launched, pending });
      await log(ym, f, true, null);
    }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`Compras ${ym} (${f.path}): ${msg}`);
      await log(ym, f, false, msg);
      out.push({ ym, file: f.name, launched: 0, pending: 0, error: msg });
    }
  }
  await cleanupStockWorks(); // Almoxarifado que ficou sem custo (realocado para serviço do cliente) deixa de existir
  return out;
}
