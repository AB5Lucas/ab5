import { laborCost } from "@/lib/labor-cost";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarDays } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

// Tons da cor principal: 1 serviço = cor cheia clara; 2 = diagonal em 2 tons; 3 = 3 faixas; 4+ = tom escuro inteiro.
const tone = (p: number) => `color-mix(in oklch, var(--primary) ${p}%, var(--background))`;
const BG = [
  tone(35),
  `linear-gradient(135deg, ${tone(30)} 50%, ${tone(65)} 50%)`,
  `linear-gradient(135deg, ${tone(25)} 33.3%, ${tone(50)} 33.3% 66.6%, ${tone(80)} 66.6%)`,
  tone(100),
];
const LEGEND = ["1 serviço", "2 serviços", "3 serviços", "4 ou mais"];
const cell = { borderRadius: 6, fontWeight: 600 } as const;

/** Calendário dos dias com efetivo escalado nos serviços informados (Programação). */
export function ServiceDaysCalendar({ workIds, names, multi }: { workIds: string[]; names: Record<string, string>; multi: boolean }) {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ["service-days", workIds.join(",")],
    enabled: open && workIds.length > 0,
    queryFn: async () => {
      const out: { work_id: string; daily_schedules: { schedule_date: string } | null }[] = [];
      for (let f = 0; ; f += 1000) {
        const { data, error } = await supabase
          .from("daily_allocations")
          .select("work_id, daily_schedules(schedule_date)")
          .in("work_id", workIds)
          .order("id")
          .range(f, f + 999);
        if (error) throw error;
        out.push(...((data ?? []) as any));
        if (!data || data.length < 1000) break;
      }
      const byDay = new Map<string, Set<string>>();
      for (const r of out) {
        const d = r.daily_schedules?.schedule_date;
        if (!d) continue;
        if (!byDay.has(d)) byDay.set(d, new Set());
        byDay.get(d)!.add(r.work_id);
      }
      return byDay;
    },
  });
  const toDate = (s: string) => new Date(s + "T12:00:00");
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const { groups, last } = useMemo(() => {
    const groups: Date[][] = [[], [], [], []];
    let last: string | undefined;
    for (const [d, s] of q.data ?? []) {
      groups[Math.min(multi ? s.size : 1, 4) - 1]!.push(toDate(d));
      if (!last || d > last) last = d;
    }
    return { groups, last };
  }, [q.data, multi]);
  const pickedWorks = picked ? [...(q.data?.get(picked) ?? [])].map((id) => names[id] ?? "—").sort() : [];
  const day = useQuery({
    queryKey: ["service-day-summary", workIds.join(","), picked],
    enabled: !!picked && workIds.length > 0,
    queryFn: async () => {
      const ids = new Set(workIds);
      const { data: ws } = await supabase.from("works").select("client_id").in("id", workIds);
      const clientId = ws?.find((w) => w.client_id)?.client_id ?? null;
      const { data: sched } = await supabase.from("daily_schedules").select("id").eq("schedule_date", picked!).maybeSingle();
      if (!sched) return { people: 0, mo: 0, transport: 0, vt: 0 };
      const sibIds = clientId ? ((await supabase.from("works").select("id").eq("client_id", clientId)).data ?? []).map((x) => x.id) : workIds;
      const [allocs, wf, vs, client] = await Promise.all([
        supabase.from("daily_allocations").select("work_id, collaborator_id, collaborators(salary, contract_type, no_overtime_premium)").eq("schedule_id", sched.id).in("work_id", sibIds),
        supabase.from("rdo_workforce").select("work_id, collaborator_id, present, worked_hours").eq("report_date", picked!).in("work_id", workIds),
        clientId ? supabase.from("vehicle_schedules").select("km, trips, work_id, vehicles(km_rate)").eq("schedule_date", picked!).eq("client_id", clientId) : Promise.resolve({ data: [] as any[] }),
        clientId ? supabase.from("clients").select("has_toll, toll_amount").eq("id", clientId).maybeSingle() : Promise.resolve({ data: null as any }),
      ]);
      const all = (allocs.data ?? []) as any[];
      const mine = all.filter((a) => ids.has(a.work_id));
      const hrs = new Map<string, number>();
      for (const r of (wf.data ?? []) as any[]) if (r.present) hrs.set(`${r.work_id}|${r.collaborator_id}`, Number(r.worked_hours ?? 0));
      const { data: hd } = await supabase.from("holidays").select("date").eq("date", picked!);
      const hol = new Set<string>((hd ?? []).map((x) => x.date as string));
      let mo = 0;
      for (const a of mine) {
        const h = hrs.get(`${a.work_id}|${a.collaborator_id}`) ?? 8;
        mo += laborCost(h, Number(a.collaborators?.salary ?? 0), a.collaborators?.contract_type === "pj", picked!, hol, 0, !!a.collaborators?.no_overtime_premium);
      }
      const toll = client.data?.has_toll ? Number(client.data.toll_amount ?? 0) : 0;
      let transport = 0;
      for (const v of (vs.data ?? []) as any[]) {
        if (v.work_id && !ids.has(v.work_id)) continue;
        const trips = Number(v.trips ?? 1);
        const cost = Number(v.km ?? 0) * 2 * trips * Number(v.vehicles?.km_rate ?? 1.35) + toll * 2 * trips;
        transport += v.work_id ? cost : all.length ? (cost * mine.length) / all.length : 0;
      }
      // VT do dia: mesma regra da tela de Resultados
      const [wvt, novt, lv, rules, mineFull] = await Promise.all([
        supabase.from("schedule_work_vt").select("work_id, pays_vt").eq("schedule_id", sched.id).in("work_id", sibIds),
        supabase.from("daily_status_entries").select("collaborator_id").eq("schedule_id", sched.id).in("box_key", ["falta", "atestado", "medico", "interjornada", "licenca", "abono"]),
        supabase.from("medical_leaves").select("collaborator_id").lte("start_date", picked!).gte("end_date", picked!),
        supabase.from("transport_voucher_rules").select("*").eq("active", true),
        supabase.from("daily_allocations").select("work_id, collaborator_id, vt_override, driver, collaborators(city, vt_enabled)").eq("schedule_id", sched.id).in("work_id", workIds),
      ]);
      const clientVt = ((wvt.data ?? []) as any[]).some((r) => r.pays_vt);
      const skip = new Set<string>([...((novt.data ?? []) as any[]), ...((lv.data ?? []) as any[])].map((r) => r.collaborator_id));
      const vtDay = (driver: boolean) =>
        ((rules.data ?? []) as any[]).reduce((s, r) => {
          if (driver ? !r.applies_to_drivers : !r.applies_to_collaborators) return s;
          if (r.calculation_type === "fixed_monthly") return s;
          return s + Number(r.amount) * (r.calculation_type === "round_trip" ? 2 : 1);
        }, 0);
      let vt = 0;
      for (const a of (mineFull.data ?? []) as any[]) {
        if (skip.has(a.collaborator_id)) continue;
        const pouso = String(a.collaborators?.city ?? "").toLowerCase().includes("pouso alegre");
        const base = a.collaborators?.vt_enabled === false ? false : clientVt || pouso;
        if (!(a.vt_override ?? base)) continue;
        vt += vtDay(!!a.driver);
      }
      transport += vt;
      return { people: new Set(mine.map((a) => a.collaborator_id)).size, mo, transport, vt };
    },
  });
  const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)} disabled={!workIds.length}>
        <CalendarDays className="mr-1 h-4 w-4" /> Calendário
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-fit">
          <DialogHeader>
            <DialogTitle>Dias com serviço</DialogTitle>
          </DialogHeader>
          {q.isLoading ? (
            <p className="text-sm text-muted-foreground">Carregando…</p>
          ) : (
            <>
              <Calendar
                mode="single"
                numberOfMonths={2}
                {...(last ? { defaultMonth: toDate(last) } : {})}
                {...(picked ? { selected: toDate(picked) } : {})}
                onSelect={(d: Date | undefined) => setPicked(d ? iso(d) : null)}
                modifiers={{ s1: groups[0], s2: groups[1], s3: groups[2], s4: groups[3] }}
                modifiersStyles={{
                  s1: { ...cell, background: BG[0] },
                  s2: { ...cell, background: BG[1] },
                  s3: { ...cell, background: BG[2] },
                  s4: { ...cell, background: BG[3], color: "var(--primary-foreground)" },
                }}
                className="p-3 pointer-events-auto"
              />
              <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
                {(multi ? LEGEND : LEGEND.slice(0, 1)).map((l, i) => (
                  <span key={l} className="flex items-center gap-1">
                    <span className="h-4 w-4 rounded" style={{ background: BG[i] }} /> {l}
                  </span>
                ))}
                <span>{(q.data?.size ?? 0)} dias no total</span>
              </div>
              {picked && (
                <div className="space-y-2 text-sm">
                  <div>
                    <b>{picked.split("-").reverse().join("/")}:</b>{" "}
                    {pickedWorks.length ? pickedWorks.join(", ") : "sem serviço"}
                  </div>
                  {day.isLoading ? (
                    <p className="text-xs text-muted-foreground">Calculando resumo…</p>
                  ) : day.data && (
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                      <div className="rounded-md border border-border p-2"><div className="text-xs text-muted-foreground">Colaboradores</div><div className="font-semibold">{day.data.people}</div></div>
                      <div className="rounded-md border border-border p-2"><div className="text-xs text-muted-foreground">Mão de obra</div><div className="font-semibold">{brl(day.data.mo)}</div></div>
                      <div className="rounded-md border border-border p-2"><div className="text-xs text-muted-foreground">Transporte</div><div className="font-semibold">{brl(day.data.transport)}</div>{day.data.vt > 0 && <div className="text-xs text-muted-foreground">inclui VT {brl(day.data.vt)}</div>}</div>
                      <div className="rounded-md border border-border p-2"><div className="text-xs text-muted-foreground">Total</div><div className="font-semibold">{brl(day.data.mo + day.data.transport)}</div></div>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
