/**
 * Financeiro em lote × loadWorkData por cliente: mesmos dados brutos e mesmos totais,
 * com bem menos consultas. Roda sempre com uma base sintética; com FIN_FIXTURE=/caminho/db.json
 * (dump do banco, contém dados pessoais e NUNCA vai para o repositório) roda também com dados reais.
 */
import { readFileSync, existsSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { FakeSupabase, type FakeDb } from "@/test/fake-supabase";

const fake = new FakeSupabase({});
vi.mock("@/integrations/supabase/client", () => ({ supabase: fake }));

const { loadResultShared, loadWorkData, sliceResultRaw, monthEnd } = await import("./results-engine");
const { loadFinanceActive, financeList, financeBatches, loadFinanceRaws, buildFinanceGroups } = await import("./finance-data");

const sortDeep = (v: any): any => {
  if (Array.isArray(v)) return v.map(sortDeep).map((x) => JSON.stringify(x)).sort().map((s) => JSON.parse(s));
  if (v && typeof v === "object") return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortDeep(v[k])]));
  return v;
};
const KEYS = ["billed", "mo", "transport", "materials", "margin", "total", "progress"] as const;

async function compare(db: FakeDb, yms: string[]) {
  fake.setDb(db);
  const start = `${yms[0]}-01`, end = monthEnd(yms[yms.length - 1]!);
  const works = (await fake.from("works").select("*, clients(name)").order("name")).data as any[];
  const holidays = ((await fake.from("holidays").select("date")).data as any[]).map((h) => h.date);
  const list = financeList(works, await loadFinanceActive(start, end), start, end);
  const batches = financeBatches(list);

  const shared = await loadResultShared();
  fake.requests = [];
  const legacy = new Map<string, any>();
  for (const b of batches) {
    const raw = await loadWorkData(b.work, b.ids, false, shared);
    for (const id of b.ids) legacy.set(id, sliceResultRaw(raw, id));
  }
  const legacyReq = fake.requests.length;
  fake.requests = []; fake.rpcCalls = [];
  const bulk = await loadFinanceRaws(batches, shared);
  const bulkReq = fake.requests.length;
  const rpcIds = fake.rpcCalls.flatMap((c) => c.args._work_ids);

  expect([...bulk.keys()].sort()).toEqual([...legacy.keys()].sort());
  for (const [id, raw] of legacy) expect(sortDeep(bulk.get(id)), id).toEqual(sortDeep(raw));
  // Recorrências geradas para os mesmos serviços, numa chamada só
  expect(fake.rpcCalls).toHaveLength(batches.length ? 1 : 0);
  expect([...rpcIds].sort()).toEqual(batches.flatMap((b) => b.ids).sort());

  const year = yms[0]!.slice(0, 4);
  const nums = (m: Map<string, any>) => buildFinanceGroups(list, m, yms, year, holidays, works)
    .flatMap((g) => g.lines.map((l) => ({ id: l.work.id, billed: l.billed, mo: l.mo, transport: l.transport, materials: l.materials, margin: l.margin, total: l.total.margin, progress: l.progress })));
  const a = nums(legacy), b = nums(bulk);
  expect(b.map((x) => x.id)).toEqual(a.map((x) => x.id));
  for (let i = 0; i < a.length; i++) for (const k of KEYS) expect(b[i]![k], `${a[i]!.id} ${k}`).toBeCloseTo(a[i]![k], 6);
  return { services: list.length, clients: batches.length, lines: a, legacyReq, bulkReq };
}

// Base sintética: 2 clientes (um com dois serviços e Suzano local), 1 serviço sem cliente
const C1 = "c1", C2 = "c2", W1 = "w1", W2 = "w2", W3 = "w3", W4 = "w4";
const synthetic = (): FakeDb => ({
  clients: [
    { id: C1, name: "Alfa", has_toll: false, toll_amount: 0, city: "Suzano", distance_km: 10, needs_transport_voucher: true },
    { id: C2, name: "Beta", has_toll: true, toll_amount: 12, city: "Mogi", distance_km: 30, needs_transport_voucher: false },
  ],
  works: [
    { id: W1, name: "Alfa Manutenção", client_id: C1, monthly_enabled: true, night_shift: false, orders: [{ date: "2026-10-01", value: 50000 }], order_value: 50000 },
    { id: W2, name: "Alfa Parada", client_id: C1, monthly_enabled: false, night_shift: true, orders: [], order_value: 20000 },
    { id: W3, name: "Beta Andaimes", client_id: C2, monthly_enabled: false, night_shift: false, orders: [], order_value: 30000 },
    { id: W4, name: "Avulso", client_id: null, client: "Avulso", monthly_enabled: false, night_shift: false, orders: [], order_value: 0 },
  ],
  holidays: [{ date: "2026-10-12" }],
  collaborators: [
    { id: "p1", full_name: "Ana", salary: 3000, contract_type: "clt", no_overtime_premium: false, city: "Suzano", vt_enabled: true, travel_bonus_enabled: false, position_id: "pos1" },
    { id: "p2", full_name: "Bruno", salary: 4000, contract_type: "clt", no_overtime_premium: false, city: "Mogi", vt_enabled: true, travel_bonus_enabled: true, position_id: "pos2" },
  ],
  daily_schedules: [{ id: "s1", schedule_date: "2026-10-05" }, { id: "s2", schedule_date: "2026-10-06" }, { id: "s3", schedule_date: "2026-09-29" }],
  daily_allocations: [
    { id: "a1", work_id: W1, collaborator_id: "p1", schedule_id: "s1", driver: false, vt_override: null, travel_bonus_override: null },
    { id: "a2", work_id: W2, collaborator_id: "p2", schedule_id: "s1", driver: true, vt_override: null, travel_bonus_override: null },
    { id: "a3", work_id: W3, collaborator_id: "p2", schedule_id: "s2", driver: false, vt_override: true, travel_bonus_override: null },
    { id: "a4", work_id: W1, collaborator_id: "p1", schedule_id: "s3", driver: false, vt_override: null, travel_bonus_override: null },
  ],
  daily_status_entries: [
    { id: "d1", schedule_id: "s2", collaborator_id: "p1", box_key: "folga" },
    { id: "d2", schedule_id: "s2", collaborator_id: "p2", box_key: "integracao:Alfa" },
  ],
  rdos: [{ id: "r1", work_id: W1, report_date: "2026-10-05", shift: "day" }, { id: "r2", work_id: W2, report_date: "2026-10-05", shift: "night" }],
  rdo_workforce: [
    { id: "f1", rdo_id: "r1", work_id: W1, collaborator_id: "p1", report_date: "2026-10-05", present: true, worked_hours: 9, entry_time: "07:00", exit_time: "17:00", break_minutes: 60, position_id: "pos1" },
    { id: "f2", rdo_id: "r2", work_id: W2, collaborator_id: "p2", report_date: "2026-10-05", present: true, worked_hours: 8, entry_time: "22:00", exit_time: "06:00", break_minutes: 0, position_id: null },
  ],
  work_progress: [{ id: "g1", work_id: W3, month: "2026-10-01", percent: 40 }],
  work_entries: [
    { id: "e1", work_id: W1, category: "faturamento", amount: 50000, entry_date: "2026-10-20", competence_month: null, sync_cancelled: false },
    { id: "e2", work_id: W3, category: "faturamento", amount: 12000, entry_date: "2026-11-03", competence_month: "2026-10", sync_cancelled: false },
    { id: "e3", work_id: W3, category: "materiais", amount: 2500, entry_date: "2026-10-10", competence_month: null, sync_cancelled: false },
    { id: "e4", work_id: W2, category: "terceiros", amount: 800, entry_date: "2026-10-15", competence_month: null, sync_cancelled: false },
    { id: "e5", work_id: W4, category: "mao_obra", amount: 1500, entry_date: "2026-10-02", competence_month: null, sync_cancelled: false },
    { id: "e6", work_id: W1, category: "materiais", amount: 999, entry_date: "2026-10-02", competence_month: null, sync_cancelled: true },
  ],
  vehicles: [{ id: "v1", km_rate: 1.35, plate: "ABC1D23" }],
  vehicle_schedules: [
    { id: "vs1", schedule_date: "2026-10-05", km: 40, trips: 1, client_id: C1, work_id: W1, driver_id: "p2", vehicle_id: "v1", driver_bonus: true, is_suzano_local: false },
    { id: "vs2", schedule_date: "2026-10-06", km: 15, trips: 2, client_id: null, work_id: null, driver_id: "p2", vehicle_id: "v1", driver_bonus: false, is_suzano_local: true },
    { id: "vs3", schedule_date: "2026-10-06", km: 60, trips: 1, client_id: C2, work_id: W3, driver_id: null, vehicle_id: null, driver_bonus: false, is_suzano_local: false },
  ],
  schedule_work_vt: [{ schedule_id: "s1", work_id: W1, pays_vt: true }, { schedule_id: "s2", work_id: W3, pays_vt: false }],
  schedule_work_travel: [{ schedule_id: "s1", work_id: W2, pays_bonus: true }],
  appointments: [
    { id: "ap1", type: "integracao", client_id: C1, collaborator_id: "p2", scheduled_date: "2026-10-06", completed_date: null, status: "agendado", pays_transport_voucher: true },
    { id: "ap2", type: "exame", client_id: C1, collaborator_id: "p1", scheduled_date: "2026-10-06", completed_date: null, status: "agendado", pays_transport_voucher: false },
  ],
  result_support_allocations: [{ id: "sa1", client_id: C1, collaborator_id: "p1" }],
  medical_leaves: [], days_off: [{ id: "o1", collaborator_id: "p2", date: "2026-10-07", end_date: null }], vacations: [],
  transport_voucher_rules: [], driver_bonus_rules: [], travel_bonus_rules: [], city_distances: [{ city_a: "Suzano", city_b: "Mogi", km: 20 }],
});

describe("Financeiro: carregamento em lote", () => {
  it("monta os mesmos dados e totais que loadWorkData, com menos consultas", async () => {
    const r = await compare(synthetic(), ["2026-10"]);
    expect(r.clients).toBe(3);
    expect(r.lines.length).toBeGreaterThan(0);
    expect(r.bulkReq).toBeLessThan(r.legacyReq);
  });
  it("vale também para vários meses e para mês sem movimento", async () => {
    await compare(synthetic(), ["2026-09", "2026-10", "2026-11"]);
    const empty = await compare(synthetic(), ["2026-03"]);
    expect(empty.clients).toBe(0);
    expect(empty.bulkReq).toBe(0);
  });
});

const path = process.env["FIN_FIXTURE"];
const real = path && existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as FakeDb) : null;
describe.skipIf(!real)("Financeiro: carregamento em lote (dados reais)", () => {
  const periods: [string, string[]][] = [
    ["out/26", ["2026-10"]],
    ["set+out/26", ["2026-09", "2026-10"]],
    ["ano 2026", Array.from({ length: 12 }, (_, i) => `2026-${String(i + 1).padStart(2, "0")}`)],
  ];
  for (const [label, yms] of periods) {
    it(`mesmos dados e totais — ${label}`, async () => {
      const r = await compare(real!, yms);
      const sum = (k: "billed" | "margin") => r.lines.reduce((s, x) => s + x[k], 0);
      console.log(`[${label}] serviços=${r.services} clientes=${r.clients} linhas=${r.lines.length} | consultas ${r.legacyReq} → ${r.bulkReq} | faturado=${sum("billed").toFixed(2)} margem=${sum("margin").toFixed(2)}`);
    }, 120_000);
  }
});
