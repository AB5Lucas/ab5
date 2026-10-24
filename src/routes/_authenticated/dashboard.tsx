import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Briefcase, Users, UserCheck, CalendarOff, Stethoscope, AlertTriangle } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { addDays, formatDateBR, todayISO } from "@/lib/scheduling";
import ab5Logo from "@/assets/ab5-logo.png.asset.json";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard Gerencial | AB5 Hub" },
      { name: "description", content: "Visão geral da operação: serviços ativos, colaboradores alocados, férias, atestados e vencimentos." },
      { property: "og:title", content: "Dashboard Gerencial | AB5 Hub" },
      { property: "og:description", content: "Indicadores da operação, alocação por cliente e avisos de vencimento." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: DashboardPage,
});

type Preset = "hoje" | "semana" | "mes" | "mes_anterior" | "proximo_mes" | "personalizado";
const PRESETS: { v: Preset; l: string }[] = [
  { v: "hoje", l: "Hoje" },
  { v: "semana", l: "Esta semana" },
  { v: "mes", l: "Este mês" },
  { v: "mes_anterior", l: "Mês anterior" },
  { v: "proximo_mes", l: "Próximo mês" },
  { v: "personalizado", l: "Personalizado" },
];

const monthRange = (offset: number) => {
  const t = todayISO();
  const d = new Date(Date.UTC(Number(t.slice(0, 4)), Number(t.slice(5, 7)) - 1 + offset, 1));
  const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
  return [d.toISOString().slice(0, 10), end.toISOString().slice(0, 10)] as const;
};
function rangeOf(p: Preset, cf: string, ct: string): readonly [string, string] {
  const t = todayISO();
  if (p === "hoje") return [t, t];
  if (p === "semana") {
    const wd = new Date(t + "T12:00:00").getDay();
    const mon = addDays(t, wd === 0 ? -6 : 1 - wd);
    return [mon, addDays(mon, 6)];
  }
  if (p === "mes") return monthRange(0);
  if (p === "mes_anterior") return monthRange(-1);
  if (p === "proximo_mes") return monthRange(1);
  return [cf || t, ct || cf || t];
}
const diffDays = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);

async function fetchAll<T>(q: (a: number, b: number) => PromiseLike<{ data: T[] | null; error: any }>) {
  const out: T[] = [];
  for (let i = 0; ; i += 1000) {
    const { data, error } = await q(i, i + 999);
    if (error) throw error;
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

type Due = { id: string; collaborator: string; type: string; ref: string; done: string | null; expires: string; days: number };

function DashboardPage() {
  const [preset, setPreset] = useState<Preset>("mes");
  const [cf, setCf] = useState("");
  const [ct, setCt] = useState("");
  const [from, to] = rangeOf(preset, cf, ct);
  const today = todayISO();

  const base = useQuery({
    queryKey: ["dash-base"],
    queryFn: async () => {
      const [people, works, clients, asos, integ, trains] = await Promise.all([
        fetchAll<any>((a, b) => supabase.from("collaborators").select("id, full_name, registration_number, status").range(a, b)),
        fetchAll<any>((a, b) => supabase.from("works").select("id, name, client_id").range(a, b)),
        fetchAll<any>((a, b) => supabase.from("clients").select("id, name").range(a, b)),
        fetchAll<any>((a, b) => supabase.from("asos").select("collaborator_id, exam_date, expires_at").range(a, b)),
        fetchAll<any>((a, b) => supabase.from("client_integrations").select("collaborator_id, client_id, integration_date, expires_at").range(a, b)),
        fetchAll<any>((a, b) => supabase.from("collaborator_trainings").select("collaborator_id, training_id, completed_at, expires_at, trainings(name)").range(a, b)),
      ]);
      return { people, works, clients, asos, integ, trains };
    },
  });

  const period = useQuery({
    queryKey: ["dash-period", from, to],
    queryFn: async () => {
      const scheds = await fetchAll<any>((a, b) =>
        supabase.from("daily_schedules").select("id, schedule_date").gte("schedule_date", from).lte("schedule_date", to).range(a, b),
      );
      const ids = scheds.map((s) => s.id);
      const allocs: any[] = [];
      for (let i = 0; i < ids.length; i += 50) {
        const part = ids.slice(i, i + 50);
        allocs.push(...(await fetchAll<any>((a, b) =>
          supabase.from("daily_allocations").select("collaborator_id, work_id, schedule_id").in("schedule_id", part).range(a, b),
        )));
      }
      const [vac, med] = await Promise.all([
        fetchAll<any>((a, b) => supabase.from("vacations").select("collaborator_id, start_date, end_date").lte("start_date", to).gte("end_date", from).range(a, b)),
        fetchAll<any>((a, b) => supabase.from("medical_leaves").select("collaborator_id, start_date, end_date").lte("start_date", to).gte("end_date", from).range(a, b)),
      ]);
      return { scheds, allocs, vac, med };
    },
  });

  const calc = useMemo(() => {
    if (!base.data || !period.data) return null;
    const b = base.data;
    const p = period.data;
    const active = b.people.filter((x) => x.status === "active");
    const activeIds = new Set(active.map((x) => x.id));
    const person = new Map<string, any>(b.people.map((x) => [x.id, x]));
    const work = new Map<string, any>(b.works.map((w) => [w.id, w]));
    const client = new Map<string, string>(b.clients.map((c) => [c.id, c.name]));
    const dateOf = new Map<string, string>(p.scheds.map((s) => [s.id, s.schedule_date]));

    const workSet = new Set<string>();
    const allocated = new Set<string>();
    const byClient = new Map<string, Set<string>>();
    const byDay = new Map<string, Set<string>>();
    const clientDetail = new Map<string, Map<string, Set<string>>>(); // client -> work -> people
    for (const a of p.allocs) {
      allocated.add(a.collaborator_id);
      const w = a.work_id ? work.get(a.work_id) : null;
      if (a.work_id) workSet.add(a.work_id);
      const cid = w?.client_id ?? "—";
      if (!byClient.has(cid)) byClient.set(cid, new Set());
      byClient.get(cid)!.add(a.collaborator_id);
      const d = dateOf.get(a.schedule_id)!;
      if (!byDay.has(d)) byDay.set(d, new Set());
      byDay.get(d)!.add(a.collaborator_id);
      if (!clientDetail.has(cid)) clientDetail.set(cid, new Map());
      const wn = w?.name ?? "Sem serviço";
      const m = clientDetail.get(cid)!;
      if (!m.has(wn)) m.set(wn, new Set());
      m.get(wn)!.add(a.collaborator_id);
    }
    const totalAlloc = [...byClient.values()].reduce((s, v) => s + v.size, 0) || 1;
    const clientBars = [...byClient.entries()]
      .map(([id, s]) => ({ id, name: id === "—" ? "Sem cliente" : client.get(id) ?? "—", value: s.size, pct: (s.size / totalAlloc) * 100 }))
      .sort((x, y) => y.value - x.value);

    // Evolução: diário até 45 dias, depois semanal, depois mensal
    const span = diffDays(from, to) + 1;
    const gran = span <= 45 ? "dia" : span <= 180 ? "semana" : "mes";
    const buckets = new Map<string, { label: string; sum: number; n: number }>();
    for (const [d, s] of [...byDay.entries()].sort()) {
      let key = d;
      let label = `${d.slice(8, 10)}/${d.slice(5, 7)}`;
      if (gran === "semana") {
        const wd = new Date(d + "T12:00:00").getDay();
        key = addDays(d, wd === 0 ? -6 : 1 - wd);
        label = `sem ${key.slice(8, 10)}/${key.slice(5, 7)}`;
      } else if (gran === "mes") {
        key = d.slice(0, 7);
        label = `${d.slice(5, 7)}/${d.slice(0, 4)}`;
      }
      const bk = buckets.get(key) ?? { label, sum: 0, n: 0 };
      bk.sum += s.size;
      bk.n += 1;
      buckets.set(key, bk);
    }
    const evo = [...buckets.entries()].sort().map(([, v]) => ({ label: v.label, value: Math.round(v.sum / v.n) }));

    // Vencimentos (último registro de cada item, só colaboradores ativos)
    const dues: Due[] = [];
    const latest = <T,>(rows: T[], key: (r: T) => string, exp: (r: T) => string | null) => {
      const m = new Map<string, T>();
      for (const r of rows) {
        const k = key(r);
        const cur = m.get(k);
        if (!cur || (exp(r) ?? "9999") > (exp(cur) ?? "9999")) m.set(k, r);
      }
      return [...m.values()];
    };
    const push = (cid: string, type: string, ref: string, done: string | null, exp: string | null, id: string) => {
      if (!exp || !activeIds.has(cid)) return;
      dues.push({ id, collaborator: person.get(cid)?.full_name ?? "—", type, ref, done, expires: exp, days: diffDays(today, exp) });
    };
    latest(b.asos, (r: any) => r.collaborator_id, (r: any) => r.expires_at).forEach((r: any) =>
      push(r.collaborator_id, "ASO", "—", r.exam_date, r.expires_at, `a${r.collaborator_id}`));
    latest(b.integ, (r: any) => `${r.collaborator_id}|${r.client_id}`, (r: any) => r.expires_at).forEach((r: any) =>
      push(r.collaborator_id, "Integração", client.get(r.client_id) ?? "—", r.integration_date, r.expires_at, `i${r.collaborator_id}${r.client_id}`));
    latest(b.trains, (r: any) => `${r.collaborator_id}|${r.training_id}`, (r: any) => r.expires_at).forEach((r: any) =>
      push(r.collaborator_id, `Treinamento — ${r.trainings?.name ?? ""}`, "—", r.completed_at, r.expires_at, `t${r.collaborator_id}${r.training_id}`));
    dues.sort((x, y) => x.days - y.days);
    const expired = dues.filter((d) => d.days < 0);
    const upcoming = dues.filter((d) => d.days >= 0);
    const pend = expired.length + upcoming.filter((d) => d.days <= 30).length;

    const mapLeave = (rows: any[]) =>
      latest(rows, (r: any) => r.collaborator_id, (r: any) => r.end_date)
        .filter((r: any) => activeIds.has(r.collaborator_id))
        .map((r: any) => ({ ...r, name: person.get(r.collaborator_id)?.full_name ?? "—", reg: person.get(r.collaborator_id)?.registration_number ?? "" }))
        .sort((x: any, y: any) => x.start_date.localeCompare(y.start_date));

    return {
      services: workSet.size,
      total: active.length,
      allocated: allocated.size,
      vac: mapLeave(p.vac).filter((r: any) => r.end_date >= today),
      med: mapLeave(p.med),
      clientBars,
      clientDetail,
      evo,
      gran,
      expired,
      upcoming,
      pend,
      personName: (id: string) => person.get(id)?.full_name ?? "—",
    };
  }, [base.data, period.data, from, to, today]);

  const [dlg, setDlg] = useState<null | "ferias" | "atestados" | "ausencias" | "vencimentos" | { client: string; name: string }>(null);
  const loading = base.isLoading || period.isLoading;
  const periodLabel = from === to ? formatDateBR(from) : `${formatDateBR(from)} a ${formatDateBR(to)}`;

  return (
    <div className="space-y-6">
      <div className="rounded-lg border bg-card px-8 py-6 shadow-sm">
        <div className="grid grid-cols-1 items-center gap-4 border-b pb-4 lg:grid-cols-[1fr_auto_1fr]">
          <div className="flex flex-wrap items-end gap-2">
            <div className="w-44">
              <p className="mb-1 text-xs font-semibold italic text-muted-foreground">Período</p>
              <Select value={preset} onValueChange={(v) => setPreset(v as Preset)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PRESETS.map((p) => <SelectItem key={p.v} value={p.v}>{p.l}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {preset === "personalizado" && (
              <>
                <Input type="date" className="w-40" value={cf} onChange={(e) => setCf(e.target.value)} />
                <Input type="date" className="w-40" value={ct} onChange={(e) => setCt(e.target.value)} />
              </>
            )}
          </div>
          <h1 className="text-center text-3xl font-bold italic tracking-wide">DASHBOARD GERENCIAL</h1>
          <div className="flex items-center gap-4 justify-self-end">
            <img src={ab5Logo.url} alt="AB5" className="h-14 w-14 object-contain" />
            <div className="text-sm">
              <p className="text-muted-foreground">Período analisado</p>
              <p className="font-semibold">{periodLabel}</p>
            </div>
          </div>
        </div>

        {loading || !calc ? (
          <p className="py-10 text-center text-sm text-muted-foreground">Carregando indicadores…</p>
        ) : (
          <>
            <div className="grid gap-3 border-b py-5 sm:grid-cols-3 xl:grid-cols-6">
              <Link to="/programacao/servicos"><Kpi icon={Briefcase} label="Serviços ativos no período" value={calc.services} /></Link>
              <Kpi icon={Users} label="Colaboradores ativos" value={calc.total} />
              <Kpi icon={UserCheck} label="Colaboradores alocados" value={calc.allocated} hint={calc.total ? `${Math.round((calc.allocated / calc.total) * 100)}% do quadro` : undefined} />
              <button className="text-left" onClick={() => setDlg("ferias")}><Kpi icon={CalendarOff} label="Em férias" value={calc.vac.length} tone="warning" /></button>
              <button className="text-left" onClick={() => setDlg("atestados")}><Kpi icon={Stethoscope} label={preset === "hoje" ? "Atestados hoje" : "Atestados"} value={calc.med.length} tone="destructive" /></button>
              <button className="text-left" onClick={() => setDlg("vencimentos")}><Kpi icon={AlertTriangle} label="Pendências" value={calc.pend} tone="destructive" /></button>
            </div>

            <div className="grid gap-6 border-b py-5 xl:grid-cols-2">
              <div>
                <SectionTitle>Colaboradores alocados por cliente</SectionTitle>
                <div className="mt-3 h-72">
                  {calc.clientBars.length ? (
                    <ResponsiveContainer>
                      <BarChart data={calc.clientBars} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                        <XAxis dataKey="name" interval={0} angle={-35} textAnchor="end" height={70} tick={{ fontSize: 10 }} />
                        <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                        <Tooltip
                          contentStyle={{ background: "var(--card)", border: "1px solid var(--border)" }}
                          formatter={(v: any, _n: any, it: any) => [`${v} colaboradores (${it.payload.pct.toFixed(1)}%)`, it.payload.name]}
                          labelFormatter={() => ""}
                        />
                        <Bar dataKey="value" fill="var(--primary)" cursor="pointer" onClick={(d: any) => setDlg({ client: d.id, name: d.name })}>
                          {calc.clientBars.map((c) => <Cell key={c.id} fill="var(--primary)" />)}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  ) : <Empty>Nenhuma alocação no período.</Empty>}
                </div>
              </div>
              <div>
                <SectionTitle>Evolução de colaboradores alocados{calc.gran !== "dia" ? ` (média por ${calc.gran === "semana" ? "semana" : "mês"})` : ""}</SectionTitle>
                <div className="mt-3 h-72">
                  {calc.evo.length ? (
                    <ResponsiveContainer>
                      <LineChart data={calc.evo}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                        <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                        <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                        <Tooltip contentStyle={{ background: "var(--card)", border: "1px solid var(--border)" }} formatter={(v: any) => [`${v} colaboradores`, "Alocados"]} />
                        <Line type="monotone" dataKey="value" stroke="var(--primary)" strokeWidth={2} dot={{ r: 3 }} />
                      </LineChart>
                    </ResponsiveContainer>
                  ) : <Empty>Sem dados no período.</Empty>}
                </div>
              </div>
            </div>

            <div className="grid gap-6 pt-5 xl:grid-cols-2">
              <div>
                <div className="flex h-9 items-center justify-between">
                  <SectionTitle>Avisos importantes</SectionTitle>
                  <Button size="sm" variant="outline" onClick={() => setDlg("vencimentos")}>Ver todos</Button>
                </div>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <div className="space-y-2">
                    <p className="text-xs font-semibold uppercase text-destructive">Vencidos ({calc.expired.length})</p>
                    {calc.expired.slice(0, 6).map((d) => <DueCard key={d.id} d={d} />)}
                    {!calc.expired.length && <Empty>Nada vencido.</Empty>}
                  </div>
                  <div className="space-y-2">
                    <p className="text-xs font-semibold uppercase text-warning">A vencer em 30 dias ({calc.upcoming.filter((d) => d.days <= 30).length})</p>
                    {calc.upcoming.filter((d) => d.days <= 30).slice(0, 6).map((d) => <DueCard key={d.id} d={d} />)}
                    {!calc.upcoming.some((d) => d.days <= 30) && <Empty>Nada a vencer.</Empty>}
                  </div>
                </div>
              </div>
              <div>
                <div className="flex h-9 items-center justify-between">
                  <SectionTitle>Ausências</SectionTitle>
                  <Button size="sm" variant="outline" onClick={() => setDlg("ausencias")}>Ver todos</Button>
                </div>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <LeaveBox title="Férias" rows={calc.vac} today={today} />
                  <LeaveBox title="Atestados" rows={calc.med} today={today} />
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      <Dialog open={!!dlg} onOpenChange={(o) => !o && setDlg(null)}>
        <DialogContent className="max-h-[85vh] max-w-5xl overflow-y-auto">
          {calc && dlg === "ausencias" && (
            <>
              <DialogHeader><DialogTitle>Ausências — {periodLabel}</DialogTitle></DialogHeader>
              <p className="text-sm font-semibold uppercase text-primary">Férias ({calc.vac.length})</p>
              <LeaveTable rows={calc.vac} today={today} />
              <p className="text-sm font-semibold uppercase text-primary">Atestados ({calc.med.length})</p>
              <LeaveTable rows={calc.med} today={today} />
            </>
          )}
          {calc && dlg === "vencimentos" && <DueDialog expired={calc.expired} upcoming={calc.upcoming} />}
          {calc && (dlg === "ferias" || dlg === "atestados") && (
            <>
              <DialogHeader><DialogTitle>{dlg === "ferias" ? "Férias" : "Atestados"} — {periodLabel}</DialogTitle></DialogHeader>
              <LeaveTable rows={dlg === "ferias" ? calc.vac : calc.med} today={today} />
            </>
          )}
          {calc && typeof dlg === "object" && dlg && (
            <>
              <DialogHeader><DialogTitle>Alocações — {dlg.name}</DialogTitle></DialogHeader>
              {[...(calc.clientDetail.get(dlg.client)?.entries() ?? [])].map(([wn, ppl]) => (
                <div key={wn} className="rounded-md border p-3">
                  <p className="font-semibold">{wn} <span className="text-sm text-muted-foreground">({ppl.size})</span></p>
                  <p className="mt-1 text-sm text-muted-foreground">{[...ppl].map(calc.personName).sort().join(", ")}</p>
                </div>
              ))}
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <p className="text-sm font-semibold uppercase italic text-muted-foreground">{children}</p>;
}
function Empty({ children }: { children: React.ReactNode }) {
  return <p className="py-6 text-center text-sm text-muted-foreground">{children}</p>;
}

function Kpi({ icon: Icon, label, value, hint, tone }: { icon: typeof Users; label: string; value: number; hint?: string | undefined; tone?: "warning" | "destructive" }) {
  const c = tone === "warning" ? "text-warning" : tone === "destructive" ? "text-destructive" : "text-primary";
  return (
    <div className="flex h-full items-center gap-3 rounded-md border bg-background p-4 transition-colors hover:bg-secondary">
      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-secondary ${c}`}><Icon className="h-5 w-5" /></span>
      <div>
        <p className="text-2xl font-bold leading-none">{value}</p>
        <p className="mt-1 text-xs font-semibold italic text-muted-foreground">{label}</p>
        {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
      </div>
    </div>
  );
}

const dueText = (days: number) =>
  days < 0 ? `Vencido há ${-days} dia${days === -1 ? "" : "s"}` : days === 0 ? "Vence hoje" : `Vence em ${days} dia${days === 1 ? "" : "s"}`;
const dueTone = (days: number) => (days < 0 ? "border-destructive text-destructive" : days <= 7 ? "border-warning text-warning" : "border-border text-muted-foreground");

function DueCard({ d }: { d: Due }) {
  return (
    <div className={`rounded-md border-l-4 border bg-background px-3 py-2 ${dueTone(d.days).split(" ")[0]}`}>
      <p className="text-sm font-semibold">{d.collaborator}</p>
      <p className="text-xs text-muted-foreground">{d.type}{d.ref !== "—" ? ` — ${d.ref}` : ""} · {formatDateBR(d.expires)}</p>
      <p className={`text-xs font-semibold ${dueTone(d.days).split(" ")[1]}`}>{dueText(d.days)}</p>
    </div>
  );
}

function LeaveBox({ title, rows, today }: { title: string; rows: any[]; today: string }) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold uppercase text-primary">{title} ({rows.length})</p>
      <div className="space-y-2">
        {rows.slice(0, 6).map((r) => (
          <div key={r.collaborator_id} className="rounded-md border bg-background px-3 py-2">
            <p className="text-sm font-semibold">{r.name} {r.reg && <span className="text-xs font-normal text-muted-foreground">#{r.reg}</span>}</p>
            <p className="text-xs text-muted-foreground">{formatDateBR(r.start_date)} → {formatDateBR(r.end_date)}</p>
            <p className="text-xs font-semibold text-primary">{leaveStatus(r, today)}</p>
          </div>
        ))}
        {!rows.length && <Empty>Ninguém no período.</Empty>}
      </div>
    </div>
  );
}
const leaveStatus = (r: any, today: string) => {
  if (r.start_date > today) return `Começa em ${diffDays(today, r.start_date)} dia(s)`;
  if (r.end_date < today) return "Encerrado";
  const n = diffDays(today, r.end_date);
  return n === 0 ? "Termina hoje" : `Em andamento — termina em ${n} dia(s)`;
};

function LeaveTable({ rows, today }: { rows: any[]; today: string }) {
  return (
    <Table>
      <TableHeader><TableRow><TableHead>Colaborador</TableHead><TableHead>Matrícula</TableHead><TableHead>Início</TableHead><TableHead>Término</TableHead><TableHead>Situação</TableHead></TableRow></TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.collaborator_id}>
            <TableCell>{r.name}</TableCell><TableCell>{r.reg}</TableCell><TableCell>{formatDateBR(r.start_date)}</TableCell><TableCell>{formatDateBR(r.end_date)}</TableCell><TableCell>{leaveStatus(r, today)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function DueDialog({ expired, upcoming }: { expired: Due[]; upcoming: Due[] }) {
  const [tab, setTab] = useState<"vencidos" | "avencer">("vencidos");
  const [name, setName] = useState("");
  const [type, setType] = useState("all");
  const [ref, setRef] = useState("");
  const [win, setWin] = useState("30");
  const [cTo, setCTo] = useState("");
  const list = (tab === "vencidos" ? expired : upcoming).filter((d) => {
    if (name && !d.collaborator.toLowerCase().includes(name.toLowerCase())) return false;
    if (type !== "all" && !d.type.startsWith(type)) return false;
    if (ref && !d.ref.toLowerCase().includes(ref.toLowerCase())) return false;
    if (tab === "avencer") {
      if (win === "custom") return !cTo || d.expires <= cTo;
      return d.days <= Number(win);
    }
    return true;
  });
  return (
    <>
      <DialogHeader><DialogTitle>Vencimentos</DialogTitle></DialogHeader>
      <div className="flex gap-2">
        <Button variant={tab === "vencidos" ? "default" : "outline"} size="sm" onClick={() => setTab("vencidos")}>Vencidos ({expired.length})</Button>
        <Button variant={tab === "avencer" ? "default" : "outline"} size="sm" onClick={() => setTab("avencer")}>A vencer ({upcoming.length})</Button>
      </div>
      <div className="flex flex-wrap gap-2">
        <Input className="w-48" placeholder="Colaborador" value={name} onChange={(e) => setName(e.target.value)} />
        <Select value={type} onValueChange={setType}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os tipos</SelectItem>
            <SelectItem value="ASO">ASO</SelectItem>
            <SelectItem value="Integração">Integração</SelectItem>
            <SelectItem value="Treinamento">Treinamento</SelectItem>
          </SelectContent>
        </Select>
        <Input className="w-48" placeholder="Cliente/obra" value={ref} onChange={(e) => setRef(e.target.value)} />
        {tab === "avencer" && (
          <>
            <Select value={win} onValueChange={setWin}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="0">Hoje</SelectItem>
                <SelectItem value="3">Próximos 3 dias</SelectItem>
                <SelectItem value="7">Próximos 7 dias</SelectItem>
                <SelectItem value="30">Próximos 30 dias</SelectItem>
                <SelectItem value="custom">Personalizado</SelectItem>
              </SelectContent>
            </Select>
            {win === "custom" && <Input type="date" className="w-40" value={cTo} onChange={(e) => setCTo(e.target.value)} />}
          </>
        )}
      </div>
      <Table>
        <TableHeader><TableRow><TableHead>Colaborador</TableHead><TableHead>Tipo</TableHead><TableHead>Cliente/Obra</TableHead><TableHead>Realização</TableHead><TableHead>Vencimento</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
        <TableBody>
          {list.map((d) => (
            <TableRow key={d.id}>
              <TableCell>{d.collaborator}</TableCell><TableCell>{d.type}</TableCell><TableCell>{d.ref}</TableCell>
              <TableCell>{formatDateBR(d.done)}</TableCell><TableCell>{formatDateBR(d.expires)}</TableCell>
              <TableCell className={`font-semibold ${dueTone(d.days).split(" ")[1]}`}>{dueText(d.days)}</TableCell>
            </TableRow>
          ))}
          {!list.length && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">Nenhum item.</TableCell></TableRow>}
        </TableBody>
      </Table>
    </>
  );
}
