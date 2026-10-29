import * as XLSX from "xlsx";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { DRIVE, graph } from "./industry-sync.server";
import { allocatePurchase, parsePurchaseReport, purchaseFileMonth, type PClient, type PWork } from "./purchases";

type Credentials = { lovableKey: string; excelKey: string };
const FOLDER = "Compras/RELATÓRIOS";
const enc = (p: string) => p.split("/").map(encodeURIComponent).join("/");

function monthRange(ym: string) {
  const [y, m] = ym.split("-").map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${ym}-01`, to: `${ym}-${String(last).padStart(2, "0")}` };
}

/** Horas por serviço no mês: RDO (presentes); serviços só com programação contam 8h por pessoa/dia. */
async function monthHours(ym: string) {
  const { from, to } = monthRange(ym);
  const hours = new Map<string, number>();
  for (let page = 0; ; page++) {
    const { data, error } = await supabaseAdmin.from("rdo_workforce").select("work_id, worked_hours, present").gte("report_date", from).lte("report_date", to).range(page * 1000, page * 1000 + 999);
    if (error) throw error;
    for (const r of data ?? []) if (r.work_id && r.present !== false) hours.set(r.work_id, (hours.get(r.work_id) ?? 0) + Number(r.worked_hours ?? 0));
    if (!data || data.length < 1000) break;
  }
  const { data: sch, error: se } = await supabaseAdmin.from("daily_schedules").select("id").gte("schedule_date", from).lte("schedule_date", to);
  if (se) throw se;
  const ids = (sch ?? []).map((s) => s.id);
  const alloc = new Map<string, number>();
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error } = await supabaseAdmin.from("daily_allocations").select("work_id").in("schedule_id", ids.slice(i, i + 100)).limit(10000);
    if (error) throw error;
    for (const a of data ?? []) if (a.work_id) alloc.set(a.work_id, (alloc.get(a.work_id) ?? 0) + 8);
  }
  for (const [w, h] of alloc) if (!(hours.get(w) ?? 0)) hours.set(w, h);
  return hours;
}

async function loadRefs() {
  const [c, w] = await Promise.all([
    supabaseAdmin.from("clients").select("id, cc_prefix"),
    supabaseAdmin.from("works").select("id, client_id, cc_suffix"),
  ]);
  if (c.error) throw c.error;
  if (w.error) throw w.error;
  const clients: PClient[] = (c.data ?? []).map((x) => ({ id: x.id, prefix: x.cc_prefix }));
  const works: PWork[] = (w.data ?? []).filter((x) => x.client_id).map((x) => ({ id: x.id, client_id: x.client_id!, suffix: x.cc_suffix }));
  return { clients, works };
}

/** Recalcula os lançamentos de uma linha (apaga e recria os gastos dela nos serviços). */
export async function applyLine(lineId: string, refs?: Awaited<ReturnType<typeof loadRefs>>, hoursCache?: Map<string, Map<string, number>>) {
  const { data: line, error } = await supabaseAdmin.from("purchase_cc_lines").select("*").eq("id", lineId).single();
  if (error) throw error;
  const r = refs ?? (await loadRefs());
  let hours = hoursCache?.get(line.ref_month);
  if (!hours) { hours = await monthHours(line.ref_month); hoursCache?.set(line.ref_month, hours); }
  let alloc = allocatePurchase(line.cc_code, Number(line.amount), r.clients, r.works, hours, { client_id: line.target_client_id, work_id: line.target_work_id });
  // Ficaria pendente sem decisão própria: reaproveita a última decisão manual do mesmo centro de custo.
  if (alloc.status === "pending" && !line.target_client_id && !line.target_work_id) {
    const { data: prev } = await supabaseAdmin.from("purchase_cc_lines").select("target_client_id, target_work_id")
      .eq("cc_code", line.cc_code).neq("id", line.id).or("target_client_id.not.is.null,target_work_id.not.is.null")
      .order("ref_month", { ascending: false }).limit(1).maybeSingle();
    if (prev) {
      const again = allocatePurchase(line.cc_code, Number(line.amount), r.clients, r.works, hours, { client_id: prev.target_client_id, work_id: prev.target_work_id });
      if (again.status === "launched") {
        alloc = { ...again, reason: "Direcionado como na decisão anterior" };
        await supabaseAdmin.from("purchase_cc_lines").update({ target_client_id: prev.target_client_id, target_work_id: prev.target_work_id }).eq("id", line.id);
      }
    }
  }
  const del = await supabaseAdmin.from("work_entries").delete().eq("purchase_cc_id", line.id);
  if (del.error) throw del.error;
  if (alloc.parts.length) {
    const date = monthRange(line.ref_month).to;
    const group = alloc.parts.length > 1 ? crypto.randomUUID() : null;
    const ins = await supabaseAdmin.from("work_entries").insert(alloc.parts.map((p) => ({
      work_id: p.work_id, entry_date: date, competence_month: line.ref_month, category: "materiais", amount: p.amount,
      description: `Compras CC ${line.cc_code}${line.cc_name ? ` · ${line.cc_name}` : ""}`,
      purchase_cc_id: line.id, split_group: group, split_total: group ? Number(line.amount) : null,
      split_note: group ? "Rateio por hora trabalhada" : null,
    })));
    if (ins.error) throw ins.error;
  }
  const up = await supabaseAdmin.from("purchase_cc_lines").update({ status: alloc.status, reason: alloc.reason }).eq("id", line.id);
  if (up.error) throw up.error;
  return alloc.status;
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
    const wb = XLSX.read(new Uint8Array(buf));
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]!]!, { header: 1, raw: true, defval: "" });
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
