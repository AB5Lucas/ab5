import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { RotateCcw, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateBR } from "@/lib/scheduling";
import { reasonLabel } from "@/lib/rdo";

export const Route = createFileRoute("/_authenticated/relatorios/ajuste-ponto")({
  head: () => ({
    meta: [
      { title: "Ajuste de Ponto | AB5 Hub" },
      { name: "description", content: "Central de pendências do RH: faltas, atestados, atrasos e saídas antecipadas apontados nos RDOs." },
      { property: "og:title", content: "Ajuste de Ponto | AB5 Hub" },
      { property: "og:description", content: "Ocorrências dos RDOs que precisam ser lançadas no ponto." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Page,
});

type Kind = "falta" | "atestado" | "atraso" | "saida" | "interjornada";
const KIND_LABEL: Record<Kind, string> = {
  falta: "Falta",
  atestado: "Atestado",
  atraso: "Atraso",
  saida: "Saída antecipada",
  interjornada: "Interjornada",
};
/** Tolerância (minutos) antes de considerar atraso/saída antecipada. */
const TOLERANCE = 10;

const toMin = (t?: string | null) => {
  if (!t) return null;
  const [h, m] = t.split(":").map(Number);
  return h! * 60 + m!;
};
const hhmm = (t?: string | null) => (t ? t.slice(0, 5) : "—");

type Occ = {
  key: string;
  wfId: string;
  kind: Kind;
  date: string;
  reg: string;
  name: string;
  client: string;
  service: string;
  reason: string;
  responsible: string;
  rdoNumber: number | null;
  wf: any;
  expected: { entry: string | null; exit: string | null };
};

function Page() {
  const qc = useQueryClient();
  const firstOfMonth = new Date().toISOString().slice(0, 8) + "01";
  const [f, setF] = useState({ from: firstOfMonth, to: "", kind: "all", name: "", reg: "", client: "", status: "pendente" });
  const [detail, setDetail] = useState<Occ | null>(null);

  const data = useQuery({
    queryKey: ["ajuste-ponto", f.from, f.to],
    queryFn: async () => {
      const out: any[] = [];
      for (let i = 0; ; i += 1000) {
        let q = supabase
          .from("rdo_workforce")
          .select(
            "id, report_date, present, entry_time, exit_time, reported_reason, reported_note, final_classification, collaborators(full_name, registration_number, shift_id), rdos!inner(number, shift, responsible_name, works(name, entry_time, exit_time, exit_time_weekend, clients(name)))",
          )
          .order("report_date", { ascending: false })
          .range(i, i + 999);
        if (f.from) q = q.gte("report_date", f.from);
        if (f.to) q = q.lte("report_date", f.to);
        const { data, error } = await q;
        if (error) throw error;
        out.push(...(data ?? []));
        if (!data || data.length < 1000) break;
      }
      const { data: adj, error } = await supabase.from("timeclock_adjustments").select("rdo_workforce_id, kind, status, treated_at");
      if (error) throw error;
      const { data: shifts } = await supabase.from("work_shifts").select("id, is_default, schedule");
      return { wf: out, adj: adj ?? [], shifts: shifts ?? [] };
    },
  });

  const { occs, treated } = useMemo(() => {
    const occs: Occ[] = [];
    const treated = new Map<string, string>();
    const shiftMap = new Map<string, any>();
    for (const s of data.data?.shifts ?? []) if (!s.is_default) shiftMap.set(s.id, s.schedule ?? {});
    for (const a of data.data?.adj ?? []) if (a.status === "tratado") treated.set(`${a.rdo_workforce_id}|${a.kind}`, a.treated_at);
    for (const w of data.data?.wf ?? []) {
      const rdo = w.rdos;
      const work = rdo?.works;
      const dow = new Date(w.report_date + "T12:00:00").getDay();
      // Sexta, sábado e domingo: saída padrão reduzida (16h).
      const weekend = [0, 5, 6].includes(dow);
      // Colaborador em turno próprio (fora do Padrão): o horário previsto vem do turno dele.
      const own = w.collaborators?.shift_id ? shiftMap.get(w.collaborators.shift_id) : undefined;
      const ownDay = own ? own[String(dow)] : undefined;
      let night = rdo?.shift === "night" || rdo?.shift === "noturno";
      let expEntry: string | null = night ? "21:30" : work?.entry_time ?? null;
      let expExit: string | null = night ? "05:30" : (weekend && work?.exit_time_weekend) || work?.exit_time || null;
      if (own) {
        expEntry = ownDay?.start ?? null;
        expExit = ownDay?.end ?? null;
        night = !!ownDay && (toMin(ownDay.end) ?? 0) < (toMin(ownDay.start) ?? 0);
      }
      const base = {
        wfId: w.id,
        date: w.report_date,
        reg: w.collaborators?.registration_number ?? "",
        name: w.collaborators?.full_name ?? "—",
        client: work?.clients?.name ?? "—",
        service: work?.name ?? "—",
        responsible: rdo?.responsible_name ?? "—",
        rdoNumber: rdo?.number ?? null,
        wf: w,
        expected: { entry: expEntry, exit: expExit },
      };
      const add = (kind: Kind, reason: string) => occs.push({ ...base, key: `${w.id}|${kind}`, kind, reason });
      const cls = w.final_classification ?? w.reported_reason;
      const note = w.reported_note ? ` — ${w.reported_note}` : "";
      if (!w.present) {
        if (cls === "atestado" || cls === "medico") add("atestado", reasonLabel(w.reported_reason, w.reported_note) + note);
        else if (cls === "interjornada") add("interjornada", reasonLabel(w.reported_reason, w.reported_note) + note);
        else if (cls === "falta" || !cls || cls === "outro") add("falta", cls ? reasonLabel(w.reported_reason, w.reported_note) + note : "Ausente no RDO");
        continue;
      }
      const e = toMin(w.entry_time), ee = toMin(expEntry);
      if (e !== null && ee !== null && e - ee > TOLERANCE && !(night && e < 12 * 60))
        add("atraso", `Entrada ${hhmm(w.entry_time)} (previsto ${hhmm(expEntry)})`);
      let x = toMin(w.exit_time), xx = toMin(expExit);
      if (x !== null && xx !== null) {
        if (night) { if (x < 12 * 60) x += 1440; if (xx < 12 * 60) xx += 1440; }
        if (xx - x > TOLERANCE) add("saida", `Saída ${hhmm(w.exit_time)} (previsto ${hhmm(expExit)})`);
      }
    }
    return { occs, treated };
  }, [data.data]);

  const filtered = occs.filter((o) => {
    if (f.kind !== "all" && o.kind !== f.kind) return false;
    if (f.name && !o.name.toLowerCase().includes(f.name.toLowerCase())) return false;
    if (f.reg && !o.reg.toLowerCase().includes(f.reg.toLowerCase())) return false;
    if (f.client && !`${o.client} ${o.service}`.toLowerCase().includes(f.client.toLowerCase())) return false;
    return true;
  });
  const isDone = (o: Occ) => treated.has(o.key);
  const pending = filtered.filter((o) => !isDone(o));
  const rows = f.status === "pendente" ? pending : f.status === "tratado" ? filtered.filter(isDone) : filtered;
  const count = (k: Kind) => pending.filter((o) => o.kind === k).length;

  const setStatus = async (o: Occ, status: "tratado" | "pendente") => {
    const { error } = await supabase
      .from("timeclock_adjustments")
      .upsert({ rdo_workforce_id: o.wfId, kind: o.kind, status, treated_at: new Date().toISOString() }, { onConflict: "rdo_workforce_id,kind" });
    if (error) { toast.error(error.message); return; }
    toast.success(status === "tratado" ? "Ocorrência tratada no ponto" : "Ocorrência voltou para pendente");
    void qc.invalidateQueries({ queryKey: ["ajuste-ponto"] });
  };

  return (
    <div className="space-y-4">
      <PageHeader title="Ajuste de Ponto" description="Ocorrências dos RDOs que precisam ser lançadas no ponto. Tratar aqui não altera a Programação nem o RDO." />

      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Total de pendências" value={pending.length} />
        <Stat label="Faltas" value={count("falta")} />
        <Stat label="Atestados" value={count("atestado")} />
        <Stat label="Atrasos" value={count("atraso")} />
        <Stat label="Saídas antecipadas" value={count("saida")} />
        <Stat label="Interjornadas" value={count("interjornada")} />
      </div>

      <div className="panel grid gap-3 p-4 sm:grid-cols-4 lg:grid-cols-7">
        <div className="space-y-1"><Label>De</Label><Input type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></div>
        <div className="space-y-1"><Label>Até</Label><Input type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></div>
        <div className="space-y-1">
          <Label>Tipo</Label>
          <Select value={f.kind} onValueChange={(kind) => setF({ ...f, kind })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              {(Object.keys(KIND_LABEL) as Kind[]).map((k) => <SelectItem key={k} value={k}>{KIND_LABEL[k]}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1"><Label>Colaborador</Label><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
        <div className="space-y-1"><Label>Matrícula</Label><Input value={f.reg} onChange={(e) => setF({ ...f, reg: e.target.value })} /></div>
        <div className="space-y-1"><Label>Cliente/Obra</Label><Input value={f.client} onChange={(e) => setF({ ...f, client: e.target.value })} /></div>
        <div className="space-y-1">
          <Label>Situação</Label>
          <Select value={f.status} onValueChange={(status) => setF({ ...f, status })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="pendente">Pendentes</SelectItem>
              <SelectItem value="tratado">Tratadas</SelectItem>
              <SelectItem value="all">Todas</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="panel overflow-x-auto p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Data</TableHead>
              <TableHead>Matrícula</TableHead>
              <TableHead>Colaborador</TableHead>
              <TableHead>Cliente/Obra</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead>Motivo/Observação</TableHead>
              <TableHead className="text-right">Ação</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.isLoading && <TableRow><TableCell colSpan={7} className="text-muted-foreground">Carregando...</TableCell></TableRow>}
            {!data.isLoading && rows.length === 0 && <TableRow><TableCell colSpan={7} className="text-muted-foreground">Nenhuma ocorrência encontrada.</TableCell></TableRow>}
            {rows.map((o) => {
              const done = isDone(o);
              return (
                <TableRow key={o.key} className="cursor-pointer" onClick={() => setDetail(o)}>
                  <TableCell className="whitespace-nowrap">{formatDateBR(o.date)}</TableCell>
                  <TableCell>{o.reg}</TableCell>
                  <TableCell className="font-medium">{o.name}</TableCell>
                  <TableCell>{o.client} <span className="text-xs text-muted-foreground">· {o.service}</span></TableCell>
                  <TableCell><Badge variant={o.kind === "falta" ? "destructive" : "secondary"}>{KIND_LABEL[o.kind]}</Badge></TableCell>
                  <TableCell className="text-sm text-muted-foreground">{o.reason}</TableCell>
                  <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                    {done ? (
                      <Button size="sm" variant="ghost" title="Voltar para pendente" onClick={() => setStatus(o, "pendente")}>
                        <RotateCcw className="h-4 w-4" /> Tratado
                      </Button>
                    ) : (
                      <Button size="icon" variant="outline" title="Ocorrência tratada no ponto" aria-label="Ocorrência tratada no ponto" onClick={() => setStatus(o, "tratado")}>
                        <X className="h-4 w-4" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <Dialog open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Apontamento do RDO</DialogTitle></DialogHeader>
          {detail && (
            <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
              <span className="text-muted-foreground">RDO</span><span>Nº {String(detail.rdoNumber ?? "").padStart(4, "0")} · {formatDateBR(detail.date)}</span>
              <span className="text-muted-foreground">Responsável</span><span>{detail.responsible}</span>
              <span className="text-muted-foreground">Cliente/Serviço</span><span>{detail.client} · {detail.service}</span>
              <span className="text-muted-foreground">Colaborador</span><span>{detail.reg} — {detail.name}</span>
              <span className="text-muted-foreground">Presente</span><span>{detail.wf.present ? "Sim" : "Não"}</span>
              <span className="text-muted-foreground">Entrada / Saída</span><span>{hhmm(detail.wf.entry_time)} → {hhmm(detail.wf.exit_time)} (previsto {hhmm(detail.expected.entry)} → {hhmm(detail.expected.exit)})</span>
              <span className="text-muted-foreground">Motivo informado</span><span>{reasonLabel(detail.wf.reported_reason, detail.wf.reported_note)}</span>
              <span className="text-muted-foreground">Observação</span><span>{detail.wf.reported_note || "—"}</span>
              <span className="text-muted-foreground">Classificação</span><span>{detail.wf.final_classification ? reasonLabel(detail.wf.final_classification) : "—"}</span>
              <span className="text-muted-foreground">Tipo</span><span>{KIND_LABEL[detail.kind]}</span>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="panel p-4">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="font-display text-3xl font-semibold">{value}</p>
    </div>
  );
}
