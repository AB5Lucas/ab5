import * as XLSX from "xlsx";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { DRIVE, graph } from "./industry-sync.server";
import { allocatePurchase, isIndustryClient, parsePurchaseReport, purchaseFileMonth, purchaseItemEntries, type CcItem, type PClient, type PWork } from "./purchases";
import { assetCategory, detectPurchaseAsset, effectivePurchaseCc, exclusionReason, installmentPlan, purchaseItemKeys, purchaseDecisionRequired, type AssetDecision, type ExclusionRule, type PurchaseItemState } from "./purchase-policy";
import { purchaseMonthHours } from "./purchase-hours";

type Credentials = { lovableKey: string; excelKey: string };
const FOLDER = "Compras/RELATÓRIOS";
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
    all((a, b) => supabaseAdmin.from("days_off").select("collaborator_id,date,end_date").lte("date", to).order("id").range(a, b)),
    all((a, b) => supabaseAdmin.from("vacations").select("collaborator_id,start_date,end_date").lte("start_date", to).gte("end_date", from).order("id").range(a, b)),
    all((a, b) => supabaseAdmin.from("medical_leaves").select("collaborator_id,start_date,end_date").lte("start_date", to).gte("end_date", from).order("id").range(a, b)),
    all((a, b) => supabaseAdmin.from("daily_status_entries").select("collaborator_id,daily_schedules!inner(schedule_date)").in("box_key", ["folga", "ferias", "afastado", "falta", "atestado", "medico", "interjornada", "licenca", "abono"]).gte("daily_schedules.schedule_date", from).lte("daily_schedules.schedule_date", to).order("id").range(a, b)),
  ]);
  return purchaseMonthHours(works, allocations, rows, headers, supports, { daysOff, vacations, leaves, noVtRows });
}

async function loadRefs() {
  const [c, w, rules, redirects] = await Promise.all([
    supabaseAdmin.from("clients").select("id, name, cc_prefix"),
    supabaseAdmin.from("works").select("id, client_id, cc_suffix"),
    supabaseAdmin.from("purchase_exclusion_rules").select("*"),
    supabaseAdmin.from("purchase_cc_redirects").select("*"),
  ]);
  if (c.error) throw c.error;
  if (w.error) throw w.error;
  if (rules.error) throw rules.error;
  if (redirects.error) throw redirects.error;
  const clients: PClient[] = (c.data ?? []).map((x) => ({ id: x.id, prefix: x.cc_prefix }));
  const works: PWork[] = (w.data ?? []).flatMap((x) => x.client_id ? [{ id: x.id, client_id: x.client_id, suffix: x.cc_suffix }] : []);
  const industryClients = new Set((c.data ?? []).filter((x) => isIndustryClient(x.name)).map((x) => x.id));
  const industryWorkIds = new Set(works.filter((x) => industryClients.has(x.client_id)).map((x) => x.id));
  return { clients, works, industryWorkIds, rules: rules.data as ExclusionRule[], redirects: redirects.data };
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
    const reason = asset || decision ? null : exclusionReason(item.code, r.rules);
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
        const rows = purchaseItemEntries([portion], part.amount, resolved.allocation, resolved.hours, r.industryWorkIds, monthRange(part.month).to);
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
  return { processed: data.length };
}

/** Lê todos os relatórios da pasta; para cada mês usa o arquivo com o período mais longo. */
export async function executePurchaseSync(c: Credentials) {
  const list = await graph(`${DRIVE}/root:/${enc(FOLDER)}:/children?$top=500`, c);
  const best = new Map<string, { name: string; end: string }>();
  for (const f of (list?.value ?? []) as { name: string; folder?: unknown }[]) {
    if (f.folder) continue;
    const m = purchaseFileMonth(f.name);
    if (!m) continue;
    const cur = best.get(m.ym);
    if (!cur || m.end > cur.end) best.set(m.ym, { name: f.name, end: m.end });
  }
  const refs = await loadRefs();
  const hoursCache = new Map<string, Map<string, number>>();
  const out: { ym: string; file: string; launched: number; pending: number }[] = [];
  for (const [ym, f] of [...best.entries()].sort()) {
    const file = `${FOLDER}/${f.name}`;
    const buf = await graph(`${DRIVE}/root:/${enc(file)}:/content`, c, true);
    const wb = XLSX.read(new Uint8Array(buf), { cellDates: true });
    const sheetName = wb.SheetNames[0];
    const sheet = sheetName ? wb.Sheets[sheetName] : undefined;
    if (!sheet) throw new Error(`Relatório vazio: ${file}`);
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: "" });
    const lines = parsePurchaseReport(rows);
    const { data: existing, error } = await supabaseAdmin.from("purchase_cc_lines").select("id, cc_code").eq("ref_month", ym);
    if (error) throw error;
    const keep = new Set(lines.map((l) => l.cc));
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
    out.push({ ym, file: f.name, launched, pending });
  }
  return out;
}
